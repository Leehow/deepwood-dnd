# Typecheck Remediation Plan

目标：分阶段清理前端 `npm run typecheck` 报错，将类型债务逐步消化，避免一次性破坏大范围功能。

## 现状快照（2025-02）
- `tsc` 失败，报错主要集中在：
  - 组件用法与 Radix 类型不匹配（`asChild` 等）。
  - 角色/地图/战斗等领域模型类型缺少字段或可空性定义。
  - 辅助工具/服务层导出或签名缺失（老的 `services/index.ts`、工具函数参数不匹配）。
  - 测试依赖类型缺失（`vitest`）。
  - 个别新改动遗漏导入（如 `apiFetch`）但不影响运行时。

## 分阶段拆解
### Phase 1：快速修复（低风险，≤0.5d）
- 补全遗漏的导入/导出和简单签名：
  - `apiFetch` 未导入的文件（如 `AddItemModal.tsx` 等）。
  - `services/index.ts` 导出缺失或构造函数参数缺失导致的报错。
- 处理 Radix `asChild` 类型报错：统一使用 Radix 官方推荐写法（`asChild` 仅限支持组件，或改为包裹按钮）。
- 更新少量工具函数调用参数数量，使之与定义一致（`useMapWebSocket`、`mapCalculations` 等）。

### Phase 2：领域类型补全（中风险，1–2d，可按模块拆分）
- 角色/战斗/地图模型：
  - 为 `Character`、`Token`、`CombatState` 等补全字段（如 `gender`、`alignment`、`experience_points` 等）和可空性。
  - 调整使用处的类型守卫，降低强制断言。
- 模块管理类型：
  - `ParseResult` 补充 `images`、`images_count` 等字段。
  - 标记接口返回 `unknown` 的位置，添加显式类型。

### Phase 3：测试与工具链收敛（中风险，0.5–1d）
- 安装/声明缺失的测试类型依赖（`vitest`）。
- 清理不再使用的服务/工具条目，确保导出与调用一致。

### Phase 4：收尾与防回归（低风险，≤0.5d）
- 全量 `npm run typecheck`、`npm run lint`。
- 补充必要的类型注释与守卫，避免回退。
- 文档化关键模型的最小字段要求（角色、地图、战斗）。

## 约束与注意事项
- 保持改动可回溯：按阶段提交，避免一次性大合并。
- 优先修复与运行时关联度高的类型，低优先处理 UI 纯类型噪声。
- 变更模型类型时，同步检查相关后端接口契约（必要时补充 TODO 注释或转换层）。 
