from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from app.utils.races import load_races_data, get_race_by_name

router = APIRouter(prefix="/races", tags=["Races"])


@router.get("")
async def get_races():
    """Get all races data"""
    try:
        return load_races_data()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load races data: {str(e)}"
        )


@router.get("/{race_name}")
async def get_race(race_name: str) -> Dict[str, Any]:
    """Get specific race data by name (supports Chinese, English, or ID)"""
    race_data = get_race_by_name(race_name)

    if not race_data:
        raise HTTPException(
            status_code=404,
            detail=f"Race '{race_name}' not found"
        )

    return race_data
