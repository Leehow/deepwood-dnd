# 当前系统完善报告

日期：2026-03-20  
版本：双地图模式版  
范围：围绕当前系统的稳定性、可维护性、规则一致性和后续扩展能力进行评估与规划。  
说明：本报告不以 roguelike 或完整地城系统为当前目标，而是基于最新方向，对“DM 地图 / 地城地图”双模式做聚焦设计。

## 1. 执行摘要

当前系统最合理的演进方向，不是把所有地图玩法硬塞进一套规则里，而是明确拆成两种地图模式：

1. `DM 地图`
   保持轻便、自由、定制化强，继续服务跑团、战术演示、临时标注和高灵活度场景。

2. `地城地图`
   单独建立一套更严格但更简单的规则地图，只服务“像游戏一样跑格子”的玩法。

这两种地图不应该共用同一套复杂规则目标。

本次收敛后的关键判断如下：

1. `DM 地图` 继续沿用当前轻量地形标注模式，不追求强规则化。
2. `地城地图` 第一版只做最小闭环：
   - 基础地形
   - 墙体阻挡移动
   - 墙体阻挡视线
   - 体型占位与卡位
   - 基于真实路径的可达范围
3. 当前阶段明确不做：
   - 门
   - 闸门
   - 机关
   - 楼梯
   - 传送点
   - 陷阱
   - 宝箱交互扩展
   - 高低差
   - 动态地形
   - 房间触发器
   - 通用 interactable 系统

因此，当前系统最需要补强的不是“更复杂的世界对象”，而是下面四个基础件：

1. 双地图模式的边界与数据结构。
2. 地城地图的最小规则层。
3. 后端权威的移动、寻路和 LOS。
4. 更稳定的动作与战斗执行链路。

## 2. 当前方向修正

上一版分析偏向更完整的规则平台设计，适合长期演进，但对当前目标来说过宽。  
根据最新方向，当前系统应该优先做“必要收缩”，而不是“能力外扩”。

这次修正后的原则是：

1. 不追求一套地图系统覆盖所有未来玩法。
2. 不在当前阶段引入门、陷阱、机关等额外交互复杂度。
3. 不先做完整地城运行态。
4. 只把地城地图收敛到“可走、可挡、可卡体型、可判断视线”的程度。

这是一个正确的方向，因为它能明显降低实现复杂度，同时又能把当前系统中最薄弱的规则环节补上。

## 3. 当前系统已经具备的基础

当前系统已经有一些很强的基础，可以直接继续利用：

1. 地图渲染、网格、Token 放置、覆盖层和交互链路已经完整。
2. 战斗面板、回合顺序、行动消耗追踪已经存在。
3. 怪物动作已经开始结构化，不是纯文本黑盒。
4. 迷雾、光照、遮蔽等视觉层已经有基础。
5. 前后端实时同步和持久化链路已经具备。

这意味着当前最合理的方案不是重写，而是：

1. 保住 `DM 地图` 现有轻量能力。
2. 给 `地城地图` 单独补一套最小规则内核。

## 4. 核心判断

### 4.1 现有系统更适合做 `DM 地图`

当前地形系统更像“标注层”而不是“规则层”。

参考文件：

- `frontend/app/components/map/TerrainManager.ts`
- `frontend/app/components/map/TerrainLayer.tsx`
- `backend/app/models/map_terrain.py`
- `backend/app/api/routes/map_terrain.py`

它非常适合：

1. 临时涂抹困难地形。
2. 标识危险区域。
3. 表达遮蔽和掩护概念。
4. 供 DM 手工控制和解释。

这正是 `DM 地图` 需要的能力。  
所以这一套不应该被强行改造成高规则地城地图，而应该保留其轻便性。

### 4.2 `地城地图` 不能继续复用纯标注式地形

如果要做“像游戏一样”的地城地图，哪怕第一版只做最小玩法，也必须有明确规则语义。  
原因不是玩法复杂，而是这几个需求天然需要规则内核：

1. 墙体要挡移动。
2. 墙体要挡视线。
3. 大体型单位要被狭窄地形卡住。
4. 可达范围不能只按几何距离算。

这四件事都无法用当前纯标注式 `TerrainCell` 稳定完成。

结论：

1. `DM 地图` 可以继续用当前地形模型。
2. `地城地图` 必须单独定义简化规则模型。

## 5. 双地图模式设计建议

## 5.1 地图类型明确分层

