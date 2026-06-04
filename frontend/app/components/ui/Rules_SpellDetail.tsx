// Spell detail utilities for Rules Panel & spell targeting analysis
import React from 'react';
import { createPortal } from 'react-dom';

// Spell school colors and translations (used by RulesPanel spell list rendering)
export const SPELL_SCHOOL_CONFIG: Record<string, { color: string; bgColor: string; borderColor: string; name: string }> = {
  abjuration: { color: 'text-blue-400', bgColor: 'bg-blue-900/30', borderColor: 'border-blue-700/50', name: '防护' },
  conjuration: { color: 'text-yellow-400', bgColor: 'bg-yellow-900/30', borderColor: 'border-yellow-700/50', name: '咒法' },
  divination: { color: 'text-cyan-400', bgColor: 'bg-cyan-900/30', borderColor: 'border-cyan-700/50', name: '预言' },
  enchantment: { color: 'text-pink-400', bgColor: 'bg-pink-900/30', borderColor: 'border-pink-700/50', name: '惑控' },
  evocation: { color: 'text-red-400', bgColor: 'bg-red-900/30', borderColor: 'border-red-700/50', name: '塑能' },
  illusion: { color: 'text-purple-400', bgColor: 'bg-purple-900/30', borderColor: 'border-purple-700/50', name: '幻术' },
  necromancy: { color: 'text-green-400', bgColor: 'bg-green-900/30', borderColor: 'border-green-700/50', name: '死灵' },
  transmutation: { color: 'text-orange-400', bgColor: 'bg-orange-900/30', borderColor: 'border-orange-700/50', name: '变化' },
};

export function getSpellSchoolConfig(school: string) {
  return SPELL_SCHOOL_CONFIG[school?.toLowerCase()] || {
    color: 'text-gray-400',
    bgColor: 'bg-gray-900/30',
    borderColor: 'border-gray-700/50',
    name: school || '未知'
  };
}

// 区域类型中文 (used by analyzeSpellTargeting)
const AREA_TYPE_NAMES: Record<string, string> = {
  sphere: '球形', cone: '锥形', cube: '立方', line: '直线', cylinder: '圆柱',
};

// ── Spell targeting analysis ──────────────────────────
interface SpellTargeting {
  /** 施法距离: 自身 / 触及 / 90 尺 */
  rangeLabel: string;
  /** 目标类型: 自身增益 / 触及单体 / 远程单体 / 自身范围 / 远程范围 */
  targetLabel: string;
  /** Short icon */
  targetIcon: string;
  /** Area detail like "15尺锥形" */
  areaDetail?: string;
}

export function analyzeSpellTargeting(spell: any): SpellTargeting {
  const range: string = spell.range || '';
  const area = spell.areaOfEffect || spell.area_of_effect;

  // ① Self-emanating: "自身 15 尺锥状" / "自身 30 尺半径" / "自身60 尺线状"
  const selfArea = range.match(/自身\s*(\d+)\s*尺\s*(.+)/);
  if (selfArea) {
    const shape = selfArea[2].replace(/状$/, '').replace(/形$/, '');
    return {
      rangeLabel: '自身出发',
      targetLabel: '范围',
      targetIcon: '📐',
      areaDetail: `${selfArea[1]}尺${shape}`,
    };
  }

  // ② Pure self (no area or self-centered area)
  if (range === '自身') {
    if (area) {
      const shapeCn = AREA_TYPE_NAMES[area.type] || area.type || '';
      const maxPrefix = area.sizeIsMax ? '至多' : '';
      return {
        rangeLabel: '自身为中心',
        targetLabel: '范围',
        targetIcon: '🔵',
        areaDetail: `${maxPrefix}${area.size}尺${shapeCn}`,
      };
    }
    return { rangeLabel: '自身', targetLabel: '自身增益', targetIcon: '👤' };
  }

  // ③ Touch
  if (range === '触及') {
    if (area) {
      const shapeCn = AREA_TYPE_NAMES[area.type] || area.type || '';
      const maxPrefix = area.sizeIsMax ? '至多' : '';
      return {
        rangeLabel: '触及',
        targetLabel: '范围',
        targetIcon: '📐',
        areaDetail: `${maxPrefix}${area.size}尺${shapeCn}`,
      };
    }
    return { rangeLabel: '触及', targetLabel: '单体', targetIcon: '✋' };
  }

  // ④ Sight / Unlimited / Special
  if (range.includes('视野') || range.includes('无限') || range === '特殊') {
    if (area) {
      const shapeCn = AREA_TYPE_NAMES[area.type] || area.type || '';
      const maxPrefix = area.sizeIsMax ? '至多' : '';
      return {
        rangeLabel: range,
        targetLabel: '范围',
        targetIcon: '📐',
        areaDetail: `${maxPrefix}${area.size}尺${shapeCn}`,
      };
    }
    return { rangeLabel: range, targetLabel: '指定目标', targetIcon: '🎯' };
  }

  // ⑤ Ranged with distance
  if (area) {
    const shapeCn = AREA_TYPE_NAMES[area.type] || area.type || '';
    const maxPrefix = area.sizeIsMax ? '至多' : '';
    return {
      rangeLabel: range,
      targetLabel: '指定区域',
      targetIcon: '📐',
      areaDetail: `${maxPrefix}${area.size}尺${shapeCn}`,
    };
  }

  // ⑥ Ranged single target
  return { rangeLabel: range, targetLabel: '指定目标', targetIcon: '🎯' };
}

