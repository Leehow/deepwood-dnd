import React, { useState, useEffect } from 'react';
import { Dialog, Flex, Text, TextField, Button, Select, TextArea, Switch, Box } from '@radix-ui/themes';
import * as Tabs from '@radix-ui/react-tabs';
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';

const logger = createLogger('AddChestModal');

// Trap presets
const TRAP_PRESETS = {
  poison_needle: {
    name: '毒针陷阱',
    trap_type: 'poison_needle',
    trap_effect: {
      damage: '1d4',
      damage_type: '穿刺',
      save_dc: 11,
      save_ability: 'CON',
      effect_text: '1d4穿刺伤害。DC11体质豁免，失败则中毒1小时。'
    },
    trap_detection_dc: 15,
    trap_disarm_dc: 15
  },
  fire_trap: {
    name: '火焰陷阱',
    trap_type: 'fire_trap',
    trap_effect: {
      damage: '2d6',
      damage_type: '火焰',
      save_dc: 13,
      save_ability: 'DEX',
      effect_text: '2d6火焰伤害，DC13敏捷豁免成功则减半。'
    },
    trap_detection_dc: 14,
    trap_disarm_dc: 14
  },
  alarm: {
    name: '警报陷阱',
    trap_type: 'alarm',
    trap_effect: {
      damage: null,
      damage_type: null,
      save_dc: null,
      save_ability: null,
      effect_text: '触发时发出响亮警报，300尺内可闻，持续10分钟。'
    },
    trap_detection_dc: 12,
    trap_disarm_dc: 12
  },
  acid_spray: {
    name: '强酸喷射陷阱',
    trap_type: 'acid_spray',
    trap_effect: {
      damage: '3d6',
      damage_type: '强酸',
      save_dc: 14,
      save_ability: 'DEX',
      effect_text: '3d6强酸伤害，DC14敏捷豁免成功则减半。'
    },
    trap_detection_dc: 16,
    trap_disarm_dc: 16
  },
  poison_gas: {
    name: '毒气陷阱',
    trap_type: 'poison_gas',
    trap_effect: {
      damage: '2d8',
      damage_type: '毒素',
      save_dc: 13,
      save_ability: 'CON',
      effect_text: '2d8毒素伤害，DC13体质豁免成功则减半。10尺范围内所有生物受影响。'
    },
    trap_detection_dc: 15,
    trap_disarm_dc: 17
  },
  blade_trap: {
    name: '刀刃陷阱',
    trap_type: 'blade_trap',
    trap_effect: {
      damage: '2d10',
      damage_type: '挥砍',
      save_dc: 15,
      save_ability: 'DEX',
      effect_text: '2d10挥砍伤害，DC15敏捷豁免成功则无伤害。'
    },
    trap_detection_dc: 17,
    trap_disarm_dc: 18
  }
};

// Lock DC presets
const LOCK_DC_PRESETS = [
  { dc: 10, label: 'DC10 - 简单（普通木箱）' },
  { dc: 15, label: 'DC15 - 中等（铁锁木箱）' },
  { dc: 20, label: 'DC20 - 困难（精制保险箱）' },
  { dc: 25, label: 'DC25 - 非常困难（大师锁）' },
  { dc: 30, label: 'DC30 - 近乎不可能（传奇锁）' },
];

// AI generated chest plan interface
interface ChestPlan {
  name: string;
  description: string;
  appearance?: string;
  is_locked: boolean;
  lock_dc: number;
  requires_key: boolean;
  key_name?: string;
  is_trapped: boolean;
  trap_type?: string;
  currency?: { cp?: number; sp?: number; ep?: number; gp?: number; pp?: number };
  items?: { name: string; quantity?: number; category?: string; rarity?: string; description?: string }[];
}

interface AddChestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onChestAdded: () => void;
  defaultTab?: 'manual' | 'ai';
}