建议引入：

```ts
type MapKind = "dm" | "dungeon";
```

两种地图的职责如下：

### `dm`

目标：

1. 轻便。
2. 灵活。
3. 快速标注。
4. 强定制。

特点：

1. 可以保留当前 `TerrainCell` 模型。
2. 可以继续允许更多人为解释空间。
3. 不要求严格路径、LOS、卡位一致性。

### `dungeon`

目标：

1. 规则清晰。
2. 行为可验证。
3. 可支持游戏式移动和战斗。

特点：

1. 规则比 `DM 地图` 更严格。
2. 但第一版范围必须很小。
3. 只服务固定的格子玩法，不追求高自由解释。

## 5.2 地城地图第一版范围

建议将 `地城地图` 第一版严格限制在以下能力：

1. `floor`
2. `wall`
3. `difficult`

以及四个核心规则：

1. `blocks_move`
2. `blocks_los`
3. `move_cost`
4. `footprint validation`

这就足以支持：

1. 走廊和房间。
2. 墙体遮挡。
3. 大体型单位通行受限。
4. 困难地形减速。
5. 基于真实路径的可达范围。

## 5.3 当前阶段明确排除项

下列内容在当前地城地图第一版中不建议纳入：

1. 门
2. 闸门
3. 机关
4. 楼梯
5. 传送点
6. 陷阱
7. 宝箱交互扩展
8. 高低差
9. 半墙和复杂掩体
10. 动态地形
11. 房间触发器
12. 通用 `Interactable` 系统

原因很简单：

1. 这些内容会快速抬高运行态复杂度。
2. 这些内容不是当前最小玩法闭环所必需。
3. 现在先补这些，会干扰最核心的规则层落地。

## 6. 地城地图第一版最小规则模型

## 6.1 建议的数据结构

```ts
type DungeonTileType = "floor" | "wall" | "difficult";

interface DungeonTile {
  x: number;
  y: number;
  type: DungeonTileType;
  moveCost: 1 | 2;
  blocksMove: boolean;
  blocksLos: boolean;
}

interface DungeonMapDefinition {
  kind: "dungeon";
  width: number;
  height: number;
  tiles: DungeonTile[];
}
```

如果考虑存储优化，也可以不按全量格子存储，而只记录非默认格。  
但语义上依然应该是“规则格子”，而不是“视觉涂层”。

## 6.2 Token 体型规则

当前系统已经有 `token_size` 的概念。  
地城地图第一版可以直接复用：

```ts
type TokenSize = "1x1" | "2x2" | "3x3";
```

卡体型第一版不需要额外做复杂规则。  
只要在移动和落点校验时，检查 Token footprint 是否完整落在可通行格上，窄走廊自然会挡住大体型单位。

也就是说，第一版不需要单独设计“卡体型系统”，只需要做对 footprint 校验。

## 6.3 墙体规则

地城地图第一版建议将墙体当作“整格墙”。

不要当前阶段就做：

1. 墙边界线段。
2. 自由绘制墙线。
3. 半格墙。
4. 斜墙。
5. 可破坏墙。

原因：

1. 整格墙最容易做路径和 LOS。
2. 最容易与占位规则保持一致。
3. 最容易做编辑器。
4. 最容易做后端权威校验。

## 7. 当前系统最需要补强的部分

## 7.1 地图模式分离

### 现状

当前地图相关能力没有明确区分 `DM 地图` 与 `地城地图` 的运行目标。

### 问题

如果继续把这两类地图混在一套模型里，会出现：

1. 轻量场景被规则复杂度拖累。
2. 严格地城场景又拿不到足够稳定的规则支持。

### 建议

新增地图模式区分：

1. `dm`
2. `dungeon`

并明确：

1. `dm` 继续走轻量标注路线。
2. `dungeon` 走最小规则路线。

### 目标

避免“一套地图系统试图做两种完全不同的事情”。

## 7.2 地城地图的后端权威移动

### 现状

当前移动主要由前端判断，后端位置更新接口基本直接落库。

参考文件：

- `frontend/app/components/map/hooks/useKeyboardMovement.ts`
- `frontend/app/components/map/hooks/useMapEvents.ts`
- `frontend/app/components/map/TacticalMap.client.tsx`
- `backend/app/api/routes/tokens.py`

### 问题

在 `地城地图` 下，这种模式不够。

因为以下判断不能再只靠前端：

