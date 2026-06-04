/**
 * ItemPreviewEditor - 预览+编辑AI解析后的物品数据
 * 注意：所有下拉用原生 <select>，因为 Radix Select portal 在 Dialog 内会被 overlay 挡住
 */

import React from 'react';
import { Flex, Text, TextField, TextArea, Box, Button, Badge, ScrollArea } from '@radix-ui/themes';
import { ItemAbilitiesEditor, type ItemAbility, type ItemCharges, type ItemSpell } from './ItemAbilitiesEditor';

const API_BASE = import.meta.env.VITE_API_URL || '';

// 原生 select 的统一样式
const nativeSelectStyle: React.CSSProperties = {
  width: '100%', height: 32, borderRadius: 6, border: '1px solid var(--gray-7)',
  background: 'var(--color-surface)', color: 'var(--gray-12)',
  padding: '0 8px', fontSize: 13, outline: 'none', cursor: 'pointer',
};
const nativeSelectSmallStyle: React.CSSProperties = { ...nativeSelectStyle, height: 28, fontSize: 12 };

// 解析后的物品数据结构（与后端 LLM 输出一致）
export interface ParsedItemData {
  name: string;
  name_en?: string;
  category: string;
  subcategory?: string;
  rarity: string;
  description?: string;
  cost?: { amount: number; unit: string } | null;
  weight?: number | null;
  damage?: { dice: string; type: string } | null;
  extra_damage?: { dice: string; type: string; condition?: string } | null;
  range?: { normal: number; long?: number } | null;
  armor_class?: { base: number; dex_bonus?: boolean } | null;
  properties?: string[];
  requires_attunement?: boolean;
  attunement_by?: string;
  magic_bonus?: number | null;
  abilities?: ItemAbility[];
  charges?: ItemCharges | null;
  item_spells?: ItemSpell[];
}

const CATEGORY_OPTIONS = [
  { value: 'weapon', label: '武器' },
  { value: 'armor', label: '护甲' },
  { value: 'ammunition', label: '弹药' },
  { value: 'wondrous_item', label: '奇物' },
  { value: 'wand', label: '魔杖' },
  { value: 'rod', label: '权杖' },
  { value: 'ring', label: '戒指' },
  { value: 'potion', label: '药水' },
  { value: 'scroll', label: '卷轴' },
  { value: 'staff', label: '法杖' },
  { value: 'adventuring_gear', label: '冒险装备' },
  { value: 'tool', label: '工具' },
];

export const RARITY_OPTIONS = [
  { value: 'common', label: '普通', color: 'gray' as const },
  { value: 'uncommon', label: '非凡', color: 'green' as const },
  { value: 'rare', label: '稀有', color: 'blue' as const },
  { value: 'very_rare', label: '非常稀有', color: 'purple' as const },
  { value: 'legendary', label: '传奇', color: 'orange' as const },
  { value: 'artifact', label: '神器', color: 'red' as const },
];

export const DAMAGE_TYPE_OPTIONS = [
  { value: 'slashing', label: '挥砍' },
  { value: 'piercing', label: '穿刺' },
  { value: 'bludgeoning', label: '钝击' },
  { value: 'fire', label: '火焰' },
  { value: 'cold', label: '冰冷' },
  { value: 'lightning', label: '闪电' },
  { value: 'thunder', label: '雷鸣' },
  { value: 'acid', label: '强酸' },
  { value: 'poison', label: '毒素' },
  { value: 'necrotic', label: '黯蚀' },
  { value: 'radiant', label: '光耀' },
  { value: 'psychic', label: '心灵' },
  { value: 'force', label: '力场' },
];

export const WEAPON_PROPERTY_OPTIONS = [
  { value: 'ammunition', label: '弹药' },
  { value: 'finesse', label: '灵巧' },
  { value: 'heavy', label: '沉重' },
  { value: 'light', label: '轻型' },
  { value: 'loading', label: '装填' },
  { value: 'range', label: '射程' },
  { value: 'reach', label: '长柄' },
  { value: 'special', label: '特殊' },
  { value: 'thrown', label: '投掷' },
  { value: 'two-handed', label: '双手' },
  { value: 'versatile', label: '灵活' },
];

interface Props {
  item: ParsedItemData;
  avatarUrl: string | null;
  avatarUrlLarge?: string | null;
  onChange: (item: ParsedItemData) => void;
  onRegenerateAvatar: () => void;
  isRegeneratingAvatar?: boolean;
}