export function isSelfCenteredAreaSpell(spell: any): boolean {
  const range = String(spell?.range || '').trim().toLowerCase();
  const area = spell?.areaOfEffect || spell?.area_of_effect;
  const areaType = String(area?.type || '').trim().toLowerCase();
  if (!area) return false;
  if (areaType === 'cone' || areaType === 'line') return false;
  return range === '自身' || range === 'self';
}

// Spell attribute explanations for new players
export const SPELL_ATTRIBUTE_EXPLANATIONS: Record<string, { title: string; description: string }> = {
  level: {
    title: '法术环数',
    description: '法术的等级，从戏法（0环）到9环。环数越高，法术越强大，需要消耗更高等级的法术位来施展。戏法可以无限次使用，不消耗法术位。'
  },
  school: {
    title: '魔法学派',
    description: '魔法分为8个学派，各有特点：\n• 防护：保护与封锁\n• 咒法：召唤生物与物体\n• 预言：揭示信息与未来\n• 惑控：影响心智与情绪\n• 塑能：操控能量（火球等）\n• 幻术：欺骗感官\n• 死灵：操控生死\n• 变化：改变物质形态'
  },
  castingTime: {
    title: '施法时间',
    description: '施展法术所需的时间：\n• 1动作：最常见，占用你的标准动作\n• 1附赠动作：快速施法，可与动作配合\n• 1反应：特定触发条件时使用\n• 1分钟+：仪式法术或复杂魔法'
  },
  range: {
    title: '施法距离',
    description: '法术能影响的最远距离：\n• 自身：仅影响施法者\n• 触及：需要触碰目标\n• 具体距离：如30尺、120尺等\n• 视野内：你能看到的任意目标'
  },
  components: {
    title: '施法成分',
    description: '施展法术需要的条件：\n• V（言语）：必须能说话\n• S（姿势）：必须有一只手自由\n• M（材料）：需要特定物品\n\n如果手被束缚或无法说话，可能无法施展某些法术。材料成分通常可用施法器具替代。'
  },
  duration: {
    title: '持续时间',
    description: '法术效果维持的时长：\n• 即时：效果立即发生并结束\n• 具体时长：如1分钟、1小时\n• 专注：需要持续维持（见专注说明）\n• 直至解除：永久有效直到被驱散'
  },
  concentration: {
    title: '专注',
    description: '某些法术需要保持专注才能维持效果：\n• 同时只能专注一个法术\n• 受到伤害需要进行专注检定\n• 失去专注会立即结束法术\n• 施放另一个专注法术会结束当前的\n\n专注检定DC = 10或受到伤害的一半（取较高者）'
  },
  ritual: {
    title: '仪式施法',
    description: '标有仪式标签的法术可以用仪式方式施展：\n• 施法时间增加10分钟\n• 不消耗法术位\n• 必须已准备该法术（或法师抄录在法术书中）\n\n仪式施法适合非紧急情况，可以节省宝贵的法术位资源。'
  },
  materials: {
    title: '材料成分',
    description: '某些法术需要特定材料才能施展：\n• 无价值标注：可用施法器具（法器、圣徽等）替代\n• 有价值标注（如"价值50gp"）：必须使用该材料\n• 标注"消耗"：材料会在施法时消耗\n\n没有施法器具时，必须有一只手空出来操作材料成分。'
  },
  damage: {
    title: '伤害',
    description: '法术造成的伤害：\n• 伤害骰：如8d6表示投8个6面骰\n• 伤害类型：火焰、冷冻、闪电、强酸、毒素、黯蚀、光耀、力场、心灵、雷鸣等\n\n某些生物对特定伤害类型有抗性（伤害减半）、免疫（无伤害）或易伤（伤害翻倍）。'
  },
  saveType: {
    title: '豁免检定',
    description: '目标进行豁免检定来抵抗法术效果：\n• 力量豁免：抵抗推拉、束缚\n• 敏捷豁免：躲避范围攻击\n• 体质豁免：抵抗毒素、疾病\n• 智力豁免：抵抗心灵攻击\n• 感知豁免：抵抗魅惑、恐惧\n• 魅力豁免：抵抗放逐、附身\n\n豁免DC = 8 + 熟练加值 + 施法属性调整值'
  },
  areaOfEffect: {
    title: '目标与影响范围',
    description: '法术的目标类型和作用范围：\n• 👤 自身增益：仅影响施法者本人\n• ✋ 单体（触及）：需触碰目标\n• 🎯 指定目标：在距离内选择目标\n• 📐 范围（自身出发）：从施法者身边扩散\n• 🔵 范围（以自身为中心）：环绕施法者\n• 📐 指定区域：在距离内选择一点释放\n\n范围法术通常影响区域内所有生物（含友军），注意站位！'
  },
  timeConversion: {
    title: '时间换算',
    description: '游戏时间单位换算：\n• 1轮 = 6秒（战斗中）\n• 10轮 = 1分钟\n• 10分钟 = 100轮\n• 1小时 = 600轮\n\n战斗外通常直接用分钟/小时计时，不需要逐轮追踪。'
  },
  spellcastingAbility: {
    title: '施法关键属性',
    description: '每个施法职业使用不同的属性来施展法术：\n• 智力：法师、奇械师\n• 感知：牧师、德鲁伊、游侠\n• 魅力：吟游诗人、圣骑士、术士、邪术师\n\n施法属性调整值影响你的法术攻击加值和法术豁免DC。括号中的数值即为该属性的调整值。'
  },
  spellSaveDC: {
    title: '法术豁免DC',
    description: '目标抵抗你法术时需要达到的难度等级：\n\nDC = 8 + 熟练加值 + 施法属性调整值\n\n当法术要求目标进行豁免检定时，目标投d20+对应豁免调整值，结果≥DC则豁免成功（通常减轻或完全避免法术效果）。'
  },
  spellAttackBonus: {
    title: '法术攻击加值',
    description: '施展需要攻击检定的法术时，加到d20上的数值：\n\n法术攻击 = d20 + 熟练加值 + 施法属性调整值\n\n结果≥目标AC则命中。包括近战法术攻击（如震慑打击）和远程法术攻击（如火焰箭）。'
  }
};

