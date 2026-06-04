# D&D 5E 兼职系统补充设计 - Multiclassing Supplement

## 概述

本文档为经验系统设计的补充，完整支持D&D 5E的兼职（Multiclassing）规则。兼职允许角色在升级时选择不同的职业，实现多样化的角色构建。

## 1. 核心规则实现

### 1.1 兼职规则要点
- **总等级计算**：角色等级 = 所有职业等级之和
- **经验值计算**：始终基于总等级，不考虑单个职业等级
- **属性先决条件**：兼职需满足原职业和新职业的最低属性要求
- **灵活升级**：每次升级可选择提升任意已有职业或开始新职业

### 1.2 职业先决条件配置
```json
// frontend/app/data/rules/multiclass-requirements.json
{
  "prerequisites": {
    "barbarian": { "strength": 13 },
    "bard": { "charisma": 13 },
    "cleric": { "wisdom": 13 },
    "druid": { "wisdom": 13 },
    "fighter": { "or": [{ "strength": 13 }, { "dexterity": 13 }] },
    "monk": { "dexterity": 13, "wisdom": 13 },
    "paladin": { "strength": 13, "charisma": 13 },
    "ranger": { "dexterity": 13, "wisdom": 13 },
    "rogue": { "dexterity": 13 },
    "sorcerer": { "charisma": 13 },
    "warlock": { "charisma": 13 },
    "wizard": { "intelligence": 13 }
  }
}
```

## 2. 数据库设计更新

### 2.1 Character表扩展
```python
# backend/app/models/character.py
class Character(Base):
    __tablename__ = "characters"

    # 现有字段
    class_id = Column(String(50))  # 主职业（用于兼容旧数据）
    level = Column(Integer, default=1)  # 总等级
    experience_points = Column(Integer, default=0)

    # 新增兼职字段
    multiclass_data = Column(JSON)
    # 格式: {
    #   "classes": [
    #     {"class_id": "fighter", "level": 4, "subclass_id": "champion"},
    #     {"class_id": "rogue", "level": 2, "subclass_id": null}
    #   ],
    #   "level_history": [
    #     {"level": 1, "class": "fighter", "timestamp": "2024-01-01T00:00:00Z"},
    #     {"level": 2, "class": "fighter", "timestamp": "2024-01-02T00:00:00Z"},
    #     ...
    #   ]
    # }
```

### 2.2 数据库迁移
```python
# backend/alembic/versions/add_multiclass_support_20251114.py
def upgrade():
    # 添加兼职数据字段
    op.add_column('characters',
        sa.Column('multiclass_data', sa.JSON(), nullable=True)
    )

    # 迁移现有数据到新格式
    connection = op.get_bind()
    result = connection.execute(
        text("SELECT id, class_id, subclass_id, level FROM characters WHERE class_id IS NOT NULL")
    )

    for row in result:
        multiclass_data = {
            "classes": [{
                "class_id": row.class_id,
                "level": row.level,
                "subclass_id": row.subclass_id
            }],
            "level_history": []
        }

        connection.execute(
            text("UPDATE characters SET multiclass_data = :data WHERE id = :id"),
            {"data": json.dumps(multiclass_data), "id": row.id}
        )
```

## 3. 前端实现

### 3.1 兼职管理Hook
```typescript
// frontend/app/hooks/useMulticlass.ts
interface ClassLevel {
  class_id: string;
  level: number;
  subclass_id?: string;
}

interface MulticlassData {
  classes: ClassLevel[];
  level_history: Array<{
    level: number;
    class: string;
    timestamp: string;
  }>;
}

export function useMulticlass(character: Character) {
  const multiclassData = character.multiclass_data || createDefaultMulticlassData(character);

  // 计算总等级
  const totalLevel = multiclassData.classes.reduce((sum, c) => sum + c.level, 0);

  // 检查是否可以兼职特定职业
  const canMulticlass = (newClass: string): boolean => {
    const requirements = multiclassRequirements[newClass];
    if (!requirements) return false;

    // 检查属性要求
    return checkAttributeRequirements(character.ability_scores, requirements);
  };

  // 获取可用的兼职选项
  const getAvailableClasses = (): string[] => {
    return Object.keys(multiclassRequirements).filter(className =>
      canMulticlass(className)
    );
  };

  // 格式化显示（如 "战士4/游荡者2"）
  const getClassDisplay = (): string => {
    return multiclassData.classes
      .map(c => `${getClassName(c.class_id)}${c.level}`)
      .join('/');
  };

  return {
    multiclassData,
    totalLevel,
    canMulticlass,
    getAvailableClasses,
    getClassDisplay,
    isMulticlassed: multiclassData.classes.length > 1
  };
}
```

