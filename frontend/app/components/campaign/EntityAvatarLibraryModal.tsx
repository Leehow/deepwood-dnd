import { useEffect, useMemo, useState } from 'react';
import { Dialog, Flex, Box, Text, Button, Card, ScrollArea } from '@radix-ui/themes';
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';

const logger = createLogger('EntityAvatarLibraryModal');

export interface EntityAvatarOption {
  id: number;
  name?: string | null;
  avatar_url: string;
  avatar_url_large?: string | null;
  campaign_id?: number;
  created_at?: string | null;
}

interface EntityAvatarLibraryModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  fetchPath: string;
  onSelect: (avatar: EntityAvatarOption) => Promise<void> | void;
  emptyText?: string;
  imageFit?: 'cover' | 'contain';
}

export function EntityAvatarLibraryModal({
  open,
  onClose,
  title,
  fetchPath,
  onSelect,
  emptyText = '图库里还没有可复用的图片',
  imageFit = 'cover',
}: EntityAvatarLibraryModalProps) {
  const [avatars, setAvatars] = useState<EntityAvatarOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedAvatarId(null);
      return;
    }

    let disposed = false;
    const loadAvatars = async () => {
      setLoading(true);
      try {
        const response = await apiFetch(fetchPath);
        if (!response.ok) throw new Error(`Failed to load avatar library: ${response.status}`);
        const data = await response.json();
        if (disposed) return;
        const entries = Array.isArray(data) ? data : [];
        setAvatars(entries.sort((a, b) => (b?.id || 0) - (a?.id || 0)));
      } catch (error) {
        logger.error('[EntityAvatarLibraryModal] load avatars failed:', error);
        if (!disposed) setAvatars([]);
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    loadAvatars();
    return () => {
      disposed = true;
    };
  }, [open, fetchPath]);

  const selectedAvatar = useMemo(
    () => avatars.find((avatar) => avatar.id === selectedAvatarId) || null,
    [avatars, selectedAvatarId]
  );

  const handleConfirm = async () => {
    if (!selectedAvatar || submitting) return;
    setSubmitting(true);
    try {
      await onSelect(selectedAvatar);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 760 }}>
        <Dialog.Title>{title}</Dialog.Title>

        <Flex direction="column" gap="4">
          {loading ? (
            <Text size="2" color="gray">加载图库中...</Text>
          ) : avatars.length > 0 ? (
            <Box>
              <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>可复用图片</Text>
              <ScrollArea style={{ maxHeight: 420 }}>
                <Flex direction="column" gap="2">
                  {avatars.map((avatar) => {
                    const isSelected = avatar.id === selectedAvatarId;
                    return (
                      <Card
                        key={avatar.id}
                        style={{
                          cursor: 'pointer',
                          border: isSelected ? '2px solid var(--amber-9)' : '1px solid var(--gray-6)',
                          backgroundColor: isSelected ? 'var(--amber-2)' : undefined,
                        }}
                        onClick={() => setSelectedAvatarId(avatar.id)}
                      >
                        <Flex gap="3" align="center">
                          <Box
                            style={{
                              width: 72,
                              height: 72,
                              borderRadius: 8,
                              overflow: 'hidden',
                              flexShrink: 0,
                              background: 'var(--gray-3)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <img
                              src={avatar.avatar_url}
                              alt={avatar.name || '资源图片'}
                              style={{ width: '100%', height: '100%', objectFit: imageFit }}
                            />
                          </Box>
                          <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
                            <Text size="2" weight="bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {avatar.name || `图片 #${avatar.id}`}
                            </Text>
                            <Text size="1" color="gray">ID: {avatar.id}</Text>
                          </Flex>
                          {isSelected && <Text size="2" weight="bold">OK</Text>}
                        </Flex>
                      </Card>
                    );
                  })}
                </Flex>
              </ScrollArea>
            </Box>
          ) : (
            <Text size="2" color="gray">{emptyText}</Text>
          )}

          <Flex gap="3" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">关闭</Button>
            </Dialog.Close>
            <Button
              variant="solid"
              color="amber"
              disabled={!selectedAvatar || submitting}
              onClick={handleConfirm}
            >
              {submitting ? '应用中...' : '使用选中图片'}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
