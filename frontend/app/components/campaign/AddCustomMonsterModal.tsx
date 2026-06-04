/**
 * AddCustomMonsterModal - 通过自然语言描述创建自定义怪物或NPC
 */

import React, { useState } from 'react';
import { Dialog, Flex, Text, Button, TextArea } from '@radix-ui/themes';
import { apiFetch } from '~/utils/api-client';

interface AddCustomMonsterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onCreated: () => void;
  isNpc?: boolean;
}

export function AddCustomMonsterModal({
  open,
  onOpenChange,
  campaignId,
  onCreated,
  isNpc = false,
}: AddCustomMonsterModalProps) {
  const [description, setDescription] = useState('');
  const [npcName, setNpcName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entityName = isNpc ? 'NPC' : '怪物';
  const entityType = isNpc ? 'npc' : 'monster';

  const handleGenerateName = async () => {
    setIsGeneratingName(true);
    setError(null);
    try {
      const response = await apiFetch('/api/ai-settings/generate-npc-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || '生成名字失败');
      }
      const data = await response.json();
      if (data.name) {
        setNpcName(data.name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成名字失败');
    } finally {
      setIsGeneratingName(false);
    }
  };

  const handleGenerate = async (random: boolean) => {
    if (!random && (!description.trim() || description.trim().length < 2)) {
      setError('请先输入简短描述');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await apiFetch('/api/ai-settings/expand-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          entity_type: entityType,
          random,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || '生成失败');
      }

      const data = await response.json();
      if (data.expanded_description) {
        setDescription(data.expanded_description);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async () => {
    if (!description.trim() || description.trim().length < 5) {
      setError(`请输入至少5个字符的${entityName}描述`);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await apiFetch('/api/monster-instances/parse-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          description: description.trim(),
          is_npc: isNpc,
          ...(isNpc && npcName.trim() ? { name: npcName.trim() } : {}),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `创建${entityName}失败`);
      }

      setDescription('');
      setNpcName('');
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : `创建${entityName}失败`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting && !isGenerating && !isGeneratingName) {
      setDescription('');
      setNpcName('');
      setError(null);
      onOpenChange(false);
    }
  };

  const isLoading = isSubmitting || isGenerating || isGeneratingName;

  const placeholder = isNpc
    ? '例如：老酒馆的矮人酒保，50多岁，性格豪爽但对陌生人有戒心。'
    : '例如：暗影狼，大型野兽，CR 2。一种来自费野的魔法狼，全身笼罩在暗影中。';

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 500 }}>
        <Dialog.Title><span>添加自定义{entityName}</span></Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          <span>输入{entityName}描述，AI将自动解析并创建结构化数据</span>
        </Dialog.Description>

        <Flex direction="column" gap="3">
          {/* NPC Name Field */}
          {isNpc && (
            <div>
              <Text size="2" weight="medium" mb="1" className="block text-gray-300">
                <span>名字</span>
              </Text>
              <Flex gap="2" align="center">
                <input
                  type="text"
                  placeholder="留空则由AI自动生成"
                  value={npcName}
                  onChange={(e) => setNpcName(e.target.value)}
                  disabled={isLoading}
                  className="flex-1 px-3 py-1.5 bg-gray-900/60 border border-gray-700 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500/50 transition-colors"
                />
                <Button
                  size="1"
                  variant="soft"
                  color="violet"
                  onClick={handleGenerateName}
                  disabled={isLoading}
                >
                  <span>{isGeneratingName ? '...' : 'AI生成'}</span>
                </Button>
              </Flex>
            </div>
          )}

          <TextArea
            placeholder={placeholder}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isLoading}
            style={{ minHeight: 150 }}
          />

          <Flex gap="2" align="center">
            <Button
              size="1"
              variant="soft"
              color="orange"
              onClick={() => handleGenerate(true)}
              disabled={isLoading}
            >
              <span>{isGenerating ? '生成中...' : '随机生成'}</span>
            </Button>
            <Button
              size="1"
              variant="soft"
              color="cyan"
              onClick={() => handleGenerate(false)}
              disabled={isLoading || !description.trim()}
            >
              <span>扩展描述</span>
            </Button>
            <Text size="1" color="gray">
              <span>可多次点击生成不同内容</span>
            </Text>
          </Flex>

          {error && (
            <Text size="2" color="red">
              <span>{error}</span>
            </Text>
          )}

          <Flex gap="3" justify="end" mt="2">
            <Dialog.Close>
              <Button variant="soft" color="gray" disabled={isLoading}>
                <span>取消</span>
              </Button>
            </Dialog.Close>
            <Button onClick={handleSubmit} disabled={isLoading || !description.trim()}>
              <span>{isSubmitting ? 'AI分析中...' : `创建${entityName}`}</span>
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
