# Modules.py 重构指南

## 重构概述

将 `modules.py`（53KB）拆分为以下模块：

### 拆分计划

1. **module_raw.py** (~300行)
   - list_raw_files (62行)
   - upload_raw_file (78-245行)
   - delete_raw_file (695-756行)

2. **module_parse.py** (~450行)
   - parse_raw_file_ws (247-693行) - WebSocket解析端点
   - reparse_module_partial (876-997行)
   - generate_title_and_description (1150-1238行)

3. **module_crud.py** (~300行)
   - list_parsed_modules (758行)
   - get_parsed_module (999行)
   - get_parsed_module_markdown (1041行)
   - get_parsed_module_asset (1087行)
   - delete_parsed_module (825行)
   - update_module_title (1240行)
   - toggle_module_share (1269行)
   - list_shared_modules (1297行)
   - duplicate_module (1307行)

4. **module_tasks.py** (~100行)
   - update_task_progress (34行)
   - get_parse_task (770行)
   - get_task_by_task_id (782行)
   - stop_parse_task (794行)

## 主要复杂端点

### parse_raw_file_ws (~450行)
WebSocket端点，包含：
- PDF转Markdown
- 内容解析
- 怪物解析
- 物品解析
- 进度跟踪

建议进一步拆分为独立的解析服务类。

### upload_raw_file (~170行)
处理文件上传和元数据。

## 集成步骤

```python
# app/api/routes/modules/__init__.py
from fastapi import APIRouter
from .raw import router as raw_router
from .parse import router as parse_router
from .crud import router as crud_router
from .tasks import router as tasks_router

router = APIRouter(prefix="/modules", tags=["Modules"])

router.include_router(raw_router)
router.include_router(parse_router)
router.include_router(crud_router)
router.include_router(tasks_router)
```

## 依赖项

所有模块共享：
- MinIO客户端
- 解析器服务
- 任务追踪器
- AI服务

## 注意事项

1. WebSocket端点需要特殊处理
2. 保持MinIO操作原子性
3. 任务状态需要跨模块共享
