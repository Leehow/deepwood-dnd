import React, { useEffect, useState } from 'react';
import { Card, Text, Flex, Box, Badge, Button, ScrollArea } from '@radix-ui/themes';
import { AddShopModal } from './AddShopModal';
import { AddCustomShopModal } from './AddCustomShopModal';
import { ShopInventoryModal } from './ShopInventoryModal';
import { ShopTransactionModal } from './ShopTransactionModal';
import { ShopTokenPlacementModal } from './ShopTokenPlacementModal';
import { EntityAvatarLibraryModal, type EntityAvatarOption } from './EntityAvatarLibraryModal';
import { TokenCard } from './ResourceLibrary/components';
import { showGlobalToast } from "../ui/Toast";
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';
const logger = createLogger('ShopsTab');


interface Shop {
  id: number;
  campaign_id: number;
  name: string;
  description?: string;
  appearance_description?: string;
  gold_gp: number;
  accepts_selling: boolean;
  discount_rate: number;
  avatar_url?: string;
  avatar_url_large?: string;
  has_avatar: boolean;
}

export function ShopsTab({ campaignId, currentMapUrl }: { campaignId: string; currentMapUrl?: string }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddShopModal, setShowAddShopModal] = useState(false);
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [showTxnModal, setShowTxnModal] = useState(false);
  const [txnShop, setTxnShop] = useState<Shop | null>(null);
  const [showTokenPlacementModal, setShowTokenPlacementModal] = useState(false);
  const [tokenPlacementShop, setTokenPlacementShop] = useState<Shop | null>(null);
  const [showAvatarLibraryModal, setShowAvatarLibraryModal] = useState(false);
  const [selectedShopForAvatarLibrary, setSelectedShopForAvatarLibrary] = useState<Shop | null>(null);

  const [generatingAvatarId, setGeneratingAvatarId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [showAddCustomShopModal, setShowAddCustomShopModal] = useState(false);

  // Shop map tokens state - default to collapsed
  const [shopMapTokens, setShopMapTokens] = useState<any[]>([]);
  const [shopTokensCollapsed, setShopTokensCollapsed] = useState(true);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    showGlobalToast({ message, type });
  };

  const loadShops = async () => {
    if (!campaignId) return;
    setIsLoading(true);
    try {
      const resp = await apiFetch(`/api/shops/campaign/${campaignId}`);
      if (resp.ok) {
        const data = await resp.json();
        setShops((data || []).sort((a: Shop, b: Shop) => b.id - a.id));
      }
    } catch (e) {
      logger.error('[ShopsTab] loadShops error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenAvatarLibrary = (shop: Shop) => {
    setSelectedShopForAvatarLibrary(shop);
    setShowAvatarLibraryModal(true);
  };

  const handleSelectShopAvatarFromLibrary = async (avatar: EntityAvatarOption) => {
    if (!selectedShopForAvatarLibrary) return;

    try {
      const resp = await apiFetch(`/api/shops/${selectedShopForAvatarLibrary.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatar_url: avatar.avatar_url,
          avatar_url_large: avatar.avatar_url_large || avatar.avatar_url,
          has_avatar: true,
        }),
      });
      if (!resp.ok) throw new Error('Failed to update shop avatar');
      showToast('已从图库应用商店图片', 'success');
      await loadShops();
    } catch (error) {
      logger.error('[ShopsTab] select avatar from library error:', error);
      showToast('应用商店图片失败', 'error');
      throw error;
    }
  };

  useEffect(() => {
    loadShops();
  }, [campaignId]);

  // Load shop tokens from the map
  const loadShopTokens = async () => {
    if (!campaignId || !currentMapUrl) return;
    setIsLoadingTokens(true);
    try {
      const resp = await apiFetch(`/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`);
      if (resp.ok) {
        const data = await resp.json();
        const tokens = (data.tokens || []).filter((t: any) => t.shop_id != null);
        setShopMapTokens(tokens);
      }
    } catch (e) {
      logger.error('[ShopsTab] loadShopTokens error:', e);
    } finally {
      setIsLoadingTokens(false);
    }
  };

  useEffect(() => {
    loadShopTokens();
  }, [campaignId, currentMapUrl]);

  const handlePlaceShopToken = async (shopId: number, tokenSize: string) => {
    try {
      // Get viewport center position
      let posX = 5, posY = 5;
      if (typeof (window as any).__getViewportCenterGridPosition === 'function') {
        const center = (window as any).__getViewportCenterGridPosition();
        posX = center.x;
        posY = center.y;
      }
      // Determine correct map_url
      let mapUrl: string = currentMapUrl || 'current';
      if (typeof (window as any).__getCurrentMapUrl === 'function') {
        mapUrl = (window as any).__getCurrentMapUrl() || mapUrl;
      }

      const shop = shops.find(s => s.id === shopId);
      if (!shop) return;

      const resp = await apiFetch('/api/tokens/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          map_url: mapUrl,
          position_x: posX,
          position_y: posY,
          token_size: tokenSize,
          instance_name: shop.name,
          shop_id: shop.id,
        }),
      });
      if (resp.ok) {
        showToast(`已将商店生成到地图中心 (${tokenSize})`, 'success');
        loadShopTokens(); // Refresh shop tokens
      } else {
        showToast('生成商店Token失败', 'error');
      }
    } catch (e) {
      logger.error('[ShopsTab] place token error:', e);
      showToast('生成商店Token失败', 'error');
    }
  };


  const handleGenerateShopAvatar = async (shop: Shop) => {
    try {
      setGeneratingAvatarId(shop.id);
      const resp = await apiFetch(`/api/shops/${shop.id}/generate-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.has_avatar && data.avatar_url) {
          showToast('头像已生成', 'success');
        } else {
          showToast('头像生成完成，但返回数据异常', 'info');
        }
        await loadShops();
      } else {
        const txt = await resp.text();
        showToast(`生成头像失败: ${txt}`, 'error');
      }
    } catch (e) {
      logger.error('[ShopsTab] generate avatar error:', e);
      showToast('生成头像失败', 'error');
    } finally {
      setGeneratingAvatarId(null);
    }
  };


  const handleDeleteShop = async (shopId: number) => {
    if (confirmDeleteId === shopId) {
      // Second click - actually delete
      setConfirmDeleteId(null);
      try {
        const resp = await apiFetch(`/api/shops/${shopId}`, { method: 'DELETE' });
        if (resp.ok) {
          showToast('商店已删除', 'success');
          loadShops();
        } else {
          showToast('删除失败', 'error');
        }
      } catch (e) {
        logger.error('[ShopsTab] delete error:', e);
        showToast('删除失败', 'error');
      }
    } else {
      // First click - show confirmation
      setConfirmDeleteId(shopId);
      setTimeout(() => setConfirmDeleteId(null), 3000);
    }
  };

  // Token handlers
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
        loadShopTokens();
        showToast('Token已删除', 'success');
      } else {
        showToast('删除Token失败', 'error');
      }
    } catch (e) {
      logger.error('[ShopsTab] delete token error:', e);
      showToast('删除Token失败', 'error');
    }
  };

  return (
    <Flex direction="column" gap="3" style={{ height: '100%' }}>
      <Flex gap="1">
        <Button size="1" variant="soft" onClick={() => setShowAddShopModal(true)}>+预设</Button>
        <Button size="1" variant="soft" color="gray" onClick={() => setShowAddCustomShopModal(true)}>+自定义</Button>
      </Flex>

      <ScrollArea style={{ height: '100%' }}>
        <Flex direction="column" gap="2">
          {/* Shop Map Tokens Section - Collapsible */}
          {currentMapUrl && (
            <Box className="border-b border-green-700 pb-3 mb-2">
              <Flex
                align="center"
                justify="between"
                className="cursor-pointer select-none pr-4"
                onClick={() => setShopTokensCollapsed(!shopTokensCollapsed)}
              >
                <Text size="2" weight="bold" color="green">
                  🗺️ 地图上的商店 ({shopMapTokens.length})
                </Text>
                <Text size="1" color="gray">{shopTokensCollapsed ? '▶' : '▼'}</Text>
              </Flex>
              {!shopTokensCollapsed && (
                isLoadingTokens ? (
                  <Text size="2" color="gray" className="mt-2">加载中...</Text>
                ) : shopMapTokens.length > 0 ? (
                  <Flex direction="column" gap="2" className="mt-2">
                    {shopMapTokens.map(token => (
                      <TokenCard
                        key={token.id}
                        token={token}
                        onFocus={handleFocusToken}
                        onDelete={handleDeleteToken}
                      />
                    ))}
                  </Flex>
                ) : (
                  <Text size="1" color="gray" className="mt-2">地图上没有商店Token</Text>
                )
              )}
            </Box>
          )}

          {isLoading && <Text size="2" color="gray">加载中...</Text>}
          {!isLoading && shops.length === 0 && (
            <Text size="2" color="gray">暂无商店，点击“添加商店”创建。</Text>
          )}

          {shops.map((shop) => (
            <div
              key={shop.id}
              className="group relative bg-gradient-to-br from-gray-800/80 to-gray-900/80 rounded-lg border border-amber-500/20 hover:border-amber-500/50 transition-all duration-200 cursor-pointer overflow-hidden"
              onClick={() => { setSelectedShop(shop); setShowInventoryModal(true); }}
            >
              {/* 主内容区 */}
              <Flex gap="3" p="3">
                {/* 左侧头像 */}
                <div className="flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-gray-700/50 border border-gray-600/50 flex items-center justify-center">
                  {shop.avatar_url ? (
                    <img src={shop.avatar_url} alt={shop.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl opacity-50">🏪</span>
                  )}
                </div>

                {/* 右侧信息 */}
                <div className="flex-1 min-w-0">
                  <Flex justify="between" align="start">
                    <div className="min-w-0 flex-1">
                      <Text size="2" weight="bold" className="text-amber-200 truncate block">{shop.name}</Text>
                      <Flex gap="1" mt="1" wrap="wrap">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                          💰 {shop.gold_gp}gp
                        </span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                          {(shop.discount_rate * 100).toFixed(0)}%折扣
                        </span>
                        {shop.accepts_selling && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                            可回收
                          </span>
                        )}
                      </Flex>
                    </div>

                    {/* 操作按钮组 */}
                    <Flex gap="1" className="flex-shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="w-7 h-7 rounded flex items-center justify-center bg-sky-500/20 hover:bg-sky-500/40 text-sky-300 transition-colors"
                        title="从图库选择图片"
                        onClick={() => handleOpenAvatarLibrary(shop)}
                      >
                        🖼
                      </button>
                      {!shop.avatar_url && (
                        <button
                          className="w-7 h-7 rounded flex items-center justify-center bg-purple-500/20 hover:bg-purple-500/40 text-purple-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="生成头像"
                          disabled={generatingAvatarId === shop.id}
                          onClick={() => handleGenerateShopAvatar(shop)}
                        >
                          {generatingAvatarId === shop.id ? <span className="animate-spin">⏳</span> : '🎨'}
                        </button>
                      )}
                      <button
                        className="w-7 h-7 rounded flex items-center justify-center bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 transition-colors"
                        title="生成到地图"
                        onClick={() => { setTokenPlacementShop(shop); setShowTokenPlacementModal(true); }}
                      >
                        📍
                      </button>
                      <button
                        className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                          confirmDeleteId === shop.id
                            ? 'bg-red-500 text-white animate-pulse'
                            : 'bg-red-500/20 hover:bg-red-500/40 text-red-400'
                        }`}
                        title={confirmDeleteId === shop.id ? '再次点击确认删除' : '删除商店'}
                        onClick={() => handleDeleteShop(shop.id)}
                      >
                        {confirmDeleteId === shop.id ? '!' : '🗑'}
                      </button>
                    </Flex>
                  </Flex>

                  {/* 描述 */}
                  {shop.description && (
                    <Text size="1" className="text-gray-400 mt-1.5 line-clamp-2">{shop.description}</Text>
                  )}
                </div>
              </Flex>

              {/* 点击提示 */}
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          ))}
        </Flex>
      </ScrollArea>

      <AddShopModal
        open={showAddShopModal}
        onOpenChange={setShowAddShopModal}
        campaignId={campaignId}
        onShopAdded={loadShops}
      />

      <AddCustomShopModal
        open={showAddCustomShopModal}
        onOpenChange={setShowAddCustomShopModal}
        campaignId={campaignId}
        onCreated={() => {
          loadShops();
          showToast('自定义商店已创建', 'success');
        }}
      />

      <ShopInventoryModal
        open={showInventoryModal}
        onOpenChange={(o)=>{ setShowInventoryModal(o); if(!o){ setSelectedShop(null); } }}
        campaignId={campaignId}
        shop={selectedShop}
        onUpdated={loadShops}
      />

      <ShopTransactionModal
        open={showTxnModal}
        onOpenChange={(o)=>{ setShowTxnModal(o); if(!o){ setTxnShop(null); } }}
        shop={txnShop ? { id: txnShop.id, name: txnShop.name, discount_rate: txnShop.discount_rate, accepts_selling: txnShop.accepts_selling, campaign_id: txnShop.campaign_id } : null}
        campaignId={campaignId}
        isDM={true}
      />

      <ShopTokenPlacementModal
        open={showTokenPlacementModal}
        onOpenChange={(o) => { setShowTokenPlacementModal(o); if (!o) setTokenPlacementShop(null); }}
        shop={tokenPlacementShop}
        onPlace={handlePlaceShopToken}
      />

      {selectedShopForAvatarLibrary && (
        <EntityAvatarLibraryModal
          open={showAvatarLibraryModal}
          onClose={() => {
            setShowAvatarLibraryModal(false);
            setSelectedShopForAvatarLibrary(null);
          }}
          title={`选择商店图片 - ${selectedShopForAvatarLibrary.name}`}
          fetchPath={`/api/shops/avatar-library?campaign_id=${campaignId}`}
          onSelect={handleSelectShopAvatarFromLibrary}
          emptyText="商店图库里还没有可复用的图片"
          imageFit="cover"
        />
      )}
    </Flex>
  );
}
