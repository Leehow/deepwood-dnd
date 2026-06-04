/**
 * D&D 5E规则帮助文本
 * 用于HelpTooltip组件显示详细说明
 */

export const DND_HELP_TEXTS = {
  // 基础属性
  hp: {
    title: "生命值 (HP)",
    content: (
      <div className="space-y-2">
        <p><strong>生命值（Hit Points）</strong>代表你的角色能承受多少伤害。</p>
        <p className="text-sm">• 当HP降到0时，角色会陷入濒死状态</p>
        <p className="text-sm">• HP = 职业生命骰 + 体质调整值</p>
        <p className="text-sm">• 每次升级时增加生命值</p>
        <p className="text-sm">• 可以通过休息、治疗法术、药水等方式恢复</p>
      </div>
    ),
  },

  ac: {
    title: "护甲等级 (AC)",
    content: (
      <div className="space-y-2">
        <p><strong>护甲等级（Armor Class）</strong>代表你有多难被击中。</p>
        <p className="text-sm">• 敌人攻击检定必须≥你的AC才能命中</p>
        <p className="text-sm">• 基础AC = 10 + 敏捷调整值</p>
        <p className="text-sm">• 穿戴护甲会改变AC计算方式</p>
        <p className="text-sm">• 例如：皮甲AC = 11 + 敏捷调整值</p>
        <p className="text-sm">• 盾牌额外提供+2 AC</p>
      </div>
    ),
  },

  speed: {
    title: "速度",
    content: (
      <div className="space-y-2">
        <p><strong>速度（Speed）</strong>代表你每回合能移动多远。</p>
        <p className="text-sm">• 单位：英尺（1英尺 ≈ 0.3米）</p>
        <p className="text-sm">• 大多数种族基础速度为30尺</p>
        <p className="text-sm">• 木精灵、僧侣等有更快的速度</p>
        <p className="text-sm">• 穿重甲可能降低速度</p>
        <p className="text-sm">• 在战术地图上：5尺 = 1格</p>
      </div>
    ),
  },

  proficiency: {
    title: "熟练加值",
    content: (
      <div className="space-y-2">
        <p><strong>熟练加值（Proficiency Bonus）</strong>是基于等级的通用加值。</p>
        
        <div className="mt-3 mb-3 p-2 bg-gray-800 rounded">
          <p className="text-xs font-mono">
            等级 1-4：+2<br/>
            等级 5-8：+3<br/>
            等级 9-12：+4<br/>
            等级 13-16：+5<br/>
            等级 17-20：+6
          </p>
        </div>

        <p className="text-sm font-semibold text-amber-400">应用场景：</p>
        <p className="text-sm">• <strong>技能检定</strong>：熟练的技能加上此值</p>
        <p className="text-sm">• <strong>攻击检定</strong>：使用熟练武器时加上此值</p>
        <p className="text-sm">• <strong>豁免检定</strong>：熟练的豁免加上此值</p>
        <p className="text-sm">• <strong>法术攻击</strong>：施法者的法术攻击加上此值</p>
        
        <p className="text-xs text-gray-500 mt-2">
          例：1级游侠用长弓攻击 = 1d20 + 敏捷调整值 + 熟练加值(+2)
        </p>
      </div>
    ),
  },

  // 六大属性
  strength: {
    title: "力量 (STR)",
    content: (
      <div className="space-y-2">
        <p><strong>力量（Strength）</strong>代表身体力量和运动能力。</p>
        <p className="text-sm">• 影响近战武器攻击和伤害</p>
        <p className="text-sm">• 影响运动、攀爬等技能检定</p>
        <p className="text-sm">• 决定负重能力</p>
        <p className="text-sm">• 力量豁免用于抵抗被推、拉等效果</p>
      </div>
    ),
  },

  dexterity: {
    title: "敏捷 (DEX)",
    content: (
      <div className="space-y-2">
        <p><strong>敏捷（Dexterity）</strong>代表灵活性、反应速度和平衡感。</p>
        <p className="text-sm">• 影响AC（护甲等级）</p>
        <p className="text-sm">• 影响先攻检定（决定战斗顺序）</p>
        <p className="text-sm">• 影响远程武器和灵巧武器的攻击</p>
        <p className="text-sm">• 影响隐匿、巧手等技能</p>
        <p className="text-sm">• 敏捷豁免用于闪避火球等范围效果</p>
      </div>
    ),
  },

  constitution: {
    title: "体质 (CON)",
    content: (
      <div className="space-y-2">
        <p><strong>体质（Constitution）</strong>代表健康、耐力和生命力。</p>
        <p className="text-sm">• 影响HP（生命值）</p>
        <p className="text-sm">• 每级HP增加 = 生命骰 + 体质调整值</p>
        <p className="text-sm">• 体质豁免用于抵抗毒素、疾病</p>
        <p className="text-sm">• 影响长时间行军、憋气等耐力检定</p>
      </div>
    ),
  },

  intelligence: {
    title: "智力 (INT)",
    content: (
      <div className="space-y-2">
        <p><strong>智力（Intelligence）</strong>代表推理、记忆和学习能力。</p>
        <p className="text-sm">• 法师的施法关键属性</p>
        <p className="text-sm">• 影响奥秘、历史、调查等知识技能</p>
        <p className="text-sm">• 智力豁免用于抵抗心灵控制法术</p>
        <p className="text-sm">• 决定已准备法术数量（法师）</p>
      </div>
    ),
  },

  wisdom: {
    title: "感知 (WIS)",
    content: (
      <div className="space-y-2">
        <p><strong>感知（Wisdom）</strong>代表洞察力、直觉和与自然的联系。</p>
        <p className="text-sm">• 牧师、德鲁伊的施法关键属性</p>
        <p className="text-sm">• 影响察觉、洞悉、医药等技能</p>
        <p className="text-sm">• 感知豁免用于抵抗魅惑、恐惧</p>
        <p className="text-sm">• 决定被动察觉（发现陷阱、隐藏敌人）</p>
      </div>
    ),
  },

  charisma: {
    title: "魅力 (CHA)",
    content: (
      <div className="space-y-2">
        <p><strong>魅力（Charisma）</strong>代表个人魅力、说服力和领导力。</p>
        <p className="text-sm">• 术士、吟游诗人、圣武士的施法关键属性</p>
        <p className="text-sm">• 影响说服、欺瞒、威吓、表演等社交技能</p>
        <p className="text-sm">• 魅力豁免用于抵抗放逐等效果</p>
        <p className="text-sm">• 影响NPC对你的初始态度</p>
      </div>
    ),
  },

  // 属性调整值
  abilityModifier: {
    title: "属性调整值",
    content: (
      <div className="space-y-2">
        <p><strong>属性调整值</strong>是从属性值计算出的加值/减值。</p>
        
        <div className="mt-3 mb-3 p-2 bg-gray-800 rounded text-xs font-mono">
          <p>属性值 → 调整值</p>
          <p>8-9 → -1</p>
          <p>10-11 → 0</p>
          <p>12-13 → +1</p>
          <p>14-15 → +2</p>
          <p>16-17 → +3</p>
          <p>18-19 → +4</p>
          <p>20 → +5</p>
        </div>

        <p className="text-sm">• 公式：(属性值 - 10) ÷ 2（向下取整）</p>
        <p className="text-sm">• 调整值用于几乎所有检定和计算</p>
        <p className="text-sm">• 例：力量16 → 调整值+3 → 近战攻击+3</p>
      </div>
    ),
  },

  // 其他概念
  level: {
    title: "等级",
    content: (
      <div className="space-y-2">
        <p><strong>等级（Level）</strong>代表角色的经验和能力。</p>
        <p className="text-sm">• 通过获得经验值（XP）提升等级</p>
        <p className="text-sm">• 每次升级获得新能力和更高属性</p>
        <p className="text-sm">• 最高等级为20级</p>
        <p className="text-sm">• 等级影响熟练加值、HP、法术位等</p>
      </div>
    ),
  },

  initiative: {
    title: "先攻",
    content: (
      <div className="space-y-2">
        <p><strong>先攻（Initiative）</strong>决定战斗中的行动顺序。</p>
        <p className="text-sm">• 战斗开始时投1d20 + 敏捷调整值</p>
        <p className="text-sm">• 结果从高到低决定行动顺序</p>
        <p className="text-sm">• 先攻高的角色先行动</p>
        <p className="text-sm">• 某些职业特性可以影响先攻</p>
      </div>
    ),
  },
};

// 导出类型
export type HelpTextKey = keyof typeof DND_HELP_TEXTS;

