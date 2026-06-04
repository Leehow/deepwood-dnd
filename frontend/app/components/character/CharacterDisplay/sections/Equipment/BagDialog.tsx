import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { findAnyMetaByKey, findWeaponMetaByKey, findArmorMetaByKey, getIconPath } from "../../utils/rules";
import { getCharacterWeaponArmorProfs } from "../../utils/proficiency";
import { tProficiency } from "~/utils/i18n/dictionary";
import { tCategory, tRarity } from "~/config/item-i18n";
import { useCharacterContext } from "../../context/CharacterContext";
import { PaperDollSection } from "./PaperDollSection";
import { InventoryGrid } from "./InventoryGrid";
import { ItemInfoModal } from "./ItemInfoModal";
import { ItemContextMenu } from "./ItemContextMenu";
import { PaperWriteModal } from "./PaperWriteModal";
import { PaperReadModal } from "./PaperReadModal";
import type { Currency, EquipmentItem, EquipSlot } from "../../types/Character";
import { useModalContextStore } from "~/stores/modalContextStore";
import { buildCharacterSummary } from "~/utils/buildCharacterSummary";
import { isClickInsideFloatingChat } from "~/utils/floatingChatGuard";
import { AddItemModal } from "~/components/campaign/AddItemModal";
import { AddCustomItemModal } from "~/components/campaign/AddCustomItemModal";
import { GroundItemsSection } from "./GroundItemsSection";
import { publishAppEvent } from "~/events/appEventBus";
import { convertTokenItemToEquipment, getEquipmentStackIdentity } from "~/utils/itemTokenData";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  setCurrencyDialogOpen: (v: boolean) => void;
  currencyLocal: Currency;
  equipmentLocal: EquipmentItem[];
  onEquipmentUpdate?: (items: EquipmentItem[], currency: Currency) => void;
  openEquip?: (slot: EquipSlot) => void;
  getEquipped?: (slot: EquipSlot) => EquipmentItem | null;
  applyEquip?: (item: EquipmentItem, slot: EquipSlot) => void;
  isContainer?: (itemId: string) => boolean;
  getContainerContents?: (containerId: string) => EquipmentItem[];
  handlePutInContainer?: (item: EquipmentItem, containerId: string) => Promise<void>;
  handlePutMultipleInContainer?: (items: EquipmentItem[], containerId: string) => Promise<void>;
  handleTakeOutOfContainer?: (item: EquipmentItem) => Promise<void>;
  handleStackItems?: (sourceItem: EquipmentItem, targetItem: EquipmentItem) => Promise<void>;
  handleSplitStack?: (item: EquipmentItem, quantity: number) => Promise<void>;
  handleMergeStacks?: (item: EquipmentItem) => Promise<void>;
  handleDiscardItem?: (item: EquipmentItem, quantity: number) => Promise<void>;
  handleBatchTakeOut?: (items: EquipmentItem[]) => Promise<void>;
  handleBatchDiscard?: (items: EquipmentItem[]) => Promise<void>;
  handleBatchMerge?: (items: EquipmentItem[]) => Promise<void>;
  onCurrencyDropToMap?: (type: keyof Currency, amount: number) => Promise<void>;
  onUseConsumable?: (item: EquipmentItem) => Promise<void>;
  hasTokenOnMap?: boolean;
  onToggleGrip?: () => void;
  onRegenerateAvatar?: () => void;
  avatarRegenerating?: boolean;
  // Paper writing system
  isPaperItem?: (item: EquipmentItem) => boolean;
  onWriteOnPaper?: (item: EquipmentItem, content: string) => Promise<void>;
  onEditWrittenPaper?: (item: EquipmentItem, content: string) => Promise<void>;
  onCopyPaper?: (item: EquipmentItem) => Promise<void>;
  /** 嵌入浮动面板模式：去掉 Dialog 包裹，直接渲染内容 */
  embedded?: boolean;
  /** DM可添加物品（搜索预设+自定义） */
  isDMAddItem?: boolean;
}

