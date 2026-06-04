import React, { useState, useEffect } from 'react';
import { Dialog, Flex, Text, Button, ScrollArea, Box, TextField, Select, Switch, TextArea } from '@radix-ui/themes';
import { apiFetch } from '~/utils/api-client';
import { subscribeAppEvent } from '~/events/appEventBus';
import { createLogger } from '~/utils/logger';
import type { Chest } from './ChestsTab';

const logger = createLogger('ChestInventoryModal');

interface ChestInventoryItem {
  id: number;
  chest_id: number;
  item_id: number;
  quantity: number;
  item?: {
    id: number;
    name: string;
    name_cn?: string;
    category?: string;
    rarity?: string;
    description?: string;
    avatar_url?: string;
    cost?: string;
  };
}

interface ChestInventoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  chest: Chest | null;
  onUpdated: () => void;
}

export function ChestInventoryModal({ open, onOpenChange, campaignId, chest, onUpdated }: ChestInventoryModalProps) {
  const [inventory, setInventory] = useState<ChestInventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddItemSection, setShowAddItemSection] = useState(false);
  const [showEditSection, setShowEditSection] = useState(false);
  // Local chest state to track updates
  const [currentChest, setCurrentChest] = useState<Chest | null>(null);

  // Available items from campaign
  const [availableItems, setAvailableItems] = useState<any[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [addQuantity, setAddQuantity] = useState(1);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIsLocked, setEditIsLocked] = useState(false);
  const [editLockDc, setEditLockDc] = useState(15);
  const [editCp, setEditCp] = useState(0);
  const [editSp, setEditSp] = useState(0);
  const [editEp, setEditEp] = useState(0);
  const [editGp, setEditGp] = useState(0);
  const [editPp, setEditPp] = useState(0);

  // Sync chest prop to local state
  useEffect(() => {
    if (chest) {
      setCurrentChest(chest);
    }
  }, [chest]);

  // Listen for WebSocket chest updates (e.g., when player loots)
  useEffect(() => {
    if (!open || !currentChest) return;

    const handleChestUpdate = (detail: any) => {
      const updatedChest = detail?.chest;
      if (updatedChest && updatedChest.id === currentChest.id) {
        logger.debug('[ChestInventoryModal] Received chest update:', updatedChest);
        setCurrentChest(updatedChest);
        // Reload inventory to reflect changes
        loadInventory();
        onUpdated();
      }
    };

    return subscribeAppEvent('chestStateChanged', handleChestUpdate);
  }, [open, currentChest?.id]);

  const loadInventory = async () => {
    if (!currentChest) return;
    setIsLoading(true);
    try {
      const resp = await apiFetch(`/api/chests/${currentChest.id}/inventory/detailed`);
      if (resp.ok) {
        const data = await resp.json();
        setInventory(data || []);
      }
    } catch (e) {
      logger.error('[ChestInventoryModal] loadInventory error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAvailableItems = async () => {
    try {
      const resp = await apiFetch(`/api/items/campaign/${campaignId}`);
      if (resp.ok) {
        const data = await resp.json();
        setAvailableItems(data || []);
      }
    } catch (e) {
      logger.error('[ChestInventoryModal] loadAvailableItems error:', e);
    }
  };

  useEffect(() => {
    if (open && currentChest) {
      loadInventory();
      loadAvailableItems();
      // Initialize edit form
      setEditName(currentChest.name);
      setEditDescription(currentChest.description || '');
      setEditIsLocked(currentChest.is_locked);
      setEditLockDc(currentChest.lock_dc);
      setEditCp(currentChest.cp);
      setEditSp(currentChest.sp);
      setEditEp(currentChest.ep);
      setEditGp(currentChest.gp);
      setEditPp(currentChest.pp);
    }
  }, [open, currentChest?.id]);

  const handleAddItem = async () => {
    if (!currentChest || !selectedItemId) return;
    try {
      const resp = await apiFetch(`/api/chests/${currentChest.id}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: parseInt(selectedItemId),
          quantity: addQuantity,
        }),
      });
      if (resp.ok) {
        loadInventory();
        setSelectedItemId('');
        setAddQuantity(1);
        setShowAddItemSection(false);
      }
    } catch (e) {
      logger.error('[ChestInventoryModal] addItem error:', e);
    }
  };

  const handleRemoveItem = async (invId: number) => {
    if (!currentChest) return;
    try {
      const resp = await apiFetch(`/api/chests/${currentChest.id}/inventory/${invId}`, {
        method: 'DELETE',
      });
      if (resp.ok) {
        loadInventory();
      }
    } catch (e) {
      logger.error('[ChestInventoryModal] removeItem error:', e);
    }
  };

  const handleUpdateChest = async () => {
    if (!currentChest) return;
    try {
      const resp = await apiFetch(`/api/chests/${currentChest.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          is_locked: editIsLocked,
          lock_dc: editLockDc,
          state: editIsLocked ? 'locked' : (currentChest.state === 'locked' ? 'unlocked' : currentChest.state),
          cp: editCp,
          sp: editSp,
          ep: editEp,
          gp: editGp,
          pp: editPp,
        }),
      });
      if (resp.ok) {
        const updatedChest = await resp.json();
        setCurrentChest(updatedChest);
        onUpdated();
        setShowEditSection(false);
      }
    } catch (e) {
      logger.error('[ChestInventoryModal] updateChest error:', e);
    }
  };

  const getRarityColor = (rarity?: string) => {
    switch (rarity?.toLowerCase()) {
      case 'common': return 'gray';
      case 'uncommon': return 'green';
      case 'rare': return 'blue';
      case 'very rare': return 'purple';
      case 'legendary': return 'orange';
      case 'artifact': return 'red';
      default: return 'gray';
    }
  };

  const getStateDisplay = () => {
    if (!currentChest) return '';
    switch (currentChest.state) {
      case 'locked': return '🔒 已锁定';
      case 'unlocked': return '🔓 已解锁';
      case 'open': return '📬 已打开';
      case 'looted': return '📭 已清空';
      default: return currentChest.state;
    }
  };

  if (!currentChest) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} {...{modal: false}}>
      <Dialog.Content aria-describedby={undefined} maxWidth="600px" className="bg-gray-900">
        <Dialog.Title>
          <Flex justify="between" align="center">
            <Flex align="center" gap="2">
              {currentChest.avatar_url && (
                <img src={currentChest.avatar_url} alt={currentChest.name} className="w-8 h-8 rounded" />
              )}
              <span>{currentChest.name}</span>
            </Flex>
            <Text size="2" color="gray">{getStateDisplay()}</Text>
          </Flex>
        </Dialog.Title>

        <ScrollArea style={{ maxHeight: '60vh' }}>
          <Flex direction="column" gap="3" mt="4">
            {/* Chest Stats */}
            <Box className="bg-gray-800 p-3 rounded">
              <Flex justify="between" align="center" mb="2">
                <Text size="2" weight="bold">宝箱属性</Text>
                <Button size="1" variant="soft" onClick={() => setShowEditSection(!showEditSection)}>
                  {showEditSection ? '取消' : '编辑'}
                </Button>
              </Flex>

              {showEditSection ? (
                <Flex direction="column" gap="2">
                  <TextField.Root
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="宝箱名称"
                  />
                  <TextArea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="描述"
                    rows={2}
                  />
                  <Flex align="center" gap="2">
                    <Switch checked={editIsLocked} onCheckedChange={setEditIsLocked} size="1" />
                    <Text size="2">已锁定</Text>
                    {editIsLocked && (
                      <TextField.Root
                        type="number"
                        value={String(editLockDc)}
                        onChange={(e) => setEditLockDc(parseInt(e.target.value) || 15)}
                        style={{ width: '70px' }}
                        size="1"
                      />
                    )}
                  </Flex>

                  {/* Currency edit */}
                  <Flex gap="2" wrap="wrap">
                    <Flex direction="column" gap="1" style={{ width: '55px' }}>
                      <Text size="1">cp</Text>
                      <TextField.Root
                        type="number"
                        value={String(editCp)}
                        onChange={(e) => setEditCp(Math.max(0, parseInt(e.target.value) || 0))}
                        size="1"
                      />
                    </Flex>
                    <Flex direction="column" gap="1" style={{ width: '55px' }}>
                      <Text size="1">sp</Text>
                      <TextField.Root
                        type="number"
                        value={String(editSp)}
                        onChange={(e) => setEditSp(Math.max(0, parseInt(e.target.value) || 0))}
                        size="1"
                      />
                    </Flex>
                    <Flex direction="column" gap="1" style={{ width: '55px' }}>
                      <Text size="1">ep</Text>
                      <TextField.Root
                        type="number"
                        value={String(editEp)}
                        onChange={(e) => setEditEp(Math.max(0, parseInt(e.target.value) || 0))}
                        size="1"
                      />
                    </Flex>
                    <Flex direction="column" gap="1" style={{ width: '55px' }}>
                      <Text size="1">gp</Text>
                      <TextField.Root
                        type="number"
                        value={String(editGp)}
                        onChange={(e) => setEditGp(Math.max(0, parseInt(e.target.value) || 0))}
                        size="1"
                      />
                    </Flex>
                    <Flex direction="column" gap="1" style={{ width: '55px' }}>
                      <Text size="1">pp</Text>
                      <TextField.Root
                        type="number"
                        value={String(editPp)}
                        onChange={(e) => setEditPp(Math.max(0, parseInt(e.target.value) || 0))}
                        size="1"
                      />
                    </Flex>
                  </Flex>

                  <Button size="1" onClick={handleUpdateChest}>保存更改</Button>
                </Flex>
              ) : (
                <Flex direction="column" gap="1">
                  {currentChest.description && (
                    <Text size="1" color="gray">{currentChest.description}</Text>
                  )}
                  <Flex gap="2" wrap="wrap">
                    {currentChest.is_locked && (
                      <Text size="1" color="orange">🔐 锁DC: {currentChest.lock_dc}</Text>
                    )}
                    {currentChest.is_trapped && !currentChest.trap_disarmed && (
                      <Text size="1" color="red">
                        ⚠️ 陷阱 ({currentChest.trap_detected ? '已发现' : '未发现'})
                      </Text>
                    )}
                  </Flex>
                  <Flex gap="2" mt="1">
                    {currentChest.cp > 0 && <Text size="1" color="orange">{currentChest.cp}cp</Text>}
                    {currentChest.sp > 0 && <Text size="1" color="gray">{currentChest.sp}sp</Text>}
                    {currentChest.ep > 0 && <Text size="1" color="blue">{currentChest.ep}ep</Text>}
                    {currentChest.gp > 0 && <Text size="1" color="yellow">{currentChest.gp}gp</Text>}
                    {currentChest.pp > 0 && <Text size="1" color="cyan">{currentChest.pp}pp</Text>}
                    {!currentChest.cp && !currentChest.sp && !currentChest.ep && !currentChest.gp && !currentChest.pp && (
                      <Text size="1" color="gray">无货币</Text>
                    )}
                  </Flex>
                </Flex>
              )}
            </Box>

            {/* Inventory Section */}
            <Box>
              <Flex justify="between" align="center" mb="2">
                <Text size="2" weight="bold">📦 物品内容</Text>
                <Button
                  size="1"
                  variant="soft"
                  onClick={() => setShowAddItemSection(!showAddItemSection)}
                >
                  {showAddItemSection ? '取消' : '+ 添加物品'}
                </Button>
              </Flex>

              {showAddItemSection && (
                <Box className="bg-gray-800 p-2 rounded mb-2">
                  <Flex gap="2" align="end">
                    <Box style={{ flex: 1 }}>
                      <Text size="1" mb="1">选择物品</Text>
                      <Select.Root value={selectedItemId} onValueChange={setSelectedItemId}>
                        <Select.Trigger placeholder="选择物品..." />
                        <Select.Content>
                          {availableItems.map(item => (
                            <Select.Item key={item.id} value={String(item.id)}>
                              {item.name_cn || item.name}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    </Box>
                    <Box style={{ width: '70px' }}>
                      <Text size="1" mb="1">数量</Text>
                      <TextField.Root
                        type="number"
                        value={String(addQuantity)}
                        onChange={(e) => setAddQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                        size="2"
                      />
                    </Box>
                    <Button size="2" onClick={handleAddItem} disabled={!selectedItemId}>
                      添加
                    </Button>
                  </Flex>
                </Box>
              )}

              {isLoading ? (
                <Text size="2" color="gray">加载中...</Text>
              ) : inventory.length === 0 ? (
                <Text size="2" color="gray">宝箱内没有物品</Text>
              ) : (
                <Flex direction="column" gap="2">
                  {inventory.map(inv => (
                    <Flex
                      key={inv.id}
                      className="bg-gray-800 p-2 rounded"
                      align="center"
                      gap="2"
                    >
                      {inv.item?.avatar_url && (
                        <img
                          src={inv.item.avatar_url}
                          alt={inv.item.name}
                          className="w-10 h-10 rounded object-cover"
                        />
                      )}
                      <Box style={{ flex: 1 }}>
                        <Flex align="center" gap="2">
                          <Text size="2" weight="bold">
                            {inv.item?.name_cn || inv.item?.name || `物品 #${inv.item_id}`}
                          </Text>
                          {inv.item?.rarity && (
                            <Text size="1" color={getRarityColor(inv.item.rarity)}>
                              {inv.item.rarity}
                            </Text>
                          )}
                        </Flex>
                        <Text size="1" color="gray">x{inv.quantity}</Text>
                      </Box>
                      <Button
                        size="1"
                        variant="soft"
                        color="red"
                        onClick={() => handleRemoveItem(inv.id)}
                      >
                        移除
                      </Button>
                    </Flex>
                  ))}
                </Flex>
              )}
            </Box>
          </Flex>
        </ScrollArea>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">关闭</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
