/**
 * ItemAbilitiesEditor - 编辑物品的 abilities / charges / item_spells
 */

import React from 'react';
import { Flex, Text, Button, TextField, TextArea, Box, IconButton } from '@radix-ui/themes';

// ============ Types ============
export interface ItemAbility {
  name: string;
  type: 'passive' | 'active' | 'rechargeable' | 'triggered';
  description: string;
  condition?: string;
  uses?: { per: string; max: number } | null;
}

export interface ItemCharges {
  max: number;
  recharge?: { time: string; amount: string };
}

export interface ItemSpell {
  name: string;
  charges: number;
  level?: number | string;
}

interface Props {
  abilities: ItemAbility[];
  charges: ItemCharges | null;
  itemSpells: ItemSpell[];
  onChange: (field: 'abilities' | 'charges' | 'item_spells', value: unknown) => void;
}

const ABILITY_TYPES = [
  { value: 'passive', label: '被动' },
  { value: 'active', label: '主动' },
  { value: 'rechargeable', label: '充能' },
  { value: 'triggered', label: '触发' },
] as const;

const REST_TYPES = [
  { value: 'day', label: '每天' },
  { value: 'long_rest', label: '长休' },
  { value: 'short_rest', label: '短休' },
] as const;

export function ItemAbilitiesEditor({ abilities, charges, itemSpells, onChange }: Props) {
  // ============ Abilities ============
  const updateAbility = (idx: number, patch: Partial<ItemAbility>) => {
    const next = abilities.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    onChange('abilities', next);
  };

  const addAbility = () => {
    onChange('abilities', [...abilities, { name: '', type: 'active', description: '' }]);
  };

  const removeAbility = (idx: number) => {
    onChange('abilities', abilities.filter((_, i) => i !== idx));
  };

  // ============ Item Spells ============
  const updateSpell = (idx: number, patch: Partial<ItemSpell>) => {
    const next = itemSpells.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange('item_spells', next);
  };

  const addSpell = () => {
    onChange('item_spells', [...itemSpells, { name: '', charges: 1, level: 0 }]);
  };

  const removeSpell = (idx: number) => {
    onChange('item_spells', itemSpells.filter((_, i) => i !== idx));
  };

  return (
    <Flex direction="column" gap="3">
      {/* ===== Abilities ===== */}
      <Flex justify="between" align="center">
        <Text size="2" weight="bold">特殊能力</Text>
        <Button size="1" variant="soft" onClick={addAbility}>+ 添加</Button>
      </Flex>
      {abilities.map((ab, idx) => (
        <Box key={idx} p="2" style={{ border: '1px solid var(--gray-6)', borderRadius: 6 }}>
          <Flex gap="2" mb="2" align="end">
            <Box style={{ flex: 1 }}>
              <Text size="1" color="gray">名称</Text>
              <TextField.Root size="1" value={ab.name} onChange={e => updateAbility(idx, { name: e.target.value })} />
            </Box>
            <Box style={{ width: 90 }}>
              <Text size="1" color="gray">类型</Text>
              <select
                style={{ width: '100%', height: 28, borderRadius: 6, border: '1px solid var(--gray-7)', background: 'var(--color-surface)', color: 'var(--gray-12)', padding: '0 8px', fontSize: 12 }}
                value={ab.type}
                onChange={e => updateAbility(idx, { type: e.target.value as ItemAbility['type'] })}
              >
                {ABILITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Box>
            <IconButton size="1" variant="ghost" color="red" onClick={() => removeAbility(idx)}>
              <span style={{ fontSize: 14 }}>×</span>
            </IconButton>
          </Flex>
          <TextArea size="1" value={ab.description} onChange={e => updateAbility(idx, { description: e.target.value })} placeholder="能力描述" style={{ minHeight: 50 }} />
          <Flex gap="2" mt="1" align="end">
            <Box style={{ width: 80 }}>
              <Text size="1" color="gray">次数</Text>
              <TextField.Root size="1" type="number" value={ab.uses?.max ?? ''} onChange={e => {
                const max = parseInt(e.target.value);
                if (isNaN(max) || max <= 0) {
                  updateAbility(idx, { uses: null });
                } else {
                  updateAbility(idx, { uses: { per: ab.uses?.per || 'day', max } });
                }
              }} placeholder="-" />
            </Box>
            {ab.uses && (
              <Box style={{ width: 90 }}>
                <Text size="1" color="gray">恢复</Text>
                <select
                  style={{ width: '100%', height: 28, borderRadius: 6, border: '1px solid var(--gray-7)', background: 'var(--color-surface)', color: 'var(--gray-12)', padding: '0 8px', fontSize: 12 }}
                  value={ab.uses.per}
                  onChange={e => updateAbility(idx, { uses: { ...ab.uses!, per: e.target.value } })}
                >
                  {REST_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Box>
            )}
          </Flex>
        </Box>
      ))}

      {/* ===== Charges ===== */}
      <Flex justify="between" align="center">
        <Text size="2" weight="bold">充能</Text>
        {!charges ? (
          <Button size="1" variant="soft" onClick={() => onChange('charges', { max: 3, recharge: { time: 'dawn', amount: '1d3' } })}>+ 添加</Button>
        ) : (
          <Button size="1" variant="ghost" color="red" onClick={() => onChange('charges', null)}>移除</Button>
        )}
      </Flex>
      {charges && (
        <Box p="2" style={{ border: '1px solid var(--gray-6)', borderRadius: 6 }}>
          <Flex gap="2" align="end">
            <Box style={{ width: 80 }}>
              <Text size="1" color="gray">最大值</Text>
              <TextField.Root size="1" type="number" value={charges.max} onChange={e => onChange('charges', { ...charges, max: parseInt(e.target.value) || 0 })} />
            </Box>
            <Box style={{ flex: 1 }}>
              <Text size="1" color="gray">恢复时机</Text>
              <TextField.Root size="1" value={charges.recharge?.time ?? ''} onChange={e => onChange('charges', { ...charges, recharge: { ...charges.recharge, time: e.target.value, amount: charges.recharge?.amount ?? '' } })} placeholder="dawn" />
            </Box>
            <Box style={{ flex: 1 }}>
              <Text size="1" color="gray">恢复量</Text>
              <TextField.Root size="1" value={charges.recharge?.amount ?? ''} onChange={e => onChange('charges', { ...charges, recharge: { ...charges.recharge, time: charges.recharge?.time ?? '', amount: e.target.value } })} placeholder="1d6+1" />
            </Box>
          </Flex>
        </Box>
      )}

      {/* ===== Item Spells ===== */}
      <Flex justify="between" align="center">
        <Text size="2" weight="bold">内含法术</Text>
        <Button size="1" variant="soft" onClick={addSpell}>+ 添加</Button>
      </Flex>
      {itemSpells.map((sp, idx) => (
        <Flex key={idx} gap="2" align="end">
          <Box style={{ flex: 1 }}>
            <Text size="1" color="gray">法术名</Text>
            <TextField.Root size="1" value={sp.name} onChange={e => updateSpell(idx, { name: e.target.value })} />
          </Box>
          <Box style={{ width: 70 }}>
            <Text size="1" color="gray">消耗</Text>
            <TextField.Root size="1" type="number" value={sp.charges} onChange={e => updateSpell(idx, { charges: parseInt(e.target.value) || 0 })} />
          </Box>
          <Box style={{ width: 70 }}>
            <Text size="1" color="gray">环阶</Text>
            <TextField.Root size="1" type="number" value={sp.level ?? ''} onChange={e => updateSpell(idx, { level: parseInt(e.target.value) || 0 })} />
          </Box>
          <IconButton size="1" variant="ghost" color="red" onClick={() => removeSpell(idx)}>
            <span style={{ fontSize: 14 }}>×</span>
          </IconButton>
        </Flex>
      ))}
    </Flex>
  );
}
