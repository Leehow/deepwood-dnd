from pydantic import BaseModel, ConfigDict
from typing import Optional, List


class ShopBase(BaseModel):
    campaign_id: int
    name: str
    description: Optional[str] = None
    appearance_description: Optional[str] = None
    gold_gp: int = 0
    accepts_selling: bool = True
    discount_rate: float = 0.5
    avatar_url: Optional[str] = None
    avatar_url_large: Optional[str] = None  # Large avatar for detail view
    has_avatar: bool = False


class ShopCreate(ShopBase):
    pass


class ShopUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    appearance_description: Optional[str] = None
    gold_gp: Optional[int] = None
    accepts_selling: Optional[bool] = None
    discount_rate: Optional[float] = None
    avatar_url: Optional[str] = None
    avatar_url_large: Optional[str] = None
    has_avatar: Optional[bool] = None


class ShopResponse(ShopBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class ShopInventoryBase(BaseModel):
    item_id: int
    quantity: int = 1
    price_gp: float = 0.0


class ShopInventoryCreate(ShopInventoryBase):
    pass


class ShopInventoryUpdate(BaseModel):
    quantity: Optional[int] = None
    price_gp: Optional[float] = None


class ShopInventoryResponse(ShopInventoryBase):
    id: int
    shop_id: int
    model_config = ConfigDict(from_attributes=True)


class ShopWithInventory(ShopResponse):
    inventory: List[ShopInventoryResponse] = []

