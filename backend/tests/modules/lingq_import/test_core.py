"""Import core: writing LingQ cards into the vocabulary tables (FLQ-14.1)."""

import string
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.identity.repo import UserRepo
from glosano.modules.lingq_import.core import ImportState, import_cards
from glosano.modules.lingq_import.records import ImportOptions, ImportReport, LingqCard, Meaning
from glosano.modules.review.models import ReviewItem
from glosano.modules.review.sm2 import INITIAL_STATE, state_to_json
from glosano.modules.vocabulary.models import (
    ItemTag,
    PersonalNote,
    PersonalTranslation,
    PhraseItem,
    TokenItem,
)

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)
DUE = datetime(2024, 2, 9, 9, 41, 15, tzinfo=UTC)
PROGRESSED_STATE: dict[str, Any] = {"ease_factor": 2.8, "interval_days": 12.0, "repetitions": 4}
OLD_DUE = datetime(2030, 1, 1, tzinfo=UTC)


async def _make_user(s: AsyncSession) -> uuid.UUID:
    user = await UserRepo(s).create(
        email=f"{uuid.uuid4().hex}@t.io",
        password_hash=hash_password("x"),
        display_name="T",
        role="learner",
    )
    await s.flush()
    return user.id


async def _user() -> uuid.UUID:
    async with session_scope() as s:
        return await _make_user(s)


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:  # pyright: ignore[reportUnusedFunction]
    yield
    async with session_scope() as s:
        for model in (
            ReviewItem,
            PersonalTranslation,
            PersonalNote,
            ItemTag,
            TokenItem,
            PhraseItem,
        ):
            await s.execute(delete(model))


def _options(
    source: Literal["csv", "lingq"] = "lingq",
    conflict_mode: Literal["keep", "update"] = "keep",
    *,
    import_tags: bool = True,
    default_status: Literal["tracked", "known"] = "tracked",
    default_confidence: int | None = 1,
) -> ImportOptions:
    return ImportOptions(
        language_code="pt",
        source=source,
        conflict_mode=conflict_mode,
        import_tags=import_tags,
        native_language="ru",
        default_status=default_status,
        default_confidence=default_confidence,
    )


def _card(
    term: str,
    *,
    meanings: tuple[Meaning, ...] = (),
    tags: tuple[str, ...] = (),
    example: str = "",
    status: Literal["tracked", "known"] | None = None,
    confidence: int | None = None,
    due_at: datetime | None = None,
    row: int | None = None,
) -> LingqCard:
    return LingqCard(
        term=term,
        example=example,
        tags=tags,
        meanings=meanings,
        status=status,
        confidence=confidence,
        due_at=due_at,
        row=row,
    )


async def _run(
    cards: list[LingqCard], user_id: uuid.UUID, options: ImportOptions, **kwargs: Any
) -> ImportReport:
    report = ImportReport()
    await import_cards(cards, user_id=user_id, options=options, report=report, now=NOW, **kwargs)
    return report


async def _token(user_id: uuid.UUID, text: str) -> TokenItem:
    async with session_scope() as s:
        return (
            await s.execute(
                select(TokenItem).where(TokenItem.user_id == user_id, TokenItem.token_text == text)
            )
        ).scalar_one()


async def _translations(item_id: uuid.UUID) -> list[PersonalTranslation]:
    async with session_scope() as s:
        rows = await s.execute(
            select(PersonalTranslation)
            .where(PersonalTranslation.item_id == item_id)
            .order_by(PersonalTranslation.created_at, PersonalTranslation.translation_text)
        )
        return list(rows.scalars().all())


async def _tags(item_id: uuid.UUID) -> set[str]:
    async with session_scope() as s:
        rows = await s.execute(select(ItemTag.tag_name).where(ItemTag.item_id == item_id))
        return set(rows.scalars().all())


async def _note(item_id: uuid.UUID) -> str | None:
    async with session_scope() as s:
        return (
            await s.execute(select(PersonalNote.note_text).where(PersonalNote.item_id == item_id))
        ).scalar_one_or_none()


async def _review_items(item_id: uuid.UUID) -> list[ReviewItem]:
    async with session_scope() as s:
        rows = await s.execute(select(ReviewItem).where(ReviewItem.item_id == item_id))
        return list(rows.scalars().all())


