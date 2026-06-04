/**
 * MonsterDetailModal Component
 * Displays detailed monster information in a modal dialog
 * Supports double-click inline editing for core stats
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Dialog, Flex, Box, Text, Badge, Button, ScrollArea, TextField, TextArea } from '@radix-ui/themes';
import { EditableField } from './EditableField';
import type { MonsterInstance, NPCQuest, InventoryItem, Currency, Item } from '../types';
import { getAssetUrl } from '~/utils/asset-url';
import { tCategory } from '~/config/item-i18n';
import { dndSizeToTokenSize } from '~/components/map/utils/mapCalculations';

// Helper to resolve avatar URL - handles both OSS URLs and local asset paths
function resolveAvatarUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  if (url.startsWith('/assets/')) {
    return getAssetUrl(url.slice(1));
  }
  return url;
}

// 预设的常见战利品
const PRESET_LOOT_ITEMS: InventoryItem[] = [
  { name: '短剑', name_cn: '短剑', category: 'weapon', quantity: 1 },
  { name: '长剑', name_cn: '长剑', category: 'weapon', quantity: 1 },
  { name: '匕首', name_cn: '匕首', category: 'weapon', quantity: 1 },
  { name: '短弓', name_cn: '短弓', category: 'weapon', quantity: 1 },
  { name: '箭矢', name_cn: '箭矢 (20)', category: 'ammunition', quantity: 20 },
  { name: '皮甲', name_cn: '皮甲', category: 'armor', quantity: 1 },
  { name: '盾牌', name_cn: '盾牌', category: 'armor', quantity: 1 },
  { name: '治疗药水', name_cn: '治疗药水', category: 'potion', quantity: 1 },
  { name: '火把', name_cn: '火把', category: 'gear', quantity: 1 },
  { name: '绳索', name_cn: '绳索 (50尺)', category: 'gear', quantity: 1 },
  { name: '口粮', name_cn: '口粮 (1天)', category: 'gear', quantity: 1 },
  { name: '宝石', name_cn: '宝石', category: 'treasure', quantity: 1 },
  { name: '戒指', name_cn: '戒指', category: 'treasure', quantity: 1 },
  { name: '项链', name_cn: '项链', category: 'treasure', quantity: 1 },
];

interface MonsterDetailModalProps {
  monster: MonsterInstance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerateAvatar?: (id: number) => void;
  onPlaceToken?: (id: number, tokenSize?: string) => void;
  onUpdateSize?: (id: number, size: string) => void;
  onUpdate?: (id: number, data: Partial<MonsterInstance>) => void;
  isGeneratingAvatar?: boolean;
  // 战役资源库中的物品列表（可选）
  campaignItems?: Item[];
}

// Clean up LaTeX and markdown remnants in text
function cleanText(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .replace(/\\[（(]\s*[A-Za-z]\s*\\[)）]/g, '') // Remove \(A\) or \（B\）patterns
    .replace(/\\\(/g, '')  // Remove \(
    .replace(/\\\)/g, '')  // Remove \)
    .replace(/\\\[/g, '')  // Remove \[
    .replace(/\\\]/g, '')  // Remove \]
    .replace(/\$\$/g, '')  // Remove $$
    .replace(/\$/g, '')    // Remove $
    .trim();
}

// Clean up ability scores string from markdown table format
function cleanAbilities(text: string): string {
  return text
    .replace(/\|\s*---\s*\|/g, '') // Remove markdown table separator | --- |
    .replace(/---/g, '')           // Remove remaining ---
    .replace(/\|/g, '  ')          // Replace | with double space
    .replace(/\n+/g, '\n')         // Collapse multiple newlines
    .replace(/^\s+|\s+$/gm, '')    // Trim each line
    .trim();
}

// Parse unformatted description string into structured data
function parseDescriptionString(desc: string) {
  const result: {
    type?: string;
    alignment?: string;
    ac?: string;
    hp?: string;
    speed?: string;
    abilities?: string;
    saves?: string;
    skills?: string;
    senses?: string;
    languages?: string;
    cr?: string;
    pureDescription?: string;
  } = {};

  // Check if this looks like a stat block string
  const statPatterns = ['AC：', 'AC:', 'HP：', 'HP:', '速度：', '速度:', '力量', '豁免', '技能', '感官', '语言'];
  const isStatBlock = statPatterns.some(p => desc.includes(p));

  if (!isStatBlock) {
    result.pureDescription = desc;
    return result;
  }

  // Parse type and alignment (first part before AC)
  const acMatch = desc.match(/^(.+?)(?:AC[：:])/);
  if (acMatch) {
    result.type = acMatch[1].trim();
  }

  // Parse AC
  const acValueMatch = desc.match(/AC[：:]\s*(\d+(?:\s*[（(][^）)]+[）)])?)/);
  if (acValueMatch) result.ac = acValueMatch[1].trim();

  // Parse HP
  const hpMatch = desc.match(/HP[：:]\s*(\d+(?:\s*[（(][^）)]+[）)])?)/);
  if (hpMatch) result.hp = hpMatch[1].trim();

  // Parse Speed
  const speedMatch = desc.match(/速度[：:]\s*(\d+\s*尺)/);
  if (speedMatch) result.speed = speedMatch[1].trim();

  // Parse ability scores - handle both ASCII () and Chinese （）parentheses, and match across newlines
  const abilityMatch = desc.match(/力量\s*\d+\s*[（(][+-]?\d+[）)][\s\S]*?魅力\s*\d+\s*[（(][+-]?\d+[）)]/);
  if (abilityMatch) result.abilities = abilityMatch[0];

  // Parse saves
  const saveMatch = desc.match(/豁免[：:]\s*([^技感语挑]+)/);
  if (saveMatch) result.saves = saveMatch[1].trim();

  // Parse skills
  const skillMatch = desc.match(/技能[：:]\s*([^感语挑]+)/);
  if (skillMatch) result.skills = skillMatch[1].trim();

  // Parse senses
  const senseMatch = desc.match(/感官[：:]\s*([^语挑]+)/);
  if (senseMatch) result.senses = senseMatch[1].trim();

  // Parse languages
  const langMatch = desc.match(/语言[：:]\s*([^挑]+?)(?:\s*挑战|$)/);
  if (langMatch) result.languages = langMatch[1].trim();

  // Parse CR
  const crMatch = desc.match(/挑战等级[：:]\s*([^\s]+(?:\s*\([^)]+\))?)/);
  if (crMatch) result.cr = crMatch[1].trim();

  return result;
}

export function MonsterDetailModal({
  monster,
  open,
  onOpenChange,
  onGenerateAvatar,
  onPlaceToken,
  onUpdateSize,
  onUpdate,
  isGeneratingAvatar = false,
  campaignItems = [],
}: MonsterDetailModalProps) {
  const [selectedSize, setSelectedSize] = useState(
    monster?.token_size || (monster?.size ? dndSizeToTokenSize(monster.size) : '1x1')
  );

  // Quest management state (for NPCs) - simplified version
  const [showAddQuest, setShowAddQuest] = useState(false);
  const [newQuest, setNewQuest] = useState<{ name: string; description: string; reward: string }>({ name: '', description: '', reward: '' });

  // Inventory editing state
  const [editingCurrency, setEditingCurrency] = useState(false);
  const [tempCurrency, setTempCurrency] = useState<Currency>({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [itemPickerTab, setItemPickerTab] = useState<'preset' | 'campaign'>('preset');

  // Get quest from monster_data (simplified structure)
  const npcQuest = monster?.monster_data?.quest as { name: string; description: string; reward?: string; status?: string } | undefined;

  // Update handlers for editable fields
  const handleUpdateHP = useCallback((value: string | number) => {
    if (!monster || !onUpdate) return;
    const hp = typeof value === 'number' ? value : parseInt(value, 10);
    if (isNaN(hp)) return;
    onUpdate(monster.id, { hit_points: hp, current_hp: hp });
  }, [monster, onUpdate]);

  const handleUpdateCurrentHP = useCallback((value: string | number) => {
    if (!monster || !onUpdate) return;
    const hp = typeof value === 'number' ? value : parseInt(value, 10);
    if (isNaN(hp)) return;
    onUpdate(monster.id, { current_hp: hp });
  }, [monster, onUpdate]);

  const handleUpdateAC = useCallback((value: string | number) => {
    if (!monster || !onUpdate) return;
    const ac = typeof value === 'number' ? value : parseInt(value, 10);
    if (isNaN(ac)) return;
    onUpdate(monster.id, { armor_class: ac });
  }, [monster, onUpdate]);

  const handleUpdateXP = useCallback((value: string | number) => {
    if (!monster || !onUpdate) return;
    const xp = typeof value === 'number' ? value : parseInt(value, 10);
    if (isNaN(xp)) return;
    const updatedData = { ...(monster.monster_data || {}), xp };
    onUpdate(monster.id, { monster_data: updatedData });
  }, [monster, onUpdate]);

  // Helper to check if object has valid speed data
  const hasValidSpeeds = (obj: any) => {
    return obj && typeof obj === 'object' &&
      (obj.walk !== undefined || obj.fly !== undefined || obj.swim !== undefined);
  };

  // Helper to check if object has valid ability scores
  const hasValidAbilityData = (obj: any) => {
    return obj && typeof obj === 'object' &&
      (obj.str !== undefined || obj.dex !== undefined || obj.con !== undefined);
  };

  const handleUpdateSpeed = useCallback((speedType: string, value: string | number) => {
    if (!monster || !onUpdate) return;
    const speedValue = typeof value === 'number' ? value : parseInt(value, 10);
    if (isNaN(speedValue)) return;
    // Get current speeds, prioritizing non-empty data
    const topLevelSpeeds = hasValidSpeeds(monster.speeds) ? monster.speeds : null;
    const dataSpeeds = monster.monster_data?.speeds;
    const currentSpeeds = topLevelSpeeds || (hasValidSpeeds(dataSpeeds) ? dataSpeeds : {});
    const updatedSpeeds = { ...currentSpeeds, [speedType]: speedValue };
    onUpdate(monster.id, { speeds: updatedSpeeds });
  }, [monster, onUpdate]);

  const handleUpdateAbility = useCallback((ability: string, value: string | number) => {
    if (!monster || !onUpdate) return;
    const score = typeof value === 'number' ? value : parseInt(value, 10);
    if (isNaN(score)) return;
    const mod = Math.floor((score - 10) / 2);
    // Get current scores, prioritizing non-empty data
    const topLevelScores = hasValidAbilityData(monster.ability_scores) ? monster.ability_scores : null;
    const dataScores = monster.monster_data?.ability_scores;
    const currentScores = topLevelScores || (hasValidAbilityData(dataScores) ? dataScores : {});
    const updatedScores = { ...currentScores, [ability]: score, [`${ability}Mod`]: mod };
    onUpdate(monster.id, { ability_scores: updatedScores });
  }, [monster, onUpdate]);

  // Quest management handlers - simplified version (store in monster_data.quest)
  const handleAddQuest = useCallback(() => {
    if (!monster || !onUpdate || !newQuest.name) return;
    const updatedData = {
      ...(monster.monster_data || {}),
      quest: {
        name: newQuest.name,
        description: newQuest.description || '',
        reward: newQuest.reward || undefined,
        status: 'pending'
      }
    };
    onUpdate(monster.id, { monster_data: updatedData });
    setNewQuest({ name: '', description: '', reward: '' });
    setShowAddQuest(false);
  }, [monster, onUpdate, newQuest]);

  const handleUpdateQuestStatus = useCallback((status: string) => {
    if (!monster || !onUpdate || !npcQuest) return;
    const updatedData = {
      ...(monster.monster_data || {}),
      quest: { ...npcQuest, status }
    };
    onUpdate(monster.id, { monster_data: updatedData });
  }, [monster, onUpdate, npcQuest]);

  const handleDeleteQuest = useCallback(() => {
    if (!monster || !onUpdate) return;
    const updatedData = { ...(monster.monster_data || {}) };
    delete updatedData.quest;
    onUpdate(monster.id, { monster_data: updatedData });
  }, [monster, onUpdate]);

  // Inventory/Currency handlers
  const handleUpdateCurrency = useCallback(() => {
    if (!monster || !onUpdate) return;
    onUpdate(monster.id, { currency: tempCurrency } as any);
    setEditingCurrency(false);
  }, [monster, onUpdate, tempCurrency]);

  const handleStartEditCurrency = useCallback(() => {
    const curr = monster?.currency || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    setTempCurrency(curr);
    setEditingCurrency(true);
  }, [monster?.currency]);

  const handleRemoveItem = useCallback((index: number) => {
    if (!monster || !onUpdate) return;
    const newInventory = [...(monster.inventory || [])];
    newInventory.splice(index, 1);
    onUpdate(monster.id, { inventory: newInventory } as any);
  }, [monster, onUpdate]);

  const handleUpdateItemQuantity = useCallback((index: number, quantity: number) => {
    if (!monster || !onUpdate) return;
    const newInventory = [...(monster.inventory || [])];
    if (quantity <= 0) {
      newInventory.splice(index, 1);
    } else {
      newInventory[index] = { ...newInventory[index], quantity };
    }
    onUpdate(monster.id, { inventory: newInventory } as any);
  }, [monster, onUpdate]);

  // Add item to inventory (from preset or campaign)
  const handleAddItem = useCallback((item: InventoryItem | Item) => {
    if (!monster || !onUpdate) return;
    const newInventory = [...(monster.inventory || [])];

    // Convert Item to InventoryItem if needed
    const invItem: InventoryItem = 'campaign_id' in item ? {
      id: item.id,
      name: item.name,
      name_cn: item.name_cn,
      icon: item.avatar_url,
      quantity: 1,
      category: item.category,
    } : { ...item };

    // Check if item already exists (stack if possible)
    const existingIndex = newInventory.findIndex(i =>
      i.name === invItem.name || (i.id && i.id === invItem.id)
    );

    if (existingIndex >= 0) {
      newInventory[existingIndex] = {
        ...newInventory[existingIndex],
        quantity: (newInventory[existingIndex].quantity || 1) + (invItem.quantity || 1)
      };
    } else {
      newInventory.push(invItem);
    }

    onUpdate(monster.id, { inventory: newInventory } as any);
    setShowItemPicker(false);
  }, [monster, onUpdate]);

  // Parse description if it contains stat block - must be before early return
  const parsedDesc = useMemo(() => {
    if (monster?.monster_data?.description) {
      return parseDescriptionString(monster.monster_data.description);
    }
    return null;
  }, [monster?.monster_data?.description]);

  if (!monster) return null;

  const data = monster.monster_data;
  const isNpc = monster.entity_type === 'npc';

  // Get speed - check top-level monster.speeds first, then monster_data.speeds
  // Skip empty objects by using the hasValidSpeeds helper
  const getSpeedData = () => {
    if (hasValidSpeeds(monster.speeds)) return monster.speeds;
    const dataSpeeds = data?.speeds;
    if (hasValidSpeeds(dataSpeeds)) return dataSpeeds;
    return null;
  };
  const speedData = getSpeedData();

  // Calculate ability scores and modifiers
  const getAbilityScores = () => {
    // First check top-level monster.ability_scores (must have actual data, not empty object)
    if (hasValidAbilityData(monster.ability_scores)) {
      return monster.ability_scores;
    }
    if (!data) return null;
    // Then check monster_data.ability_scores
    const abilityData = data.ability_scores;
    if (hasValidAbilityData(abilityData)) {
      return abilityData;
    } else if (data.str !== undefined) {
      return {
        str: data.str, strMod: data.strMod,
        dex: data.dex, dexMod: data.dexMod,
        con: data.con, conMod: data.conMod,
        int: data.int, intMod: data.intMod,
        wis: data.wis, wisMod: data.wisMod,
        cha: data.cha, chaMod: data.chaMod,
      };
    }
    return null;
  };

  const abilityScores = getAbilityScores();
  const formatMod = (mod: number) => (mod >= 0 ? `+${mod}` : `${mod}`);

  // Check if we have structured data or need to use parsed description
  const hasStructuredSpeed = speedData && typeof speedData === 'object' &&
    (typeof speedData.walk === 'number' || typeof speedData.fly === 'number' ||
     typeof speedData.swim === 'number' || typeof speedData.climb === 'number' ||
     typeof speedData.burrow === 'number');
  const hasStructuredAbilities = abilityScores !== null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 750, maxHeight: '85vh' }}>
        <Dialog.Title>
          <Flex align="center" gap="3">
            {monster.avatar_url && (
              <img
                src={resolveAvatarUrl(monster.avatar_url) || ''}
                alt={monster.name_cn || monster.name}
                style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }}
              />
            )}
            <Box>
              <Text size="5" weight="bold">{monster.name_cn || monster.name}</Text>
              {monster.name_cn && monster.name && monster.name_cn !== monster.name && (
                <Text size="2" color="gray" ml="2">({monster.name})</Text>
              )}
              <Flex gap="2" mt="1" wrap="wrap">
                {monster.challenge_rating && (
                  <Badge size="2" variant="soft" color="orange">CR {monster.challenge_rating}</Badge>
                )}
                {monster.size && <Badge size="2" variant="soft">{monster.size}</Badge>}
                {monster.type && <Badge size="2" variant="soft">{monster.type}</Badge>}
                {monster.alignment && <Badge size="2" variant="soft" color="gray">{monster.alignment}</Badge>}
              </Flex>
            </Box>
          </Flex>
        </Dialog.Title>

        <ScrollArea style={{ height: 'calc(85dvh - 180px)' }}>
          <Box py="4">
            {/* Editing hint */}
            {onUpdate && (
              <Text size="1" color="gray" className="mb-2 block text-center italic">
                双击数值可编辑
              </Text>
            )}

            {/* Core Stats */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center bg-gray-900/40 rounded-lg p-3">
                <div className="text-gray-400 text-sm">生命值 HP</div>
                <div className="text-white text-xl font-bold">
                  <EditableField
                    value={monster.current_hp ?? monster.hit_points}
                    onSave={handleUpdateCurrentHP}
                    type="number"
                    min={0}
                    disabled={!onUpdate}
                    displayClassName="text-green-400"
                  />
                  /
                  <EditableField
                    value={monster.hit_points}
                    onSave={handleUpdateHP}
                    type="number"
                    min={1}
                    disabled={!onUpdate}
                  />
                </div>
                {data?.hp_formula && <div className="text-gray-500 text-xs">{data.hp_formula}</div>}
                {!data?.hp_formula && parsedDesc?.hp && (
                  <div className="text-gray-500 text-xs">{parsedDesc.hp}</div>
                )}
              </div>
              <div className="text-center bg-gray-900/40 rounded-lg p-3">
                <div className="text-gray-400 text-sm">护甲等级 AC</div>
                <div className="text-white text-xl font-bold">
                  <EditableField
                    value={monster.armor_class}
                    onSave={handleUpdateAC}
                    type="number"
                    min={0}
                    max={30}
                    disabled={!onUpdate}
                  />
                </div>
                {data?.acDesc && <div className="text-gray-500 text-xs">{data.acDesc}</div>}
                {!data?.acDesc && parsedDesc?.ac && parsedDesc.ac !== String(monster.armor_class) && (
                  <div className="text-gray-500 text-xs">{parsedDesc.ac}</div>
                )}
              </div>
              <div className="text-center bg-gray-900/40 rounded-lg p-3">
                <div className="text-gray-400 text-sm">经验值 XP</div>
                <div className="text-white text-xl font-bold">
                  <EditableField
                    value={data?.xp}
                    onSave={handleUpdateXP}
                    type="number"
                    min={0}
                    disabled={!onUpdate}
                  />
                </div>
              </div>
            </div>

            {/* Speed - structured, string, or parsed */}
            {hasStructuredSpeed && speedData ? (
              <Box mb="4" p="3" style={{ background: 'var(--gray-a3)', borderRadius: 8 }}>
                <Text size="2" weight="bold" color="amber">速度</Text>
                <Flex gap="3" mt="2" wrap="wrap">
                  {speedData.walk !== undefined && (
                    <Badge variant="soft">
                      步行 <EditableField value={speedData.walk} onSave={(v) => handleUpdateSpeed('walk', v)} type="number" min={0} disabled={!onUpdate} suffix="尺" />
                    </Badge>
                  )}
                  {speedData.fly !== undefined && speedData.fly > 0 && (
                    <Badge variant="soft" color="cyan">
                      飞行 <EditableField value={speedData.fly} onSave={(v) => handleUpdateSpeed('fly', v)} type="number" min={0} disabled={!onUpdate} suffix="尺" />
                    </Badge>
                  )}
                  {speedData.swim !== undefined && speedData.swim > 0 && (
                    <Badge variant="soft" color="blue">
                      游泳 <EditableField value={speedData.swim} onSave={(v) => handleUpdateSpeed('swim', v)} type="number" min={0} disabled={!onUpdate} suffix="尺" />
                    </Badge>
                  )}
                  {speedData.climb !== undefined && speedData.climb > 0 && (
                    <Badge variant="soft" color="green">
                      攀爬 <EditableField value={speedData.climb} onSave={(v) => handleUpdateSpeed('climb', v)} type="number" min={0} disabled={!onUpdate} suffix="尺" />
                    </Badge>
                  )}
                  {speedData.burrow !== undefined && speedData.burrow > 0 && (
                    <Badge variant="soft" color="brown">
                      掘地 <EditableField value={speedData.burrow} onSave={(v) => handleUpdateSpeed('burrow', v)} type="number" min={0} disabled={!onUpdate} suffix="尺" />
                    </Badge>
                  )}
                </Flex>
              </Box>
            ) : (typeof speedData === 'string' && speedData) ? (
              <Box mb="4" p="3" style={{ background: 'var(--gray-a3)', borderRadius: 8 }}>
                <Text size="2" weight="bold" color="amber">速度</Text>
                <Text size="2" style={{ marginLeft: 8 }}>{speedData}</Text>
              </Box>
            ) : parsedDesc?.speed && (
              <Box mb="4" p="3" style={{ background: 'var(--gray-a3)', borderRadius: 8 }}>
                <Text size="2" weight="bold" color="amber">速度</Text>
                <Text size="2" style={{ marginLeft: 8 }}>{parsedDesc.speed}</Text>
              </Box>
            )}

            {/* Ability Scores - structured or parsed */}
            {hasStructuredAbilities ? (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>属性值</Text>
                <div className="grid grid-cols-6 gap-2">
                  {[
                    { key: 'str', label: '力量', labelEn: 'STR' },
                    { key: 'dex', label: '敏捷', labelEn: 'DEX' },
                    { key: 'con', label: '体质', labelEn: 'CON' },
                    { key: 'int', label: '智力', labelEn: 'INT' },
                    { key: 'wis', label: '感知', labelEn: 'WIS' },
                    { key: 'cha', label: '魅力', labelEn: 'CHA' },
                  ].map(({ key, label, labelEn }) => {
                    const score = abilityScores![key as keyof typeof abilityScores] as number | undefined;
                    const modValue = abilityScores![`${key}Mod` as keyof typeof abilityScores] as number | undefined;
                    // Calculate mod from score if not provided (D&D formula: floor((score - 10) / 2))
                    const mod = modValue !== undefined ? modValue : (typeof score === 'number' ? Math.floor((score - 10) / 2) : undefined);
                    return (
                      <div key={key} className="text-center bg-gray-900/50 rounded-lg p-2">
                        <div className="text-gray-500 text-xs">{labelEn}</div>
                        <div className="text-white font-bold">
                          <EditableField
                            value={score}
                            onSave={(v) => handleUpdateAbility(key, v)}
                            type="number"
                            min={1}
                            max={30}
                            disabled={!onUpdate}
                          />
                        </div>
                        {mod !== undefined && (
                          <div className="text-amber-400 text-sm font-bold">{formatMod(mod)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Box>
            ) : parsedDesc?.abilities && (
              <Box mb="4" p="3" style={{ background: 'var(--gray-a3)', borderRadius: 8 }}>
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>属性值</Text>
                <Text size="2" style={{ whiteSpace: 'pre-line' }}>{cleanAbilities(parsedDesc.abilities)}</Text>
              </Box>
            )}

            {/* Saving Throws */}
            {data?.savingThrows && typeof data.savingThrows === 'object' && Object.keys(data.savingThrows).length > 0 ? (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>豁免加值</Text>
                <Flex gap="2" wrap="wrap">
                  {Object.entries(data.savingThrows).map(([key, value]) => (
                    <Badge key={key} variant="outline" color="green">
                      {key.toUpperCase()} {formatMod(value as number)}
                    </Badge>
                  ))}
                </Flex>
              </Box>
            ) : (typeof data?.savingThrows === 'string' && data.savingThrows) ? (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>豁免加值</Text>
                <Text size="2">{data.savingThrows}</Text>
              </Box>
            ) : parsedDesc?.saves && (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>豁免加值</Text>
                <Text size="2">{parsedDesc.saves}</Text>
              </Box>
            )}

            {/* Skills */}
            {data?.skills && typeof data.skills === 'object' && Object.keys(data.skills).length > 0 ? (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>技能</Text>
                <Flex gap="2" wrap="wrap">
                  {Object.entries(data.skills).map(([skill, value]) => (
                    <Badge key={skill} variant="soft" color="cyan">
                      {skill} {formatMod(value as number)}
                    </Badge>
                  ))}
                </Flex>
              </Box>
            ) : (typeof data?.skills === 'string' && data.skills) ? (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>技能</Text>
                <Text size="2">{data.skills}</Text>
              </Box>
            ) : parsedDesc?.skills && (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>技能</Text>
                <Text size="2">{parsedDesc.skills}</Text>
              </Box>
            )}

            {/* Senses & Languages */}
            <Flex gap="4" mb="4" wrap="wrap">
              {(typeof data?.senses === 'string' || parsedDesc?.senses) && (
                <Box style={{ flex: 1, minWidth: 200 }}>
                  <Text size="2" weight="bold" mb="1" style={{ display: 'block' }}>感官</Text>
                  <Text size="2" color="gray">{typeof data?.senses === 'string' ? data.senses : parsedDesc?.senses}</Text>
                </Box>
              )}
              {(typeof data?.languages === 'string' || parsedDesc?.languages) && (
                <Box style={{ flex: 1, minWidth: 200 }}>
                  <Text size="2" weight="bold" mb="1" style={{ display: 'block' }}>语言</Text>
                  <Text size="2" color="gray">{typeof data?.languages === 'string' ? data.languages : parsedDesc?.languages}</Text>
                </Box>
              )}
            </Flex>

            {/* Damage Immunities/Resistances/Vulnerabilities */}
            {(data?.damageImmunities?.length || data?.damageResistances?.length ||
              data?.damageVulnerabilities?.length || data?.conditionImmunities?.length) && (
              <Box mb="4" p="3" style={{ background: 'var(--gray-a3)', borderRadius: 8 }}>
                {data.damageImmunities?.length > 0 && (
                  <Box mb="2">
                    <Text size="2" weight="bold" color="red">伤害免疫: </Text>
                    <Text size="2">{Array.isArray(data.damageImmunities) ? data.damageImmunities.join(', ') : data.damageImmunities}</Text>
                  </Box>
                )}
                {data.damageResistances?.length > 0 && (
                  <Box mb="2">
                    <Text size="2" weight="bold" color="orange">伤害抗性: </Text>
                    <Text size="2">{Array.isArray(data.damageResistances) ? data.damageResistances.join(', ') : data.damageResistances}</Text>
                  </Box>
                )}
                {data.damageVulnerabilities?.length > 0 && (
                  <Box mb="2">
                    <Text size="2" weight="bold" color="yellow">伤害易伤: </Text>
                    <Text size="2">{Array.isArray(data.damageVulnerabilities) ? data.damageVulnerabilities.join(', ') : data.damageVulnerabilities}</Text>
                  </Box>
                )}
                {data.conditionImmunities?.length > 0 && (
                  <Box>
                    <Text size="2" weight="bold" color="purple">状态免疫: </Text>
                    <Text size="2">{Array.isArray(data.conditionImmunities) ? data.conditionImmunities.join(', ') : data.conditionImmunities}</Text>
                  </Box>
                )}
              </Box>
            )}

            {/* Description - only show if it's a pure description, not stat block */}
            {parsedDesc?.pureDescription && (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>描述</Text>
                <Text size="2" color="gray" style={{ lineHeight: 1.6 }}>{parsedDesc.pureDescription}</Text>
              </Box>
            )}

            {/* Spellcasting */}
            {data?.spellcasting && (
              <Box mb="4">
                <Text size="2" weight="bold" color="violet" mb="2" style={{ display: 'block' }}>
                  施法能力
                </Text>
                <Box p="3" style={{ background: 'var(--violet-a2)', borderRadius: 6 }}>
                  <Flex gap="3" mb="3" wrap="wrap">
                    {data.spellcasting.level && (
                      <Badge variant="soft" color="violet">{data.spellcasting.level}级施法者</Badge>
                    )}
                    {data.spellcasting.ability && (
                      <Badge variant="soft" color="violet">施法属性: {data.spellcasting.ability}</Badge>
                    )}
                    {data.spellcasting.dc && (
                      <Badge variant="soft" color="violet">法术豁免DC: {data.spellcasting.dc}</Badge>
                    )}
                    {data.spellcasting.attackBonus && (
                      <Badge variant="soft" color="violet">法术攻击: +{data.spellcasting.attackBonus}</Badge>
                    )}
                  </Flex>
                  {data.spellcasting.spells && (
                    <Box>
                      {data.spellcasting.spells.cantrips && data.spellcasting.spells.cantrips.length > 0 && (
                        <Box mb="2">
                          <Text size="2" weight="bold" color="gray">戏法（随意）</Text>
                          <Text size="2" style={{ marginLeft: 8 }}>
                            {data.spellcasting.spells.cantrips.join('、')}
                          </Text>
                        </Box>
                      )}
                      {['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'].map((level) => {
                        const levelData = data.spellcasting.spells[level];
                        if (!levelData) return null;
                        const levelNames: Record<string, string> = {
                          '1st': '1环', '2nd': '2环', '3rd': '3环', '4th': '4环', '5th': '5环',
                          '6th': '6环', '7th': '7环', '8th': '8环', '9th': '9环'
                        };
                        return (
                          <Box key={level} mb="2">
                            <Text size="2" weight="bold" color="gray">
                              {levelNames[level]}（{levelData.slots}法术位）
                            </Text>
                            <Text size="2" style={{ marginLeft: 8 }}>
                              {levelData.spells?.join('、') || '-'}
                            </Text>
                          </Box>
                        );
                      })}
                    </Box>
                  )}
                </Box>
              </Box>
            )}

            {/* Special Abilities */}
            {data?.special_abilities && data.special_abilities.length > 0 && (
              <Box mb="4">
                <Text size="2" weight="bold" color="purple" mb="2" style={{ display: 'block' }}>
                  特殊能力
                </Text>
                {data.special_abilities.map((ability: { name: string; description: string }, idx: number) => (
                  <Box key={idx} mb="2" p="3" style={{ background: 'var(--purple-a2)', borderRadius: 6 }}>
                    <Text size="2" weight="bold">{cleanText(ability.name)}</Text>
                    <Text size="2" color="gray" style={{ display: 'block', marginTop: 4 }}>
                      {cleanText(ability.description)}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}

            {/* Actions */}
            {data?.actions && (
              <Box mb="4">
                <Text size="2" weight="bold" color="red" mb="2" style={{ display: 'block' }}>
                  动作
                </Text>
                {typeof data.actions === 'string' ? (
                  // Parse action string into separate actions
                  cleanText(data.actions).split(/(?=[\u4e00-\u9fa5]+\s+[A-Z][a-z]+\s+[A-Z][a-z]+\.)/).map((action: string, idx: number) => {
                    const match = action.match(/^([\u4e00-\u9fa5]+\s+[A-Za-z\s]+)[。.]\s*(.*)/s);
                    if (match) {
                      return (
                        <Box key={idx} mb="2" p="3" style={{ background: 'var(--red-a2)', borderRadius: 6 }}>
                          <Text size="2" weight="bold">{match[1].trim()}</Text>
                          <Text size="2" color="gray" style={{ display: 'block', marginTop: 4 }}>
                            {match[2].trim()}
                          </Text>
                        </Box>
                      );
                    }
                    return (
                      <Box key={idx} mb="2" p="3" style={{ background: 'var(--red-a2)', borderRadius: 6 }}>
                        <Text size="2" color="gray">{action.trim()}</Text>
                      </Box>
                    );
                  })
                ) : Array.isArray(data.actions) && data.actions.map((action: { name: string; description: string }, idx: number) => (
                  <Box key={idx} mb="2" p="3" style={{ background: 'var(--red-a2)', borderRadius: 6 }}>
                    <Text size="2" weight="bold">{cleanText(action.name)}</Text>
                    <Text size="2" color="gray" style={{ display: 'block', marginTop: 4 }}>
                      {cleanText(action.description)}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}

            {/* Legendary Actions */}
            {data?.legendary_actions && data.legendary_actions.length > 0 && (
              <Box mb="4">
                <Text size="2" weight="bold" color="amber" mb="2" style={{ display: 'block' }}>
                  传奇动作
                </Text>
                {data.legendary_actions.map((action: { name: string; description: string }, idx: number) => (
                  <Box key={idx} mb="2" p="3" style={{ background: 'var(--amber-a2)', borderRadius: 6 }}>
                    <Text size="2" weight="bold">{cleanText(action.name)}</Text>
                    <Text size="2" color="gray" style={{ display: 'block', marginTop: 4 }}>
                      {cleanText(action.description)}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}

            {/* Reactions */}
            {data?.reactions && data.reactions.length > 0 && (
              <Box mb="4">
                <Text size="2" weight="bold" color="cyan" mb="2" style={{ display: 'block' }}>
                  反应
                </Text>
                {data.reactions.map((reaction: { name: string; description: string }, idx: number) => (
                  <Box key={idx} mb="2" p="3" style={{ background: 'var(--cyan-a2)', borderRadius: 6 }}>
                    <Text size="2" weight="bold">{cleanText(reaction.name)}</Text>
                    <Text size="2" color="gray" style={{ display: 'block', marginTop: 4 }}>
                      {cleanText(reaction.description)}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}

            {/* NPC Quest Section - Only show for NPCs (simplified single quest) */}
            {isNpc && (
              <Box mb="4" p="3" style={{ background: 'linear-gradient(135deg, var(--amber-a3), var(--orange-a3))', borderRadius: 8, border: '1px solid var(--amber-6)' }}>
                <Flex justify="between" align="center" mb="3">
                  <Flex align="center" gap="2">
                    <Text size="2" style={{ fontSize: 16 }}>📜</Text>
                    <Text size="2" weight="bold" color="amber">NPC 任务</Text>
                    {npcQuest && <Badge size="1" variant="soft" color="amber">1</Badge>}
                  </Flex>
                  {onUpdate && !npcQuest && (
                    <Button
                      size="1"
                      variant="soft"
                      color="amber"
                      onClick={() => setShowAddQuest(!showAddQuest)}
                    >
                      {showAddQuest ? '取消' : '+ 添加任务'}
                    </Button>
                  )}
                </Flex>

                {/* Add Quest Form */}
                {showAddQuest && !npcQuest && (
                  <Box mb="3" p="3" style={{ background: 'var(--gray-a4)', borderRadius: 6 }}>
                    <Flex direction="column" gap="2">
                      <TextField.Root
                        placeholder="任务名称"
                        value={newQuest.name || ''}
                        onChange={(e) => setNewQuest({ ...newQuest, name: e.target.value })}
                      />
                      <TextArea
                        placeholder="任务描述"
                        value={newQuest.description || ''}
                        onChange={(e) => setNewQuest({ ...newQuest, description: e.target.value })}
                        rows={2}
                      />
                      <TextField.Root
                        placeholder="奖励（可选）"
                        value={newQuest.reward || ''}
                        onChange={(e) => setNewQuest({ ...newQuest, reward: e.target.value })}
                      />
                      <Button size="1" color="amber" onClick={handleAddQuest} disabled={!newQuest.name}>
                        确认添加
                      </Button>
                    </Flex>
                  </Box>
                )}

                {/* Quest Display (single quest) */}
                {npcQuest ? (
                  <Box
                    p="3"
                    style={{
                      background: npcQuest.status === 'completed' ? 'var(--green-a3)' : npcQuest.status === 'in_progress' ? 'var(--blue-a3)' : 'var(--gray-a3)',
                      borderRadius: 6,
                      border: `1px solid ${npcQuest.status === 'completed' ? 'var(--green-6)' : npcQuest.status === 'in_progress' ? 'var(--blue-6)' : 'var(--gray-6)'}`
                    }}
                  >
                    <Flex justify="between" align="start" gap="3">
                      <Box style={{ flex: 1 }}>
                        {/* Quest Header */}
                        <Flex align="center" gap="2" mb="1" wrap="wrap">
                          <Text size="2" weight="bold">{npcQuest.name}</Text>
                          <Badge
                            size="1"
                            variant="soft"
                            color={npcQuest.status === 'completed' ? 'green' : npcQuest.status === 'in_progress' ? 'blue' : 'gray'}
                          >
                            {npcQuest.status === 'completed' ? '已完成' : npcQuest.status === 'in_progress' ? '进行中' : '待开始'}
                          </Badge>
                        </Flex>

                        {/* Quest Description */}
                        {npcQuest.description && (
                          <Text size="1" color="gray" style={{ display: 'block', marginBottom: 4 }}>{npcQuest.description}</Text>
                        )}

                        {/* Quest Reward */}
                        {npcQuest.reward && (
                          <Flex align="center" gap="1">
                            <Text size="1" style={{ color: 'var(--amber-11)' }}>🎁</Text>
                            <Text size="1" color="amber">{npcQuest.reward}</Text>
                          </Flex>
                        )}
                      </Box>
                      {onUpdate && (
                        <Flex direction="column" gap="1">
                          <select
                            value={npcQuest.status || 'pending'}
                            onChange={(e) => handleUpdateQuestStatus(e.target.value)}
                            className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs"
                            style={{ minWidth: 80 }}
                          >
                            <option value="pending">待开始</option>
                            <option value="in_progress">进行中</option>
                            <option value="completed">已完成</option>
                          </select>
                          <Button
                            size="1"
                            variant="ghost"
                            color="red"
                            onClick={handleDeleteQuest}
                            style={{ padding: '2px 8px' }}
                          >
                            删除
                          </Button>
                        </Flex>
                      )}
                    </Flex>
                  </Box>
                ) : (
                  <Text size="2" color="gray" style={{ fontStyle: 'italic', textAlign: 'center', display: 'block' }}>
                    暂无任务
                  </Text>
                )}
              </Box>
            )}

            {/* Inventory & Currency Section (DM only) */}
            {onUpdate && (
              <Box mb="4" p="3" style={{ background: 'linear-gradient(135deg, var(--brown-a3), var(--orange-a3))', borderRadius: 8, border: '1px solid var(--brown-6)' }}>
                <Flex justify="between" align="center" mb="3">
                  <Flex align="center" gap="2">
                    <Text size="2" style={{ fontSize: 16 }}>🎒</Text>
                    <Text size="2" weight="bold" color="orange">物品栏 & 金钱</Text>
                    {((monster.inventory?.length || 0) > 0 || (monster.currency && Object.values(monster.currency).some(v => v > 0))) && (
                      <Badge size="1" variant="soft" color="orange">
                        {(monster.inventory?.length || 0) + ((monster.currency && Object.values(monster.currency).some(v => v > 0)) ? 1 : 0)}
                      </Badge>
                    )}
                  </Flex>
                </Flex>

                {/* Currency Display/Edit */}
                <Box mb="3" p="2" style={{ background: 'var(--gray-a4)', borderRadius: 6 }}>
                  <Flex justify="between" align="center" mb="2">
                    <Text size="2" weight="bold" color="amber">💰 金钱</Text>
                    {!editingCurrency ? (
                      <Button size="1" variant="ghost" color="amber" onClick={handleStartEditCurrency}>
                        编辑
                      </Button>
                    ) : (
                      <Flex gap="1">
                        <Button size="1" variant="soft" color="green" onClick={handleUpdateCurrency}>保存</Button>
                        <Button size="1" variant="ghost" color="gray" onClick={() => setEditingCurrency(false)}>取消</Button>
                      </Flex>
                    )}
                  </Flex>
                  {editingCurrency ? (
                    <Flex gap="2" wrap="wrap">
                      {[
                        { key: 'pp', label: '白金', color: '#E5E5E5' },
                        { key: 'gp', label: '金币', color: '#FFD700' },
                        { key: 'ep', label: '银金', color: '#C0C0C0' },
                        { key: 'sp', label: '银币', color: '#A8A8A8' },
                        { key: 'cp', label: '铜币', color: '#B87333' },
                      ].map(({ key, label, color }) => (
                        <Flex key={key} align="center" gap="1" style={{ minWidth: 80 }}>
                          <Text size="1" style={{ color }}>{label}</Text>
                          <TextField.Root
                            size="1"
                            type="number"
                            min={0}
                            value={tempCurrency[key as keyof Currency]}
                            onChange={(e) => setTempCurrency({ ...tempCurrency, [key]: parseInt(e.target.value) || 0 })}
                            style={{ width: 60 }}
                          />
                        </Flex>
                      ))}
                    </Flex>
                  ) : (
                    <Flex gap="3" wrap="wrap">
                      {[
                        { key: 'pp', label: '白金', color: '#E5E5E5' },
                        { key: 'gp', label: '金币', color: '#FFD700' },
                        { key: 'ep', label: '银金', color: '#C0C0C0' },
                        { key: 'sp', label: '银币', color: '#A8A8A8' },
                        { key: 'cp', label: '铜币', color: '#B87333' },
                      ].map(({ key, label, color }) => {
                        const value = monster.currency?.[key as keyof Currency] || 0;
                        if (value === 0) return null;
                        return (
                          <Badge key={key} size="1" variant="soft" style={{ background: `${color}20`, color }}>
                            {label}: {value}
                          </Badge>
                        );
                      })}
                      {(!monster.currency || Object.values(monster.currency).every(v => v === 0)) && (
                        <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>无金钱</Text>
                      )}
                    </Flex>
                  )}
                </Box>

                {/* Inventory Items */}
                <Box p="2" style={{ background: 'var(--gray-a4)', borderRadius: 6 }}>
                  <Flex justify="between" align="center" mb="2">
                    <Text size="2" weight="bold" color="orange">📦 物品</Text>
                    <Button size="1" variant="soft" color="orange" onClick={() => setShowItemPicker(!showItemPicker)}>
                      {showItemPicker ? '取消' : '+ 添加'}
                    </Button>
                  </Flex>

                  {/* Item Picker */}
                  {showItemPicker && (
                    <Box mb="2" p="2" style={{ background: 'var(--gray-a5)', borderRadius: 4, border: '1px solid var(--orange-6)' }}>
                      {/* Tabs */}
                      <Flex gap="2" mb="2">
                        <Button
                          size="1"
                          variant={itemPickerTab === 'preset' ? 'solid' : 'soft'}
                          color="orange"
                          onClick={() => setItemPickerTab('preset')}
                        >
                          预设物品
                        </Button>
                        {campaignItems.length > 0 && (
                          <Button
                            size="1"
                            variant={itemPickerTab === 'campaign' ? 'solid' : 'soft'}
                            color="orange"
                            onClick={() => setItemPickerTab('campaign')}
                          >
                            资源库 ({campaignItems.length})
                          </Button>
                        )}
                      </Flex>

                      {/* Item Grid */}
                      <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                        <Flex gap="1" wrap="wrap">
                          {itemPickerTab === 'preset' ? (
                            PRESET_LOOT_ITEMS.map((item, idx) => (
                              <Button
                                key={idx}
                                size="1"
                                variant="soft"
                                color="gray"
                                onClick={() => handleAddItem(item)}
                                style={{ fontSize: 11 }}
                              >
                                {item.name_cn || item.name}
                              </Button>
                            ))
                          ) : (
                            campaignItems.map((item) => (
                              <Button
                                key={item.id}
                                size="1"
                                variant="soft"
                                color="gray"
                                onClick={() => handleAddItem(item)}
                                style={{ fontSize: 11 }}
                              >
                                <Flex align="center" gap="1">
                                  {item.avatar_url && (
                                    <img src={resolveAvatarUrl(item.avatar_url) || ''} alt="" style={{ width: 14, height: 14, borderRadius: 2 }} />
                                  )}
                                  {item.name_cn || item.name}
                                </Flex>
                              </Button>
                            ))
                          )}
                        </Flex>
                      </div>
                    </Box>
                  )}

                  {/* Inventory List */}
                  {monster.inventory && monster.inventory.length > 0 ? (
                    <Flex direction="column" gap="2">
                      {monster.inventory.map((item, index) => (
                        <Flex key={index} align="center" justify="between" p="2" style={{ background: 'var(--gray-a3)', borderRadius: 4 }}>
                          <Flex align="center" gap="2">
                            {item.icon && (
                              <img src={resolveAvatarUrl(item.icon) || ''} alt={item.name} style={{ width: 24, height: 24, borderRadius: 4 }} />
                            )}
                            <Text size="2">{item.name_cn || item.name}</Text>
                            {item.category && <Badge size="1" variant="outline" color="gray">{tCategory(item.category)}</Badge>}
                          </Flex>
                          <Flex align="center" gap="2">
                            <Flex align="center" gap="1">
                              <Button
                                size="1"
                                variant="ghost"
                                color="gray"
                                onClick={() => handleUpdateItemQuantity(index, item.quantity - 1)}
                              >
                                -
                              </Button>
                              <Text size="2" style={{ minWidth: 20, textAlign: 'center' }}>{item.quantity}</Text>
                              <Button
                                size="1"
                                variant="ghost"
                                color="gray"
                                onClick={() => handleUpdateItemQuantity(index, item.quantity + 1)}
                              >
                                +
                              </Button>
                            </Flex>
                            <Button size="1" variant="ghost" color="red" onClick={() => handleRemoveItem(index)}>
                              ✕
                            </Button>
                          </Flex>
                        </Flex>
                      ))}
                    </Flex>
                  ) : !showItemPicker && (
                    <Text size="1" color="gray" style={{ fontStyle: 'italic', textAlign: 'center', display: 'block' }}>
                      无物品
                    </Text>
                  )}
                </Box>
              </Box>
            )}

            {/* Token Size Setting */}
            <Box mb="4" p="3" style={{ background: 'var(--gray-a3)', borderRadius: 8 }}>
              <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>Token设置</Text>
              <Flex gap="3" align="center">
                <Text size="2">Token大小:</Text>
                <select
                  value={selectedSize}
                  onChange={(e) => {
                    const newSize = e.target.value;
                    setSelectedSize(newSize);
                    onUpdateSize?.(monster.id, newSize);
                  }}
                  className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
                >
                  <option value="0.4x0.4">0.4x0.4 (微型 Tiny)</option>
                  <option value="0.65x0.65">0.65x0.65 (小型 Small)</option>
                  <option value="1x1">1x1 (中型 Medium)</option>
                  <option value="2x2">2x2 (大型 Large)</option>
                  <option value="3x3">3x3 (超大型 Huge)</option>
                  <option value="4x4">4x4 (巨型 Gargantuan)</option>
                  <option value="2x3">2x3 (长型)</option>
                  <option value="3x2">3x2 (宽型)</option>
                </select>
                <Badge size="2" variant="soft" color="cyan">{selectedSize}</Badge>
              </Flex>
            </Box>

            {/* Avatar Preview */}
            {monster.avatar_url && (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>头像预览</Text>
                <img
                  src={resolveAvatarUrl(monster.avatar_url_large || monster.avatar_url) || ''}
                  alt={monster.name_cn || monster.name}
                  style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8, objectFit: 'cover' }}
                />
              </Box>
            )}
          </Box>
        </ScrollArea>

        {/* Footer Actions */}
        <Flex gap="3" mt="4" justify="end">
          <Button
            variant="soft"
            color="purple"
            onClick={() => onGenerateAvatar?.(monster.id)}
            disabled={isGeneratingAvatar}
          >
            <span>{isGeneratingAvatar ? '生成中...' : monster.has_avatar ? '更换头像' : '生成头像'}</span>
          </Button>
          <Button
            variant="soft"
            color="amber"
            onClick={() => onPlaceToken?.(monster.id, selectedSize)}
            disabled={!monster.has_avatar}
          >
            <span>生成Token</span>
          </Button>
          <Dialog.Close>
            <Button variant="soft" color="gray"><span>关闭</span></Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
