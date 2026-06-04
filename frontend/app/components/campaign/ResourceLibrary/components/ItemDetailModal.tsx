/**
 * ItemDetailModal Component
 * Displays detailed item information in a modal dialog
 */

import React, { useState, useEffect } from 'react';
import { Dialog, Flex, Box, Text, Badge, Button, ScrollArea } from '@radix-ui/themes';
import { tDamageType, tWeaponProperty } from '~/utils/i18n';
import { tCategory, tSubcategory, tRarity } from '~/config/item-i18n';
import type { Item } from '../types';
import { loadItemIcon } from '../utils/helpers';

interface ItemDetailModalProps {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlaceToken?: (id: number) => void;
  onGenerateIcon?: (id: number) => Promise<void>;
  onChooseAvatarFromLibrary?: (item: Item) => void;
  isGeneratingIcon?: boolean;
}

export function ItemDetailModal({
  item,
  open,
  onOpenChange,
  onPlaceToken,
  onGenerateIcon,
  onChooseAvatarFromLibrary,
  isGeneratingIcon = false,
}: ItemDetailModalProps) {
  const [iconPath, setIconPath] = useState<string | null>(null);

  useEffect(() => {
    if (item && !item.avatar_url) {
      loadItemIcon(item).then(setIconPath);
    }
  }, [item?.name, item?.name_cn, item?.avatar_url]);

  if (!item) return null;

  const displayIcon = item.avatar_url || iconPath;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 700, maxHeight: '85vh' }}>
        <Dialog.Title>
          <Flex align="center" gap="3">
            {displayIcon && (
              <img
                src={displayIcon}
                alt={item.name_cn || item.name}
                style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'contain' }}
              />
            )}
            <Box>
              <Flex align="center" gap="2">
                <Text size="5" weight="bold">{item.name_cn || item.name}</Text>
                {item.name_cn && <Text size="3" color="gray">({item.name})</Text>}
              </Flex>
              <Flex gap="2" mt="1" wrap="wrap">
                {item.category && <Badge size="2" variant="soft">{tCategory(item.category)}</Badge>}
                {item.subcategory && <Badge size="2" variant="soft">{tSubcategory(item.subcategory)}</Badge>}
                {item.rarity && <Badge size="2" variant="soft" color="purple">{tRarity(item.rarity)}</Badge>}
              </Flex>
            </Box>
          </Flex>
        </Dialog.Title>

        <ScrollArea style={{ height: 'calc(85dvh - 180px)' }}>
          <Box py="4">
            {/* Cost & Weight */}
            <Flex gap="4" mb="4">
              {item.cost && (
                <Box>
                  <Text size="2" weight="bold" mb="1" style={{ display: 'block' }}>价格</Text>
                  <Badge size="2" variant="outline">
                    {Object.entries(item.cost).map(([unit, value]) => `${value} ${unit}`).join(', ')}
                  </Badge>
                </Box>
              )}
              {item.weight && (
                <Box>
                  <Text size="2" weight="bold" mb="1" style={{ display: 'block' }}>重量</Text>
                  <Badge size="2" variant="outline">{item.weight} 磅</Badge>
                </Box>
              )}
              {item.quantity && item.quantity > 1 && (
                <Box>
                  <Text size="2" weight="bold" mb="1" style={{ display: 'block' }}>数量</Text>
                  <Badge size="2" color="blue">x{item.quantity}</Badge>
                </Box>
              )}
            </Flex>

            {/* Attunement */}
            {item.requires_attunement && (
              <Box mb="4" p="3" style={{ background: 'var(--orange-a2)', borderRadius: 8 }}>
                <Badge size="2" color="orange">
                  需要同调 {item.attunement_by && `(${item.attunement_by})`}
                </Badge>
              </Box>
            )}

            {/* Magic Bonus */}
            {item.magic_bonus && (
              <Box mb="4">
                <Badge size="2" color="green">+{item.magic_bonus} 魔法武器/护甲</Badge>
              </Box>
            )}

            {/* Damage */}
            {item.damage && (
              <Box mb="4" p="3" style={{ background: 'var(--red-a2)', borderRadius: 8 }}>
                <Text size="2" weight="bold" color="red">伤害</Text>
                <Text size="3" style={{ display: 'block', marginTop: 4 }}>
                  {item.damage.dice} {tDamageType(item.damage.type)}
                </Text>
              </Box>
            )}

            {/* Extra Damage */}
            {item.extra_damage && (
              <Box mb="4" p="3" style={{ background: 'var(--crimson-a2)', borderRadius: 8 }}>
                <Text size="2" weight="bold" color="crimson">额外伤害</Text>
                <Text size="3" style={{ display: 'block', marginTop: 4 }}>
                  +{item.extra_damage.dice} {tDamageType(item.extra_damage.type)}
                  {item.extra_damage.condition && (
                    <Text size="1" color="gray"> ({item.extra_damage.condition})</Text>
                  )}
                </Text>
              </Box>
            )}

            {/* Armor Class */}
            {item.armor_class && (
              <Box mb="4" p="3" style={{ background: 'var(--blue-a2)', borderRadius: 8 }}>
                <Text size="2" weight="bold" color="blue">护甲等级</Text>
                <Text size="3" style={{ display: 'block', marginTop: 4 }}>
                  AC {item.armor_class.base}
                  {item.armor_class.dex_bonus && ' + 敏捷调整值'}
                  {item.armor_class.max_dex_bonus && ` (最大 +${item.armor_class.max_dex_bonus})`}
                </Text>
                {item.strength_requirement && (
                  <Text size="1" color="gray" style={{ display: 'block', marginTop: 4 }}>
                    需要力量 {item.strength_requirement}
                  </Text>
                )}
                {item.stealth_disadvantage && (
                  <Badge size="1" color="red" style={{ marginTop: 4 }}>隐匿劣势</Badge>
                )}
              </Box>
            )}

            {/* Range */}
            {item.range && (
              <Box mb="4">
                <Text size="2" weight="bold" mb="1" style={{ display: 'block' }}>射程</Text>
                <Text size="2">
                  {item.range.normal}尺{item.range.long && ` / ${item.range.long}尺`}
                </Text>
              </Box>
            )}

            {/* Properties */}
            {item.properties && item.properties.length > 0 && (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>武器属性</Text>
                <Flex gap="2" wrap="wrap">
                  {item.properties.map((prop, idx) => (
                    <Badge key={idx} size="2" variant="soft">{tWeaponProperty(prop)}</Badge>
                  ))}
                </Flex>
              </Box>
            )}

            {/* Charges */}
            {item.charges && (
              <Box mb="4" p="3" style={{ background: 'var(--blue-a3)', borderRadius: 8 }}>
                <Text size="2" weight="bold" color="blue">充能系统</Text>
                <Flex gap="3" mt="2" align="center">
                  <Badge size="2" variant="solid" color="blue">
                    {item.charges.current ?? item.charges.max}/{item.charges.max} 充能
                  </Badge>
                  {item.charges.recharge && (
                    <Text size="1" color="gray">
                      恢复: {item.charges.recharge.time} {item.charges.recharge.amount}
                    </Text>
                  )}
                </Flex>
                {item.charges.on_zero && (
                  <Text size="1" color="red" style={{ display: 'block', marginTop: 8 }}>
                    耗尽时: {item.charges.on_zero.check}，
                    投出{item.charges.on_zero.destroy_on}或以下则销毁
                  </Text>
                )}
              </Box>
            )}

            {/* Abilities */}
            {item.abilities && item.abilities.length > 0 && (
              <Box mb="4">
                <Text size="2" weight="bold" color="amber" mb="2" style={{ display: 'block' }}>
                  特殊能力
                </Text>
                {item.abilities.map((ability, idx) => (
                  <Box key={idx} mb="3" p="3" style={{ background: 'var(--amber-a2)', borderRadius: 8 }}>
                    <Flex gap="2" align="center" mb="2">
                      <Text size="2" weight="bold">{ability.name}</Text>
                      {ability.name_en && <Text size="1" color="gray">({ability.name_en})</Text>}
                      <Badge size="1" variant="outline" color={
                        ability.type === 'passive' ? 'gray' :
                        ability.type === 'active' ? 'green' :
                        ability.type === 'rechargeable' ? 'blue' : 'orange'
                      }>
                        {ability.type === 'passive' ? '被动' :
                         ability.type === 'active' ? '主动' :
                         ability.type === 'rechargeable' ? '充能' : '触发'}
                      </Badge>
                      {ability.uses && (
                        <Badge size="1" variant="soft" color="blue">
                          {ability.uses.max}次/
                          {ability.uses.per === 'day' ? '天' :
                           ability.uses.per === 'long_rest' ? '长休' : '短休'}
                        </Badge>
                      )}
                    </Flex>
                    <Text size="2" color="gray">{ability.description}</Text>
                    {ability.condition && (
                      <Text size="1" color="orange" style={{ display: 'block', marginTop: 4 }}>
                        条件: {ability.condition}
                      </Text>
                    )}
                  </Box>
                ))}
              </Box>
            )}

            {/* Item Spells */}
            {item.item_spells && item.item_spells.length > 0 && (
              <Box mb="4">
                <Text size="2" weight="bold" color="purple" mb="2" style={{ display: 'block' }}>
                  内含法术
                </Text>
                <div className="grid grid-cols-2 gap-2">
                  {item.item_spells.map((spell, idx) => (
                    <Box key={idx} p="2" style={{ background: 'var(--purple-a2)', borderRadius: 6 }}>
                      <Flex align="center" gap="2">
                        <Text size="2" weight="bold">{spell.name}</Text>
                        {spell.name_en && <Text size="1" color="gray">({spell.name_en})</Text>}
                      </Flex>
                      <Flex gap="2" mt="1" wrap="wrap">
                        {spell.charges > 0 && (
                          <Badge size="1" variant="soft" color="blue">{spell.charges} 充能</Badge>
                        )}
                        {spell.level && (
                          <Badge size="1" variant="outline">{spell.level}环</Badge>
                        )}
                        {spell.attack_bonus && (
                          <Badge size="1" variant="soft" color="red">
                            +{spell.attack_bonus} 攻击
                          </Badge>
                        )}
                        {spell.save_dc && (
                          <Badge size="1" variant="soft" color="orange">
                            DC {spell.save_dc}
                          </Badge>
                        )}
                      </Flex>
                      {spell.notes && (
                        <Text size="1" color="gray" style={{ marginTop: 4, display: 'block' }}>
                          {spell.notes}
                        </Text>
                      )}
                    </Box>
                  ))}
                </div>
              </Box>
            )}

            {/* Sentient Item */}
            {item.sentient?.is_sentient && (
              <Box mb="4" p="3" style={{ background: 'var(--purple-a3)', borderRadius: 8 }}>
                <Flex align="center" gap="2" mb="2">
                  <Text size="2" weight="bold" color="purple">智能物品</Text>
                  {item.sentient.alignment && (
                    <Badge size="2" variant="soft" color="purple">{item.sentient.alignment}</Badge>
                  )}
                </Flex>
                {item.sentient.languages && item.sentient.languages.length > 0 && (
                  <Text size="2" style={{ display: 'block', marginBottom: 4 }}>
                    <Text weight="bold">语言:</Text> {item.sentient.languages.join(', ')}
                  </Text>
                )}
                {item.sentient.communication && (
                  <Text size="2" style={{ display: 'block', marginBottom: 4 }}>
                    <Text weight="bold">交流方式:</Text> {item.sentient.communication}
                  </Text>
                )}
                {item.sentient.personality && (
                  <Text size="2" color="gray">{item.sentient.personality}</Text>
                )}
              </Box>
            )}

            {/* Description */}
            {(item.description_cn || item.description) && (
              <Box mb="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>描述</Text>
                <Text size="2" color="gray" style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {item.description_cn || item.description}
                </Text>
              </Box>
            )}

            {/* Notes */}
            {item.notes && (
              <Box mb="4" p="3" style={{ background: 'var(--amber-a2)', borderRadius: 8 }}>
                <Text size="2" weight="bold" color="amber" mb="1" style={{ display: 'block' }}>备注</Text>
                <Text size="2">{item.notes}</Text>
              </Box>
            )}

            {/* Source */}
            {item.source_module && (
              <Text size="1" color="gray">来源: {item.source_module}</Text>
            )}

            {/* Image Preview */}
            {item.avatar_url && (
              <Box mt="4">
                <Text size="2" weight="bold" mb="2" style={{ display: 'block' }}>图片预览</Text>
                <img
                  src={item.avatar_url_large || item.avatar_url}
                  alt={item.name_cn || item.name}
                  style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8, objectFit: 'contain' }}
                />
              </Box>
            )}
          </Box>
        </ScrollArea>

        {/* Footer Actions */}
        <Flex gap="3" mt="4" justify="end">
          <Button
            variant="soft"
            color="cyan"
            onClick={() => onChooseAvatarFromLibrary?.(item)}
          >
            <span>从图库选择</span>
          </Button>
          {/* 只有没有预设图标时才显示AI生成图片按钮 */}
          {!iconPath && (
            <Button
              variant="soft"
              color="purple"
              onClick={() => onGenerateIcon?.(item.id)}
              disabled={isGeneratingIcon}
            >
              <span>{isGeneratingIcon ? '生成中...' : 'AI生成图片'}</span>
            </Button>
          )}
          <Button
            variant="soft"
            color="amber"
            onClick={() => onPlaceToken?.(item.id)}
          >
            <span>生成到地图</span>
          </Button>
          <Dialog.Close>
            <Button variant="soft" color="gray"><span>关闭</span></Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