export function BagDialog({
  open, onOpenChange, setCurrencyDialogOpen, currencyLocal, equipmentLocal,
  onEquipmentUpdate, openEquip, getEquipped, applyEquip,
  isContainer, getContainerContents: getContainerContentsProp, handlePutInContainer, handlePutMultipleInContainer, handleTakeOutOfContainer,
  handleStackItems, handleSplitStack, handleMergeStacks, handleDiscardItem,
  handleBatchTakeOut, handleBatchDiscard, handleBatchMerge,
  onCurrencyDropToMap, onUseConsumable, hasTokenOnMap, onToggleGrip,
  onRegenerateAvatar, avatarRegenerating,
  isPaperItem, onWriteOnPaper, onEditWrittenPaper, onCopyPaper,
  embedded, isDMAddItem
}: Props) {
  const { isDM, character, showToast, campaignId, currentMapUrl } = useCharacterContext();

  const handlePublishDocument = useCallback(async (item: EquipmentItem) => {
    if (!isDM || !item.writtenContent || !campaignId) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8174'}/api/items/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          name: item.name,
          name_cn: item.name,
          category: 'document',
          description: item.writtenContent,
          description_cn: item.writtenContent,
          quantity: 1,
          is_custom: true,
          avatar_url: item.avatar_url || item.iconPath || null,
        }),
      });
      if (!response.ok) throw new Error('Failed to publish');
      showToast?.(`已发布「${item.name}」到资源库`, 'success');
    } catch (e) {
      console.error('Publish document error:', e);
      showToast?.('发布失败', 'error');
    }
  }, [isDM, campaignId, showToast]);

  // DM direct delete: remove entire item without quantity confirmation
  const handleDirectDelete = useCallback(async (item: EquipmentItem) => {
    if (!onEquipmentUpdate) return;
    const next = (equipmentLocal || []).filter(it => it !== item);
    onEquipmentUpdate(next, currencyLocal);
  }, [equipmentLocal, currencyLocal, onEquipmentUpdate]);

  // Register modal context for AI chat awareness
  const setModalContext = useModalContextStore(s => s.setModalContext);
  const clearModalContext = useModalContextStore(s => s.clearModalContext);
  useEffect(() => {
    if (open) {
      const charSummary = buildCharacterSummary(character);
      const gold = currencyLocal ? `金币：${currencyLocal.gp || 0}gp ${currencyLocal.sp || 0}sp ${currencyLocal.cp || 0}cp` : '';
      setModalContext('inventory', `正在查看背包。${gold}。${charSummary}`);
    } else {
      clearModalContext('inventory');
    }
  }, [open, character, currencyLocal, setModalContext, clearModalContext]);
  const [normalizing, setNormalizing] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showCustomAddForm, setShowCustomAddForm] = useState(false);
  const [showCustomItemPicker, setShowCustomItemPicker] = useState(false);
  const [customItemsList, setCustomItemsList] = useState<any[]>([]);
  const [loadingCustomItems, setLoadingCustomItems] = useState(false);
  const [draggedItem, setDraggedItem] = useState<EquipmentItem | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [mouseEquipHoverSlot, setMouseEquipHoverSlot] = useState<EquipSlot | null>(null);
  const [discardCurrency, setDiscardCurrency] = useState<{ type: keyof Currency; amount: number } | null>(null);
  const [showCurrencyHelp, setShowCurrencyHelp] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedItemKeys, setSelectedItemKeys] = useState<Set<string>>(new Set());
  const [infoItem, setInfoItem] = useState<EquipmentItem | null>(null);
  // Track which equipped slot was clicked (for showing item detail with unequip/switch actions)
  const [equippedSlotInfo, setEquippedSlotInfo] = useState<{ slot: EquipSlot; item: EquipmentItem } | null>(null);
  const [dragOverOverlay, setDragOverOverlay] = useState(false);
  // Drop-to-map quantity selector for stacked items (embedded mode)
  const [dropToMapItem, setDropToMapItem] = useState<EquipmentItem | null>(null);
  const [dropToMapQty, setDropToMapQty] = useState(1);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: EquipmentItem } | null>(null);
  const [pressedItem, setPressedItem] = useState<string | null>(null);
  const [avatarZoom, setAvatarZoom] = useState(false);
  const [showToolbarHelp, setShowToolbarHelp] = useState(false);
  const [paperWriteTarget, setPaperWriteTarget] = useState<EquipmentItem | null>(null);
  const [paperReadTarget, setPaperReadTarget] = useState<EquipmentItem | null>(null);
  const [paperEditMode, setPaperEditMode] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载已有自定义物品
  const API_BASE = import.meta.env.VITE_API_URL || '';
  const loadCustomItems = async () => {
    if (!campaignId) return;
    setLoadingCustomItems(true);
    try {
      const resp = await fetch(`${API_BASE}/api/items/campaign/${campaignId}?is_custom=true`);
      if (resp.ok) setCustomItemsList(await resp.json());
    } catch { /* ignore */ } finally { setLoadingCustomItems(false); }
  };

  const handleToggleCustomPicker = () => {
    if (!showCustomItemPicker) loadCustomItems();
    setShowCustomItemPicker(!showCustomItemPicker);
  };

  const handlePickCustomItem = (item: any) => {
    if (!onEquipmentUpdate) return;
    const newItem = convertBackendItemToEquipment(item);
    onEquipmentUpdate([...(equipmentLocal || []), newItem], currencyLocal);
    setShowCustomItemPicker(false);
  };

  /** 统一将后端 Item 记录转换成背包物品，复用 canonical item helper。 */
  const convertBackendItemToEquipment = (item: any): EquipmentItem =>
    convertTokenItemToEquipment(item, 1);

  // --- Helpers ---
  const stripQuantityFromName = (name: string) =>
    name.replace(/\s*[xX×]\s*\d+\s*支?$/i, '').replace(/\s*\(\d+支?\)\s*$/i, '').replace(/\s*（\d+支?）\s*$/i, '').replace(/\s+\d+支?$/i, '').trim();

  const getItemDisplayName = useCallback((item: EquipmentItem) => {
    let name = (item as any).name_cn || item.name;
    if (!name) {
      const meta = findAnyMetaByKey(item.id);
      name = (meta as any)?.name_cn || (meta as any)?.name || item.id;
    }
    return stripQuantityFromName(name);
  }, []);

  const getItemWeight = useCallback((item: EquipmentItem) => {
    const meta = findAnyMetaByKey(item.id) || (item.name ? findAnyMetaByKey(item.name) : null);
    return (meta as any)?.weight ?? item.weight ?? 0;
  }, []);

  const getItemKey = useCallback(
    (it: EquipmentItem) => `${getEquipmentStackIdentity(it)}-${it.containerId || 'root'}-${it.quantity || 1}`,
    [],
  );

  const checkIsContainer = useCallback((item: EquipmentItem): boolean => {
    return !!(isContainer?.(item.id) || isContainer?.(item.name || ''));
  }, [isContainer]);

  const getContainerContents = useCallback((containerId: string) => {
    return getContainerContentsProp?.(containerId) || [];
  }, [getContainerContentsProp]);

  // --- Weight & Value ---
  const proficiencies = useMemo(() => {
    if (!character) return null;
    const { weapon, armor } = getCharacterWeaponArmorProfs(character);
    return { weapon: [...weapon], armor: [...armor] };
  }, [character]);

  const { totalWeight, carryingCapacity } = useMemo(() => {
    let weight = 0;
    for (const item of equipmentLocal || []) {
      if (item.containerId) continue;
      if (checkIsContainer(item)) {
        const baseWeight = getItemWeight(item);
        const contents = getContainerContents(item.id);
        weight += baseWeight + contents.reduce((s, c) => s + getItemWeight(c) * (c.quantity || 1), 0);
      } else {
        weight += getItemWeight(item) * (item.quantity || 1);
      }
    }
    const str = character?.ability_scores?.strength ?? 10;
    return { totalWeight: Math.round(weight * 10) / 10, carryingCapacity: str * 15 };
  }, [equipmentLocal, character, checkIsContainer, getContainerContents, getItemWeight]);

  const totalGoldValue = useMemo(() => {
    const { cp = 0, sp = 0, ep = 0, gp = 0, pp = 0 } = currencyLocal || {};
    return Math.round((pp * 10 + gp + ep * 0.5 + sp * 0.1 + cp * 0.01) * 100) / 100;
  }, [currencyLocal]);

  // --- Stack/Container checks ---
  const canStack = useCallback((source: EquipmentItem | null, target: EquipmentItem) => {
    if (!source || source === target) return false;
    if (getEquipmentStackIdentity(source) !== getEquipmentStackIdentity(target)) return false;
    if (checkIsContainer(source) || checkIsContainer(target)) return false;
    return true;
  }, [checkIsContainer]);

  const isBookLikeContainer = useCallback((item: EquipmentItem) => {
    const name = item.name || '';
    const id = (item.id || '').toLowerCase();
    return name.includes('书') || id === 'book' || id.includes('spellbook') || id.includes('spell_book') || id.includes('tome');
  }, []);

  const canDropInContainer = useCallback((source: EquipmentItem | null, target: EquipmentItem) => {
    if (!source || source.id === target.id) return false;
    // Target must be a container
    if (!checkIsContainer(target)) return false;
    // Book containers only accept paper items
    if (isBookLikeContainer(target)) {
      return (source.name || '').includes('纸') || !!source.writtenContent;
    }
    // Non-book containers (bags) can accept anything including book containers,
    // but not other bag-type containers (prevent bag-in-bag nesting)
    if (checkIsContainer(source) && !isBookLikeContainer(source)) return false;
    return true;
  }, [checkIsContainer, isBookLikeContainer]);

  // --- Selection ---
  const getSelectedItems = useCallback(() => {
    return (equipmentLocal || []).filter(it => selectedItemKeys.has(getItemKey(it)));
  }, [equipmentLocal, selectedItemKeys, getItemKey]);

  const toggleItemSelection = useCallback((item: EquipmentItem) => {
    if (checkIsContainer(item)) return;
    const key = getItemKey(item);
    setSelectedItemKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, [checkIsContainer, getItemKey]);

  const clearSelection = useCallback(() => {
    setSelectedItemKeys(new Set());
    setMultiSelectMode(false);
  }, []);

  const toggleMultiSelect = useCallback(() => {
    setMultiSelectMode(prev => {
      if (prev) setSelectedItemKeys(new Set()); // exiting: clear
      return !prev;
    });
  }, []);

  const dropItemsToMapFromInventoryGesture = useCallback(async (item: EquipmentItem) => {
    if (!handleDiscardItem) return;
    if (!hasTokenOnMap) {
      showToast?.("角色未在地图上，无法拖到地面", "error");
      return;
    }

    const isBatch = multiSelectMode && selectedItemKeys.has(getItemKey(item)) && selectedItemKeys.size > 1;
    if (isBatch) {
      const selectedTopLevelItems = getSelectedItems().filter(entry => !entry.containerId);
      if (selectedTopLevelItems.length === 0) return;

      if (handleBatchDiscard) {
        await handleBatchDiscard(selectedTopLevelItems);
      } else {
        for (const selectedItem of selectedTopLevelItems) {
          await handleDiscardItem(selectedItem, selectedItem.quantity || 1);
        }
      }
      setSelectedItemKeys(new Set());
      return;
    }

    const qty = item.quantity || 1;
    if (qty <= 1) {
      await handleDiscardItem(item, 1);
      return;
    }

    setDropToMapQty(1);
    setDropToMapItem(item);
  }, [
    getItemKey,
    getSelectedItems,
    handleBatchDiscard,
    handleDiscardItem,
    hasTokenOnMap,
    multiSelectMode,
    selectedItemKeys,
    showToast,
  ]);

  // --- Click handler: single click = detail (normal) or select (multi-select) ---
  const handleItemClick = useCallback((e: React.MouseEvent, item: EquipmentItem) => {
    e.stopPropagation();
    if (multiSelectMode) {
      toggleItemSelection(item);
    } else if (item.writtenContent) {
      setPaperReadTarget(item);
    } else {
      setInfoItem(item);
    }
  }, [multiSelectMode, toggleItemSelection]);

  // --- Mouse-based drag (Edge/Chromium compatible, unified for hotbar + inventory) ---
  const mouseDragRef = useRef<{
    item: EquipmentItem;
    startX: number;
    startY: number;
    ghost: HTMLDivElement | null;
    active: boolean;
  } | null>(null);
  // Keep callbacks accessible from the document-level listener
  const mouseDragCallbacksRef = useRef({
    setDraggedItem, setDragOverTarget, setMouseEquipHoverSlot,
    canStack, canDropInContainer, checkIsContainer,
    handleStackItems, handlePutInContainer, handleTakeOutOfContainer,
    handlePutMultipleInContainer, handleBatchTakeOut,
    dropItemsToMapFromInventoryGesture,
    multiSelectMode, selectedItemKeys, getItemKey, getSelectedItems,
    applyEquip, setSelectedItemKeys, equipmentLocal,
    handleDiscardItem, setDropToMapItem, embedded,
  });
  mouseDragCallbacksRef.current = {
    setDraggedItem, setDragOverTarget, setMouseEquipHoverSlot,
    canStack, canDropInContainer, checkIsContainer,
    handleStackItems, handlePutInContainer, handleTakeOutOfContainer,
    handlePutMultipleInContainer, handleBatchTakeOut,
    dropItemsToMapFromInventoryGesture,
    multiSelectMode, selectedItemKeys, getItemKey, getSelectedItems,
    applyEquip, setSelectedItemKeys, equipmentLocal,
    handleDiscardItem, setDropToMapItem, embedded,
  };

  const handleItemMouseDown = useCallback((e: React.MouseEvent, item: EquipmentItem) => {
    if (e.button !== 0) return;
    mouseDragRef.current = { item, startX: e.clientX, startY: e.clientY, ghost: null, active: false };
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const state = mouseDragRef.current;
      if (!state) return;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (!state.active && (dx * dx + dy * dy) < 25) return;

      if (!state.active) {
        state.active = true;
        mouseDragCallbacksRef.current.setDraggedItem(state.item);
        const ghost = document.createElement('div');
        ghost.style.cssText = `
          position:fixed;z-index:99999;pointer-events:none;
          width:48px;height:48px;border-radius:8px;overflow:hidden;
          border:2px solid rgba(251,191,36,0.8);
          background:rgba(0,0,0,0.8);opacity:0.9;
          background-size:cover;background-position:center;
        `;
        const iconPath = getIconPath(state.item) || '';
        if (iconPath) ghost.style.backgroundImage = `url(${iconPath})`;
        document.body.appendChild(ghost);
        state.ghost = ghost;
      }

      if (state.ghost) {
        state.ghost.style.left = `${e.clientX - 24}px`;
        state.ghost.style.top = `${e.clientY - 24}px`;
      }

      // Highlight drop target under cursor
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const inventoryItem = el?.closest('[data-item-key]');
      if (inventoryItem) {
        mouseDragCallbacksRef.current.setDragOverTarget(inventoryItem.getAttribute('data-item-key') || null);
      } else {
        mouseDragCallbacksRef.current.setDragOverTarget(null);
      }
      // Equipment slot hover (PaperDoll) for cyan highlight
      const equipSlot = el?.closest('[data-equip-slot]');
      mouseDragCallbacksRef.current.setMouseEquipHoverSlot(
        (equipSlot ? equipSlot.getAttribute('data-equip-slot') : null) as EquipSlot | null
      );

      // Ghost "丢弃到地图" label when outside floating panel (embedded mode)
      if (state.ghost && mouseDragCallbacksRef.current.embedded) {
        const panel = el?.closest('.floating-char-panel-window');
        let label = state.ghost.querySelector('.drop-map-label') as HTMLElement | null;
        if (!panel) {
          if (!label) {
            label = document.createElement('div');
            label.className = 'drop-map-label';
            label.style.cssText = 'position:absolute;top:52px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:11px;color:#f87171;background:rgba(0,0,0,0.85);padding:2px 6px;border-radius:4px;border:1px solid rgba(248,113,113,0.5);';
            label.textContent = '丢弃到地图';
            state.ghost.appendChild(label);
          }
        } else if (label) {
          label.remove();
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      const state = mouseDragRef.current;
      if (!state) return;
      mouseDragRef.current = null;
      if (state.ghost) state.ghost.remove();
      const cb = mouseDragCallbacksRef.current;
      cb.setDraggedItem(null);
      cb.setDragOverTarget(null);
      cb.setMouseEquipHoverSlot(null);
      if (!state.active) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);

      // 1. Hotbar slot
      const hotbarSlot = el?.closest('[data-hotbar-slot]');
      if (hotbarSlot) {
        const slotIdx = parseInt(hotbarSlot.getAttribute('data-hotbar-slot') || '', 10);
        if (!isNaN(slotIdx)) {
          publishAppEvent('hotbarDropToSlot', {
            slotIdx, item: {
              type: 'item', id: state.item.id, name: state.item.name, icon: '◆',
              meta: { quantity: state.item.quantity, avatar_url: state.item.avatar_url || '', description: state.item.description || '' },
            },
          });
          return;
        }
      }
      // 2. Hotbar area (first empty slot)
      if (el?.closest('[data-hotbar]')) {
        publishAppEvent('hotbarAddItem', {
          type: 'item', id: state.item.id, name: state.item.name, icon: '◆',
          meta: { quantity: state.item.quantity, avatar_url: state.item.avatar_url || '', description: state.item.description || '' },
        });
        return;
      }

      // 3. Equipment slot (paper doll)
      const equipSlot = el?.closest('[data-equip-slot]');
      if (equipSlot && cb.applyEquip) {
        const slot = equipSlot.getAttribute('data-equip-slot') as EquipSlot;
        if (slot) {
          cb.applyEquip(state.item, slot);
          return;
        }
      }

      // 4. Inventory item (stack or put in container)
      const targetItemEl = el?.closest('[data-item-key]');
      if (targetItemEl) {
        const targetKey = targetItemEl.getAttribute('data-item-key') || '';
        const targetItem = cb.equipmentLocal.find(it =>
          cb.getItemKey(it) === targetKey
        );
        if (targetItem && targetItem !== state.item) {
          const isBatch = cb.multiSelectMode && cb.selectedItemKeys.has(cb.getItemKey(state.item)) && cb.selectedItemKeys.size > 1;
          if (isBatch && cb.checkIsContainer(targetItem)) {
            const selected = cb.getSelectedItems().filter(it => it.id !== targetItem.id && !cb.checkIsContainer(it));
            if (selected.length > 0) {
              if (cb.handlePutMultipleInContainer) cb.handlePutMultipleInContainer(selected, targetItem.id);
              else if (cb.handlePutInContainer) selected.forEach(it => cb.handlePutInContainer!(it, targetItem.id));
            }
            cb.setSelectedItemKeys(new Set());
          } else if (cb.canStack(state.item, targetItem) && cb.handleStackItems) {
            cb.handleStackItems(state.item, targetItem);
          } else if (cb.canDropInContainer(state.item, targetItem) && cb.handlePutInContainer) {
            cb.handlePutInContainer(state.item, targetItem.id);
          }
          return;
        }
      }

      // 5. Main inventory area (take out of container)
      const mainGrid = el?.closest('[data-inventory-grid]');
      const insideContainerContents = el?.closest('[data-container-contents]');
      if (mainGrid && !insideContainerContents) {
        if (state.item.containerId && cb.handleTakeOutOfContainer) {
          const isBatch = cb.multiSelectMode && cb.selectedItemKeys.has(cb.getItemKey(state.item)) && cb.selectedItemKeys.size > 1;
          if (isBatch && cb.handleBatchTakeOut) {
            const selected = cb.getSelectedItems().filter(it => !!it.containerId);
            if (selected.length > 0) cb.handleBatchTakeOut(selected);
            cb.setSelectedItemKeys(new Set());
          } else {
            cb.handleTakeOutOfContainer(state.item);
          }
          return;
        }
        void cb.dropItemsToMapFromInventoryGesture(state.item);
        return;
      }

      // 6. Outside floating panel = discard to map (embedded mode only)
      if (cb.embedded && cb.handleDiscardItem) {
        const panel = el?.closest('.floating-char-panel-window');
        if (!panel) {
          void cb.dropItemsToMapFromInventoryGesture(state.item);
        }
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // --- Drag handlers ---
  const handleDragStart = useCallback((e: React.DragEvent, item: EquipmentItem) => {
    if (embedded) {
      // Embedded mode: canvas elements intercept pointer events on top half of items.
      // Prevent HTML5 drag so custom mouse drag (document-level listeners) handles everything.
      e.preventDefault();
      return;
    }
    // Dialog mode: HTML5 drag works fine (dialog z-index is above canvases)
    // Kill custom mouse drag to avoid ghost conflicts
    if (mouseDragRef.current) {
      if (mouseDragRef.current.ghost) mouseDragRef.current.ghost.remove();
      mouseDragRef.current = null;
    }
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    // Attach hotbar-compatible item data so hotbar slots can accept drops
    e.dataTransfer.setData('application/hotbar-item', JSON.stringify({
      type: 'item', id: item.id, name: item.name, icon: '◆',
      meta: { quantity: item.quantity, avatar_url: item.avatar_url || '', description: item.description || '' },
    }));
    const itemKey = getItemKey(item);
    if (multiSelectMode && selectedItemKeys.has(itemKey) && selectedItemKeys.size > 1) {
      e.dataTransfer.setData('batch', 'true');
    }
  }, [getItemKey, selectedItemKeys, multiSelectMode, embedded]);

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null); setDragOverTarget(null); setDragOverOverlay(false); setMouseEquipHoverSlot(null);
    // Clean up custom mouse drag state in case HTML5 drag took over and mouseup never fired
    if (mouseDragRef.current) {
      if (mouseDragRef.current.ghost) mouseDragRef.current.ghost.remove();
      mouseDragRef.current = null;
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetItem: EquipmentItem) => {
    if (!draggedItem) return;
    const isTargetCont = checkIsContainer(targetItem);
    const isBatch = multiSelectMode && selectedItemKeys.has(getItemKey(draggedItem)) && selectedItemKeys.size > 1;
    if (isBatch) {
      if (isTargetCont && draggedItem.id !== targetItem.id) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverTarget(getItemKey(targetItem));
      }
    } else {
      if (canStack(draggedItem, targetItem) || canDropInContainer(draggedItem, targetItem)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverTarget(getItemKey(targetItem));
      }
    }
  }, [draggedItem, selectedItemKeys, multiSelectMode, checkIsContainer, getItemKey, canStack, canDropInContainer]);

  const handleDragLeave = useCallback(() => setDragOverTarget(null), []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetItem: EquipmentItem) => {
    e.preventDefault();
    if (!draggedItem || !handlePutInContainer) return;
    const isBatch = multiSelectMode && selectedItemKeys.has(getItemKey(draggedItem)) && selectedItemKeys.size > 1;
    const isTargetCont = checkIsContainer(targetItem);

    if (isBatch && isTargetCont) {
      const selected = getSelectedItems().filter(item => item.id !== targetItem.id && !checkIsContainer(item));
      if (selected.length > 0) {
        if (handlePutMultipleInContainer) await handlePutMultipleInContainer(selected, targetItem.id);
        else for (const item of selected) await handlePutInContainer(item, targetItem.id);
      }
      setSelectedItemKeys(new Set());
    } else {
      if (canStack(draggedItem, targetItem) && handleStackItems) await handleStackItems(draggedItem, targetItem);
      else if (canDropInContainer(draggedItem, targetItem)) await handlePutInContainer(draggedItem, targetItem.id);
    }
    setDraggedItem(null);
    setDragOverTarget(null);
  }, [draggedItem, selectedItemKeys, multiSelectMode, getItemKey, getSelectedItems, checkIsContainer, canStack, canDropInContainer, handlePutInContainer, handlePutMultipleInContainer, handleStackItems]);

  // --- Drag out of container to main inventory ---
  const handleDropToMainInventory = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedItem) return;
    if (draggedItem.containerId && handleTakeOutOfContainer) {
      const isBatch = multiSelectMode && selectedItemKeys.has(getItemKey(draggedItem)) && selectedItemKeys.size > 1;
      if (isBatch && handleBatchTakeOut) {
        const selected = getSelectedItems().filter(item => !!item.containerId);
        if (selected.length > 0) await handleBatchTakeOut(selected);
        setSelectedItemKeys(new Set());
      } else {
        await handleTakeOutOfContainer(draggedItem);
      }
    } else {
      await dropItemsToMapFromInventoryGesture(draggedItem);
    }
    setDraggedItem(null);
    setDragOverTarget(null);
  }, [draggedItem, multiSelectMode, selectedItemKeys, getItemKey, getSelectedItems, handleTakeOutOfContainer, handleBatchTakeOut, setSelectedItemKeys, dropItemsToMapFromInventoryGesture]);

  // --- Drag to overlay (drop on ground) ---
  const handleOverlayDragOver = useCallback((e: React.DragEvent) => {
    if (!draggedItem || !handleDiscardItem) return;
    // If dragging near the bottom of the screen (hotbar zone), don't intercept —
    // let the event pass through so the hotbar can accept the drop
    const hotbarZoneHeight = 90;
    if (e.clientY > window.innerHeight - hotbarZoneHeight) {
      setDragOverOverlay(false);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverOverlay(true);
  }, [draggedItem, handleDiscardItem]);

  const handleOverlayDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverOverlay(false);
    if (!draggedItem || !handleDiscardItem) return;
    await handleDiscardItem(draggedItem, draggedItem.quantity || 1);
    setDraggedItem(null);
    setDragOverTarget(null);
  }, [draggedItem, handleDiscardItem]);

  // --- Drag to paper doll slot ---
  const handleDropToSlot = useCallback((item: EquipmentItem, slot: EquipSlot) => {
    if (!applyEquip) {
      showToast?.("无法装备", "error");
      return;
    }
    const isWeapon = item.equipmentType === 'weapon' || !!findWeaponMetaByKey(item.id) || (item.name ? !!findWeaponMetaByKey(item.name) : false);
    const armorMeta = findArmorMetaByKey(item.id) || (item.name ? findArmorMetaByKey(item.name) : null);
    const isShield = item.id === 'shield' || (armorMeta as any)?.tier === 'shield';
    const isArmor = (item.equipmentType === 'armor' && !isShield) || (!!armorMeta && !isShield);
    const isAmmo = item.category === 'ammunition' || item.equipmentType === 'ammo';

    if (slot === 'armor') {
      if (!isArmor) { showToast?.("这个物品不能装备到护甲栏", "error"); return; }
    } else if (slot === 'ammo') {
      if (!isAmmo) { showToast?.("这个物品不是弹药", "error"); return; }
    } else if (slot === 'main_hand' || slot === 'off_hand') {
      if (!isWeapon && !isShield && item.equipmentType !== 'gear' && item.equipmentType !== 'tool') {
        showToast?.("这个物品不能装备到手上", "error"); return;
      }
    }
    // quick_item allows anything

    applyEquip(item, slot);
    setDraggedItem(null);
    setDragOverTarget(null);
  }, [applyEquip, showToast]);

  // --- Touch / Context ---
  const handleTouchStart = useCallback((e: React.TouchEvent, item: EquipmentItem) => {
    setPressedItem(getItemKey(item));
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      setContextMenu({ x: touch.clientX, y: touch.clientY, item });
      setPressedItem(null);
    }, 500);
  }, [getItemKey]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    setPressedItem(null);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: EquipmentItem) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  // --- AI Normalize ---
  const handleNormalize = async () => {
    if (!onEquipmentUpdate || normalizing) return;
    setNormalizing(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8174'}/api/equipment/normalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: equipmentLocal })
      });
      if (!response.ok) throw new Error('Failed to normalize');
      const result = await response.json();
      if (result.success) {
        const newCurrency: Currency = {
          cp: (currencyLocal?.cp ?? 0) + (result.currency_extracted?.cp ?? 0),
          sp: (currencyLocal?.sp ?? 0) + (result.currency_extracted?.sp ?? 0),
          ep: (currencyLocal?.ep ?? 0) + (result.currency_extracted?.ep ?? 0),
          gp: (currencyLocal?.gp ?? 0) + (result.currency_extracted?.gp ?? 0),
          pp: (currencyLocal?.pp ?? 0) + (result.currency_extracted?.pp ?? 0),
        };
        onEquipmentUpdate(result.items, newCurrency);
      }
    } catch (err) {
      console.error('Failed to normalize equipment:', err);
    } finally {
      setNormalizing(false);
    }
  };

  // --- Currency discard ---
  const handleDiscardCurrency = async (type: keyof Currency, amount: number) => {
    if (amount <= 0) return;
    const current = currencyLocal?.[type] ?? 0;
    if (amount > current) return;
    try {
      if (onCurrencyDropToMap) await onCurrencyDropToMap(type, amount);
      else if (onEquipmentUpdate) await onEquipmentUpdate(equipmentLocal, { ...currencyLocal, [type]: current - amount });
      setDiscardCurrency(null);
    } catch (e) { console.error('Failed to discard currency:', e); }
  };

  // --- Child modals (always portaled to body) ---
  const childModals = (
    <>
      {/* DM Add Item Modal (direct-add to equipment) */}
      {showAddItemModal && onEquipmentUpdate && (
        <AddItemModal
          open={showAddItemModal}
          onOpenChange={setShowAddItemModal}
          campaignId={campaignId || ''}
          onItemAdded={() => {}}
          onDirectAdd={(itemData) => {
            const next = [...(equipmentLocal || []), itemData];
            onEquipmentUpdate(next, currencyLocal);
          }}
        />
      )}

      {/* Avatar zoom */}
      {avatarZoom && character?.avatar && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[10200] bg-black/80 flex items-center justify-center cursor-pointer"
          onClick={() => setAvatarZoom(false)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white text-xl transition-colors"
            onClick={e => { e.stopPropagation(); setAvatarZoom(false); }}
          >
            ✕
          </button>
          <img
            src={character.avatar}
            alt={character.name}
            className="max-w-[85vw] max-h-[85vh] rounded-lg object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>,
        document.body
      )}

      {/* Toolbar Help Dialog */}
      {showToolbarHelp && createPortal(
        <div className="fixed inset-0 z-[10300] flex items-center justify-center" onClick={() => setShowToolbarHelp(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-w-sm w-full mx-4 p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-amber-400">工具栏功能说明</h3>
              <button className="text-gray-400 hover:text-white" onClick={() => setShowToolbarHelp(false)}>✕</button>
            </div>
            <div className="space-y-3 text-sm text-gray-300">
              <div>
                <span className="inline-block px-1.5 py-0.5 text-xs bg-gray-700 text-gray-200 rounded mr-1.5">多选</span>
                进入多选模式后，点击可选中多个物品，然后进行批量操作：放入容器、批量丢弃、合并同类物品等。再次点击按钮退出多选。
              </div>
              {isDM && (
                <div>
                  <span className="inline-block px-1.5 py-0.5 text-xs bg-purple-600 text-white rounded mr-1.5">AI转化</span>
                  使用AI自动识别并格式化背包中的物品数据，同时将"钱袋"等货币类物品自动转换为金币。适合从模组导入后物品数据需要规范化时使用。
                </div>
              )}
              <div>
                <span className="inline-block px-1.5 py-0.5 text-xs bg-indigo-600 text-white rounded mr-1.5">换装头像</span>
                根据当前已装备的物品重新生成角色头像。AI会保持角色面部和身份不变，只更新装备和服装外观。需要角色已有头像且已装备至少一件物品。
              </div>
            </div>
            <button
              className="mt-4 w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded transition-colors"
              onClick={() => setShowToolbarHelp(false)}
            >知道了</button>
          </div>
        </div>,
        document.body
      )}

      <ItemInfoModal
        open={!!infoItem}
        onOpenChange={v => !v && setInfoItem(null)}
        item={infoItem}
        onUseConsumable={onUseConsumable}
        isPaperItem={infoItem && isPaperItem ? isPaperItem(infoItem) : false}
        onWritePaper={onWriteOnPaper ? (item) => { setInfoItem(null); setPaperWriteTarget(item); } : undefined}
        character={character}
        isDM={isDM}
        onAvatarGenerated={onEquipmentUpdate ? (item, avatarUrl, avatarUrlLarge) => {
          const updated = (equipmentLocal || []).map(eq =>
            eq.id === item.id ? { ...eq, avatar_url: avatarUrl, avatar_url_large: avatarUrlLarge || avatarUrl } : eq
          );
          onEquipmentUpdate(updated, currencyLocal);
          setInfoItem(prev => prev && prev.id === item.id ? { ...prev, avatar_url: avatarUrl, avatar_url_large: avatarUrlLarge || avatarUrl } : prev);
          publishAppEvent('characterEquipmentUpdated', {
            characterId: character.id,
            equipment: updated,
            needsBroadcast: true,
          });
        } : undefined}
        onItemUpdate={onEquipmentUpdate ? (updatedItem) => {
          const next = (equipmentLocal || []).map(eq =>
            eq.id === updatedItem.id && eq.containerId === updatedItem.containerId ? updatedItem : eq
          );
          onEquipmentUpdate(next, currencyLocal);
          setInfoItem(updatedItem);
          publishAppEvent('characterEquipmentUpdated', {
            characterId: character.id,
            equipment: next,
            needsBroadcast: true,
          });
        } : undefined}
      />

      {/* Equipped slot item detail modal (with unequip/switch actions) */}
      <ItemInfoModal
        open={!!equippedSlotInfo}
        onOpenChange={v => { if (!v) setEquippedSlotInfo(null); }}
        item={equippedSlotInfo?.item ?? null}
        character={character}
        isDM={isDM}
        onAvatarGenerated={onEquipmentUpdate ? (item, avatarUrl, avatarUrlLarge) => {
          const updated = (equipmentLocal || []).map(eq =>
            eq.id === item.id ? { ...eq, avatar_url: avatarUrl, avatar_url_large: avatarUrlLarge || avatarUrl } : eq
          );
          onEquipmentUpdate(updated, currencyLocal);
          setEquippedSlotInfo(prev => prev && prev.item.id === item.id ? { ...prev, item: { ...prev.item, avatar_url: avatarUrl, avatar_url_large: avatarUrlLarge || avatarUrl } } : prev);
          publishAppEvent('characterEquipmentUpdated', {
            characterId: character.id,
            equipment: updated,
            needsBroadcast: true,
          });
        } : undefined}
        onItemUpdate={onEquipmentUpdate ? (updatedItem) => {
          const next = (equipmentLocal || []).map(eq =>
            eq.id === updatedItem.id && eq.containerId === updatedItem.containerId ? updatedItem : eq
          );
          onEquipmentUpdate(next, currencyLocal);
          setEquippedSlotInfo(prev => prev ? { ...prev, item: updatedItem } : prev);
          publishAppEvent('characterEquipmentUpdated', {
            characterId: character.id,
            equipment: next,
            needsBroadcast: true,
          });
        } : undefined}
        renderActions={(it) => (
          <div className="flex gap-2 pt-1">
            <button
              className="flex-1 px-3 py-2 text-sm bg-red-900/30 hover:bg-red-900/50 text-red-300 border border-red-700/60 rounded-lg transition-colors"
              onClick={async () => {
                if (!equippedSlotInfo || !onEquipmentUpdate) return;
                const updated = (equipmentLocal || []).map((eq: EquipmentItem) =>
                  eq.equippedSlot === equippedSlotInfo.slot ? { ...eq, equippedSlot: null as any } : eq
                );
                onEquipmentUpdate(updated, currencyLocal);
                publishAppEvent('characterEquipmentUpdated', {
                  characterId: character.id,
                  equipment: updated,
                  needsBroadcast: true,
                });
                setEquippedSlotInfo(null);
              }}
            >
              卸下装备
            </button>
            <button
              className="flex-1 px-3 py-2 text-sm bg-blue-900/30 hover:bg-blue-900/50 text-blue-300 border border-blue-700/60 rounded-lg transition-colors"
              onClick={() => {
                if (!equippedSlotInfo || !openEquip) return;
                const slot = equippedSlotInfo.slot;
                setEquippedSlotInfo(null);
                openEquip(slot);
              }}
            >
              切换装备
            </button>
          </div>
        )}
      />

      {contextMenu && typeof document !== 'undefined' && createPortal(
        <ItemContextMenu
          x={contextMenu.x} y={contextMenu.y} item={contextMenu.item}
          selectedItems={selectedItemKeys.size > 1 ? getSelectedItems() : undefined}
          onClose={() => { setContextMenu(null); if (selectedItemKeys.size > 1) setSelectedItemKeys(new Set()); }}
          onSplit={handleSplitStack} onMerge={handleMergeStacks} onDiscard={handleDiscardItem}
          onTakeOut={handleTakeOutOfContainer}
          onUseConsumable={onUseConsumable}
          onAddToHotbar={(eq) => {
            publishAppEvent('hotbarAddItem', {
              type: 'item', id: eq.id, name: eq.name, icon: '◆',
              meta: { quantity: eq.quantity, avatar_url: eq.avatar_url || '', description: eq.description || '' },
            });
          }}
          isPaperItem={isPaperItem ? isPaperItem(contextMenu.item) : false}
          isDM={isDM}
          onDirectDelete={isDM ? handleDirectDelete : undefined}
          onWrite={onWriteOnPaper ? (item) => setPaperWriteTarget(item) : undefined}
          onReadPaper={(item) => setPaperReadTarget(item)}
          onPublishDocument={isDM ? handlePublishDocument : undefined}
          onBatchTakeOut={handleBatchTakeOut} onBatchDiscard={handleBatchDiscard} onBatchMerge={handleBatchMerge}
          hasTokenOnMap={hasTokenOnMap} isInContainer={!!contextMenu.item.containerId}
        />,
        document.body
      )}

      {/* Paper Write Modal */}
      {paperWriteTarget && onWriteOnPaper && (
        <PaperWriteModal
          open={!!paperWriteTarget}
          onOpenChange={v => { if (!v) { setPaperWriteTarget(null); setPaperEditMode(false); } }}
          paper={paperWriteTarget}
          initialContent={paperEditMode ? paperWriteTarget.writtenContent : undefined}
          onConfirm={async (content) => {
            if (paperEditMode && onEditWrittenPaper) {
              await onEditWrittenPaper(paperWriteTarget, content);
            } else {
              await onWriteOnPaper(paperWriteTarget, content);
            }
            setPaperWriteTarget(null);
            setPaperEditMode(false);
          }}
        />
      )}

      {/* Paper Read Modal */}
      {paperReadTarget && (
        <PaperReadModal
          open={!!paperReadTarget}
          onOpenChange={v => { if (!v) setPaperReadTarget(null); }}
          item={paperReadTarget}
          onEdit={onEditWrittenPaper ? () => {
            setPaperEditMode(true);
            setPaperWriteTarget(paperReadTarget);
            setPaperReadTarget(null);
          } : undefined}
          onCopy={onCopyPaper ? () => {
            onCopyPaper(paperReadTarget);
            setPaperReadTarget(null);
          } : undefined}
        />
      )}
    </>
  );

  // --- Inner content ---
  const bagContent = (
    <div className={embedded ? "p-3 space-y-3 h-full overflow-y-auto" : undefined}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">
          背包 {selectedItemKeys.size > 0 && <span className="text-amber-400">({selectedItemKeys.size}件已选)</span>}
        </h3>
        <div className="flex items-center gap-2">
          {selectedItemKeys.size > 0 && (
            <button className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded" onClick={clearSelection}>取消选择</button>
          )}
          <button
            className={`px-2 py-1 text-xs rounded transition-colors ${
              multiSelectMode ? "bg-amber-600 hover:bg-amber-500 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-200"
            }`}
            onClick={toggleMultiSelect}
            title="多选模式"
          >多选</button>
          {isDM && onEquipmentUpdate && (
            <button
              className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded disabled:opacity-50"
              onClick={handleNormalize} disabled={normalizing}
              title="使用AI格式化物品数据，自动转换钱袋为金币"
            >{normalizing ? '转化中...' : 'AI转化'}</button>
          )}
          {character?.avatar && onRegenerateAvatar && (
            <button
              className="px-2 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onRegenerateAvatar}
              disabled={avatarRegenerating}
            >{avatarRegenerating ? '生成中(约30s)...' : '换装头像'}</button>
          )}
          <button
            className="w-5 h-5 flex items-center justify-center text-xs text-gray-400 hover:text-amber-400 rounded-full border border-gray-600 hover:border-amber-400 transition-colors"
            onClick={() => setShowToolbarHelp(true)}
            title="功能说明"
          >!</button>
          {!embedded && (
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center justify-between text-xs text-gray-400 px-1">
        <div>
          总重量：<span className={totalWeight > carryingCapacity ? "text-red-400 font-semibold" : "text-gray-200"}>{totalWeight} lb</span>
          <span className="text-gray-500"> / {carryingCapacity} lb</span>
        </div>
        <div>总价值：<span className="text-amber-300">{totalGoldValue} gp</span></div>
      </div>

      {/* Paper Doll Section */}
      {openEquip && getEquipped && (
        <div className="border border-gray-700/50 rounded-lg bg-gray-800/20">
          <PaperDollSection
            openEquip={openEquip}
            getEquipped={getEquipped}
            onDropToSlot={applyEquip ? handleDropToSlot : undefined}
            draggedItem={draggedItem}
            onToggleGrip={onToggleGrip}
            avatarZoom={avatarZoom}
            onAvatarZoomChange={setAvatarZoom}
            externalHoverSlot={mouseEquipHoverSlot}
            onEquippedItemClick={(slot, item) => setEquippedSlotInfo({ slot, item })}
          />
        </div>
      )}

      {/* Proficiencies */}
      {proficiencies && (proficiencies.armor.length > 0 || proficiencies.weapon.length > 0) && (
        <div className="px-2 py-1.5 bg-gray-800/30 border border-gray-700/50 rounded text-xs text-gray-400 space-y-1">
          {proficiencies.armor.length > 0 && (
            <div className="flex items-start gap-1.5">
              <span className="text-gray-500 shrink-0">护甲:</span>
              <span className="text-gray-300">{proficiencies.armor.map(id => tProficiency(id)).join('、')}</span>
            </div>
          )}
          {proficiencies.weapon.length > 0 && (
            <div className="flex items-start gap-1.5">
              <span className="text-gray-500 shrink-0">武器:</span>
              <span className="text-gray-300">{proficiencies.weapon.map(id => tProficiency(id)).join('、')}</span>
            </div>
          )}
        </div>
      )}

      {/* Currency */}
      <div className="p-2 bg-gray-800/50 border border-gray-700 rounded">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-gray-400">钱币</span>
            <button
              className="w-4 h-4 flex items-center justify-center rounded-full bg-gray-600/60 hover:bg-amber-600/60 text-gray-400 hover:text-amber-300 text-[10px] font-bold transition-colors"
              onClick={() => setShowCurrencyHelp(v => !v)}
              title="钱币说明"
            >?</button>
          </div>
          {isDM && (
            <button className="px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded" onClick={() => setCurrencyDialogOpen(true)}>编辑</button>
          )}
        </div>
        {showCurrencyHelp && (
          <div className="mb-2 p-2 bg-gray-700/50 border border-gray-600/50 rounded text-xs text-gray-300 space-y-1">
            <div className="font-semibold text-gray-200 mb-1">D&D 5E 货币体系</div>
            <div className="flex items-center gap-1"><span className="font-semibold text-purple-300">PP</span> = 铂金币（Platinum）</div>
            <div className="flex items-center gap-1"><span className="font-semibold text-amber-300">GP</span> = 金币（Gold）— 最常用单位</div>
            <div className="flex items-center gap-1"><span className="font-semibold text-gray-300">EP</span> = 银电币（Electrum）</div>
            <div className="flex items-center gap-1"><span className="font-semibold text-gray-400">SP</span> = 银币（Silver）</div>
            <div className="flex items-center gap-1"><span className="font-semibold text-orange-400">CP</span> = 铜币（Copper）</div>
            <div className="border-t border-gray-600/50 mt-1.5 pt-1.5 text-gray-400">
              <div className="font-semibold text-gray-300 mb-0.5">换算关系</div>
              1 PP = 10 GP = 20 EP = 100 SP = 1000 CP
            </div>
            <div className="text-gray-500 italic">点击钱币可以丢弃</div>
          </div>
        )}
        <div className="flex flex-wrap gap-2 text-sm">
          {(['pp', 'gp', 'ep', 'sp', 'cp'] as const).map(type => {
            const amount = currencyLocal?.[type] ?? 0;
            if (amount === 0) return null;
            const colors = { pp: 'text-purple-300', gp: 'text-amber-300', ep: 'text-gray-300', sp: 'text-gray-400', cp: 'text-orange-400' };
            return (
              <div key={type} className="flex items-center gap-1 px-2 py-1 bg-gray-700/50 rounded cursor-pointer hover:bg-gray-600/50"
                onClick={() => amount > 0 && setDiscardCurrency({ type, amount: 1 })} title="点击丢弃">
                <span className={`font-semibold ${colors[type]}`}>{amount}</span>
                <span className="text-xs text-gray-400">{type.toUpperCase()}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Currency discard dialog */}
      {discardCurrency && (
        <div className="p-2 bg-red-900/30 border border-red-700 rounded text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-300">丢弃 {discardCurrency.type.toUpperCase()}：</span>
            <input type="number" min={1} max={currencyLocal?.[discardCurrency.type] ?? 0}
              value={discardCurrency.amount}
              onChange={e => setDiscardCurrency({ ...discardCurrency, amount: Math.max(1, parseInt(e.target.value) || 1) })}
              className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-center" />
            <button className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs" onClick={() => handleDiscardCurrency(discardCurrency.type, discardCurrency.amount)}>确认丢弃</button>
            <button className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs" onClick={() => setDiscardCurrency(null)}>取消</button>
          </div>
        </div>
      )}

      {/* Drop-to-map quantity selector (embedded mode) */}
      {dropToMapItem && handleDiscardItem && (
        <div className="p-2 bg-red-900/30 border border-red-700 rounded text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-300 truncate">丢弃 {dropToMapItem.name}：</span>
            <input type="number" min={1} max={dropToMapItem.quantity || 1}
              value={dropToMapQty}
              onChange={e => setDropToMapQty(Math.max(1, Math.min(dropToMapItem.quantity || 1, parseInt(e.target.value) || 1)))}
              className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-center" />
            <button className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs" onClick={() => {
              handleDiscardItem(dropToMapItem, dropToMapQty);
              setDropToMapItem(null);
              setDropToMapQty(1);
            }}>丢到地上</button>
            <button className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs" onClick={() => { setDropToMapItem(null); setDropToMapQty(1); }}>取消</button>
          </div>
        </div>
      )}

      {/* DM Add Item Section */}
      {isDMAddItem && onEquipmentUpdate && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              className="flex-1 px-2 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-gray-200 rounded transition-colors"
              onClick={() => setShowAddItemModal(true)}
            >添加预设物品</button>
            <button
              className="flex-1 px-2 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 text-gray-200 rounded transition-colors"
              onClick={() => setShowCustomAddForm(true)}
            >添加自定义物品</button>
            <button
              className="flex-1 px-2 py-1.5 text-xs bg-violet-700 hover:bg-violet-600 text-gray-200 rounded transition-colors"
              onClick={handleToggleCustomPicker}
            >{showCustomItemPicker ? '收起' : '已有自定义'}</button>
          </div>

          {/* 已有自定义物品选择面板 */}
          {showCustomItemPicker && (
            <div className="border border-gray-600 rounded-lg p-2 bg-gray-800/50">
              {loadingCustomItems ? (
                <div className="text-xs text-gray-400 text-center py-2">加载中...</div>
              ) : customItemsList.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-2">当前战役暂无自定义物品</div>
              ) : (
                <div className="max-h-[160px] overflow-auto space-y-1">
                  {customItemsList.map((item: any) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-1"
                    >
                      <button
                        className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-700 transition-colors text-left min-w-0"
                        onClick={() => handlePickCustomItem(item)}
                      >
                        {item.avatar_url ? (
                          <img src={item.avatar_url} alt={item.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-gray-700 flex items-center justify-center flex-shrink-0 text-xs text-gray-500">?</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-200 truncate">{item.name_cn || item.name}</div>
                          <div className="text-[10px] text-gray-400 truncate">
                            {item.rarity && <span className="mr-1">{tRarity(item.rarity)}</span>}
                            {item.category && <span>{tCategory(item.category)}</span>}
                          </div>
                        </div>
                      </button>
                      <button
                        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-red-900/50 text-gray-500 hover:text-red-400 transition-colors"
                        title="删除此自定义物品"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`确定删除「${item.name_cn || item.name}」？`)) return;
                          try {
                            const resp = await fetch(`${API_BASE}/api/items/${item.id}`, { method: 'DELETE' });
                            if (resp.ok || resp.status === 204) {
                              setCustomItemsList(prev => prev.filter(i => i.id !== item.id));
                            }
                          } catch { /* ignore */ }
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                </div>
              )}
            </div>
          )}

          <AddCustomItemModal
            open={showCustomAddForm}
            onOpenChange={setShowCustomAddForm}
            campaignId={campaignId || ''}
            onItemAdded={() => {}}
            onItemCreated={(item) => {
              if (!onEquipmentUpdate) return;
              const newItem = convertBackendItemToEquipment(item);
              onEquipmentUpdate([...(equipmentLocal || []), newItem], currencyLocal);
            }}
          />
        </div>
      )}

      {/* Drag hints */}
      {multiSelectMode && selectedItemKeys.size > 1 && !draggedItem && (
        <div className="text-xs text-center text-amber-400 bg-amber-900/20 rounded py-1">拖动任意选中物品可批量放入容器</div>
      )}
      {draggedItem && (
        <div className="text-xs text-center py-1 bg-blue-900/20 rounded">
          {multiSelectMode && selectedItemKeys.has(getItemKey(draggedItem)) && selectedItemKeys.size > 1 ? (
            <span className="space-x-2">
              <span className="text-amber-400">拖到容器批量放入 {selectedItemKeys.size} 件物品</span>
              {hasTokenOnMap && <span className="text-red-400">拖到空白处批量丢到地图</span>}
            </span>
          ) : (
            <span className="space-x-2">
              <span className="text-cyan-400">拖到装备栏装备</span>
              <span className="text-blue-400">拖到容器放入</span>
              <span className="text-green-400">拖到同类堆叠</span>
              {hasTokenOnMap && <span className="text-red-400">拖到空白处丢到地图</span>}
            </span>
          )}
        </div>
      )}

      {/* Inventory Grid */}
      <div className={embedded ? "min-h-[200px] pr-1" : "max-h-[40dvh] overflow-auto pr-1"}>
        <InventoryGrid
          items={equipmentLocal}
          isContainer={isContainer || (() => false)}
          getContainerContents={getContainerContentsProp || (() => [])}
          getItemDisplayName={getItemDisplayName}
          getItemKey={getItemKey}
          getItemWeight={getItemWeight}
          canDropToGroundOnMainArea={!!hasTokenOnMap}
          multiSelectMode={multiSelectMode}
          selectedItemKeys={selectedItemKeys}
          toggleItemSelection={toggleItemSelection}
          draggedItem={draggedItem}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDropToMainInventory={handleDropToMainInventory}
          dragOverTarget={dragOverTarget}
          onItemClick={handleItemClick}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          checkIsContainer={checkIsContainer}
          canStack={canStack}
          canDropInContainer={canDropInContainer}
          onItemMouseDown={handleItemMouseDown}
        />
      </div>

      {/* Ground items (embedded mode only) */}
      {embedded && currentMapUrl && (
        <GroundItemsSection currentMapUrl={currentMapUrl} />
      )}

      {/* Usage hint */}
      <div className="text-xs text-gray-500 text-center">
        {multiSelectMode
          ? (hasTokenOnMap ? "单击选择 · 右键/长按操作 · 拖到容器整理 · 拖到空白处丢到地图" : "单击选择 · 右键/长按操作 · 拖动整理")
          : (hasTokenOnMap ? "单击详情 · 右键/长按操作 · 拖动装备/整理 · 拖到空白处丢到地图" : "单击详情 · 右键/长按操作 · 拖动装备/整理")}
      </div>

      {!embedded && (
        <div className="text-right">
          <button className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm" onClick={() => onOpenChange(false)}>关闭</button>
        </div>
      )}
    </div>
  );

  // --- Embedded mode: render content directly ---
  if (embedded) {
    return <>{bagContent}{childModals}</>;
  }

  // --- Dialog mode ---
  return (
    <Dialog.Root open={open} onOpenChange={v => {
      if (!v && (paperWriteTarget || paperReadTarget)) return;
      if (!v) setAvatarZoom(false);
      onOpenChange(v);
    }} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={`fixed inset-0 transition-colors z-[100] ${dragOverOverlay ? 'bg-red-900/50' : 'bg-black/50'}`}
          style={draggedItem ? { bottom: '90px' } : undefined}
          onDragOver={handleOverlayDragOver}
          onDragLeave={() => setDragOverOverlay(false)}
          onDrop={handleOverlayDrop}
        />
        {dragOverOverlay && (
          <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[1]">
            <div className="text-2xl text-red-400 font-bold bg-black/60 px-6 py-3 rounded-xl border-2 border-dashed border-red-500/50">
              丢弃物品
            </div>
          </div>
        )}
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-lg max-h-[90dvh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3 z-[110]"
          onInteractOutside={e => { if (contextMenu || paperWriteTarget || paperReadTarget || infoItem || equippedSlotInfo || isClickInsideFloatingChat(e)) e.preventDefault(); }}
          onPointerDownOutside={e => { if (contextMenu || paperWriteTarget || paperReadTarget || infoItem || equippedSlotInfo || isClickInsideFloatingChat(e)) e.preventDefault(); }}
        >
          <Dialog.Title className="sr-only">背包</Dialog.Title>
          {bagContent}
        </Dialog.Content>
      </Dialog.Portal>
      {childModals}
    </Dialog.Root>
  );
}
