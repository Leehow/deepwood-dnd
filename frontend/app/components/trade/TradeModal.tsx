import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTradeStore, type TradeItem, type Currency, emptyCurrency } from '~/stores/tradeStore';

interface TradeModalProps {
  /** The full equipment array of the local player's character */
  myEquipment: any[];
  /** The local player's currency */
  myCurrency: Currency;
  /** Send a WebSocket message */
  sendMessage: (msg: any) => void;
}

const DENOMS: { key: keyof Currency; label: string }[] = [
  { key: 'pp', label: 'PP' },
  { key: 'gp', label: 'GP' },
  { key: 'ep', label: 'EP' },
  { key: 'sp', label: 'SP' },
  { key: 'cp', label: 'CP' },
];

export function TradeModal({ myEquipment, myCurrency, sendMessage }: TradeModalProps) {
  const { activeTrade, updateMyOffer, setMyLocked, reset } = useTradeStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Local editing state for my offer (before debounced send)
  const [localItems, setLocalItems] = useState<TradeItem[]>([]);
  const [localCurrency, setLocalCurrency] = useState<Currency>(emptyCurrency());

  // Reset local state when trade starts
  useEffect(() => {
    if (activeTrade?.status === 'active') {
      setLocalItems(activeTrade.myOffer.items);
      setLocalCurrency(activeTrade.myOffer.currency);
    }
  }, [activeTrade?.tradeId, activeTrade?.status]);

  // Available items: unequipped backpack items
  const availableItems = useMemo(() => {
    if (!myEquipment) return [];
    return myEquipment.filter((e: any) => typeof e === 'object' && e && !e.equippedSlot);
  }, [myEquipment]);

  // Send trade_update debounced
  const sendUpdate = useCallback((items: TradeItem[], currency: Currency) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!activeTrade) return;
      const offer = { items, currency };
      updateMyOffer(offer);
      sendMessage({
        type: 'trade_update',
        data: { trade_id: activeTrade.tradeId, offer },
      });
    }, 300);
  }, [activeTrade, updateMyOffer, sendMessage]);

  const handleAddItem = (equipItem: any) => {
    if (activeTrade?.myLocked) return;
    const existing = localItems.find(i => itemKey(i) === itemKey(equipItem));
    const maxQty = int(equipItem.quantity, 1);
    let next: TradeItem[];
    if (existing) {
      if (int(existing.quantity, 1) >= maxQty) return;
      next = localItems.map(i =>
        itemKey(i) === itemKey(equipItem) ? { ...i, quantity: int(i.quantity, 1) + 1 } : i
      );
    } else {
      next = [...localItems, { ...equipItem, quantity: 1 } as TradeItem];
    }
    setLocalItems(next);
    sendUpdate(next, localCurrency);
  };

  const handleRemoveItem = (item: TradeItem) => {
    if (activeTrade?.myLocked) return;
    const qty = int(item.quantity, 1);
    let next: TradeItem[];
    if (qty <= 1) {
      next = localItems.filter(i => itemKey(i) !== itemKey(item));
    } else {
      next = localItems.map(i =>
        itemKey(i) === itemKey(item) ? { ...i, quantity: qty - 1 } : i
      );
    }
    setLocalItems(next);
    sendUpdate(next, localCurrency);
  };

  const handleCurrencyChange = (denom: keyof Currency, value: number) => {
    if (activeTrade?.myLocked) return;
    const max = int(myCurrency[denom], 0);
    const clamped = Math.max(0, Math.min(value, max));
    const next = { ...localCurrency, [denom]: clamped };
    setLocalCurrency(next);
    sendUpdate(localItems, next);
  };

  const handleLock = () => {
    if (!activeTrade) return;
    sendMessage({ type: 'trade_lock', data: { trade_id: activeTrade.tradeId } });
    setMyLocked(true);
  };

  const handleUnlock = () => {
    if (!activeTrade) return;
    sendMessage({ type: 'trade_unlock', data: { trade_id: activeTrade.tradeId } });
    setMyLocked(false);
  };

  const handleCancel = () => {
    if (!activeTrade) return;
    sendMessage({ type: 'trade_cancel', data: { trade_id: activeTrade.tradeId } });
    reset();
  };

  const isOpen = activeTrade?.status === 'active';
  if (!isOpen || !activeTrade) return null;

  const myLocked = activeTrade.myLocked;
  const partnerLocked = activeTrade.partnerLocked;
  const bothLocked = myLocked && partnerLocked;

  // Remaining qty for each available item (total - offered)
  const offeredQtyMap = new Map<string, number>();
  localItems.forEach(i => offeredQtyMap.set(itemKey(i), int(i.quantity, 1)));

  return (
    <Dialog.Root open={true} onOpenChange={(open) => { if (!open) handleCancel(); }} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-2xl bg-gray-900 border border-gray-700 rounded-lg shadow-2xl z-50 flex flex-col max-h-[85vh]"
          aria-describedby={undefined}
        >
          <Dialog.Title className="px-4 py-3 border-b border-gray-700 text-base font-semibold text-gray-200 flex items-center gap-2 shrink-0">
            <span>🤝</span>
            <span>与 <span className="text-amber-400">{activeTrade.partnerCharacterName}</span> 交易</span>
            {bothLocked && <span className="ml-auto text-xs text-green-400 animate-pulse">交易执行中...</span>}
          </Dialog.Title>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-2 gap-4">
              {/* ── Left: My Offer ────────────────────── */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                  我的报价
                  {myLocked && <span className="text-xs text-amber-400">🔒 已锁定</span>}
                </h3>

                {/* Item picker */}
                {!myLocked && (
                  <div className="max-h-32 overflow-y-auto border border-gray-700 rounded p-1.5 space-y-0.5">
                    {availableItems.length === 0 ? (
                      <p className="text-xs text-gray-500 p-1">背包中没有可交易的物品</p>
                    ) : (
                      availableItems.map((eq: any, i: number) => {
                        const offered = offeredQtyMap.get(itemKey(eq)) || 0;
                        const remaining = int(eq.quantity, 1) - offered;
                        return (
                          <button
                            key={`${itemKey(eq)}-${i}`}
                            disabled={remaining <= 0}
                            onClick={() => handleAddItem(eq)}
                            className={`w-full text-left px-2 py-1 rounded text-xs flex justify-between items-center ${
                              remaining <= 0 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-800 cursor-pointer'
                            }`}
                          >
                            <span className="text-gray-300 truncate">{eq.name_cn || eq.name}</span>
                            <span className="text-gray-500 ml-1 shrink-0">x{remaining}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Offered items list */}
                <div className="space-y-1 min-h-[40px]">
                  {localItems.length === 0 ? (
                    <p className="text-xs text-gray-600 italic">未选择物品</p>
                  ) : (
                    localItems.map((item) => (
                      <div key={itemKey(item)} className="flex items-center justify-between bg-gray-800 rounded px-2 py-1">
                        <span className="text-xs text-gray-200 truncate">{item.name_cn || item.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-xs text-gray-400">x{item.quantity}</span>
                          {!myLocked && (
                            <button onClick={() => handleRemoveItem(item)} className="text-red-400 hover:text-red-300 text-xs ml-1">✕</button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Currency inputs */}
                <div className="space-y-1">
                  {DENOMS.map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-6">{label}</span>
                      <input
                        type="number"
                        min={0}
                        max={int(myCurrency[key], 0)}
                        value={localCurrency[key] || ''}
                        onChange={(e) => handleCurrencyChange(key, parseInt(e.target.value) || 0)}
                        disabled={myLocked}
                        className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 disabled:opacity-50"
                        placeholder="0"
                      />
                      <span className="text-xs text-gray-600">/ {int(myCurrency[key], 0)}</span>
                    </div>
                  ))}
                </div>

                {/* Lock/unlock */}
                <button
                  onClick={myLocked ? handleUnlock : handleLock}
                  disabled={bothLocked}
                  className={`w-full py-1.5 rounded text-sm font-medium transition-colors ${
                    myLocked
                      ? 'bg-amber-700 hover:bg-amber-600 text-white'
                      : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                  } disabled:opacity-50`}
                >
                  {myLocked ? '🔓 解锁' : '🔒 锁定报价'}
                </button>
              </div>

              {/* ── Right: Partner Offer (read-only) ───── */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                  对方报价
                  {partnerLocked && <span className="text-xs text-green-400">🔒 已锁定</span>}
                  {!partnerLocked && <span className="text-xs text-gray-500">🔓 编辑中</span>}
                </h3>

                {/* Partner items */}
                <div className="space-y-1 min-h-[80px] border border-gray-700/50 rounded p-2">
                  {activeTrade.partnerOffer.items.length === 0 ? (
                    <p className="text-xs text-gray-600 italic">对方未选择物品</p>
                  ) : (
                    activeTrade.partnerOffer.items.map((item) => (
                      <div key={itemKey(item)} className="flex items-center justify-between bg-gray-800/50 rounded px-2 py-1">
                        <span className="text-xs text-gray-200 truncate">{item.name_cn || item.name}</span>
                        <span className="text-xs text-gray-400 shrink-0">x{item.quantity}</span>
                      </div>
                    ))
                  )}
                </div>

                {/* Partner currency */}
                <div className="space-y-1">
                  {DENOMS.map(({ key, label }) => {
                    const val = activeTrade.partnerOffer.currency[key] || 0;
                    if (val === 0) return null;
                    return (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400 w-6">{label}</span>
                        <span className="text-amber-300">{val}</span>
                      </div>
                    );
                  })}
                  {Object.values(activeTrade.partnerOffer.currency).every(v => !v) && (
                    <p className="text-xs text-gray-600 italic">对方未提供金钱</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-700 flex justify-center shrink-0">
            <button
              onClick={handleCancel}
              className="px-6 py-1.5 bg-red-900/50 hover:bg-red-800/60 text-red-300 text-sm rounded transition-colors"
            >
              取消交易
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Helpers
function itemKey(item: any): string {
  return String(item.libraryItemId || item.id || item.name);
}

function int(val: any, fallback: number): number {
  const n = parseInt(val);
  return isNaN(n) ? fallback : n;
}