1. 目标位置是否可站立。
2. 体型 footprint 是否越界或压墙。
3. 经过路径是否被墙阻挡。
4. 困难地形代价是否正确。

### 建议

新增地城模式下的后端移动规则服务：

- `validate_dungeon_move`
- `find_dungeon_path`
- `get_dungeon_reachable_cells`

服务只需要处理当前最小范围：

1. 墙体阻挡
2. 困难地形代价
3. 体型占位
4. 边界检查

不要把门、陷阱、机关逻辑混进来。

### 目标

地城模式下，所有移动都经过统一规则校验。

## 7.3 寻路与可达范围

### 现状

当前范围覆盖层仍以几何距离为主：

- `frontend/app/components/map/MovementRangeOverlay.tsx`
- `frontend/app/components/map/AttackRangeOverlay.tsx`

### 问题

只按几何距离展示会造成：

1. 看上去能到，但实际上被墙挡住。
2. 大体型单位显示可达，但实际塞不进去。
3. 困难地形不会真实影响可达范围。

### 建议

补独立寻路服务，支持：

1. 格子成本
2. footprint 占位
3. 墙体阻挡
4. 边界检查

输出：

- `path`
- `cost`
- `reachable_cells`
- `blocked_reason`

前端移动范围覆盖层和点击移动都应复用同一结果。

### 目标

让“可达范围”真正代表规则上的可达，而不是视觉估算。

## 7.4 LOS 与墙体遮挡

### 现状

当前光照、迷雾、遮蔽更偏视觉层，攻击范围也主要是距离层。

参考文件：

- `frontend/app/components/map/FogOfWarManager.ts`
- `frontend/app/components/map/IlluminationLayer.tsx`
- `frontend/app/components/map/NightOverlayLayer.tsx`
- `frontend/app/components/map/utils/obscurementUtils.ts`

### 问题

地城地图第一版即使不做复杂视野，也至少需要：

1. 墙挡视线
2. 墙挡攻击判定
3. 墙挡目标选择

### 建议

地城模式下增加一套最小 LOS 服务：

- `has_line_of_sight(source, target, dungeon_map)`

当前阶段只做：

1. 是否被墙阻挡
2. 是否允许作为攻击/施法目标

当前阶段不做：

1. 半掩护
2. 3/4 掩护
3. 黑暗视觉
4. 潜行感知
5. 噪音系统

### 目标

先建立“墙体真的会挡视线”的最小规则闭环。

## 7.5 动作执行链路

### 现状

后端已经开始对怪物动作结构化，前端也能消费这些动作。  
但前端仍然存在描述文本 fallback 解析，动作执行链路不够纯净。

参考文件：

- `backend/app/services/monster_parser_service.py`
- `backend/app/models/monster_instance.py`
- `frontend/app/components/map/TokenStatsTab.tsx`
- `frontend/app/components/map/SelectionContextMenu.tsx`
- `frontend/app/components/map/TacticalMap.client.tsx`

### 问题

即使当前不做 AI，动作执行也已经值得收拢。  
否则后续一旦地城地图引入真实 LOS 和路径，前端拼装逻辑会越来越脆。

### 建议

当前阶段不必把动作系统做成超大框架，但至少要完成：

1. 动作字段尽量结构化。
2. 攻击、命中、伤害由后端完成核心结算。
3. 地城模式下，动作合法性接入 LOS 和目标可达性判断。

### 目标

让动作系统与地图规则系统逐步接轨，而不是互相独立。

## 7.6 战斗状态管理

### 现状

当前战斗状态已经可用，但主要存在通用 `campaign_storage` JSON 数据中。

参考文件：

- `frontend/app/components/combat/CombatPanel.tsx`
- `backend/app/models/campaign_storage.py`
- `backend/app/api/routes/campaign_storage.py`

### 问题

短期内这套方案还能继续用，但如果地城地图要引入：

1. 真实路径
2. 真实 LOS
3. 更严格的动作合法性

那么战斗推进和结果结算就不能再主要由前端主导。

### 建议

当前阶段不要求立刻重做存储，但建议：

1. 保留现有战斗状态数据结构。
2. 新增更明确的后端结算入口。
3. 让“移动是否成功、攻击是否合法、目标是否可见”这些关键判断由后端给结果。

### 目标

先把战斗从“前端主导”往“后端主导”收一步，而不是一步到位重构全部存储。

