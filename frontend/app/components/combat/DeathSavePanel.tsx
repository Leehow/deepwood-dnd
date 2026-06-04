/**
 * DeathSavePanel - 死亡豁免面板
 * Shows death save progress (3 success/failure dots) and roll button
 */
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '~/utils/api-client';
import { subscribeAppEvent } from '~/events/appEventBus';

interface DeathSaves {
  successes: number;
  failures: number;
  stabilized: boolean;
}

interface Props {
  tokenId: number;
  deathSaves: DeathSaves;
  campaignId: string;
  tokenName?: string;
  userId?: string;
  isDM?: boolean;
}

export function DeathSavePanel({ tokenId, deathSaves: initialDS, campaignId, tokenName, userId, isDM }: Props) {
  const [ds, setDs] = useState<DeathSaves>(initialDS);
  const [rolling, setRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [revived, setRevived] = useState(false);

  useEffect(() => { setDs(initialDS); }, [initialDS]);

  // Listen for WebSocket death_save_update
  useEffect(() => {
    const handler = (detail: { token_id?: number; death_saves?: DeathSaves; revived?: boolean; roll?: number }) => {
      if (detail?.token_id === tokenId) {
        if (detail.death_saves) setDs(detail.death_saves);
        if (detail.revived) setRevived(true);
        if (detail.roll) setLastRoll(detail.roll);
      }
    };
    return subscribeAppEvent('death_save_update', handler);
  }, [tokenId]);

  const rollDeathSave = useCallback(async () => {
    setRolling(true);
    setLastRoll(null);
    try {
      const params = new URLSearchParams({ user_id: userId || 'anonymous', role: isDM ? 'dm' : 'player' });
      const resp = await apiFetch(`/api/combat/death-save?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: parseInt(campaignId, 10), token_id: tokenId }),
        userId,
      });
      if (resp.ok) {
        const data = await resp.json();
        setLastRoll(data.roll);
        setDs({ successes: data.successes, failures: data.failures, stabilized: data.stabilized });
        if (data.revived) setRevived(true);
      }
    } catch { /* errors handled by broadcast */ }
    setRolling(false);
  }, [tokenId, campaignId, userId, isDM]);

  if (revived) return null;

  const isDead = ds.failures >= 3;
  const isStable = ds.stabilized;

  return (
    <div className="bg-gray-800/80 border border-red-900/50 rounded-lg px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-red-300">
          💀 死亡豁免 {tokenName && `— ${tokenName}`}
        </span>
        {lastRoll && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
            lastRoll === 20 ? 'bg-yellow-500/30 text-yellow-300' :
            lastRoll === 1 ? 'bg-red-500/30 text-red-300' :
            lastRoll >= 10 ? 'bg-green-500/30 text-green-300' :
            'bg-red-500/30 text-red-300'
          }`}>
            d20: {lastRoll}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        {/* Successes */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 mr-1">成功</span>
          {[0, 1, 2].map(i => (
            <div key={`s${i}`} className={`w-4 h-4 rounded-full border-2 ${
              i < ds.successes
                ? 'bg-green-500 border-green-400'
                : 'bg-gray-700 border-gray-600'
            }`} />
          ))}
        </div>
        {/* Failures */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 mr-1">失败</span>
          {[0, 1, 2].map(i => (
            <div key={`f${i}`} className={`w-4 h-4 rounded-full border-2 ${
              i < ds.failures
                ? 'bg-red-500 border-red-400'
                : 'bg-gray-700 border-gray-600'
            }`} />
          ))}
        </div>
      </div>

      {/* Status / Roll button */}
      {isDead ? (
        <div className="text-center text-red-400 text-sm font-medium py-1">
          角色已死亡
        </div>
      ) : isStable ? (
        <div className="text-center text-green-400 text-sm font-medium py-1">
          已稳定 — 无需继续豁免
        </div>
      ) : (
        <button
          onClick={rollDeathSave}
          disabled={rolling}
          className="w-full py-1.5 rounded-lg text-sm font-medium transition-colors
            bg-red-900/50 hover:bg-red-800/60 text-red-200 border border-red-700/50
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {rolling ? '投掷中...' : '掷死亡豁免'}
        </button>
      )}
    </div>
  );
}
