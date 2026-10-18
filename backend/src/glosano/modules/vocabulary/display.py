"""The one translation shown where only one fits (FLQ-47, spec §8).

The SRS card, exercise hint, reader lesson vocabulary and the /vocabulary row
show the primary translation in the native language. Without one they fall
back to the newest primary translation in another language and report that
row's language, so the UI can show its flag. Saved translations are never
hidden or rewritten.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import and_, any_, bindparam, or_, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.vocabulary.models import PersonalTranslation


def pick_display_primary(
    translations: Sequence[PersonalTranslation], native: str
) -> PersonalTranslation | None:
    """Native primary; else the newest primary in another language; else None."""
    primaries = [t for t in translations if t.is_primary]
    native_primary = next((t for t in primaries if t.target_language_code == native), None)
    if native_primary is not None:
        return native_primary
    # Language code only breaks created_at ties (rows saved in one transaction).
    return max(primaries, key=lambda t: (t.created_at, t.target_language_code), default=None)


async def display_primaries(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    refs: Sequence[tuple[str, uuid.UUID]],
    native: str,
) -> dict[tuple[str, uuid.UUID], PersonalTranslation]:
    """Display primary per (item_kind, item_id) ref, loaded with one query."""
    ids_by_kind: dict[str, list[uuid.UUID]] = {}
    for kind, item_id in refs:
        ids_by_kind.setdefault(kind, []).append(item_id)
    if not ids_by_kind:
        return {}
    # Array parameters keep the bind count constant for lesson-sized ref lists.
    by_kind = [
        and_(
            PersonalTranslation.item_kind == kind,
            PersonalTranslation.item_id
            == any_(bindparam(f"ids_{kind}", value=ids, type_=ARRAY(PGUUID(as_uuid=True)))),
        )
        for kind, ids in ids_by_kind.items()
    ]
    rows = (
        await session.scalars(
            select(PersonalTranslation).where(
                PersonalTranslation.owner_user_id == user_id,
                PersonalTranslation.is_primary.is_(True),
                or_(*by_kind),
            )
        )
    ).all()
    grouped: dict[tuple[str, uuid.UUID], list[PersonalTranslation]] = {}
    for row in rows:
        grouped.setdefault((row.item_kind, row.item_id), []).append(row)
    picked: dict[tuple[str, uuid.UUID], PersonalTranslation] = {}
    for key, translations in grouped.items():
        chosen = pick_display_primary(translations, native)
        if chosen is not None:
            picked[key] = chosen
    return picked