async def _existing_token(
    user_id: uuid.UUID,
    text: str,
    *,
    status: str,
    confidence: int | None,
    review_active: bool | None = None,
    added_by: str = "user",
) -> uuid.UUID:
    async with session_scope() as s:
        item = TokenItem(
            user_id=user_id,
            language_code="pt",
            token_text=text,
            status=status,
            confidence=confidence,
            added_by=added_by,
        )
        s.add(item)
        await s.flush()
        if review_active is not None:
            s.add(
                ReviewItem(
                    user_id=user_id,
                    item_kind="token",
                    item_id=item.id,
                    language_code="pt",
                    is_active=review_active,
                    algorithm_state_json=PROGRESSED_STATE,
                    due_at=OLD_DUE,
                )
            )
        return item.id


async def _count(model: Any, user_id: uuid.UUID) -> int:
    owner = model.owner_user_id if hasattr(model, "owner_user_id") else model.user_id
    async with session_scope() as s:
        return (
            await s.execute(select(func.count()).select_from(model).where(owner == user_id))
        ).scalar_one()


async def test_creates_token_and_phrase_with_translations_tags_note():
    user_id = await _user()
    cards = [
        _card(
            "Abacaxi",
            meanings=(Meaning("ru", "ананас"), Meaning("ru", "дело"), Meaning("en", "pineapple")),
            tags=("Noun", "fruta"),
            example="Comi um abacaxi…",
            status="tracked",
            confidence=2,
        ),
        _card(
            "Apesar de", meanings=(Meaning("ru", "несмотря на"),), status="tracked", confidence=1
        ),
    ]
    report = await _run(cards, user_id, _options())

    assert (report.created_tokens, report.created_phrases, report.updated_items) == (1, 1, 0)
    assert report.processed == 2 and report.skipped == 0
    token = await _token(user_id, "abacaxi")
    assert token.added_by == "user" and token.import_source == "lingq"
    assert (token.status, token.confidence) == ("tracked", 2)
    translations = await _translations(token.id)
    by_text = {t.translation_text: t for t in translations}
    assert set(by_text) == {"ананас", "дело", "pineapple"}
    assert by_text["ананас"].is_primary is True and by_text["ананас"].target_language_code == "ru"
    assert by_text["дело"].is_primary is False
    assert by_text["pineapple"].is_primary is True
    assert all(t.source_type == "user" for t in translations)
    assert await _tags(token.id) == {"Noun", "fruta"}
    assert await _note(token.id) == "Comi um abacaxi…"

    async with session_scope() as s:
        phrase = (
            await s.execute(select(PhraseItem).where(PhraseItem.user_id == user_id))
        ).scalar_one()
    assert phrase.phrase_text == "apesar de" and phrase.display_text == "Apesar de"
    assert phrase.added_by == "user" and phrase.import_source == "lingq"
    phrase_tr = await _translations(phrase.id)
    assert [(t.target_language_code, t.translation_text, t.is_primary) for t in phrase_tr] == [
        ("ru", "несмотря на", True)
    ]


async def test_csv_new_items_get_default_level_and_due_now():
    user_id = await _user()
    report = await _run(
        [_card("casa", row=2), _card("mesa", row=3)],
        user_id,
        _options("csv", default_confidence=3),
    )
    assert report.created_tokens == 2
    item = await _token(user_id, "casa")
    assert (item.status, item.confidence) == ("tracked", 3)
    [review] = await _review_items(item.id)
    assert review.is_active is True and review.due_at == NOW
    assert review.algorithm_state_json == state_to_json(INITIAL_STATE)


async def test_csv_default_known_level_counts_known_words():
    user_id = await _user()
    report = await _run(
        [_card("casa"), _card("muito obrigado")],
        user_id,
        _options("csv", default_status="known", default_confidence=None),
    )
    assert (report.created_tokens, report.created_phrases, report.known_words) == (1, 1, 1)
    item = await _token(user_id, "casa")
    assert (item.status, item.confidence) == ("known", None)


