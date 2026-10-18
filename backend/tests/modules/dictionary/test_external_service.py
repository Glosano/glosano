"""External dictionary pair listing, layouts and custom CRUD (FLQ-46, spec §5-§6)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.dictionary import external_service as svc
from glosano.modules.dictionary.external_templates import InvalidTemplateError
from glosano.modules.dictionary.models import UserExternalDictionary
from glosano.modules.dictionary.schemas import CustomDictionaryIn, ExternalDictionariesOut
from glosano.modules.identity.repo import UserRepo

TEMPLATE = "https://example.com/{word}"


async def _user(session: AsyncSession) -> uuid.UUID:
    user = await UserRepo(session).create(
        email=f"{uuid.uuid4().hex}@example.com", password_hash="x", display_name="U"
    )
    return user.id


def _body(
    name: str = "Mine",
    template: str = TEMPLATE,
    *,
    all_languages: bool = False,
    src: str = "pt",
    dst: str = "ru",
) -> CustomDictionaryIn:
    return CustomDictionaryIn(
        name=name,
        url_template=template,
        all_languages=all_languages,
        source_language_code=src,  # type: ignore[arg-type]
        target_language_code=dst,  # type: ignore[arg-type]
    )


def _refs(out: ExternalDictionariesOut) -> tuple[list[str], list[str]]:
    return [d.ref for d in out.visible], [d.ref for d in out.available]


async def test_default_layout_lists_supported_builtins(db_session: AsyncSession) -> None:
    user_id = await _user(db_session)
    out = await svc.list_for_pair(db_session, user_id, "pt", "ru")
    visible, available = _refs(out)
    assert visible == [
        "builtin:reverso",
        "builtin:google",
        "builtin:deepl",
        "builtin:wiktionary",
    ]
    assert available == []
    first = out.visible[0]
    assert first.kind == "builtin"
    assert first.custom_id is None
    assert first.all_languages is False
    assert first.word_encoding == "default"
    assert "{word}" in first.url_template
    assert out.visible[2].word_encoding == "no_slash"


async def test_hide_and_reorder_persist_per_pair(db_session: AsyncSession) -> None:
    user_id = await _user(db_session)
    out = await svc.set_layout(
        db_session, user_id, "pt", "ru", ["builtin:google", "builtin:reverso"]
    )
    assert _refs(out) == (
        ["builtin:google", "builtin:reverso"],
        ["builtin:deepl", "builtin:wiktionary"],
    )
    again = await svc.list_for_pair(db_session, user_id, "pt", "ru")
    assert _refs(again) == _refs(out)
    other_visible, other_available = _refs(await svc.list_for_pair(db_session, user_id, "en", "ru"))
    assert other_visible == [
        "builtin:reverso",
        "builtin:google",
        "builtin:deepl",
        "builtin:lingvo",
        "builtin:wiktionary",
    ]
    assert other_available == []


async def test_set_layout_overwrites_existing_row(db_session: AsyncSession) -> None:
    user_id = await _user(db_session)
    await svc.set_layout(db_session, user_id, "pt", "ru", ["builtin:google"])
    out = await svc.set_layout(db_session, user_id, "pt", "ru", ["builtin:deepl", "builtin:deepl"])
    assert _refs(out) == (
        ["builtin:deepl"],
        ["builtin:reverso", "builtin:google", "builtin:wiktionary"],
    )


async def test_custom_bound_to_pair_only_appears_there(db_session: AsyncSession) -> None:
    user_id = await _user(db_session)
    created = await svc.create_custom(db_session, user_id, _body())
    assert created.kind == "custom"
    assert created.ref == f"custom:{created.custom_id}"
    assert created.word_encoding == "default"
    assert created.all_languages is False
    visible, _ = _refs(await svc.list_for_pair(db_session, user_id, "pt", "ru"))
    assert visible[-1] == created.ref
    en_visible, _ = _refs(await svc.list_for_pair(db_session, user_id, "en", "ru"))
    assert created.ref not in en_visible


async def test_all_languages_custom_appears_visible_in_configured_pairs(
    db_session: AsyncSession,
) -> None:
    user_id = await _user(db_session)
    await svc.set_layout(db_session, user_id, "pt", "ru", ["builtin:google"])
    created = await svc.create_custom(db_session, user_id, _body(all_languages=True))
    assert created.all_languages is True
    visible, available = _refs(await svc.list_for_pair(db_session, user_id, "pt", "ru"))
    assert visible == ["builtin:google", created.ref]
    assert "builtin:reverso" in available
    es_visible, _ = _refs(await svc.list_for_pair(db_session, user_id, "es", "ru"))
    assert created.ref in es_visible


async def test_stale_refs_are_dropped(db_session: AsyncSession) -> None:
    user_id = await _user(db_session)
    created = await svc.create_custom(db_session, user_id, _body())
    await svc.set_layout(db_session, user_id, "pt", "ru", ["builtin:google", created.ref])
    assert created.custom_id is not None
    await svc.delete_custom(db_session, user_id, created.custom_id)
    visible, available = _refs(await svc.list_for_pair(db_session, user_id, "pt", "ru"))
    assert created.ref not in visible + available

    out = await svc.set_layout(
        db_session, user_id, "pt", "ru", ["builtin:nope", f"custom:{uuid.uuid4()}"]
    )
    assert out.visible == []
    assert [d.ref for d in out.available] == [
        "builtin:reverso",
        "builtin:google",
        "builtin:deepl",
        "builtin:wiktionary",
    ]


async def test_invalid_stored_template_is_skipped(db_session: AsyncSession) -> None:
    user_id = await _user(db_session)
    db_session.add(
        UserExternalDictionary(
            user_id=user_id,
            name="Evil",
            url_template="javascript:alert(1)//{word}",
            source_language_code=None,
            target_language_code=None,
        )
    )
    await db_session.flush()
    out = await svc.list_for_pair(db_session, user_id, "pt", "ru")
    assert not [d for d in out.visible + out.available if d.kind == "custom"]


async def test_limit_is_30(db_session: AsyncSession) -> None:
    user_id = await _user(db_session)
    for i in range(svc.MAX_CUSTOM_DICTIONARIES):
        await svc.create_custom(db_session, user_id, _body(name=f"D{i}"))
    with pytest.raises(svc.CustomDictionaryLimitError):
        await svc.create_custom(db_session, user_id, _body(name="One too many"))


async def test_invalid_template_raises(db_session: AsyncSession) -> None:
    user_id = await _user(db_session)
    with pytest.raises(InvalidTemplateError) as exc:
        await svc.create_custom(db_session, user_id, _body(template="https://{word}.example.com/"))
    assert exc.value.code == "placeholder_in_host"


async def test_update_custom_rebinds_and_renames(db_session: AsyncSession) -> None:
    user_id = await _user(db_session)
    created = await svc.create_custom(db_session, user_id, _body())
    assert created.custom_id is not None
    updated = await svc.update_custom(
        db_session,
        user_id,
        created.custom_id,
        _body(name="  Renamed ", template="https://example.org/?q={word}", all_languages=True),
    )
    assert updated.ref == created.ref
    assert updated.name == "Renamed"
    assert updated.all_languages is True
    assert updated.url_template == "https://example.org/?q={word}"
    with pytest.raises(InvalidTemplateError):
        await svc.update_custom(
            db_session, user_id, created.custom_id, _body(template="ftp://example.org/{word}")
        )


async def test_other_users_custom_not_found(db_session: AsyncSession) -> None:
    owner = await _user(db_session)
    intruder = await _user(db_session)
    created = await svc.create_custom(db_session, owner, _body())
    assert created.custom_id is not None
    with pytest.raises(svc.CustomDictionaryNotFoundError):
        await svc.update_custom(db_session, intruder, created.custom_id, _body())
    with pytest.raises(svc.CustomDictionaryNotFoundError):
        await svc.delete_custom(db_session, intruder, created.custom_id)
    with pytest.raises(svc.CustomDictionaryNotFoundError):
        await svc.delete_custom(db_session, owner, uuid.uuid4())


def test_custom_name_is_stripped_and_bounded() -> None:
    assert _body(name="  Hi  ").name == "Hi"
    with pytest.raises(ValueError):
        _body(name="   ")
    with pytest.raises(ValueError):
        _body(name="x" * 41)
