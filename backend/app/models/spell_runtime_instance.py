"""First-class runtime state for active spell instances."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, func

from app.db.session import Base


class SpellRuntimeInstance(Base):
    __tablename__ = "spell_runtime_instances"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    spell_id = Column(String(100), nullable=False, index=True)
    spell_name = Column(String(200), nullable=False)

    caster_token_id = Column(Integer, ForeignKey("tokens.id", ondelete="CASCADE"), nullable=False, index=True)
    concentration_owner_token_id = Column(
        Integer,
        ForeignKey("tokens.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    primary_target_token_id = Column(
        Integer,
        ForeignKey("tokens.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    linked_target_token_ids = Column(JSON, nullable=True)

    selected_option = Column(String(100), nullable=True)
    params = Column(JSON, nullable=True)
    duration_rounds = Column(Integer, nullable=True)
    current_round = Column(Integer, nullable=False, default=0)
    expires_at_round = Column(Integer, nullable=True)
    status = Column(String(32), nullable=False, default="active", index=True)
    granted_actions = Column(JSON, nullable=True)
    host_entities = Column(JSON, nullable=True)
    ui_projection_version = Column(Integer, nullable=False, default=1)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
