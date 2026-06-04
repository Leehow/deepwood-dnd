/**
 * Character card export utilities — Markdown & PDF from saved character data.
 * Uses the same derived computation as ClassicCharacterCard for accuracy.
 */
import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";
import skillsData from "~/data/rules/skills.json";
import backgroundsData from "~/data/rules/backgrounds.json";
import spellsData from "~/data/rules/spells.json";
import equipmentData from "~/data/rules/equipment.json";
import {
  computeAll, computeFinalAbilityScores, computeAbilityMods,
  computeProficiencyBonus,
} from "~/components/character/CharacterDisplay/utils/derived";
import { extractSpellIds } from "~/utils/spellHelpers";

// ---- helpers ----

const abilityNames: Record<string, string> = {
  strength: "力量", dexterity: "敏捷", constitution: "体质",
  intelligence: "智力", wisdom: "感知", charisma: "魅力",
};

const slotLabels: Record<string, string> = {
  main_hand: "主手", off_hand: "副手", armor: "护甲",
  ammo: "弹药", quick_item: "快捷栏", clothing: "衣物", accessory: "饰品",
};

const propertyMap: Record<string, string> = {
  finesse: "灵巧", light: "轻型", heavy: "重型", "two-handed": "双手",
  versatile: "多用", thrown: "投掷", reach: "长柄", loading: "装填",
  ammunition: "弹药", special: "特殊",
};

