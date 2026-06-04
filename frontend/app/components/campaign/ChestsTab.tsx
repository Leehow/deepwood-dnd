import React, { useEffect, useState } from 'react';
import { Text, Flex, Button, ScrollArea, Box } from '@radix-ui/themes';
import { AddChestModal } from './AddChestModal';
import { ChestInventoryModal } from './ChestInventoryModal';
import { EntityAvatarLibraryModal, type EntityAvatarOption } from './EntityAvatarLibraryModal';
import { TokenCard } from './ResourceLibrary/components';
import { subscribeAppEvent } from '~/events/appEventBus';
import { showGlobalToast } from "../ui/Toast";
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';
import { getViewportCenter, getCurrentMapUrl } from './ResourceLibrary/utils/helpers';

const logger = createLogger('ChestsTab');

export interface Chest {
  id: number;
  campaign_id: number;
  name: string;
  description?: string;
  appearance_description?: string;
  state: 'locked' | 'unlocked' | 'open' | 'looted';
  // Lock
  is_locked: boolean;
  lock_dc: number;
  requires_key: boolean;
  key_name?: string;
  // Trap
  is_trapped: boolean;
  trap_detected: boolean;
  trap_disarmed: boolean;
  trap_triggered: boolean;
  trap_type?: string;
  trap_detection_dc: number;
  trap_disarm_dc: number;
  trap_effect?: {
    damage?: string;
    damage_type?: string;
    save_dc?: number;
    save_ability?: string;
    effect_text?: string;
  };
  // Currency
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
  // Avatar
  avatar_url?: string;
  avatar_url_large?: string;
  has_avatar: boolean;
}

interface ChestsTabProps {
  campaignId: string;
  currentMapUrl?: string;
}

