"""Import core: write LingQ cards into the vocabulary tables (FLQ-14.1, ADR-0033).

Writes the vocabulary models directly instead of going through
`vocabulary.service`: those functions commit per call and reset `added_by`,
while the import commits once per batch and must respect the conflict policy
(`keep` never touches the level or review item of an existing item).
"""

from __future__ import annotations

import dataclasses
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.modules.lingq_import.mapping import classify_term, dedupe_tags, normalize_locale
from glosano.modules.lingq_import.records import ImportIssue, ImportOptions, ImportReport, LingqCard
from glosano.modules.review.models import ReviewItem
from glosano.modules.review.service import sync_review_item
from glosano.modules.review.sm2 import INITIAL_STATE, state_to_json
from glosano.modules.vocabulary.models import (
    ItemTag,
    PersonalNote,
    PersonalTranslation,
    PhraseItem,
    TokenItem,
)

BATCH_SIZE = 100
MAX_TERM_LENGTH = 256  # same as the vocabulary API's CreateItemRequest.text
MAX_TRANSLATION_LENGTH = 512
MAX_TAG_LENGTH = 64
MAX_NOTE_LENGTH = 4000

ItemKind = Literal["token", "phrase"]
Item = TokenItem | PhraseItem


@dataclass
class _SeenItem:
    item_id: uuid.UUID
    created: bool  # created by this import
    counted_updated: bool = False


@dataclass
class ImportState:
    """Per-import memory shared across batches and across `import_cards` calls.

    A job that feeds cards page by page (LingQ API) passes one state to every
    call so a term repeated on a later page merges into the first item and an
    item is counted as updated at most once.

    Discard the state after a failed (rolled-back) batch instead of reusing it:
    it may reference item ids that were never committed.
    """

    items: dict[tuple[ItemKind, str], _SeenItem] = field(
        default_factory=dict[tuple[ItemKind, str], _SeenItem]
    )


async def import_cards(
    cards: Sequence[LingqCard],
    *,
    user_id: uuid.UUID,
    options: ImportOptions,
    report: ImportReport,
    on_batch: Callable[[ImportReport], Awaitable[None]] | None = None,
    now: datetime | None = None,
    state: ImportState | None = None,
) -> None:
    """Import cards in batches of BATCH_SIZE; each batch is one committed transaction."""
    now = now or datetime.now(UTC)
    state = state if state is not None else ImportState()
    for start in range(0, len(cards), BATCH_SIZE):
        async with session_scope() as session:
            for card in cards[start : start + BATCH_SIZE]:
                await _import_card(
                    session,
                    card,
                    user_id=user_id,
                    options=options,
                    report=report,
                    now=now,
                    state=state,
                )
        if on_batch is not None:
            await on_batch(report)


async def _import_card(
    session: AsyncSession,
    card: LingqCard,
    *,
    user_id: uuid.UUID,
    options: ImportOptions,
    report: ImportReport,
    now: datetime,
    state: ImportState,
) -> None:
    report.processed += 1
    if len(card.term.strip()) > MAX_TERM_LENGTH:
        report.add_issue(ImportIssue(code="term_too_long", row=card.row, term=card.term))
        report.skipped += 1
        return
    classified = classify_term(card.term, options.language_code)
    if isinstance(classified, ImportIssue):
        report.add_issue(dataclasses.replace(classified, row=card.row, term=card.term))
        report.skipped += 1
        return
    kind, key = classified
    status, confidence = _target_level(card, options)
    may_update_level = options.source == "lingq" and options.conflict_mode == "update"

    seen = state.items.get((kind, key))
    if seen is not None:
        item = await _get_item(session, kind, seen.item_id)
        changed = False
        if may_update_level:
            was_known_token = kind == "token" and item.status == "known"
            changed = await _apply_level(
                session,
                item,
                kind,
                user_id=user_id,
                status=status,
                confidence=confidence,
                due_at=card.due_at or now,
                now=now,
            )
            if seen.created and kind == "token":
                report.known_words += (status == "known") - was_known_token
        added = await _add_annotations(session, item, kind, card, user_id, options, report)
        if (changed or added) and not seen.created and not seen.counted_updated:
            seen.counted_updated = True
            report.updated_items += 1
        return

    existing = await _find_item(
        session, kind, key, user_id=user_id, language_code=options.language_code
    )
    if existing is None:
        item = await _create_item(
            session,
            kind,
            key,
            card,
            user_id=user_id,
            options=options,
            status=status,
            confidence=confidence,
            now=now,
        )
        state.items[(kind, key)] = _SeenItem(item.id, created=True)
        if kind == "token":
            report.created_tokens += 1
            report.known_words += status == "known"
        else:
            report.created_phrases += 1
        await _add_annotations(session, item, kind, card, user_id, options, report)
        return

    seen = _SeenItem(existing.id, created=False)
    state.items[(kind, key)] = seen
    changed = False
    if may_update_level:
        changed = await _apply_level(
            session,
            existing,
            kind,
            user_id=user_id,
            status=status,
            confidence=confidence,
            due_at=card.due_at or now,
            now=now,
        )
    added = await _add_annotations(session, existing, kind, card, user_id, options, report)
    if changed or added:
        # An existing item counts as updated only if the import actually changed it.
        seen.counted_updated = True
        report.updated_items += 1


