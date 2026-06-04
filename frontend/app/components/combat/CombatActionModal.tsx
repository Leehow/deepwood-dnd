import { useEffect, useMemo, useState } from "react";
import { subscribeAppEvent } from "~/events/appEventBus";
import type { Token } from "../map/types/TacticalMapTypes";

interface CombatActionModalProps {
  tokens: Token[];
  isDM: boolean;
  campaignId: string;
  userId?: string;
}

interface CombatStateLite {
  status: "setup" | "in_progress" | "ended";
  participants: { token_id: number; faction: 1 | 2; name: string }[];
  order: number[];
  current_index: number;
}

export function CombatActionModal({ tokens, isDM, campaignId, userId }: CombatActionModalProps) {
  const [open, setOpen] = useState(false);
  const [tokenId, setTokenId] = useState<number | null>(null);
  const [combat, setCombat] = useState<CombatStateLite | null>(null);

  const token = useMemo(() => tokens.find((t) => t.id === tokenId) || null, [tokens, tokenId]);

  // Subscribe to events
  useEffect(() => {
    const onOpen = ({ tokenId: tid }: { tokenId?: number }) => {
      if (typeof tid === "number") {
        setTokenId(tid);
        setOpen(true);
      }
    };
    const onUpdate = (obj: any) => {
      if (obj?.object_type === "combat" && obj?.object_id === "current") {
        setCombat(obj.data as CombatStateLite);
      }
    };
    const onDelete = (obj: any) => {
      // Message format: { type: "storage_deleted", data: { object_type: "combat" } }
      if (!obj || obj.data?.object_type === "combat" || (obj.object_type === "combat" && obj.object_id === "current")) {
        setCombat(null);
      }
    };

    const unsubscribeOpen = subscribeAppEvent("openCombatActionModal", onOpen as any);
    const unsubscribeStorageUpdated = subscribeAppEvent("combatStorageUpdated", onUpdate as any);
    const unsubscribeStorageDeleted = subscribeAppEvent("combatStorageDeleted", onDelete as any);
    return () => {
      unsubscribeOpen();
      unsubscribeStorageUpdated();
      unsubscribeStorageDeleted();
    };
  }, []);

  const inCombat = combat?.status === "in_progress";

  if (!open || !token) return null;

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/60">
      <div className="w-[min(92vw,680px)] rounded-lg border border-amber-500/40 bg-gray-900 shadow-xl text-gray-100">
        <div className="flex items-center justify-between border-b border-amber-500/30 px-4 py-3">
          <div className="text-amber-300 font-semibold">{token.instance_name || token.character_name || token.monster_name || "未命名"}</div>
          <button className="text-gray-400 hover:text-gray-200" onClick={() => setOpen(false)}>
            关闭
          </button>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Stats (skeleton) */}
          <div className="col-span-1 space-y-2">
            <div className="text-sm text-gray-400">战斗信息（占位）</div>
            <div className="rounded border border-gray-700 p-2 text-xs space-y-1">
              <div>HP: {token.current_hp ?? "?"}</div>
              <div>AC: ?</div>
              <div>速度: ?</div>
              <div>熟练: ?</div>
            </div>
          </div>

          {/* Actions */}
          <div className="col-span-2 space-y-3">
            <div className="flex items-center gap-2">
              <button className="px-3 py-1 rounded border border-gray-700 bg-gray-800/70 text-sm" disabled={!inCombat}>动作</button>
              <button className="px-3 py-1 rounded border border-gray-700 bg-gray-800/70 text-sm" disabled={!inCombat}>附赠动作</button>
              {!inCombat && <span className="text-xs text-gray-500">（非战斗中，仅展示占位）</span>}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <button className="px-2 py-1 rounded border border-gray-700 bg-gray-800/40" disabled>攻击</button>
              <button className="px-2 py-1 rounded border border-gray-700 bg-gray-800/40" disabled>施法</button>
              <button className="px-2 py-1 rounded border border-gray-700 bg-gray-800/40" disabled>冲刺</button>
              <button className="px-2 py-1 rounded border border-gray-700 bg-gray-800/40" disabled>脱离</button>
              <button className="px-2 py-1 rounded border border-gray-700 bg-gray-800/40" disabled>闪避</button>
              <button className="px-2 py-1 rounded border border-gray-700 bg-gray-800/40" disabled>躲藏</button>
              <button className="px-2 py-1 rounded border border-gray-700 bg-gray-800/40" disabled>准备</button>
              <button className="px-2 py-1 rounded border border-gray-700 bg-gray-800/40" disabled>搜寻</button>
              <button className="px-2 py-1 rounded border border-gray-700 bg-gray-800/40" disabled>使用物品</button>
              <button className="px-2 py-1 rounded border border-gray-700 bg-gray-800/40" disabled>即兴动作</button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-amber-500/30 px-4 py-3">
          <button
            className="px-3 py-1 text-sm rounded bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30"
            onClick={() => setOpen(false)}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