async def test_lingq_level_and_due_at_applied():
    user_id = await _user()
    await _run([_card("casa", status="tracked", confidence=3, due_at=DUE)], user_id, _options())
    item = await _token(user_id, "casa")
    assert (item.status, item.confidence) == ("tracked", 3)
    [review] = await _review_items(item.id)
    assert review.is_active is True and review.due_at == DUE
    assert review.algorithm_state_json == state_to_json(INITIAL_STATE)


async def test_known_card_creates_known_without_review_item():
    user_id = await _user()
    report = await _run([_card("casa", status="known")], user_id, _options())
    item = await _token(user_id, "casa")
    assert (item.status, item.confidence) == ("known", None)
    assert await _review_items(item.id) == []
    assert report.known_words == 1 and report.created_tokens == 1


async def test_keep_mode_leaves_existing_level_and_review():
    user_id = await _user()
    known_id = await _existing_token(
        user_id, "casa", status="known", confidence=None, review_active=False
    )
    tracked_id = await _existing_token(
        user_id, "mesa", status="tracked", confidence=4, review_active=True
    )
    report = await _run(
        [
            _card(
                "casa", meanings=(Meaning("ru", "дом"),), status="tracked", confidence=2, due_at=DUE
            ),
            _card("mesa", meanings=(Meaning("ru", "стол"),), status="known"),
        ],
        user_id,
        _options("lingq", "keep"),
    )
    assert report.updated_items == 2 and report.created_tokens == 0 and report.known_words == 0
    known = await _token(user_id, "casa")
    assert (known.status, known.confidence) == ("known", None)
    [known_review] = await _review_items(known_id)
    assert known_review.is_active is False
    assert known_review.due_at == OLD_DUE and known_review.algorithm_state_json == PROGRESSED_STATE
    assert [t.translation_text for t in await _translations(known_id)] == ["дом"]

    tracked = await _token(user_id, "mesa")
    assert (tracked.status, tracked.confidence) == ("tracked", 4)
    [tracked_review] = await _review_items(tracked_id)
    assert tracked_review.is_active is True
    assert tracked_review.due_at == OLD_DUE
    assert tracked_review.algorithm_state_json == PROGRESSED_STATE


async def test_keep_mode_without_additions_is_not_counted_as_updated():
    user_id = await _user()
    await _existing_token(user_id, "casa", status="known", confidence=None)
    report = await _run([_card("casa", status="tracked", confidence=2)], user_id, _options())
    assert report.updated_items == 0 and report.processed == 1


async def test_update_mode_downgrades_known_to_tracked():
    user_id = await _user()
    item_id = await _existing_token(
        user_id, "casa", status="known", confidence=None, review_active=False
    )
    report = await _run(
        [_card("casa", status="tracked", confidence=2, due_at=DUE)],
        user_id,
        _options("lingq", "update"),
    )
    assert report.updated_items == 1 and report.known_words == 0
    item = await _token(user_id, "casa")
    assert (item.status, item.confidence) == ("tracked", 2)
    assert item.import_source is None
    [review] = await _review_items(item_id)
    assert review.is_active is True and review.due_at == DUE
    assert review.algorithm_state_json == state_to_json(INITIAL_STATE)


async def test_update_mode_resets_active_review_and_promotes_to_known():
    user_id = await _user()
    reset_id = await _existing_token(
        user_id, "mesa", status="tracked", confidence=4, review_active=True
    )
    known_id = await _existing_token(
        user_id, "casa", status="tracked", confidence=1, review_active=True
    )
    report = await _run(
        [
            _card("mesa", status="tracked", confidence=1),
            _card("casa", status="known"),
        ],
        user_id,
        _options("lingq", "update"),
    )
    assert report.updated_items == 2
    [review] = await _review_items(reset_id)
    assert review.is_active is True and review.due_at == NOW
    assert review.algorithm_state_json == state_to_json(INITIAL_STATE)
    assert (await _token(user_id, "mesa")).confidence == 1

    known = await _token(user_id, "casa")
    assert (known.status, known.confidence) == ("known", None)
    [known_review] = await _review_items(known_id)
    assert known_review.is_active is False