def _target_level(card: LingqCard, options: ImportOptions) -> tuple[str, int | None]:
    if card.status is not None:
        status, confidence = card.status, card.confidence
    else:
        status, confidence = options.default_status, options.default_confidence
    if status == "known":
        return status, None
    # tracked ⇔ confidence IS NOT NULL (vocabulary check constraint).
    return status, confidence if confidence is not None else 1


def _model(kind: ItemKind) -> type[TokenItem] | type[PhraseItem]:
    return TokenItem if kind == "token" else PhraseItem


async def _get_item(session: AsyncSession, kind: ItemKind, item_id: uuid.UUID) -> Item:
    item = await session.get(_model(kind), item_id)
    if item is None:  # pragma: no cover - the item was written by this import
        raise LookupError(f"imported {kind} item {item_id} disappeared")
    return item


async def _find_item(
    session: AsyncSession, kind: ItemKind, key: str, *, user_id: uuid.UUID, language_code: str
) -> Item | None:
    if kind == "token":
        stmt = select(TokenItem).where(
            TokenItem.user_id == user_id,
            TokenItem.language_code == language_code,
            TokenItem.token_text == key,
        )
    else:
        stmt = select(PhraseItem).where(
            PhraseItem.user_id == user_id,
            PhraseItem.language_code == language_code,
            PhraseItem.phrase_text == key,
        )
    return (await session.execute(stmt)).scalars().first()


async def _create_item(
    session: AsyncSession,
    kind: ItemKind,
    key: str,
    card: LingqCard,
    *,
    user_id: uuid.UUID,
    options: ImportOptions,
    status: str,
    confidence: int | None,
    now: datetime,
) -> Item:
    common = {
        "id": uuid.uuid4(),
        "user_id": user_id,
        "language_code": options.language_code,
        "status": status,
        "confidence": confidence,
        "added_by": "user",
        "import_source": "lingq",
    }
    item: Item
    if kind == "token":
        item = TokenItem(token_text=key, **common)
    else:
        item = PhraseItem(phrase_text=key, display_text=card.term.strip(), **common)
    session.add(item)
    await sync_review_item(
        session,
        user_id=user_id,
        item_kind=kind,
        item_id=item.id,
        language_code=options.language_code,
        status=status,
        now=now,
    )
    if status == "tracked" and card.due_at is not None:
        review = await _active_review_item(session, kind, item.id, user_id=user_id)
        review.due_at = card.due_at
    return item


async def _apply_level(
    session: AsyncSession,
    item: Item,
    kind: ItemKind,
    *,
    user_id: uuid.UUID,
    status: str,
    confidence: int | None,
    due_at: datetime,
    now: datetime,
) -> bool:
    """Set the level from LingQ ("update" mode); tracked restarts SM-2 at the LingQ due date.

    Return True if the status, the confidence or the review item actually changed.
    """
    changed = item.status != status or item.confidence != confidence
    if changed:
        item.status = status
        item.confidence = confidence
    await sync_review_item(
        session,
        user_id=user_id,
        item_kind=kind,
        item_id=item.id,
        language_code=item.language_code,
        status=status,
        now=now,
    )
    if status == "tracked":
        review = await _active_review_item(session, kind, item.id, user_id=user_id)
        initial = state_to_json(INITIAL_STATE)
        if review.algorithm_state_json != initial or review.due_at != due_at:
            review.algorithm_state_json = initial
            review.due_at = due_at
            changed = True
    if changed:
        _claim(item)
    return changed


