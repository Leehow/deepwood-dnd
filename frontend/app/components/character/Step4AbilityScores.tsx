import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CharacterState, Race, AbilityScoreMethod } from "./types";
import {
  getAbilityName,
  getAbilityModifier,
  formatModifier,
  STANDARD_ARRAY,
  POINT_BUY_TOTAL,
  POINT_BUY_MIN,
  POINT_BUY_MAX,
  POINT_BUY_COSTS,
  ABILITIES
} from "./utils";
import { getAssetUrl } from "~/utils/asset-url";

interface Step4Props {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
  currentRace: Race | undefined;
  currentSubrace: any;
}

function Step4AbilityScores({ character, setCharacter, currentRace, currentSubrace }: Step4Props) {
  const [method, setMethod] = useState<AbilityScoreMethod>("standard");
  const [standardArrayValues, setStandardArrayValues] = useState<number[]>([...STANDARD_ARRAY]);
  const [selectedStandardValue, setSelectedStandardValue] = useState<number | null>(null);
  // Track which abilities have been explicitly assigned (vs default 10)
  const [assignedAbilities, setAssignedAbilities] = useState<Set<string>>(new Set());
  // Drag state
  const [draggingValue, setDraggingValue] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverAbility, setDragOverAbility] = useState<string | null>(null);
  const [rollResults, setRollResults] = useState<number[][]>([]);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [customPointTotal, setCustomPointTotal] = useState(27);
  const [hasRolled, setHasRolled] = useState(false); // Track if dice have been rolled

  // Calculate total points spent in point buy
  const calculatePointsSpent = (): number => {
    let total = 0;
    ABILITIES.forEach(ability => {
      const score = character.abilityScores[ability.id as keyof typeof character.abilityScores];
      total += POINT_BUY_COSTS[score] || 0;
    });
    return total;
  };

  const pointsSpent = calculatePointsSpent();
  const pointsRemaining = (method === "custompointbuy" ? customPointTotal : POINT_BUY_TOTAL) - pointsSpent;

  // Calculate modifier
  const calculateModifier = (score: number): number => {
    return Math.floor((score - 10) / 2);
  };

  // Get racial bonus for an ability (including half-elf extra choices)
  const getRacialBonus = (abilityId: string): number => {
    const raceBonus = currentRace?.abilityScoreIncrease?.[abilityId] || 0;
    const subraceBonus = currentSubrace?.abilityScoreIncrease?.[abilityId] || 0;
    const halfElfBonus = (currentRace?.id === "half_elf" && character.raceChoices?.abilityScores?.includes(abilityId)) ? 1 : 0;
    return raceBonus + subraceBonus + halfElfBonus;
  };

  // Roll 4d6 drop lowest
  const roll4d6DropLowest = (): number => {
    const rolls = [
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
    ];
    rolls.sort((a, b) => a - b);
    return rolls[1] + rolls[2] + rolls[3]; // Sum the highest 3
  };

  const handleRollAbilities = () => {
    const results: number[][] = [];
    for (let i = 0; i < 6; i++) {
      const rollSet: number[] = [];
      for (let j = 0; j < 4; j++) {
        rollSet.push(Math.floor(Math.random() * 6) + 1);
      }
      results.push(rollSet);
    }
    setRollResults(results);
    setHasRolled(true); // Mark as rolled

    // Calculate final values (4d6 drop lowest)
    const scores = results.map(rolls => {
      const sorted = [...rolls].sort((a, b) => b - a);
      return sorted[0] + sorted[1] + sorted[2];
    });

    // Assign to abilities
    const newScores = {
      strength: scores[0],
      dexterity: scores[1],
      constitution: scores[2],
      intelligence: scores[3],
      wisdom: scores[4],
      charisma: scores[5],
    };

    setCharacter(prev => ({
      ...prev,
      abilityScores: newScores
    }));
  };

  const handleStandardArrayAssign = (abilityId: string, value: number) => {
    const currentValue = character.abilityScores[abilityId as keyof typeof character.abilityScores];

    // Check if current value is actually being used (not default 10 that all abilities start with)
    const isCurrentValueInUse = STANDARD_ARRAY.includes(currentValue) &&
      Object.entries(character.abilityScores).some(([key, val]) =>
        key !== abilityId && val === currentValue
      );

    // Remove old value from available array only if it's in standard array and not used by other abilities
    const newArray = [...standardArrayValues];
    if (STANDARD_ARRAY.includes(currentValue) && !isCurrentValueInUse) {
      newArray.push(currentValue);
    }

    // Remove new value from available array
    const valueIndex = newArray.indexOf(value);
    if (valueIndex > -1) {
      newArray.splice(valueIndex, 1);
    }

    newArray.sort((a, b) => b - a);
    setStandardArrayValues(newArray);

    setCharacter(prev => ({
      ...prev,
      abilityScores: {
        ...prev.abilityScores,
        [abilityId]: value
      }
    }));
  };

  // Click-to-assign: click a value chip to pick it up, click an ability slot to place it
  const handlePickValue = (value: number) => {
    setSelectedStandardValue(prev => prev === value ? null : value);
  };

  // Core assignment logic shared by click and drag
  const assignValueToAbility = (value: number, abilityId: string) => {
    const currentValue = character.abilityScores[abilityId as keyof typeof character.abilityScores];
    const isAssigned = assignedAbilities.has(abilityId);

    const newPool = [...standardArrayValues];
    const valueIndex = newPool.indexOf(value);
    if (valueIndex > -1) newPool.splice(valueIndex, 1);

    // If this ability was already assigned, return old value to pool
    if (isAssigned && STANDARD_ARRAY.includes(currentValue)) {
      newPool.push(currentValue);
    }
    newPool.sort((a, b) => b - a);
    setStandardArrayValues(newPool);

    setAssignedAbilities(prev => { const n = new Set(prev); n.add(abilityId); return n; });
    setCharacter(prev => ({
      ...prev,
      abilityScores: { ...prev.abilityScores, [abilityId]: value }
    }));
  };

  const handleAssignToAbility = (abilityId: string) => {
    const currentValue = character.abilityScores[abilityId as keyof typeof character.abilityScores];
    const isAssigned = assignedAbilities.has(abilityId);

    // If no value selected: clicking an assigned slot returns its value to pool
    if (selectedStandardValue === null) {
      if (isAssigned) {
        setStandardArrayValues(prev => [...prev, currentValue].sort((a, b) => b - a));
        setAssignedAbilities(prev => { const n = new Set(prev); n.delete(abilityId); return n; });
        setCharacter(prev => ({
          ...prev,
          abilityScores: { ...prev.abilityScores, [abilityId]: 10 }
        }));
      }
      return;
    }

    assignValueToAbility(selectedStandardValue, abilityId);
    setSelectedStandardValue(null);
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, value: number, chipIndex: number) => {
    setDraggingValue(value);
    setDraggingIndex(chipIndex);
    setSelectedStandardValue(null); // Clear click selection when dragging
    e.dataTransfer.setData("text/plain", String(value));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setDraggingValue(null);
    setDraggingIndex(null);
    setDragOverAbility(null);
  };

  const handleDragOverAbilitySlot = (e: React.DragEvent, abilityId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverAbility(abilityId);
  };

  const handleDragLeaveAbilitySlot = () => {
    setDragOverAbility(null);
  };

  const handleDropOnAbility = (e: React.DragEvent, abilityId: string) => {
    e.preventDefault();
    setDragOverAbility(null);
    if (draggingValue !== null) {
      assignValueToAbility(draggingValue, abilityId);
    }
    setDraggingValue(null);
    setDraggingIndex(null);
  };

  const handleManualInput = (abilityId: string, value: string) => {
    const numValue = parseInt(value) || 8;
    const clampedValue = Math.max(8, Math.min(15, numValue));

    setCharacter(prev => ({
      ...prev,
      abilityScores: {
        ...prev.abilityScores,
        [abilityId]: clampedValue
      }
    }));
  };

  const handlePointBuyIncrement = (abilityId: string) => {
    const currentValue = character.abilityScores[abilityId as keyof typeof character.abilityScores];
    if (currentValue >= 15) return;

    const newValue = currentValue + 1;
    const costDiff = POINT_BUY_COSTS[newValue] - POINT_BUY_COSTS[currentValue];

    if (pointsRemaining >= costDiff) {
      setCharacter(prev => ({
        ...prev,
        abilityScores: {
          ...prev.abilityScores,
          [abilityId]: newValue
        }
      }));
    }
  };

  const handlePointBuyDecrement = (abilityId: string) => {
    const currentValue = character.abilityScores[abilityId as keyof typeof character.abilityScores];
    if (currentValue <= 8) return;

    const newValue = currentValue - 1;
    setCharacter(prev => ({
      ...prev,
      abilityScores: {
        ...prev.abilityScores,
        [abilityId]: newValue
      }
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xl font-semibold text-amber-400 mb-2">决定属性值</h2>
          <p className="text-gray-400 text-sm">
            选择一种方法来决定你的角色属性值。
          </p>
        </div>
        <button
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          onClick={() => setShowRulesDialog(true)}
        >
          <span>📖</span>
          <span>属性规则说明</span>
        </button>
      </div>

      {/* Rules Dialog */}
      <Dialog.Root open={showRulesDialog} onOpenChange={setShowRulesDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[10198]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-2xl max-h-[80dvh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg z-[10200]"
          >
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center border-b border-gray-700 pb-4">
                <Dialog.Title className="text-xl font-bold text-amber-400">属性值决定规则</Dialog.Title>
                <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-300 hover:bg-gray-700/50 transition-colors">
                  ✕
                </Dialog.Close>
              </div>

              <div className="space-y-4 text-sm text-gray-300">
                <div>
                  <h4 className="font-bold text-amber-400 mb-2">六大属性</h4>
                  <ul className="space-y-1 ml-4">
                    <li>• <strong>力量</strong>：近战攻击、搬运能力</li>
                    <li>• <strong>敏捷</strong>：护甲等级、先攻、远程攻击</li>
                    <li>• <strong>体质</strong>：生命值、体质豁免</li>
                    <li>• <strong>智力</strong>：施法能力（法师）、知识检定</li>
                    <li>• <strong>感知</strong>：察觉、洞悉、施法能力（牧师/德鲁伊）</li>
                    <li>• <strong>魅力</strong>：社交技能、施法能力（术士/吟游诗人）</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-bold text-amber-400 mb-2">属性调整值</h4>
                  <p>属性调整值 = (属性值 - 10) ÷ 2（向下取整）</p>
                  <p className="text-xs text-gray-400 mt-1">属性调整值会加到相关检定、豁免和攻击掷骰上</p>
                  <div className="mt-2 bg-gray-800 rounded p-2 text-xs space-y-1">
                    <div className="grid grid-cols-2 gap-2">
                      <div>属性 8-9 → 调整值 -1</div>
                      <div>属性 10-11 → 调整值 +0</div>
                      <div>属性 12-13 → 调整值 +1</div>
                      <div>属性 14-15 → 调整值 +2</div>
                      <div>属性 16-17 → 调整值 +3</div>
                      <div>属性 18-19 → 调整值 +4</div>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-bold text-amber-400 mb-2">属性值含义</h4>
                  <div className="space-y-1 text-xs">
                    <div><strong>8-9：</strong>低于平均，有明显弱点（-1调整值）</div>
                    <div><strong>10-11：</strong>普通人类平均水平（+0调整值）</div>
                    <div><strong>12-13：</strong>略高于平均，有一定优势（+1调整值）</div>
                    <div><strong>14-15：</strong>优秀水平，明显强于常人（+2调整值）</div>
                    <div><strong>16-17：</strong>卓越水平，接近人类极限（+3调整值）</div>
                    <div><strong>18+：</strong>英雄级别，超越凡人（+4或更高）</div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    建议：将最高的属性分配给职业的主要属性，将较低的属性分配给不太重要的能力。
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-amber-400 mb-2">方法一：标准数组</h4>
                  <p>使用固定的六个数值：15、14、13、12、10、8</p>
                  <p className="text-xs text-gray-400 mt-1">适合快速创建角色，数值平衡</p>
                </div>

                <div>
                  <h4 className="font-bold text-amber-400 mb-2">方法二：投骰</h4>
                  <p>为每个属性投4d6（4个六面骰），去掉最小的一个，剩余三个相加</p>
                  <p className="text-xs text-gray-400 mt-1">随机性高，可能非常强或非常弱</p>
                </div>

                <div>
                  <h4 className="font-bold text-amber-400 mb-2">方法三：购点法</h4>
                  <p>使用27点购买属性（范围8-15）</p>
                  <div className="mt-2 bg-gray-800 rounded p-2 text-xs">
                    <div className="grid grid-cols-4 gap-2">
                      <div>属性8 = 0点</div>
                      <div>属性9 = 1点</div>
                      <div>属性10 = 2点</div>
                      <div>属性11 = 3点</div>
                      <div>属性12 = 4点</div>
                      <div>属性13 = 5点</div>
                      <div>属性14 = 7点</div>
                      <div>属性15 = 9点</div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">最灵活，可以精确控制属性分配</p>
                </div>

                <div>
                  <h4 className="font-bold text-amber-400 mb-2">方法四：自定义购点</h4>
                  <p>自定义总点数（15-50点），适合特殊规则战役</p>
                  <div className="mt-2 bg-gray-800 rounded p-2 text-xs space-y-1">
                    <div>• 可自由设置总点数上限</div>
                    <div>• 预设：标准(27)、低魔(20)、高能(31)</div>
                    <div>• 适合DM自定义难度的战役</div>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">使用与购点法相同的消耗表，但总点数可变</p>
                </div>

                <div>
                  <h4 className="font-bold text-amber-400 mb-2">种族加值</h4>
                  <p>选择的种族和亚种会为特定属性提供加值</p>
                  <p className="text-xs text-gray-400 mt-1">种族加值会自动加到你选择的基础属性上</p>
                </div>
              </div>

              <Dialog.Close className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors">
                我明白了
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Method Selection */}
      <div className="flex gap-3">
        <button
          className={`flex-1 p-4 rounded-lg border-2 transition-all ${
            method === "standard"
              ? "border-amber-400 bg-amber-400/10"
              : "border-gray-700 hover:border-gray-600"
          }`}
          onClick={() => setMethod("standard")}
        >
          <div className="font-bold text-amber-400">预设数组</div>
          <div className="text-xs text-gray-400 mt-1">15, 14, 13, 12, 10, 8</div>
        </button>
        <button
          className={`flex-1 p-4 rounded-lg border-2 transition-all ${
            method === "roll"
              ? "border-amber-400 bg-amber-400/10"
              : "border-gray-700 hover:border-gray-600"
          }`}
          onClick={() => setMethod("roll")}
        >
          <div className="font-bold text-amber-400">投骰</div>
          <div className="text-xs text-gray-400 mt-1">4d6 去最小</div>
        </button>
        <button
          className={`flex-1 p-4 rounded-lg border-2 transition-all ${
            method === "pointbuy"
              ? "border-amber-400 bg-amber-400/10"
              : "border-gray-700 hover:border-gray-600"
          }`}
          onClick={() => setMethod("pointbuy")}
        >
          <div className="font-bold text-amber-400">购点法</div>
          <div className="text-xs text-gray-400 mt-1">27点分配</div>
        </button>
        <button
          className={`flex-1 p-4 rounded-lg border-2 transition-all ${
            method === "custompointbuy"
              ? "border-amber-400 bg-amber-400/10"
              : "border-gray-700 hover:border-gray-600"
          }`}
          onClick={() => setMethod("custompointbuy")}
        >
          <div className="font-bold text-amber-400">自定义购点</div>
          <div className="text-xs text-gray-400 mt-1">自定义点数</div>
        </button>
      </div>

      {/* Standard Array Method */}
      {method === "standard" && (
        <div className="space-y-4">
          {/* Method explanation */}
          <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <span className="text-blue-400 text-lg">ℹ️</span>
              <div className="text-sm text-gray-300">
                <strong className="text-blue-400">如何使用：</strong>
                先点击上方数值选中，再点击属性槽位放入。点击已分配的槽位可取回数值。
              </div>
            </div>
          </div>

          {/* Racial Bonus Info */}
          {(currentRace || currentSubrace) && (
            <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className="text-green-400 text-lg">✨</span>
                <div className="text-sm text-gray-300">
                  <strong className="text-green-400">种族加值：</strong>
                  {currentRace && (
                    <span>
                      {currentRace.name}
                      {Object.entries(currentRace.abilityScoreIncrease || {}).map(([key, value]) => {
                        const ability = ABILITIES.find(a => a.id === key);
                        return ability ? ` ${ability.abbr}+${value}` : '';
                      }).join(', ')}
                    </span>
                  )}
                  {currentSubrace && (
                    <span>
                      {' '}· {currentSubrace.name}
                      {Object.entries(currentSubrace.abilityScoreIncrease || {}).map(([key, value]) => {
                        const ability = ABILITIES.find(a => a.id === key);
                        return ability ? ` ${ability.abbr}+${value}` : '';
                      }).join(', ')}
                    </span>
                  )}
                  {currentRace?.id === "half_elf" && (character.raceChoices?.abilityScores?.length ?? 0) > 0 && (
                    <span>
                      {' '}·{' '}
                      {character.raceChoices?.abilityScores?.map((id: string) => {
                        const ability = ABILITIES.find(a => a.id === id);
                        return ability ? `${ability.abbr}+1` : '';
                      }).filter(Boolean).join(', ')}
                      （自选）
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Value chips - click to pick up */}
          <div className="bg-gray-800/50 p-4 rounded-lg">
            <div className="text-sm text-gray-400 mb-3">
              {draggingValue !== null
                ? <span>拖动 <span className="text-amber-400 font-bold">{draggingValue}</span> 到属性槽位放入</span>
                : selectedStandardValue !== null
                  ? <span>已选中 <span className="text-amber-400 font-bold">{selectedStandardValue}</span>，点击下方属性放入</span>
                  : standardArrayValues.length > 0
                    ? "点击或拖动数值到属性槽位分配"
                    : <span className="text-green-400">所有数值已分配完毕</span>
              }
            </div>
            <div className="flex gap-2 flex-wrap">
              {STANDARD_ARRAY.map((val, idx) => {
                const poolCount = standardArrayValues.filter(v => v === val).length;
                const isAvailable = (() => {
                  const priorSameInArray = STANDARD_ARRAY.slice(0, idx).filter(v => v === val).length;
                  return priorSameInArray < poolCount;
                })();
                const isSelected = selectedStandardValue === val && isAvailable;
                const isDragging = draggingIndex === idx;

                return (
                  <button
                    key={idx}
                    onClick={() => isAvailable ? handlePickValue(val) : undefined}
                    disabled={!isAvailable}
                    draggable={isAvailable}
                    onDragStart={(e) => handleDragStart(e, val, idx)}
                    onDragEnd={handleDragEnd}
                    className={`
                      min-w-[48px] min-h-[48px] px-4 py-2 rounded-lg font-bold text-lg transition-all duration-200 select-none
                      ${isAvailable
                        ? isDragging
                          ? "bg-amber-400/50 text-gray-900 scale-95 opacity-50 cursor-grabbing"
                          : isSelected
                            ? "bg-amber-400 text-gray-900 scale-110 shadow-lg shadow-amber-400/30 ring-2 ring-amber-300 cursor-grab"
                            : "bg-gray-700 text-amber-400 hover:bg-gray-600 hover:scale-105 cursor-grab"
                        : "bg-gray-800/30 text-gray-600 cursor-default line-through"
                      }
                    `}
                  >
                    {val}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ability slots - click to assign or drop target */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ABILITIES.map(ability => {
              const isAssigned = assignedAbilities.has(ability.id);
              const baseScore = character.abilityScores[ability.id as keyof typeof character.abilityScores];
              const racialBonus = getRacialBonus(ability.id);
              const totalScore = isAssigned ? baseScore + racialBonus : 10 + racialBonus;
              const modifier = calculateModifier(totalScore);
              const hasValueSelected = selectedStandardValue !== null;
              const isDragOver = dragOverAbility === ability.id;
              const isDragging = draggingValue !== null;

              return (
                <button
                  key={ability.id}
                  type="button"
                  onClick={() => handleAssignToAbility(ability.id)}
                  onDragOver={(e) => handleDragOverAbilitySlot(e, ability.id)}
                  onDragLeave={handleDragLeaveAbilitySlot}
                  onDrop={(e) => handleDropOnAbility(e, ability.id)}
                  className={`
                    bg-gray-800/50 rounded-lg p-4 text-left transition-all duration-200 w-full
                    ${isDragOver
                      ? "ring-2 ring-amber-400 bg-amber-400/10 scale-[1.02]"
                      : isDragging
                        ? "ring-1 ring-amber-400/30"
                        : hasValueSelected && !isAssigned
                          ? "ring-2 ring-amber-400/50 hover:ring-amber-400 hover:bg-gray-700/50 cursor-pointer"
                          : hasValueSelected && isAssigned
                            ? "ring-1 ring-amber-400/30 hover:ring-amber-400 hover:bg-gray-700/50 cursor-pointer"
                            : isAssigned
                              ? "hover:bg-gray-700/30 cursor-pointer"
                              : ""
                    }
                  `}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img
                        src={getAssetUrl(`assets/ability-icons/small/${ability.id}.png`)}
                        alt={ability.name}
                        className="w-12 h-12 opacity-90"
                      />
                      <div>
                        <div className="font-bold text-gray-300">{ability.name}</div>
                        <div className="text-xs text-gray-500">{ability.abbr}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Assignment slot */}
                      {isAssigned ? (
                        <div className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-amber-400/15 border-2 border-amber-400/50 rounded-lg px-3">
                          <span className="text-xl font-bold text-amber-400">{baseScore}</span>
                        </div>
                      ) : (
                        <div className={`
                          min-w-[48px] min-h-[48px] flex items-center justify-center rounded-lg px-3
                          border-2 border-dashed transition-all duration-200
                          ${isDragOver
                            ? "border-amber-400 bg-amber-400/15 scale-105"
                            : hasValueSelected
                              ? "border-amber-400/60 bg-amber-400/5"
                              : "border-gray-600 bg-gray-800/30"
                          }
                        `}>
                          <span className={`text-sm ${isDragOver || hasValueSelected ? "text-amber-400/60" : "text-gray-600"}`}>
                            {isDragOver ? draggingValue : hasValueSelected ? "放入" : "—"}
                          </span>
                        </div>
                      )}
                      {racialBonus > 0 && (
                        <span
                          className="text-green-400 text-sm cursor-help"
                          title={`种族加值（${currentRace?.name}${currentSubrace ? ' - ' + currentSubrace.name : ''}）`}
                        >
                          +{racialBonus}
                        </span>
                      )}
                      <div className="flex flex-col items-center min-w-[60px] bg-amber-400/10 rounded px-3 py-2">
                        <div className={`text-2xl font-bold ${isAssigned ? "text-amber-400" : "text-gray-600"}`}>{totalScore}</div>
                        <div className="text-xs text-gray-400">
                          ({modifier >= 0 ? "+" : ""}{modifier})
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Roll Method */}
      {method === "roll" && (
        <div className="space-y-4">
          {/* Method explanation */}
          <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <span className="text-blue-400 text-lg">ℹ️</span>
              <div className="text-sm text-gray-300">
                <strong className="text-blue-400">如何使用：</strong>
                点击按钮投骰，系统会自动为每个属性投4d6并去掉最小的骰子。结果完全随机，可能产生强力角色或较弱角色。
              </div>
            </div>
          </div>

          {/* Racial Bonus Info */}
          {(currentRace || currentSubrace) && (
            <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className="text-green-400 text-lg">✨</span>
                <div className="text-sm text-gray-300">
                  <strong className="text-green-400">种族加值：</strong>
                  {currentRace && (
                    <span>
                      {currentRace.name}
                      {Object.entries(currentRace.abilityScoreIncrease || {}).map(([key, value]) => {
                        const ability = ABILITIES.find(a => a.id === key);
                        return ability ? ` ${ability.abbr}+${value}` : '';
                      }).join(', ')}
                    </span>
                  )}
                  {currentSubrace && (
                    <span>
                      {' '}· {currentSubrace.name}
                      {Object.entries(currentSubrace.abilityScoreIncrease || {}).map(([key, value]) => {
                        const ability = ABILITIES.find(a => a.id === key);
                        return ability ? ` ${ability.abbr}+${value}` : '';
                      }).join(', ')}
                    </span>
                  )}
                  {currentRace?.id === "half_elf" && (character.raceChoices?.abilityScores?.length ?? 0) > 0 && (
                    <span>
                      {' '}·{' '}
                      {character.raceChoices?.abilityScores?.map((id: string) => {
                        const ability = ABILITIES.find(a => a.id === id);
                        return ability ? `${ability.abbr}+1` : '';
                      }).filter(Boolean).join(', ')}
                      （自选）
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          <button
            className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${
              hasRolled
                ? "bg-gray-600 cursor-not-allowed text-gray-400"
                : "bg-purple-600 hover:bg-purple-700 text-white"
            }`}
            onClick={handleRollAbilities}
            disabled={hasRolled}
            title={hasRolled ? "已投骰，不能重复投骰" : "点击投骰决定属性值"}
          >
            {hasRolled ? "✓ 已投骰" : "🎲 投骰决定属性值"}
          </button>

          {rollResults.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ABILITIES.map((ability, idx) => {
                const rolls = rollResults[idx];
                const sorted = [...rolls].sort((a, b) => b - a);
                const baseScore = sorted[0] + sorted[1] + sorted[2];
                const racialBonus = getRacialBonus(ability.id);
                const totalScore = baseScore + racialBonus;
                const modifier = calculateModifier(totalScore);

                return (
                  <div key={ability.id} className="bg-gray-800/50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <img
                          src={getAssetUrl(`assets/ability-icons/small/${ability.id}.png`)}
                          alt={ability.name}
                          className="w-12 h-12 opacity-90"
                        />
                        <div>
                          <div className="font-bold text-gray-300">{ability.name}</div>
                          <div className="text-xs text-gray-500">{ability.abbr}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-xs text-gray-500">
                          [{rolls.join(", ")}]
                        </div>
                        <div className="text-sm text-gray-400">{baseScore}</div>
                        {racialBonus > 0 && (
                          <span className="text-green-400 text-sm">+{racialBonus}</span>
                        )}
                        <div className="flex flex-col items-center min-w-[60px] bg-amber-400/10 rounded px-3 py-2">
                          <div className="text-2xl font-bold text-amber-400">{totalScore}</div>
                          <div className="text-xs text-gray-400">
                            ({modifier >= 0 ? "+" : ""}{modifier})
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {rollResults.length === 0 && (
            <div className="text-center text-gray-500 py-10">
              点击按钮投骰决定你的属性值
            </div>
          )}
        </div>
      )}

      {/* Point Buy Method */}
      {method === "pointbuy" && (
        <div className="space-y-4">
          {/* Method explanation */}
          <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <span className="text-blue-400 text-lg">ℹ️</span>
              <div className="text-sm text-gray-300">
                <strong className="text-blue-400">如何使用：</strong>
                使用+/-按钮调整每个属性值（范围8-15）。每次提升都需要消耗一定点数，越高的属性消耗越多。注意合理分配你的27点。
              </div>
            </div>
          </div>

          {/* Racial Bonus Info */}
          {(currentRace || currentSubrace) && (
            <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className="text-green-400 text-lg">✨</span>
                <div className="text-sm text-gray-300">
                  <strong className="text-green-400">种族加值：</strong>
                  {currentRace && (
                    <span>
                      {currentRace.name}
                      {Object.entries(currentRace.abilityScoreIncrease || {}).map(([key, value]) => {
                        const ability = ABILITIES.find(a => a.id === key);
                        return ability ? ` ${ability.abbr}+${value}` : '';
                      }).join(', ')}
                    </span>
                  )}
                  {currentSubrace && (
                    <span>
                      {' '}· {currentSubrace.name}
                      {Object.entries(currentSubrace.abilityScoreIncrease || {}).map(([key, value]) => {
                        const ability = ABILITIES.find(a => a.id === key);
                        return ability ? ` ${ability.abbr}+${value}` : '';
                      }).join(', ')}
                    </span>
                  )}
                  {currentRace?.id === "half_elf" && (character.raceChoices?.abilityScores?.length ?? 0) > 0 && (
                    <span>
                      {' '}·{' '}
                      {character.raceChoices?.abilityScores?.map((id: string) => {
                        const ability = ABILITIES.find(a => a.id === id);
                        return ability ? `${ability.abbr}+1` : '';
                      }).filter(Boolean).join(', ')}
                      （自选）
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Points Display */}
          <div className="bg-gray-800/50 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm text-gray-400">可用点数</div>
                <div className="text-xs text-gray-500 mt-1">
                  属性范围: 8-15 · 总点数: {POINT_BUY_TOTAL}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-gray-400">已使用</div>
                  <div className="text-lg font-bold text-gray-300">{pointsSpent}</div>
                </div>
                <div className="text-gray-600">/</div>
                <div className="text-right">
                  <div className="text-xs text-gray-400">剩余</div>
                  <div className={`text-2xl font-bold ${
                    pointsRemaining < 0 ? "text-red-400" :
                    pointsRemaining === 0 ? "text-green-400" :
                    "text-amber-400"
                  }`}>
                    {pointsRemaining}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ABILITIES.map(ability => {
              const baseScore = character.abilityScores[ability.id as keyof typeof character.abilityScores];
              const racialBonus = getRacialBonus(ability.id);
              const totalScore = baseScore + racialBonus;
              const modifier = calculateModifier(totalScore);
              const currentCost = POINT_BUY_COSTS[baseScore];
              const nextCost = POINT_BUY_COSTS[baseScore + 1];
              const costToIncrease = nextCost ? nextCost - currentCost : 0;

              return (
                <div key={ability.id} className="bg-gray-800/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <img
                        src={getAssetUrl(`assets/ability-icons/small/${ability.id}.png`)}
                        alt={ability.name}
                        className="w-12 h-12 opacity-90"
                      />
                      <div>
                        <div className="font-bold text-gray-300">{ability.name}</div>
                        <div className="text-xs text-gray-500">{ability.abbr}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Decrement Button */}
                      <button
                        className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        onClick={() => handlePointBuyDecrement(ability.id)}
                        disabled={baseScore <= 8}
                      >
                        −
                      </button>

                      {/* Value Display */}
                      <div className="flex flex-col items-center min-w-[70px]">
                        <div className="text-sm text-gray-400">
                          消耗: {currentCost}
                        </div>
                        <div className="text-xl font-bold text-gray-300">{baseScore}</div>
                      </div>

                      {/* Increment Button */}
                      <button
                        className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        onClick={() => handlePointBuyIncrement(ability.id)}
                        disabled={baseScore >= 15 || pointsRemaining < costToIncrease}
                      >
                        +
                      </button>

                      {racialBonus > 0 && (
                        <span
                          className="text-green-400 text-sm cursor-help"
                          title={`种族加值（${currentRace?.name}${currentSubrace ? ' - ' + currentSubrace.name : ''}）`}
                        >
                          +{racialBonus}
                        </span>
                      )}
                      <div className="flex flex-col items-center min-w-[60px] bg-amber-400/10 rounded px-3 py-2">
                        <div className="text-2xl font-bold text-amber-400">{totalScore}</div>
                        <div className="text-xs text-gray-400">
                          ({modifier >= 0 ? "+" : ""}{modifier})
                        </div>
                      </div>
                    </div>
                  </div>
                  {baseScore < 15 && (
                    <div className="text-xs text-gray-500 text-right mt-1">
                      提升至 {baseScore + 1} 需要 {costToIncrease} 点
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Warning if points remaining */}
          {pointsRemaining > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 text-yellow-400 text-sm text-center">
              ⚠️ 还有 {pointsRemaining} 点未使用
            </div>
          )}
          {pointsRemaining < 0 && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-400 text-sm text-center">
              ❌ 超出可用点数 {Math.abs(pointsRemaining)} 点
            </div>
          )}
        </div>
      )}

      {/* Custom Point Buy Method */}
      {method === "custompointbuy" && (
        <div className="space-y-4">
          {/* Method explanation */}
          <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <span className="text-blue-400 text-lg">ℹ️</span>
              <div className="text-sm text-gray-300">
                <strong className="text-blue-400">如何使用：</strong>
                先设置你想要的总点数，然后使用+/-按钮调整每个属性值（范围8-15）。适合自定义难度或特殊规则的战役。
              </div>
            </div>
          </div>

          {/* Racial Bonus Info */}
          {(currentRace || currentSubrace) && (
            <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className="text-green-400 text-lg">✨</span>
                <div className="text-sm text-gray-300">
                  <strong className="text-green-400">种族加值：</strong>
                  {currentRace && (
                    <span>
                      {currentRace.name}
                      {Object.entries(currentRace.abilityScoreIncrease || {}).map(([key, value]) => {
                        const ability = ABILITIES.find(a => a.id === key);
                        return ability ? ` ${ability.abbr}+${value}` : '';
                      }).join(', ')}
                    </span>
                  )}
                  {currentSubrace && (
                    <span>
                      {' '}· {currentSubrace.name}
                      {Object.entries(currentSubrace.abilityScoreIncrease || {}).map(([key, value]) => {
                        const ability = ABILITIES.find(a => a.id === key);
                        return ability ? ` ${ability.abbr}+${value}` : '';
                      }).join(', ')}
                    </span>
                  )}
                  {currentRace?.id === "half_elf" && (character.raceChoices?.abilityScores?.length ?? 0) > 0 && (
                    <span>
                      {' '}·{' '}
                      {character.raceChoices?.abilityScores?.map((id: string) => {
                        const ability = ABILITIES.find(a => a.id === id);
                        return ability ? `${ability.abbr}+1` : '';
                      }).filter(Boolean).join(', ')}
                      （自选）
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Custom Point Total Setting */}
          <div className="bg-purple-900/20 border border-purple-700/50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-purple-400 mb-1">设置总点数</div>
                <div className="text-xs text-gray-400">标准为27点，可根据DM规则调整</div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  className="w-10 h-10 rounded bg-purple-700 hover:bg-purple-600 text-white font-bold transition-colors"
                  onClick={() => setCustomPointTotal(Math.max(15, customPointTotal - 1))}
                >
                  −
                </button>
                <div className="flex flex-col items-center min-w-[80px]">
                  <input
                    type="number"
                    className="w-20 px-3 py-2 bg-gray-900 border border-purple-700 rounded text-center text-xl font-bold text-purple-400 focus:border-purple-400 focus:outline-none"
                    value={customPointTotal}
                    onChange={(e) => setCustomPointTotal(Math.max(15, Math.min(50, parseInt(e.target.value) || 27)))}
                    min="15"
                    max="50"
                  />
                  <div className="text-xs text-gray-400 mt-1">总点数</div>
                </div>
                <button
                  className="w-10 h-10 rounded bg-purple-700 hover:bg-purple-600 text-white font-bold transition-colors"
                  onClick={() => setCustomPointTotal(Math.min(50, customPointTotal + 1))}
                >
                  +
                </button>
              </div>
            </div>
            <div className="mt-3 flex gap-2 justify-center">
              <button
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                onClick={() => setCustomPointTotal(27)}
              >
                标准 (27)
              </button>
              <button
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                onClick={() => setCustomPointTotal(20)}
              >
                低魔 (20)
              </button>
              <button
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                onClick={() => setCustomPointTotal(31)}
              >
                高能 (31)
              </button>
            </div>
          </div>

          {/* Points Display */}
          <div className="bg-gray-800/50 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm text-gray-400">可用点数</div>
                <div className="text-xs text-gray-500 mt-1">
                  属性范围: 8-15 · 总点数: {customPointTotal}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-gray-400">已使用</div>
                  <div className="text-lg font-bold text-gray-300">{pointsSpent}</div>
                </div>
                <div className="text-gray-600">/</div>
                <div className="text-right">
                  <div className="text-xs text-gray-400">剩余</div>
                  <div className={`text-2xl font-bold ${
                    pointsRemaining < 0 ? "text-red-400" :
                    pointsRemaining === 0 ? "text-green-400" :
                    "text-amber-400"
                  }`}>
                    {pointsRemaining}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ABILITIES.map(ability => {
              const baseScore = character.abilityScores[ability.id as keyof typeof character.abilityScores];
              const racialBonus = getRacialBonus(ability.id);
              const totalScore = baseScore + racialBonus;
              const modifier = calculateModifier(totalScore);
              const currentCost = POINT_BUY_COSTS[baseScore];
              const nextCost = POINT_BUY_COSTS[baseScore + 1];
              const costToIncrease = nextCost ? nextCost - currentCost : 0;

              return (
                <div key={ability.id} className="bg-gray-800/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <img
                        src={getAssetUrl(`assets/ability-icons/small/${ability.id}.png`)}
                        alt={ability.name}
                        className="w-12 h-12 opacity-90"
                      />
                      <div>
                        <div className="font-bold text-gray-300">{ability.name}</div>
                        <div className="text-xs text-gray-500">{ability.abbr}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Decrement Button */}
                      <button
                        className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        onClick={() => handlePointBuyDecrement(ability.id)}
                        disabled={baseScore <= 8}
                      >
                        −
                      </button>

                      {/* Value Display */}
                      <div className="flex flex-col items-center min-w-[70px]">
                        <div className="text-sm text-gray-400">
                          消耗: {currentCost}
                        </div>
                        <div className="text-xl font-bold text-gray-300">{baseScore}</div>
                      </div>

                      {/* Increment Button */}
                      <button
                        className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        onClick={() => handlePointBuyIncrement(ability.id)}
                        disabled={baseScore >= 15 || pointsRemaining < costToIncrease}
                      >
                        +
                      </button>

                      {racialBonus > 0 && (
                        <span
                          className="text-green-400 text-sm cursor-help"
                          title={`种族加值（${currentRace?.name}${currentSubrace ? ' - ' + currentSubrace.name : ''}）`}
                        >
                          +{racialBonus}
                        </span>
                      )}
                      <div className="flex flex-col items-center min-w-[60px] bg-amber-400/10 rounded px-3 py-2">
                        <div className="text-2xl font-bold text-amber-400">{totalScore}</div>
                        <div className="text-xs text-gray-400">
                          ({modifier >= 0 ? "+" : ""}{modifier})
                        </div>
                      </div>
                    </div>
                  </div>
                  {baseScore < 15 && (
                    <div className="text-xs text-gray-500 text-right mt-1">
                      提升至 {baseScore + 1} 需要 {costToIncrease} 点
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Warning if points remaining */}
          {pointsRemaining > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 text-yellow-400 text-sm text-center">
              ⚠️ 还有 {pointsRemaining} 点未使用
            </div>
          )}
          {pointsRemaining < 0 && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-400 text-sm text-center">
              ❌ 超出可用点数 {Math.abs(pointsRemaining)} 点
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Step 5: Character Description and Personality Component
interface Step5CharacterDescriptionProps {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
}

const ALIGNMENTS = [
  { id: "LG", name: "守序善良", nameEn: "Lawful Good", description: "尊重法律和秩序，致力于行善" },
  { id: "NG", name: "中立善良", nameEn: "Neutral Good", description: "尽力行善，不受规则束缚" },
  { id: "CG", name: "混乱善良", nameEn: "Chaotic Good", description: "追求自由和善良，反对不公" },
  { id: "LN", name: "守序中立", nameEn: "Lawful Neutral", description: "遵守法律和传统，不偏不倚" },
  { id: "N", name: "绝对中立", nameEn: "True Neutral", description: "保持平衡，不偏向任何极端" },
  { id: "CN", name: "混乱中立", nameEn: "Chaotic Neutral", description: "追求自由，不受道德约束" },
  { id: "LE", name: "守序邪恶", nameEn: "Lawful Evil", description: "利用法律和权力达到邪恶目的" },
  { id: "NE", name: "中立邪恶", nameEn: "Neutral Evil", description: "纯粹的自私自利" },
  { id: "CE", name: "混乱邪恶", nameEn: "Chaotic Evil", description: "暴力和毁灭的化身" },
] as const;

const GENDERS = ["男性", "女性", "其他"] as const;

export { Step4AbilityScores };
