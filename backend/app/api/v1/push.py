"""Web Push subscription management — stored in PostgreSQL."""
from fastapi import APIRouter, Depends
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.push import PushSubscription

router = APIRouter(prefix="/push", tags=["Push"])


class _Keys(BaseModel):
    p256dh: str
    auth: str


class PushSubCreate(BaseModel):
    endpoint: str
    keys: _Keys
    pages: list[str] = []


class PushSubPatch(BaseModel):
    endpoint: str
    pages: list[str] = []


class PushSubDelete(BaseModel):
    endpoint: str


@router.post("", response_class=ORJSONResponse)
async def save_subscription(
    req: PushSubCreate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    stmt = (
        insert(PushSubscription)
        .values(
            endpoint=req.endpoint,
            p256dh=req.keys.p256dh,
            auth=req.keys.auth,
            pages=req.pages,
        )
        .on_conflict_do_update(
            index_elements=["endpoint"],
            set_={
                "p256dh": req.keys.p256dh,
                "auth": req.keys.auth,
                "pages": req.pages,
            },
        )
    )
    await db.execute(stmt)
    await db.commit()
    return {"ok": True}


@router.patch("", response_class=ORJSONResponse)
async def update_subscription(
    req: PushSubPatch,
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(PushSubscription).where(PushSubscription.endpoint == req.endpoint)
    sub = (await db.execute(q)).scalar_one_or_none()
    if sub:
        sub.pages = req.pages
        await db.commit()
    return {"ok": True}


@router.delete("", response_class=ORJSONResponse)
async def delete_subscription(
    req: PushSubDelete,
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(PushSubscription).where(PushSubscription.endpoint == req.endpoint)
    sub = (await db.execute(q)).scalar_one_or_none()
    if sub:
        await db.delete(sub)
        await db.commit()
    return {"ok": True}


@router.get("", response_class=ORJSONResponse)
async def list_subscriptions(db: AsyncSession = Depends(get_db)) -> list[dict]:
    rows = (await db.execute(select(PushSubscription))).scalars().all()
    return [
        {"endpoint": r.endpoint, "p256dh": r.p256dh, "auth": r.auth, "pages": r.pages}
        for r in rows
    ]