async def test_update_mode_without_changes_is_not_counted_as_updated():
    user_id = await _user()
    tracked_id = await _existing_token(user_id, "mesa", status="tracked", confidence=2)
    async with session_scope() as s:
        s.add(
            ReviewItem(
                user_id=user_id,
                item_kind="token",
                item_id=tracked_id,
                language_code="pt",
                is_active=True,
                algorithm_state_json=state_to_json(INITIAL_STATE),
                due_at=DUE,
            )
        )
    await _existing_token(
        user_id, "casa", status="known", confidence=None, review_active=False, added_by="bulk"
    )
    report = await _run(
        [
            _card("mesa", status="tracked", confidence=2, due_at=DUE),
            _card("casa", status="known"),
        ],
        user_id,
        _options("lingq", "update"),
    )
    assert report.updated_items == 0 and report.processed == 2
    # Nothing changed, so the bulk-known item is not claimed either.
    assert (await _token(user_id, "casa")).added_by == "bulk"


async def test_update_mode_review_reset_alone_counts_as_updated():
    user_id = await _user()
    item_id = await _existing_token(
        user_id, "mesa", status="tracked", confidence=2, review_active=True
    )
    report = await _run(
        [_card("mesa", status="tracked", confidence=2, due_at=DUE)],
        user_id,
        _options("lingq", "update"),
    )
    assert report.updated_items == 1
    [review] = await _review_items(item_id)
    assert review.due_at == DUE
    assert review.algorithm_state_json == state_to_json(INITIAL_STATE)


async def test_csv_never_changes_existing_level():
    user_id = await _user()
    item_id = await _existing_token(
        user_id, "casa", status="known", confidence=None, review_active=False
    )
    report = await _run(
        [_card("casa", meanings=(Meaning("ru", "дом"),))],
        user_id,
        _options("csv", "update", default_confidence=1),
    )
    item = await _token(user_id, "casa")
    assert (item.status, item.confidence) == ("known", None)
    [review] = await _review_items(item_id)
    assert review.is_active is False and review.due_at == OLD_DUE
    assert report.updated_items == 1


async def test_existing_item_import_source_untouched():
    user_id = await _user()
    await _existing_token(user_id, "casa", status="tracked", confidence=1, review_active=True)
    await _run(
        [_card("casa", meanings=(Meaning("ru", "дом"),), status="known")],
        user_id,
        _options("lingq", "update"),
    )
    item = await _token(user_id, "casa")
    assert item.import_source is None and item.added_by == "user"


async def test_rerun_is_idempotent():
    user_id = await _user()
    cards = [
        _card(
            "Abacaxi",
            meanings=(Meaning("ru", "ананас"), Meaning(None, "фрукт")),
            tags=("Noun", "noun", "fruta"),
            example="Comi um abacaxi.",
            status="tracked",
            confidence=2,
            due_at=DUE,
        ),
        _card(
            "Apesar de", meanings=(Meaning("en", "despite"),), tags=("x",), example="Apesar de tudo"
        ),
        _card("casa", status="known"),
    ]
    first = await _run(cards, user_id, _options("lingq", "update"))
    counts = [
        await _count(m, user_id)
        for m in (TokenItem, PhraseItem, PersonalTranslation, ItemTag, PersonalNote, ReviewItem)
    ]
    second = await _run(cards, user_id, _options("lingq", "update"))
    assert counts == [
        await _count(m, user_id)
        for m in (TokenItem, PhraseItem, PersonalTranslation, ItemTag, PersonalNote, ReviewItem)
    ]
    assert counts == [2, 1, 3, 3, 2, 2]
    assert (first.created_tokens, first.created_phrases) == (2, 1)
    assert (second.created_tokens, second.created_phrases, second.known_words) == (0, 0, 0)
    assert second.updated_items == 0

    keep_again = await _run(cards, user_id, _options("csv", "keep"))
    assert keep_again.updated_items == 0


async def test_duplicate_term_in_one_import_merges():
    user_id = await _user()
    report = await _run(
        [
            _card("Abacaxi", meanings=(Meaning("ru", "ананас"),), status="tracked", confidence=2),
            _card("abacaxi", meanings=(Meaning("ru", "шишка"),), status="known"),
        ],
        user_id,
        _options("lingq", "keep"),
    )
    assert (report.created_tokens, report.updated_items, report.known_words) == (1, 0, 0)
    item = await _token(user_id, "abacaxi")
    assert (item.status, item.confidence) == ("tracked", 2)
    translations = await _translations(item.id)
    assert {t.translation_text: t.is_primary for t in translations} == {
        "ананас": True,
        "шишка": False,
    }


