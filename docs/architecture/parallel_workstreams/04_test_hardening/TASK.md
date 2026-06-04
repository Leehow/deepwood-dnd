# 工作包 04：测试与保护网

建议分支：`codex/parallel-test-hardening`

## 目标

这一路只负责测试和回归保护，不做大规模业务重构。

## 当前状态

已经有不少 focused tests，但还不够：

- TacticalMap hook tests 已经很多
- 后端 `combat / character / module / realtime publisher` 已有一批 focused pytest
- Playwright 已能做登录和进入 DM 战役页的 smoke

还不够的地方：

- 缺少更稳定的前端页面级 smoke
- 缺少更多后端关键 API / 主链集成测试
- TacticalMap 新拆出的 controller 需要更系统化的覆盖

## 允许修改

- `frontend/tests/**`
- `backend/tests/**`
- 必要时少量 test helper / fixture / mock util

## 尽量不要修改

- 业务代码
- `frontend/app/**`
- `backend/app/**`

如果为了测试稳定性必须动业务代码，只允许做最小 testability patch，并在交付说明里单独标注。

## Playwright 要求

- 使用本地 Deepwood smoke 流程
- 不要把测试账号密码硬编码到仓库文件里
- 优先复用本地 Playwright skill / 本机已有登录流程

## 优先切口

1. TacticalMap / campaign 页最小 smoke
2. `combat.py` / `characters.py` 主链关键场景 pytest
3. 新增 hook/controller 的 focused tests 补齐缺口

## 验证命令

```bash
cd /Users/haoli/leehow/code/dw/frontend
npm run typecheck
npx vitest run tests/hooks tests/events

cd /Users/haoli/leehow/code/dw/backend
PYTHONPATH=. pytest --noconftest tests/unit
```

如果要跑 Playwright：

```bash
cd /Users/haoli/leehow/code/dw/frontend
npx playwright test frontend/tests --config=playwright.config.ts
```

## 完成标准

- 新增的测试覆盖的是“关键链路”，不是低价值快照
- 至少补一组页面级 smoke 或关键 API 集成测试
- 不把调试产物带进提交

## 交付格式

- 1 到 2 个 `test(...)` 或 `chore(test): ...` 风格 commit
- 最终说明里列出：
  - 新增了哪些测试
  - 覆盖了哪些风险点
  - 实际跑过哪些命令