## 7.7 前端职责边界

### 现状

大量地图、战斗、交互、覆盖层逻辑集中在：

- `frontend/app/components/map/TacticalMap.client.tsx`

### 问题

如果地城规则也继续堆进这个大组件，后面会更难维护。

### 建议

前端在地城模式下尽量只负责：

1. 采集输入
2. 请求规则判断
3. 展示路径、范围和结算结果
4. 处理本地交互状态

而不要继续让前端成为规则主导者。

### 目标

减少地图大组件继续膨胀的风险。

## 7.8 测试

### 现状

当前很多关键规则逻辑仍然分散，不利于精确测试。

### 建议

围绕地城地图第一版，优先补以下测试：

1. footprint 落点测试
2. 墙体阻挡移动测试
3. 困难地形代价测试
4. 可达范围测试
5. LOS 测试
6. 攻击合法性测试

当前阶段不需要先补门、陷阱、机关状态机测试，因为这些内容明确不在范围内。

### 目标

让最小规则闭环先具备可回归性。

## 8. 设计原则

## 8.1 双模式优先，不强行统一

`DM 地图` 和 `地城地图` 的目标不同，允许它们在数据结构和规则严格性上不同。

## 8.2 地城模式优先做最小闭环

先把“可走、可挡、可卡位、可判断 LOS”做稳，再考虑更复杂地图对象。

## 8.3 规则后端权威

凡是影响行为合法性的判断，优先由后端或统一规则服务负责。

## 8.4 前端只做表现和交互，不继续堆规则

地城模式下，范围展示、目标选择、移动结果都应尽量依赖后端规则结果。

## 8.5 当前明确拒绝过度设计

当前阶段不为了未来可能的玩法，提前引入门、机关、陷阱、通用交互物框架。

## 9. 目标架构建议

在当前方向下，建议目标架构收敛为四层，而不是过大的泛化平台：

## 9.1 Map Modes

1. `DM Map`
2. `Dungeon Map`

## 9.2 Rules Layer

包含：

1. 地城地块规则
2. 寻路
3. footprint 校验
4. LOS
5. 动作合法性校验

## 9.3 Combat Layer

包含：

1. 回合推进
2. 攻击结算
3. 伤害与状态结算

## 9.4 Presentation Layer

包含：

1. 地图前端
2. 覆盖层
3. 战斗面板
4. 动画与日志

## 10. 分阶段设计规划

## 阶段 0：明确双地图模式

### 目标

先把 `DM 地图` 和 `地城地图` 的边界画清楚。

### 工作项

1. 增加 `map_kind` 概念。
2. 确认 `DM 地图` 继续沿用当前轻量地形模型。
3. 输出 `地城地图` 第一版 schema 草案。

### 产出

1. `map_kind = dm | dungeon`
2. 地城地图最小 schema
3. 双模式职责说明

## 阶段 1：地城地图 schema 与编辑器

### 目标

先把地城地图的数据模型和基础编辑能力做出来。

### 工作项

1. 定义 `floor / wall / difficult`
2. 支持基础刷图
3. 支持地图尺寸和规则格存储
4. 不引入门、陷阱、机关对象

### 验收标准

1. 可以编辑一张只有地板、墙和困难地形的地城地图
2. 地城地图与 `DM 地图` 数据结构分离

## 阶段 2：移动、寻路、卡体型

### 目标

让地城地图具备最基础的“游戏式移动”能力。

### 工作项

1. footprint 落点校验
2. 路径搜索
3. 困难地形代价
4. 可达范围服务

### 验收标准

1. 真实可达范围替代几何估算范围
2. 大体型单位会被窄路卡住

## 阶段 3：LOS 与攻击合法性

### 目标

让墙体真正影响目标选择和攻击。

### 工作项

1. 增加 LOS 服务
2. 攻击/施法目标选择接入 LOS
3. 攻击范围展示与实际合法性对齐

### 验收标准

1. 被墙挡住的目标不可直接选中
2. 攻击范围不再只是距离圈

## 阶段 4：动作与战斗执行收拢

### 目标

让地图规则和动作执行开始统一。

### 工作项

1. 前端减少 fallback 规则拼装
2. 后端承担更多攻击与合法性判断
3. 将地城模式的移动和攻击判断统一接入后端

### 验收标准

1. 地城模式下，关键动作合法性不再依赖前端猜测
2. 地图规则和战斗执行开始闭环

