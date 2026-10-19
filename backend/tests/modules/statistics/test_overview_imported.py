"""Imported items must not count towards the «new today» metric."""

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from tests.api._reader_helpers import register_and_onboard

from glosano.modules.identity.repo import UserRepo
from glosano.modules.review.models import ReviewItem
from glosano.modules.statistics.service import get_overview
from glosano.modules.vocabulary.models import PhraseItem, TokenItem


async def test_imported_items_not_new_today(client: AsyncClient, db_session: AsyncSession) -> None:
    email = f"{uuid.uuid4()}@example.com"
    await register_and_onboard(client, email)
    user = await UserRepo(db_session).get_by_email(email)
    assert user is not None
    now = datetime(2026, 9, 10, 12, tzinfo=UTC)
    imported_token, imported_phrase, native_token = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db_session.add_all(
        [
            TokenItem(
                id=imported_token,
                user_id=user.id,
                language_code="pt",
                token_text="importado",
                status="tracked",
                confidence=1,
                import_source="lingq",
            ),
            PhraseItem(
                id=imported_phrase,
                user_id=user.id,
                language_code="pt",
                phrase_text="bom dia",
                display_text="Bom dia",
                status="tracked",
                confidence=1,
                import_source="lingq",
            ),
            TokenItem(
                id=native_token,
                user_id=user.id,
                language_code="pt",
                token_text="nativo",
                status="tracked",
                confidence=1,
            ),
        ]
    )
    await db_session.flush()
    for identity, kind in (
        (imported_token, "token"),
        (imported_phrase, "phrase"),
        (native_token, "token"),
    ):
        db_session.add(
            ReviewItem(
                user_id=user.id,
                item_id=identity,
                item_kind=kind,
                language_code="pt",
                created_at=now,
                due_at=now,
                is_active=True,
                algorithm_state_json={},
            )
        )
    await db_session.commit()
    overview = await get_overview(db_session, user_id=user.id, language_code="pt", now=now)
    assert overview.new_items_today == 1
    assert overview.tracked_items_count == 3
