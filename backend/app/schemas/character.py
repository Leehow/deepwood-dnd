from pydantic import BaseModel, field_validator
from typing import List, Optional, Union


class CharacterBackgroundRequest(BaseModel):
    """Request model for character background generation"""
    user_id: str
    race: str
    subrace: Optional[str] = None
    character_class: str
    alignment: str
    name: str
    age: int
    gender: str
    generate_full: bool = False  # If True, generate name, age, gender too


class CharacterBackgroundResponse(BaseModel):
    """Response model for character background generation"""
    background: str
    traits: List[str]
    ideals: str
    bonds: str
    flaws: str
    # Optional fields for full generation
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    alignment: Optional[str] = None


class FullDescriptionRequest(BaseModel):
    """Request model for full character description generation"""
    user_id: str
    race: str
    subrace: Optional[str] = None
    character_class: str
    background: Optional[str] = None  # Background is optional


class FullDescriptionResponse(BaseModel):
    """Response model for full character description"""
    name: str
    age: int
    gender: str
    alignment: str
    deity: Optional[str] = None  # Deity name (English) for Cleric/Paladin
    background: Optional[str] = None
    height: Union[str, int]
    weight: Union[str, int]
    eyes: str
    skin: str
    hair: str
    distinguishingMarks: str
    traits: List[str]
    ideals: str
    bonds: str
    flaws: str
    otherTraits: Optional[str] = None
    backstory: Optional[str] = None

    @field_validator('height', 'weight', mode='before')
    @classmethod
    def convert_to_string(cls, v):
        """Convert int to string for height and weight"""
        if isinstance(v, int):
            return str(v)
        return v


class AppearanceRequest(BaseModel):
    """Request model for appearance generation"""
    user_id: str
    race: str
    subrace: Optional[str] = None
    character_class: str
    background: Optional[str] = None  # Background is optional
    gender: Optional[str] = None


class AppearanceResponse(BaseModel):
    """Response model for appearance generation"""
    age: int
    gender: str
    height: Union[str, int]
    weight: Union[str, int]
    eyes: str
    skin: str
    hair: str
    distinguishingMarks: str

    @field_validator('height', 'weight', mode='before')
    @classmethod
    def convert_to_string(cls, v):
        """Convert int to string for height and weight"""
        if isinstance(v, int):
            return str(v)
        return v


class PersonalityRequest(BaseModel):
    """Request model for personality generation"""
    user_id: str
    race: str
    subrace: Optional[str] = None
    character_class: str
    background: Optional[str] = None  # Background is optional
    alignment: str


class PersonalityResponse(BaseModel):
    """Response model for personality generation"""
    traits: List[str]
    ideals: str
    bonds: str
    flaws: str
    otherTraits: Optional[str] = None
    backstory: Optional[str] = None


class BackstoryRequest(BaseModel):
    """Request model for backstory generation"""
    user_id: str
    race: str
    subrace: Optional[str] = None
    character_class: str
    background: Optional[str] = None
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    alignment: Optional[str] = None
    personality_traits: Optional[List[str]] = None
    ideals: Optional[str] = None
    bonds: Optional[str] = None
    flaws: Optional[str] = None


class AvatarGenerationRequest(BaseModel):
    """Request model for character avatar generation"""
    user_id: str
    race: str
    subrace: Optional[str] = None
    character_class: str
    background: Optional[str] = None
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    appearance_description: Optional[str] = None  # Eyes, skin, hair, etc.
    personality_traits: Optional[List[str]] = None
    reference_image: Optional[str] = None  # Current avatar URL, used as reference for equipment regen
    race_reference_image: Optional[str] = None  # Race/subrace image URL, used as soft visual reference
    equipment_description: Optional[str] = None  # Current equipped items description
    expression_description: Optional[str] = None  # Facial expression / mood description (e.g. "微笑", "怒目")


class AvatarGenerationResponse(BaseModel):
    """Response model for avatar generation"""
    success: bool
    image: str  # Base64 encoded image data URL
    prompt: str  # The prompt used for generation



class GenerateCharacterFromDescriptionRequest(BaseModel):
    """Request model for one-click character generation from free-form description"""
    user_id: str
    description: str
    campaign_id: Optional[str] = None  # If provided, broadcast progress via WebSocket


class DMGenerateHighLevelCharacterRequest(BaseModel):
    """Request model for DM to generate high-level character with AI-selected skills"""
    user_id: str
    description: str
    target_level: int = 5  # Default to level 5, range 1-20
    campaign_id: Optional[str] = None  # If provided, broadcast progress via WebSocket
