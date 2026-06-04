import { useState, useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { DiceIcon } from "./DiceIcons";

// 骰子结果分解 JSX：骰值着色（nat20金色、nat1红色、其他琥珀色）
function renderRollBreakdown(roll: { rolls?: number[][]; modifier?: number }, fontSize = 'text-xs') {
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
      (group as number[]).forEach((die, j) => {
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
}

// 根据投骰结果获取状态样式
function getResultTheme(r: { dc?: number; success?: boolean; is_critical?: boolean; is_fumble?: boolean }) {
  if (r.dc === undefined) return null;
  if (r.is_critical) return {
    text: '大成功', icon: '✦',
    badge: 'bg-yellow-500 text-gray-950 font-bold',
    num: 'text-yellow-300 drop-shadow-[0_0_10px_rgba(253,224,71,0.7)]',
    border: 'border-l-yellow-400',
    bg: 'bg-gradient-to-r from-yellow-500/10 via-transparent to-transparent',
  };
  if (r.is_fumble) return {
    text: '大失败', icon: '✕',
    badge: 'bg-red-600 text-white font-bold',
    num: 'text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.6)]',
    border: 'border-l-red-500',
    bg: 'bg-gradient-to-r from-red-500/10 via-transparent to-transparent',
  };
  if (r.success) return {
    text: '成功', icon: '✓',
    badge: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    num: 'text-emerald-200',
    border: 'border-l-emerald-500',
    bg: '',
  };
  return {
    text: '失败', icon: '✗',
    badge: 'bg-rose-500/15 text-rose-300 border border-rose-500/25',
    num: 'text-rose-300',
    border: 'border-l-rose-500/60',
    bg: '',
  };
}

interface DiceRoll {
  id: string;
  user: string;
  senderUserId?: string;
  senderRole?: string;
  timestamp: Date;
  roll: {
    expression?: string;
    rolls?: number[][];
    modifier?: number;
    total?: number;
    dc?: number;
    success?: boolean;
    is_critical?: boolean;
    is_fumble?: boolean;
    ability?: string;
    skill?: string;
    narrative?: string;
    description?: string;
    actor_name?: string;
    actor_type?: string;
    actor_user_id?: string;
    is_private?: boolean;
  };
}

interface Member {
  user_id: string;
  role: string;
  character_name?: string;
  selected_character_id?: number;
  avatar?: string;
}

interface Token {
  id: number;
  monster_instance_id?: number | null;
  monster_name?: string | null;
  instance_name?: string | null;
  avatar?: string | null;
}

interface DiceResultsGroupedProps {
  diceRolls: DiceRoll[];
  members: Member[];
  tokens?: Token[];
  isDM: boolean;
  onClearDice?: () => void;
  onRequestNarrative?: (messageId: string | number) => void;
  narrativeLoadingId?: string | number | null;
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

type GroupType = "player" | "monster" | "npc" | "other";

interface GroupedCharacter {
  id: string;
  name: string;
  avatar?: string;
  type: GroupType;
  rolls: DiceRoll[];
}

export function DiceResultsGrouped({
  diceRolls,
  members,
  tokens = [],
  isDM,
  onClearDice,
  onRequestNarrative,
  narrativeLoadingId,
}: DiceResultsGroupedProps) {
  const [expandedCharacters, setExpandedCharacters] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GroupType>>(new Set());

  const groupedData = useMemo(() => {
    const characterMap = new Map<string, GroupedCharacter>();

    diceRolls.forEach((roll) => {
      let characterId: string;
      let characterName: string;
      let characterType: GroupType;
      let avatar: string | undefined;

      const actorType = roll.roll.actor_type;
      const actorName = roll.roll.actor_name || roll.user;
      const actorUserId = roll.roll.actor_user_id;

      // Find matching member by character name (works for both player rolls and DM proxy)
      const memberByName = members.find(m =>
        m.role === "player" && m.character_name === actorName
      );
      // Find member by actor_user_id (for DM proxy rolls)
      const memberByActorUserId = actorUserId
        ? members.find(m => m.role === "player" && m.user_id === actorUserId)
        : null;
      // Find member by sender user_id (for player's own rolls)
      const memberBySender = roll.senderRole === "player"
        ? members.find(m => m.role === "player" && m.user_id === roll.senderUserId)
        : null;
      const member = memberByName || memberByActorUserId || memberBySender;

      if (actorType === "monster") {
        // Monster roll (by DM or from combat)
        characterId = `monster-${actorName}`;
        characterName = actorName;
        characterType = "monster";
        const monsterToken = tokens.find(t =>
          t.monster_instance_id && (
            t.instance_name === actorName ||
            t.monster_name === actorName ||
            actorName?.startsWith(t.monster_name || '')
          )
        );
        avatar = monsterToken?.avatar || undefined;
      } else if (memberByName) {
        // Player character roll (by player themselves OR DM proxy) - group by character name
        characterId = `player-${memberByName.character_name}`;
        characterName = memberByName.character_name || actorName;
        avatar = memberByName.avatar;
        characterType = "player";
      } else if (memberByActorUserId) {
        // DM proxy roll matched by actor_user_id - use their character info
        characterId = `player-${memberByActorUserId.character_name || memberByActorUserId.user_id}`;
        characterName = memberByActorUserId.character_name || actorName;
        avatar = memberByActorUserId.avatar;
        characterType = "player";
      } else if (memberBySender) {
        // Player's own roll but actorName doesn't match - use their character
        characterId = `player-${memberBySender.character_name}`;
        characterName = memberBySender.character_name || actorName;
        avatar = memberBySender.avatar;
        characterType = "player";
      } else if (roll.senderRole === "dm" && actorName && actorName !== "DM") {
        // DM proxy for non-player (monster without type set, NPC, etc.)
        characterId = `monster-${actorName}`;
        characterName = actorName;
        characterType = "monster";
        const monsterToken = tokens.find(t =>
          t.instance_name === actorName ||
          t.monster_name === actorName ||
          actorName?.startsWith(t.monster_name || '')
        );
        avatar = monsterToken?.avatar || undefined;
      } else if (roll.senderRole === "dm") {
        // DM's own roll (no proxy)
        characterId = "dm";
        characterName = "DM";
        characterType = "other";
      } else {
        characterId = `other-${actorName}`;
        characterName = actorName;
        characterType = "other";
      }

      if (!characterMap.has(characterId)) {
        characterMap.set(characterId, {
          id: characterId,
          name: characterName,
          avatar,
          type: characterType,
          rolls: [],
        });
      }
      characterMap.get(characterId)!.rolls.push(roll);
    });

    const groups: Record<GroupType, GroupedCharacter[]> = {
      player: [], monster: [], npc: [], other: [],
    };

    characterMap.forEach((char) => {
      char.rolls.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      groups[char.type].push(char);
    });

    Object.values(groups).forEach(group => {
      group.sort((a, b) => {
        const aLatest = a.rolls[0]?.timestamp.getTime() || 0;
        const bLatest = b.rolls[0]?.timestamp.getTime() || 0;
        return bLatest - aLatest;
      });
    });

    return groups;
  }, [diceRolls, members, tokens]);

  const toggleExpand = (characterId: string) => {
    setExpandedCharacters(prev => {
      const next = new Set(prev);
      if (next.has(characterId)) next.delete(characterId);
      else next.add(characterId);
      return next;
    });
  };

  const toggleGroupCollapse = (groupType: GroupType) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupType)) next.delete(groupType);
      else next.add(groupType);
      return next;
    });
  };

  const groupLabels: Record<GroupType, { label: string; icon: string }> = {
    player: { label: "玩家", icon: "⚔️" },
    monster: { label: "怪物", icon: "👹" },
    npc: { label: "NPC", icon: "👤" },
    other: { label: "其他", icon: "🎲" },
  };

  const renderGroup = (type: GroupType) => {
    const characters = groupedData[type];
    if (characters.length === 0) return null;

    const { label, icon } = groupLabels[type];
    const isCollapsed = collapsedGroups.has(type);

    return (
      <div key={type} className="space-y-3">
        {/* 分组标题 - 可点击折叠 */}
        <div
          className="flex items-center gap-2 px-1 cursor-pointer hover:opacity-80 transition-opacity select-none"
          onClick={() => toggleGroupCollapse(type)}
        >
          <span className={`text-xs text-gray-400 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}>
            ▶
          </span>
          <span className="text-lg">{icon}</span>
          <h3 className="text-sm font-semibold text-amber-400/90 tracking-wide uppercase">
            {label}
          </h3>
          <div className="flex-1 h-px bg-gradient-to-r from-amber-500/30 to-transparent" />
          <span className="text-xs text-gray-500">{characters.length}人</span>
        </div>

        {/* 角色卡片网格 - 可折叠，最少两列，宽度够时自动增加列数 */}
        {!isCollapsed && (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(50% - 4px, 160px), 1fr))' }}>
            {characters.map((char) => (
              <CharacterDiceCard
                key={char.id}
                character={char}
                isExpanded={expandedCharacters.has(char.id)}
                onToggleExpand={() => toggleExpand(char.id)}
                onRequestNarrative={onRequestNarrative}
                narrativeLoadingId={narrativeLoadingId}
                isDM={isDM}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  if (diceRolls.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-6xl mb-4 opacity-40">🎲</div>
          <p className="text-gray-400 text-sm">暂无骰子结果</p>
          <p className="text-gray-600 text-xs mt-1">投掷后的结果会在此显示</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {isDM && onClearDice && (
        <div className="sticky top-0 z-10 px-4 py-2 bg-gray-900/95 backdrop-blur border-b border-amber-500/10">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">共 {diceRolls.length} 条记录</span>
            <button
              onClick={onClearDice}
              className="text-xs px-3 py-1.5 rounded-md text-red-400 border border-red-700/50 hover:bg-red-900/20 transition-colors flex items-center gap-1.5"
            >
              <span>🗑️</span> 清空
            </button>
          </div>
        </div>
      )}
      <div className="p-4 space-y-6">
        {renderGroup("player")}
        {renderGroup("monster")}
        {renderGroup("npc")}
        {renderGroup("other")}
      </div>
    </div>
  );
}

// 角色骰子卡片组件
interface CharacterDiceCardProps {
  character: GroupedCharacter;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRequestNarrative?: (messageId: string | number) => void;
  narrativeLoadingId?: string | number | null;
  isDM: boolean;
}

function CharacterDiceCard({
  character,
  isExpanded,
  onToggleExpand,
  onRequestNarrative,
  narrativeLoadingId,
  isDM,
}: CharacterDiceCardProps) {
  const [showNarrativeFor, setShowNarrativeFor] = useState<string | null>(null);

  const latestRoll = character.rolls[0];
  const hasMore = character.rolls.length > 1;

  const stats = useMemo(() => {
    let success = 0;
    let fail = 0;
    character.rolls.forEach(r => {
      if (r.roll.dc !== undefined) {
        if (r.roll.success || r.roll.is_critical) success++;
        else fail++;
      }
    });
    return { success, fail };
  }, [character.rolls]);

  const getDefaultBg = () => {
    switch (character.type) {
      case "player": return "from-blue-800 to-blue-900";
      case "monster": return "from-red-800 to-red-900";
      case "npc": return "from-purple-800 to-purple-900";
      default: return "from-gray-700 to-gray-800";
    }
  };

  const getResultStyle = (r: DiceRoll['roll']) => {
    return getResultTheme(r);
  };

  const resultStyle = latestRoll ? getResultStyle(latestRoll.roll) : null;

  return (
    <>
      {/* 主卡片 */}
      <div
        onClick={hasMore ? onToggleExpand : undefined}
        className={`relative overflow-hidden rounded-xl border border-white/10 hover:border-amber-500/40 transition-all duration-300 ${hasMore ? 'cursor-pointer' : ''}`}
      >
        {/* 背景 */}
        {character.avatar ? (
          <>
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${character.avatar})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-black/40" />
          </>
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${getDefaultBg()}`} />
        )}

        {/* 内容 */}
        <div className="relative z-10 p-2">
          <h4 className="font-bold text-white text-sm truncate drop-shadow-lg mb-1">
            {character.name}
          </h4>

          <div className="flex items-center gap-1 mb-2 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-600/90 text-white font-bold">
              {character.rolls.length}次
            </span>
            {stats.success > 0 && (
              <span className="text-[10px] px-1 py-0.5 rounded-full bg-green-500/50 text-green-100">
                ✓{stats.success}
              </span>
            )}
            {stats.fail > 0 && (
              <span className="text-[10px] px-1 py-0.5 rounded-full bg-red-500/50 text-red-100">
                ✗{stats.fail}
              </span>
            )}
          </div>

          {latestRoll && (
            <div className={`rounded-md p-2 backdrop-blur-sm border-l-[3px] ${resultStyle?.border || 'border-l-amber-500/30'} ${resultStyle?.bg || ''} bg-black/40`}>
              {/* 暗投/明投 + 检定类型 */}
              <div className="flex items-center gap-1.5 mb-1">
                <DiceIcon expression={latestRoll.roll.expression} size={12} className={resultStyle ? 'text-current opacity-60' : 'text-amber-500/50'} />
                {latestRoll.roll.is_private ? (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-purple-800/60 text-purple-200 border border-purple-500/40">
                    🔒 暗投
                  </span>
                ) : (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-gray-700/30 text-gray-500">
                    明投
                  </span>
                )}
                {(latestRoll.roll.skill || latestRoll.roll.ability) && (
                  <span className="text-[10px] text-gray-300">
                    {SKILL_NAMES[latestRoll.roll.skill?.toLowerCase() || ''] ||
                     ABILITY_NAMES[latestRoll.roll.ability?.toLowerCase() || ''] ||
                     latestRoll.roll.skill || latestRoll.roll.ability}
                  </span>
                )}
              </div>

              {latestRoll.roll.description && (
                <div className="text-[10px] text-amber-200/90 mb-1 line-clamp-1">
                  "{latestRoll.roll.description}"
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-amber-300 font-mono">
                  {latestRoll.roll.expression || "1d20"}
                </span>
                <span className="text-gray-500 text-xs">→</span>
                {renderRollBreakdown(latestRoll.roll, 'text-[10px]')}
                <span className={`text-xl font-bold tabular-nums ${resultStyle?.num || 'text-white'}`}>
                  {latestRoll.roll.total ?? "?"}
                </span>
              </div>

              {resultStyle && (
                <div className={`text-[10px] mt-1 px-1.5 py-0.5 rounded-full inline-block ${resultStyle.badge}`}>
                  {resultStyle.icon} DC{latestRoll.roll.dc} {resultStyle.text}
                </div>
              )}
            </div>
          )}

          {hasMore && (
            <p className="text-[10px] text-amber-400/80 mt-1.5 text-center">
              点击查看全部 {character.rolls.length} 条记录
            </p>
          )}
        </div>
      </div>

      {/* 展开的详细列表 - 弹出层 */}
      <Dialog.Root open={isExpanded} onOpenChange={(open) => { if (!open) onToggleExpand(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[10100]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md max-h-[80dvh] overflow-hidden bg-gray-900 rounded-xl border border-amber-500/30 z-[10101]"
          >
            <div className="relative h-24 overflow-hidden">
              {character.avatar ? (
                <>
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `url(${character.avatar})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent" />
                </>
              ) : (
                <div className={`absolute inset-0 bg-gradient-to-br ${getDefaultBg()}`} />
              )}
              <div className="absolute bottom-0 left-0 right-0 p-3 flex items-end justify-between">
                <div>
                  <Dialog.Title className="font-bold text-lg text-white drop-shadow-lg">{character.name}</Dialog.Title>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-600/80 text-white">
                      {character.rolls.length}次
                    </span>
                    {stats.success > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/30 text-green-200">
                        ✓{stats.success}
                      </span>
                    )}
                    {stats.fail > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/30 text-red-200">
                        ✗{stats.fail}
                      </span>
                    )}
                  </div>
                </div>
                <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors">
                  ✕
                </Dialog.Close>
              </div>
            </div>

            <div className="overflow-y-auto max-h-[calc(80dvh-6rem)] p-3 space-y-2">
              {character.rolls.map((roll) => (
                <DiceRollItem
                  key={roll.id}
                  roll={roll}
                  isLatest={roll.id === latestRoll?.id}
                  showNarrative={showNarrativeFor === roll.id}
                  onToggleNarrative={() => {
                    if (roll.roll.narrative) {
                      setShowNarrativeFor(showNarrativeFor === roll.id ? null : roll.id);
                    } else if (onRequestNarrative && isDM) {
                      onRequestNarrative(roll.id);
                      setShowNarrativeFor(roll.id);
                    }
                  }}
                  narrativeLoading={narrativeLoadingId === roll.id}
                  isDM={isDM}
                />
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

// 单条骰子记录
interface DiceRollItemProps {
  roll: DiceRoll;
  isLatest: boolean;
  showNarrative: boolean;
  onToggleNarrative: () => void;
  narrativeLoading: boolean;
  isDM: boolean;
}

function DiceRollItem({ roll, isLatest, showNarrative, onToggleNarrative, narrativeLoading, isDM }: DiceRollItemProps) {
  const r = roll.roll;
  const theme = getResultTheme(r);

  const checkTypeName = r.skill
    ? SKILL_NAMES[r.skill.toLowerCase()] || r.skill
    : r.ability
    ? ABILITY_NAMES[r.ability.toLowerCase()] || r.ability
    : null;

  const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className={`rounded-lg px-3 py-2 border-l-[3px] ${theme?.border || 'border-l-amber-500/30'} ${theme?.bg || ''} ${isLatest ? 'bg-black/30' : 'bg-black/20'} backdrop-blur-sm`}>
      {/* 暗投/明投 + 投骰对象 */}
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <DiceIcon expression={r.expression} size={14} className={theme ? 'opacity-60' : 'text-amber-500/50'} />
        {r.is_private ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-800/60 text-purple-200 border border-purple-500/40">
            🔒 暗投
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/30 text-gray-500">
            明投
          </span>
        )}
        {r.actor_name && (
          <span className="text-[10px] text-gray-400">
            → {r.actor_type === 'monster' ? `${r.actor_name}（怪物）` : r.actor_name}
          </span>
        )}
      </div>

      {/* 描述 */}
      {r.description && (
        <div className="text-xs text-amber-200/90 mb-2 italic">"{r.description}"</div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {checkTypeName && (
          <span className="text-[11px] px-2 py-0.5 rounded bg-gray-700/70 text-gray-200 border border-gray-600/50">
            {checkTypeName}
          </span>
        )}

        <span className="text-sm font-mono text-amber-300">{r.expression || "1d20"}</span>
        <span className="text-gray-500 text-sm">→</span>
        {renderRollBreakdown(r, 'text-sm')}

        <span className={`text-2xl font-bold tabular-nums ${theme?.num || 'text-amber-100'}`}>
          {r.total ?? "?"}
        </span>

        {theme && (
          <span className={`text-xs px-2 py-1 rounded-full ${theme.badge}`}>
            {theme.icon} DC{r.dc} {theme.text}
          </span>
        )}

        <span className="ml-auto text-[11px] text-gray-400">{formatTime(roll.timestamp)}</span>
      </div>

      {(r.narrative || isDM) && (
        <div className="mt-2">
          <button
            onClick={onToggleNarrative}
            disabled={narrativeLoading || (!isDM && !r.narrative)}
            className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
              narrativeLoading ? "text-gray-400 bg-gray-800/50 cursor-wait" :
              r.narrative ? (showNarrative ? "text-purple-200 bg-purple-800/50 border border-purple-500/50" : "text-purple-300 bg-purple-900/30 hover:bg-purple-800/40") :
              "text-purple-400/70 bg-purple-900/20 hover:bg-purple-900/40"
            }`}
          >
            {narrativeLoading ? "生成中..." : r.narrative ? (showNarrative ? "收起剧情" : "查看剧情") : "生成剧情"}
          </button>

          {showNarrative && r.narrative && (
            <div className="mt-2 text-xs text-gray-200 italic bg-purple-900/30 p-3 rounded-lg border-l-2 border-purple-400/60 leading-relaxed">
              {r.narrative}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
