"""ChestInventory Model - Items contained in a chest"""
from sqlalchemy import Column, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base


class ChestInventory(Base):
    """Chest inventory entries mapping items to a chest"""
    __tablename__ = "chest_inventory"

    id = Column(Integer, primary_key=True, index=True)
    chest_id = Column(Integer, ForeignKey("chests.id", ondelete="CASCADE"), index=True, nullable=False)
    item_id = Column(Integer, ForeignKey("items.id", ondelete="CASCADE"), index=True, nullable=False)
    quantity = Column(Integer, default=1)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    item = relationship("Item", foreign_keys=[item_id], lazy="select")
