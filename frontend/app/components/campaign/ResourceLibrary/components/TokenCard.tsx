/**
 * TokenCard Component
 * Displays a token currently on the map with actions (focus, delete, HP update)
 */

import React, { useState, useMemo } from 'react';
import { Card, Text, Flex, Box, Badge, Button } from '@radix-ui/themes';
import type { Token } from '../types';
import { getAssetUrl } from '~/utils/asset-url';

interface TokenCardProps {
  token: Token;
  onFocus: (tokenId: number, position: { x: number; y: number }) => void;
  onDelete: (tokenId: number) => void;
  onHPUpdate?: (tokenId: number, hp: number) => void;
}

export const TokenCard = React.memo(({ token, onFocus, onDelete, onHPUpdate }: TokenCardProps) => {
  const [editingHP, setEditingHP] = useState(false);
  const [hpValue, setHpValue] = useState(token.current_hp?.toString() || '0');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Resolve avatar URL - handles both OSS URLs and local asset paths
  const avatarUrl = useMemo(() => {
    if (!token.avatar) return null;
    // If it's a local asset path (starts with /assets/), resolve via getAssetUrl
    if (token.avatar.startsWith('/assets/')) {
      return getAssetUrl(token.avatar.slice(1)); // Remove leading slash
    }
    // Otherwise it's already a full URL (OSS or other)
    return token.avatar;
  }, [token.avatar]);

  const handleHPChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHpValue(e.target.value);
  };

  const handleHPSave = async () => {
    const newHP = parseInt(hpValue);
    if (!isNaN(newHP) && onHPUpdate) {
      onHPUpdate(token.id, newHP);
      setEditingHP(false);
    }
  };

  const handleHPKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleHPSave();
    } else if (e.key === 'Escape') {
      setEditingHP(false);
      setHpValue(token.current_hp?.toString() || '0');
    }
  };

  const handleDeleteClick = () => {
    if (confirmDelete) {
      onDelete(token.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      // 3秒后重置确认状态
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <Card variant="surface" style={{ backgroundColor: 'rgba(251, 146, 60, 0.1)' }}>
      <Flex direction="column" gap="2">
        <Flex justify="between" align="start">
          <Box>
            <Flex align="center" gap="2">
              <Text size="2" weight="bold">{token.instance_name || token.monster_name}</Text>
              {avatarUrl && (
                <img
                  src={avatarUrl}
                  alt={token.monster_name || token.instance_name}
                  style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' }}
                />
              )}
            </Flex>
            <Flex gap="2" mt="1" wrap="wrap" align="center">
              <Badge size="1" variant="soft" color="orange">
                Size: {token.token_size}
              </Badge>
              {token.current_hp !== undefined && (
                editingHP && onHPUpdate ? (
                  <Flex gap="1" align="center">
                    <input
                      type="number"
                      value={hpValue}
                      onChange={handleHPChange}
                      onKeyDown={handleHPKeyDown}
                      autoFocus
                      style={{
                        width: '50px',
                        padding: '4px 6px',
                        backgroundColor: 'rgba(34, 197, 94, 0.2)',
                        border: '1px solid rgb(34, 197, 94)',
                        borderRadius: '4px',
                        color: 'inherit',
                        fontSize: '12px'
                      }}
                    />
                    <Button
                      size="1"
                      variant="ghost"
                      onClick={handleHPSave}
                      style={{ padding: '0 6px' }}
                    >
                      ✓
                    </Button>
                  </Flex>
                ) : (
                  <Badge
                    size="1"
                    variant="soft"
                    color={token.current_hp <= 0 ? 'red' : 'green'}
                    onClick={onHPUpdate ? () => setEditingHP(true) : undefined}
                    style={{ cursor: onHPUpdate ? 'pointer' : 'default' }}
                  >
                    HP {token.current_hp}
                  </Badge>
                )
              )}
              <Badge size="1" variant="soft" color="cyan">
                ({Math.round(token.position_x)}, {Math.round(token.position_y)})
              </Badge>
            </Flex>
          </Box>
        </Flex>

        <Flex gap="2">
          <Button
            size="1"
            variant="soft"
            color="blue"
            onClick={() => onFocus(token.id, { x: token.position_x, y: token.position_y })}
            style={{ flex: 1 }}
          >
            🎯 Focus
          </Button>
          <Button
            size="1"
            variant={confirmDelete ? "solid" : "soft"}
            color="red"
            onClick={handleDeleteClick}
          >
            {confirmDelete ? '⚠️ 确认?' : '🗑️ Remove'}
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
});

TokenCard.displayName = 'TokenCard';
