# 工作包 02：后端战斗 / 角色主线

建议分支：`codex/parallel-backend-combat-character`

## 目标

继续把 [combat.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/combat.py) 和 [characters.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/characters.py) 从“超胖 route”往 service-first 继续推进。

## 当前状态

已经落地的第一批 service：

- [combat_attack_service.py](/Users/haoli/leehow/code/dw/backend/app/services/combat_attack_service.py)
- [combat_resolution_service.py](/Users/haoli/leehow/code/dw/backend/app/services/combat_resolution_service.py)
- [combat_spell_service.py](/Users/haoli/leehow/code/dw/backend/app/services/combat_spell_service.py)
- [character_command_service.py](/Users/haoli/leehow/code/dw/backend/app/services/character_command_service.py)
- [character_progression_service.py](/Users/haoli/leehow/code/dw/backend/app/services/character_progression_service.py)
- [realtime_publisher.py](/Users/haoli/leehow/code/dw/backend/app/services/realtime_publisher.py)

还没做透的地方：

- `combat.py` 剩余的 route-level orchestration 和结果组装残块
- `characters.py` 剩余的高频写路径
- 某些 response / broadcast / db-write 混在 route 里的分支

## 允许修改

- `backend/app/api/routes/combat.py`
- `backend/app/api/routes/characters.py`
- `backend/app/services/combat_*`
- `backend/app/services/character_*`
- `backend/tests/unit/test_combat_*`
- `backend/tests/unit/test_character_*`

## 不要修改

- `backend/app/api/routes/module_chat.py`
- `backend/app/api/routes/modules.py`
- `frontend/**`
- `docs/architecture/*.md`

## 优先切口

1. `combat.py` 中剩余的 route-level follow-up / result construction
2. `characters.py` 中剩余的资源、装备、状态写回分支
3. 为新增 service 补 focused pytest

## 验证命令

```bash
cd /Users/haoli/leehow/code/dw/backend
python -m py_compile app/api/routes/combat.py app/api/routes/characters.py app/services/combat_*.py app/services/character_*.py
PYTHONPATH=. pytest --noconftest tests/unit/test_combat_*.py tests/unit/test_character_*.py tests/unit/test_realtime_publisher.py
```

## 完成标准

- `combat.py` / `characters.py` 再明显变薄
- 新逻辑进入 service 层
- 不新增 route 级直接广播
- focused pytest 通过

## 交付格式

- 1 到 3 个逻辑清晰的 commit
- 最终说明里列出：
  - 新增了哪些 service
  - route 中移走了哪些职责
  - 实际跑过哪些 pytest / py_compile
