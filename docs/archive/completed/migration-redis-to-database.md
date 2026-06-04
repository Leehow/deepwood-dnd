# 角色选择持久化迁移：从Redis到数据库

## 概述

本次迁移将角色选择数据从Redis临时存储迁移到PostgreSQL数据库持久化存储，解决了数据一致性和可靠性问题。

## 问题背景

### 之前的设计缺陷

**使用Redis存储角色选择：**
- 数据存储在Redis中，格式：`campaign:{campaign_id}:user:{user_id}:selected_character`
- **问题1**：Redis数据可能丢失（重启、内存不足等）
- **问题2**：数据库和Redis之间没有同步机制
- **问题3**：无法保证数据完整性（没有外键约束）
- **问题4**：查询效率低（需要先查数据库再查Redis）

### 正确的设计

**使用数据库存储角色选择：**
- 在`campaign_members`表添加`selected_character_id`字段
- 外键约束指向`characters.id`，保证数据完整性
- 级联删除策略：角色被删除时自动设置为NULL
- 索引优化查询性能

## 实施步骤

### 1. 数据库迁移

**添加字段：**
```sql
ALTER TABLE campaign_members 
ADD COLUMN selected_character_id INTEGER;
```

**添加外键约束：**
```sql
ALTER TABLE campaign_members
ADD CONSTRAINT fk_campaign_members_selected_character
FOREIGN KEY (selected_character_id) 
REFERENCES characters(id) 
ON DELETE SET NULL;
```

**创建索引：**
```sql
CREATE INDEX ix_campaign_members_selected_character_id 
ON campaign_members(selected_character_id);
```

### 2. 更新数据模型

**`backend/app/models/campaign.py`：**
```python
class CampaignMember(Base):
    __tablename__ = "campaign_members"
    
    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, index=True, nullable=False)
    user_id = Column(String(50), index=True, nullable=False)
    role = Column(String(20), nullable=False)
    character_name = Column(String(100))
    selected_character_id = Column(Integer, index=True, nullable=True)  # 新增
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
```

### 3. 更新Schema

**`backend/app/schemas/campaign.py`：**
```python
class CampaignMemberBase(BaseModel):
    campaign_id: int
    user_id: str
    role: str = Field(..., pattern="^(dm|player)$")
    character_name: Optional[str] = None
    selected_character_id: Optional[int] = None  # 新增
```

### 4. 更新API端点

**之前（使用Redis）：**
```python
@router.get("/{campaign_id}/members/{user_id}/selected-character")
async def get_selected_character(
    campaign_id: int,
    user_id: str,
    redis: Redis = Depends(get_redis),
):
    key = f"campaign:{campaign_id}:user:{user_id}:selected_character"
    val = await redis.get(key)
    return {"selected_character_id": int(val) if val else None}
```

**现在（使用数据库）：**
```python
@router.get("/{campaign_id}/members/{user_id}/selected-character")
async def get_selected_character(
    campaign_id: int,
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == user_id
        )
    )
    member = result.scalar_one_or_none()
    
    if not member:
        raise HTTPException(status_code=404, detail="Campaign member not found")
    
    return {"selected_character_id": member.selected_character_id}
```

**PATCH端点增加了验证：**
- 验证角色是否存在
- 验证角色是否属于该用户
- 防止用户选择其他人的角色

### 5. 数据迁移

**执行迁移脚本：**
```bash
cd backend
source venv/bin/activate
python run_migration.py        # 创建数据库字段
python migrate_redis_to_db.py  # 迁移Redis数据到数据库
```

**迁移结果：**
- 成功迁移5条记录
- 跳过6条无数据记录
- 总共检查11条campaign_members记录

## 测试验证

### API测试

**获取选中角色：**
```bash
curl "http://localhost:8174/api/campaigns/3/members/user_0/selected-character"
# 返回: {"selected_character_id": 4}
```

**更新选中角色：**
```bash
curl -X PATCH "http://localhost:8174/api/campaigns/3/members/user_0/selected-character" \
  -H "Content-Type: application/json" \
  -d '{"character_id": 3}'
# 返回: {"selected_character_id": 3}
```

**验证持久化：**
```bash
curl "http://localhost:8174/api/campaigns/3/members/user_0/selected-character"
# 返回: {"selected_character_id": 3}  # 数据已持久化
```

### 数据库验证

**查看表结构：**
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'campaign_members'
ORDER BY ordinal_position;
```

**结果：**
```
id                             integer              NOT NULL
campaign_id                    integer              NOT NULL
user_id                        character varying    NOT NULL
role                           character varying    NOT NULL
character_name                 character varying    NULL
joined_at                      timestamp with time zone NULL
selected_character_id          integer              NULL  ← 新增字段
```

## 优势对比

### 之前（Redis）

❌ 数据可能丢失  
❌ 无数据完整性保证  
❌ 查询需要两步（数据库+Redis）  
❌ 无法使用SQL JOIN  
❌ 无法级联删除  

### 现在（数据库）

✅ 数据持久化，不会丢失  
✅ 外键约束保证数据完整性  
✅ 一次SQL查询获取所有数据  
✅ 可以使用JOIN优化查询  
✅ 自动级联删除（角色删除时设为NULL）  
✅ 支持事务，保证一致性  

## 文件清单

### 新增文件

1. `backend/alembic/versions/add_selected_character_to_campaign_members.py` - Alembic迁移文件（备用）
2. `backend/migrations/add_selected_character_id.sql` - SQL迁移脚本
3. `backend/run_migration.py` - 数据库迁移执行脚本
4. `backend/migrate_redis_to_db.py` - Redis到数据库数据迁移脚本
5. `docs/migration-redis-to-database.md` - 本文档

### 修改文件

1. `backend/app/models/campaign.py` - 添加`selected_character_id`字段
2. `backend/app/schemas/campaign.py` - 添加`selected_character_id`字段
3. `backend/app/api/routes/campaigns.py` - 重写GET/PATCH端点，使用数据库替代Redis

## 后续建议

### Redis的正确用途

Redis应该仅用于：
1. **缓存**：缓存频繁访问的数据（如角色详情）
2. **临时状态**：游戏中的临时状态（如当前回合、临时buff）
3. **实时数据**：WebSocket连接状态、在线用户列表

### 数据库的正确用途

数据库应该用于：
1. **持久化数据**：用户、角色、战役等核心数据
2. **关系数据**：需要外键约束的数据
3. **事务数据**：需要ACID保证的数据

## 总结

本次迁移成功解决了角色选择数据的持久化问题，提升了系统的可靠性和数据一致性。所有测试通过，系统运行正常。

**迁移状态：✅ 完成**  
**数据迁移：✅ 成功（5条记录）**  
**API测试：✅ 通过**  
**数据库验证：✅ 通过**

