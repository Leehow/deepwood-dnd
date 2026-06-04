import { useState } from "react";
import { DiceIcon } from "./DiceIcons";

interface DiceResultCardProps {
  roll: {
    expression?: string;
    rolls?: number[][];
    modifier?: number;
    roll_modifier?: string;
    both_dice?: number[];
    used_die?: number;
    roll_modifier_reasons?: string[];
    total?: number;
    dc?: number;
    success?: boolean;
    is_critical?: boolean;
    is_fumble?: boolean;
    ability?: string;
    skill?: string;
    narrative?: string;
    description?: string;
    is_private?: boolean;
    actor_name?: string;
    actor_type?: string;
    control_type?: string;
  };
  userName: string;
  timestamp: Date;
  expandable?: boolean;
  messageId?: number | string;
  onRequestNarrative?: (messageId: number | string) => void;
  narrativeLoading?: boolean;
  isDM?: boolean;
  /** 紧凑模式：用于聊天室内联显示 */
  compact?: boolean;
}

const SKILL_NAMES: Record<string, string> = {
  athletics: "运动", acrobatics: "体操", sleight_of_hand: "巧手", stealth: "隐匿",
  arcana: "奥秘", history: "历史", investigation: "调查", nature: "自然",
  religion: "宗教", animal_handling: "驯兽", insight: "洞悉", medicine: "医药",
  perception: "察觉", survival: "生存", deception: "欺诈", intimidation: "威吓",
  performance: "表演", persuasion: "游说",
};
const ABILITY_NAMES: Record<string, string> = {
  strength: "力量", dexterity: "敏捷", constitution: "体质",
  intelligence: "智力", wisdom: "感知", charisma: "魅力",
  str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力",
};

type ResultTheme = 'critical' | 'fumble' | 'success' | 'fail' | 'neutral';

// 主题配色系统
const THEMES: Record<ResultTheme, {
  border: string; bg: string; icon: string;
  numBadge: string; statusBadge: string; statusText: string; statusIcon: string;
  cardBorder: string; cardBg: string; numGlow: string;
}> = {
  critical: {
    border: 'border-l-yellow-400',
    bg: 'bg-gradient-to-r from-yellow-500/10 via-yellow-500/[0.04] to-transparent',
    icon: 'text-yellow-400 drop-shadow-[0_0_4px_rgba(250,204,21,0.4)]',
    numBadge: 'text-yellow-100 bg-gradient-to-r from-yellow-600/40 to-yellow-500/25 border border-yellow-400/50',
    numGlow: 'shadow-[0_0_12px_rgba(250,204,21,0.3)]',
    statusBadge: 'bg-yellow-500 text-gray-950 font-bold',
    statusText: '大成功', statusIcon: '✦',
    cardBorder: 'border-yellow-500/40', cardBg: 'from-yellow-500/10 via-gray-800/60 to-gray-800/40',
  },
  fumble: {
    border: 'border-l-red-500',
    bg: 'bg-gradient-to-r from-red-500/10 via-red-500/[0.04] to-transparent',
    icon: 'text-red-400 drop-shadow-[0_0_4px_rgba(239,68,68,0.4)]',
    numBadge: 'text-red-100 bg-gradient-to-r from-red-600/40 to-red-500/25 border border-red-500/50',
    numGlow: 'shadow-[0_0_12px_rgba(239,68,68,0.3)]',
    statusBadge: 'bg-red-600 text-white font-bold',
    statusText: '大失败', statusIcon: '✕',
    cardBorder: 'border-red-500/40', cardBg: 'from-red-500/10 via-gray-800/60 to-gray-800/40',
  },
  success: {
    border: 'border-l-emerald-500',
    bg: '',
    icon: 'text-emerald-400/70',
    numBadge: 'text-emerald-200 bg-emerald-500/15 border border-emerald-500/25',
    numGlow: '',
    statusBadge: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    statusText: '成功', statusIcon: '✓',
    cardBorder: 'border-emerald-500/30', cardBg: 'from-gray-800/60 to-gray-800/40',
  },
  fail: {
    border: 'border-l-rose-500/60',
    bg: '',
    icon: 'text-rose-400/50',
    numBadge: 'text-rose-300 bg-rose-500/10 border border-rose-500/20',
    numGlow: '',
    statusBadge: 'bg-rose-500/15 text-rose-300 border border-rose-500/25',
    statusText: '失败', statusIcon: '✗',
    cardBorder: 'border-rose-500/25', cardBg: 'from-gray-800/60 to-gray-800/40',
  },
  neutral: {
    border: 'border-l-amber-500/30',
    bg: '',
    icon: 'text-amber-500/50',
    numBadge: 'text-amber-200 bg-amber-500/10 border border-amber-500/15',
    numGlow: '',
    statusBadge: '', statusText: '', statusIcon: '',
    cardBorder: 'border-amber-500/20', cardBg: 'from-gray-800/60 to-gray-800/40',
  },
};

