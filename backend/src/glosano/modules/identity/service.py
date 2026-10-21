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
    """Set session and CSRF cookies; local HTTP is restricted to loopback hosts."""
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
        secure=settings.secure_cookies,
    )
    return user


async def register_user(
    request: Request,
    response: Response,
    *,
    display_name: str,
    email: str,
    password: str,
    ui_language: str | None = None,
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
            ui_language_code=ui_language or "en",
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
        secure=settings.secure_cookies,
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


def needs_onboarding(user: User) -> bool:
    """Onboarding is incomplete until it was submitted and a native language is set.

    Requires `user.profile` to be loaded.
    """
    return user.onboarded_at is None or user.profile.native_language_code is None


def _native_language_is_learning() -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, "native_language_is_learning")


async def _replace_learning_languages(
    user: User, learning_languages: list[str], session: AsyncSession
) -> None:
    """Atomically make `learning_languages` the user's exact learning set (ADR-0011:
    removing a language never deletes its lessons, vocabulary or statistics)."""
    existing = {row.language_code for row in user.learning_languages}
    await session.execute(
        delete(UserLearningLanguage).where(
            UserLearningLanguage.user_id == user.id,
            UserLearningLanguage.language_code.not_in(learning_languages),
        )
    )
    for code in learning_languages:
        if code not in existing:
            session.add(UserLearningLanguage(user_id=user.id, language_code=code))
    await session.flush()
    await session.refresh(user, ["learning_languages"])


async def complete_onboarding(
    user_id: uuid.UUID,
    *,
    ui_language: str,
    learning_languages: list[str],
    native_language: str | None,
    user_repo: UserRepo,
    session: AsyncSession,
) -> str:
    """Persist onboarding choices and return the redirect target language.

    An explicit native language that is also sent as a learning language is a
    conflict (400). Legacy clients omit `native_language`; for them the resolved
    native (current native, else the UI language) is silently dropped from the
    learning list, and only an empty remainder is a conflict.
    """
    user = await user_repo.get_by_id_full(user_id, for_update=True)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)

    if native_language is not None and native_language in learning_languages:
        raise _native_language_is_learning()
    native = native_language or user.profile.native_language_code or ui_language
    learning = [code for code in learning_languages if code != native]
    if not learning:
        raise _native_language_is_learning()

    user.profile.ui_language_code = ui_language
    user.profile.native_language_code = native
    user.settings.preferred_translation_language_code = native
    user.settings.last_learning_language_code = learning[0]
    await _replace_learning_languages(user, learning, session)

    await user_repo.mark_onboarded(user_id, datetime.now(UTC))
    return learning[0]


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
    native_language: str | None,
    daily_goal_minutes: int,
    daily_goal_reviews: int,
    user_repo: UserRepo,
) -> None:
    user = await user_repo.get_by_id_full(user_id, for_update=True)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    native = native_language or user.profile.native_language_code
    if native in learning_languages:
        raise _native_language_is_learning()
    user.profile.ui_language_code = ui_language
    if native is not None:
        user.profile.native_language_code = native
        user.settings.preferred_translation_language_code = native
    user.settings.daily_goal_minutes = daily_goal_minutes
    user.settings.daily_goal_reviews = daily_goal_reviews
    if user.settings.last_learning_language_code not in learning_languages:
        user.settings.last_learning_language_code = learning_languages[0]
    await _replace_learning_languages(user, learning_languages, user_repo.session)


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
    """Language new translations are made into: the user's native language (ADR-0030)."""
    profile = await session.get(UserProfile, user_id)
    if profile is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    if profile.native_language_code is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "native_language_required")
    return profile.native_language_code


async def ui_language(session: AsyncSession, user_id: uuid.UUID) -> str:
    """Interface language: explanations, feedback and grammar labels stay in it."""
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
    if language_code == user.profile.native_language_code:
        raise _native_language_is_learning()
    if language_code not in {row.language_code for row in user.learning_languages}:
        user.learning_languages.append(
            UserLearningLanguage(user_id=user_id, language_code=language_code)
        )
    user.settings.last_learning_language_code = language_code
    await user_repo.session.flush()
