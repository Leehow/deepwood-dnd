from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, exists, text
from sqlalchemy.exc import IntegrityError

import sys
from app.db.session import get_db, Base
from sqlalchemy import Table, Column, Integer

# Minimal stub only during pytest to satisfy FK resolution without importing Campaign model
if "pytest" in sys.modules and "campaigns" not in Base.metadata.tables:
    Table("campaigns", Base.metadata, Column("id", Integer, primary_key=True))
from app.models.campaign_storage import CampaignStorage
from app.models.campaign_storage_acl import CampaignStorageACL

from app.schemas.campaign_storage import (
    CampaignStorageCreate,
    CampaignStorageUpdate,
    CampaignStorageResponse,
    ACLModifyRequest,
)
from app.services.realtime_publisher import realtime_publisher
from app.services.runtime_schema_service import normalize_campaign_storage_data
from app.services.combat_turn_trigger_hooks import (
    dispatch_combat_turn_triggers_if_changed,
    extract_combat_turn_state as _extract_combat_turn_state,
    combat_session_active as _combat_session_active,
    is_canonical_combat_object,
)
from app.core.dependencies import resolve_campaign_member_context
from app.core.security import require_auth

import logging

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/campaigns", tags=["Campaign Storage"])


class _CampaignRow:
    def __init__(self, dm_user_id: str):
        self.dm_user_id = dm_user_id


def _build_storage_response(storage: CampaignStorage) -> CampaignStorageResponse:
    return CampaignStorageResponse.model_validate(
        {
            "id": storage.id,
            "campaign_id": storage.campaign_id,
            "object_type": storage.object_type,
            "object_id": storage.object_id,
            "object_name": storage.object_name,
            "category": storage.category,
            "tags": storage.tags,
            "data": normalize_campaign_storage_data(
                object_type=storage.object_type,
                data=storage.data,
                strict=False,
            ),
            "source": storage.source,
            "source_id": storage.source_id,
            "visibility": storage.visibility,
            "is_active": storage.is_active,
            "version": storage.version,
            "created_at": storage.created_at,
            "updated_at": storage.updated_at,
            "created_by": storage.created_by,
            "updated_by": storage.updated_by,
        }
    )


async def _get_campaign_or_404(db: AsyncSession, campaign_id: int) -> _CampaignRow:
    res = await db.execute(text("SELECT dm_user_id FROM campaigns WHERE id = :cid"), {"cid": campaign_id})
    row = res.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return _CampaignRow(dm_user_id=row[0])


