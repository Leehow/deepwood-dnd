/**
 * spellModifiers.ts
 * 通过角色职业特性（如邪术师魔能祈唤、子职业特性）修改法术参数的共享工具函数。
 * 在所有展示法术详情的地方统一调用，确保参数一致。
 *
 * 核心设计：法术位消耗 (_slotCost) 也是法术参数之一，默认为 1。
 * 祈唤的"随意施法"将 _slotCost 设为 0，施放管线统一检查此参数。
 */

import invocationsData from '~/data/rules/eldritch_invocations.json';

export interface SpellModifierContext {
  /** 角色的魔能祈唤 ID 列表 */
  eldritchInvocations?: string[];
  /** 魅力调整值 */
  charismaMod?: number;
  /** 角色子职业 ID（用于匹配子职业特性增强） */
  subclassId?: string;
}

/**
 * 子职业特性对特定法术的增强定义。
 * key = spell ID, value = 匹配条件及增强说明。
 */
const SUBCLASS_SPELL_ENHANCEMENTS: Array<{
  spellId: string;
  subclassId: string;
  name: string;
  desc: string;
}> = [
  {
    spellId: 'minor_illusion',
    subclassId: 'illusion',
    name: '改良次级幻影',
    desc: '当你施放次级幻术时，可以同时创造声音和图像。',
  },
];

/** 根据角色的祈唤列表，构建"随意施法"法术 ID 集合 */
export function getAtWillSpellIds(eldritchInvocations: string[]): Set<string> {
  const ids = new Set<string>();
  for (const inv of (invocationsData as any).invocations || []) {
    if (eldritchInvocations.includes(inv.id) && inv.grantedSpell?.atWill) {
      ids.add(inv.grantedSpell.id);
    }
  }
  return ids;
}

/**
 * 对法术应用角色特性修改。
 *
 * 通用效果：
 * - 祈唤赐予的随意法术 → _slotCost = 0
 * - 子职业特性增强 → _invocationNotes 追加说明
 *
 * 魔能爆(EB)专属：
 * - agonizing_blast: 伤害 +CHA，戏法成长每束 +CHA
 * - eldritch_spear: 射程 120→300
 * - repelling_blast: 描述附加推远说明
 */
export function applyCharacterSpellModifiers<T extends Record<string, any>>(
  spell: T,
  ctx: SpellModifierContext,
): T {
  let modified: Record<string, any> = { ...spell };
  let hasChanges = false;

  // ── 子职业特性增强 ──
  if (ctx.subclassId) {
    const enhancements = SUBCLASS_SPELL_ENHANCEMENTS.filter(
      e => e.spellId === spell.id && e.subclassId === ctx.subclassId
    );
    if (enhancements.length) {
      const existing = (modified._invocationNotes as { name: string; desc: string }[]) || [];
      modified._invocationNotes = [
        ...existing,
        ...enhancements.map(e => ({ name: e.name, desc: e.desc, source: '学派特性' as const })),
      ];
      hasChanges = true;
    }
  }

  // ── 魔能祈唤 ──
  if (ctx.eldritchInvocations?.length) {
    const invs = ctx.eldritchInvocations;

    // 通用：标记随意施法的 _slotCost
    const atWillIds = getAtWillSpellIds(invs);
    if (atWillIds.has(spell.id)) {
      modified._slotCost = 0;
      return modified as T;
    }

    // 以下只处理 EB
    if (spell.id === 'eldritch_blast') {
      const chaMod = ctx.charismaMod ?? 0;

      if (invs.includes('agonizing_blast')) {
        const chaStr = chaMod >= 0 ? `+${chaMod}` : `${chaMod}`;
        if (modified.damage) modified.damage = `${modified.damage}${chaStr}`;
        if (modified.damageAtCharacterLevel) {
          const scaled: Record<string, string> = {};
          for (const [lvl, val] of Object.entries(modified.damageAtCharacterLevel)) {
            scaled[lvl] = `${val}（每束${chaStr}）`;
          }
          modified.damageAtCharacterLevel = scaled;
        }
        if (modified.cantripScaling) {
          modified.cantripScaling = `${modified.cantripScaling}（每束${chaStr}）`;
        }
      }

      if (invs.includes('eldritch_spear')) {
        if (modified.range) {
          modified.range = modified.range
            .replace(/120\s*英尺/, '300 英尺')
            .replace(/120\s*尺/, '300尺')
            .replace('120 feet', '300 feet')
            .replace('120 ft', '300 ft');
        }
      }

      const notes: { name: string; desc: string }[] = (modified._invocationNotes as any[]) || [];
      if (invs.includes('agonizing_blast')) {
        const chaStr = chaMod >= 0 ? `+${chaMod}` : `${chaMod}`;
        notes.push({ name: '痛苦魔爆', desc: `每束命中时，伤害额外${chaStr}（魅力调整值）。` });
      }
      if (invs.includes('eldritch_spear')) {
        notes.push({ name: '魔爆长枪', desc: '射程增加至 300 英尺。' });
      }
      if (invs.includes('repelling_blast')) {
        notes.push({ name: '斥力魔爆', desc: '命中时可将目标沿直线推远至多 10 尺。' });
      }
      if (notes.length) modified._invocationNotes = notes;
      return modified as T;
    }
  }

  return hasChanges ? (modified as T) : spell;
}
