import { useState } from "react";
import { createLogger } from '~/utils/logger';
const logger = createLogger('DiceRoller');


const diceTypes = [
  { name: "d4", sides: 4 },
  { name: "d6", sides: 6 },
  { name: "d8", sides: 8 },
  { name: "d10", sides: 10 },
  { name: "d12", sides: 12 },
  { name: "d20", sides: 20 },
  { name: "d100", sides: 100 },
];

interface DiceRollerProps {
  onRoll?: (roll: { expression: string; result: number; details: string }) => void;
}

export function DiceRoller({ onRoll }: DiceRollerProps) {
  const [selectedDice, setSelectedDice] = useState("d20");
  const [modifier, setModifier] = useState(0);
  const [result, setResult] = useState<number | null>(null);
  const [isRolling, setIsRolling] = useState(false);

  const rollDice = () => {
    setIsRolling(true);
    const dice = diceTypes.find((d) => d.name === selectedDice);
    if (!dice) return;

    // 模拟骰子滚动动画
    setTimeout(() => {
      const roll = Math.floor(Math.random() * dice.sides) + 1;
      const total = roll + modifier;
      setResult(total);
      setIsRolling(false);

      // 通过回调广播骰子结果
      const expression = `1${selectedDice}${modifier !== 0 ? (modifier >= 0 ? `+${modifier}` : modifier) : ""}`;
      const details = `${selectedDice}: ${roll}${modifier !== 0 ? ` ${modifier >= 0 ? "+" : ""}${modifier}` : ""}`;

      onRoll?.({
        expression,
        result: total,
        details,
      });

      logger.debug(`Rolled ${expression} = ${total} (${details})`);
    }, 500);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-amber-400">虚拟骰子</h3>

      {/* 骰子选择 */}
      <div className="grid grid-cols-4 gap-2">
        {diceTypes.map((dice) => (
          <button
            key={dice.name}
            onClick={() => setSelectedDice(dice.name)}
            className={`
              px-3 py-2 rounded text-sm font-medium transition-colors
              ${
                selectedDice === dice.name
                  ? "bg-amber-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }
            `}
          >
            {dice.name}
          </button>
        ))}
      </div>

      {/* 调整值 */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-400">调整值:</label>
        <input
          type="number"
          value={modifier}
          onChange={(e) => setModifier(Number(e.target.value))}
          className="input w-20 text-center"
        />
      </div>

      {/* 投掷按钮 */}
      <button
        onClick={rollDice}
        disabled={isRolling}
        className="w-full btn-fantasy disabled:opacity-50"
      >
        {isRolling ? "投掷中..." : `投掷 ${selectedDice}`}
      </button>

      {/* 结果显示 */}
      {result !== null && (
        <div className="card text-center">
          <div className="text-4xl font-bold text-amber-400 mb-2">
            {result}
          </div>
          <div className="text-sm text-gray-400">
            {selectedDice} {modifier !== 0 && `${modifier >= 0 ? "+" : ""}${modifier}`}
          </div>
        </div>
      )}
    </div>
  );
}

