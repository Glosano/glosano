"""Real PostgreSQL source semantics and UTC boundary tests."""

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from tests.api._reader_helpers import register_and_onboard

from flinq.modules.identity.repo import UserRepo
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.statistics.service import get_overview
from flinq.modules.vocabulary.models import PhraseItem, TokenItem


async def test_sources_first_addition_graduation_isolation_and_boundaries(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    email = f"{uuid.uuid4()}@example.com"
    await register_and_onboard(client, email)
    user = await UserRepo(db_session).get_by_email(email)
    assert user is not None
    now = datetime(2026, 9, 10, 12, tzinfo=UTC)
    start = now.replace(hour=0)
    old_id, fresh_id, phrase_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db_session.add_all(
        [
            TokenItem(
                id=old_id,
                user_id=user.id,
                language_code="pt",
                token_text="old",
                status="tracked",
                confidence=1,
            ),
            TokenItem(
                id=fresh_id, user_id=user.id, language_code="pt", token_text="fresh", status="known"
            ),
            TokenItem(user_id=user.id, language_code="pt", token_text="junk", status="ignored"),
            TokenItem(user_id=user.id, language_code="en", token_text="foreign", status="known"),
            PhraseItem(
                id=phrase_id,
                user_id=user.id,
                language_code="pt",
                phrase_text="bom dia",
                display_text="Bom dia",
                status="tracked",
                confidence=1,
            ),
        ]
    )
    await db_session.flush()
    history: list[ReviewItem] = []
    for identity, kind, created, active in (
        (old_id, "token", start - timedelta(seconds=1), False),
        (old_id, "token", start, True),
        (fresh_id, "token", start, False),
        (fresh_id, "token", now, False),
        (phrase_id, "phrase", start, True),
        (uuid.uuid4(), "token", start + timedelta(days=1), False),
    ):
        item = ReviewItem(
            user_id=user.id,
            item_id=identity,
            item_kind=kind,
            language_code="pt",
            created_at=created,
            due_at=now,
            is_active=active,
            algorithm_state_json={},
        )
        db_session.add(item)
        await db_session.flush()
        history.append(item)
    for item, reviewed, graduated in (
        (history[2], start, True),
        (history[3], now, True),
        (history[4], now, False),
        (history[0], start - timedelta(microseconds=1), True),
        (history[1], start + timedelta(days=1), True),
    ):
        db_session.add(
            ReviewEvent(
                review_item_id=item.id,
                user_id=user.id,
                answer_value="correct",
                quality=4,
                previous_confidence=5 if graduated else 1,
                new_confidence=None if graduated else 2,
                previous_due_at=now,
                new_due_at=now,
                reviewed_at=reviewed,
            )
        )
    await db_session.commit()
    overview = await get_overview(db_session, user_id=user.id, language_code="pt", now=now)
    assert overview.new_items_today == 2  # fresh word + phrase, excludes reactivation and tomorrow
    assert overview.learned_items_today == 1  # two graduations of the same identity
    assert overview.reviews_completed_today == 3
    assert overview.known_items_count == 1
    assert overview.tracked_items_count == 2
    assert overview.ignored_items_count == 1
    assert overview.due_reviews == 2
    foreign = await get_overview(db_session, user_id=user.id, language_code="en", now=now)
    assert foreign.known_items_count == 1
    assert foreign.new_items_today == foreign.learned_items_today == foreign.due_reviews == 0
    nobody = await get_overview(db_session, user_id=uuid.uuid4(), language_code="pt", now=now)
    assert nobody.known_items_count == nobody.new_items_today == nobody.reviews_completed_today == 0
