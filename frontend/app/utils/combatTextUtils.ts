/**
 * 战斗消息显示格式化工具
 * 仅处理前端展示，不修改存储数据
 */

/**
 * 格式化战斗消息内容，改善排版可读性：
 * - 将 ` | ` 分隔符拆成换行（伤害独立一行）
 * - 将单个 \n 转为双换行（markdown 段落分隔）
 * - 翻译英文伤害类型为中文
 * - 去掉怪物武器名中的英文括号
 */
export function formatCombatDisplay(content: string): string {
  let result = content;

  // 1. 将 " | " 拆成换行，让伤害信息独立一行
  result = result.replace(/ \| /g, '\n\n');

  // 2. 将单个换行转为双换行（markdown 段落），但保留已有的双换行和 blockquote
  // 先保护 blockquote 行（以 > 开头）
  result = result.replace(/\n(>)/g, '\n\n$1');

  // 将剩余的单换行变为双换行（确保 markdown 正确分段）
  // 避免把已经是双换行的变成四换行
  result = result.replace(/\n(?!\n)/g, '\n\n');
  result = result.replace(/\n{3,}/g, '\n\n');

  // 3. 翻译英文伤害类型
  result = translateDamageTypes(result);

  // 4. 去掉怪物武器名中的英文括号，如 "爪击 (Claw)" → "爪击"
  result = result.replace(/(\p{Script=Han}+)\s*\([A-Za-z\s/]+\)/gu, '$1');

  return result;
}

const DAMAGE_TYPE_MAP: Record<string, string> = {
  'bludgeoning': '钝击',
  'piercing': '穿刺',
  'slashing': '挥砍',
  'fire': '火焰',
  'cold': '寒冷',
  'lightning': '闪电',
  'thunder': '雷鸣',
  'acid': '强酸',
  'poison': '毒素',
  'necrotic': '黯蚀',
  'radiant': '光耀',
  'force': '力场',
  'psychic': '心灵',
};

/**
 * 翻译内容中的英文伤害类型词为中文（处理旧消息）
 */
function translateDamageTypes(content: string): string {
  // 匹配独立的英文伤害类型词（在数字、空格或行尾附近）
  const pattern = new RegExp(
    `\\b(${Object.keys(DAMAGE_TYPE_MAP).join('|')})\\b`,
    'gi'
  );
  return content.replace(pattern, (match) => {
    return DAMAGE_TYPE_MAP[match.toLowerCase()] || match;
  });
}
