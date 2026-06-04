import { Dialog, Flex, Button, Text, Box, Card, Badge, ScrollArea, TextArea } from '@radix-ui/themes';
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';
const logger = createLogger('AvatarSelectionModal');


interface MonsterAvatar {
  id: number;
  monster_id: string | null;
  monster_name: string | null;
  avatar_url: string;
  avatar_url_large: string | null;
  created_by: string | null;
  created_at: string;
  usage_count: number;
}

interface AvatarSelectionModalProps {
  open: boolean;
  onClose: () => void;
  monsterId: string;
  monsterName: string;
  monsterAppearance?: string;
  onSelectExisting: (avatarUrl: string, avatarUrlLarge: string | null, avatarId: number) => void;
  onGenerateNew: (appearanceDescription?: string) => void;
  isGenerating?: boolean;
}

export function AvatarSelectionModal({
  open,
  onClose,
  monsterId,
  monsterName,
  monsterAppearance,
  onSelectExisting,
  onGenerateNew,
  isGenerating = false
}: AvatarSelectionModalProps) {
  const [avatars, setAvatars] = useState<MonsterAvatar[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState<number | null>(null);
  const [appearance, setAppearance] = useState('');
  const [isExpanding, setIsExpanding] = useState(false);

  useEffect(() => {
    if (open && monsterName) {
      loadAvatars();
      setAppearance(monsterAppearance || '');
    }
  }, [open, monsterName]);

  const loadAvatars = async () => {
    setLoading(true);
    try {
      // Use by-name API for better avatar reuse across same monster types
      const encodedName = encodeURIComponent(monsterName);
      const response = await apiFetch(`/api/monster-avatars/library/by-name/${encodedName}`);
      if (response.ok) {
        const data = await response.json();
        setAvatars(data.avatars || []);
      }
    } catch (error) {
      logger.error('[AvatarSelection] Error loading avatars:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExpandAppearance = async () => {
    const input = appearance.trim() || monsterName;
    if (!input) return;

    setIsExpanding(true);
    try {
      const response = await apiFetch('/api/ai-settings/expand-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: input,
          entity_type: 'avatar_appearance',
          random: false,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.expanded_description) {
          setAppearance(data.expanded_description);
        }
      }
    } catch (error) {
      logger.error('[AvatarSelection] Error expanding appearance:', error);
    } finally {
      setIsExpanding(false);
    }
  };

  const handleSelectAvatar = (avatar: MonsterAvatar) => {
    setSelectedAvatarId(avatar.id);
  };

  const handleConfirmSelection = () => {
    const selected = avatars.find(a => a.id === selectedAvatarId);
    if (selected) {
      onSelectExisting(selected.avatar_url, selected.avatar_url_large, selected.id);
      onClose();
    }
  };

  const handleGenerateNew = () => {
    onGenerateNew(appearance.trim() || undefined);
  };

  const handleDeleteAvatar = useCallback(async (e: React.MouseEvent, avatarId: number) => {
    e.stopPropagation();
    if (!confirm('确定删除此头像？')) return;
    try {
      const resp = await apiFetch(`/api/monster-avatars/library/${avatarId}`, { method: 'DELETE' });
      if (resp.ok) {
        setAvatars(prev => prev.filter(a => a.id !== avatarId));
        if (selectedAvatarId === avatarId) setSelectedAvatarId(null);
      }
    } catch (err) {
      logger.error('Delete avatar failed:', err);
    }
  }, [selectedAvatarId]);

  return (
    <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 700 }}>
        <Dialog.Title><span>选择怪物头像 - {monsterName}</span></Dialog.Title>
        <Dialog.Description size="2" mb="4">
          {avatars.length > 0 ? (
            <Text color="amber">
              <span>建议：使用已有头像更快！共有 {avatars.length} 个可用头像</span>
            </Text>
          ) : (
            <Text><span>暂无可用头像，请生成新头像</span></Text>
          )}
        </Dialog.Description>

        <Flex direction="column" gap="4">
          {/* Existing Avatars */}
          {loading ? (
            <Text><span>加载中...</span></Text>
          ) : avatars.length > 0 ? (
            <Box>
              <Text size="2" weight="bold" mb="2"><span>已有头像库</span></Text>
              <ScrollArea style={{ maxHeight: 300 }}>
                <Flex direction="column" gap="2">
                  {avatars.map(avatar => (
                    <Card
                      key={avatar.id}
                      style={{
                        cursor: 'pointer',
                        position: 'relative',
                        border: selectedAvatarId === avatar.id ? '2px solid var(--amber-9)' : '1px solid var(--gray-6)',
                        backgroundColor: selectedAvatarId === avatar.id ? 'var(--amber-2)' : undefined
                      }}
                      onClick={() => handleSelectAvatar(avatar)}
                    >
                      <Flex gap="3" align="center">
                        <Box style={{ width: 80, height: 80, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                          <img
                            src={avatar.avatar_url}
                            alt={monsterName}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </Box>
                        <Flex direction="column" gap="1" style={{ flex: 1 }}>
                          <Flex gap="2" align="center">
                            <Badge color="green"><span>使用 {avatar.usage_count} 次</span></Badge>
                            {avatar.created_by && (
                              <Text size="1" color="gray"><span>创建者: {avatar.created_by}</span></Text>
                            )}
                          </Flex>
                          <Text size="1" color="gray">
                            <span>创建时间: {new Date(avatar.created_at).toLocaleDateString('zh-CN')}</span>
                          </Text>
                        </Flex>
                        {selectedAvatarId === avatar.id && <Text size="5"><span>✓</span></Text>}
                        <button
                          onClick={(e) => handleDeleteAvatar(e, avatar.id)}
                          style={{
                            position: 'absolute', top: 6, right: 6,
                            width: 22, height: 22, borderRadius: '50%',
                            background: 'rgba(239,68,68,0.8)', border: 'none',
                            color: '#fff', fontSize: 13, lineHeight: '22px',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                          title="删除此头像"
                        >✕</button>
                      </Flex>
                    </Card>
                  ))}
                </Flex>
              </ScrollArea>
            </Box>
          ) : null}

          {/* Appearance Description for AI Generation */}
          <Box>
            <Flex align="center" justify="between" mb="1">
              <Text size="2" weight="bold"><span>外观描述（用于AI生成头像）</span></Text>
              <Button
                size="1"
                variant="soft"
                color="cyan"
                onClick={handleExpandAppearance}
                disabled={isExpanding || isGenerating}
              >
                <span>{isExpanding ? '扩展中...' : 'AI扩展描述'}</span>
              </Button>
            </Flex>
            <Text size="1" color="gray" mb="2" as="p">
              <span>输入简短描述（如"战锤蓝恐魔"），点击"AI扩展"自动生成详细视觉描述，效果更好</span>
            </Text>
            <TextArea
              value={appearance}
              onChange={(e) => setAppearance(e.target.value)}
              placeholder={`描述 ${monsterName} 的外观特征...`}
              rows={3}
              style={{ fontSize: 13 }}
              disabled={isGenerating}
            />
          </Box>

          {/* Action Buttons */}
          <Flex gap="3" mt="2" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                <span>取消</span>
              </Button>
            </Dialog.Close>

            {avatars.length > 0 && (
              <Button
                variant="soft"
                color="green"
                disabled={!selectedAvatarId}
                onClick={handleConfirmSelection}
              >
                <span>使用选中的头像</span>
              </Button>
            )}

            <Button
              variant="solid"
              color="purple"
              onClick={handleGenerateNew}
              disabled={isGenerating || isExpanding}
            >
              <span>{isGenerating ? '生成中...' : 'AI生成新头像'}</span>
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
