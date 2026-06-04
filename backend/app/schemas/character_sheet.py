from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import List, Optional, Dict, Any, Union
from datetime import datetime


class SpellSelection(BaseModel):
    """Spell selection with level tracking"""
    id: str
    level_learned: int
    source: str  # Class or source that provided the spell


class CharacterAppearance(BaseModel):
    """Character appearance details"""
    height: str = ""
    weight: str = ""
    eyes: str = ""
    skin: str = ""
    hair: str = ""
    distinguishingMarks: str = ""


class CharacterPersonality(BaseModel):
    """Character personality traits"""
    traits: List[str] = []
    ideals: str = ""
    bonds: str = ""
    flaws: str = ""


class CharacterAbilityScores(BaseModel):
    """Character ability scores"""
    strength: int = 10
    dexterity: int = 10
    constitution: int = 10
    intelligence: int = 10
    wisdom: int = 10
    charisma: int = 10


class CharacterSubclassChoices(BaseModel):
    """Subclass feature choices"""
    language: Optional[List[str]] = None
    languages: Optional[List[str]] = None
    skill: Optional[List[str]] = None
    skills: Optional[List[str]] = None
    cantrips: Optional[List[str]] = None
    dragonType: Optional[str] = None


class CharacterRaceChoices(BaseModel):
    """Race feature choices"""
    tool: Optional[str] = None
    skills: Optional[List[str]] = None
    abilityScores: Optional[List[str]] = None
    language: Optional[str] = None


class CharacterCreate(BaseModel):
    """Schema for creating a new character"""
    user_id: str = Field(..., description="User ID who owns this character")
    
    # Basic Information
    name: str
    race_id: str = Field(..., alias="raceId")
    subrace_id: Optional[str] = Field(None, alias="subraceId")
    class_id: str = Field(..., alias="classId")
    subclass_id: Optional[str] = Field(None, alias="subclassId")
    background_id: Optional[str] = Field(None, alias="backgroundId")
    level: int = 1
    current_hp: Optional[int] = None
    spell_slots_state: Optional[List[int]] = None

    # Appearance & Description
    age: Optional[int] = None
    gender: Optional[str] = None
    alignment: Optional[str] = None
    deity_id: Optional[str] = Field(None, alias="deityId")
    avatar: Optional[str] = None
    
    # Appearance details
    appearance: CharacterAppearance
    
    # Personality
    personality: CharacterPersonality
    other_traits: Optional[str] = Field(None, alias="otherTraits")
    backstory: Optional[str] = None
    
    # Ability Scores
    ability_scores: CharacterAbilityScores = Field(..., alias="abilityScores")
    
    # Skills & Proficiencies - support both old (str) and new (dict with level tracking) formats
    selected_skills: List[Any] = Field(default_factory=list, alias="selectedSkills")
    expertise_skills: List[Any] = Field(default_factory=list, alias="expertiseSkills")
    
    # Class Features
    fighting_style: Optional[str] = Field(None, alias="fightingStyle")
    favored_enemy: Optional[str] = Field(None, alias="favoredEnemy")
    favored_humanoid_races: List[str] = Field(default_factory=list, alias="favoredHumanoidRaces")
    favored_terrain: Optional[str] = Field(None, alias="favoredTerrain")
    eldritch_invocations: List[str] = Field(default_factory=list, alias="eldritchInvocations")
    maneuvers_known: List[str] = Field(default_factory=list, alias="maneuversKnown")
    
    # Spells
    selected_cantrips: Union[List[str], List[SpellSelection]] = Field(default_factory=list, alias="selectedCantrips")
    selected_spells: Union[List[str], List[SpellSelection]] = Field(default_factory=list, alias="selectedSpells")
    prepared_spells: List[str] = Field(default_factory=list, alias="preparedSpells")
    
    # Equipment
    equipment: List[Any] = Field(default_factory=list)
    
    # Feature Choices
    subclass_choices: Optional[CharacterSubclassChoices] = Field(None, alias="subclassChoices")
    race_choices: Optional[CharacterRaceChoices] = Field(None, alias="raceChoices")

    model_config = ConfigDict(populate_by_name=True)


