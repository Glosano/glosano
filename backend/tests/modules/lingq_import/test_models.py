"""Vocabulary import job table and the import_source marker on items (FLQ-14.1)."""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.identity.export import USER_TABLES
from glosano.modules.identity.repo import UserRepo
from glosano.modules.lingq_import.models import VocabularyImportJob
from glosano.modules.vocabulary.models import PhraseItem, TokenItem


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
        await s.execute(delete(VocabularyImportJob))
        await s.execute(delete(TokenItem))
        await s.execute(delete(PhraseItem))


def _token(user_id: uuid.UUID, text: str, import_source: str | None) -> TokenItem:
    return TokenItem(
        user_id=user_id,
        language_code="pt",
        token_text=text,
        status="known",
        import_source=import_source,
    )


def _phrase(user_id: uuid.UUID, import_source: str | None) -> PhraseItem:
    return PhraseItem(
        user_id=user_id,
        language_code="pt",
        phrase_text="cada dia",
        display_text="cada dia",
        status="known",
        import_source=import_source,
    )


def _job(user_id: uuid.UUID, status: str) -> VocabularyImportJob:
    return VocabularyImportJob(
        user_id=user_id,
        language_code="pt",
        source="lingq",
        conflict_mode="keep",
        status=status,
    )


async def test_import_source_accepts_lingq_and_null():
    async with session_scope() as s:
        user_id = await _make_user(s)
        s.add_all([_token(user_id, "cada", "lingq"), _token(user_id, "dia", None)])
        s.add(_phrase(user_id, "lingq"))
        await s.flush()
        rows = (
            await s.execute(
                select(TokenItem.token_text, TokenItem.import_source).where(
                    TokenItem.user_id == user_id
                )
            )
        ).all()
        assert {tuple(row) for row in rows} == {("cada", "lingq"), ("dia", None)}
        phrase_source = (
            await s.execute(select(PhraseItem.import_source).where(PhraseItem.user_id == user_id))
        ).scalar_one()
        assert phrase_source == "lingq"


async def test_import_source_rejects_other_values_for_tokens():
    async with session_scope() as s:
        user_id = await _make_user(s)
        s.add(_token(user_id, "cada", "anki"))
        with pytest.raises(IntegrityError, match="ck_token_items_import_source"):
            await s.flush()
        await s.rollback()


async def test_import_source_rejects_other_values_for_phrases():
    async with session_scope() as s:
        user_id = await _make_user(s)
        s.add(_phrase(user_id, "anki"))
        with pytest.raises(IntegrityError, match="ck_phrase_items_import_source"):
            await s.flush()
        await s.rollback()


async def test_only_one_running_job_per_user():
    async with session_scope() as s:
        user_id = await _make_user(s)
        s.add(_job(user_id, "running"))
        await s.flush()
        s.add(_job(user_id, "done"))
        s.add(_job(user_id, "failed"))
        await s.flush()
        s.add(_job(user_id, "running"))
        with pytest.raises(IntegrityError, match="uq_vocabulary_import_jobs_running"):
            await s.flush()
        await s.rollback()


async def test_job_defaults_and_status_check():
    async with session_scope() as s:
        user_id = await _make_user(s)
        job = VocabularyImportJob(
            user_id=user_id, language_code="pt", source="csv", conflict_mode="update"
        )
        s.add(job)
        await s.flush()
        await s.refresh(job)
        assert job.status == "running"
        assert (job.processed, job.created_tokens, job.created_phrases) == (0, 0, 0)
        assert (job.updated_items, job.known_words, job.skipped) == (0, 0, 0)
        assert job.issues_json == []
        assert job.total is None and job.finished_at is None
        assert job.created_at is not None
        s.add(_job(user_id, "paused"))
        with pytest.raises(IntegrityError, match="ck_vocabulary_import_jobs_status"):
            await s.flush()
        await s.rollback()


def test_export_includes_jobs_without_secret_columns():
    _, fields = USER_TABLES["vocabulary_import_jobs"]
    columns = fields.split()
    for secret in ("token", "api_key", "lingq_token"):
        assert secret not in columns
    assert not [column for column in columns if "secret" in column]
    assert "import_source" in USER_TABLES["token_items"][1].split()
    assert "import_source" in USER_TABLES["phrase_items"][1].split()