function fmt(n: number) { return n >= 0 ? `+${n}` : `${n}`; }
function esc(s: string) { return s.replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function spellName(id: string): string {
  const s = (spellsData as any).spells?.find((sp: any) => sp.id === id);
  return s?.name || id;
}

function equipLookup(id: string): any {
  return (equipmentData as any).equipment?.find((i: any) => i.id === id);
}

// ---- resolve character fields ----

function resolve(char: any) {
  const race = (racesData as any).races?.find((r: any) => r.id === char.race_id);
  const subrace = race?.subraces?.find((s: any) => s.id === char.subrace_id);
  const cls = (classesData as any).classes?.find((c: any) => c.id === char.class_id);
  const subclass = cls?.subclasses?.find((s: any) => s.id === char.subclass_id);
  const bg = (backgroundsData as any).backgrounds?.find((b: any) => b.id === char.background_id);

  // Use derived.ts computeAll for accurate HP/AC/speed/initiative
  const derived = computeAll(char, {
    hpOptions: { includeFlatSubraceHP: true, includeSubraceLevelBonuses: true },
  });
  const { finalAbilityScores, abilityMods, proficiencyBonus, hp, ac, speed, initiative } = derived;

  const level = char.level || 1;
  const savingThrows: string[] = cls?.savingThrows || [];
  const skillProfs: string[] = extractSpellIds(char.selected_skills) || [];
  // selected_skills might be string[] directly
  const skillIds: string[] = Array.isArray(char.selected_skills)
    ? char.selected_skills.map((s: any) => typeof s === "string" ? s : s?.id || s?.value || "")
    : [];

  // Spells: extract all formats
  const cantrips = extractSpellIds(char.selected_cantrips || char.selectedCantrips);
  const selectedSpells = extractSpellIds(char.selected_spells || char.selectedSpells);
  const preparedSpells: string[] = char.prepared_spells || char.preparedSpells || [];

  const equipment: any[] = char.equipment || [];
  const currency = char.currency || {};

  const hitDieMap: Record<string, number> = {
    barbarian: 12, fighter: 10, paladin: 10, ranger: 10,
    bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8,
    sorcerer: 6, wizard: 6, artificer: 8,
  };
  const hitDieSize = hitDieMap[char.class_id] || 8;
  const hitDice = `${level}d${hitDieSize}`;

  return {
    race, subrace, cls, subclass, bg,
    finalAbilityScores, abilityMods, level, proficiencyBonus,
    savingThrows, skillIds,
    cantrips, selectedSpells, preparedSpells,
    equipment, currency,
    hp, ac, speed, initiative, hitDice,
  };
}

// ---- Equipment formatting ----

function formatEquipItem(item: any, forHtml = false): string {
  const ref = equipLookup(item.id) || {};
  const name = item.name || ref.name || item.id || "?";
  const parts: string[] = [];

  // Equipped slot
  if (item.equippedSlot) {
    parts.push(forHtml ? `<b>[${slotLabels[item.equippedSlot] || item.equippedSlot}]</b>` : `[${slotLabels[item.equippedSlot] || item.equippedSlot}]`);
  }

  // Damage
  const dmg = item.damage || ref.damage;
  if (dmg) {
    const dmgStr = typeof dmg === "object" ? dmg.dice : dmg;
    const dmgType = item.damageType || ref.damageType || "";
    parts.push(dmgStr + (dmgType ? ` ${dmgType}` : ""));
  }

  // AC
  const acVal = item.ac || ref.ac;
  if (acVal) parts.push(`AC ${acVal}`);

  // Properties
  const props: string[] = item.properties || ref.properties || [];
  if (props.length) {
    parts.push(props.map((p: string) => propertyMap[p] || p).join("·"));
  }

  const qty = (item.quantity || 1) > 1 ? ` ×${item.quantity}` : "";
  const detail = parts.length ? ` — ${parts.join(", ")}` : "";
  return forHtml
    ? `${esc(name)}${qty}${detail}`
    : `${name}${qty}${detail}`;
}

// ---- Markdown Export ----

export function generateCharacterMarkdown(char: any): string {
  const d = resolve(char);
  const name = char.name || "未命名角色";

  let md = `# ${name}\n\n`;
  md += `> ${d.race?.name || char.race_id || "?"}${d.subrace ? `（${d.subrace.name}）` : ""} · ${d.cls?.name || char.class_id || "?"}${d.subclass ? `（${d.subclass.name}）` : ""} ${d.level}级`;
  if (char.alignment) md += ` · ${char.alignment}`;
  if (d.bg) md += ` · 背景：${d.bg.name}`;
  md += "\n\n";

  // Appearance
  const app = char.appearance || {};
  const appFields = [
    app.height && `身高 ${app.height}`, app.weight && `体重 ${app.weight}`,
    app.eyes && `眼睛 ${app.eyes}`, app.skin && `肤色 ${app.skin}`,
    app.hair && `头发 ${app.hair}`,
  ].filter(Boolean);
  if (appFields.length) md += `**外貌**: ${appFields.join(" · ")}\n\n`;

  // Combat stats (computed)
  md += `## 战斗数据\n\n`;
  md += `| AC | 先攻 | 速度 | HP | 生命骰 | 熟练加值 |\n|---|---|---|---|---|---|\n`;
  md += `| ${d.ac} | ${fmt(d.initiative)} | ${d.speed}尺 | ${d.hp} | ${d.hitDice} | +${d.proficiencyBonus} |\n\n`;

  // Abilities (with racial bonuses applied)
  md += `## 属性值 & 豁免\n\n`;
  md += `| 属性 | 值 | 调整值 | 豁免 |\n|---|---|---|---|\n`;
  for (const [id, score] of Object.entries(d.finalAbilityScores)) {
    const mod = d.abilityMods[id as keyof typeof d.abilityMods];
    const prof = d.savingThrows.includes(id);
    const save = mod + (prof ? d.proficiencyBonus : 0);
    md += `| ${abilityNames[id] || id} | ${score} | ${fmt(mod)} | ${fmt(save)}${prof ? " ★" : ""} |\n`;
  }

  // Skills
  md += `\n## 技能\n\n`;
  for (const s of (skillsData as any).skills || []) {
    const prof = d.skillIds.includes(s.id);
    const mod = d.abilityMods[s.ability as keyof typeof d.abilityMods] || 0;
    const total = mod + (prof ? d.proficiencyBonus : 0);
    md += prof ? `- **★ ${s.name}** (${abilityNames[s.ability] || s.ability}): ${fmt(total)}\n`
      : `- ${s.name} (${abilityNames[s.ability] || s.ability}): ${fmt(total)}\n`;
  }

  // Equipment — equipped first, then rest
  if (d.equipment.length) {
    const equipped = d.equipment.filter((e: any) => e.equippedSlot);
    const carried = d.equipment.filter((e: any) => !e.equippedSlot);

    md += `\n## 装备\n\n`;
    if (equipped.length) {
      md += `### 已装备\n\n`;
      for (const item of equipped) md += `- **${formatEquipItem(item)}**\n`;
      md += "\n";
    }
    if (carried.length) {
      md += `### 背包\n\n`;
      for (const item of carried) md += `- ${formatEquipItem(item)}\n`;
    }
  }

  // Currency
  const coins = Object.entries(d.currency).filter(([, v]) => (v as number) > 0);
  if (coins.length) md += `\n**金币**: ${coins.map(([k, v]) => `${v} ${k}`).join(", ")}\n`;

  // Spells — cantrips, selected/known, prepared
  if (d.cantrips.length || d.selectedSpells.length || d.preparedSpells.length) {
    md += `\n## 法术\n\n`;
    if (d.cantrips.length) md += `**戏法**: ${d.cantrips.map(spellName).join("、")}\n\n`;
    if (d.selectedSpells.length) md += `**已学法术**: ${d.selectedSpells.map(spellName).join("、")}\n\n`;
    if (d.preparedSpells.length) {
      const preparedOnly = d.preparedSpells.filter(id => !d.selectedSpells.includes(id) || true);
      md += `**已准备法术**: ${preparedOnly.map(spellName).join("、")}\n\n`;
    }
  }

  // Personality
  const p = char.personality || {};
  const traits = p.traits || char.personality_traits;
  if (traits || p.ideals || p.bonds || p.flaws) {
    md += `## 个性特征\n\n`;
    if (traits) md += `- **特质**: ${Array.isArray(traits) ? traits.join("；") : traits}\n`;
    if (p.ideals) md += `- **理想**: ${p.ideals}\n`;
    if (p.bonds) md += `- **羁绊**: ${p.bonds}\n`;
    if (p.flaws) md += `- **缺陷**: ${p.flaws}\n`;
  }

  if (char.backstory) md += `\n## 背景故事\n\n${char.backstory}\n`;

  return md;
}

export function downloadCharacterMarkdown(char: any) {
  const md = generateCharacterMarkdown(char);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${char.name || "角色卡"}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- PDF Export (HTML print) ----

export function downloadCharacterPDF(char: any) {
  const d = resolve(char);
  const name = char.name || "未命名角色";
  const raceName = d.race?.name || char.race_id || "?";
  const className = d.cls?.name || char.class_id || "?";
  const avatarSrc = char.avatar || "";

  // Ability boxes
  const abilityBoxes = Object.entries(d.finalAbilityScores).map(([id, score]: [string, number]) => {
    const mod = d.abilityMods[id as keyof typeof d.abilityMods];
    const prof = d.savingThrows.includes(id);
    const save = mod + (prof ? d.proficiencyBonus : 0);
    return `<div class="ability-box${prof ? " prof" : ""}">
      <div class="ab-name">${abilityNames[id] || id}</div>
      <div class="ab-score">${score}</div>
      <div class="ab-mod">${fmt(mod)}</div>
      <div class="ab-save">豁免 ${fmt(save)}${prof ? " ★" : ""}</div>
    </div>`;
  }).join("");

  // Skills
  const skills = (skillsData as any).skills || [];
  const half = Math.ceil(skills.length / 2);
  const buildSkillCol = (arr: any[]) => arr.map((s: any) => {
    const prof = d.skillIds.includes(s.id);
    const mod = d.abilityMods[s.ability as keyof typeof d.abilityMods] || 0;
    const total = mod + (prof ? d.proficiencyBonus : 0);
    return `<div class="skill-row${prof ? " prof" : ""}"><span class="sk-dot">${prof ? "●" : "○"}</span><span class="sk-name">${s.name}</span><span class="sk-val">${fmt(total)}</span></div>`;
  }).join("");
  const skillCol1 = buildSkillCol(skills.slice(0, half));
  const skillCol2 = buildSkillCol(skills.slice(half));

  // Equipment — split equipped vs carried
  const equipped = d.equipment.filter((e: any) => e.equippedSlot);
  const carried = d.equipment.filter((e: any) => !e.equippedSlot);
  const equipSection = (items: any[], label: string) => {
    if (!items.length) return "";
    return `<div style="margin-bottom:4px;font-size:9px;color:#94a3b8;font-weight:600">${label}</div>` +
      items.map((item: any) => `<div class="equip-item">${formatEquipItem(item, true)}</div>`).join("");
  };
  const equipHtml = equipSection(equipped, "已装备") + equipSection(carried, "背包");

  // Currency
  const coinParts = Object.entries(d.currency).filter(([, v]) => (v as number) > 0).map(([k, v]) => `${v} ${k}`);

  // Spells
  let spellsHtml = "";
  if (d.cantrips.length || d.selectedSpells.length || d.preparedSpells.length) {
    spellsHtml = `<div class="card"><div class="card-title">法术</div>`;
    if (d.cantrips.length) spellsHtml += `<div class="spell-group"><b>戏法</b> ${d.cantrips.map(spellName).join("、")}</div>`;
    if (d.selectedSpells.length) spellsHtml += `<div class="spell-group"><b>已学法术</b> ${d.selectedSpells.map(spellName).join("、")}</div>`;
    if (d.preparedSpells.length) spellsHtml += `<div class="spell-group"><b>已准备</b> ${d.preparedSpells.map(spellName).join("、")}</div>`;
    spellsHtml += `</div>`;
  }

  // Appearance
  const app = char.appearance || {};
  const appParts = [app.height && `身高 ${app.height}`, app.weight && `体重 ${app.weight}`,
    app.eyes && `眼睛 ${app.eyes}`, app.skin && `肤色 ${app.skin}`, app.hair && `头发 ${app.hair}`].filter(Boolean);

  // Personality
  const p = char.personality || {};
  const traits = p.traits || char.personality_traits;
  const persLines = [
    traits ? `<b>特质：</b>${Array.isArray(traits) ? traits.join("；") : esc(String(traits))}` : "",
    p.ideals ? `<b>理想：</b>${esc(p.ideals)}` : "",
    p.bonds ? `<b>羁绊：</b>${esc(p.bonds)}` : "",
    p.flaws ? `<b>缺陷：</b>${esc(p.flaws)}` : "",
  ].filter(Boolean).map(l => `<div class="pers-line">${l}</div>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(name)} - 角色卡</title>
<style>
@page{size:A4;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html,body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;background:#0f172a;color:#cbd5e1;font-size:10.5px;line-height:1.45;min-height:100%}
.page{max-width:780px;margin:0 auto;padding:12mm;position:relative}
.page::before{content:"";position:fixed;top:0;left:0;right:0;bottom:0;background:#0f172a;z-index:-1;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.hdr{display:flex;gap:14px;align-items:center;padding:14px 16px;background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid #334155;border-radius:8px;margin-bottom:10px}
.avatar{width:72px;height:72px;border-radius:8px;object-fit:cover;border:2px solid #d97706;flex-shrink:0}
.avatar-placeholder{width:72px;height:72px;border-radius:8px;border:2px dashed #475569;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#475569;font-size:28px}
.hdr-info{flex:1;min-width:0}
.hdr-name{font-size:22px;font-weight:800;color:#fbbf24;letter-spacing:0.5px}
.hdr-sub{color:#94a3b8;font-size:11.5px;margin-top:2px}
.hdr-appear{color:#64748b;font-size:10px;margin-top:4px}
.combat{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:10px}
.cb{background:#1e293b;border:1px solid #334155;border-radius:6px;padding:6px 4px;text-align:center}
.cb .cl{font-size:8.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px}
.cb .cv{font-size:20px;font-weight:800;color:#fbbf24;line-height:1.2}
.cb .cv.red{color:#f87171}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.card{background:#1e293b;border:1px solid #334155;border-radius:6px;padding:10px;break-inside:avoid}
.card-title{font-size:11.5px;font-weight:700;color:#f59e0b;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #334155;letter-spacing:0.3px}
.ab-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.ability-box{background:#0f172a;border:1px solid #334155;border-radius:6px;padding:6px;text-align:center}
.ability-box.prof{border-color:#92400e;background:#1c1917}
.ab-name{font-size:9px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
.ab-score{font-size:22px;font-weight:800;color:#e2e8f0;line-height:1.2}
.ab-mod{font-size:13px;font-weight:700;color:#fbbf24}
.ab-save{font-size:8.5px;color:#64748b;margin-top:2px}
.ability-box.prof .ab-save{color:#d97706}
.skill-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
.skill-row{display:flex;align-items:center;padding:2px 0;border-bottom:1px solid #1e293b}
.skill-row.prof{color:#fbbf24}
.sk-dot{width:14px;font-size:8px;flex-shrink:0}
.sk-name{flex:1;font-size:10px}
.sk-val{font-weight:700;font-size:10.5px;min-width:24px;text-align:right}
.equip-item{padding:3px 0;border-bottom:1px solid #1e293b;font-size:10.5px}
.equip-item b{color:#fbbf24}
.spell-group{margin-top:4px;font-size:10.5px;line-height:1.6}
.pers-line{margin-bottom:3px;font-size:10.5px;line-height:1.5}
.pers-line b{color:#94a3b8}
.backstory{white-space:pre-wrap;font-size:10.5px;line-height:1.6;color:#94a3b8}
@media print{html,body,.page::before,.hdr,.cb,.card,.ability-box,.skill-row,.equip-item{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}
</style></head><body>
<div class="page">
<div class="hdr">
  ${avatarSrc ? `<img class="avatar" src="${avatarSrc}" alt="">` : `<div class="avatar-placeholder">⚔</div>`}
  <div class="hdr-info">
    <div class="hdr-name">${esc(name)}</div>
    <div class="hdr-sub">${raceName}${d.subrace ? `（${d.subrace.name}）` : ""} · ${className}${d.subclass ? `（${d.subclass.name}）` : ""} ${d.level}级${char.alignment ? ` · ${char.alignment}` : ""}${d.bg ? ` · ${d.bg.name}` : ""}</div>
    ${appParts.length ? `<div class="hdr-appear">${appParts.join(" · ")}</div>` : ""}
  </div>
</div>
<div class="combat">
  <div class="cb"><div class="cl">AC</div><div class="cv">${d.ac}</div></div>
  <div class="cb"><div class="cl">先攻</div><div class="cv">${fmt(d.initiative)}</div></div>
  <div class="cb"><div class="cl">速度</div><div class="cv">${d.speed}尺</div></div>
  <div class="cb"><div class="cl">HP</div><div class="cv red">${d.hp}</div></div>
  <div class="cb"><div class="cl">生命骰</div><div class="cv">${d.hitDice}</div></div>
  <div class="cb"><div class="cl">熟练</div><div class="cv">+${d.proficiencyBonus}</div></div>
</div>
<div class="row">
  <div class="card"><div class="card-title">属性值</div><div class="ab-grid">${abilityBoxes}</div></div>
  <div class="card"><div class="card-title">技能</div><div class="skill-cols">${skillCol1}${skillCol2}</div></div>
</div>
<div class="row">
  <div class="card"><div class="card-title">装备${coinParts.length ? ` <span style="font-weight:400;color:#64748b;font-size:9px">(${coinParts.join(", ")})</span>` : ""}</div>${equipHtml || '<div style="color:#475569">暂无装备</div>'}</div>
  ${spellsHtml || `<div class="card"><div class="card-title">个性 &amp; 背景</div>${persLines}${char.backstory ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #334155"><div style="font-size:9px;color:#94a3b8;font-weight:600;margin-bottom:3px">背景故事</div><div class="backstory">${esc(char.backstory || "")}</div></div>` : ""}</div>`}
</div>
${spellsHtml ? `<div class="row"><div class="card"><div class="card-title">个性特征</div>${persLines}</div><div class="card"><div class="card-title">背景故事</div><div class="backstory">${char.backstory ? esc(char.backstory) : "无"}</div></div></div>` : ""}
</div>
<script>window.onload=function(){window.print()}<\/script>
</body></html>`;

  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}
