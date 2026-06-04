/**
 * AddCustomShopModal - 创建自定义商店（手动填写 / AI生成）
 */

import React, { useState } from 'react';
import { Dialog, Flex, Text, Button, TextArea, TextField, Switch } from '@radix-ui/themes';
import { apiFetch } from '~/utils/api-client';

interface AddCustomShopModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onCreated: () => void;
}

type TabMode = 'manual' | 'ai';

interface ManualForm {
  name: string;
  description: string;
  appearance_description: string;
  gold_gp: string;
  discount_rate: string;
  accepts_selling: boolean;
}

const defaultForm: ManualForm = {
  name: '',
  description: '',
  appearance_description: '',
  gold_gp: '1000',
  discount_rate: '50',
  accepts_selling: true,
};

export function AddCustomShopModal({
  open,
  onOpenChange,
  campaignId,
  onCreated,
}: AddCustomShopModalProps) {
  const [tab, setTab] = useState<TabMode>('manual');

  // AI mode state
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual mode state
  const [form, setForm] = useState<ManualForm>({ ...defaultForm });

  const updateForm = (field: keyof ManualForm, value: string | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // --- AI mode handlers ---
  const handleGenerate = async (random: boolean) => {
    if (!random && (!description.trim() || description.trim().length < 2)) {
      setError('请先输入简短描述');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/ai-settings/expand-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          entity_type: 'shop',
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

  const handleAiSubmit = async () => {
    if (!description.trim() || description.trim().length < 5) {
      setError('请输入至少5个字符的商店描述');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/shops/parse-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          description: description.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || '创建商店失败');
      }

      resetAndClose();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建商店失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Manual mode handler ---
  const handleManualSubmit = async () => {
    if (!form.name.trim()) {
      setError('请输入商店名称');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const goldGp = Math.max(0, parseInt(form.gold_gp) || 0);
      const discountPct = Math.max(0, Math.min(100, parseInt(form.discount_rate) || 50));

      const response = await apiFetch('/api/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          name: form.name.trim(),
          description: form.description.trim() || null,
          appearance_description: form.appearance_description.trim() || null,
          gold_gp: goldGp,
          discount_rate: discountPct / 100,
          accepts_selling: form.accepts_selling,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || '创建商店失败');
      }

      resetAndClose();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建商店失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setDescription('');
    setForm({ ...defaultForm });
    setError(null);
    onOpenChange(false);
  };

  const handleClose = () => {
    if (!isSubmitting && !isGenerating) {
      resetAndClose();
    }
  };

  const isLoading = isSubmitting || isGenerating;

  const tabStyle = (active: boolean) => ({
    padding: '6px 16px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: active ? 600 : 400,
    cursor: isLoading ? 'not-allowed' : 'pointer',
    background: active ? 'var(--accent-a3)' : 'transparent',
    color: active ? 'var(--accent-11)' : 'var(--gray-11)',
    border: 'none',
    transition: 'all 0.15s',
  } as const);

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 500 }}>
        <Dialog.Title><span>添加自定义商店</span></Dialog.Title>

        {/* Tab switcher */}
        <div style={{
          display: 'flex',
          gap: 4,
          padding: 3,
          borderRadius: 8,
          background: 'var(--gray-a3)',
          marginBottom: 16,
        }}>
          <button style={tabStyle(tab === 'manual')} onClick={() => !isLoading && setTab('manual')}>
            手动填写
          </button>
          <button style={tabStyle(tab === 'ai')} onClick={() => !isLoading && setTab('ai')}>
            AI 生成
          </button>
        </div>

        {tab === 'manual' ? (
          /* ===== Manual Form ===== */
          <Flex direction="column" gap="3">
            <label>
              <Text size="2" weight="medium" mb="1" as="div"><span>商店名称 *</span></Text>
              <TextField.Root
                placeholder="例如：铁锤铁匠铺"
                value={form.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('name', e.target.value)}
                disabled={isLoading}
              />
            </label>

            <label>
              <Text size="2" weight="medium" mb="1" as="div"><span>商店描述</span></Text>
              <TextArea
                placeholder="商店的背景故事、特色等"
                value={form.description}
                onChange={(e) => updateForm('description', e.target.value)}
                disabled={isLoading}
                style={{ minHeight: 60 }}
              />
            </label>

            <label>
              <Text size="2" weight="medium" mb="1" as="div"><span>外观描述</span></Text>
              <TextArea
                placeholder="建筑风格、招牌、门面等（用于生成头像）"
                value={form.appearance_description}
                onChange={(e) => updateForm('appearance_description', e.target.value)}
                disabled={isLoading}
                style={{ minHeight: 50 }}
              />
            </label>

            <Flex gap="3">
              <label style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1" as="div"><span>初始金币 (gp)</span></Text>
                <TextField.Root
                  type="number"
                  value={form.gold_gp}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('gold_gp', e.target.value)}
                  disabled={isLoading}
                />
              </label>

              <label style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1" as="div"><span>回收折扣 (%)</span></Text>
                <TextField.Root
                  type="number"
                  value={form.discount_rate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('discount_rate', e.target.value)}
                  disabled={isLoading}
                />
              </label>
            </Flex>

            <Flex align="center" gap="2">
              <Switch
                checked={form.accepts_selling}
                onCheckedChange={(checked) => updateForm('accepts_selling', checked)}
                disabled={isLoading}
                size="1"
              />
              <Text size="2"><span>接受回收物品</span></Text>
            </Flex>

            {error && <Text size="2" color="red"><span>{error}</span></Text>}

            <Flex gap="3" justify="end" mt="2">
              <Dialog.Close>
                <Button variant="soft" color="gray" disabled={isLoading}><span>取消</span></Button>
              </Dialog.Close>
              <Button onClick={handleManualSubmit} disabled={isLoading || !form.name.trim()}>
                <span>{isSubmitting ? '创建中...' : '创建商店'}</span>
              </Button>
            </Flex>
          </Flex>
        ) : (
          /* ===== AI Mode ===== */
          <Flex direction="column" gap="3">
            <Text size="2" color="gray"><span>输入商店描述，AI将自动解析并创建结构化数据</span></Text>

            <TextArea
              placeholder="例如：矮人铁匠铺，位于城镇广场东侧，门口挂着一把巨大的铁锤招牌。"
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

            {error && <Text size="2" color="red"><span>{error}</span></Text>}

            <Flex gap="3" justify="end" mt="2">
              <Dialog.Close>
                <Button variant="soft" color="gray" disabled={isLoading}><span>取消</span></Button>
              </Dialog.Close>
              <Button onClick={handleAiSubmit} disabled={isLoading || !description.trim()}>
                <span>{isSubmitting ? 'AI分析中...' : 'AI创建商店'}</span>
              </Button>
            </Flex>
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
