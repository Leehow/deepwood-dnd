# 长重构自动续跑设计

这份文档记录 2026-03-21 这轮对 Deepwood 长重构执行模式的加固方案。

## 问题

仅靠 skill 文本里的“继续做”“不要停”这类提示，仍然可能出现过早结束：

- 一个批次做完后直接总结退出
- 把 `status` 写成 `done`，但同一热点其实还有明显下一刀
- prompt 里说了要继续，但没有机器可判断的续跑状态

根因不是 skill 完全没用，而是它本质上仍然是软约束。只要没有外层驱动器检查“这次到底应不应该停”，模型就可能在第一个方便的停点收尾。

## 目标

把“长重构应该继续还是停止”从纯文字约束，升级为：

1. skill 约束
2. repo 级 `AGENTS.md` 约束
3. 外层脚本驱动约束

其中第 3 层是硬边界。

## 方案

### 1. 统一状态文件

`scripts/run-dw-refactor.sh` 在每次运行时都会创建：

- `logs/refactor-runs/<run_id>/state.json`
- `logs/refactor-runs/<run_id>/handoff.md`

`state.json` 现在要求至少包含：

- `status`: `continue | done | blocked`
- `next_task`
- `current_hotspot`
- `remaining_queue`
- `handoff_summary`
- `scope_exhausted`
- `blocker`
- `completed_passes`
- `updated_at`

### 2. done 判定收紧

现在 `done` 不再只看模型主观总结，而是必须同时满足：

- `scope_exhausted = true`
- `remaining_queue` 为空，或只剩已经在 handoff 里明确解释的延期项

否则脚本会把这次结果改写回 `continue`，再自动拉起下一轮。

### 3. 过早结束防呆

脚本新增：

- 默认循环模式
- `--max-passes`
- `--min-passes`

默认 `min-passes = 2`，避免第一批只是一个窄 helper 抽取时就直接停掉。

### 4. skill / AGENTS 协议对齐

`$dw-big-refactor`、`$dw-modules-refactor` 和仓库根 `AGENTS.md` 统一要求：

- 如果提供了 state/handoff 文件，必须先读再写
- 默认 `status=continue`
- 只有 `scope_exhausted=true` 且队列清空时才允许 `done`
- 不能用“下一步是……”这种总结替代真正的续跑

## 当前行为

现在这套机制分成两层：

- skill 决定“怎么做”
- driver 决定“能不能停”

这意味着即使某一轮 skill 想过早收尾，只要状态不满足停机条件，driver 也会继续下一轮。

## 适用场景

优先用于：

- `module_chat.py`
- `modules.py`
- `combat.py`
- `characters.py`
- `campaign.$id.dm.tsx`
- `campaign.$id.player.tsx`
- `TacticalMap.client.tsx`

这类热点的共同特点是：

- 很难一刀切干净
- 每一批都需要 focused validation
- 一旦停早了，就会退回“做一半”的状态

## 后续可选增强

- 脚本根据 `remaining_queue` 自动生成下一轮 prompt 的更具体 slice
- 增加 `last_validation`、`completed_batches` 字段，方便 run 结束后直接审计
- 为 `modules` / `map` 再补更细的 run profile
