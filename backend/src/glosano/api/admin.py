"""Role-gated instance AI settings; no provider credentials in responses."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from glosano.core.db import SessionDep
from glosano.modules.admin import service
from glosano.modules.identity.models import User


class SecretSafeRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def safe(request: Request) -> Response:
            try:
                response = await handler(request)
            except RequestValidationError:
                # FastAPI's default validation response includes the submitted input.
                response = JSONResponse({"detail": "invalid_settings"}, status_code=422)
            response.headers["Cache-Control"] = "no-store"
            return response

        return safe


async def admin_user(request: Request, session: SessionDep) -> uuid.UUID:
    uid = getattr(request.state, "user_id", None)
    if uid is None:
        raise HTTPException(401)
    user = await session.get(User, uid)
    if user is None:
        raise HTTPException(401)
    if user.role != "admin":
        raise HTTPException(403)
    return user.id


AdminDep = Annotated[uuid.UUID, Depends(admin_user)]
router = APIRouter(prefix="/api/admin/ai", tags=["admin"], route_class=SecretSafeRoute)


@router.get("")
async def get_ai(_admin: AdminDep, session: SessionDep) -> dict[str, object]:
    return await service.view(session)


@router.put("")
async def put_ai(admin: AdminDep, session: SessionDep, body: service.Draft) -> dict[str, object]:
    return await service.save(session, admin, body)


@router.post("/test")
async def test_ai(_admin: AdminDep, session: SessionDep, body: service.Draft) -> dict[str, object]:
    return await service.diagnose(session, body)


@router.post("/models")
async def models(_admin: AdminDep, session: SessionDep, body: service.Draft) -> dict[str, object]:
    return await service.diagnose(session, body, models=True)