## 阶段 5：测试与稳定化

### 目标

给最小规则闭环建立稳定回归面。

### 工作项

1. 路径测试
2. LOS 测试
3. footprint 测试
4. 可达范围测试
5. 地城模式战斗合法性测试

### 验收标准

1. 地城地图规则改动可回归验证
2. 不需要每次依赖人工地图试错

## 11. 优先级建议

### P0：当前最应该做的

1. `map_kind` 设计
2. 地城地图最小 schema
3. 后端路径与落点校验
4. LOS 服务
5. 地城模式移动与攻击合法性接入

### P1：紧随其后

1. 前端覆盖层改为复用真实规则结果
2. 动作执行链路收拢
3. 地城地图测试体系

### P2：后续再考虑

1. 更复杂的地城对象
2. AI 决策接入
3. 更复杂的探索玩法

## 12. 当前不建议做的事情

当前阶段不建议优先做以下事项：

1. 继续把 `DM 地图` 和 `地城地图` 混在一套规则模型里。
2. 给地城地图第一版加入门、闸门、机关、楼梯、传送点。
3. 给地城地图第一版加入陷阱系统。
4. 先做通用交互物框架。
5. 先做高低差、动态地形、复杂掩体。
6. 继续让前端承担越来越多规则判断。
7. 先做 AI，再回头补基础规则。

## 13. 推荐的近期落地顺序

如果以“当前系统完善”为目标，建议按以下顺序推进：

1. 先把地图正式拆成 `DM 地图 / 地城地图` 双模式。
2. 给 `地城地图` 单独定义最小 schema。
3. 实现 footprint 校验和寻路服务。
4. 实现墙体 LOS。
5. 让移动范围、攻击判定接入真实规则结果。
6. 再收拢动作和战斗执行链路。

这个顺序的好处是：

1. 先解决地图模式冲突。
2. 再解决最核心的规则空洞。
3. 最后才处理战斗链路和扩展问题。

## 14. 结论

当前系统真正需要的，不是一个“大而全的地城系统”，而是一次明确的能力收缩。

最关键的判断是：

1. `DM 地图` 继续轻量，不强规则化。
2. `地城地图` 单独建模，但第一版只做最小规则。
3. 当前最重要的是墙、路径、LOS、卡体型。
4. 当前明确不做门、陷阱、机关、传送点这类对象系统。

只要按这个方向推进，当前系统会立刻变得更清晰：

1. `DM 地图` 不会被复杂规则拖累。
2. `地城地图` 又能具备真正可玩的最小规则闭环。
3. 后续如果再加 AI，也会站在更稳定的规则基础上。

## 15. 参考代码位置

以下文件是本报告分析时重点参考的位置：

### 地图与地形

- `frontend/app/components/map/TerrainManager.ts`
- `frontend/app/components/map/TerrainLayer.tsx`
- `backend/app/models/map_terrain.py`
- `backend/app/api/routes/map_terrain.py`
- `backend/app/models/map_settings.py`

### 移动与范围

- `frontend/app/components/map/hooks/useKeyboardMovement.ts`
- `frontend/app/components/map/hooks/useMapEvents.ts`
- `frontend/app/components/map/TacticalMap.client.tsx`
- `frontend/app/components/map/MovementRangeOverlay.tsx`
- `frontend/app/components/map/AttackRangeOverlay.tsx`
- `backend/app/api/routes/tokens.py`

### 视野、光照、迷雾、遮蔽

- `frontend/app/components/map/FogOfWarManager.ts`
- `frontend/app/components/map/IlluminationLayer.tsx`
- `frontend/app/components/map/NightOverlayLayer.tsx`
- `frontend/app/components/map/utils/obscurementUtils.ts`

### 战斗与状态

- `frontend/app/components/combat/CombatPanel.tsx`
- `backend/app/models/campaign_storage.py`
- `backend/app/api/routes/campaign_storage.py`

### 怪物动作与执行

- `backend/app/services/monster_parser_service.py`
- `backend/app/models/monster_instance.py`
- `frontend/app/components/map/TokenStatsTab.tsx`
- `frontend/app/components/map/SelectionContextMenu.tsx`
- `frontend/app/components/map/TacticalMap.client.tsx`

### 内容资产与地图生成

- `backend/app/services/map_generation_service.py`
- `frontend/app/data/creator/dungeons.json`
- `frontend/app/data/rules/encounter-tables.json`
