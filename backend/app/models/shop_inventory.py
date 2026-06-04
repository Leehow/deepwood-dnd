from sqlalchemy import Column, Integer, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base


class ShopInventory(Base):
    """Shop inventory entries mapping items to a shop with stock and price"""
    __tablename__ = "shop_inventory"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id", ondelete="CASCADE"), index=True)  # FK to shops.id
    item_id = Column(Integer, ForeignKey("items.id", ondelete="CASCADE"), index=True)  # FK to items.id

    quantity = Column(Integer, default=1)
    price_gp = Column(Float, default=0.0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    item = relationship("Item", foreign_keys=[item_id], lazy="select")

