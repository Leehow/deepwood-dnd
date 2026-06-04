"""
Ruler API routes for distance measurement on battle maps
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List

from app.db.session import get_db, get_db_readonly
from app.models.ruler import Ruler
from app.schemas.ruler import RulerCreate, RulerResponse
from app.core.security import require_auth
from app.utils.permission_checks import check_campaign_member

router = APIRouter(prefix="/api/campaigns", tags=["rulers"])


@router.get("/{campaign_id}/rulers")
async def get_rulers(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db_readonly)
) -> List[RulerResponse]:
    """Get all rulers for a specific map"""
    try:
        result = await db.execute(
            select(Ruler).where(
                (Ruler.campaign_id == campaign_id) &
                (Ruler.map_url == map_url)
            )
        )
        rulers = result.scalars().all()
        return [RulerResponse.model_validate(ruler) for ruler in rulers]
    except Exception as e:
        print(f"[Ruler] Error getting rulers: {e}")
        raise HTTPException(status_code=500, detail="Failed to get rulers")


@router.post("/{campaign_id}/rulers")
async def create_ruler(
    campaign_id: int,
    ruler: RulerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> RulerResponse:
    """Create a new ruler"""
    await check_campaign_member(campaign_id, current_user, db)
    try:
        new_ruler = Ruler(
            campaign_id=campaign_id,
            map_url=ruler.map_url,
            start_x=ruler.start_x,
            start_y=ruler.start_y,
            end_x=ruler.end_x,
            end_y=ruler.end_y,
            distance=ruler.distance,
            color=ruler.color,
            ruler_type=ruler.ruler_type
        )
        db.add(new_ruler)
        await db.commit()
        await db.refresh(new_ruler)

        print(f"[Ruler] Created ruler {new_ruler.id} for campaign {campaign_id}")
        return RulerResponse.model_validate(new_ruler)
    except Exception as e:
        await db.rollback()
        print(f"[Ruler] Error creating ruler: {e}")
        raise HTTPException(status_code=500, detail="Failed to create ruler")


@router.delete("/{campaign_id}/rulers/{ruler_id}")
async def delete_ruler(
    campaign_id: int,
    ruler_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> dict:
    """Delete a ruler"""
    await check_campaign_member(campaign_id, current_user, db)
    try:
        result = await db.execute(
            select(Ruler).where(
                (Ruler.id == ruler_id) &
                (Ruler.campaign_id == campaign_id)
            )
        )
        ruler = result.scalar_one_or_none()

        if not ruler:
            raise HTTPException(status_code=404, detail="Ruler not found")

        await db.delete(ruler)
        await db.commit()

        print(f"[Ruler] Deleted ruler {ruler_id} from campaign {campaign_id}")
        return {"status": "success", "message": "Ruler deleted"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        print(f"[Ruler] Error deleting ruler: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete ruler")


@router.delete("/{campaign_id}/rulers")
async def clear_all_rulers(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> dict:
    """Clear all rulers for a specific map"""
    await check_campaign_member(campaign_id, current_user, db)
    try:
        await db.execute(
            delete(Ruler).where(
                (Ruler.campaign_id == campaign_id) &
                (Ruler.map_url == map_url)
            )
        )
        await db.commit()

        print(f"[Ruler] Cleared all rulers for campaign {campaign_id}, map {map_url}")
        return {"status": "success", "message": "All rulers cleared"}
    except Exception as e:
        await db.rollback()
        print(f"[Ruler] Error clearing rulers: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear rulers")
