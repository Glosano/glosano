"""Identity service layer: register/login/logout/onboarding/account deletion."""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.config import get_settings
from glosano.core.rate_limit import RateLimiter
from glosano.core.security import (
    generate_csrf_token,
    generate_session_token,
    hash_password,
    verify_password,
)
from glosano.modules.identity.middleware import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    SESSION_TTL,
)
from glosano.modules.identity.models import User, UserLearningLanguage, UserProfile, UserSession
from glosano.modules.identity.repo import SessionRepo, UserRepo


def _hash_ip(ip: str | None) -> str | None:
    if not ip:
        return None
    return hashlib.sha256(ip.encode()).hexdigest()[:64]


def _set_session_cookies(
    response: Response,
    *,
    session_token: str,
    csrf_token: str,
    persistent: bool,
    secure: bool,
) -> None:
    """Set both session and CSRF cookies. `secure=False` only for dev/test over HTTP."""
    max_age = int(SESSION_TTL.total_seconds()) if persistent else None
    response.set_cookie(
        SESSION_COOKIE,
        session_token,
        max_age=max_age,
        httponly=True,
        secure=secure,
        samesite="lax",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=secure,
        samesite="lax",
    )


async def login_user(
    request: Request,
    response: Response,
    *,
    email: str,
    password: str,
    remember_me: bool,
    user_repo: UserRepo,
    session_repo: SessionRepo,
    rate_limiter: RateLimiter,
) -> User:
    settings = get_settings()
    ip = request.client.host if request.client else "unknown"
    rl_key = f"login:{ip}:{email.lower().strip()}"

    if not await rate_limiter.check_and_increment(rl_key):
        retry_after = await rate_limiter.get_retry_after(rl_key)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many attempts. Retry in {max(retry_after // 60, 1)} min",
            headers={"Retry-After": str(retry_after)},
        )

    # Serialize verification + session creation with password changes. Otherwise a
    # login paused after checking an old password could survive session revocation.
    user = await user_repo.get_by_email(email, for_update=True)
    if user is None or not verify_password(password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    await rate_limiter.reset(rl_key)

    token = generate_session_token()
    csrf = generate_csrf_token()
    await session_repo.create(
        token=token,
        user_id=user.id,
        expires_at=datetime.now(UTC) + SESSION_TTL,
        user_agent=request.headers.get("user-agent"),
        ip_hash=_hash_ip(ip if ip != "unknown" else None),
    )
    _set_session_cookies(
        response,
        session_token=token,
        csrf_token=csrf,
        persistent=remember_me,
        secure=settings.is_prod,
    )
    return user


async def register_user(
    request: Request,
    response: Response,
    *,
    display_name: str,
    email: str,
    password: str,
    user_repo: UserRepo,
    session_repo: SessionRepo,
) -> User:
    settings = get_settings()
    if not settings.allow_public_registration:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Registration is disabled")

    role = (
        "admin"
        if settings.initial_admin_email and email.lower() == settings.initial_admin_email.lower()
        else "learner"
    )

    try:
        user = await user_repo.create(
            email=email,
            password_hash=hash_password(password),
            display_name=display_name,
            role=role,
        )
    except IntegrityError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already in use") from e

    token = generate_session_token()
    csrf = generate_csrf_token()
    await session_repo.create(
        token=token,
        user_id=user.id,
        expires_at=datetime.now(UTC) + SESSION_TTL,
        user_agent=request.headers.get("user-agent"),
        ip_hash=_hash_ip(request.client.host if request.client else None),
    )
    _set_session_cookies(
        response,
        session_token=token,
        csrf_token=csrf,
        persistent=True,
        secure=settings.is_prod,
    )
    return user


async def delete_me(
    user_id: uuid.UUID,
    *,
    password: str,
    user_repo: UserRepo,
) -> None:
    """Verify password then hard-delete the user (cascade removes everything)."""
    user = await user_repo.get_by_id(user_id)
    if user is None or not verify_password(password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid password")
    await user_repo.hard_delete(user_id)


async def set_last_language(
    user_id: uuid.UUID,
    *,
    language_code: str,
    user_repo: UserRepo,
) -> None:
    """Update user_settings.last_learning_language_code."""
    user = await user_repo.get_by_id_full(user_id, for_update=True)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    if language_code not in {ll.language_code for ll in user.learning_languages}:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Language is not in your learning languages",
        )
    user.settings.last_learning_language_code = language_code


async def complete_onboarding(
    user_id: uuid.UUID,
    *,
    ui_language: str,
    learning_languages: list[str],
    translation_language: str | None,
    user_repo: UserRepo,
    session: AsyncSession,
) -> str:
    """Persist onboarding choices and return the redirect target language."""
    user = await user_repo.get_by_id_full(user_id, for_update=True)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)

    user.profile.ui_language_code = ui_language
    user.settings.preferred_translation_language_code = ui_language
    user.settings.last_learning_language_code = learning_languages[0]

    existing = {ll.language_code for ll in user.learning_languages}
    for code in learning_languages:
        if code not in existing:
            session.add(UserLearningLanguage(user_id=user_id, language_code=code))

    await user_repo.mark_onboarded(user_id, datetime.now(UTC))
    return learning_languages[0]


async def update_profile(user_id: uuid.UUID, *, display_name: str, user_repo: UserRepo) -> None:
    user = await user_repo.get_by_id_full(user_id, for_update=True)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    user.profile.display_name = display_name


async def update_preferences(
    user_id: uuid.UUID,
    *,
    ui_language: str,
    learning_languages: list[str],
    daily_goal_minutes: int,
    daily_goal_reviews: int,
    user_repo: UserRepo,
) -> None:
    user = await user_repo.get_by_id_full(user_id, for_update=True)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    user.profile.ui_language_code = ui_language
    user.settings.preferred_translation_language_code = ui_language
    user.settings.daily_goal_minutes = daily_goal_minutes
    user.settings.daily_goal_reviews = daily_goal_reviews
    if user.settings.last_learning_language_code not in learning_languages:
        user.settings.last_learning_language_code = learning_languages[0]
    existing = {row.language_code for row in user.learning_languages}
    await user_repo.session.execute(
        delete(UserLearningLanguage).where(
            UserLearningLanguage.user_id == user_id,
            UserLearningLanguage.language_code.not_in(learning_languages),
        )
    )
    for code in learning_languages:
        if code not in existing:
            user_repo.session.add(UserLearningLanguage(user_id=user_id, language_code=code))
    await user_repo.session.flush()
    await user_repo.session.refresh(user, ["learning_languages"])


async def change_password(
    user_id: uuid.UUID,
    *,
    current_password: str,
    new_password: str,
    current_session_token: str,
    user_repo: UserRepo,
) -> None:
    # Serialize password changes so two concurrent requests cannot retain stale credentials.
    user = (
        await user_repo.session.execute(select(User).where(User.id == user_id).with_for_update())
    ).scalar_one_or_none()
    if user is None or not verify_password(current_password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid password")
    user.password_hash = hash_password(new_password)
    await user_repo.session.execute(
        delete(UserSession).where(
            UserSession.user_id == user_id,
            UserSession.id != current_session_token,
        )
    )


async def translation_target(session: AsyncSession, user_id: uuid.UUID) -> str:
    profile = await session.get(UserProfile, user_id)
    if profile is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    return profile.ui_language_code


async def add_learning_language(
    user_id: uuid.UUID,
    *,
    language_code: str,
    user_repo: UserRepo,
) -> None:
    """Append and select a language in one serialized, idempotent transaction."""
    user = await user_repo.get_by_id_full(user_id, for_update=True)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    if language_code not in {row.language_code for row in user.learning_languages}:
        user.learning_languages.append(
            UserLearningLanguage(user_id=user_id, language_code=language_code)
        )
    user.settings.last_learning_language_code = language_code
    await user_repo.session.flush()
