/**
 * NPCDetailModal Component
 * Displays detailed NPC information in a modal dialog
 */

import React from 'react';
import { Dialog, Flex, Box, Text, Badge, Button, ScrollArea } from '@radix-ui/themes';
import type { NPC } from '../types';

interface NPCDetailModalProps {
  npc: NPC | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (id: string) => void;
}

export function NPCDetailModal({
  npc,
  open,
  onOpenChange,
  onSelect,
}: NPCDetailModalProps) {
  if (!npc) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 700, maxHeight: '85vh' }}>
        <Dialog.Title>
          <Box>
            <Flex align="center" gap="2">
              <Text size="5" weight="bold">{npc.name}</Text>
              {npc.name_en && <Text size="3" color="gray">({npc.name_en})</Text>}
            </Flex>
            <Flex gap="2" mt="2" wrap="wrap">
              {npc.race && <Badge size="2" variant="soft">{npc.race}</Badge>}
              {npc.occupation && <Badge size="2" variant="soft" color="blue">{npc.occupation}</Badge>}
              {npc.faction && <Badge size="2" variant="outline" color="cyan">{npc.faction}</Badge>}
              {npc.alignment && <Badge size="2" variant="soft" color="purple">{npc.alignment}</Badge>}
              {npc.is_combatant && <Badge size="2" color="red">战斗单位</Badge>}
            </Flex>
          </Box>
        </Dialog.Title>

        <ScrollArea style={{ height: 'calc(85dvh - 180px)' }}>
          <Box py="4">
            {/* Combat Stats */}
            {(npc.hp || npc.ac) && (
              <Flex gap="4" mb="4">
                {npc.hp && (
                  <Box className="text-center bg-red-900/30 rounded-lg p-3" style={{ flex: 1 }}>
                    <Text size="1" color="gray" style={{ display: 'block' }}>生命值 HP</Text>
                    <Text size="4" weight="bold" color="red">{typeof npc.hp === 'object' ? ((npc.hp as any)?.average || (npc.hp as any)?.dice || '') : npc.hp}</Text>
                  </Box>
                )}
                {npc.ac && (
                  <Box className="text-center bg-blue-900/30 rounded-lg p-3" style={{ flex: 1 }}>
                    <Text size="1" color="gray" style={{ display: 'block' }}>护甲等级 AC</Text>
                    <Text size="4" weight="bold" color="blue">{typeof npc.ac === 'object' ? ((npc.ac as any)?.value || (npc.ac as any)?.base || '') : npc.ac}</Text>
                  </Box>
                )}
              </Flex>
            )}

            {/* Description */}
            {npc.description && (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>描述</Text>
                <Text size="2" color="gray" style={{ lineHeight: 1.6 }}>{npc.description}</Text>
              </Box>
            )}

            {/* Personality Traits */}
            {npc.personality_traits && (
              <Box mb="4" p="3" style={{ background: 'var(--amber-a2)', borderRadius: 8 }}>
                <Text size="2" weight="bold" color="amber" mb="2" style={{ display: 'block' }}>
                  性格特征
                </Text>
                <Text size="2" style={{ lineHeight: 1.6 }}>{npc.personality_traits}</Text>
              </Box>
            )}

            {/* Dialogue Samples */}
            {npc.dialogue_samples && npc.dialogue_samples.length > 0 && (
              <Box mb="4">
                <Text size="2" weight="bold" color="cyan" mb="2" style={{ display: 'block' }}>
                  对话样例
                </Text>
                {npc.dialogue_samples.map((dialogue, idx) => (
                  <Box key={idx} mb="2" p="3" style={{ background: 'var(--cyan-a2)', borderRadius: 8 }}>
                    <Text size="2" style={{ fontStyle: 'italic' }}>"{dialogue}"</Text>
                  </Box>
                ))}
              </Box>
            )}

            {/* Secrets */}
            {npc.secrets && npc.secrets.length > 0 && (
              <Box mb="4" p="3" style={{ background: 'var(--red-a2)', borderRadius: 8 }}>
                <Text size="2" weight="bold" color="red" mb="2" style={{ display: 'block' }}>
                  秘密 (仅DM可见)
                </Text>
                {npc.secrets.map((secret, idx) => (
                  <Flex key={idx} gap="2" mb="1" align="start">
                    <Text size="2" color="red">•</Text>
                    <Text size="2">{secret}</Text>
                  </Flex>
                ))}
              </Box>
            )}

            {/* Relationships */}
            {npc.relationships && Object.keys(npc.relationships).length > 0 && (
              <Box mb="4">
                <Text size="2" weight="bold" color="purple" mb="2" style={{ display: 'block' }}>
                  人物关系
                </Text>
                <div className="grid grid-cols-1 gap-2">
                  {Object.entries(npc.relationships).map(([person, relation]) => (
                    <Box key={person} p="2" style={{ background: 'var(--purple-a2)', borderRadius: 6 }}>
                      <Flex justify="between" align="center">
                        <Text size="2" weight="bold">{person}</Text>
                        <Text size="2" color="gray">{relation as string}</Text>
                      </Flex>
                    </Box>
                  ))}
                </div>
              </Box>
            )}
          </Box>
        </ScrollArea>

        {/* Footer Actions */}
        <Flex gap="3" mt="4" justify="end">
          {onSelect && (
            <Button
              variant="soft"
              color="amber"
              onClick={() => {
                onSelect(npc.id);
                onOpenChange(false);
              }}
            >
              <span>选择此NPC</span>
            </Button>
          )}
          <Dialog.Close>
            <Button variant="soft" color="gray"><span>关闭</span></Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
