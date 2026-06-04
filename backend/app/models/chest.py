"""Chest Model for treasure chests in campaigns"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, JSON
from sqlalchemy.sql import func
from app.db.session import Base


class Chest(Base):
    """Chest model - Treasure chests with locks and traps"""
    __tablename__ = "chests"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)

    # Basic info
    name = Column(String(200), nullable=False)
    description = Column(Text)
    appearance_description = Column(Text)  # Used for AI avatar generation

    # State: "locked", "unlocked", "open", "looted"
    state = Column(String(20), default="locked")

    # Lock properties
    is_locked = Column(Boolean, default=True)
    lock_dc = Column(Integer, default=15)  # DC for lockpicking
    requires_key = Column(Boolean, default=False)
    key_name = Column(String(100), nullable=True)

    # Trap properties
    is_trapped = Column(Boolean, default=False)
    trap_detected = Column(Boolean, default=False)
    trap_disarmed = Column(Boolean, default=False)
    trap_triggered = Column(Boolean, default=False)
    trap_type = Column(String(50), nullable=True)  # poison_needle, fire_trap, alarm, acid_spray, etc.
    trap_detection_dc = Column(Integer, default=15)
    trap_disarm_dc = Column(Integer, default=15)
    trap_effect = Column(JSON, nullable=True)  # {damage, damage_type, save_dc, save_ability, effect_text}

    # Currency contents
    cp = Column(Integer, default=0)  # Copper pieces
    sp = Column(Integer, default=0)  # Silver pieces
    ep = Column(Integer, default=0)  # Electrum pieces
    gp = Column(Integer, default=0)  # Gold pieces
    pp = Column(Integer, default=0)  # Platinum pieces

    # Avatar
    avatar_url = Column(Text)  # Small avatar
    avatar_url_large = Column(Text)  # Large avatar
    has_avatar = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