async def _active_review_item(
    session: AsyncSession, kind: ItemKind, item_id: uuid.UUID, *, user_id: uuid.UUID
) -> ReviewItem:
    return (
        await session.execute(
            select(ReviewItem).where(
                ReviewItem.user_id == user_id,
                ReviewItem.item_kind == kind,
                ReviewItem.item_id == item_id,
                ReviewItem.is_active.is_(True),
            )
        )
    ).scalar_one()


async def _add_annotations(
    session: AsyncSession,
    item: Item,
    kind: ItemKind,
    card: LingqCard,
    user_id: uuid.UUID,
    options: ImportOptions,
    report: ImportReport,
) -> bool:
    """Add missing translations, note and tags; return True if anything was written."""

    def issue(code: str) -> None:
        report.add_issue(ImportIssue(code=code, row=card.row, term=card.term))

    added = False
    owner = {"owner_user_id": user_id, "item_kind": kind, "item_id": item.id}

    if card.meanings:
        rows = await session.execute(
            select(
                PersonalTranslation.target_language_code,
                PersonalTranslation.translation_text,
                PersonalTranslation.is_primary,
            ).where(
                PersonalTranslation.owner_user_id == user_id,
                PersonalTranslation.item_kind == kind,
                PersonalTranslation.item_id == item.id,
            )
        )
        existing_texts: set[tuple[str, str]] = set()
        primary_langs: set[str] = set()
        for lang, text, is_primary in rows.tuples():
            existing_texts.add((lang, text))
            if is_primary:
                primary_langs.add(lang)
        for meaning in card.meanings:
            lang = normalize_locale(meaning.locale, native_language=options.native_language)
            if lang is None:
                issue("translation_language_unsupported")
                continue
            text = meaning.text.strip()
            if not text or (lang, text) in existing_texts:
                continue
            if len(text) > MAX_TRANSLATION_LENGTH:
                issue("translation_too_long")
                continue
            session.add(
                PersonalTranslation(
                    **owner,
                    target_language_code=lang,
                    translation_text=text,
                    is_primary=lang not in primary_langs,
                    source_type="user",
                )
            )
            existing_texts.add((lang, text))
            primary_langs.add(lang)
            added = True

    example = card.example.strip()
    if example:
        has_note = (
            await session.execute(
                select(PersonalNote.id).where(
                    PersonalNote.owner_user_id == user_id,
                    PersonalNote.item_kind == kind,
                    PersonalNote.item_id == item.id,
                )
            )
        ).first() is not None
        if not has_note:
            if len(example) > MAX_NOTE_LENGTH:
                issue("note_too_long")
            else:
                session.add(PersonalNote(**owner, note_text=example))
                added = True

    tags = dedupe_tags(card.tags) if options.import_tags else []
    if tags:
        rows = await session.execute(
            select(ItemTag.tag_name).where(
                ItemTag.owner_user_id == user_id,
                ItemTag.item_kind == kind,
                ItemTag.item_id == item.id,
            )
        )
        existing_tags = {name.casefold() for name in rows.scalars()}
        for tag in tags:
            if tag.casefold() in existing_tags:
                continue
            if len(tag) > MAX_TAG_LENGTH:
                issue("tag_too_long")
                continue
            session.add(ItemTag(**owner, tag_name=tag, source_type="user"))
            existing_tags.add(tag.casefold())
            added = True

    if added:
        _claim(item)
    return added


def _claim(item: Item) -> None:
    """A changed bulk-known item becomes a user item, as vocabulary.service._promote_to_user does.

    Without it the item stays hidden from the default vocabulary list (added_by='user').
    import_source of an existing item is never touched.
    """
    if item.added_by != "user":
        item.added_by = "user"
