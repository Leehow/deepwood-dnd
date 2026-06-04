# Characters.py 重构指南

## 重构概述

将 `characters.py`（1394行）拆分为以下模块：

### 已完成模块

1. **character_utils.py** (~280行) ✅
   - 辅助计算函数
   - HP计算、法术位、属性修正
   - 数据规范化函数

2. **character_crud.py** (~230行) ✅
   - 基本CRUD操作
   - create_character
   - list_characters
   - get_character
   - get_character_sheet
   - update_character
   - partial_update_character
   - update_character_avatar
   - delete_character

### 待创建模块

3. **character_level.py** (~600行)
   - level_up_character (942-1283行)
   - level_down_character (591-763行)
   - reset_character_to_level_one (764-941行)

4. **character_generation.py** (~300行)
   - generate_from_description (1306-1539行)
   - apply_rest (1540-1594行)

## 集成步骤

### 步骤1：创建路由聚合器

```python
# app/api/routes/characters/__init__.py
from fastapi import APIRouter
from .crud import router as crud_router
from .level import router as level_router
from .generation import router as generation_router

router = APIRouter(prefix="/characters", tags=["Characters"])

# 包含所有子路由
router.include_router(crud_router)
router.include_router(level_router)
router.include_router(generation_router)
```

### 步骤2：更新主路由注册

```python
# app/main.py
from app.api.routes.characters import router as characters_router
app.include_router(characters_router)
```

### 步骤3：迁移测试

确保所有现有测试在重构后仍然通过：

```bash
pytest tests/test_characters.py -v
```

## 代码迁移清单

- [ ] 从原 characters.py 提取 level_up_character
- [ ] 从原 characters.py 提取 level_down_character
- [ ] 从原 characters.py 提取 reset_character_to_level_one
- [ ] 从原 characters.py 提取 generate_from_description
- [ ] 从原 characters.py 提取 apply_rest
- [ ] 更新导入语句
- [ ] 删除原 characters.py
- [ ] 运行完整测试套件
- [ ] 更新API文档

## 注意事项

1. **保持向后兼容**：所有API端点保持不变
2. **依赖注入**：确保 Depends(get_db) 正确传递
3. **WebSocket广播**：保持manager引用一致
4. **类型提示**：保持响应模型不变

## 模块依赖图

```
character_utils.py (无依赖)
       ↓
character_crud.py
       ↓
character_level.py (依赖 utils, crud)
       ↓
character_generation.py (依赖 utils)
```
