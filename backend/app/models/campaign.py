from sqlalchemy import Column, String, DateTime, Integer, Text, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB

from app.db.session import Base


class Campaign(Base):
    """Campaign Model"""
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    dm_user_id = Column(String(50), index=True, nullable=False)  # DM (creator)
    max_players = Column(Integer, default=4)
    current_players = Column(Integer, default=0)
    level_range = Column(String(50))  # e.g., "1-5"
    status = Column(String(20), default="recruiting")  # recruiting, in_progress, completed
    description = Column(Text)
    # 'metadata' is a reserved attribute name in SQLAlchemy Declarative; map it as column name 'metadata' but attribute 'meta'
    meta = Column('metadata', JSONB, nullable=False, server_default='{}')  # Flexible per-campaign settings

    current_map_url = Column(Text)  # Current map URL for the campaign
    selected_module_id = Column(String(100))  # Selected module ID for the campaign
    cover_image = Column(Text, nullable=True)  # Cover image URL for campaign card

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class CampaignMember(Base):
    """Campaign Member Model"""
    __tablename__ = "campaign_members"
    __table_args__ = (
        UniqueConstraint('campaign_id', 'user_id', name='uq_campaign_members_campaign_user'),
    )

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id = Column(String(50), index=True, nullable=False)
    role = Column(String(20), nullable=False)  # dm, player
    character_name = Column(String(100))
    selected_character_id = Column(Integer, index=True, nullable=True)  # Foreign key to characters table
    is_virtual = Column(Boolean, default=False, server_default='false', nullable=False)
    display_name = Column(String(100), nullable=True)  # Virtual player display name
    notes = Column(JSONB, nullable=False, server_default='{}')  # Player notes: {quests, npcs, personal}
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
