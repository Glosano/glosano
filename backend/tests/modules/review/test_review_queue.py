"""get_queue: главная очередь (due, сортировка, лимит) и lesson-режим."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.config import get_settings
from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.identity.models import UserProfile, UserSettings
from glosano.modules.identity.repo import UserRepo
from glosano.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from glosano.modules.review.models import ReviewEvent, ReviewItem
from glosano.modules.review.service import LessonNotFound, get_counts, get_queue
from glosano.modules.vocabulary import service as vocab
from glosano.modules.vocabulary.models import PersonalTranslation, PhraseItem, TokenItem

NOW = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)


async def _make_user(s: AsyncSession) -> uuid.UUID:
    # UserRepo(s).create() already attaches a UserSettings row (see
    # glosano/modules/identity/repo.py) — adding a second one here would
    # violate the user_settings_pkey unique constraint.
    user = await UserRepo(s).create(
        email=f"{uuid.uuid4().hex}@t.io",
        password_hash=hash_password("x"),
        display_name="T",
        role="learner",
    )
    await s.flush()
    return user.id


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:  # pyright: ignore[reportUnusedFunction]
    yield
    async with session_scope() as s:
        for model in (
            ReviewEvent,
            ReviewItem,
            PersonalTranslation,
            LessonTokenOccurrence,
            LessonSegment,
            Lesson,
            PhraseItem,
            TokenItem,
        ):
            await s.execute(delete(model))


async def _tracked_token(s: AsyncSession, user_id: uuid.UUID, text: str) -> TokenItem:
    item = await vocab.create_item(
        s,
        user_id=user_id,
        kind="token",
        language_code="pt",
        text=text,
        status="tracked",
        confidence=1,
    )
    assert isinstance(item, TokenItem)
    return item


async def _set_daily_limit(s: AsyncSession, user_id: uuid.UUID, limit: int) -> None:
    """Задать личный дневной лимит: тесты не должны зависеть от дефолта."""
    settings = await s.get(UserSettings, user_id)
    assert settings is not None
    settings.daily_goal_reviews = limit
    await s.commit()


async def _exhaust_daily_limit(
    s: AsyncSession, user_id: uuid.UUID, review_item_id: uuid.UUID, times: int
) -> None:
    for _ in range(times):
        s.add(
            ReviewEvent(
                review_item_id=review_item_id,
                user_id=user_id,
                answer_value="correct",
                previous_confidence=1,
                new_confidence=2,
                previous_due_at=NOW,
                new_due_at=NOW,
                reviewed_at=NOW,
            )
        )
    await s.commit()


async def _set_due(s: AsyncSession, item_id: uuid.UUID, due: datetime) -> None:
    ri = (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item_id))).scalars().one()
    ri.due_at = due
    await s.commit()


async def test_main_queue_returns_due_sorted_and_skips_not_due():
    async with session_scope() as s:
        user_id = await _make_user(s)
        a = await _tracked_token(s, user_id, "um")
        b = await _tracked_token(s, user_id, "dois")
        c = await _tracked_token(s, user_id, "tres")
        await _set_due(s, a.id, NOW - timedelta(days=1))
        await _set_due(s, b.id, NOW - timedelta(days=2))
        await _set_due(s, c.id, NOW + timedelta(days=1))  # не due
        items, daily = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert [i.text for i in items] == ["dois", "um"]  # старейший due первым
        assert daily.limit == 500 and daily.done_today == 0 and not daily.limit_reached


async def test_queue_includes_translation_and_confidence():
    async with session_scope() as s:
        user_id = await _make_user(s)
        profile = await s.get(UserProfile, user_id)
        assert profile
        profile.ui_language_code = "ru"
        item = await _tracked_token(s, user_id, "cada")
        await vocab.add_translation(
            s,
            user_id=user_id,
            kind="token",
            item_id=item.id,
            target_language_code="ru",
            translation_text="каждый",
            source_type="user",
        )
        await _set_due(s, item.id, NOW - timedelta(hours=1))
        items, _ = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert items[0].translation == "каждый" and items[0].confidence == 1


async def test_limit_reached_empties_main_queue():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        ri = (
            (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item.id)))
            .scalars()
            .one()
        )
        await _set_daily_limit(s, user_id, 2)
        await _exhaust_daily_limit(s, user_id, ri.id, 2)
        items, daily = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert items == [] and daily.limit_reached and daily.done_today == 2


async def _lesson_with_occurrence(s: AsyncSession, user_id: uuid.UUID, token_text: str) -> Lesson:
    lesson = Lesson(
        owner_user_id=user_id,
        language_code="pt",
        title="T",
        raw_text=f"{token_text} mundo",
    )
    s.add(lesson)
    await s.flush()
    seg = LessonSegment(
        lesson_id=lesson.id,
        ordinal=0,
        text=f"{token_text} mundo.",
        start_char_offset=0,
        end_char_offset=10,
    )
    s.add(seg)
    await s.flush()
    s.add(
        LessonTokenOccurrence(
            lesson_id=lesson.id,
            segment_id=seg.id,
            ordinal_in_lesson=0,
            ordinal_in_segment=0,
            surface_text=token_text,
            normalized_text=token_text,
            start_char_offset=0,
            end_char_offset=len(token_text),
        )
    )
    await s.flush()
    return lesson


async def _attach(s: AsyncSession, item: TokenItem | PhraseItem, lesson: Lesson) -> None:
    item.created_from_lesson_id = lesson.id
    await s.commit()


async def test_lesson_queue_returns_items_added_in_lesson_ignoring_due():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        await _attach(s, item, lesson)
        await _set_due(s, item.id, NOW + timedelta(days=3))  # не due — всё равно попадает
        items, daily = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        assert [i.text for i in items] == ["cada"]
        assert not daily.limit_reached


async def test_lesson_queue_excludes_word_added_in_another_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        mine = await _tracked_token(s, user_id, "cada")
        foreign = await _tracked_token(s, user_id, "mundo")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        other = await _lesson_with_occurrence(s, user_id, "mundo")
        await _attach(s, mine, lesson)
        await _attach(s, foreign, other)
        # "mundo" встречается в тексте первого урока ("cada mundo"), но добавлено в другом
        items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        assert [i.text for i in items] == ["cada"]


async def test_lesson_queue_includes_phrase_added_in_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        seg_id = (
            await s.execute(select(LessonSegment.id).where(LessonSegment.lesson_id == lesson.id))
        ).scalar_one()
        phrase = await vocab.create_item(
            s,
            user_id=user_id,
            kind="phrase",
            language_code="pt",
            text="cada mundo",
            status="tracked",
            confidence=1,
        )
        assert isinstance(phrase, PhraseItem)
        await _attach(s, phrase, lesson)
        phrase.created_from_segment_id = seg_id
        await s.commit()
        items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        assert [i.text for i in items] == ["cada mundo"]
        assert items[0].context_sentence == "cada mundo."


async def test_lesson_queue_excludes_items_without_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        await _tracked_token(s, user_id, "cada")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        assert items == []


async def test_lesson_queue_excludes_item_with_mismatched_language():
    """Defense-in-depth: write-путь такое запрещает, но на старых/битых данных
    очередь урока не должна выдавать item, чей язык отличается от языка урока —
    даже если провенанс (created_from_lesson_id) на него указывает."""
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        foreign_lang_item = await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="ru",
            text="cada",
            status="tracked",
            confidence=1,
        )
        # write-путь (create_item/patch_item) больше не допускает такой провенанс
        # при рассинхроне языков — выставляем напрямую, как если бы это были
        # устаревшие/предшествующие фиксу данные.
        foreign_lang_item.created_from_lesson_id = lesson.id
        await s.commit()
        items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        assert items == []


async def test_lesson_queue_foreign_lesson_raises():
    async with session_scope() as s:
        user_id = await _make_user(s)
        other_id = await _make_user(s)
        lesson = await _lesson_with_occurrence(s, other_id, "cada")
        with pytest.raises(LessonNotFound):
            await get_queue(
                s,
                user_id=user_id,
                language_code="pt",
                lesson_id=lesson.id,
                now=NOW,
            )


async def test_new_mode_returns_unreviewed_newest_first():
    async with session_scope() as s:
        user_id = await _make_user(s)
        a = await _tracked_token(s, user_id, "um")
        await _tracked_token(s, user_id, "dois")
        # отвеченное слово выпадает из режима new
        ri_a = (
            (await s.execute(select(ReviewItem).where(ReviewItem.item_id == a.id))).scalars().one()
        )
        ri_a.last_reviewed_at = NOW
        await s.commit()
        items, daily = await get_queue(s, user_id=user_id, language_code="pt", mode="new", now=NOW)
        assert [i.text for i in items] == ["dois"]
        assert not daily.limit_reached


async def test_practice_mode_returns_confident_items_and_ignores_limit():
    async with session_scope() as s:
        user_id = await _make_user(s)
        strong = await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="forte",
            status="tracked",
            confidence=4,
        )
        await _tracked_token(s, user_id, "fraco")  # confidence 1 — не попадает
        ri = (
            (await s.execute(select(ReviewItem).where(ReviewItem.item_id == strong.id)))
            .scalars()
            .one()
        )
        for _ in range(20):  # дневной лимит исчерпан
            s.add(
                ReviewEvent(
                    review_item_id=ri.id,
                    user_id=user_id,
                    answer_value="correct",
                    previous_confidence=4,
                    new_confidence=4,
                    previous_due_at=NOW,
                    new_due_at=NOW,
                    reviewed_at=NOW,
                )
            )
        await s.commit()
        items, daily = await get_queue(
            s, user_id=user_id, language_code="pt", mode="practice", now=NOW
        )
        assert [i.text for i in items] == ["forte"]  # лимит не режет practice
        assert daily.limit_reached is False


async def test_new_mode_respects_lesson_scope():
    async with session_scope() as s:
        user_id = await _make_user(s)
        mine = await _tracked_token(s, user_id, "cada")
        await _tracked_token(s, user_id, "mundo")  # без провенанса
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        await _attach(s, mine, lesson)
        items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", mode="new", lesson_id=lesson.id, now=NOW
        )
        assert [i.text for i in items] == ["cada"]


async def test_practice_mode_respects_lesson_scope():
    """До этой правки practice в скоупе урока был проверен только отрицательно
    (mismatched-language тест). Позитивный сценарий: уверенное слово урока
    (confidence >= 4) попадает в practice-очередь урока, слово без провенанса —
    нет, даже если оно тоже confident."""
    async with session_scope() as s:
        user_id = await _make_user(s)
        mine = await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="tracked",
            confidence=4,
        )
        await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="mundo",  # confident, но без провенанса урока
            status="tracked",
            confidence=4,
        )
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        assert isinstance(mine, TokenItem)
        await _attach(s, mine, lesson)
        items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", mode="practice", lesson_id=lesson.id, now=NOW
        )
        assert [i.text for i in items] == ["cada"]


async def test_practice_mode_mixes_kinds(monkeypatch: pytest.MonkeyPatch) -> None:
    """Слитый список перемешивается: phrase-элементы не вытесняются токенами."""
    import glosano.modules.review.service as review_service

    # Детерминированность: «перемешивание» = reverse, phrase-строки (добавленные
    # вторыми) оказываются в голове списка.
    def _reverse_shuffle(lst: list[object]) -> None:
        lst.reverse()

    monkeypatch.setattr(review_service.random, "shuffle", _reverse_shuffle)
    async with session_scope() as s:
        user_id = await _make_user(s)
        for i in range(5):
            await vocab.create_item(
                s,
                user_id=user_id,
                kind="token",
                language_code="pt",
                text=f"tok{i}",
                status="tracked",
                confidence=4,
            )
        await vocab.create_item(
            s,
            user_id=user_id,
            kind="phrase",
            language_code="pt",
            text="bom dia",
            status="tracked",
            confidence=4,
        )
        items, _ = await get_queue(s, user_id=user_id, language_code="pt", mode="practice", now=NOW)
        assert len(items) == 5
        assert any(i.item_kind == "phrase" for i in items)


async def test_counts_reports_due_new_practice(monkeypatch: pytest.MonkeyPatch) -> None:
    # локальный .env репозитория держит GLOSANO_LLM_ENABLED=true (dev/OpenRouter) —
    # явно фиксируем False, чтобы тест не зависел от ambient-конфига окружения.
    monkeypatch.setattr(get_settings(), "llm_enabled", False)
    async with session_scope() as s:
        user_id = await _make_user(s)
        a = await _tracked_token(s, user_id, "um")  # due + new
        strong = await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="forte",
            status="tracked",
            confidence=4,
        )
        # флейк-поправка: lifecycle-синк ставит due_at=real now(); тест
        # фиксирует NOW=2026-07-20 12:00 UTC — без явной пиновки due-счётчик
        # флейкует после полудня. Каждый item должен быть due относительно NOW.
        await _set_due(s, a.id, NOW - timedelta(hours=1))
        await _set_due(s, strong.id, NOW - timedelta(hours=1))
        counts = await get_counts(s, user_id=user_id, language_code="pt", now=NOW)
        assert counts.due == 2 and counts.new == 2 and counts.practice == 1
        assert counts.ai_enabled is False  # llm выключен в тестовом окружении


async def test_counts_respect_lesson_scope():
    async with session_scope() as s:
        user_id = await _make_user(s)
        mine = await _tracked_token(s, user_id, "cada")
        await _tracked_token(s, user_id, "mundo")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        await _attach(s, mine, lesson)
        await _set_due(s, mine.id, NOW - timedelta(hours=1))
        scoped = await get_counts(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        overall = await get_counts(s, user_id=user_id, language_code="pt", now=NOW)
        assert scoped.due == 1 and scoped.new == 1
        assert overall.new == 2


async def test_lesson_counts_due_matches_queue_ignoring_due_at():
    """Внутри скоупа урока due-счётчик не фильтрует по due_at — зеркалит
    очередь (FLQ-7: повторение урока = все слова урока, due первыми). Вне
    скоупа урока due по-прежнему считается как due_at <= now."""
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        await _attach(s, item, lesson)
        await _set_due(s, item.id, NOW + timedelta(days=3))  # не due

        scoped_counts = await get_counts(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        scoped_items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, mode="due", now=NOW
        )
        assert scoped_counts.due == 1
        assert len(scoped_items) == 1

        global_counts = await get_counts(s, user_id=user_id, language_code="pt", now=NOW)
        global_items, _ = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert global_counts.due == 0
        assert global_items == []


async def test_counts_foreign_lesson_raises():
    async with session_scope() as s:
        user_id = await _make_user(s)
        other_id = await _make_user(s)
        lesson = await _lesson_with_occurrence(s, other_id, "cada")
        with pytest.raises(LessonNotFound):
            await get_counts(s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW)


async def test_counts_and_queue_exclude_lesson_item_with_language_code_mutated_directly():
    """Провенанс на урок сохранён, но язык записи изменён напрямую (в обход
    write-пути) на язык, отличный от языка урока. Счётчики и все три режима
    очереди (due/new/practice) должны согласованно игнорировать такой item —
    иначе число на плитке и размер сессии разойдутся. Записи выставлен
    confidence=4, чтобы она в принципе попадала бы в practice, не будь
    исключена по языку."""
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="tracked",
            confidence=4,
        )
        assert isinstance(item, TokenItem)
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        await _attach(s, item, lesson)
        await _set_due(s, item.id, NOW - timedelta(hours=1))
        item.language_code = "ru"  # имитация битых/устаревших данных
        await s.commit()

        counts = await get_counts(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        assert counts.due == 0 and counts.new == 0 and counts.practice == 0

        for mode in ("due", "new", "practice"):
            items, _ = await get_queue(
                s, user_id=user_id, language_code="pt", mode=mode, lesson_id=lesson.id, now=NOW
            )
            assert items == [], mode


async def test_lesson_due_queue_excludes_item_when_lang_param_mismatches_lesson_language():
    """Lesson-ветка due раньше строила запрос вручную, без фильтра языка
    (в _mode_stmt он есть для new/practice/counts). При lang, отличном от
    языка урока (достижимо правкой URL), cards должна быть пустой — как и
    counts, вместо того чтобы отдавать полную сессию."""
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")  # язык pt
        lesson = await _lesson_with_occurrence(s, user_id, "cada")  # язык урока pt
        await _attach(s, item, lesson)
        items, _ = await get_queue(
            s, user_id=user_id, language_code="ru", lesson_id=lesson.id, mode="due", now=NOW
        )
        assert items == []
        counts = await get_counts(
            s, user_id=user_id, language_code="ru", lesson_id=lesson.id, now=NOW
        )
        assert counts.due == 0


async def test_lesson_new_mode_ignores_daily_limit_but_global_new_mode_respects_it():
    """FLQ-7: дневной лимит мягкий и ограничивает только главную (due) очередь;
    mini-review (в т.ч. lesson-скоуп) не блокируется. До этой задачи ветка
    'lesson_id + mode=new' была недостижима (её перехватывал due-режим), теперь
    она живая и должна следовать тому же правилу, что due/practice урока."""
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        await _attach(s, item, lesson)
        ri = (
            (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item.id)))
            .scalars()
            .one()
        )
        await _set_daily_limit(s, user_id, 2)  # исчерпать дневной лимит
        await _exhaust_daily_limit(s, user_id, ri.id, 2)

        lesson_items, lesson_daily = await get_queue(
            s, user_id=user_id, language_code="pt", mode="new", lesson_id=lesson.id, now=NOW
        )
        assert [i.text for i in lesson_items] == ["cada"]
        assert lesson_daily.limit_reached is False

        global_items, global_daily = await get_queue(
            s, user_id=user_id, language_code="pt", mode="new", now=NOW
        )
        assert global_items == []
        assert global_daily.limit_reached is True


async def test_queue_context_sentence_comes_from_segment():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        seg_id = (
            await s.execute(select(LessonSegment.id).where(LessonSegment.lesson_id == lesson.id))
        ).scalar_one()
        item.created_from_lesson_id = lesson.id
        item.created_from_segment_id = seg_id
        await _set_due(s, item.id, NOW - timedelta(hours=1))
        await s.commit()
        items, _ = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert [i.context_sentence for i in items] == ["cada mundo."]


async def _tracked_phrase(s: AsyncSession, user_id: uuid.UUID, text: str) -> PhraseItem:
    item = await vocab.create_item(
        s,
        user_id=user_id,
        kind="phrase",
        language_code="pt",
        text=text,
        status="tracked",
        confidence=4,
    )
    assert isinstance(item, PhraseItem)
    return item


async def _token_and_phrase(s: AsyncSession, user_id: uuid.UUID) -> tuple[TokenItem, PhraseItem]:
    """Слово и фраза: каждая из них due, новая и годится для practice."""
    token = await vocab.create_item(
        s,
        user_id=user_id,
        kind="token",
        language_code="pt",
        text="forte",
        status="tracked",
        confidence=4,
    )
    assert isinstance(token, TokenItem)
    phrase = await _tracked_phrase(s, user_id, "bom dia")
    await _set_due(s, token.id, NOW - timedelta(hours=1))
    await _set_due(s, phrase.id, NOW - timedelta(hours=2))
    return token, phrase


@pytest.mark.parametrize("mode", ["due", "new", "practice"])
async def test_queue_kind_filter_limits_items_to_kind(mode: str) -> None:
    async with session_scope() as s:
        user_id = await _make_user(s)
        await _token_and_phrase(s, user_id)
        phrases, _ = await get_queue(
            s, user_id=user_id, language_code="pt", mode=mode, kind="phrase", now=NOW
        )
        tokens, _ = await get_queue(
            s, user_id=user_id, language_code="pt", mode=mode, kind="token", now=NOW
        )
        both, _ = await get_queue(s, user_id=user_id, language_code="pt", mode=mode, now=NOW)
        assert [(i.item_kind, i.text) for i in phrases] == [("phrase", "bom dia")]
        assert [(i.item_kind, i.text) for i in tokens] == [("token", "forte")]
        assert sorted(i.item_kind for i in both) == ["phrase", "token"]


async def test_lesson_queue_kind_filter_combines_with_lesson_scope() -> None:
    async with session_scope() as s:
        user_id = await _make_user(s)
        token, phrase = await _token_and_phrase(s, user_id)
        other_phrase = await _tracked_phrase(s, user_id, "boa noite")
        lesson = await _lesson_with_occurrence(s, user_id, "forte")
        await _attach(s, token, lesson)
        await _attach(s, phrase, lesson)
        items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, kind="phrase", now=NOW
        )
        assert [i.text for i in items] == ["bom dia"]
        assert other_phrase.created_from_lesson_id is None


async def test_counts_kind_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "llm_enabled", False)
    async with session_scope() as s:
        user_id = await _make_user(s)
        await _token_and_phrase(s, user_id)
        await _tracked_phrase(s, user_id, "boa noite")  # новая, не due (due_at = real now)
        phrase_counts = await get_counts(
            s, user_id=user_id, language_code="pt", kind="phrase", now=NOW
        )
        token_counts = await get_counts(
            s, user_id=user_id, language_code="pt", kind="token", now=NOW
        )
        assert (phrase_counts.new, phrase_counts.practice) == (2, 2)
        assert (token_counts.due, token_counts.new, token_counts.practice) == (1, 1, 1)
        assert phrase_counts.due == 1