// Reusable tooltip component for spell attributes
// Supports both hover (desktop) and click/tap (mobile)
export function SpellAttributeTooltip({
  children,
  attributeKey,
  extra,
  className = ''
}: {
  children: React.ReactNode;
  attributeKey: keyof typeof SPELL_ATTRIBUTE_EXPLANATIONS;
  extra?: React.ReactNode;
  className?: string;
}) {
  const explanation = SPELL_ATTRIBUTE_EXPLANATIONS[attributeKey];
  const [open, setOpen] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);

  if (!explanation) return <>{children}</>;

  const handleMouseEnter = () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(true), 300);
  };
  const handleMouseLeave = () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  };
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(prev => !prev);
  };

  // Close on click outside
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (contentRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  // Calculate tooltip position based on trigger, flip above if not enough space below
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const [flipped, setFlipped] = React.useState(false);
  React.useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const tooltipWidth = 280;
    const tooltipHeight = 200; // estimated max height
    let left = rect.left;
    if (left + tooltipWidth > window.innerWidth - 8) {
      left = window.innerWidth - tooltipWidth - 8;
    }
    if (left < 8) left = 8;
    // Flip above if not enough space below
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < tooltipHeight && rect.top > spaceBelow) {
      setFlipped(true);
      setPos({ top: rect.top - 4, left });
    } else {
      setFlipped(false);
      setPos({ top: rect.bottom + 4, left });
    }
  }, [open]);

  return (
    <span className="inline-block">
      <span
        ref={triggerRef}
        className={`inline-block text-left cursor-help hover:bg-white/5 rounded px-1 -mx-1 transition-colors ${className}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {children}
      </span>
      {open && pos && createPortal(
        <div
          ref={contentRef}
          className="fixed z-[10400] w-[280px] px-4 py-3 bg-gray-900 border border-amber-500/30 rounded-lg shadow-xl animate-in fade-in-0 zoom-in-95"
          style={flipped
            ? { bottom: window.innerHeight - pos.top, left: pos.left, pointerEvents: 'auto' }
            : { top: pos.top, left: pos.left, pointerEvents: 'auto' }
          }
          onMouseEnter={() => clearTimeout(timeoutRef.current)}
          onMouseLeave={handleMouseLeave}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-amber-400 font-semibold mb-2 flex items-center gap-2">
            <span className="text-lg">📖</span>
            {explanation.title}
          </div>
          <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
            {explanation.description}
          </p>
          {extra && <div className="mt-2 pt-2 border-t border-amber-500/15">{extra}</div>}
        </div>,
        document.body
      )}
    </span>
  );
}
