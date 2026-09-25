"""User profile endpoints: GET /me, POST /me/onboarding, DELETE /me, PATCH /me/last-language."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.config import get_settings
from glosano.core.db import get_session
from glosano.modules.identity import service
from glosano.modules.identity.export import export_user_data
from glosano.modules.identity.middleware import CSRF_COOKIE, SESSION_COOKIE
from glosano.modules.identity.repo import UserRepo
from glosano.modules.identity.schemas import (
    AddLearningLanguageRequest,
    ChangePasswordRequest,
    DeleteMeRequest,
    MeResponse,
    OnboardingRequest,
    SetLastLanguageRequest,
    UpdatePreferencesRequest,
    UpdateProfileRequest,
)

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=MeResponse)
async def get_me(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> MeResponse:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    user = await UserRepo(session).get_by_id_full(user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    return MeResponse(
        ai_enabled=get_settings().llm_enabled,
        id=user.id,
        email=user.email,
        role=user.role,
        display_name=user.profile.display_name,
        ui_language_code=user.profile.ui_language_code,
        preferred_translation_language_code=user.profile.ui_language_code,
        daily_goal_minutes=user.settings.daily_goal_minutes,
        daily_goal_reviews=user.settings.daily_goal_reviews,
        learning_languages=[ll.language_code for ll in user.learning_languages],
        last_learning_language_code=user.settings.last_learning_language_code,
        needs_onboarding=user.onboarded_at is None,
        onboarded_at=user.onboarded_at,
    )


@router.post("/onboarding")
async def post_onboarding(
    body: OnboardingRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    first_lang = await service.complete_onboarding(
        user_id,
        ui_language=body.ui_language,
        learning_languages=body.learning_languages,
        translation_language=body.translation_language,
        user_repo=UserRepo(session),
        session=session,
    )
    return {"ok": True, "redirect": f"/learn/{first_lang}/library"}


@router.delete("")
async def delete_me(
    body: DeleteMeRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    await service.delete_me(user_id, password=body.password, user_repo=UserRepo(session))
    response.delete_cookie(SESSION_COOKIE)
    response.delete_cookie(CSRF_COOKIE)
    return {"ok": True}


@router.patch("/last-language")
async def patch_last_language(
    body: SetLastLanguageRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    await service.set_last_language(
        user_id, language_code=body.language_code, user_repo=UserRepo(session)
    )
    return {"ok": True}


@router.patch("/profile", response_model=MeResponse)
async def patch_profile(
    body: UpdateProfileRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> MeResponse:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    await service.update_profile(
        user_id, display_name=body.display_name, user_repo=UserRepo(session)
    )
    return await get_me(request, session)


@router.patch("/preferences", response_model=MeResponse)
async def patch_preferences(
    body: UpdatePreferencesRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> MeResponse:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    await service.update_preferences(user_id, **body.model_dump(), user_repo=UserRepo(session))
    return await get_me(request, session)


@router.post("/password")
async def post_password(
    body: ChangePasswordRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    await service.change_password(
        user_id,
        **body.model_dump(),
        current_session_token=request.state.session_token,
        user_repo=UserRepo(session),
    )
    return {"ok": True}


@router.get("/export")
async def get_export(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None or await UserRepo(session).get_by_id(user_id) is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    return JSONResponse(
        await export_user_data(session, user_id),
        headers={
            "Content-Disposition": 'attachment; filename="glosano-data.json"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/learning-languages", response_model=MeResponse)
async def post_learning_language(
    body: AddLearningLanguageRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> MeResponse:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    await service.add_learning_language(
        user_id, language_code=body.language_code, user_repo=UserRepo(session)
    )
    return await get_me(request, session)
