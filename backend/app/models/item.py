from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, Float, Boolean, ForeignKey
from sqlalchemy.sql import func
from app.db.session import Base


class Item(Base):
    """Item Model - Stores items in campaign resource library"""
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)  # Which campaign this item belongs to
    
    # Basic Information (from equipment.json)
    name = Column(String(200), nullable=False)
    name_cn = Column(String(200))  # Chinese name
    category = Column(String(50))  # weapon, armor, adventuring_gear, tool, etc.
    subcategory = Column(String(50))  # simple_melee, martial_ranged, light_armor, etc.
    
    # Item Properties
    cost = Column(JSON)  # {amount: number, unit: "gp"}
    weight = Column(Float)  # Weight in pounds
    rarity = Column(String(50))  # common, uncommon, rare, very_rare, legendary, artifact
    
    # Weapon Properties (if applicable)
    damage = Column(JSON)  # {dice: "1d8", type: "slashing"}
    properties = Column(JSON)  # Array of property strings: ["versatile", "finesse", etc.]
    range = Column(JSON)  # {normal: 20, long: 60} for ranged weapons
    
    # Armor Properties (if applicable)
    armor_class = Column(JSON)  # {base: 11, dex_bonus: true, max_dex_bonus: 2}
    strength_requirement = Column(Integer)  # Minimum strength to wear
    stealth_disadvantage = Column(Boolean, default=False)
    
    # Description
    description = Column(Text)  # Item description
    description_cn = Column(Text)  # Chinese description

    # Custom fields
    quantity = Column(Integer, default=1)  # How many of this item
    notes = Column(Text)  # DM notes about this item
    is_custom = Column(Boolean, default=False)
    avatar_url = Column(Text)  # Small avatar (128x128)
    avatar_url_large = Column(Text)  # Large avatar (512x512)
    has_avatar = Column(Boolean, default=False)

    # === Magic Item Fields ===
    # Attunement
    requires_attunement = Column(Boolean, default=False)
    attunement_by = Column(String(200))  # "spellcaster", "warlock", etc.

    # Magic bonus (+1/+2/+3 for weapons/armor)
    magic_bonus = Column(Integer)

    # Extra damage (e.g., {"dice": "2d6", "type": "necrotic"})
    extra_damage = Column(JSON)

    # Special abilities array
    # [{"name": "...", "name_en": "...", "type": "passive/active/rechargeable", "description": "..."}]
    abilities = Column(JSON)

    # Charges system
    # {"max": 7, "current": 7, "recharge": {"time": "dawn", "amount": "1d6+1"}, "on_zero": {...}}
    charges = Column(JSON)

    # Item spells
    # [{"name": "...", "name_en": "...", "charges": 1, "level": 1, "save_dc": 15}]
    item_spells = Column(JSON)

    # Sentient item properties
    # {"is_sentient": true, "alignment": "neutral_evil", "languages": [...]}
    sentient = Column(JSON)

    # Source module tracking
    source_module = Column(String(200))

    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