class CharacterResponse(BaseModel):
    """Schema for character response"""
    id: int
    user_id: str

    # Basic Information
    name: str
    race_id: str
    subrace_id: Optional[str]
    class_id: str
    subclass_id: Optional[str]
    background_id: Optional[str]
    level: int
    experience_points: int = 0  # Add XP field
    current_hp: Optional[int] = None
    spell_slots_state: Optional[List[int]] = None

    # Appearance & Description
    age: Optional[int]
    gender: Optional[str]
    alignment: Optional[str]
    deity_id: Optional[str]
    avatar: Optional[str]

    # Appearance details
    appearance: Dict[str, Any]

    # Personality
    personality: Dict[str, Any]
    other_traits: Optional[str]
    backstory: Optional[str]

    # Ability Scores
    ability_scores: Dict[str, int]

    # Skills & Proficiencies - support both old (str) and new (dict with level tracking) formats
    selected_skills: List[Any]
    expertise_skills: List[Any]

    # Class Features - can be string (old format) or dict (new format with level tracking)
    fighting_style: Optional[Union[str, Dict[str, Any]]] = None
    favored_enemy: Optional[Union[str, Dict[str, Any]]] = None
    favored_humanoid_races: List[str] = Field(default_factory=list)
    favored_terrain: Optional[Union[str, Dict[str, Any]]] = None
    eldritch_invocations: List[Any] = Field(default_factory=list)
    maneuvers_known: List[str] = Field(default_factory=list)

    # Feats
    feats: List[str] = Field(default_factory=list)
    feat_choices: Optional[Dict[str, Any]] = None

    # Spells
    selected_cantrips: Union[List[str], List[SpellSelection]]
    selected_spells: Union[List[str], List[SpellSelection]]
    prepared_spells: List[str]
    can_prepare_spells: bool = True  # Whether prepared casters can change prepared list
    quick_spells: Optional[List[Optional[str]]] = None  # Quick spell bar [id|null, id|null, id|null, id|null]

    # Equipment & Currency
    equipment: List[Any]
    currency: Optional[Dict[str, int]] = None

    # Feature Choices
    subclass_choices: Optional[Dict[str, Any]]
    race_choices: Optional[Dict[str, Any]]

    # Multiclass & Level History
    multiclass_data: Optional[Dict[str, Any]] = None
    level_history: Optional[List[Dict[str, Any]]] = None

    # Status effects (buff/debuff/conditions)
    status_effects: Optional[Dict[str, Any]] = None

    # Hotbar slots
    hotbar: Optional[List[Optional[Dict[str, Any]]]] = None

    # Metadata
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)

    @field_validator('maneuvers_known', 'eldritch_invocations', 'favored_humanoid_races', 'feats', mode='before')
    @classmethod
    def convert_none_to_list(cls, v):
        """Convert None to empty list for list fields"""
        return v if v is not None else []


class TokenLocationInfo(BaseModel):
    """Token location info for list display"""
    campaign_id: int
    campaign_name: str
    map_url: str


class CharacterListItem(BaseModel):
    """Simplified character info for list display"""
    id: int
    name: str
    race_id: str
    subrace_id: Optional[str]
    class_id: str
    subclass_id: Optional[str]
    level: int
    avatar: Optional[str]
    ability_scores: Dict[str, int]
    token_locations: List[TokenLocationInfo] = []
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CharacterLevelUpBroadcast(BaseModel):
    """
    Schema for broadcasting character level up via WebSocket
    Optimized to include all key data DM needs without excessive payload
    """
    # Basic identification
    character_id: int
    character_name: str
    user_id: str

    # Level and class info
    level: int
    class_id: str
    subclass_id: Optional[str]
    multiclass_data: Optional[Dict[str, Any]]

    # Ability scores (key for DM)
    ability_scores: Dict[str, int]

    # HP (combat critical)
    current_hp: Optional[int]
    max_hp: int

    # Skills and proficiencies
    selected_skills: List[Any]  # Support both old and new formats
    expertise_skills: List[Any]

    # Class features
    fighting_style: Optional[Any]
    favored_enemy: Optional[Any]
    favored_terrain: Optional[Any]
    eldritch_invocations: Optional[List[Any]]
    maneuvers_known: Optional[List[str]]  # Battle Master maneuvers

    # Spells (for spellcasters)
    selected_cantrips: Optional[List[Any]]
    selected_spells: Optional[List[Any]]
    prepared_spells: Optional[List[str]]
    spell_slots_state: Optional[List[int]]

    # Timestamp
    timestamp: str

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_character(cls, character, max_hp: int):
        """Create broadcast data from Character object"""
        from datetime import datetime

        return cls(
            character_id=character.id,
            character_name=character.name,
            user_id=character.user_id,
            level=character.level,
            class_id=character.class_id,
            subclass_id=character.subclass_id,
            multiclass_data=character.multiclass_data,
            ability_scores=character.ability_scores or {},
            current_hp=character.current_hp,
            max_hp=max_hp,
            selected_skills=character.selected_skills or [],
            expertise_skills=character.expertise_skills or [],
            fighting_style=character.fighting_style,
            favored_enemy=character.favored_enemy,
            favored_terrain=character.favored_terrain,
            eldritch_invocations=character.eldritch_invocations or [],
            maneuvers_known=character.maneuvers_known or [],
            selected_cantrips=character.selected_cantrips or [],
            selected_spells=character.selected_spells or [],
            prepared_spells=character.prepared_spells or [],
            spell_slots_state=character.spell_slots_state,
            timestamp=datetime.utcnow().isoformat()
        )

