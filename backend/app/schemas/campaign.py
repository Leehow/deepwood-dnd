from pydantic import BaseModel, Field, ConfigDict, AliasChoices
from typing import Optional, Dict, Any, Literal, List
from datetime import datetime


class CampaignBase(BaseModel):
    """Base schema for Campaign"""
    name: str = Field(..., min_length=1, max_length=200, description="Campaign name")
    max_players: int = Field(default=4, ge=2, le=10, description="Maximum players")
    level_range: Optional[str] = Field(None, description="Level range (e.g., '1-5')")
    description: Optional[str] = Field(None, description="Campaign description")



class CampaignCreate(CampaignBase):
    """Schema for creating Campaign"""
    dm_user_id: str = Field(..., description="DM user ID")
    status: Optional[str] = Field(default="recruiting", pattern="^(recruiting|in_progress|completed)$")
    selected_module_id: Optional[str] = Field(default=None, description="Pre-selected module ID")
    cover_image: Optional[str] = Field(default=None, description="Cover image URL")
    # Accept either 'metadata' or 'meta' from client payloads
    metadata: Optional[Dict[str, Any]] = Field(default=None, validation_alias=AliasChoices("metadata", "meta"))


class CampaignUpdate(BaseModel):
    """Schema for updating Campaign"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    max_players: Optional[int] = Field(None, ge=2, le=10)
    level_range: Optional[str] = None
    status: Optional[str] = Field(None, pattern="^(recruiting|in_progress|completed)$")
    description: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = Field(default=None, validation_alias=AliasChoices("metadata", "meta"))

    current_map_url: Optional[str] = None
    selected_module_id: Optional[str] = None
    cover_image: Optional[str] = None


class CampaignResponse(CampaignBase):
    """Schema for Campaign response"""
    id: int
    dm_user_id: str
    # Use the ORM attribute name 'meta' and expose it as 'metadata' in JSON
    meta: Optional[Dict[str, Any]] = Field(default=None, alias="metadata", validation_alias=AliasChoices("meta"))

    current_players: int
    status: str
    current_map_url: Optional[str]
    selected_module_id: Optional[str]
    cover_image: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime]

    # populate_by_name allows using field names for serialization with alias
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class CampaignMemberBase(BaseModel):
    """Base schema for Campaign Member"""
    campaign_id: int
    user_id: str
    role: str = Field(..., pattern="^(dm|player)$")
    character_name: Optional[str] = None
    selected_character_id: Optional[int] = None
    is_virtual: bool = False
    display_name: Optional[str] = None


class CampaignMemberCreate(CampaignMemberBase):
    """Schema for creating Campaign Member"""
    pass


class CampaignMemberResponse(CampaignMemberBase):
    """Schema for Campaign Member response"""
    id: int
    joined_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CampaignListResponse(BaseModel):
    """Schema for campaign list with member info"""
    id: int
    name: str
    dm_user_id: str
    dm_display_name: Optional[str] = None
    max_players: int
    current_players: int
    level_range: Optional[str]
    status: str
    description: Optional[str]
    current_map_url: Optional[str]
    selected_module_id: Optional[str]
    cover_image: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RuleOptionReference(BaseModel):
    id: str
    name: str
    name_en: Optional[str] = None


class RuleClassOption(BaseModel):
    id: str
    name: str
    name_en: Optional[str] = None
    source_package_id: str
    subclass_count: int = 0
    subclasses: List[RuleOptionReference] = Field(default_factory=list)


class RuleRaceOption(BaseModel):
    id: str
    name: str
    name_en: Optional[str] = None
    source_package_id: str
    subrace_count: int = 0
    subraces: List[RuleOptionReference] = Field(default_factory=list)


class RuleBackgroundOption(BaseModel):
    id: str
    name: str
    name_en: Optional[str] = None
    source_package_id: str


class RuleDeityOption(BaseModel):
    id: str
    name: str
    name_en: Optional[str] = None
    pantheon_id: str
    pantheon_name: str
    domains: List[str] = Field(default_factory=list)
    source_package_id: str


class RulePackageSummary(BaseModel):
    package_id: str
    name: str
    version: str
    source: str
    layer: str
    implemented: bool
    resource_counts: Dict[str, int] = Field(default_factory=dict)


class CampaignRuleToggleState(BaseModel):
    deity_system: bool = False


class CampaignRuleCatalog(BaseModel):
    classes: List[RuleClassOption] = Field(default_factory=list)
    races: List[RuleRaceOption] = Field(default_factory=list)
    backgrounds: List[RuleBackgroundOption] = Field(default_factory=list)
    deities: List[RuleDeityOption] = Field(default_factory=list)


class CampaignRuleOptionsResponse(BaseModel):
    campaign_id: int
    selected_module_id: Optional[str] = None
    assembly_version: str
    packages: List[RulePackageSummary] = Field(default_factory=list)
    toggles: CampaignRuleToggleState
    catalog: CampaignRuleCatalog
    warnings: List[str] = Field(default_factory=list)


class SidebarStateUpdate(BaseModel):
    """Schema for updating sidebar state"""
    role: Literal["dm", "player"]
    tab: str
    width: int = Field(default=384, ge=200, le=1000)
    subTabs: Optional[Dict[str, str]] = Field(default_factory=dict)
    hotbarExpanded: Optional[bool] = None
    dmSelectedCharacterId: Optional[int] = None
    spellExpandedLevels: Optional[Dict[str, list]] = None
    floatingChat: Optional[Dict[str, Any]] = None
    floatingCharPanel: Optional[Dict[str, Any]] = None
    chatFilters: Optional[Dict[str, Any]] = None


class SidebarStateResponse(BaseModel):
    """Schema for sidebar state response"""
    tab: str
    width: int
    subTabs: Dict[str, str] = Field(default_factory=dict)
    hotbarExpanded: bool = False
    dmSelectedCharacterId: Optional[int] = None
    spellExpandedLevels: Dict[str, list] = Field(default_factory=dict)
    floatingChat: Optional[Dict[str, Any]] = None
    floatingCharPanel: Optional[Dict[str, Any]] = None
    chatFilters: Optional[Dict[str, Any]] = None


class VirtualPlayerCreate(BaseModel):
    """Schema for creating a virtual player"""
    display_name: str = Field(..., min_length=1, max_length=100)


class VirtualPlayerUpdate(BaseModel):
    """Schema for updating a virtual player"""
    display_name: str = Field(..., min_length=1, max_length=100)


class VirtualPlayerImport(BaseModel):
    """Schema for importing a character from the virtual character library"""
    source_character_id: int
    display_name: str = Field(..., min_length=1, max_length=100)
