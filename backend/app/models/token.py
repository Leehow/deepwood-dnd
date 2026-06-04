"""Token Model for map tokens (per campaign, per map, per character/monster/item)"""
from sqlalchemy import Column, Integer, String, DateTime, func, UniqueConstraint, JSON, Float, ForeignKey
from app.db.session import Base


class Token(Base):
    __tablename__ = "tokens"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)

    # Token can be either a character, monster, or item
    character_id = Column(Integer, nullable=True, index=True)  # NULL for monster/item tokens
    monster_instance_id = Column(Integer, nullable=True, index=True)  # NULL for character/item tokens

    # Item token fields (NULL for character/monster tokens)
    item_data = Column(JSON, nullable=True)  # Stores item details (name, icon, quantity, etc.)
    item_quantity = Column(Integer, nullable=True)  # Quantity of items in this stack


    # Shop token (NULL for character/monster/item tokens)
    shop_id = Column(Integer, nullable=True, index=True)

    # Loot bag token (NULL for character/monster/item/shop tokens)
    # Created when a monster dies and has inventory/currency
    # Format: {
    #   "source_monster_id": 123, "source_name": "Goblin 1",
    #   "items": [{item_id, name, icon, quantity, ...}],
    #   "currency": {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
    #   "looted_by": ["user_id1", ...]
    # }
    loot_bag_data = Column(JSON, nullable=True)

    # Chest token (NULL for character/monster/item/shop/loot_bag tokens)
    chest_id = Column(Integer, nullable=True, index=True)

    user_id = Column(String(50), nullable=False, index=True)
    map_url = Column(String(500), nullable=False, index=True)
    position_x = Column(Integer, nullable=False)
    position_y = Column(Integer, nullable=False)

    # Token size on map (in grid units)
    # Format: "WxH" where W=width, H=height in grid squares
    # Examples: "1x1" (Medium), "2x2" (Large), "3x3" (Huge), "2x3" (rectangular)
    # For items, typically "0.5x0.5" (smaller than character tokens)
    token_size = Column(String(10), default="1x1")

    # Instance name for display (e.g., "地精1", "地精2", "长弓 x5")
    # For character tokens, this is the character name
    # For monster tokens, this is auto-generated (e.g., "Goblin 1", "Goblin 2")
    # For item tokens, this is the item name with quantity
    instance_name = Column(String(100), nullable=True)

    # Current HP for this token instance
    # For monsters, this allows each instance to have independent HP
    # For characters, this tracks their current HP on the map
    # NULL for item tokens
    current_hp = Column(Integer, nullable=True)

    # Temporary HP buffer (D&D 5E: absorbed before real HP, doesn't stack)
    temp_hp = Column(Integer, nullable=True)

    # Death saving throws tracker (for characters at 0 HP)
    # Format: {"successes": 0, "failures": 0, "stabilized": false}
    death_saves = Column(JSON, nullable=True)

    # Active status effects on this token (e.g., Rage, Bardic Inspiration)
    # Format: [{id, name, icon, color, source, expires_at?}]
    active_effects = Column(JSON, nullable=True)

    # Active auras emitted by this token (e.g., Paladin's Aura of Protection)
    # Format: [{"id": "aura_of_protection", "radius": 10, "source_cha_mod": 3}]
    active_auras = Column(JSON, nullable=True)

    # Faction for combat (allies share aura benefits)
    # "player" = player characters, "enemy" = hostile monsters, "neutral" = NPCs
    faction = Column(String(20), default="player")

    # Universal transformation data (Wild Shape, Polymorph, Enlarge/Reduce, etc.)
    # Format: {
    #   "source": {"config_id": "wild_shape"|"polymorph"|..., "source_type": "class_feature"|"spell", ...},
    #   "type": "full_replace"|"modifier"|"special_form",
    #   "form": {creature_id, creature_name, current_hp, max_hp, ac, size, speed, ability_scores, actions, ...},
    #   "modifiers": [{stat, operation, value}],      # for "modifier" type
    #   "formOverrides": {speed, resistances, ...},    # for "special_form" type
    #   "retainedStats": {mental, proficiencies, ...},
    #   "started_at": "2024-01-01T00:00:00Z"
    # }
    transformation_data = Column(JSON, nullable=True)

    # Concentration spell data - only one concentration spell can be active at a time
    # Format: {
    #   "spell_id": "fog_cloud",
    #   "spell_name": "云雾术",
    #   "slot_level": 1,
    #   "duration_rounds": 600,
    #   "current_round": 0,
    #   "affected_token_ids": [],
    #   "con_save_bonus": 5,           # Pre-computed CON save bonus
    #   "has_advantage": false,        # True if has War Caster feat
    #   "extra_bonus_source": null     # e.g., "战斗施法者"
    # }
    concentration_spell = Column(JSON, nullable=True)

    # Long casting / ritual casting state
    # Format: {
    #   "spell_id": "identify",
    #   "spell_name": "鉴定术",
    #   "slot_level": 1,
    #   "cast_mode": "normal"|"ritual",
    #   "base_casting_time": {"value": 1, "unit": "action"},
    #   "total_cast_seconds": 601,
    #   "started_at_campaign": {"day": 123, "hour": 14, "minute": 20, "second": 5},
    #   "finish_at_campaign": {"day": 123, "hour": 14, "minute": 30, "second": 6},
    #   "target_token_ids": [],
    #   "requires_concentration_during_cast": true,
    #   "breaks_existing_concentration": true,
    #   "started_by_user_id": "user_123",
    #   "status": "casting"
    # }
    casting_in_progress = Column(JSON, nullable=True)

    # Disguise/illusion appearance override (e.g., disguise_self, seeming)
    # Format: {
    #   "spell_id": "disguise_self",
    #   "spell_name": "易容术",
    #   "disguise_avatar": "https://oss.../illusion_xxx.png",
    #   "description": "一位高大的精灵法师",
    #   "caster_character_id": 5,
    #   "started_at": "2024-01-01T00:00:00Z"
    # }
    disguise_data = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        # Unique constraint for character tokens
        UniqueConstraint("campaign_id", "character_id", "map_url", name="uq_token_char_map"),
        # Note: Monster tokens can have multiple instances on the same map, so no unique constraint for them
    )
