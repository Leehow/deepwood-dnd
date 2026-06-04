import React, { useEffect, useMemo, useState, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { getApiEndpoint } from '../../config/api';
import { Badge, Button } from '@radix-ui/themes';
import { createLogger } from '~/utils/logger';
import { getAssetUrl } from '~/utils/asset-url';

const logger = createLogger('ShopTransactionModal_v2');

/** 
 * 视觉常量 & 辅助函数 
 */
const SLOT_SIZE = 64; // px
const RARITY_COLORS: Record<string, string> = {
  common: 'border-gray-500/30 bg-gray-500/5',
  uncommon: 'border-green-500/40 bg-green-500/10',
  rare: 'border-blue-500/50 bg-blue-500/15',
  very_rare: 'border-purple-500/60 bg-purple-500/20',
  legendary: 'border-orange-500/70 bg-orange-500/25',
  artifact: 'border-amber-500 bg-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.3)]',
};

// 货币换算
const formatCurrency = (totalGp: number) => {
  const gp = Math.floor(totalGp);
  const remainingGp = totalGp - gp;
  const sp = Math.floor(remainingGp * 10);
  const cp = Math.round((remainingGp * 10 - sp) * 10);
  
  const parts = [];
  if (gp > 0) parts.push(`${gp}GP`);
  if (sp > 0) parts.push(`${sp}SP`);
  if (cp > 0) parts.push(`${cp}CP`);
  return parts.length > 0 ? parts.join(' ') : '0GP';
};

/**
 * 接口定义
 */
interface InventoryItem { 
  id: number; 
  item_id: number; 
  quantity: number; 
  price_gp: number; 
}

interface ItemResp {
  id: number;
  name: string;
  name_cn?: string;
  category?: string;
  weight?: number;
  cost?: any;
  avatar_url?: string | null;
  rarity?: string;
}

interface CharacterEquipmentItem { 
  db_item_id?: number; 
  item_id?: string; 
  name?: string; 
  quantity?: number; 
  equippedSlot?: string; 
}

interface DealItem {
  id: number;      // inventory id or character item unique key
  itemId: number;  // db item id
  quantity: number;
  price: number;
  isFromShop: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  shop: { id: number; name: string; discount_rate: number; accepts_selling?: boolean } | null;
  characterId: string;
  campaignId?: string;
}

export const ShopTransactionModal_v2: React.FC<Props> = ({ open, onOpenChange, shop, characterId, campaignId }) => {
  // --- 状态管理 ---
  const [activeTab, setActiveTab] = useState<'shop' | 'backpack' | 'deal'>('shop');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [playerItems, setPlayerItems] = useState<CharacterEquipmentItem[]>([]);
  const [itemDetails, setItemDetails] = useState<Record<number, ItemResp>>({});
  const [wallet, setWallet] = useState<any>({ gp: 0, sp: 0, cp: 0 });
  const [characterData, setCharacterData] = useState<any>(null);
  
  // 交易缓冲区 (Barter Cart)
  const [toGet, setToGet] = useState<Record<number, number>>({}); // shopInventoryId -> qty
  const [toGive, setToGive] = useState<Record<string, number>>({}); // playerItemKey -> qty
  
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  // --- 拖拽相关 (Pointer Events) ---
  const [dragItem, setDragItem] = useState<{ id: string | number; type: 'shop' | 'player'; data: any } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // --- 数据加载 ---
  useEffect(() => {
    if (!open || !shop || !characterId) return;
    const loadAll = async () => {
      try {
        setBusy(true);
        // 并行加载商店库存和角色数据
        const [invResp, charResp] = await Promise.all([
          fetch(getApiEndpoint(`/api/shops/${shop.id}/inventory`)),
          fetch(getApiEndpoint(`/api/characters/${characterId}`))
        ]);
        
        const inv = await invResp.json();
        const char = await charResp.json();
        
        setInventory(inv);
        setCharacterData(char);
        setPlayerItems(Array.isArray(char.equipment) ? char.equipment : []);
        setWallet(char.currency || { gp: 0, sp: 0, cp: 0 });
        
        // 增量加载物品详情 (如果有缺失)
        const missingIds = new Set<number>();
        inv.forEach((it: any) => missingIds.add(it.item_id));
        (Array.isArray(char.equipment) ? char.equipment : []).forEach((e: any) => {
          const id = e.db_item_id || e.item_id;
          if (id) missingIds.add(Number(id));
        });
        
        for (const id of missingIds) {
          if (!itemDetails[id]) {
            fetch(getApiEndpoint(`/api/items/${id}`)).then(r => r.json()).then(detail => {
              setItemDetails(prev => ({ ...prev, [id]: detail }));
            }).catch(() => {});
          }
        }
      } catch (e) {
        setErrMsg('数据加载失败');
      } finally {
        setBusy(false);
      }
    };
    loadAll();
  }, [open, shop?.id, characterId]);

  // --- 计算逻辑 ---
  const charismaModifier = useMemo(() => {
    if (!characterData?.ability_scores?.charisma) return 0;
    return Math.floor((characterData.ability_scores.charisma - 10) / 2);
  }, [characterData]);

  const finalDiscountRate = useMemo(() => {
    const baseRate = shop?.discount_rate || 0.5;
    // 每点魅力调整值提供 2% 的议价优势 (仅限出售)
    return Math.min(0.95, baseRate + (charismaModifier * 0.02));
  }, [shop?.discount_rate, charismaModifier]);

  const dealSummary = useMemo(() => {
    let cost = 0;
    let gainValue = 0;
    let weightChange = 0;

    // 计算要买的
    Object.entries(toGet).forEach(([invId, qty]) => {
      const inv = inventory.find(i => i.id === Number(invId));
      if (inv) {
        cost += inv.price_gp * qty;
        const detail = itemDetails[inv.item_id];
        weightChange += (detail?.weight || 0) * qty;
      }
    });

    // 计算要卖的
    Object.entries(toGive).forEach(([key, qty]) => {
      const [dbId, idx] = key.split('_');
      const item = playerItems[Number(idx)];
      if (item) {
        const detail = itemDetails[Number(dbId)];
        const basePrice = detail?.cost?.amount || 0; // 简化处理，实际应调用 getBasePriceGp
        gainValue += (basePrice * finalDiscountRate) * qty;
        weightChange -= (detail?.weight || 0) * qty;
      }
    });

    const balance = cost - gainValue;
    return { balance, weightChange, canAfford: true /* 实际需计算钱包总额 */ };
  }, [toGet, toGive, inventory, playerItems, itemDetails, finalDiscountRate]);

  // --- 交互动作 ---
  const handleItemClick = (id: number | string, type: 'shop' | 'player') => {
    if (type === 'shop') {
      const invId = Number(id);
      const inv = inventory.find(i => i.id === invId);
      if (!inv || inv.quantity <= 0) return;
      setToGet(prev => ({ ...prev, [invId]: Math.min((prev[invId] || 0) + 1, inv.quantity) }));
    } else {
      const [dbId, idx] = String(id).split('_');
      const item = playerItems[Number(idx)];
      if (!item || (item as any).equippedSlot) return;
      setToGive(prev => ({ ...prev, [id]: Math.min((prev[id] || 0) + 1, (item as any).quantity || 1) }));
    }
    // 自动切换到交易 Tab (移动端友好)
    if (window.innerWidth < 768) setActiveTab('deal');
  };

  const handlePointerDown = (e: React.PointerEvent, id: string | number, type: 'shop' | 'player', data: any) => {
    // 简单的拖拽启动逻辑
    setDragItem({ id, type, data });
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragItem) {
      setMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragItem) {
      // 检查是否丢在“交易区”
      // 这里可以做简单的坐标碰撞检测，或者依赖点击逻辑
      handleItemClick(dragItem.id, dragItem.type);
      setDragItem(null);
    }
  };

  // --- 渲染组件: 物品格 ---
  const ItemSlot = ({ id, itemId, quantity, type, isSelected }: any) => {
    const detail = itemDetails[itemId];
    const rarity = detail?.rarity || 'common';
    const iconUrl = detail?.avatar_url ? (detail.avatar_url.startsWith('http') ? detail.avatar_url : getAssetUrl(detail.avatar_url)) : null;
    
    return (
      <div 
        className={`relative w-[64px] h-[64px] border rounded-md flex items-center justify-center cursor-pointer transition-all active:scale-95 touch-none ${RARITY_COLORS[rarity]} ${isSelected ? 'ring-2 ring-fantasy-gold' : ''}`}
        onPointerDown={(e) => handlePointerDown(e, id, type, detail)}
        onClick={() => handleItemClick(id, type)}
      >
        {iconUrl ? (
          <img src={iconUrl} alt={detail?.name} className="w-[52px] h-[52px] object-contain" />
        ) : (
          <div className="text-[10px] text-gray-500 text-center px-1 break-all line-clamp-2">
            {detail?.name_cn || detail?.name || '...'}
          </div>
        )}
        {quantity > 1 && (
          <span className="absolute bottom-0.5 right-1 text-[10px] font-bold text-white bg-black/60 px-1 rounded">
            {quantity}
          </span>
        )}
      </div>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-50" />
        <Dialog.Content 
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-5xl bg-[#f4e4bc] text-[#3d2b1f] border-4 border-[#3d2b1f] rounded-sm shadow-2xl z-50 flex flex-col max-h-[90dvh] overflow-hidden font-serif"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Header: Parchment Style */}
          <div className="p-4 border-b-2 border-[#3d2b1f]/20 flex items-center justify-between bg-[#e9d9b0]">
            <div>
              <Dialog.Title className="text-2xl font-fantasy tracking-wider uppercase m-0">
                {shop?.name || '商店'}
              </Dialog.Title>
              <div className="text-xs italic opacity-70">
                魅力加成: {charismaModifier >= 0 ? '+' : ''}{charismaModifier} (议价 +{Math.round(charismaModifier * 2)}%)
              </div>
            </div>
            <Dialog.Close className="p-2 hover:bg-black/5 rounded-full transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            {/* Desktop: 三栏布局 | Mobile: Tab 切换 */}
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
              
              {/* Left: Shop Inventory */}
              <div className={`flex-1 flex flex-col p-4 border-r border-[#3d2b1f]/10 ${activeTab !== 'shop' && 'hidden md:flex'}`}>
                <h3 className="text-sm font-bold uppercase mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 bg-[#3d2b1f] rounded-full" /> 商店货架
                </h3>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 overflow-y-auto pr-2 custom-scrollbar">
                  {inventory.map(inv => (
                    <ItemSlot 
                      key={inv.id} 
                      id={inv.id} 
                      itemId={inv.item_id} 
                      quantity={inv.quantity} 
                      type="shop" 
                      isSelected={!!toGet[inv.id]} 
                    />
                  ))}
                </div>
              </div>

              {/* Middle: Trade Tray (Barter Area) */}
              <div className={`w-full md:w-80 flex flex-col p-4 bg-black/5 border-x border-[#3d2b1f]/20 ${activeTab !== 'deal' && 'hidden md:flex'}`}>
                <h3 className="text-sm font-bold uppercase mb-3 flex items-center gap-2 justify-center">
                  ⚖️ 交易桌面
                </h3>
                <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-1">
                  {/* gain */}
                  <div className="flex-1 bg-[#f4e4bc]/50 border border-dashed border-[#3d2b1f]/30 rounded p-2">
                    <div className="text-[10px] uppercase opacity-50 mb-2 font-bold">准备买入</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(toGet).map(([id, qty]) => {
                        const inv = inventory.find(i => i.id === Number(id));
                        return (
                          <div key={id} className="relative group" onClick={() => setToGet(prev => {
                            const next = { ...prev };
                            if (next[Number(id)] > 1) next[Number(id)]--; else delete next[Number(id)];
                            return next;
                          })}>
                            <ItemSlot itemId={inv?.item_id} quantity={qty} type="shop" />
                            <div className="absolute -top-1 -right-1 bg-red-800 text-white w-4 h-4 rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100">×</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* give */}
                  <div className="flex-1 bg-[#f4e4bc]/50 border border-dashed border-[#3d2b1f]/30 rounded p-2">
                    <div className="text-[10px] uppercase opacity-50 mb-2 font-bold">准备给付 (物物交换)</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(toGive).map(([key, qty]) => {
                        const [dbId] = key.split('_');
                        return (
                          <div key={key} className="relative group" onClick={() => setToGive(prev => {
                            const next = { ...prev };
                            if (next[key] > 1) next[key]--; else delete next[key];
                            return next;
                          })}>
                            <ItemSlot itemId={Number(dbId)} quantity={qty} type="player" />
                            <div className="absolute -top-1 -right-1 bg-red-800 text-white w-4 h-4 rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100">×</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Player Backpack */}
              <div className={`flex-1 flex flex-col p-4 border-l border-[#3d2b1f]/10 ${activeTab !== 'backpack' && 'hidden md:flex'}`}>
                <h3 className="text-sm font-bold uppercase mb-3 flex items-center gap-2 justify-end">
                  我的背包 <span className="w-2 h-2 bg-[#3d2b1f] rounded-full" />
                </h3>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 overflow-y-auto pr-2 custom-scrollbar">
                  {playerItems.map((item, idx) => (
                    <ItemSlot 
                      key={idx} 
                      id={`${item.db_item_id || item.item_id}_${idx}`} 
                      itemId={item.db_item_id || item.item_id} 
                      quantity={item.quantity || 1} 
                      type="player" 
                      isSelected={!!toGive[`${item.db_item_id || item.item_id}_${idx}`]}
                    />
                  ))}
                </div>
              </div>

            </div>
          </div>

          {/* Footer: Balance & Actions */}
          <div className="p-4 bg-[#3d2b1f] text-[#f4e4bc] flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase opacity-60">我的资产</span>
                <span className="text-sm font-bold text-fantasy-gold">
                  {formatCurrency(wallet.gp + (wallet.sp/10) + (wallet.cp/100))}
                </span>
              </div>
              <div className="w-px h-8 bg-white/20 hidden md:block" />
              <div className="flex flex-col items-center md:items-start">
                <span className="text-[10px] uppercase opacity-60">交易差额</span>
                <span className={`text-lg font-fantasy ${dealSummary.balance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {dealSummary.balance > 0 ? `支付 ${formatCurrency(dealSummary.balance)}` : `找回 ${formatCurrency(Math.abs(dealSummary.balance))}`}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              {/* Mobile Tabs */}
              <div className="flex md:hidden flex-1 bg-white/10 rounded p-1">
                <button onClick={() => setActiveTab('shop')} className={`flex-1 text-xs py-2 rounded ${activeTab === 'shop' ? 'bg-[#f4e4bc] text-[#3d2b1f]' : ''}`}>货架</button>
                <button onClick={() => setActiveTab('deal')} className={`flex-1 text-xs py-2 rounded ${activeTab === 'deal' ? 'bg-[#f4e4bc] text-[#3d2b1f]' : 'px-1'}`}>交易({Object.keys(toGet).length + Object.keys(toGive).length})</button>
                <button onClick={() => setActiveTab('backpack')} className={`flex-1 text-xs py-2 rounded ${activeTab === 'backpack' ? 'bg-[#f4e4bc] text-[#3d2b1f]' : ''}`}>背包</button>
              </div>
              
              <button 
                className="px-8 py-3 bg-fantasy-gold text-[#3d2b1f] font-bold uppercase tracking-widest rounded shadow-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:grayscale"
                disabled={busy || (Object.keys(toGet).length === 0 && Object.keys(toGive).length === 0)}
              >
                {busy ? '进行中...' : '达成交易'}
              </button>
            </div>
          </div>

          {/* Drag Overlay (Lightweight) */}
          {dragItem && (
            <div 
              className="fixed pointer-events-none z-[100] scale-110 opacity-80"
              style={{ left: mousePos.x - 32, top: mousePos.y - 32 }}
            >
              <ItemSlot itemId={dragItem.data?.id} />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