@router.post("/{campaign_id}/storage", response_model=CampaignStorageResponse)
async def create_storage_object(
    campaign_id: int,
    payload: CampaignStorageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    # Ensure campaign exists
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    normalized_data = normalize_campaign_storage_data(
        object_type=payload.object_type,
        data=payload.data,
        strict=True,
    )

    storage = CampaignStorage(
        campaign_id=campaign_id,
        object_type=payload.object_type,
        object_id=payload.object_id,
        object_name=payload.object_name,
        category=payload.category,
        tags=payload.tags,
        data=normalized_data,
        visibility=payload.visibility or "dm_only",
        source=payload.source or "custom",
        source_id=payload.source_id,
        created_by=payload.created_by,
    )

    db.add(storage)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Object already exists")

    await db.refresh(storage)
    c = _build_storage_response(storage)
    await realtime_publisher.publish_storage_event(
        campaign_id,
        event_type="storage_created",
        storage_object=c.model_dump(mode="json"),
    )

    return c


@router.get("/{campaign_id}/storage", response_model=List[CampaignStorageResponse])
async def list_storage_objects(
    campaign_id: int,
    object_type: Optional[str] = None,
    category: Optional[str] = None,
    tags: Optional[List[str]] = Query(default=None),
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)

    stmt = select(CampaignStorage).where(CampaignStorage.campaign_id == campaign_id)

    if not include_inactive:
        stmt = stmt.where(CampaignStorage.is_active.is_(True))
    if object_type:
        stmt = stmt.where(CampaignStorage.object_type == object_type)
    if category:
        stmt = stmt.where(CampaignStorage.category == category)
    if tags:
        # tags contains all[] (Postgres @>)
        stmt = stmt.where(CampaignStorage.tags.contains(tags))

    # Visibility filtering when user_id provided and not DM
    if not context.is_dm:
        acl_exists = exists().where(
            and_(
                CampaignStorageACL.storage_id == CampaignStorage.id,
                CampaignStorageACL.user_id == context.user_id,
            )
        )
        stmt = stmt.where(
            or_(
                CampaignStorage.visibility == "all_players",
                and_(CampaignStorage.visibility == "specific_players", acl_exists),
            )
        )

    res = await db.execute(stmt)
    return [_build_storage_response(obj) for obj in res.scalars().all()]


@router.get("/{campaign_id}/storage/{object_type}/{object_id}", response_model=Optional[CampaignStorageResponse])
async def get_storage_object(
    campaign_id: int,
    object_type: str,
    object_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)

    res = await db.execute(
        select(CampaignStorage).where(
            and_(
                CampaignStorage.campaign_id == campaign_id,
                CampaignStorage.object_type == object_type,
                CampaignStorage.object_id == object_id,
            )
        )
    )
    obj = res.scalar_one_or_none()
    if not obj:
        return None

    # Enforce visibility if not DM
    if not context.is_dm:
        if obj.visibility == "dm_only":
            raise HTTPException(status_code=403, detail="Forbidden")
        if obj.visibility == "specific_players":
            acl_res = await db.execute(
                select(CampaignStorageACL.id).where(
                    and_(
                        CampaignStorageACL.storage_id == obj.id,
                        CampaignStorageACL.user_id == context.user_id,
                    )
                )
            )
            if not acl_res.scalar_one_or_none():
                raise HTTPException(status_code=403, detail="Forbidden")

    return _build_storage_response(obj)


@router.put("/{campaign_id}/storage/{object_type}/{object_id}", response_model=CampaignStorageResponse)
async def update_storage_object(
    campaign_id: int,
    object_type: str,
    object_id: str,
    payload: CampaignStorageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    if not context.is_dm:
        raise HTTPException(status_code=403, detail="Forbidden")

    res = await db.execute(
        select(CampaignStorage).where(
            and_(
                CampaignStorage.campaign_id == campaign_id,
                CampaignStorage.object_type == object_type,
                CampaignStorage.object_id == object_id,
            )
        )
    )
    obj = res.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    # OCC compare
    if obj.version != payload.version:
        raise HTTPException(status_code=409, detail={
            "message": "Version conflict",
            "current_version": obj.version,
        })

    # Snapshot pre-update combat data so we can fire runtime turn triggers
    # after the commit when the canonical active combat object changes its
    # active token (or round). Non-canonical combat rows (archived snapshots,
    # alternate ids) intentionally do NOT dispatch triggers.
    is_canonical_combat = is_canonical_combat_object(obj.object_type, obj.object_id)
    prev_data_snapshot: Optional[dict] = None
    prev_is_active_snapshot = False
    if is_canonical_combat:
        prev_data_snapshot = dict(obj.data) if isinstance(obj.data, dict) else None
        prev_is_active_snapshot = bool(obj.is_active)

    if payload.object_name is not None:
        obj.object_name = payload.object_name
    if payload.category is not None:
        obj.category = payload.category
    if payload.tags is not None:
        obj.tags = payload.tags
    if payload.data is not None:
        obj.data = normalize_campaign_storage_data(
            object_type=obj.object_type,
            data=payload.data,
            strict=True,
        )
    if payload.visibility is not None:
        obj.visibility = payload.visibility
    if payload.source_id is not None:
        obj.source_id = payload.source_id
    if payload.is_active is not None:
        obj.is_active = payload.is_active

    obj.version = obj.version + 1
    obj.updated_by = payload.updated_by

    await db.commit()
    await db.refresh(obj)
    c = _build_storage_response(obj)

    if is_canonical_combat:
        await dispatch_combat_turn_triggers_if_changed(
            db,
            campaign_id=campaign_id,
            prev_data=prev_data_snapshot,
            prev_is_active=prev_is_active_snapshot,
            new_data=obj.data if isinstance(obj.data, dict) else None,
            new_is_active=bool(obj.is_active),
        )

    await realtime_publisher.publish_storage_event(
        campaign_id,
        event_type="storage_updated",
        storage_object=c.model_dump(mode="json"),
    )

    return c


@router.delete("/{campaign_id}/storage/{object_type}/{object_id}")
async def soft_delete_storage_object(
    campaign_id: int,
    object_type: str,
    object_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    if not context.is_dm:
        raise HTTPException(status_code=403, detail="Forbidden")

    res = await db.execute(
        select(CampaignStorage).where(
            and_(
                CampaignStorage.campaign_id == campaign_id,
                CampaignStorage.object_type == object_type,
                CampaignStorage.object_id == object_id,
            )
        )
    )
    obj = res.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    obj.is_active = False
    obj.version = obj.version + 1

    await db.commit()
    await realtime_publisher.publish_storage_event(
        campaign_id,
        event_type="storage_deleted",
        object_type=obj.object_type,
        object_id=obj.object_id,
    )
    return {"success": True}



@router.get("/{campaign_id}/storage/{object_type}/{object_id}/acl", response_model=List[str])
async def list_storage_acl(
    campaign_id: int,
    object_type: str,
    object_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    if not context.is_dm:
        raise HTTPException(status_code=403, detail="Forbidden")

    res = await db.execute(
        select(CampaignStorage).where(
            and_(
                CampaignStorage.campaign_id == campaign_id,
                CampaignStorage.object_type == object_type,
                CampaignStorage.object_id == object_id,
            )
        )
    )
    obj = res.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    rows = await db.execute(
        select(CampaignStorageACL.user_id).where(CampaignStorageACL.storage_id == obj.id)
    )
    return [r[0] for r in rows.all()]


@router.post("/{campaign_id}/storage/{object_type}/{object_id}/acl", response_model=List[str])
async def add_storage_acl(
    campaign_id: int,
    object_type: str,
    object_id: str,
    body: ACLModifyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    if not context.is_dm:
        raise HTTPException(status_code=403, detail="Forbidden")

    res = await db.execute(
        select(CampaignStorage).where(
            and_(
                CampaignStorage.campaign_id == campaign_id,
                CampaignStorage.object_type == object_type,
                CampaignStorage.object_id == object_id,
            )
        )
    )
    obj = res.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    # Insert ACL, ignore duplicates
    try:
        acl = CampaignStorageACL(storage_id=obj.id, user_id=body.target_user_id)
        db.add(acl)
        await db.commit()
    except IntegrityError:
        await db.rollback()

    # Broadcast ACL update
    rows = await db.execute(
        select(CampaignStorageACL.user_id).where(CampaignStorageACL.storage_id == obj.id)
    )
    users = [r[0] for r in rows.all()]
    await realtime_publisher.publish_storage_acl_updated(
        campaign_id,
        object_type=object_type,
        object_id=object_id,
        users=users,
    )
    return users


@router.delete("/{campaign_id}/storage/{object_type}/{object_id}/acl/{target_user_id}", response_model=List[str])
async def remove_storage_acl(
    campaign_id: int,
    object_type: str,
    object_id: str,
    target_user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    if not context.is_dm:
        raise HTTPException(status_code=403, detail="Forbidden")

    res = await db.execute(
        select(CampaignStorage).where(
            and_(
                CampaignStorage.campaign_id == campaign_id,
                CampaignStorage.object_type == object_type,
                CampaignStorage.object_id == object_id,
            )
        )
    )
    obj = res.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    await db.execute(
        text(
            "DELETE FROM campaign_storage_acl WHERE storage_id = :sid AND user_id = :uid"
        ),
        {"sid": obj.id, "uid": target_user_id},
    )
    await db.commit()

    rows = await db.execute(
        select(CampaignStorageACL.user_id).where(CampaignStorageACL.storage_id == obj.id)
    )
    users = [r[0] for r in rows.all()]
    await realtime_publisher.publish_storage_acl_updated(
        campaign_id,
        object_type=object_type,
        object_id=object_id,
        users=users,
    )
    return users
