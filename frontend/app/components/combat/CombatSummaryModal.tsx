import { useMemo, useState } from "react";

type Faction = 1 | 2;

interface Participant {
  token_id: number;
  name: string;
  type: "character" | "monster" | "item";
  faction: Faction;
}

interface DefeatedParticipant {
  token_id: number;
  name: string;
  type: "character" | "monster";
  faction: Faction;
  monster_instance_id?: number;
  xp_value?: number;
}

interface DamageStats {
  damage_dealt: number;
  damage_taken: number;
  kills: number;
}

interface CombatSummaryModalProps {
  isOpen: boolean;
  participants: Participant[];
  defeatedParticipants: DefeatedParticipant[];
  damageStats: Record<number, DamageStats>;
  round: number;
  onClose: () => void;
  onConfirmEnd: () => void;
  onDistributeXP: (characterIds: number[], xpPerCharacter: number) => void;
}

export function CombatSummaryModal({
  isOpen,
  participants,
  defeatedParticipants,
  damageStats,
  round,
  onClose,
  onConfirmEnd,
  onDistributeXP,
}: CombatSummaryModalProps) {
  const [xpDistributed, setXpDistributed] = useState(false);

  // Determine winner
  const winner = useMemo(() => {
    const defeatedIds = new Set(defeatedParticipants.map(d => d.token_id));
    const faction1Alive = participants.filter(p => p.faction === 1 && !defeatedIds.has(p.token_id)).length;
    const faction2Alive = participants.filter(p => p.faction === 2 && !defeatedIds.has(p.token_id)).length;

    if (faction1Alive === 0 && faction2Alive === 0) return "draw";
    if (faction1Alive === 0) return "faction2";
    if (faction2Alive === 0) return "faction1";
    return null; // Combat ended manually
  }, [participants, defeatedParticipants]);

  // Calculate XP from defeated enemy monsters (faction 2)
  const xpCalc = useMemo(() => {
    const enemyDefeated = defeatedParticipants.filter(
      p => p.type === "monster" && p.faction === 2
    );
    const totalXP = enemyDefeated.reduce((sum, p) => sum + (p.xp_value || 0), 0);

    // Get surviving player characters (faction 1)
    const defeatedIds = new Set(defeatedParticipants.map(d => d.token_id));
    const survivingCharacters = participants.filter(
      p => p.faction === 1 && p.type === "character" && !defeatedIds.has(p.token_id)
    );

    const xpPerCharacter = survivingCharacters.length > 0
      ? Math.floor(totalXP / survivingCharacters.length)
      : 0;

    return { totalXP, xpPerCharacter, survivingCharacters, enemyDefeated };
  }, [participants, defeatedParticipants]);

  // Stats sorted by damage dealt
  const sortedStats = useMemo(() => {
    return participants
      .map(p => ({
        ...p,
        stats: damageStats[p.token_id] || { damage_dealt: 0, damage_taken: 0, kills: 0 },
        isDefeated: defeatedParticipants.some(d => d.token_id === p.token_id)
      }))
      .sort((a, b) => b.stats.damage_dealt - a.stats.damage_dealt);
  }, [participants, damageStats, defeatedParticipants]);

  const handleDistributeXP = () => {
    if (xpCalc.xpPerCharacter > 0 && xpCalc.survivingCharacters.length > 0) {
      onDistributeXP(
        xpCalc.survivingCharacters.map(c => c.token_id),
        xpCalc.xpPerCharacter
      );
      setXpDistributed(true);
    }
  };

  if (!isOpen) return null;

  const cardStyle = {
    background: 'linear-gradient(180deg, rgba(35,30,25,0.98) 0%, rgba(20,18,15,0.99) 100%)',
    border: '1px solid rgba(184,134,11,0.4)'
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[min(95vw,520px)] max-h-[85dvh] overflow-hidden rounded-lg shadow-2xl" style={cardStyle}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-amber-500/30" style={{ background: 'linear-gradient(90deg, rgba(184,134,11,0.2) 0%, transparent 100%)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚔️</span>
              <span className="text-lg font-bold text-amber-400" style={{ textShadow: '0 0 8px rgba(255,215,0,0.4)' }}>
                战斗结算
              </span>
            </div>
            <span className="text-sm text-gray-400">共 {round} 回合</span>
          </div>
        </div>

        <div className="overflow-y-auto max-h-[calc(85dvh-120px)] p-4 space-y-4">
          {/* Winner Banner */}
          {winner && (
            <div className={`rounded-lg p-3 text-center ${
              winner === "faction1" ? "bg-blue-900/30 border border-blue-500/40" :
              winner === "faction2" ? "bg-red-900/30 border border-red-500/40" :
              "bg-gray-800/50 border border-gray-600/40"
            }`}>
              <div className="text-2xl mb-1">
                {winner === "faction1" ? "🏆" : winner === "faction2" ? "💀" : "🤝"}
              </div>
              <div className={`text-lg font-bold ${
                winner === "faction1" ? "text-blue-400" :
                winner === "faction2" ? "text-red-400" :
                "text-gray-400"
              }`}>
                {winner === "faction1" ? "友方胜利！" :
                 winner === "faction2" ? "敌方获胜" :
                 "战斗平局"}
              </div>
            </div>
          )}

          {/* Stats Table */}
          <div className="rounded-lg overflow-hidden border border-gray-700/50">
            <div className="px-3 py-2 bg-gray-800/50 border-b border-gray-700/50">
              <span className="text-sm font-medium text-gray-300">战斗统计</span>
            </div>
            <div className="divide-y divide-gray-800/50">
              {sortedStats.map((p, idx) => (
                <div key={p.token_id} className={`flex items-center gap-3 px-3 py-2 ${
                  p.isDefeated ? "bg-red-900/10 opacity-60" : ""
                }`}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{
                    background: p.faction === 1 ? '#1e3a5f' : '#7f1d1d',
                    color: '#fff'
                  }}>
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-sm truncate ${
                        p.isDefeated ? "line-through text-gray-500" :
                        p.faction === 1 ? "text-blue-300" : "text-red-300"
                      }`}>
                        {p.name}
                      </span>
                      {p.isDefeated && <span className="text-xs">💀</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px]">
                    <div className="text-center">
                      <div className="text-orange-400 font-medium">{p.stats.damage_dealt}</div>
                      <div className="text-gray-600">输出</div>
                    </div>
                    <div className="text-center">
                      <div className="text-red-400 font-medium">{p.stats.damage_taken}</div>
                      <div className="text-gray-600">承伤</div>
                    </div>
                    <div className="text-center">
                      <div className="text-yellow-400 font-medium">{p.stats.kills}</div>
                      <div className="text-gray-600">击杀</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Defeated List */}
          {defeatedParticipants.length > 0 && (
            <div className="rounded-lg overflow-hidden border border-red-900/40">
              <div className="px-3 py-2 bg-red-900/20 border-b border-red-900/30">
                <span className="text-sm font-medium text-red-400">阵亡名单 ({defeatedParticipants.length})</span>
              </div>
              <div className="p-2 flex flex-wrap gap-2">
                {defeatedParticipants.map(p => (
                  <div key={p.token_id} className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
                    p.faction === 1 ? "bg-blue-900/30 text-blue-300" : "bg-red-900/30 text-red-300"
                  }`}>
                    <span>💀</span>
                    <span>{p.name}</span>
                    {p.xp_value ? <span className="text-yellow-400 ml-1">({p.xp_value} XP)</span> : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* XP Section */}
          {xpCalc.totalXP > 0 && (
            <div className="rounded-lg overflow-hidden border border-yellow-700/40">
              <div className="px-3 py-2 bg-yellow-900/20 border-b border-yellow-900/30">
                <span className="text-sm font-medium text-yellow-400">经验值奖励</span>
              </div>
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">击败怪物经验总计:</span>
                  <span className="text-yellow-400 font-bold">{xpCalc.totalXP} XP</span>
                </div>
                {xpCalc.survivingCharacters.length > 0 && (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">存活玩家角色:</span>
                      <span className="text-blue-400">{xpCalc.survivingCharacters.length} 人</span>
                    </div>
                    <div className="flex items-center justify-between text-sm border-t border-gray-700/50 pt-2">
                      <span className="text-gray-300">每人获得:</span>
                      <span className="text-yellow-400 font-bold text-lg">{xpCalc.xpPerCharacter} XP</span>
                    </div>
                    <div className="text-[10px] text-gray-500">
                      分配给: {xpCalc.survivingCharacters.map(c => c.name).join(", ")}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-amber-500/30 flex items-center justify-end gap-2" style={{ background: 'rgba(20,18,15,0.95)' }}>
          {xpCalc.totalXP > 0 && xpCalc.survivingCharacters.length > 0 && !xpDistributed && (
            <button
              onClick={handleDistributeXP}
              className="px-4 py-1.5 rounded text-sm font-medium transition-all"
              style={{
                background: 'linear-gradient(180deg, #eab308, #ca8a04)',
                color: '#000',
                border: '1px solid #fde047'
              }}
            >
              发放经验值
            </button>
          )}
          {xpDistributed && (
            <span className="text-sm text-green-400 mr-2">✓ 经验已发放</span>
          )}
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded text-sm text-gray-400 hover:text-gray-200 transition-colors"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            继续战斗
          </button>
          <button
            onClick={onConfirmEnd}
            className="px-4 py-1.5 rounded text-sm font-medium transition-all"
            style={{
              background: 'linear-gradient(180deg, #dc2626, #b91c1c)',
              color: '#fff',
              border: '1px solid #ef4444'
            }}
          >
            确认结束
          </button>
        </div>
      </div>
    </div>
  );
}