export function DiceResultCard({
  roll, userName, timestamp, expandable = false, messageId,
  onRequestNarrative, narrativeLoading = false, isDM = false, compact = false,
}: DiceResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showNarrative, setShowNarrative] = useState(false);
  const rollModifierReasons = Array.isArray(roll.roll_modifier_reasons)
    ? roll.roll_modifier_reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
    : [];

  const checkTypeName = roll.skill
    ? SKILL_NAMES[roll.skill.toLowerCase()] || roll.skill
    : roll.ability
    ? ABILITY_NAMES[roll.ability.toLowerCase()] || roll.ability
    : null;

  const hasDC = typeof roll.dc === "number";
  const theme: ResultTheme = roll.is_critical ? 'critical'
    : roll.is_fumble ? 'fumble'
    : (hasDC && roll.success) ? 'success'
    : (hasDC && !roll.success) ? 'fail'
    : 'neutral';
  const t = THEMES[theme];

  // 骰子结果分解 JSX：骰值着色（nat20金色、nat1红色、其他琥珀色）
  const renderBreakdown = (fontSize = 'text-xs') => {
    if (!roll.rolls || roll.rolls.length === 0) return null;
    const allDice = roll.rolls.flat();
    const hasMod = typeof roll.modifier === 'number' && roll.modifier !== 0;
    if (allDice.length === 1 && !hasMod) return null;

    const dieColor = (v: number) =>
      v === 20 ? 'text-yellow-300 font-semibold' :
      v === 1 ? 'text-red-400 font-semibold' :
      'text-amber-300/90';

    const els: React.ReactNode[] = [];
    roll.rolls.forEach((group, i) => {
      if (i > 0) els.push(<span key={`s${i}`} className="text-gray-600">+</span>);
      if (Array.isArray(group)) {
        els.push(<span key={`b${i}`} className="text-gray-600">[</span>);
        group.forEach((die, j) => {
          if (j > 0) els.push(<span key={`p${i}${j}`} className="text-gray-600">|</span>);
          els.push(<span key={`d${i}${j}`} className={dieColor(die)}>{die}</span>);
        });
        els.push(<span key={`e${i}`} className="text-gray-600">]</span>);
      } else {
        els.push(
          <span key={`g${i}`}>
            <span className="text-gray-600">[</span>
            <span className={dieColor(group as number)}>{group}</span>
            <span className="text-gray-600">]</span>
          </span>
        );
      }
    });
    if (hasMod) {
      const ms = roll.modifier! > 0 ? `+${roll.modifier}` : `${roll.modifier}`;
      els.push(<span key="m" className="text-gray-400">{ms}</span>);
    }
    els.push(<span key="eq" className="text-gray-500">=</span>);
    return <span className={`font-mono ${fontSize}`}>{els}</span>;
  };

  const handleNarrativeClick = () => {
    if (roll.narrative) {
      setShowNarrative(!showNarrative);
    } else if (messageId && onRequestNarrative && !narrativeLoading) {
      onRequestNarrative(messageId);
      setShowNarrative(true);
    }
  };

  const renderReasonBadge = (reason: string, index: number) => {
    const badgeClass = reason.includes("劣势")
      ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
      : reason.includes("优势")
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
        : "border-amber-500/20 bg-amber-500/10 text-amber-100";

    return (
      <span
        key={`${reason}-${index}`}
        className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] leading-none font-sans ${badgeClass}`}
      >
        {reason}
      </span>
    );
  };

  // ========== 紧凑模式（聊天室内联） ==========
  if (compact) {
    return (
      <div className="relative">
        <div className={`rounded-r-md border-l-[3px] py-1.5 px-2.5 ${t.border} ${t.bg}`}>
          {/* 第一行：上下文信息 */}
          <div className="flex items-center gap-1.5 text-[10px] leading-tight mb-1">
            <DiceIcon expression={roll.expression} size={13} className={`flex-shrink-0 ${t.icon}`} />

            {roll.is_private ? (
              <span className="px-1 py-px rounded bg-purple-800/60 text-purple-200 font-sans border border-purple-500/40">
                🔒暗投
              </span>
            ) : (
              <span className="px-1 py-px rounded bg-gray-700/30 text-gray-500 font-sans">
                明投
              </span>
            )}

            {roll.actor_name && (
              <span className="text-gray-400 font-sans truncate max-w-[120px]">
                →{roll.actor_type === 'monster'
                  ? `${roll.actor_name}（${
                      roll.control_type === 'companion' ? '伙伴'
                      : roll.control_type === 'familiar' ? '魔宠'
                      : roll.control_type === 'summon' ? '召唤'
                      : roll.control_type === 'mount' ? '坐骑'
                      : '怪'}）`
                  : roll.actor_name}
              </span>
            )}

            {checkTypeName && (
              <span className="px-1 py-px rounded bg-gray-700/50 text-gray-300 font-sans">
                {checkTypeName}
              </span>
            )}

            {/* 剧情按钮放右侧 */}
            <span className="flex-1" />
            {(roll.narrative || isDM) && (
              <button
                onClick={handleNarrativeClick}
                disabled={narrativeLoading || (!isDM && !roll.narrative)}
                className={`px-1.5 py-0.5 rounded whitespace-nowrap transition-colors ${
                  narrativeLoading ? "text-gray-500 bg-gray-700/50" :
                  roll.narrative ? "text-purple-300 bg-purple-800/40 hover:bg-purple-700/50" : "text-gray-400 bg-gray-700/40 hover:bg-purple-800/40"
                }`}
              >
                {narrativeLoading ? "生成中..." : roll.narrative ? (showNarrative ? "收起" : "剧情") : "生成剧情"}
              </button>
            )}
          </div>

          {rollModifierReasons.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {rollModifierReasons.map(renderReasonBadge)}
            </div>
          )}

          {/* 第二行：骰子结果（重点信息） */}
          <div className="flex items-center gap-1.5 text-xs leading-tight">
            <span className="text-gray-500 font-mono">{roll.expression || "1d20"}</span>
            {renderBreakdown()}

            {/* 结果数字 - 突出显示 */}
            <span className={`font-bold text-sm tabular-nums px-1.5 py-0.5 rounded font-mono ${t.numBadge} ${t.numGlow}`}>
              {roll.total ?? "?"}
            </span>

            {/* DC + 状态徽章 */}
            {hasDC && t.statusText && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap tracking-wide ${t.statusBadge}`}>
                {t.statusIcon} DC{roll.dc} {t.statusText}
              </span>
            )}
          </div>
        </div>

        {/* 剧情展开 */}
        {showNarrative && roll.narrative && (
          <div className="mt-1.5 text-[11px] text-gray-300 italic bg-purple-900/30 px-2 py-1.5 rounded border-l-2 border-purple-500/50 font-sans">
            {roll.narrative}
          </div>
        )}
      </div>
    );
  }

  // ========== 卡片模式（骰子结果tab） ==========
  return (
    <div className={`bg-gradient-to-r ${t.cardBg} border ${t.cardBorder} rounded-lg p-3 hover:border-amber-500/40 transition-colors`}>
      {/* 头部 */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <DiceIcon expression={roll.expression} size={18} className={t.icon} />
          <span className="text-amber-300 font-medium truncate">{userName}</span>
          {checkTypeName && (
            <span className="text-xs text-gray-500 bg-gray-700/50 px-1.5 py-0.5 rounded">
              {checkTypeName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-500">{timestamp.toLocaleTimeString()}</span>
          {expandable && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-amber-400 hover:text-amber-300"
            >
              {isExpanded ? "收起" : "展开"}
            </button>
          )}
        </div>
      </div>

      {/* 描述 */}
      {roll.description && (
        <div className="text-xs text-amber-200/90 italic mb-2">"{roll.description}"</div>
      )}

      {rollModifierReasons.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {rollModifierReasons.map(renderReasonBadge)}
        </div>
      )}

      {/* 主体 */}
      <div className="flex items-center gap-3">
        <div className="text-sm font-mono text-amber-400/80">{roll.expression || "1d20"}</div>
        <span className="text-gray-600">→</span>
        {renderBreakdown('text-sm')}

        {/* 结果数字 */}
        <div className={`text-2xl font-bold tabular-nums px-2 py-0.5 rounded ${t.numBadge} ${t.numGlow}`}>
          {roll.total ?? "?"}
        </div>

        {/* DC判定 */}
        {hasDC && t.statusText && (
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm ${t.statusBadge}`}>
            <span className="font-mono">DC{roll.dc}</span>
            <span>{t.statusIcon} {t.statusText}</span>
          </div>
        )}

        <div className="flex-1" />
        {(roll.narrative || isDM) && (
          <button
            onClick={handleNarrativeClick}
            disabled={narrativeLoading || (!isDM && !roll.narrative)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              narrativeLoading
                ? "text-gray-500 bg-gray-800/30 border-gray-600/30 cursor-wait"
                : "text-purple-400 hover:text-purple-300 bg-purple-900/20 border-purple-500/30 hover:bg-purple-900/40"
            }`}
          >
            {narrativeLoading ? "生成中..." : roll.narrative ? (showNarrative ? "收起剧情" : "查看剧情") : "生成剧情"}
          </button>
        )}
      </div>

      {/* 展开详情 */}
      {isExpanded && roll.rolls && roll.rolls.length > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-700/50">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">骰子:</span>
            {roll.rolls.map((diceGroup, i) => (
              <div key={i} className="flex items-center gap-1">
                {Array.isArray(diceGroup) ? (
                  diceGroup.map((die, j) => (
                    <span key={j} className={`inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded border ${
                      die === 20 ? "bg-yellow-900/50 border-yellow-500/50 text-yellow-300" :
                      die === 1 ? "bg-red-900/50 border-red-500/50 text-red-300" :
                      "bg-gray-700/50 border-amber-500/30 text-amber-300"
                    }`}>
                      {die}
                    </span>
                  ))
                ) : (
                  <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded bg-gray-700/50 border border-amber-500/30 text-amber-300">
                    {diceGroup}
                  </span>
                )}
              </div>
            ))}
            {typeof roll.modifier === "number" && roll.modifier !== 0 && (
              <span className="text-xs text-gray-400">
                {roll.modifier > 0 ? `+${roll.modifier}` : roll.modifier}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 剧情内容 */}
      {showNarrative && roll.narrative && (
        <div className="mt-2 text-sm text-gray-300 italic bg-purple-900/10 p-2 rounded border-l-2 border-purple-500/50">
          {roll.narrative}
        </div>
      )}
    </div>
  );
}
