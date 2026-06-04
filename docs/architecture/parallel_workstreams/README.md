# 并行 AI 工作流

当前基线分支：`codex/tacticalmap-phase3-refactor-20260321`

这套目录是给并行 AI 使用的工作包。拆分原则不是“按功能名拆”，而是“按写入边界拆”，避免多个 AI 同时修改同一批核心文件。

四个工作流：

1. [01_map_phase3/TASK.md](/Users/haoli/leehow/code/dw/docs/architecture/parallel_workstreams/01_map_phase3/TASK.md)
2. [02_backend_combat_character/TASK.md](/Users/haoli/leehow/code/dw/docs/architecture/parallel_workstreams/02_backend_combat_character/TASK.md)
3. [03_backend_modules/TASK.md](/Users/haoli/leehow/code/dw/docs/architecture/parallel_workstreams/03_backend_modules/TASK.md)
4. [04_test_hardening/TASK.md](/Users/haoli/leehow/code/dw/docs/architecture/parallel_workstreams/04_test_hardening/TASK.md)

通用规则：

- 每个 AI 只改自己工作包允许的路径。
- 不要顺手改别的热点文件。
- 不要提交 `.DS_Store`、`.playwright-cli/`、`tmp/`、`output/`、`frontend/build.predeploy*` 之类本地产物。
- 除非任务明确要求，不要修改 `docs/architecture/README.md`、`docs/architecture/REFACTORING_ROADMAP_2026.md`、`docs/architecture/MODULE_REFACTOR_BATCH_2026_03_21.md`。这些最好最后由整合者统一更新。
- 每条线都要自己跑最小验证，再交给整合者。
- 提交信息使用 conventional commit，例如 `refactor(frontend): ...`、`refactor(backend): ...`、`test(frontend): ...`。

建议合并顺序：

1. `02_backend_combat_character`
2. `03_backend_modules`
3. `01_map_phase3`
4. `04_test_hardening`
5. 最后由整合者统一跑全量关键验证并更新架构文档
