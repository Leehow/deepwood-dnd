"""
Drawing API routes for rulers, circles, sketches, and arrows on battle maps
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List, Optional

from app.db.session import get_db, get_db_readonly
from app.models.drawing import Drawing, DrawingType
from app.schemas.drawing import (
    DrawingResponse, RulerCreate, CircleCreate, SketchCreate, ArrowCreate, DrawingUpdate
)
from app.core.security import require_auth
from app.utils.permission_checks import check_campaign_member

router = APIRouter(prefix="/api/campaigns", tags=["drawings"])


@router.get("/{campaign_id}/drawings")
async def get_drawings(
    campaign_id: int,
    map_url: str = Query(...),
    drawing_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db_readonly)
) -> List[DrawingResponse]:
    """Get all drawings for a specific map, optionally filtered by type"""
    try:
        query = select(Drawing).where(
            (Drawing.campaign_id == campaign_id) &
            (Drawing.map_url == map_url)
        )

        if drawing_type:
            query = query.where(Drawing.type == drawing_type)

        result = await db.execute(query)
        drawings = result.scalars().all()
        return [DrawingResponse.model_validate(drawing) for drawing in drawings]
    except Exception as e:
        print(f"[Drawing] Error getting drawings: {e}")
        raise HTTPException(status_code=500, detail="Failed to get drawings")


@router.post("/{campaign_id}/drawings/ruler")
async def create_ruler(
    campaign_id: int,
    ruler: RulerCreate = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> DrawingResponse:
    """Create a new ruler"""
    await check_campaign_member(campaign_id, current_user, db)
    user_id = current_user["user_id"]
    try:
        new_ruler = Drawing(
            campaign_id=campaign_id,
            map_url=ruler.map_url,
            type=DrawingType.RULER.value,
            created_by_user_id=user_id,
            start_x=ruler.start_x,
            start_y=ruler.start_y,
            end_x=ruler.end_x,
            end_y=ruler.end_y,
            distance=ruler.distance,
            color=ruler.color,
            stroke_color=ruler.color
        )
        db.add(new_ruler)
        await db.commit()
        await db.refresh(new_ruler)

        print(f"[Drawing] Created ruler {new_ruler.id} by {user_id} in campaign {campaign_id}")
        return DrawingResponse.model_validate(new_ruler)
    except Exception as e:
        await db.rollback()
        print(f"[Drawing] Error creating ruler: {e}")
        raise HTTPException(status_code=500, detail="Failed to create ruler")


@router.post("/{campaign_id}/drawings/circle")
async def create_circle(
    campaign_id: int,
    circle: CircleCreate = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> DrawingResponse:
    """Create a new circle"""
    await check_campaign_member(campaign_id, current_user, db)
    user_id = current_user["user_id"]
    try:
        new_circle = Drawing(
            campaign_id=campaign_id,
            map_url=circle.map_url,
            type=DrawingType.CIRCLE.value,
            created_by_user_id=user_id,
            center_x=circle.center_x,
            center_y=circle.center_y,
            radius=circle.radius,
            color=circle.color,
            stroke_color=circle.color,
            fill_color=circle.fill_color,
            stroke_width=circle.stroke_width
        )
        db.add(new_circle)
        await db.commit()
        await db.refresh(new_circle)

        print(f"[Drawing] Created circle {new_circle.id} by {user_id} in campaign {campaign_id}")
        return DrawingResponse.model_validate(new_circle)
    except Exception as e:
        await db.rollback()
        print(f"[Drawing] Error creating circle: {e}")
        raise HTTPException(status_code=500, detail="Failed to create circle")


@router.post("/{campaign_id}/drawings/sketch")
async def create_sketch(
    campaign_id: int,
    sketch: SketchCreate = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> DrawingResponse:
    """Create a new sketch (freehand drawing)"""
    await check_campaign_member(campaign_id, current_user, db)
    user_id = current_user["user_id"]
    try:
        new_sketch = Drawing(
            campaign_id=campaign_id,
            map_url=sketch.map_url,
            type=DrawingType.SKETCH.value,
            created_by_user_id=user_id,
            points=sketch.points,
            color=sketch.color,
            stroke_color=sketch.color,
            stroke_width=sketch.stroke_width
        )
        db.add(new_sketch)
        await db.commit()
        await db.refresh(new_sketch)

        print(f"[Drawing] Created sketch {new_sketch.id} by {user_id} in campaign {campaign_id}")
        return DrawingResponse.model_validate(new_sketch)
    except Exception as e:
        await db.rollback()
        print(f"[Drawing] Error creating sketch: {e}")
        raise HTTPException(status_code=500, detail="Failed to create sketch")


@router.post("/{campaign_id}/drawings/arrow")
async def create_arrow(
    campaign_id: int,
    arrow: ArrowCreate = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> DrawingResponse:
    """Create a new arrow"""
    await check_campaign_member(campaign_id, current_user, db)
    user_id = current_user["user_id"]
    try:
        new_arrow = Drawing(
            campaign_id=campaign_id,
            map_url=arrow.map_url,
            type=DrawingType.ARROW.value,
            created_by_user_id=user_id,
            points=arrow.points,
            color=arrow.color,
            stroke_color=arrow.color,
            stroke_width=arrow.stroke_width
        )
        db.add(new_arrow)
        await db.commit()
        await db.refresh(new_arrow)

        print(f"[Drawing] Created arrow {new_arrow.id} by {user_id} in campaign {campaign_id}")
        return DrawingResponse.model_validate(new_arrow)
    except Exception as e:
        await db.rollback()
        print(f"[Drawing] Error creating arrow: {e}")
        raise HTTPException(status_code=500, detail="Failed to create arrow")


@router.put("/{campaign_id}/drawings/{drawing_id}")
async def update_drawing(
    campaign_id: int,
    drawing_id: int,
    drawing_update: DrawingUpdate = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> DrawingResponse:
    """Update a drawing (owner only)"""
    await check_campaign_member(campaign_id, current_user, db)
    user_id = current_user["user_id"]
    try:
        result = await db.execute(
            select(Drawing).where(
                (Drawing.id == drawing_id) &
                (Drawing.campaign_id == campaign_id)
            )
        )
        drawing = result.scalar_one_or_none()

        if not drawing:
            raise HTTPException(status_code=404, detail="Drawing not found")

        # Check ownership
        if drawing.created_by_user_id != user_id:
            raise HTTPException(status_code=403, detail="You can only edit your own drawings")

        # Update fields
        for field, value in drawing_update.dict(exclude_unset=True).items():
            setattr(drawing, field, value)

        await db.commit()
        await db.refresh(drawing)

        print(f"[Drawing] Updated drawing {drawing_id} by {user_id}")
        return DrawingResponse.model_validate(drawing)
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        print(f"[Drawing] Error updating drawing: {e}")
        raise HTTPException(status_code=500, detail="Failed to update drawing")


@router.delete("/{campaign_id}/drawings/{drawing_id}")
async def delete_drawing(
    campaign_id: int,
    drawing_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> dict:
    """Delete a drawing (DM can delete any, players can only delete their own)"""
    await check_campaign_member(campaign_id, current_user, db)
    user_id = current_user["user_id"]
    try:
        # Get the drawing
        result = await db.execute(
            select(Drawing).where(
                (Drawing.id == drawing_id) &
                (Drawing.campaign_id == campaign_id)
            )
        )
        drawing = result.scalar_one_or_none()

        if not drawing:
            raise HTTPException(status_code=404, detail="Drawing not found")

        # Check if user is DM (use limit(1) to handle duplicate members)
        from app.models.campaign import CampaignMember
        member_result = await db.execute(
            select(CampaignMember).where(
                (CampaignMember.campaign_id == campaign_id) &
                (CampaignMember.user_id == user_id)
            ).limit(1)
        )
        member = member_result.scalar_one_or_none()

        is_dm = member and member.role == "dm"

        # Check permission: DM can delete anything, players can only delete their own
        if not is_dm and drawing.created_by_user_id != user_id:
            raise HTTPException(status_code=403, detail="You can only delete your own drawings")

        await db.delete(drawing)
        await db.commit()

        print(f"[Drawing] Deleted drawing {drawing_id} by {user_id} (DM: {is_dm}) from campaign {campaign_id}")
        return {"status": "success", "message": "Drawing deleted"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        print(f"[Drawing] Error deleting drawing: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete drawing")


@router.delete("/{campaign_id}/drawings")
async def clear_all_drawings(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> dict:
    """Clear all drawings for a specific map (DM only - for now, admin action)"""
    from app.utils.permission_checks import require_campaign_dm
    await require_campaign_dm(campaign_id, current_user, db)
    try:
        await db.execute(
            delete(Drawing).where(
                (Drawing.campaign_id == campaign_id) &
                (Drawing.map_url == map_url)
            )
        )
        await db.commit()

        print(f"[Drawing] Cleared all drawings for campaign {campaign_id}, map {map_url}")
        return {"status": "success", "message": "All drawings cleared"}
    except Exception as e:
        await db.rollback()
        print(f"[Drawing] Error clearing drawings: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear drawings")


@router.post("/{campaign_id}/drawings/undo")
async def undo_last_drawing(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> dict:
    """Undo the last drawing by the user (DM can undo any, players can only undo their own)"""
    await check_campaign_member(campaign_id, current_user, db)
    user_id = current_user["user_id"]
    print(f"[Drawing] Undo request: campaign_id={campaign_id}, user_id={user_id}, map_url={map_url}")
    try:
        # Check if user is DM
        # campaign_id is INTEGER across tables after schema normalization
        from app.models.campaign import CampaignMember
        member_result = await db.execute(
            select(CampaignMember).where(
                (CampaignMember.campaign_id == campaign_id) &
                (CampaignMember.user_id == user_id)
            )
        )
        member = member_result.scalar_one_or_none()
        is_dm = member and member.role == "dm"
        print(f"[Drawing] Member found: {member is not None}, is_dm: {is_dm}")

        # Get the last drawing
        if is_dm:
            # DM can undo any drawing
            result = await db.execute(
                select(Drawing).where(
                    (Drawing.campaign_id == campaign_id) &
                    (Drawing.map_url == map_url)
                ).order_by(Drawing.created_at.desc()).limit(1)
            )
            print(f"[Drawing] Querying all drawings for DM, campaign_id={campaign_id}")
        else:
            # Players can only undo their own drawings
            result = await db.execute(
                select(Drawing).where(
                    (Drawing.campaign_id == campaign_id) &
                    (Drawing.map_url == map_url) &
                    (Drawing.created_by_user_id == user_id)
                ).order_by(Drawing.created_at.desc()).limit(1)
            )
            print(f"[Drawing] Querying user's drawings only, campaign_id={campaign_id}")

        drawing = result.scalar_one_or_none()

        if not drawing:
            print(f"[Drawing] No drawing found to undo")
            return {"status": "error", "message": "No drawing to undo"}

        drawing_id = drawing.id
        print(f"[Drawing] Deleting drawing {drawing_id}")
        await db.delete(drawing)
        await db.commit()

        print(f"[Drawing] Undid drawing {drawing_id} by {user_id} (DM: {is_dm}) from campaign {campaign_id}")
        return {"status": "success", "message": "Drawing undone", "drawing_id": drawing_id}
    except Exception as e:
        await db.rollback()
        import traceback
        print(f"[Drawing] Error undoing drawing: {e}")
        print(f"[Drawing] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to undo drawing")