export function ItemPreviewEditor({ item, avatarUrl, onChange, onRegenerateAvatar, isRegeneratingAvatar }: Props) {
  const set = (patch: Partial<ParsedItemData>) => onChange({ ...item, ...patch });
  const rarityInfo = RARITY_OPTIONS.find(r => r.value === item.rarity);
  const isWeapon = item.category === 'weapon';
  const isArmor = item.category === 'armor';

  return (
    <ScrollArea style={{ maxHeight: 'calc(70vh - 120px)' }}>
      <Flex direction="column" gap="3" pr="3">
        {/* 头像 + 名称 + 稀有度 */}
        <Flex gap="3" align="start">
          <Box style={{ flexShrink: 0 }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt={item.name} style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--gray-6)' }} />
            ) : (
              <Box style={{ width: 80, height: 80, borderRadius: 8, background: 'var(--gray-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Text size="1" color="gray">无图</Text>
              </Box>
            )}
            <Button size="1" variant="soft" mt="1" onClick={onRegenerateAvatar} disabled={isRegeneratingAvatar} style={{ width: '100%' }}>
              {isRegeneratingAvatar ? '生成中...' : '重新生成'}
            </Button>
          </Box>
          <Flex direction="column" gap="2" style={{ flex: 1 }}>
            <Box>
              <Text size="1" color="gray">名称</Text>
              <TextField.Root value={item.name} onChange={e => set({ name: e.target.value })} />
            </Box>
            <Flex gap="2">
              <Box style={{ flex: 1 }}>
                <Text size="1" color="gray">类别</Text>
                <select style={nativeSelectStyle} value={item.category} onChange={e => set({ category: e.target.value })}>
                  {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="1" color="gray">稀有度</Text>
                <select style={nativeSelectStyle} value={item.rarity} onChange={e => set({ rarity: e.target.value })}>
                  {RARITY_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Box>
            </Flex>
            {rarityInfo && <Badge size="1" color={rarityInfo.color} variant="soft">{rarityInfo.label}</Badge>}
          </Flex>
        </Flex>

        {/* 基础属性 */}
        <Flex gap="2" wrap="wrap">
          <Box style={{ width: 100 }}>
            <Text size="1" color="gray">重量(磅)</Text>
            <TextField.Root size="1" type="number" value={item.weight ?? ''} onChange={e => set({ weight: e.target.value ? parseFloat(e.target.value) : null })} />
          </Box>
          <Box style={{ width: 100 }}>
            <Text size="1" color="gray">价格</Text>
            <TextField.Root size="1" type="number" value={item.cost?.amount ?? ''} onChange={e => {
              const amt = parseFloat(e.target.value);
              set({ cost: isNaN(amt) ? null : { amount: amt, unit: item.cost?.unit || 'gp' } });
            }} placeholder="金额" />
          </Box>
          <Box style={{ width: 70 }}>
            <Text size="1" color="gray">单位</Text>
            <select style={nativeSelectSmallStyle} value={item.cost?.unit || 'gp'} onChange={e => set({ cost: item.cost ? { ...item.cost, unit: e.target.value } : { amount: 0, unit: e.target.value } })}>
              <option value="gp">gp</option>
              <option value="sp">sp</option>
              <option value="cp">cp</option>
            </select>
          </Box>
          <Box style={{ width: 90 }}>
            <Text size="1" color="gray">魔法加值</Text>
            <TextField.Root size="1" type="number" value={item.magic_bonus ?? ''} onChange={e => set({ magic_bonus: e.target.value ? parseInt(e.target.value) : null })} placeholder="+1" />
          </Box>
        </Flex>

        {/* 同调 */}
        <Flex gap="2" align="end">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!item.requires_attunement} onChange={e => set({ requires_attunement: e.target.checked })} />
            <Text size="2">需要同调</Text>
          </label>
          {item.requires_attunement && (
            <Box style={{ flex: 1 }}>
              <TextField.Root size="1" value={item.attunement_by ?? ''} onChange={e => set({ attunement_by: e.target.value || undefined })} placeholder="限制条件（如 法术施放者）" />
            </Box>
          )}
        </Flex>

        {/* 武器属性 */}
        {isWeapon && (
          <Box p="2" style={{ background: 'var(--red-2)', borderRadius: 6 }}>
            <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>武器属性</Text>
            <Flex gap="2" wrap="wrap">
              <Box style={{ width: 90 }}>
                <Text size="1" color="gray">伤害骰</Text>
                <TextField.Root size="1" value={item.damage?.dice ?? ''} onChange={e => set({ damage: { dice: e.target.value, type: item.damage?.type || 'slashing' } })} placeholder="1d8" />
              </Box>
              <Box style={{ width: 100 }}>
                <Text size="1" color="gray">伤害类型</Text>
                <select style={nativeSelectSmallStyle} value={item.damage?.type || 'slashing'} onChange={e => set({ damage: { dice: item.damage?.dice || '', type: e.target.value } })}>
                  {DAMAGE_TYPE_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </Box>
              <Box style={{ width: 90 }}>
                <Text size="1" color="gray">额外伤害</Text>
                <TextField.Root size="1" value={item.extra_damage?.dice ?? ''} onChange={e => {
                  if (!e.target.value) { set({ extra_damage: null }); return; }
                  set({ extra_damage: { dice: e.target.value, type: item.extra_damage?.type || 'fire' } });
                }} placeholder="1d6" />
              </Box>
              <Box style={{ width: 100 }}>
                <Text size="1" color="gray">额外类型</Text>
                <select style={nativeSelectSmallStyle} value={item.extra_damage?.type || 'fire'} onChange={e => set({ extra_damage: item.extra_damage ? { ...item.extra_damage, type: e.target.value } : { dice: '1d6', type: e.target.value } })}>
                  {DAMAGE_TYPE_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </Box>
            </Flex>
            <Flex gap="2" mt="2">
              <Box style={{ width: 90 }}>
                <Text size="1" color="gray">射程</Text>
                <TextField.Root size="1" type="number" value={item.range?.normal ?? ''} onChange={e => {
                  const n = parseInt(e.target.value);
                  set({ range: isNaN(n) ? null : { normal: n, long: item.range?.long } });
                }} placeholder="常规" />
              </Box>
              <Box style={{ width: 90 }}>
                <Text size="1" color="gray">最大射程</Text>
                <TextField.Root size="1" type="number" value={item.range?.long ?? ''} onChange={e => {
                  if (!item.range) return;
                  set({ range: { ...item.range, long: parseInt(e.target.value) || undefined } });
                }} placeholder="最大" />
              </Box>
            </Flex>
            <Box mt="2">
              <Text size="1" color="gray" mb="1" style={{ display: 'block' }}>武器特性</Text>
              <Flex gap="1" wrap="wrap">
                {WEAPON_PROPERTY_OPTIONS.map(wp => {
                  const props = item.properties || [];
                  const active = props.includes(wp.value);
                  return (
                    <Badge
                      key={wp.value} size="1"
                      variant={active ? 'solid' : 'outline'}
                      color={active ? 'amber' : 'gray'}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => {
                        const next = active ? props.filter(p => p !== wp.value) : [...props, wp.value];
                        set({ properties: next });
                      }}
                    >{wp.label}</Badge>
                  );
                })}
              </Flex>
            </Box>
          </Box>
        )}

        {/* 护甲属性 */}
        {isArmor && (
          <Box p="2" style={{ background: 'var(--blue-2)', borderRadius: 6 }}>
            <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>护甲属性</Text>
            <Flex gap="2">
              <Box style={{ width: 80 }}>
                <Text size="1" color="gray">AC基础值</Text>
                <TextField.Root size="1" type="number" value={item.armor_class?.base ?? ''} onChange={e => set({ armor_class: { base: parseInt(e.target.value) || 0, dex_bonus: item.armor_class?.dex_bonus } })} />
              </Box>
              <label style={{ display: 'flex', alignItems: 'end', gap: 4, cursor: 'pointer', paddingBottom: 4 }}>
                <input type="checkbox" checked={!!item.armor_class?.dex_bonus} onChange={e => set({ armor_class: { base: item.armor_class?.base || 0, dex_bonus: e.target.checked } })} />
                <Text size="1">+敏捷加值</Text>
              </label>
            </Flex>
          </Box>
        )}

        {/* 描述 */}
        <Box>
          <Text size="1" color="gray">描述</Text>
          <TextArea value={item.description ?? ''} onChange={e => set({ description: e.target.value })} style={{ minHeight: 80 }} />
        </Box>

        {/* 能力 / 充能 / 法术 */}
        <ItemAbilitiesEditor
          abilities={item.abilities || []}
          charges={item.charges || null}
          itemSpells={item.item_spells || []}
          onChange={(field, value) => set({ [field]: value })}
        />
      </Flex>
    </ScrollArea>
  );
}
