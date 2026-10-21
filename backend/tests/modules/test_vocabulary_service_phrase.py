"""Сателлиты (translations/notes/tags) для kind='phrase' (FLQ phrase selection)."""

import uuid
from collections.abc import AsyncIterator
from unittest import mock

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.identity.repo import UserRepo
from glosano.modules.vocabulary import service
from glosano.modules.vocabulary.models import (
    ItemTag,
    PersonalNote,
    PersonalTranslation,
    PhraseItem,
    TokenItem,
)


async def _make_user(s: AsyncSession) -> uuid.UUID:
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
        for model in (PersonalTranslation, PersonalNote, ItemTag, PhraseItem, TokenItem):
            await s.execute(delete(model))


async def _phrase_item(user_id: uuid.UUID) -> uuid.UUID:
    async with session_scope() as s:
        item = PhraseItem(
            user_id=user_id,
            language_code="en",
            phrase_text="so far so good",
            display_text="so far, so good",
            status="tracked",
            confidence=1,
        )
        s.add(item)
        await s.flush()
        return item.id


async def test_phrase_translation_roundtrip():
    async with session_scope() as s:
        user_id = await _make_user(s)
    item_id = await _phrase_item(user_id)
    async with session_scope() as s:
        row, created = await service.add_translation(
            s,
            user_id=user_id,
            kind="phrase",
            item_id=item_id,
            target_language_code="ru",
            translation_text="пока всё хорошо",
            source_type="user",
        )
        assert created and row.is_primary and row.item_kind == "phrase"
    async with session_scope() as s:
        updated = await service.update_translation(
            s,
            user_id=user_id,
            kind="phrase",
            item_id=item_id,
            translation_id=row.id,
            translation_text="пока что неплохо",
        )
        assert updated.translation_text == "пока что неплохо"
    async with session_scope() as s:
        remaining = await service.delete_translation(
            s, user_id=user_id, kind="phrase", item_id=item_id, translation_id=row.id
        )
        assert remaining == []


async def test_phrase_note_and_tags():
    async with session_scope() as s:
        user_id = await _make_user(s)
    item_id = await _phrase_item(user_id)
    async with session_scope() as s:
        note = await service.put_note(
            s, user_id=user_id, kind="phrase", item_id=item_id, note_text="идиома"
        )
        assert note.item_kind == "phrase"
    async with session_scope() as s:
        tags = await service.add_tag(
            s, user_id=user_id, kind="phrase", item_id=item_id, tag_name="idiom"
        )
        assert tags == ["idiom"]
    async with session_scope() as s:
        tags = await service.remove_tag(
            s, user_id=user_id, kind="phrase", item_id=item_id, tag_name="idiom"
        )
        assert tags == []


async def test_satellites_do_not_leak_across_kinds():
    """Токен и фраза с одинаковым item_id-скоупом не видят чужие сателлиты."""  # noqa: RUF002
    async with session_scope() as s:
        user_id = await _make_user(s)
        token = TokenItem(
            user_id=user_id,
            language_code="en",
            token_text="far",
            status="tracked",
            confidence=1,
        )
        s.add(token)
        await s.flush()
        token_id = token.id
    item_id = await _phrase_item(user_id)
    async with session_scope() as s:
        await service.add_tag(s, user_id=user_id, kind="phrase", item_id=item_id, tag_name="a")
        translation, _ = await service.add_translation(
            s,
            user_id=user_id,
            kind="phrase",
            item_id=item_id,
            target_language_code="ru",
            translation_text="пока всё хорошо",
            source_type="user",
        )
        translation_id = translation.id
    # A token with the same UUID as the phrase must not inherit its satellites.
    async with session_scope() as s:
        s.add(
            TokenItem(
                id=item_id,
                user_id=user_id,
                language_code="en",
                token_text="collision",
                status="tracked",
                confidence=1,
            )
        )
        await s.flush()
        for text in ("far", "collision"):
            result = await service.lookup(
                s,
                user_id=user_id,
                kind="token",
                language_code="en",
                text=text,
                target_language_code="ru",
            )
            assert result.item_id in (token_id, item_id)
            assert result.tags == [] and result.translations == []
        phrase = await service.lookup(
            s,
            user_id=user_id,
            kind="phrase",
            language_code="en",
            text="so far so good",
            target_language_code="ru",
        )
        assert phrase.tags == ["a"]
        assert [row.id for row in phrase.translations] == [translation_id]
        with pytest.raises(service.TranslationNotFound):
            await service.update_translation(
                s,
                user_id=user_id,
                kind="token",
                item_id=item_id,
                translation_id=translation_id,
                translation_text="x",
            )


async def test_phrase_item_not_found_for_wrong_kind():
    async with session_scope() as s:
        user_id = await _make_user(s)
    item_id = await _phrase_item(user_id)
    async with session_scope() as s:
        with pytest.raises(service.ItemNotFound):
            await service.put_note(s, user_id=user_id, kind="token", item_id=item_id, note_text="x")


async def test_create_item_duplicate_race_upserts_existing_phrase():
    """Проигранная create-create гонка: пре-чек не видит строку, INSERT ловит
    IntegrityError по uq_phrase_items_user_lang_text -> create_item должен
    откатиться, перечитать строку победителя и применить статус (upsert),
    а не отдавать 500."""  # noqa: RUF002
    async with session_scope() as s:
        user_id = await _make_user(s)
    item_id = await _phrase_item(user_id)  # «конкурент» уже вставил строку

    calls = 0

    async def none_once(
        session: AsyncSession, *, user_id: uuid.UUID, language_code: str, text: str
    ) -> PhraseItem | None:
        nonlocal calls
        calls += 1
        if calls == 1:
            return None
        # Rollback expires ORM instances; actually re-read the winning row.
        return await session.scalar(
            select(PhraseItem).where(
                PhraseItem.user_id == user_id,
                PhraseItem.language_code == language_code,
                PhraseItem.phrase_text == text,
            )
        )

    with mock.patch.object(service, "_get_phrase_item", side_effect=none_once):
        async with session_scope() as s:
            item = await service.create_item(
                s,
                user_id=user_id,
                kind="phrase",
                language_code="en",
                text="So far, so good",
                status="known",
                confidence=None,
            )
    assert calls == 2
    assert item.id == item_id
    assert item.status == "known"
    assert item.confidence is None


async def test_create_item_duplicate_race_upserts_existing_token():
    async with session_scope() as s:
        user_id = await _make_user(s)
        token = TokenItem(
            user_id=user_id,
            language_code="en",
            token_text="far",
            status="tracked",
            confidence=1,
        )
        s.add(token)
        await s.flush()
        token_id = token.id

    calls = 0

    async def none_once(
        session: AsyncSession, *, user_id: uuid.UUID, language_code: str, text: str
    ) -> TokenItem | None:
        nonlocal calls
        calls += 1
        if calls == 1:
            return None
        # Rollback expires ORM instances; actually re-read the winning row.
        return await session.scalar(
            select(TokenItem).where(
                TokenItem.user_id == user_id,
                TokenItem.language_code == language_code,
                TokenItem.token_text == text,
            )
        )

    with mock.patch.object(service, "_get_token_item", side_effect=none_once):
        async with session_scope() as s:
            item = await service.create_item(
                s,
                user_id=user_id,
                kind="token",
                language_code="en",
                text="Far",
                status="known",
                confidence=None,
            )
    assert calls == 2
    assert item.id == token_id
    assert item.status == "known"
