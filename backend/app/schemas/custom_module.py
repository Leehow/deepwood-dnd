"""CustomModule schemas - 自定义模组的Pydantic模型"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Any
from datetime import datetime


# === 内容子模型 ===

class ChapterItem(BaseModel):
    """章节/场景"""
    id: str
    title: str
    content: str = ""
    order: int = 0


class NPCItem(BaseModel):
    """NPC"""
    id: str
    name: str
    name_en: Optional[str] = None
    description: str = ""
    stats: Optional[dict] = None
    role: str = ""  # e.g., "ally", "enemy", "neutral"


class LocationItem(BaseModel):
    """地点"""
    id: str
    name: str
    description: str = ""
    features: List[str] = []


class EncounterItem(BaseModel):
    """遭遇战"""
    id: str
    name: str
    description: str = ""
    monsters: List[dict] = []  # [{name, count, cr}]
    difficulty: str = "medium"  # easy, medium, hard, deadly


class TreasureItem(BaseModel):
    """宝藏/奖励"""
    id: str
    name: str
    description: str = ""
    value: str = ""  # e.g., "50 gp"
    rarity: str = "common"


# === CRUD模型 ===

class CustomModuleCreate(BaseModel):
    """创建自定义模组"""
    title: str = Field(..., min_length=1, max_length=500, description="模组标题")
    description: Optional[str] = Field(None, description="模组描述")
    template_id: Optional[str] = Field(None, description="模板ID")
    recommended_level_min: int = Field(default=1, ge=1, le=20)
    recommended_level_max: int = Field(default=5, ge=1, le=20)
    estimated_sessions: Optional[str] = Field(None, description="预计场次")


class CustomModuleUpdate(BaseModel):
    """更新自定义模组"""
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = None
    chapters: Optional[List[dict]] = None
    npcs: Optional[List[dict]] = None
    locations: Optional[List[dict]] = None
    encounters: Optional[List[dict]] = None
    treasures: Optional[List[dict]] = None
    recommended_level_min: Optional[int] = Field(None, ge=1, le=20)
    recommended_level_max: Optional[int] = Field(None, ge=1, le=20)
    estimated_sessions: Optional[str] = None


class CustomModuleResponse(BaseModel):
    """自定义模组响应"""
    id: int
    module_id: str
    title: str
    description: Optional[str] = None
    template_id: Optional[str] = None
    chapters: List[Any] = []
    npcs: List[Any] = []
    locations: List[Any] = []
    encounters: List[Any] = []
    treasures: List[Any] = []
    recommended_level_min: int = 1
    recommended_level_max: int = 5
    estimated_sessions: Optional[str] = None
    created_by: str
    is_shared: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class CustomModuleListItem(BaseModel):
    """列表项简要信息"""
    id: int
    module_id: str
    title: str
    description: Optional[str] = None
    template_id: Optional[str] = None
    recommended_level_min: int = 1
    recommended_level_max: int = 5
    estimated_sessions: Optional[str] = None
    created_by: str
    is_shared: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CustomModuleListResponse(BaseModel):
    """分页列表响应"""
    items: List[CustomModuleListItem]
    total: int
    page: int
    page_size: int


# === 模板定义 ===

class RecommendedLevel(BaseModel):
    """推荐等级范围"""
    min: int = 1
    max: int = 5


class ModuleTemplate(BaseModel):
    """模组模板"""
    id: str
    name: str
    name_en: Optional[str] = None
    default_title: Optional[str] = None
    description: str
    icon: str = "📜"
    type: str = "mixed"  # location_based, event_based, mixed
    recommended_level: RecommendedLevel = RecommendedLevel()
    estimated_sessions: str = "1-2"
    default_goals: List[str] = []
    ai_prompts: dict = {}
    structure: Optional[dict] = None
    # Legacy fields for compatibility
    default_chapters: List[dict] = []
    default_level_min: int = 1
    default_level_max: int = 5
