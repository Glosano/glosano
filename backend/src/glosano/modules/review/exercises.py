# ruff: noqa: RUF003 -- Cyrillic comments/docstrings contain Latin-confusable letters
"""AI-генерация упражнений тренажёра (FLQ-20). Session-first module functions.

Паттерн FLQ-3: kill-switch AIDisabled -> провайдер -> extract_json (+1 ретрай)
-> audit write_audit (best-effort, сырой текст не логируется — ADR-0003).
"""

from __future__ import annotations

import hashlib
import random
import time
import uuid
from dataclasses import dataclass
from datetime import datetime

from loguru import logger
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.config import get_settings
from glosano.modules.ai_translation.provider import (
    LLMCompletion,
    LLMProvider,
    OpenAICompatibleProvider,
)
from glosano.modules.ai_translation.service import AIDisabled, write_audit
from glosano.modules.identity.models import UserProfile
from glosano.modules.review import exercise_prompts as ep
from glosano.modules.review.models import ReviewItem
from glosano.modules.review.service import VOCAB_MODEL_BY_KIND, ReviewItemNotFound
from glosano.modules.vocabulary.models import PersonalNote, PersonalTranslation, TokenItem


class ExerciseParseError(Exception):
    """Провайдер ответил, но валидного JSON нет и после ретрая."""


@dataclass(frozen=True)
class ExerciseResult:
    payload: dict  # type: ignore[type-arg]
    model: str
    latency_ms: int


@dataclass(frozen=True)
class _ItemContext:
    word: str
    translation: str | None
    notes: str | None
    learn_lang: str
    target_lang: str


async def _load_context(
    session: AsyncSession, *, user_id: uuid.UUID, review_item_id: uuid.UUID
) -> _ItemContext:
    ri = await session.get(ReviewItem, review_item_id)
    if ri is None or ri.user_id != user_id or not ri.is_active:
        raise ReviewItemNotFound(str(review_item_id))
    item = await session.get(VOCAB_MODEL_BY_KIND[ri.item_kind], ri.item_id)
    if item is None or item.user_id != user_id:
        raise ReviewItemNotFound(str(review_item_id))
    profile = await session.get(UserProfile, user_id)
    target = profile.ui_language_code if profile is not None else "en"
    key = (ri.item_kind, ri.item_id)
    translation_row = (
        (
            await session.execute(
                select(PersonalTranslation).where(
                    PersonalTranslation.owner_user_id == user_id,
                    PersonalTranslation.is_primary.is_(True),
                    PersonalTranslation.target_language_code == target,
                    tuple_(PersonalTranslation.item_kind, PersonalTranslation.item_id).in_([key]),
                )
            )
        )
        .scalars()
        .first()
    )
    note_row = (
        (
            await session.execute(
                select(PersonalNote).where(
                    PersonalNote.owner_user_id == user_id,
                    tuple_(PersonalNote.item_kind, PersonalNote.item_id).in_([key]),
                )
            )
        )
        .scalars()
        .first()
    )
    word = item.token_text if isinstance(item, TokenItem) else item.display_text
    return _ItemContext(
        word=word,
        translation=translation_row.translation_text if translation_row else None,
        notes=note_row.note_text if note_row else None,
        learn_lang=ri.language_code,
        target_lang=target,
    )


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def _call_llm(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: str,
    user_prompt: str,
    subject_text: str,
    provider: LLMProvider | None,
) -> ExerciseResult:
    """Общий путь: kill-switch -> провайдер -> parse+validate (+1 ретрай) -> audit."""
    settings = get_settings()
    if not settings.llm_enabled:
        raise AIDisabled
    provider = provider or OpenAICompatibleProvider(settings)
    max_tokens = ep.MAX_TOKENS_BY_KIND[kind]
    prompt_hash = _sha256(ep.SYSTEM_PROMPT + "\n" + user_prompt)
    subject_hash = _sha256(subject_text)
    request_id = uuid.uuid4()
    started = time.monotonic()

    async def _audit(
        success: bool, error_code: str | None, completion: LLMCompletion | None = None
    ) -> None:
        await write_audit(
            session,
            request_id=request_id,
            user_id=user_id,
            lesson_id=None,
            settings=settings,
            prompt_hash=prompt_hash,
            selected_text_hash=subject_hash,
            started=started,
            success=success,
            error_code=error_code,
            input_tokens=completion.input_tokens if completion else None,
            output_tokens=completion.output_tokens if completion else None,
        )

    last_error: Exception | None = None
    completion: LLMCompletion | None = None
    for attempt in range(2):  # исходный вызов + один ретрай на плохой JSON
        try:
            completion = await provider.complete(
                system=ep.SYSTEM_PROMPT, user=user_prompt, max_tokens=max_tokens
            )
        except Exception as exc:  # ProviderUnavailable/Rejected — наружу с аудитом
            await _audit(False, type(exc).__name__.lower())
            raise
        try:
            payload = ep.extract_json(completion.text)
            ep.validate_payload(kind, payload)
        except ValueError as exc:
            last_error = exc
            logger.warning("exercise parse failed (kind={}, attempt={}/2)", kind, attempt + 1)
            continue
        await _audit(True, None, completion)
        return ExerciseResult(
            payload=payload,
            model=settings.llm_model,
            latency_ms=int((time.monotonic() - started) * 1000),
        )
    await _audit(False, "exercise_parse_error", completion)
    raise ExerciseParseError(str(last_error))


