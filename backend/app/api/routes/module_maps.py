"""
Module Maps API routes for D&D battle map - database persistence
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import List, Optional

from app.core.dependencies import resolve_campaign_member_context
from app.core.security import require_auth
from app.db.session import get_db
from app.models.module_maps import ModuleMaps

router = APIRouter(prefix="/api/campaigns", tags=["module-maps"])


class ModuleMapItem(BaseModel):
    id: str
    name: str
    url: str
    chapter: Optional[str] = ""
    metadata: Optional[dict] = None


class ModuleMapsData(BaseModel):
    module_id: str
    maps: List[ModuleMapItem]


async def _require_campaign_dm(
    db: AsyncSession,
    campaign_id: int,
    current_user: dict,
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    if not context.is_dm:
        raise HTTPException(status_code=403, detail="DM access required")
    return context


@router.get("/{campaign_id}/module-maps")
async def get_module_maps(
    campaign_id: int,
    module_id: Optional[str] = Query(None, description="Module ID to filter maps"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Get available maps for a campaign and module
    """
    try:
        await resolve_campaign_member_context(db, campaign_id, current_user)
        # Build query
        query = select(ModuleMaps).where(ModuleMaps.campaign_id == campaign_id)

        if module_id:
            query = query.where(ModuleMaps.module_id == module_id)

        # Execute query
        result = await db.execute(query)
        records = result.scalars().all()

        if not records:
            # Return empty list if no records found
            return {
                "campaign_id": campaign_id,
                "module_id": module_id,
                "maps": []
            }

        # If module_id specified, return that specific record
        if module_id and len(records) > 0:
            return {
                "campaign_id": campaign_id,
                "module_id": module_id,
                "maps": records[0].maps
            }

        # Otherwise return all maps for the campaign (for all modules)
        all_maps = []
        for record in records:
            all_maps.extend(record.maps)

        return {
            "campaign_id": campaign_id,
            "maps": all_maps
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get module maps: {str(e)}")


@router.put("/{campaign_id}/module-maps")
async def save_module_maps(
    campaign_id: int,
    data: ModuleMapsData,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Save available maps for a campaign and module
    """
    try:
        await _require_campaign_dm(db, campaign_id, current_user)
        module_id = data.module_id

        # Check if record already exists
        result = await db.execute(
            select(ModuleMaps).where(
                (ModuleMaps.campaign_id == campaign_id) &
                (ModuleMaps.module_id == module_id)
            )
        )
        record = result.scalar_one_or_none()

        if record:
            # Update existing record
            record.maps = [map.model_dump() for map in data.maps]
            await db.commit()
            await db.refresh(record)
        else:
            # Create new record
            record = ModuleMaps(
                campaign_id=campaign_id,
                module_id=module_id,
                maps=[map.model_dump() for map in data.maps]
            )
            db.add(record)
            await db.commit()
            await db.refresh(record)

        return {
            "campaign_id": campaign_id,
            "module_id": module_id,
            "maps": record.maps,
            "message": "Module maps saved successfully"
        }

    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save module maps: {str(e)}")


@router.post("/{campaign_id}/module-maps/add")
async def add_single_map(
    campaign_id: int,
    module_id: str,
    map_data: ModuleMapItem,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Add a single map to the campaign's module maps
    Body: { module_id: str, id: str, name: str, url: str, chapter: str, metadata: dict }
    """
    try:
        await _require_campaign_dm(db, campaign_id, current_user)
        # Check if record already exists
        result = await db.execute(
            select(ModuleMaps).where(
                (ModuleMaps.campaign_id == campaign_id) &
                (ModuleMaps.module_id == module_id)
            )
        )
        record = result.scalar_one_or_none()

        map_dict = map_data.model_dump()

        if record:
            # Add to existing maps (avoid duplicates by checking id)
            existing_ids = {m.get('id') for m in record.maps if isinstance(m, dict) and 'id' in m}
            if map_dict['id'] not in existing_ids:
                record.maps = record.maps + [map_dict]
                await db.commit()
                await db.refresh(record)
        else:
            # Create new record with this map
            record = ModuleMaps(
                campaign_id=campaign_id,
                module_id=module_id,
                maps=[map_dict]
            )
            db.add(record)
            await db.commit()
            await db.refresh(record)

        return {
            "campaign_id": campaign_id,
            "module_id": module_id,
            "map": map_dict,
            "total_maps": len(record.maps),
            "message": "Map added successfully"
        }

    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to add map: {str(e)}")


@router.post("/{campaign_id}/module-maps/add-batch")
async def add_maps_batch(
    campaign_id: int,
    module_id: str,
    maps: List[ModuleMapItem],
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Add multiple maps to the campaign's module maps in one request.
    Body: List[{ id: str, name: str, url: str, chapter: str, metadata: dict }]
    """
    try:
        await _require_campaign_dm(db, campaign_id, current_user)
        # Check if record already exists
        result = await db.execute(
            select(ModuleMaps).where(
                (ModuleMaps.campaign_id == campaign_id) &
                (ModuleMaps.module_id == module_id)
            )
        )
        record = result.scalar_one_or_none()

        maps_to_add = [m.model_dump() for m in maps]
        added_count = 0

        if record:
            # Get existing map IDs to avoid duplicates
            existing_ids = {m.get('id') for m in record.maps if isinstance(m, dict) and 'id' in m}
            # Filter out duplicates
            new_maps = [m for m in maps_to_add if m['id'] not in existing_ids]
            added_count = len(new_maps)
            if new_maps:
                record.maps = record.maps + new_maps
                await db.commit()
                await db.refresh(record)
        else:
            # Create new record with all maps
            record = ModuleMaps(
                campaign_id=campaign_id,
                module_id=module_id,
                maps=maps_to_add
            )
            added_count = len(maps_to_add)
            db.add(record)
            await db.commit()
            await db.refresh(record)

        return {
            "campaign_id": campaign_id,
            "module_id": module_id,
            "added_count": added_count,
            "total_maps": len(record.maps),
            "message": f"Successfully added {added_count} maps"
        }

    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to add maps: {str(e)}")


@router.delete("/{campaign_id}/module-maps/remove")
async def remove_single_map(
    campaign_id: int,
    map_id: str = Query(..., description="Map ID to remove"),
    module_id: Optional[str] = Query(None, description="Module ID (optional, will search all if not provided)"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Remove a single map from the campaign's maps.
    If module_id is not provided, searches all module records for this campaign.
    """
    try:
        await _require_campaign_dm(db, campaign_id, current_user)
        if module_id:
            # Find specific record by module_id
            result = await db.execute(
                select(ModuleMaps).where(
                    (ModuleMaps.campaign_id == campaign_id) &
                    (ModuleMaps.module_id == module_id)
                )
            )
            records = [result.scalar_one_or_none()]
            records = [r for r in records if r is not None]
        else:
            # Search all records for this campaign
            result = await db.execute(
                select(ModuleMaps).where(ModuleMaps.campaign_id == campaign_id)
            )
            records = result.scalars().all()

        if not records:
            raise HTTPException(status_code=404, detail="No maps found for this campaign")

        # Find and remove the map from whichever record contains it
        map_found = False
        for record in records:
            original_count = len(record.maps)
            record.maps = [m for m in record.maps if m.get('id') != map_id]
            new_count = len(record.maps)

            if original_count != new_count:
                map_found = True
                await db.commit()
                await db.refresh(record)
                return {
                    "campaign_id": campaign_id,
                    "module_id": record.module_id,
                    "map_id": map_id,
                    "remaining_maps": new_count,
                    "message": "Map removed successfully"
                }

        if not map_found:
            raise HTTPException(status_code=404, detail=f"Map with id '{map_id}' not found")

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to remove map: {str(e)}")


@router.delete("/{campaign_id}/module-maps")
async def delete_module_maps(
    campaign_id: int,
    module_id: str = Query(..., description="Module ID to delete maps for"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Delete all maps for a campaign and module
    """
    try:
        await _require_campaign_dm(db, campaign_id, current_user)
        result = await db.execute(
            select(ModuleMaps).where(
                (ModuleMaps.campaign_id == campaign_id) &
                (ModuleMaps.module_id == module_id)
            )
        )
        record = result.scalar_one_or_none()

        if record:
            await db.delete(record)
            await db.commit()
            return {
                "campaign_id": campaign_id,
                "module_id": module_id,
                "message": "Module maps deleted successfully"
            }
        else:
            return {
                "campaign_id": campaign_id,
                "module_id": module_id,
                "message": "No module maps found to delete"
            }

    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete module maps: {str(e)}")
