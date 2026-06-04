from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, Boolean, ForeignKey
from sqlalchemy.sql import func
from app.db.session import Base


class MonsterInstance(Base):
    """Monster Instance Model - Stores monster instances added to campaigns"""
    __tablename__ = "monster_instances"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)  # Which campaign this monster belongs to
    
    # Monster Reference (from monsters.json)
    monster_id = Column(String(100), nullable=False)  # ID from monsters.json
    name = Column(String(200), nullable=False)  # Monster name (English)
    name_cn = Column(String(200))  # Monster name (Chinese)
    
    # Entity type: "monster" (default) or "npc" for scene-generated NPCs
    entity_type = Column(String(20), default="monster")

    # Basic Stats (copied from monsters.json for quick access)
    size = Column(String(20))  # Tiny, Small, Medium, Large, Huge, Gargantuan
    type = Column(String(50))  # beast, humanoid, dragon, etc.
    alignment = Column(String(50))
    challenge_rating = Column(String(10))  # "0", "1/4", "1/2", "1", "2", etc.
    
    # Combat Stats
    armor_class = Column(Integer)
    hit_points = Column(Integer)
    hit_dice = Column(String(20))  # e.g., "2d8+2"
    
    # Abilities (JSON for flexibility)
    ability_scores = Column(JSON)  # {str, dex, con, int, wis, cha}
    speeds = Column(JSON)  # {walk: 30, fly: 60, swim: 30, etc.}
    
    # Full monster data (reference to monsters.json entry)
    monster_data = Column(JSON)  # Complete monster data from monsters.json
    
    # Avatar
    avatar_url = Column(Text)  # Small avatar (128x128) for 1x1 display
    avatar_url_large = Column(Text)  # Large avatar (512x512) for 2x2+ display
    has_avatar = Column(Boolean, default=False)  # Whether avatar has been generated
    
    # Instance-specific data
    current_hp = Column(Integer)  # Current HP (for tracking damage)
    conditions = Column(JSON)  # Array of condition strings: ["poisoned", "frightened", etc.]
    notes = Column(Text)  # DM notes about this specific instance

    # NPC Quests (only for entity_type='npc')
    # Format: [{"name": "Quest Name", "description": "...", "reward": "...", "status": "pending|in_progress|completed"}]
    quests = Column(JSON, default=list)

    # Inventory and Currency (for loot drops)
    # Format: [{"item_id": 123, "name": "Longsword", "name_cn": "长剑", "icon": "url", "quantity": 1, "category": "weapon", ...}]
    inventory = Column(JSON, default=list)
    # Format: {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
    currency = Column(JSON, default=dict)
    
    # Equipment (same format as character: EquipmentItem[])
    equipment = Column(JSON, nullable=True)
    # Status effects (same format as character: {effects, conditions, exhaustion_level, ...})
    status_effects = Column(JSON, nullable=True)

    # Spellcasting (DM-assigned spells for this monster instance)
    selected_spells = Column(JSON, nullable=True)    # ["fire_bolt","shield",...] selected spell IDs
    spell_slots = Column(JSON, nullable=True)         # [0,4,3,2,0,...] spell slot max per level (index=level)
    spell_slots_state = Column(JSON, nullable=True)   # [0,3,2,1,0,...] remaining spell slots

    # Token size on map (in grid units)
    # Format: "WxH" where W=width, H=height in grid squares
    # Examples: "1x1" (Medium), "2x2" (Large), "3x3" (Huge), "2x3" (rectangular)
    token_size = Column(String(10), default="1x1")

    # Companion/Summon control
    controller_character_id = Column(Integer, ForeignKey("characters.id", ondelete="SET NULL"), nullable=True, index=True)
    control_type = Column(String(20), nullable=True)  # companion/familiar/summon/mount

    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

