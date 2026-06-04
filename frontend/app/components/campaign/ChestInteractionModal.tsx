import React, { useState, useEffect } from 'react';
import { Dialog, Flex, Text, Button, Box, TextField, ScrollArea } from '@radix-ui/themes';
import { apiFetch } from '~/utils/api-client';
import { subscribeAppEvent } from '~/events/appEventBus';
import { createLogger } from '~/utils/logger';
import type { Chest } from './ChestsTab';

const logger = createLogger('ChestInteractionModal');

interface Character {
  id: number;
  name: string;
  user_id: string;
}

interface ChestItem {
  inventory_id: number;
  item_id: number;
  name: string;
  name_cn?: string;
  quantity: number;
  rarity?: string;
  avatar_url?: string;
}

interface ChestContents {
  items: ChestItem[];
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number };
}

interface ChestInteractionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chest: Chest | null;
  campaignId: string;
  characters: Character[];
  currentUserId?: string;
  isDM?: boolean;
  onChestUpdated?: (chest: Chest) => void;
}

export function ChestInteractionModal({
  open, onOpenChange, chest, campaignId, characters, currentUserId, isDM = false, onChestUpdated
}: ChestInteractionModalProps) {
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [rollResult, setRollResult] = useState<number>(10);
  const [isLoading, setIsLoading] = useState(false);
  const [currentChest, setCurrentChest] = useState<Chest | null>(null);
  const [chestContents, setChestContents] = useState<ChestContents | null>(null);
  const [message, setMessage] = useState<string>('');

  // Sync chest prop to state
  useEffect(() => {
    if (chest) {
      setCurrentChest(chest);
      setChestContents(null);
      setMessage('');
    }
  }, [chest]);

  // Listen for WebSocket chest updates
  useEffect(() => {
    if (!open || !currentChest) return;

    const handleChestUpdate = (detail: any) => {
      const updatedChest = detail?.chest;
      if (updatedChest && updatedChest.id === currentChest.id) {
        logger.debug('[ChestInteractionModal] Received chest update:', updatedChest);
        setCurrentChest(updatedChest);
        onChestUpdated?.(updatedChest);
        // Reload contents if chest is open
        if (updatedChest.state === 'open' || updatedChest.state === 'looted') {
          loadContents();
        }
      }
    };

    return subscribeAppEvent('chestStateChanged', handleChestUpdate);
  }, [open, currentChest?.id]);

  // Auto-select character (only from available characters for the user)
  useEffect(() => {
    if (open && characters.length > 0) {
      // For players, only select from their own characters
      const availableChars = isDM
        ? characters
        : characters.filter(c => c.user_id === currentUserId);

      if (availableChars.length > 0) {
        setSelectedCharacterId(availableChars[0].id);
      } else {
        setSelectedCharacterId(null);
      }
    }
  }, [open, characters, currentUserId, isDM]);

  // Auto-load contents when chest is open
  useEffect(() => {
    if (open && currentChest && (currentChest.state === 'open' || currentChest.state === 'looted')) {
      loadContents();
    }
  }, [open, currentChest?.id, currentChest?.state]);

  const loadContents = async () => {
    if (!currentChest) return;
    try {
      // Use detailed endpoint to get full item info
      const resp = await apiFetch(`/api/chests/${currentChest.id}/inventory/detailed`);
      if (resp.ok) {
        const data = await resp.json();
        // data is an array of { id, chest_id, item_id, quantity, item: {...} }
        const items = (Array.isArray(data) ? data : []).map((inv: any) => ({
          inventory_id: inv.id,
          item_id: inv.item_id || inv.item?.id,
          name: inv.item?.name || '',
          name_cn: inv.item?.name_cn,
          quantity: inv.quantity,
          rarity: inv.item?.rarity,
          avatar_url: inv.item?.avatar_url,
        }));
        setChestContents({
          items,
          currency: {
            cp: currentChest.cp || 0,
            sp: currentChest.sp || 0,
            ep: currentChest.ep || 0,
            gp: currentChest.gp || 0,
            pp: currentChest.pp || 0,
          }
        });
      }
    } catch (e) {
      logger.error('[ChestInteractionModal] loadContents error:', e);
    }
  };

  const handleAction = async (action: 'investigate' | 'pick-lock' | 'disarm-trap' | 'open') => {
    if (!currentChest || !selectedCharacterId) return;
    setIsLoading(true);
    setMessage('');

    try {
      const payload: any = { character_id: selectedCharacterId };
      if (action !== 'open') {
        payload.roll_result = rollResult;
      }

      const resp = await apiFetch(`/api/chests/${currentChest.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();
      setMessage(data.message || (resp.ok ? '成功' : '失败'));

      if (data.chest) {
        setCurrentChest(data.chest);
        onChestUpdated?.(data.chest);
      }
      if (data.contents) {
        setChestContents(data.contents);
      }
    } catch (e) {
      logger.error('[ChestInteractionModal] action error:', e);
      setMessage('操作失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLootAll = async () => {
    if (!currentChest || !selectedCharacterId) return;
    setIsLoading(true);
    setMessage('');

    try {
      const payload: any = {
        character_id: selectedCharacterId,
        take_currency: true,
        items: chestContents?.items?.map(item => ({
          inventory_id: item.inventory_id,
          quantity: item.quantity
        })) || []
      };

      const resp = await apiFetch(`/api/chests/${currentChest.id}/loot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();

      if (resp.ok) {
        const parts: string[] = [];
        if (data.looted_items?.length > 0) {
          parts.push(`物品: ${data.looted_items.map((i: any) => `${i.name} x${i.quantity}`).join(', ')}`);
        }
        if (data.looted_currency) {
          const coins = ['pp', 'gp', 'ep', 'sp', 'cp']
            .filter(c => data.looted_currency[c] > 0)
            .map(c => `${data.looted_currency[c]}${c}`)
            .join(' ');
          if (coins) parts.push(`货币: ${coins}`);
        }
        setMessage(parts.length > 0 ? `获得: ${parts.join('; ')}` : '宝箱已空');

        if (data.chest) {
          setCurrentChest(data.chest);
          onChestUpdated?.(data.chest);
        }
        // Reload contents
        await loadContents();
      } else {
        setMessage(data.message || '拾取失败');
      }
    } catch (e) {
      logger.error('[ChestInteractionModal] loot error:', e);
      setMessage('拾取失败');
    } finally {
      setIsLoading(false);
    }
  };

  // Loot only currency
  const handleLootCurrency = async () => {
    if (!currentChest || !selectedCharacterId) return;
    setIsLoading(true);
    setMessage('');

    try {
      const payload = {
        character_id: selectedCharacterId,
        take_currency: true,
        items: []  // No items
      };

      const resp = await apiFetch(`/api/chests/${currentChest.id}/loot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();

      if (resp.ok) {
        if (data.looted_currency) {
          const coins = ['pp', 'gp', 'ep', 'sp', 'cp']
            .filter(c => data.looted_currency[c] > 0)
            .map(c => `${data.looted_currency[c]}${c}`)
            .join(' ');
          setMessage(coins ? `获得货币: ${coins}` : '没有货币可拿');
        }
        if (data.chest) {
          setCurrentChest(data.chest);
          onChestUpdated?.(data.chest);
        }
        await loadContents();
      } else {
        setMessage(data.message || '拾取失败');
      }
    } catch (e) {
      logger.error('[ChestInteractionModal] loot currency error:', e);
      setMessage('拾取失败');
    } finally {
      setIsLoading(false);
    }
  };

  // Loot single item
  const handleLootItem = async (item: ChestItem) => {
    if (!currentChest || !selectedCharacterId) return;
    setIsLoading(true);
    setMessage('');

    try {
      const payload = {
        character_id: selectedCharacterId,
        take_currency: false,
        items: [{ inventory_id: item.inventory_id, quantity: item.quantity }]
      };

      const resp = await apiFetch(`/api/chests/${currentChest.id}/loot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();

      if (resp.ok) {
        setMessage(`获得: ${item.name_cn || item.name} x${item.quantity}`);
        if (data.chest) {
          setCurrentChest(data.chest);
          onChestUpdated?.(data.chest);
        }
        await loadContents();
      } else {
        setMessage(data.message || '拾取失败');
      }
    } catch (e) {
      logger.error('[ChestInteractionModal] loot item error:', e);
      setMessage('拾取失败');
    } finally {
      setIsLoading(false);
    }
  };

  if (!currentChest) return null;

  const isLocked = currentChest.is_locked;
  const isOpen = currentChest.state === 'open' || currentChest.state === 'looted';
  const hasActiveTrap = currentChest.is_trapped && !currentChest.trap_disarmed && !currentChest.trap_triggered;
  const trapDetected = currentChest.trap_detected;

  const hasItems = (chestContents?.items?.length ?? 0) > 0;
  const hasCurrency = chestContents?.currency && (
    chestContents.currency.cp > 0 || chestContents.currency.sp > 0 ||
    chestContents.currency.ep > 0 || chestContents.currency.gp > 0 ||
    chestContents.currency.pp > 0
  );
  const isEmpty = !hasItems && !hasCurrency;

  // Filter characters: players can only loot to their own character, DM can choose any
  const availableCharacters = isDM
    ? characters
    : characters.filter(c => c.user_id === currentUserId);
  const selectedCharacter = availableCharacters.find(c => c.id === selectedCharacterId);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} {...{modal: false}}>
      <Dialog.Content aria-describedby={undefined} maxWidth="450px" className="bg-gray-900">
        <Dialog.Title>
          <Flex align="center" gap="3">
            {currentChest.avatar_url ? (
              <img src={currentChest.avatar_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-amber-900/50 flex items-center justify-center text-2xl">
                {isOpen ? '📭' : isLocked ? '🔒' : '📦'}
              </div>
            )}
            <div>
              <Text size="4" weight="bold">{currentChest.name}</Text>
              <Flex gap="2" mt="1">
                <span className={`px-2 py-0.5 rounded text-xs ${
                  isLocked ? 'bg-red-500/20 text-red-400' :
                  isOpen ? 'bg-green-500/20 text-green-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {isLocked ? '🔒 锁定' : isOpen ? '📬 已开' : '🔓 未锁'}
                </span>
                {hasActiveTrap && (
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    trapDetected ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-600/50 text-gray-400'
                  }`}>
                    {trapDetected ? '⚠️ 有陷阱' : '❓'}
                  </span>
                )}
                {currentChest.trap_disarmed && (
                  <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">✅ 已拆除</span>
                )}
              </Flex>
            </div>
          </Flex>
        </Dialog.Title>

        <Flex direction="column" gap="3" mt="4">
          {/* === OPEN CHEST VIEW === */}
          {isOpen && (
            <>
              {/* Contents */}
              <Box className="bg-gray-800/80 rounded-lg p-4">
                <Text size="2" weight="bold" className="text-amber-400 mb-3 block">宝箱内容</Text>

                {chestContents === null ? (
                  <Text size="2" color="gray">加载中...</Text>
                ) : isEmpty ? (
                  <Text size="2" color="gray" className="italic">宝箱已空</Text>
                ) : (
                  <Flex direction="column" gap="3">
                    {/* Currency */}
                    {hasCurrency && (
                      <Flex gap="3" wrap="wrap" className="pb-2 border-b border-gray-700">
                        {chestContents.currency.pp > 0 && (
                          <span className="flex items-center gap-1 text-sm">
                            <span className="w-4 h-4 rounded-full bg-purple-400 inline-block" />
                            <span className="text-purple-300">{chestContents.currency.pp} 铂金</span>
                          </span>
                        )}
                        {chestContents.currency.gp > 0 && (
                          <span className="flex items-center gap-1 text-sm">
                            <span className="w-4 h-4 rounded-full bg-amber-400 inline-block" />
                            <span className="text-amber-300">{chestContents.currency.gp} 金币</span>
                          </span>
                        )}
                        {chestContents.currency.ep > 0 && (
                          <span className="flex items-center gap-1 text-sm">
                            <span className="w-4 h-4 rounded-full bg-blue-300 inline-block" />
                            <span className="text-blue-300">{chestContents.currency.ep} 银电</span>
                          </span>
                        )}
                        {chestContents.currency.sp > 0 && (
                          <span className="flex items-center gap-1 text-sm">
                            <span className="w-4 h-4 rounded-full bg-gray-300 inline-block" />
                            <span className="text-gray-300">{chestContents.currency.sp} 银币</span>
                          </span>
                        )}
                        {chestContents.currency.cp > 0 && (
                          <span className="flex items-center gap-1 text-sm">
                            <span className="w-4 h-4 rounded-full bg-orange-600 inline-block" />
                            <span className="text-orange-400">{chestContents.currency.cp} 铜币</span>
                          </span>
                        )}
                      </Flex>
                    )}

                    {/* Items */}
                    {hasItems && (
                      <Flex direction="column" gap="2">
                        {chestContents.items.map((item, idx) => (
                          <Flex key={idx} align="center" gap="2" className="bg-gray-700/50 rounded px-2 py-1.5">
                            {item.avatar_url ? (
                              <img src={item.avatar_url} alt="" className="w-8 h-8 rounded" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-gray-600 flex items-center justify-center text-sm">📦</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <Text size="2" className="truncate block">{item.name_cn || item.name}</Text>
                              {item.rarity && (
                                <Text size="1" color="gray">{item.rarity}</Text>
                              )}
                            </div>
                            <Text size="2" color="gray" className="mr-1">x{item.quantity}</Text>
                            <Button
                              size="1"
                              variant="soft"
                              color="green"
                              disabled={isLoading || !selectedCharacterId}
                              onClick={() => handleLootItem(item)}
                            >
                              拿
                            </Button>
                          </Flex>
                        ))}
                      </Flex>
                    )}
                  </Flex>
                )}
              </Box>

              {/* Character & Loot Buttons */}
              {!isEmpty && (
                <Box>
                  {/* Only show character selector for DM with multiple characters */}
                  {isDM && availableCharacters.length > 1 && (
                    <>
                      <Text size="2" weight="bold" mb="2">拾取到</Text>
                      <select
                        value={selectedCharacterId ?? ''}
                        onChange={(e) => setSelectedCharacterId(Number(e.target.value))}
                        className="w-full mb-2 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white"
                      >
                        {availableCharacters.map(char => (
                          <option key={char.id} value={char.id}>{char.name}</option>
                        ))}
                      </select>
                    </>
                  )}
                  <Flex gap="2" wrap="wrap">
                    {hasCurrency && (
                      <Button
                        size="2"
                        variant="soft"
                        color="amber"
                        disabled={isLoading || !selectedCharacterId}
                        onClick={handleLootCurrency}
                        className="flex-1"
                      >
                        {isLoading ? '...' : '🪙 只拿金钱'}
                      </Button>
                    )}
                    <Button
                      size="2"
                      color="amber"
                      disabled={isLoading || !selectedCharacterId}
                      onClick={handleLootAll}
                      className="flex-1"
                    >
                      {isLoading ? '...' : '💰 全部拿走'}
                    </Button>
                  </Flex>
                </Box>
              )}
            </>
          )}

          {/* === CLOSED/LOCKED CHEST VIEW === */}
          {!isOpen && (
            <>
              {/* Character Selection */}
              <Box>
                <Text size="2" weight="bold" mb="2">选择角色</Text>
                <Flex gap="2" wrap="wrap">
                  {availableCharacters.map(char => (
                    <Button
                      key={char.id}
                      size="1"
                      variant={selectedCharacterId === char.id ? 'solid' : 'soft'}
                      onClick={() => setSelectedCharacterId(char.id)}
                    >
                      {char.name}
                    </Button>
                  ))}
                </Flex>
              </Box>

              {/* Roll Input - only for actions that need it */}
              {(isLocked || hasActiveTrap) && (
                <Box>
                  <Text size="2" weight="bold" mb="2">检定结果</Text>
                  <Flex gap="2" align="center">
                    <TextField.Root
                      type="number"
                      value={String(rollResult)}
                      onChange={(e) => setRollResult(parseInt(e.target.value) || 0)}
                      style={{ width: '80px' }}
                    />
                    <Text size="1" color="gray">（掷骰后填入）</Text>
                  </Flex>
                </Box>
              )}

              {/* Actions */}
              <Box>
                <Text size="2" weight="bold" mb="2">操作</Text>
                <Flex direction="column" gap="2">
                  {/* Investigate for trap */}
                  {currentChest.is_trapped && !trapDetected && (
                    <Button
                      size="2"
                      variant="soft"
                      color="blue"
                      disabled={isLoading || !selectedCharacterId}
                      onClick={() => handleAction('investigate')}
                      className="justify-start"
                    >
                      🔍 调查陷阱 (感知检定)
                    </Button>
                  )}

                  {/* Disarm trap */}
                  {trapDetected && hasActiveTrap && (
                    <Button
                      size="2"
                      variant="soft"
                      color="purple"
                      disabled={isLoading || !selectedCharacterId}
                      onClick={() => handleAction('disarm-trap')}
                      className="justify-start"
                    >
                      🛠️ 拆除陷阱 (DC {currentChest.trap_disarm_dc})
                    </Button>
                  )}

                  {/* Pick lock */}
                  {isLocked && !currentChest.requires_key && (
                    <Button
                      size="2"
                      variant="soft"
                      color="orange"
                      disabled={isLoading || !selectedCharacterId}
                      onClick={() => handleAction('pick-lock')}
                      className="justify-start"
                    >
                      🔓 撬锁 (DC {currentChest.lock_dc})
                    </Button>
                  )}

                  {/* Key required */}
                  {isLocked && currentChest.requires_key && (
                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
                      🔑 需要「{currentChest.key_name || '钥匙'}」才能打开
                    </div>
                  )}

                  {/* Open */}
                  {!isLocked && (
                    <Button
                      size="2"
                      variant="solid"
                      color="green"
                      disabled={isLoading || !selectedCharacterId}
                      onClick={() => handleAction('open')}
                      className="justify-start"
                    >
                      📦 打开宝箱
                      {hasActiveTrap && !trapDetected && (
                        <span className="ml-2 text-xs opacity-70">⚠️ 可能触发陷阱</span>
                      )}
                    </Button>
                  )}
                </Flex>
              </Box>
            </>
          )}

          {/* Message */}
          {message && (
            <Box className="bg-gray-800 rounded p-3">
              <Text size="2">{message}</Text>
            </Box>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">关闭</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
