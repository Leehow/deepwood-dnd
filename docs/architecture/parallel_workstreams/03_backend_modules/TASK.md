# 工作包 03：后端模组主线

建议分支：`codex/parallel-backend-modules`

## 目标

继续拆 [module_chat.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/module_chat.py) 和 [modules.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/modules.py)，把 route 继续压成编排层。

## 当前状态

已经有一批 service/usecase 落地：

- `module_entity_service.py`
- `module_avatar_generation_service.py`
- `module_encounter_usecase_service.py`
- `module_encounter_planning_service.py`
- `module_snapshot_service.py`
- `module_task_flow_service.py`
- `module_extraction_stream_service.py`
- `module_parse_task_service.py`
- `module_parse_flow_service.py`
- `module_parse_websocket_service.py`
- `module_translation_service.py`

还没完全收口的地方：

- `module_chat.py` 的 planning / AI 编排残块
- `modules.py` 的 translate / parse / task orchestration 残块
- 某些 route 内仍然混着 payload shaping、task state、streaming 逻辑

## 允许修改

- `backend/app/api/routes/module_chat.py`
- `backend/app/api/routes/modules.py`
- `backend/app/services/module_*`
- `backend/tests/unit/test_module_*.py`

## 不要修改

- `backend/app/api/routes/combat.py`
- `backend/app/api/routes/characters.py`
- `frontend/**`
- `docs/architecture/*.md`

## 优先切口

1. `module_chat.py` 剩余 planning / AI output orchestration
2. `modules.py` 剩余 translate / parse task orchestration
3. focused pytest 补齐

## 验证命令

```bash
cd /Users/haoli/leehow/code/dw/backend
python -m py_compile app/api/routes/module_chat.py app/api/routes/modules.py app/services/module_*.py
PYTHONPATH=. pytest --noconftest tests/unit/test_module_*.py tests/unit/test_realtime_publisher.py
```

## 完成标准

- `module_chat.py` / `modules.py` 再进一步变薄
- 新逻辑继续进入 `module_*` service/usecase
- focused pytest 通过

## 交付格式

- 1 到 3 个逻辑清晰的 commit
- 最终说明里列出：
  - route 里挪走了哪些职责
  - 新增了哪些 `module_*` service
  - 实际跑过哪些命令