async def generate_exercise(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: str,
    review_item_id: uuid.UUID | None = None,
    review_item_ids: list[uuid.UUID] | None = None,
    provider: LLMProvider | None = None,
    now: datetime | None = None,
) -> ExerciseResult:
    if kind == "writing":
        assert review_item_ids  # непустой список валидируется на API-слое
        pairs: list[tuple[str, str | None]] = []
        learn_lang = target_lang = None
        for rid in review_item_ids:
            ctx = await _load_context(session, user_id=user_id, review_item_id=rid)
            pairs.append((ctx.word, ctx.translation))
            learn_lang, target_lang = ctx.learn_lang, ctx.target_lang
        assert learn_lang is not None and target_lang is not None
        prompt = ep.build_writing_prompt(
            pairs=pairs, learn_lang=learn_lang, target_lang=target_lang
        )
        subject = ",".join(w for w, _ in pairs)
    else:
        assert review_item_id is not None  # валидируется на API-слое
        ctx = await _load_context(session, user_id=user_id, review_item_id=review_item_id)
        builders = {
            "example": ep.build_example_prompt,
            "cloze": ep.build_cloze_prompt,
            "reverse": ep.build_reverse_prompt,
            "translation_task": ep.build_translation_task_prompt,
        }
        prompt = builders[kind](
            word=ctx.word,
            translation=ctx.translation,
            notes=ctx.notes,
            learn_lang=ctx.learn_lang,
            target_lang=ctx.target_lang,
        )
        subject = ctx.word
    result = await _call_llm(
        session,
        user_id=user_id,
        kind=kind,
        user_prompt=prompt,
        subject_text=subject,
        provider=provider,
    )
    if kind in ("cloze", "reverse"):
        options = list(result.payload["options"])
        random.shuffle(options)  # порядок вариантов не должен выдавать ответ
        return ExerciseResult(
            payload={**result.payload, "options": options},
            model=result.model,
            latency_ms=result.latency_ms,
        )
    return result


async def translation_feedback(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    review_item_id: uuid.UUID,
    sentence_translation: str,
    user_text: str,
    provider: LLMProvider | None = None,
) -> ExerciseResult:
    ctx = await _load_context(session, user_id=user_id, review_item_id=review_item_id)
    prompt = ep.build_feedback_prompt(
        word=ctx.word,
        sentence_translation=sentence_translation,
        user_text=user_text,
        learn_lang=ctx.learn_lang,
        target_lang=ctx.target_lang,
    )
    return await _call_llm(
        session,
        user_id=user_id,
        kind="feedback",
        user_prompt=prompt,
        subject_text=ctx.word,
        provider=provider,
    )
