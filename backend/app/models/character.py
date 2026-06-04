from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, Boolean
from sqlalchemy.sql import func
from app.db.session import Base


class Character(Base):
    """Character Model - Stores player character sheets"""
    __tablename__ = "characters"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(50), index=True, nullable=False)  # Owner of the character

    # Basic Information
    name = Column(String(100), nullable=False)
    race_id = Column(String(50), nullable=False)
    subrace_id = Column(String(50))
    class_id = Column(String(50), nullable=False)
    subclass_id = Column(String(50))
    background_id = Column(String(50))
    level = Column(Integer, default=1)

    # Appearance & Description
    age = Column(Integer)
    gender = Column(String(20))
    alignment = Column(String(20))
    deity_id = Column(String(50))
    avatar = Column(Text)  # Small avatar URL (128x128)
    avatar_large = Column(Text)  # Large avatar URL (512x512)

    # Appearance details
    appearance = Column(JSON)  # {height, weight, eyes, skin, hair, distinguishingMarks}

    # Personality
    personality = Column(JSON)  # {traits[], ideals, bonds, flaws}
    other_traits = Column(Text)
    backstory = Column(Text)

    # Ability Scores
    ability_scores = Column(JSON)  # {strength, dexterity, constitution, intelligence, wisdom, charisma}

    # Skills & Proficiencies
    selected_skills = Column(JSON)  # Array of skill IDs
    expertise_skills = Column(JSON)  # Array of skill IDs (Rogue/Bard)

    # Class Features - stored as {value, level_acquired, source} or simple string
    fighting_style = Column(JSON)  # {value: "archery", level_acquired: 2, source: "ranger"}
    favored_enemy = Column(JSON)   # {value: "aberrations", level_acquired: 1, source: "ranger"}
    favored_humanoid_races = Column(JSON)  # Array of humanoid race IDs when favored_enemy is "humanoids"
    favored_terrain = Column(JSON) # {value: "forest", level_acquired: 1, source: "ranger"}
    eldritch_invocations = Column(JSON)  # Array of invocation IDs
    maneuvers_known = Column(JSON, nullable=True)  # Array of Battle Master maneuver IDs

    # Spells
    selected_cantrips = Column(JSON)  # Array of spell IDs
    selected_spells = Column(JSON)  # Array of spell IDs
    prepared_spells = Column(JSON)  # Array of spell IDs
    spell_slots_state = Column(JSON, nullable=True)  # Remaining spell slots per level (index = spell level)
    can_prepare_spells = Column(Boolean, default=True, server_default="true", nullable=False)  # Whether prepared casters can change prepared list (reset on long rest / level-up)
    quick_spells = Column(JSON, nullable=True)  # Array of 4 spell IDs for quick spell bar [id|null, id|null, id|null, id|null]

    # HP tracking
    current_hp = Column(Integer, nullable=True)  # Current HP; if NULL, use computed max HP

    # Class feature uses tracking (e.g., {rage: {current: 1, max: 2}, ki_points: {current: 3, max: 5}})
    class_feature_uses = Column(JSON, nullable=True)

    # Status effects (buff/debuff/conditions managed by DM)
    # {custom_effects: [...], active_conditions: [...], exhaustion_level: 0}
    status_effects = Column(JSON, nullable=True)

    # Hotbar slots for quick actions
    hotbar = Column(JSON, nullable=True)

    # Equipment
    equipment = Column(JSON)  # Array of equipment objects

    # Currency (wallet)
    currency = Column(JSON)  # {cp, sp, ep, gp, pp}

    # Progression & Multiclass
    experience_points = Column(Integer, default=0, nullable=False)
    milestone_level = Column(Integer, nullable=True)  # Override for milestone leveling
    multiclass_data = Column(JSON, nullable=True)  # Multiclass information
    level_history = Column(JSON, nullable=True)  # Array of level snapshots for rollback

    # Feature Choices
    subclass_choices = Column(JSON)  # {language, skills, cantrips, dragonType, etc.}
    race_choices = Column(JSON)  # {tool, skills, abilityScores, language}

    # Acquired feats (e.g., ["war_caster", "sentinel", "lucky"])
    feats = Column(JSON, nullable=True)
    feat_choices = Column(JSON, nullable=True)  # {feat_id: {选择数据}, e.g. {"resilient": {"abilityChoice": "constitution"}}}

    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