### 3.2 升级选择界面
```typescript
// frontend/app/components/character/LevelUpModal.tsx
interface LevelUpModalProps {
  character: Character;
  newLevel: number;
  onConfirm: (classChoice: string) => void;
  onCancel: () => void;
}

export function LevelUpModal({ character, newLevel, onConfirm, onCancel }: LevelUpModalProps) {
  const { multiclassData, getAvailableClasses, canMulticlass } = useMulticlass(character);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [showRequirements, setShowRequirements] = useState(false);

  // 获取现有职业
  const existingClasses = multiclassData.classes.map(c => c.class_id);

  // 获取所有可选职业（现有+可兼职）
  const availableOptions = [
    ...existingClasses,
    ...getAvailableClasses().filter(c => !existingClasses.includes(c))
  ];

  const handleConfirm = () => {
    if (!selectedClass) return;

    // 发送升级请求
    sendMessage({
      type: 'level_up',
      campaign_id: character.campaign_id,
      data: {
        character_id: character.id,
        new_level: newLevel,
        class_choice: selectedClass,
        timestamp: new Date().toISOString()
      }
    });

    onConfirm(selectedClass);
  };

  return (
    <Dialog open={true} onOpenChange={onCancel}>
      <DialogContent className="max-w-2xl bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            恭喜升级到 {newLevel} 级！
          </DialogTitle>
          <DialogDescription>
            选择要提升的职业
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 现有职业 */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-gray-400">
              现有职业
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {multiclassData.classes.map(classLevel => (
                <button
                  key={classLevel.class_id}
                  onClick={() => setSelectedClass(classLevel.class_id)}
                  className={`p-3 rounded border-2 transition-all ${
                    selectedClass === classLevel.class_id
                      ? 'border-purple-500 bg-purple-900/50'
                      : 'border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className="font-bold">
                    {getClassName(classLevel.class_id)} {classLevel.level + 1}
                  </div>
                  <div className="text-xs text-gray-400">
                    继续提升{getClassName(classLevel.class_id)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 可兼职职业 */}
          {getAvailableClasses().filter(c => !existingClasses.includes(c)).length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2 text-gray-400">
                可兼职职业
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {getAvailableClasses()
                  .filter(c => !existingClasses.includes(c))
                  .map(className => (
                    <button
                      key={className}
                      onClick={() => setSelectedClass(className)}
                      className={`p-3 rounded border-2 transition-all ${
                        selectedClass === className
                          ? 'border-green-500 bg-green-900/50'
                          : 'border-gray-700 hover:border-gray-600'
                      }`}
                    >
                      <div className="font-bold">
                        {getClassName(className)} 1
                      </div>
                      <div className="text-xs text-gray-400">
                        开始兼职
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* 属性要求提示 */}
          {selectedClass && !existingClasses.includes(selectedClass) && (
            <div className="p-3 bg-blue-900/30 border border-blue-700 rounded">
              <h4 className="font-medium mb-2">兼职要求</h4>
              <AttributeRequirements
                className={selectedClass}
                character={character}
              />
            </div>
          )}

          {/* 升级预览 */}
          {selectedClass && (
            <div className="p-3 bg-gray-800 rounded">
              <h4 className="font-medium mb-2">升级后</h4>
              <ClassLevelPreview
                character={character}
                newClass={selectedClass}
                newLevel={newLevel}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedClass}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:opacity-50 rounded"
          >
            确认升级
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 3.3 角色显示更新
```typescript
// frontend/app/components/character/CharacterDisplay.tsx (更新)
export function CharacterDisplay({ character }: CharacterDisplayProps) {
  const { getClassDisplay, isMulticlassed } = useMulticlass(character);
  const progression = useCharacterProgression(character);

  return (
    <div className="character-display">
      {/* 职业显示 */}
      <div className="character-header">
        <h2 className="text-2xl font-bold">{character.name}</h2>
        <div className="text-lg">
          {isMulticlassed ? (
            <span className="text-purple-400">
              {getClassDisplay()} {/* 显示如: 战士4/游荡者2 */}
            </span>
          ) : (
            <span>
              {getClassName(character.class_id)} {character.level}
            </span>
          )}
        </div>
        <div className="text-sm text-gray-400">
          总等级 {progression.level} | {progression.xp.toLocaleString()} XP
        </div>
      </div>

      {/* 其他显示内容 */}
    </div>
  );
}
```

## 4. 后端处理

### 4.1 升级处理器
```python
# backend/app/services/websocket_handlers/level_up_handler.py
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .base import MessageHandler
from app.models.character import Character

class LevelUpHandler(MessageHandler):
    """处理角色升级和兼职"""

    async def handle(
        self,
        message: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        data = message.get("data", {})
        character_id = data.get("character_id")
        new_level = data.get("new_level")
        class_choice = data.get("class_choice")

        # 获取角色
        result = await db.execute(
            select(Character).where(Character.id == character_id)
        )
        character = result.scalar_one_or_none()

        if not character:
            await self.send_error(websocket, "Character not found")
            return

        # 权限检查（角色拥有者或DM）
        if character.user_id != user_id and role != 'dm':
            await self.send_error(websocket, "Unauthorized")
            return

        # 更新兼职数据
        multiclass_data = character.multiclass_data or {
            "classes": [],
            "level_history": []
        }

        # 查找或创建职业条目
        class_entry = next(
            (c for c in multiclass_data["classes"] if c["class_id"] == class_choice),
            None
        )

        if class_entry:
            # 提升现有职业
            class_entry["level"] += 1
        else:
            # 新增兼职
            multiclass_data["classes"].append({
                "class_id": class_choice,
                "level": 1,
                "subclass_id": None
            })

        # 记录升级历史
        multiclass_data["level_history"].append({
            "level": new_level,
            "class": class_choice,
            "timestamp": data.get("timestamp")
        })

        # 更新数据库
        character.multiclass_data = multiclass_data
        character.level = new_level

        await db.commit()

        # 广播更新
        await self.broadcast_to_campaign({
            "type": "character_level_up",
            "campaign_id": campaign_id,
            "data": {
                "character_id": character_id,
                "character_name": character.name,
                "new_level": new_level,
                "class_choice": class_choice,
                "multiclass_data": multiclass_data,
                "timestamp": data.get("timestamp")
            }
        }, campaign_id)
```

### 4.2 API路由更新
```python
# backend/app/api/routes/characters.py (更新)
@router.get("/characters/{character_id}/multiclass-options")
async def get_multiclass_options(
    character_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取角色可用的兼职选项"""
    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    # 获取角色属性
    ability_scores = character.ability_scores

    # 计算可用职业
    available_classes = []
    for class_name, requirements in MULTICLASS_REQUIREMENTS.items():
        if check_requirements(ability_scores, requirements):
            available_classes.append(class_name)

    return {
        "character_id": character_id,
        "current_classes": character.multiclass_data.get("classes", []) if character.multiclass_data else [],
        "available_classes": available_classes,
        "ability_scores": ability_scores
    }

@router.post("/characters/{character_id}/level-up")
async def level_up_character(
    character_id: int,
    class_choice: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """手动升级角色（备用API）"""
    # 实现逻辑同WebSocket handler
    pass
```

## 5. 兼职规则细节

### 5.1 生命值计算
```typescript
// frontend/app/utils/multiclass-hp.ts
export function calculateMulticlassHP(multiclassData: MulticlassData, constitution: number): number {
  const conModifier = Math.floor((constitution - 10) / 2);

  // 第一级获得最大HP
  const firstClass = multiclassData.level_history[0]?.class || multiclassData.classes[0]?.class_id;
  const firstClassHD = CLASS_HIT_DICE[firstClass];
  let totalHP = firstClassHD + conModifier;

  // 后续等级获得平均HP
  for (let i = 1; i < multiclassData.level_history.length; i++) {
    const levelClass = multiclassData.level_history[i].class;
    const classHD = CLASS_HIT_DICE[levelClass];
    const averageHP = Math.floor(classHD / 2) + 1;
    totalHP += averageHP + conModifier;
  }

  return totalHP;
}
```

### 5.2 熟练加值
```typescript
// 熟练加值始终基于总等级
export function getProficiencyBonus(totalLevel: number): number {
  if (totalLevel <= 4) return 2;
  if (totalLevel <= 8) return 3;
  if (totalLevel <= 12) return 4;
  if (totalLevel <= 16) return 5;
  return 6;
}
```

### 5.3 施法位计算（复杂）
```typescript
// frontend/app/utils/multiclass-spellcasting.ts
export function calculateMulticlassSpellSlots(multiclassData: MulticlassData): SpellSlots {
  // 计算施法者等级
  let casterLevel = 0;

  for (const classLevel of multiclassData.classes) {
    const className = classLevel.class_id;
    const level = classLevel.level;

    // 全施法者（法师、牧师、德鲁伊等）
    if (FULL_CASTERS.includes(className)) {
      casterLevel += level;
    }
    // 半施法者（游侠、圣武士）
    else if (HALF_CASTERS.includes(className)) {
      casterLevel += Math.floor(level / 2);
    }
    // 三分之一施法者（奥术骑士、诡术师）
    else if (THIRD_CASTERS.includes(className)) {
      casterLevel += Math.floor(level / 3);
    }
  }

  // 根据施法者等级查表获取法术位
  return MULTICLASS_SPELL_SLOTS[casterLevel] || {};
}
```

## 6. 测试计划

### 6.1 单元测试
```typescript
describe('Multiclass System', () => {
  it('should calculate total level correctly', () => {
    const multiclassData = {
      classes: [
        { class_id: 'fighter', level: 4 },
        { class_id: 'rogue', level: 2 }
      ]
    };
    expect(calculateTotalLevel(multiclassData)).toBe(6);
  });

  it('should check attribute requirements', () => {
    const abilityScores = { strength: 13, dexterity: 14 };
    expect(canMulticlass('fighter', abilityScores)).toBe(true);
    expect(canMulticlass('wizard', abilityScores)).toBe(false); // 需要智力13
  });
});
```

### 6.2 E2E测试
```typescript
test('Character can multiclass on level up', async ({ page }) => {
  // 创建满足兼职要求的角色
  // 获得足够XP升级
  // 选择兼职新职业
  // 验证职业显示更新为 "战士2/游荡者1"
});
```

## 7. UI/UX建议

### 7.1 兼职提示
- 升级时清晰显示可用选项
- 标明属性要求是否满足
- 预览升级后的能力变化

### 7.2 职业管理界面
- 显示每个职业的等级
- 显示获得的职业特性
- 升级历史记录

### 7.3 快捷信息
- 鼠标悬停显示职业详情
- 快速查看兼职要求
- 建议合适的职业组合

## 8. 配置选项

### 8.1 DM设置
```typescript
interface CampaignMulticlassSettings {
  allowMulticlass: boolean;  // 是否允许兼职
  requireStrictRequirements: boolean;  // 是否严格执行属性要求
  maxClasses: number;  // 最多兼职数量（默认无限）
  customRequirements?: Record<string, any>;  // 自定义要求
}
```

## 9. 数据迁移策略

对于现有角色数据：
1. 保留原有的`class_id`和`level`字段
2. 自动生成`multiclass_data`结构
3. 确保向后兼容

## 10. 常见兼职组合

### 推荐组合
- **战士/游荡者**：近战输出+技能多样性
- **圣武士/术士**：神圣打击+施法能力
- **野蛮人/德鲁伊**：狂暴+变形
- **游荡者/游侠**：潜行+追踪

### 注意事项
- 某些职业特性不叠加（如额外攻击）
- 施法职业兼职需要仔细计算法术位
- 护甲熟练项可能冲突

---

本补充设计完整支持D&D 5E兼职规则，让玩家能够创建更多样化的角色构建。