export function AddChestModal({ open, onOpenChange, campaignId, onChestAdded, defaultTab = 'manual' }: AddChestModalProps) {
  const [activeTab, setActiveTab] = useState<'manual' | 'ai'>(defaultTab);

  // Manual form state
  const [name, setName] = useState('神秘宝箱');
  const [description, setDescription] = useState('');
  const [appearanceDescription, setAppearanceDescription] = useState('一个古老的木制宝箱，边角包有青铜装饰。');
  const [isLocked, setIsLocked] = useState(true);
  const [lockDc, setLockDc] = useState(15);
  const [requiresKey, setRequiresKey] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [isTrapped, setIsTrapped] = useState(false);
  const [selectedTrap, setSelectedTrap] = useState<string>('poison_needle');
  const [cp, setCp] = useState(0);
  const [sp, setSp] = useState(0);
  const [ep, setEp] = useState(0);
  const [gp, setGp] = useState(0);
  const [pp, setPp] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [isGeneratingAppearance, setIsGeneratingAppearance] = useState(false);

  // AI generation state
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState<ChestPlan | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Reset to defaultTab when modal opens
  useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
    }
  }, [open, defaultTab]);

  // Generate appearance description using AI
  const generateAppearance = async () => {
    if (!name.trim()) return;
    setIsGeneratingAppearance(true);

    try {
      const prompt = `请为一个D&D宝箱生成简短的外观描述（用于生成图片），不超过50字。
宝箱名称：${name}
${description ? `宝箱描述：${description}` : ''}
${isLocked ? `锁定状态：DC${lockDc}的锁` : '未锁定'}
${isTrapped ? `陷阱：${TRAP_PRESETS[selectedTrap as keyof typeof TRAP_PRESETS]?.name || selectedTrap}` : ''}

只输出外观描述，不要其他内容。`;

      const response = await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/query`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: prompt, mode: 'query' })
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.content) {
          setAppearanceDescription(data.content.trim());
        }
      }
    } catch (e) {
      logger.error('[AddChestModal] Generate appearance error:', e);
    } finally {
      setIsGeneratingAppearance(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsCreating(true);

    try {
      const trapPreset = isTrapped ? TRAP_PRESETS[selectedTrap as keyof typeof TRAP_PRESETS] : null;

      const payload: any = {
        campaign_id: parseInt(campaignId),
        name: name.trim(),
        description: description.trim() || null,
        appearance_description: appearanceDescription.trim() || null,
        state: isLocked ? 'locked' : 'unlocked',
        is_locked: isLocked,
        lock_dc: lockDc,
        requires_key: requiresKey,
        key_name: requiresKey ? keyName.trim() : null,
        is_trapped: isTrapped,
        trap_detected: false,
        trap_disarmed: false,
        trap_triggered: false,
        trap_type: trapPreset?.trap_type || null,
        trap_detection_dc: trapPreset?.trap_detection_dc || 15,
        trap_disarm_dc: trapPreset?.trap_disarm_dc || 15,
        trap_effect: trapPreset?.trap_effect || null,
        cp, sp, ep, gp, pp,
      };

      const resp = await apiFetch('/api/chests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (resp.ok) {
        onChestAdded();
        onOpenChange(false);
        resetForm();
      } else {
        const text = await resp.text();
        logger.error('[AddChestModal] Create failed:', text);
      }
    } catch (e) {
      logger.error('[AddChestModal] Create error:', e);
    } finally {
      setIsCreating(false);
    }
  };

  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    setAiError(null);
    setGeneratedPlan(null);

    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/query`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: aiPrompt.trim(),
            mode: 'create'
          })
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Find chest plan in tool_calls
      const chestCall = data.tool_calls?.find((tc: any) => tc.tool === 'create_chest');
      if (chestCall?.chest_plan) {
        setGeneratedPlan(chestCall.chest_plan);
      } else {
        setAiError('AI未能生成宝箱计划，请尝试更详细的描述');
      }
    } catch (err) {
      logger.error('[AddChestModal] AI generation failed:', err);
      setAiError(err instanceof Error ? err.message : 'AI生成失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConfirmAIPlan = async () => {
    if (!generatedPlan) return;
    setIsCreating(true);

    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/create-chest`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(generatedPlan)
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      onChestAdded();
      onOpenChange(false);
      resetForm();
    } catch (err) {
      logger.error('[AddChestModal] Create AI chest failed:', err);
      setAiError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setName('神秘宝箱');
    setDescription('');
    setAppearanceDescription('一个古老的木制宝箱，边角包有青铜装饰。');
    setIsLocked(true);
    setLockDc(15);
    setRequiresKey(false);
    setKeyName('');
    setIsTrapped(false);
    setSelectedTrap('poison_needle');
    setCp(0);
    setSp(0);
    setEp(0);
    setGp(0);
    setPp(0);
    setAiPrompt('');
    setGeneratedPlan(null);
    setAiError(null);
    setActiveTab('manual');
  };

  const trapNames: Record<string, string> = {
    poison_needle: '毒针', fire_trap: '火焰', alarm: '警报',
    acid_spray: '强酸喷射', poison_gas: '毒气', blade_trap: '刀刃'
  };

  const formatCurrency = (currency: ChestPlan['currency']) => {
    if (!currency) return null;
    const parts = [];
    if (currency.pp) parts.push(`${currency.pp}铂`);
    if (currency.gp) parts.push(`${currency.gp}金`);
    if (currency.ep) parts.push(`${currency.ep}银金`);
    if (currency.sp) parts.push(`${currency.sp}银`);
    if (currency.cp) parts.push(`${currency.cp}铜`);
    return parts.length > 0 ? parts.join(' ') : null;
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content aria-describedby={undefined} maxWidth="550px" className="bg-gray-900">
        <Dialog.Title>新建宝箱</Dialog.Title>

        <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as 'manual' | 'ai')}>
          <Tabs.List className="flex border-b border-gray-700 mt-3 mb-4">
            <Tabs.Trigger
              value="manual"
              className="flex-1 px-4 py-2 text-sm font-medium data-[state=active]:bg-gray-700 data-[state=active]:text-amber-400 rounded-t-lg transition-colors"
            >
              手动创建
            </Tabs.Trigger>
            <Tabs.Trigger
              value="ai"
              className="flex-1 px-4 py-2 text-sm font-medium data-[state=active]:bg-gray-700 data-[state=active]:text-purple-400 rounded-t-lg transition-colors"
            >
              ✨ AI生成
            </Tabs.Trigger>
          </Tabs.List>

          {/* Manual Creation Tab */}
          <Tabs.Content value="manual">
            <Flex direction="column" gap="3">
              {/* Basic Info */}
              <Box>
                <Text size="2" weight="bold" mb="2">基本信息</Text>
                <Flex direction="column" gap="2">
                  <TextField.Root
                    placeholder="宝箱名称"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <TextArea
                    placeholder="描述（可选）"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                  <Flex direction="column" gap="1">
                    <Flex justify="between" align="center">
                      <Text size="1" color="gray">外观描述（用于生成头像）</Text>
                      <Button
                        size="1"
                        variant="ghost"
                        onClick={generateAppearance}
                        disabled={isGeneratingAppearance || !name.trim()}
                      >
                        {isGeneratingAppearance ? '生成中...' : '✨ AI生成'}
                      </Button>
                    </Flex>
                    <TextArea
                      placeholder="描述宝箱的外观，如：一个布满苔藓的石制宝箱..."
                      value={appearanceDescription}
                      onChange={(e) => setAppearanceDescription(e.target.value)}
                      rows={2}
                    />
                  </Flex>
                </Flex>
              </Box>

              {/* Lock Settings */}
              <Box className="border-t border-gray-700 pt-3">
                <Flex align="center" gap="2" mb="2">
                  <Text size="2" weight="bold">🔒 锁定设置</Text>
                  <Switch checked={isLocked} onCheckedChange={setIsLocked} size="1" />
                </Flex>

                {isLocked && (
                  <Flex direction="column" gap="2">
                    <Select.Root value={String(lockDc)} onValueChange={(v) => setLockDc(parseInt(v))}>
                      <Select.Trigger placeholder="锁定难度" />
                      <Select.Content>
                        {LOCK_DC_PRESETS.map(p => (
                          <Select.Item key={p.dc} value={String(p.dc)}>{p.label}</Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>

                    <Flex align="center" gap="2">
                      <Switch checked={requiresKey} onCheckedChange={setRequiresKey} size="1" />
                      <Text size="2">需要钥匙</Text>
                    </Flex>

                    {requiresKey && (
                      <TextField.Root
                        placeholder="钥匙名称（如：地牢钥匙）"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                      />
                    )}
                  </Flex>
                )}
              </Box>

              {/* Trap Settings */}
              <Box className="border-t border-gray-700 pt-3">
                <Flex align="center" gap="2" mb="2">
                  <Text size="2" weight="bold">⚠️ 陷阱设置</Text>
                  <Switch checked={isTrapped} onCheckedChange={setIsTrapped} size="1" />
                </Flex>

                {isTrapped && (
                  <Flex direction="column" gap="2">
                    <Select.Root value={selectedTrap} onValueChange={setSelectedTrap}>
                      <Select.Trigger placeholder="选择陷阱类型" />
                      <Select.Content>
                        {Object.entries(TRAP_PRESETS).map(([key, preset]) => (
                          <Select.Item key={key} value={key}>{preset.name}</Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>

                    {selectedTrap && TRAP_PRESETS[selectedTrap as keyof typeof TRAP_PRESETS] && (
                      <Box className="bg-gray-800 p-2 rounded text-xs">
                        <Text size="1" color="gray">
                          {TRAP_PRESETS[selectedTrap as keyof typeof TRAP_PRESETS].trap_effect.effect_text}
                        </Text>
                        <Flex gap="2" mt="1">
                          <Text size="1" color="orange">
                            侦测DC: {TRAP_PRESETS[selectedTrap as keyof typeof TRAP_PRESETS].trap_detection_dc}
                          </Text>
                          <Text size="1" color="red">
                            拆除DC: {TRAP_PRESETS[selectedTrap as keyof typeof TRAP_PRESETS].trap_disarm_dc}
                          </Text>
                        </Flex>
                      </Box>
                    )}
                  </Flex>
                )}
              </Box>

              {/* Currency */}
              <Box className="border-t border-gray-700 pt-3">
                <Text size="2" weight="bold" mb="2">💰 货币</Text>
                <Flex gap="2" wrap="wrap">
                  <Flex direction="column" gap="1" style={{ width: '60px' }}>
                    <Text size="1" color="orange">铜币(cp)</Text>
                    <TextField.Root
                      type="number"
                      value={String(cp)}
                      onChange={(e) => setCp(Math.max(0, parseInt(e.target.value) || 0))}
                      size="1"
                    />
                  </Flex>
                  <Flex direction="column" gap="1" style={{ width: '60px' }}>
                    <Text size="1" color="gray">银币(sp)</Text>
                    <TextField.Root
                      type="number"
                      value={String(sp)}
                      onChange={(e) => setSp(Math.max(0, parseInt(e.target.value) || 0))}
                      size="1"
                    />
                  </Flex>
                  <Flex direction="column" gap="1" style={{ width: '60px' }}>
                    <Text size="1" color="blue">琥珀(ep)</Text>
                    <TextField.Root
                      type="number"
                      value={String(ep)}
                      onChange={(e) => setEp(Math.max(0, parseInt(e.target.value) || 0))}
                      size="1"
                    />
                  </Flex>
                  <Flex direction="column" gap="1" style={{ width: '60px' }}>
                    <Text size="1" color="yellow">金币(gp)</Text>
                    <TextField.Root
                      type="number"
                      value={String(gp)}
                      onChange={(e) => setGp(Math.max(0, parseInt(e.target.value) || 0))}
                      size="1"
                    />
                  </Flex>
                  <Flex direction="column" gap="1" style={{ width: '60px' }}>
                    <Text size="1" color="cyan">铂金(pp)</Text>
                    <TextField.Root
                      type="number"
                      value={String(pp)}
                      onChange={(e) => setPp(Math.max(0, parseInt(e.target.value) || 0))}
                      size="1"
                    />
                  </Flex>
                </Flex>
              </Box>

              {/* Tip about items */}
              <Box className="bg-gray-800/50 p-2 rounded-lg">
                <Text size="1" color="gray">
                  💡 物品添加：创建宝箱后，点击宝箱卡片即可从物品库中添加物品
                </Text>
              </Box>
            </Flex>

            <Flex gap="3" mt="4" justify="end">
              <Dialog.Close>
                <Button variant="soft" color="gray">取消</Button>
              </Dialog.Close>
              <Button onClick={handleCreate} disabled={isCreating || !name.trim()}>
                {isCreating ? '创建中...' : '创建宝箱'}
              </Button>
            </Flex>
          </Tabs.Content>

          {/* AI Generation Tab */}
          <Tabs.Content value="ai">
            <Flex direction="column" gap="3">
              {!generatedPlan ? (
                <>
                  <Box>
                    <Text size="2" weight="bold" mb="2">描述你想要的宝箱</Text>
                    <TextArea
                      placeholder="例如：一个带有火焰陷阱的铁制保险箱，DC20锁，里面有200金币和一把+1长剑"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      rows={4}
                      className="w-full"
                    />
                  </Box>

                  <Box className="bg-gray-800/50 p-3 rounded-lg">
                    <Text size="1" color="gray">
                      💡 提示：可以描述锁的难度、陷阱类型、货币数量、物品内容等。AI会根据描述生成完整的宝箱配置。
                    </Text>
                  </Box>

                  {aiError && (
                    <Box className="bg-red-950/50 border border-red-900/50 p-3 rounded-lg">
                      <Text size="2" color="red">{aiError}</Text>
                    </Box>
                  )}

                  <Flex gap="3" justify="end">
                    <Dialog.Close>
                      <Button variant="soft" color="gray">取消</Button>
                    </Dialog.Close>
                    <Button
                      onClick={handleAIGenerate}
                      disabled={isGenerating || !aiPrompt.trim()}
                      className="bg-purple-600 hover:bg-purple-500"
                    >
                      {isGenerating ? (
                        <Flex align="center" gap="2">
                          <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                          <span>AI生成中...</span>
                        </Flex>
                      ) : '✨ AI生成'}
                    </Button>
                  </Flex>
                </>
              ) : (
                <>
                  {/* Generated Plan Preview */}
                  <Box className="bg-amber-950/30 border border-amber-700/50 rounded-lg p-4">
                    <Flex align="center" gap="2" mb="3">
                      <span className="text-xl">📦</span>
                      <Text size="3" weight="bold" className="text-amber-300">{generatedPlan.name}</Text>
                    </Flex>

                    {generatedPlan.description && (
                      <Text size="2" className="text-gray-300 mb-3 block">{generatedPlan.description}</Text>
                    )}

                    <Flex gap="2" wrap="wrap" mb="3">
                      {generatedPlan.is_locked && (
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                          🔒 {generatedPlan.requires_key ? `需要钥匙(${generatedPlan.key_name || '未知'})` : `DC${generatedPlan.lock_dc}`}
                        </span>
                      )}
                      {generatedPlan.is_trapped && generatedPlan.trap_type && (
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                          ⚠️ {trapNames[generatedPlan.trap_type] || generatedPlan.trap_type}陷阱
                        </span>
                      )}
                      {formatCurrency(generatedPlan.currency) && (
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                          💰 {formatCurrency(generatedPlan.currency)}
                        </span>
                      )}
                    </Flex>

                    {generatedPlan.items && generatedPlan.items.length > 0 && (
                      <Box className="mt-2 pt-2 border-t border-gray-700">
                        <Text size="1" color="gray" mb="1">包含物品:</Text>
                        <Flex gap="1" wrap="wrap">
                          {generatedPlan.items.map((item, idx) => (
                            <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-700/50 text-gray-300">
                              {item.name}{item.quantity && item.quantity > 1 ? ` x${item.quantity}` : ''}
                            </span>
                          ))}
                        </Flex>
                      </Box>
                    )}
                  </Box>

                  {aiError && (
                    <Box className="bg-red-950/50 border border-red-900/50 p-3 rounded-lg">
                      <Text size="2" color="red">{aiError}</Text>
                    </Box>
                  )}

                  <Flex gap="3" justify="end">
                    <Button variant="soft" color="gray" onClick={() => setGeneratedPlan(null)}>
                      重新生成
                    </Button>
                    <Button
                      onClick={handleConfirmAIPlan}
                      disabled={isCreating}
                      className="bg-amber-600 hover:bg-amber-500"
                    >
                      {isCreating ? '创建中...' : '✓ 确认创建'}
                    </Button>
                  </Flex>
                </>
              )}
            </Flex>
          </Tabs.Content>
        </Tabs.Root>
      </Dialog.Content>
    </Dialog.Root>
  );
}
