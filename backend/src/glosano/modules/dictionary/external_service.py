"""Per-pair external dictionary lists and custom dictionaries (FLQ-46, spec §5-§6).

No commits here: the request-scoped session owns the transaction (ADR-0025).
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.dictionary.external_catalog import builtins_for_pair
from glosano.modules.dictionary.external_templates import (
    is_valid_custom_template,
    validate_custom_template,
)
from glosano.modules.dictionary.models import UserDictionaryLayout, UserExternalDictionary
from glosano.modules.dictionary.schemas import (
    CustomDictionaryIn,
    ExternalDictionariesOut,
    ExternalDictionaryOut,
)

MAX_CUSTOM_DICTIONARIES = 30


class CustomDictionaryLimitError(Exception):
    pass


class CustomDictionaryNotFoundError(Exception):
    pass


def _custom_out(row: UserExternalDictionary) -> ExternalDictionaryOut:
    return ExternalDictionaryOut(
        ref=f"custom:{row.id}",
        kind="custom",
        name=row.name,
        url_template=row.url_template,
        word_encoding="default",
        custom_id=row.id,
        all_languages=row.source_language_code is None,
    )


async def _candidates(
    session: AsyncSession, user_id: uuid.UUID, src: str, dst: str
) -> list[ExternalDictionaryOut]:
    """Built-ins for the pair (catalog order), then the user's matching customs."""
    result: list[ExternalDictionaryOut] = [
        ExternalDictionaryOut(
            ref=f"builtin:{d.id}",
            kind="builtin",
            name=d.name,
            url_template=template,
            word_encoding=d.word_encoding,
            custom_id=None,
            all_languages=False,
        )
        for d, template in builtins_for_pair(src, dst)
    ]
    stmt = (
        select(UserExternalDictionary)
        .where(
            UserExternalDictionary.user_id == user_id,
            (UserExternalDictionary.source_language_code.is_(None))
            | (
                (UserExternalDictionary.source_language_code == src)
                & (UserExternalDictionary.target_language_code == dst)
            ),
        )
        .order_by(UserExternalDictionary.created_at, UserExternalDictionary.id)
    )
    rows = (await session.scalars(stmt)).all()
    result.extend(_custom_out(r) for r in rows if is_valid_custom_template(r.url_template))
    return result


async def _get_layout(
    session: AsyncSession, user_id: uuid.UUID, src: str, dst: str
) -> UserDictionaryLayout | None:
    # populate_existing: set_layout upserts via Core, bypassing the identity map.
    stmt = (
        select(UserDictionaryLayout)
        .where(
            UserDictionaryLayout.user_id == user_id,
            UserDictionaryLayout.source_language_code == src,
            UserDictionaryLayout.target_language_code == dst,
        )
        .execution_options(populate_existing=True)
    )
    return await session.scalar(stmt)


def _split(
    candidates: list[ExternalDictionaryOut], layout: UserDictionaryLayout | None
) -> ExternalDictionariesOut:
    by_ref = {c.ref: c for c in candidates}
    if layout is None:
        visible = list(candidates)
    else:
        stored_visible = list(layout.visible)
        known = set(stored_visible) | set(layout.hidden)
        visible = [by_ref[r] for r in stored_visible if r in by_ref]
        visible += [c for c in candidates if c.ref not in known]
    shown = {c.ref for c in visible}
    return ExternalDictionariesOut(
        visible=visible, available=[c for c in candidates if c.ref not in shown]
    )


async def list_for_pair(
    session: AsyncSession, user_id: uuid.UUID, src: str, dst: str
) -> ExternalDictionariesOut:
    candidates = await _candidates(session, user_id, src, dst)
    return _split(candidates, await _get_layout(session, user_id, src, dst))


async def set_layout(
    session: AsyncSession, user_id: uuid.UUID, src: str, dst: str, visible: list[str]
) -> ExternalDictionariesOut:
    candidates = await _candidates(session, user_id, src, dst)
    candidate_refs = [c.ref for c in candidates]
    allowed = set(candidate_refs)
    kept = list(dict.fromkeys(r for r in visible if r in allowed))
    hidden = [r for r in candidate_refs if r not in kept]
    stmt = pg_insert(UserDictionaryLayout).values(
        user_id=user_id,
        source_language_code=src,
        target_language_code=dst,
        visible=kept,
        hidden=hidden,
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=["user_id", "source_language_code", "target_language_code"],
            set_={
                "visible": stmt.excluded.visible,
                "hidden": stmt.excluded.hidden,
                "updated_at": func.now(),
            },
        )
    )
    return await list_for_pair(session, user_id, src, dst)


async def create_custom(
    session: AsyncSession, user_id: uuid.UUID, body: CustomDictionaryIn
) -> ExternalDictionaryOut:
    template = validate_custom_template(body.url_template)
    count = await session.scalar(
        select(func.count())
        .select_from(UserExternalDictionary)
        .where(UserExternalDictionary.user_id == user_id)
    )
    if (count or 0) >= MAX_CUSTOM_DICTIONARIES:
        raise CustomDictionaryLimitError
    row = UserExternalDictionary(
        user_id=user_id,
        name=body.name,
        url_template=template,
        source_language_code=None if body.all_languages else body.source_language_code,
        target_language_code=None if body.all_languages else body.target_language_code,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return _custom_out(row)


async def _get_owned(
    session: AsyncSession, user_id: uuid.UUID, custom_id: uuid.UUID
) -> UserExternalDictionary:
    row = await session.get(UserExternalDictionary, custom_id)
    if row is None or row.user_id != user_id:
        raise CustomDictionaryNotFoundError
    return row


async def update_custom(
    session: AsyncSession, user_id: uuid.UUID, custom_id: uuid.UUID, body: CustomDictionaryIn
) -> ExternalDictionaryOut:
    row = await _get_owned(session, user_id, custom_id)
    row.url_template = validate_custom_template(body.url_template)
    row.name = body.name
    row.source_language_code = None if body.all_languages else body.source_language_code
    row.target_language_code = None if body.all_languages else body.target_language_code
    await session.flush()
    await session.refresh(row)
    return _custom_out(row)


async def delete_custom(session: AsyncSession, user_id: uuid.UUID, custom_id: uuid.UUID) -> None:
    row = await _get_owned(session, user_id, custom_id)
    await session.delete(row)
    await session.flush()
