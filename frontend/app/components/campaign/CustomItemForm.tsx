import React, { useState } from 'react';
import { Box, Button, Flex, Text, TextField, Select, Badge } from '@radix-ui/themes';
import { getApiEndpoint } from '../../config/api';

interface Props {
  campaignId: string;
  shopId: number;
  onSuccess?: () => void;
}

export const CustomItemForm: React.FC<Props> = ({ campaignId, shopId, onSuccess }) => {
  const [name, setName] = useState('');
  const [nameCn, setNameCn] = useState('');
  const [category, setCategory] = useState<'weapons' | 'armor' | 'gear' | ''>('');
  const [subcategory, setSubcategory] = useState('');
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState<string>('');
  const [qty, setQty] = useState<number>(1);
  const [price, setPrice] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>('');
  const [ok, setOk] = useState<string>('');
  const [genAvatar, setGenAvatar] = useState<boolean>(false);

  const nonTradable = !price || price <= 0;

  const submit = async () => {
    setErr(''); setOk('');
    if (!name.trim()) { setErr('名称必填'); return; }
    if (!category) { setErr('类别必选'); return; }
    try {
      setBusy(true);
      // 1) Create Item
      const payload: any = {
        campaign_id: parseInt(campaignId),
        name: name.trim(),
        name_cn: nameCn.trim() || undefined,
        category,
        subcategory: subcategory.trim() || undefined,
        description: description.trim() || undefined,
        description_cn: description.trim() || undefined,
        weight: weight ? parseFloat(weight) : undefined,
        quantity: 1,
        rarity: 'common',
      };
      const r1 = await fetch(getApiEndpoint('/api/items'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!r1.ok) {
        const t = await r1.text();
        throw new Error('创建物品失败: ' + t);
      }
      const item = await r1.json();

      // 2) Add to shop inventory
      const r2 = await fetch(getApiEndpoint(`/api/shops/${shopId}/inventory`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, quantity: Math.max(1, qty|0), price_gp: Number(price || 0) })
      });
      if (!r2.ok) {
        const t = await r2.text();
        throw new Error('加入库存失败: ' + t);
      }

      // 3) Optionally generate avatar for the newly created item (placeholder)
      if (genAvatar) {
        const r3 = await fetch(getApiEndpoint(`/api/items/${item.id}/generate-avatar`), { method: 'POST' });
        if (!r3.ok) {
          const t = await r3.text();
          throw new Error('生成头像失败: ' + t);
        }
      }

      setOk(genAvatar ? '已创建、已加入库存并生成头像' : '已创建并加入库存');
      setName(''); setNameCn(''); setSubcategory(''); setDescription(''); setWeight(''); setQty(1); setPrice(0); setGenAvatar(false);
      onSuccess?.();
    } catch (e: any) {
      setErr(e?.message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box className="p-3 border border-gray-700 rounded">
      <Text size="2" weight="bold">创建自定义物品并加入库存</Text>
      <div className="text-[11px] text-gray-500 mt-1">类别必填；价格可不填或≤0，视为不可交易。</div>

      {err && <div className="text-xs text-red-400 mt-2">{err}</div>}
      {ok && <div className="text-xs text-green-400 mt-2">{ok}</div>}

      <Flex direction="column" gap="2" mt="3">
        <TextField.Root placeholder="名称 (必填)" value={name} onChange={(e)=> setName(e.target.value)} />
        <TextField.Root placeholder="中文名 (可选)" value={nameCn} onChange={(e)=> setNameCn(e.target.value)} />

        <Flex gap="2" wrap="wrap">
          <div>
            <div className="text-xs text-gray-400 mb-1">类别 (必选)</div>
            <select className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm" value={category} onChange={(e)=> setCategory(e.target.value as any)}>
              <option value="">选择类别</option>
              <option value="weapons">武器</option>
              <option value="armor">护甲</option>
              <option value="gear">冒险装备</option>
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">子类别 (可选)</div>
            <TextField.Root placeholder="例如：simple_melee / light_armor / standard" value={subcategory} onChange={(e)=> setSubcategory(e.target.value)} />
          </div>
        </Flex>

        <TextField.Root placeholder="重量 (lb，可选)" value={weight} onChange={(e)=> setWeight(e.target.value)} />
        <textarea placeholder="描述 (可选)" value={description} onChange={(e)=> setDescription(e.target.value)} className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm min-h-[80px]" />

        <Flex gap="2" wrap="wrap" align="center">
          <div>
            <div className="text-xs text-gray-400 mb-1">数量</div>
            <input type="number" min={1} value={qty} onChange={(e)=> setQty(Math.max(1, parseInt(e.target.value||'1')))} className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm w-24" />
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">价格 (gp)</div>
            <input type="number" min={0} step={0.01} value={price} onChange={(e)=> setPrice(parseFloat(e.target.value||'0'))} className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm w-28" />
          </div>
          {nonTradable && <Badge size="1" variant="soft" color="gray">不可交易</Badge>}
        </Flex>

        <div className="flex items-center justify-between mt-2">
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input type="checkbox" className="accent-amber-400" checked={genAvatar} onChange={(e)=> setGenAvatar(e.target.checked)} />
            创建后生成头像（占位图）
          </label>
          <Button onClick={submit} disabled={busy}>{busy ? '处理中...' : '创建并加入库存'}</Button>
        </div>
      </Flex>
    </Box>
  );
};