export function ChestsTab({ campaignId, currentMapUrl }: ChestsTabProps) {
  const [chests, setChests] = useState<Chest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddChestModal, setShowAddChestModal] = useState(false);
  const [addChestDefaultTab, setAddChestDefaultTab] = useState<'manual' | 'ai'>('manual');
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [selectedChest, setSelectedChest] = useState<Chest | null>(null);
  const [showAvatarLibraryModal, setShowAvatarLibraryModal] = useState(false);
  const [selectedChestForAvatarLibrary, setSelectedChestForAvatarLibrary] = useState<Chest | null>(null);

  const [generatingAvatarId, setGeneratingAvatarId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Chest map tokens
  const [chestMapTokens, setChestMapTokens] = useState<any[]>([]);
  const [chestTokensCollapsed, setChestTokensCollapsed] = useState(true);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    showGlobalToast({ message, type });
  };

  const loadChests = async () => {
    if (!campaignId) return;
    setIsLoading(true);
    try {
      const resp = await apiFetch(`/api/chests/campaign/${campaignId}`);
      if (resp.ok) {
        const data = await resp.json();
        setChests((data || []).sort((a: Chest, b: Chest) => b.id - a.id));
      }
    } catch (e) {
      logger.error('[ChestsTab] loadChests error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChests();
  }, [campaignId]);

  // Listen for chest created event (from monster conversion)
  useEffect(() => {
    const handleChestCreated = () => {
      loadChests();
    };
    return subscribeAppEvent('chestCreated', handleChestCreated);
  }, [campaignId]);

  // Load chest tokens from map
  const loadChestTokens = async () => {
    if (!campaignId || !currentMapUrl) return;
    setIsLoadingTokens(true);
    try {
      const resp = await apiFetch(`/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`);
      if (resp.ok) {
        const data = await resp.json();
        const tokens = (data.tokens || []).filter((t: any) => t.chest_id != null);
        setChestMapTokens(tokens);
      }
    } catch (e) {
      logger.error('[ChestsTab] loadChestTokens error:', e);
    } finally {
      setIsLoadingTokens(false);
    }
  };

  useEffect(() => {
    loadChestTokens();
  }, [campaignId, currentMapUrl]);

  const handlePlaceChestToken = async (chestId: number, tokenSize: string = '1x1') => {
    try {
      const { x: posX, y: posY } = getViewportCenter();
      const mapUrl = getCurrentMapUrl();

      const chest = chests.find(c => c.id === chestId);
      if (!chest) return;

      const resp = await apiFetch('/api/tokens/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          map_url: mapUrl,
          position_x: posX,
          position_y: posY,
          token_size: tokenSize,
          instance_name: chest.name,
          chest_id: chest.id,
        }),
      });

      if (resp.ok) {
        showToast(`已将宝箱放置到地图`, 'success');
        loadChestTokens();
      } else {
        showToast('放置宝箱失败', 'error');
      }
    } catch (e) {
      logger.error('[ChestsTab] place token error:', e);
      showToast('放置宝箱失败', 'error');
    }
  };

  const handleGenerateAvatar = async (chest: Chest) => {
    try {
      setGeneratingAvatarId(chest.id);
      const resp = await apiFetch(`/api/chests/${chest.id}/generate-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (resp.ok) {
        showToast('头像已生成', 'success');
        await loadChests();
      } else {
        const txt = await resp.text();
        showToast(`生成头像失败: ${txt}`, 'error');
      }
    } catch (e) {
      logger.error('[ChestsTab] generate avatar error:', e);
      showToast('生成头像失败', 'error');
    } finally {
      setGeneratingAvatarId(null);
    }
  };

  const handleOpenAvatarLibrary = (chest: Chest) => {
    setSelectedChestForAvatarLibrary(chest);
    setShowAvatarLibraryModal(true);
  };

  const handleSelectChestAvatarFromLibrary = async (avatar: EntityAvatarOption) => {
    if (!selectedChestForAvatarLibrary) return;

    try {
      const resp = await apiFetch(`/api/chests/${selectedChestForAvatarLibrary.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatar_url: avatar.avatar_url,
          avatar_url_large: avatar.avatar_url_large || avatar.avatar_url,
          has_avatar: true,
        }),
      });
      if (!resp.ok) throw new Error('Failed to update chest avatar');
      showToast('已从图库应用宝箱图片', 'success');
      await loadChests();
    } catch (error) {
      logger.error('[ChestsTab] select avatar from library error:', error);
      showToast('应用宝箱图片失败', 'error');
      throw error;
    }
  };

  const handleDeleteChest = async (chestId: number) => {
    if (confirmDeleteId === chestId) {
      setConfirmDeleteId(null);
      try {
        const resp = await apiFetch(`/api/chests/${chestId}`, { method: 'DELETE' });
        if (resp.ok) {
          showToast('宝箱已删除', 'success');
          loadChests();
        } else {
          showToast('删除失败', 'error');
        }
      } catch (e) {
        logger.error('[ChestsTab] delete error:', e);
        showToast('删除失败', 'error');
      }
    } else {
      setConfirmDeleteId(chestId);
      setTimeout(() => setConfirmDeleteId(null), 3000);
    }
  };

  const handleFocusToken = (tokenId: number, position: { x: number; y: number }) => {
    const focusFunction = (window as any).__focusToken;
    if (focusFunction) {
      focusFunction(tokenId, position);
    }
  };

  const handleDeleteToken = async (tokenId: number) => {
    try {
      const resp = await apiFetch(`/api/tokens/${tokenId}`, { method: 'DELETE' });
      if (resp.ok) {
        loadChestTokens();
        showToast('Token已删除', 'success');
      } else {
        showToast('删除Token失败', 'error');
      }
    } catch (e) {
      logger.error('[ChestsTab] delete token error:', e);
      showToast('删除Token失败', 'error');
    }
  };

  const getStateIcon = (chest: Chest) => {
    if (chest.state === 'looted') return '📭';
    if (chest.state === 'open') return '📬';
    if (chest.is_locked) return '🔒';
    return '📦';
  };

  const getStateText = (chest: Chest) => {
    if (chest.state === 'looted') return '已清空';
    if (chest.state === 'open') return '已打开';
    if (chest.is_locked) return '已锁定';
    return '未锁定';
  };

  const getTotalCurrency = (chest: Chest) => {
    const total = (chest.cp || 0) * 0.01 +
                  (chest.sp || 0) * 0.1 +
                  (chest.ep || 0) * 0.5 +
                  (chest.gp || 0) +
                  (chest.pp || 0) * 10;
    return total.toFixed(1);
  };

  return (
    <Flex direction="column" gap="3" style={{ height: '100%' }}>
      <Flex gap="1">
        <Button size="1" variant="soft" onClick={() => { setAddChestDefaultTab('manual'); setShowAddChestModal(true); }}>+新建宝箱</Button>
        <Button size="1" variant="soft" color="purple" onClick={() => { setAddChestDefaultTab('ai'); setShowAddChestModal(true); }}>✨ AI生成</Button>
      </Flex>

      <ScrollArea style={{ height: '100%' }}>
        <Flex direction="column" gap="2">
          {/* Map Tokens Section */}
          {currentMapUrl && (
            <Box className="border-b border-amber-700 pb-3 mb-2">
              <Flex
                align="center"
                justify="between"
                className="cursor-pointer select-none pr-4"
                onClick={() => setChestTokensCollapsed(!chestTokensCollapsed)}
              >
                <Text size="2" weight="bold" color="amber">
                  🗺️ 地图上的宝箱 ({chestMapTokens.length})
                </Text>
                <Text size="1" color="gray">{chestTokensCollapsed ? '▶' : '▼'}</Text>
              </Flex>
              {!chestTokensCollapsed && (
                isLoadingTokens ? (
                  <Text size="2" color="gray" className="mt-2">加载中...</Text>
                ) : chestMapTokens.length > 0 ? (
                  <Flex direction="column" gap="2" className="mt-2">
                    {chestMapTokens.map(token => (
                      <TokenCard
                        key={token.id}
                        token={token}
                        onFocus={handleFocusToken}
                        onDelete={handleDeleteToken}
                      />
                    ))}
                  </Flex>
                ) : (
                  <Text size="1" color="gray" className="mt-2">地图上没有宝箱Token</Text>
                )
              )}
            </Box>
          )}

          {isLoading && <Text size="2" color="gray">加载中...</Text>}
          {!isLoading && chests.length === 0 && (
            <Text size="2" color="gray">暂无宝箱，点击"新建宝箱"创建。</Text>
          )}

          {chests.map((chest) => (
            <div
              key={chest.id}
              className="group relative bg-gradient-to-br from-gray-800/80 to-gray-900/80 rounded-lg border border-amber-500/20 hover:border-amber-500/50 transition-all duration-200 cursor-pointer overflow-hidden"
              onClick={() => { setSelectedChest(chest); setShowInventoryModal(true); }}
            >
              <Flex gap="3" p="3">
                {/* Avatar */}
                <div className="flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-gray-700/50 border border-gray-600/50 flex items-center justify-center">
                  {chest.avatar_url ? (
                    <img src={chest.avatar_url} alt={chest.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl opacity-50">{getStateIcon(chest)}</span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <Flex justify="between" align="start">
                    <div className="min-w-0 flex-1">
                      <Text size="2" weight="bold" className="text-amber-200 truncate block">{chest.name}</Text>
                      <Flex gap="1" mt="1" wrap="wrap">
                        {/* State */}
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                          chest.state === 'locked' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                          chest.state === 'unlocked' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                          chest.state === 'open' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                          'bg-gray-500/20 text-gray-400 border-gray-500/30'
                        }`}>
                          {getStateIcon(chest)} {getStateText(chest)}
                        </span>

                        {/* Lock DC */}
                        {chest.is_locked && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">
                            🔐 DC{chest.lock_dc}
                          </span>
                        )}

                        {/* Trap */}
                        {chest.is_trapped && !chest.trap_disarmed && !chest.trap_triggered && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                            chest.trap_detected
                              ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                              : 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                          }`}>
                            {chest.trap_detected ? '⚠️ 陷阱' : '❓ 陷阱?'}
                          </span>
                        )}
                        {chest.trap_disarmed && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                            ✅ 已拆除
                          </span>
                        )}

                        {/* Currency */}
                        {parseFloat(getTotalCurrency(chest)) > 0 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                            💰 ~{getTotalCurrency(chest)}gp
                          </span>
                        )}
                      </Flex>
                    </div>

                    {/* Action buttons */}
                    <Flex gap="1" className="flex-shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="w-7 h-7 rounded flex items-center justify-center bg-sky-500/20 hover:bg-sky-500/40 text-sky-300 transition-colors"
                        title="从图库选择图片"
                        onClick={() => handleOpenAvatarLibrary(chest)}
                      >
                        🖼
                      </button>
                      <button
                        className="w-7 h-7 rounded flex items-center justify-center bg-purple-500/20 hover:bg-purple-500/40 text-purple-400 transition-colors disabled:opacity-50"
                        title={chest.avatar_url ? "重新生成头像" : "生成头像"}
                        disabled={generatingAvatarId === chest.id}
                        onClick={() => handleGenerateAvatar(chest)}
                      >
                        {generatingAvatarId === chest.id ? <span className="animate-spin">⏳</span> : '🎨'}
                      </button>
                      <button
                        className="w-7 h-7 rounded flex items-center justify-center bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 transition-colors"
                        title="放置到地图"
                        onClick={() => handlePlaceChestToken(chest.id)}
                      >
                        📍
                      </button>
                      <button
                        className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                          confirmDeleteId === chest.id
                            ? 'bg-red-500 text-white animate-pulse'
                            : 'bg-red-500/20 hover:bg-red-500/40 text-red-400'
                        }`}
                        title={confirmDeleteId === chest.id ? '再次点击确认删除' : '删除宝箱'}
                        onClick={() => handleDeleteChest(chest.id)}
                      >
                        {confirmDeleteId === chest.id ? '!' : '🗑'}
                      </button>
                    </Flex>
                  </Flex>

                  {chest.description && (
                    <Text size="1" className="text-gray-400 mt-1.5 line-clamp-2">{chest.description}</Text>
                  )}
                </div>
              </Flex>

              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          ))}
        </Flex>
      </ScrollArea>

      <AddChestModal
        open={showAddChestModal}
        onOpenChange={setShowAddChestModal}
        campaignId={campaignId}
        onChestAdded={loadChests}
        defaultTab={addChestDefaultTab}
      />

      <ChestInventoryModal
        open={showInventoryModal}
        onOpenChange={(o) => { setShowInventoryModal(o); if (!o) setSelectedChest(null); }}
        campaignId={campaignId}
        chest={selectedChest}
        onUpdated={loadChests}
      />

      {selectedChestForAvatarLibrary && (
        <EntityAvatarLibraryModal
          open={showAvatarLibraryModal}
          onClose={() => {
            setShowAvatarLibraryModal(false);
            setSelectedChestForAvatarLibrary(null);
          }}
          title={`选择宝箱图片 - ${selectedChestForAvatarLibrary.name}`}
          fetchPath={`/api/chests/avatar-library?campaign_id=${campaignId}`}
          onSelect={handleSelectChestAvatarFromLibrary}
          emptyText="宝箱图库里还没有可复用的图片"
          imageFit="cover"
        />
      )}
    </Flex>
  );
}