async def test_duplicate_term_update_mode_later_level_wins():
    user_id = await _user()
    report = await _run(
        [
            _card("Abacaxi", status="known"),
            _card("abacaxi", status="tracked", confidence=3, due_at=DUE),
        ],
        user_id,
        _options("lingq", "update"),
    )
    assert (report.created_tokens, report.updated_items, report.known_words) == (1, 0, 0)
    item = await _token(user_id, "abacaxi")
    assert (item.status, item.confidence) == ("tracked", 3)
    [review] = await _review_items(item.id)
    assert review.is_active is True and review.due_at == DUE


def _word(i: int) -> str:
    letters = string.ascii_lowercase
    return "pal" + letters[i // 26 // 26 % 26] + letters[i // 26 % 26] + letters[i % 26]


async def test_duplicate_across_batches_and_calls_merges():
    user_id = await _user()
    cards = [_card(_word(i)) for i in range(150)]
    cards[120] = _card(_word(0).upper(), meanings=(Meaning("ru", "второй"),))
    state = ImportState()
    report = ImportReport()
    options = _options("lingq", "update")
    await import_cards(cards, user_id=user_id, options=options, report=report, now=NOW, state=state)
    await import_cards(
        [_card(_word(1), meanings=(Meaning("ru", "третий"),))],
        user_id=user_id,
        options=options,
        report=report,
        now=NOW,
        state=state,
    )
    assert report.created_tokens == 149
    assert report.updated_items == 0
    assert report.processed == 151
    assert await _count(TokenItem, user_id) == 149


async def test_unsupported_translation_language_reported_card_kept():
    user_id = await _user()
    report = await _run(
        [_card("casa", meanings=(Meaning("sv", "hus"), Meaning("ru", "дом")), row=7)],
        user_id,
        _options("csv"),
    )
    assert report.created_tokens == 1 and report.skipped == 0
    assert [(i.code, i.row, i.term) for i in report.issues] == [
        ("translation_language_unsupported", 7, "casa")
    ]
    item = await _token(user_id, "casa")
    assert [t.translation_text for t in await _translations(item.id)] == ["дом"]


async def test_translation_without_locale_uses_native():
    user_id = await _user()
    await _run([_card("casa", meanings=(Meaning(None, "дом"),))], user_id, _options("csv"))
    item = await _token(user_id, "casa")
    [translation] = await _translations(item.id)
    assert (translation.target_language_code, translation.is_primary) == ("ru", True)


async def test_existing_primary_kept_and_import_translation_secondary():
    user_id = await _user()
    item_id = await _existing_token(user_id, "casa", status="tracked", confidence=1)
    async with session_scope() as s:
        s.add(
            PersonalTranslation(
                owner_user_id=user_id,
                item_kind="token",
                item_id=item_id,
                target_language_code="ru",
                translation_text="жильё",
                is_primary=True,
                source_type="user",
            )
        )
    await _run([_card("casa", meanings=(Meaning("ru", "дом"),))], user_id, _options("csv"))
    by_text = {t.translation_text: t.is_primary for t in await _translations(item_id)}
    assert by_text == {"жильё": True, "дом": False}


async def test_note_not_overwritten():
    user_id = await _user()
    item_id = await _existing_token(user_id, "casa", status="tracked", confidence=1)
    async with session_scope() as s:
        s.add(
            PersonalNote(
                owner_user_id=user_id, item_kind="token", item_id=item_id, note_text="mine"
            )
        )
    report = await _run([_card("casa", example="A casa é grande.")], user_id, _options("csv"))
    assert await _note(item_id) == "mine"
    assert report.updated_items == 0


async def test_tags_case_insensitive_and_disabled():
    user_id = await _user()
    item_id = await _existing_token(user_id, "casa", status="tracked", confidence=1)
    async with session_scope() as s:
        s.add(ItemTag(owner_user_id=user_id, item_kind="token", item_id=item_id, tag_name="Noun"))
    report = await _run(
        [_card("casa", tags=("noun", "NOUN", "Verb", "verb"))], user_id, _options("csv")
    )
    assert await _tags(item_id) == {"Noun", "Verb"}
    assert report.updated_items == 1

    await _run([_card("mesa", tags=("Noun",))], user_id, _options("csv", import_tags=False))
    mesa = await _token(user_id, "mesa")
    assert await _tags(mesa.id) == set()


async def test_field_limits_reported_and_dropped():
    user_id = await _user()
    report = await _run(
        [
            _card(
                "casa",
                meanings=(Meaning("ru", "д" * 513), Meaning("ru", "дом")),
                tags=("t" * 65, "ok"),
                example="n" * 4001,
                row=4,
            )
        ],
        user_id,
        _options("csv"),
    )
    assert report.skipped == 0 and report.created_tokens == 1
    assert sorted(i.code for i in report.issues) == [
        "note_too_long",
        "tag_too_long",
        "translation_too_long",
    ]
    assert all(i.row == 4 and i.term == "casa" for i in report.issues)
    item = await _token(user_id, "casa")
    assert [t.translation_text for t in await _translations(item.id)] == ["дом"]
    assert await _tags(item.id) == {"ok"}
    assert await _note(item.id) is None


async def test_unclassifiable_terms_skipped_with_issue():
    user_id = await _user()
    long_phrase = " ".join(["palavra"] * 9)
    report = await _run(
        [_card("...", row=2), _card(long_phrase, row=3), _card("casa", row=4)],
        user_id,
        _options("csv"),
    )
    assert report.processed == 3 and report.skipped == 2 and report.created_tokens == 1
    assert [(i.code, i.row, i.term) for i in report.issues] == [
        ("empty_term", 2, "..."),
        ("phrase_too_long", 3, long_phrase),
    ]


async def test_progress_callback_per_batch():
    user_id = await _user()
    cards = [_card(_word(i)) for i in range(250)]
    seen: list[int] = []

    async def on_batch(report: ImportReport) -> None:
        seen.append(report.processed)
        assert await _count(TokenItem, user_id) == report.created_tokens

    report = await _run(cards, user_id, _options("csv"), on_batch=on_batch)
    assert seen == [100, 200, 250]
    assert report.created_tokens == 250


async def test_due_in_future_kept_and_now_defaults():
    user_id = await _user()
    future = NOW + timedelta(days=3)
    report = ImportReport()
    await import_cards(
        [_card("casa", status="tracked", confidence=1, due_at=future)],
        user_id=user_id,
        options=_options(),
        report=report,
    )
    [review] = await _review_items((await _token(user_id, "casa")).id)
    assert review.due_at == future


async def test_bulk_item_with_new_translation_is_claimed():
    user_id = await _user()
    await _existing_token(user_id, "casa", status="known", confidence=None, added_by="bulk")
    await _run(
        [_card("casa", meanings=(Meaning("ru", "дом"),))],
        user_id,
        _options("csv", default_confidence=1),
    )
    item = await _token(user_id, "casa")
    assert (item.added_by, item.status, item.import_source) == ("user", "known", None)


async def test_bulk_item_level_update_is_claimed():
    user_id = await _user()
    await _existing_token(user_id, "casa", status="known", confidence=None, added_by="bulk")
    await _run(
        [_card("casa", status="tracked", confidence=2)], user_id, _options("lingq", "update")
    )
    item = await _token(user_id, "casa")
    assert (item.added_by, item.status, item.confidence) == ("user", "tracked", 2)
    assert item.import_source is None


async def test_bulk_item_untouched_by_keep_mode_stays_bulk():
    user_id = await _user()
    await _existing_token(user_id, "casa", status="known", confidence=None, added_by="bulk")
    report = await _run(
        [_card("casa", status="tracked", confidence=2)], user_id, _options("lingq", "keep")
    )
    item = await _token(user_id, "casa")
    assert (item.added_by, item.status) == ("bulk", "known")
    assert report.updated_items == 0


async def test_term_too_long_skipped_with_issue():
    user_id = await _user()
    long_term = "a" * 257
    report = await _run(
        [_card(long_term, row=2), _card("b" * 256, row=3)], user_id, _options("csv")
    )
    assert report.processed == 2 and report.skipped == 1 and report.created_tokens == 1
    assert [(i.code, i.row, i.term) for i in report.issues] == [
        ("term_too_long", 2, "a" * 100),
    ]
