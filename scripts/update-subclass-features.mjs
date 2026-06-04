#!/usr/bin/env node
/**
 * Batch update subclass feature descriptions in classes-progression.json
 * Uses AI API to generate detailed Chinese descriptions based on SRD references
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const API_URL = 'https://yunwu.ai/v1/chat/completions';
const API_KEY = process.env.YUNWU_API_KEY;
const MODEL = 'gpt-5.4';

// Load SRD features for reference
const srdFeatures = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'dnd-platform/references/5e-srd/5e-SRD-Features.json'), 'utf8'
));
const srdSubclassFeatures = srdFeatures.filter(f => f.subclass);

// Map SRD subclass index -> features
const srdMap = {};
for (const f of srdSubclassFeatures) {
  const key = f.subclass.index;
  if (!srdMap[key]) srdMap[key] = [];
  srdMap[key].push({ name: f.name, level: f.level, desc: f.desc.join(' ') });
}

// Load current progression data
const progPath = path.join(ROOT, 'frontend/app/data/rules/classes-progression.json');
const progData = JSON.parse(fs.readFileSync(progPath, 'utf8'));

// SRD subclass ID mapping (our ID -> SRD index)
const SRD_ID_MAP = {
  berserker: 'berserker',
  lore: 'lore',
  life: 'life',
  land: 'land',
  champion: 'champion',
  open_hand: 'open-hand',
  devotion: 'devotion',
  hunter: 'hunter',
  thief: 'thief',
  draconic: 'draconic',
  fiend: 'fiend',
  evocation: 'evocation',
};

// Missing features to add
const MISSING_FEATURES = {
  fighter: {
    battle_master: [
      { id: 'improved_combat_superiority_10', level: 10, name: '改良战斗优势', nameEn: 'Improved Combat Superiority' },
      { id: 'improved_combat_superiority_18', level: 18, name: '超凡战斗优势', nameEn: 'Superior Combat Superiority' },
    ],
  },
  cleric: {
    war: [
      { id: 'war_gods_blessing', level: 6, name: '战争之神的祝福', nameEn: "War God's Blessing" },
      { id: 'divine_strike_war', level: 8, name: '神圣打击', nameEn: 'Divine Strike' },
    ],
  },
};

async function callAI(prompt) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `你是D&D 5E规则专家。你需要为子职业特性编写准确、详细的中文描述。
要求：
1. 必须包含具体的机制细节：骰子类型、DC计算公式、距离、持续时间、使用次数、恢复条件等
2. 简洁但完整，不要废话，通常60-150个中文字符
3. 必须符合D&D 5E PHB原版规则，不能编造
4. 返回纯JSON数组，每个元素是 {"id": "feature_id", "description": "详细描述"}
5. 不要加markdown代码块标记`
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

function parseJSON(text) {
  // Try direct parse
  try { return JSON.parse(text); } catch {}
  // Try extracting JSON from markdown code block
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) try { return JSON.parse(match[1]); } catch {}
  // Try finding array
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) try { return JSON.parse(arrMatch[0]); } catch {}
  return null;
}

async function processSubclass(classId, className, subclass, srdRef) {
  const features = subclass.features || [];
  const missingFeats = MISSING_FEATURES[classId]?.[subclass.id] || [];

  // Build prompt
  let prompt = `请为"${className}"的子职业"${subclass.name}(${subclass.nameEn || subclass.id})"的以下特性编写详细中文描述。\n\n`;

  if (srdRef && srdRef.length > 0) {
    prompt += `SRD英文参考（仅供参考，以PHB原版为准）：\n`;
    for (const r of srdRef) {
      prompt += `- L${r.level} ${r.name}: ${r.desc}\n`;
    }
    prompt += '\n';
  }

  prompt += `当前特性列表（需要改进描述的）：\n`;
  for (const f of features) {
    prompt += `- id="${f.id}", L${f.level} ${f.name}: "${f.description}" (${f.description.length}字符${f.description.length < 60 ? '，太短需扩充' : ''})\n`;
  }

  if (missingFeats.length > 0) {
    prompt += `\n缺失的特性（需要新增描述）：\n`;
    for (const f of missingFeats) {
      prompt += `- id="${f.id}", L${f.level} ${f.name}(${f.nameEn}): 需要编写完整描述\n`;
    }
  }

  prompt += `\n请返回JSON数组，包含所有特性（包括已有的和缺失的）的更新描述。对于描述已经足够详细的（超过60字符且包含具体数值），可以保持原样。对于太短或缺少机制细节的，必须扩充。`;

  console.log(`  Processing ${subclass.name} (${subclass.id})...`);
  const result = await callAI(prompt);
  const updates = parseJSON(result);

  if (!updates || !Array.isArray(updates)) {
    console.error(`    ❌ Failed to parse AI response for ${subclass.id}`);
    console.error(`    Raw: ${result.substring(0, 200)}`);
    return { updated: 0, added: 0 };
  }

  let updated = 0, added = 0;

  // Apply updates to existing features
  for (const upd of updates) {
    const existing = features.find(f => f.id === upd.id);
    if (existing) {
      if (upd.description && upd.description.length > existing.description.length) {
        existing.description = upd.description;
        updated++;
      }
    } else {
      // New feature - check if it's in missing list
      const missing = missingFeats.find(m => m.id === upd.id);
      if (missing && upd.description) {
        features.push({
          id: missing.id,
          level: missing.level,
          name: missing.name,
          nameEn: missing.nameEn,
          description: upd.description,
        });
        added++;
      }
    }
  }

  // Sort features by level
  features.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));

  console.log(`    ✅ ${subclass.name}: ${updated} updated, ${added} added`);
  return { updated, added };
}

async function main() {
  let totalUpdated = 0, totalAdded = 0;

  for (const [classId, cls] of Object.entries(progData.classes)) {
    console.log(`\n=== ${cls.name} (${classId}) ===`);

    for (const [lv, lvData] of Object.entries(cls.levelProgression)) {
      for (const feat of lvData.features || []) {
        if (feat.type === 'subclass' && feat.choices) {
          for (const sc of feat.choices) {
            const srdId = SRD_ID_MAP[sc.id];
            const srdRef = srdId ? (srdMap[srdId] || []) : [];

            const { updated, added } = await processSubclass(classId, cls.name, sc, srdRef);
            totalUpdated += updated;
            totalAdded += added;

            // Rate limiting
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }
    }
  }

  // Write updated file
  fs.writeFileSync(progPath, JSON.stringify(progData, null, 2) + '\n', 'utf8');
  console.log(`\n✅ Done! Updated ${totalUpdated} descriptions, added ${totalAdded} new features.`);
  console.log(`   File: ${progPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
