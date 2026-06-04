#!/usr/bin/env python3
"""
修复 spells.json 中 controlEffect 与 effects 数组不一致的法术。
使用 LLM API 辅助生成正确的 escape/duration 配置。
"""
import json
import sys
import os
import time
import httpx

sys.stdout.reconfigure(line_buffering=True)

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = os.environ.get("YUNWU_API_KEY", "")
MODEL = "gpt-5.4"

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPELLS_PATH = os.path.join(PROJECT_ROOT, "frontend/app/data/rules/spells.json")
MISMATCH_PATH = os.path.join(PROJECT_ROOT, "scripts/spell_effect_mismatch.json")
OUTPUT_PATH = os.path.join(PROJECT_ROOT, "scripts/spell_effect_fixes.json")

with open(SPELLS_PATH, encoding="utf-8") as f:
    all_data = json.load(f)
    spells = all_data["spells"]

with open(MISMATCH_PATH, encoding="utf-8") as f:
    mismatches = json.load(f)

spell_map = {s["id"]: s for s in spells}

SYSTEM_PROMPT = """你是D&D 5E法术数据修复助手。我会给你一个法术的当前 effects 数组和 controlEffect 对象。
controlEffect 包含正确的状态效果元数据（持续时间、豁免逃脱等），但 effects 数组缺少对应的 duration 或 escape 配置。

你需要根据 controlEffect 的信息，生成需要添加到 effects 数组中对应 phase 的字段。

**可用字段说明**：
1. `duration` - 添加到 phase 级别（与 effects/trigger 同级），格式：`{"rounds": N}` 或 `{"rounds": N, "concentration": true}`
2. `escape` - 添加到 phase 级别，格式：
   - 回合结束豁免：`{"type": "save", "save_type": "wis|con|str|dex|cha|int", "timing": "end_of_turn"}`
   - 动作检定：`{"type": "check", "ability": "str|wis|...", "timing": "action"}`
   - 特殊条件：`{"type": "special", "description": "描述"}`

**规则**：
- 如果 controlEffect.durationRounds 存在，phase 需要加 duration.rounds
- 如果法术需要专注(concentration=true)，duration 里加 "concentration": true
- 如果 controlEffect.ongoingSave 存在，phase 需要加 escape（type=save）
- 如果 controlEffect.escapeAction 存在，phase 需要加 escape（type=check 或 save）
- 只输出需要**新增**的字段，不要修改已有字段
- 返回纯JSON，格式：{"phase_index": 0, "add_fields": {"duration": {...}, "escape": {...}}}
  如果有多个phase需修改，返回数组。"""

fixes = []
failed = []

for i, mm in enumerate(mismatches):
    spell_id = mm["id"]
    spell = spell_map.get(spell_id)
    if not spell:
        print(f"[SKIP] {spell_id} not found")
        continue

    print(f"\n[{i+1}/{len(mismatches)}] Processing {spell_id} ({mm['name']}/{mm['nameEn']})...")

    user_msg = json.dumps({
        "spell_id": spell_id,
        "name": mm["name"],
        "nameEn": mm["nameEn"],
        "concentration": mm["concentration"],
        "controlEffect": mm["controlEffect"],
        "problems": mm["problems"],
        "current_effects": spell["effects"],
    }, ensure_ascii=False, indent=2)

    try:
        resp = httpx.post(
            API_URL,
            headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
            json={"model": MODEL, "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ]},
            timeout=60,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        # Strip markdown fences
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

        fix_data = json.loads(content)
        fixes.append({"spell_id": spell_id, "name": mm["name"], "nameEn": mm["nameEn"], "fix": fix_data})
        print(f"  ✅ Fix: {json.dumps(fix_data, ensure_ascii=False)}")
    except Exception as e:
        print(f"  ❌ Error: {e}")
        failed.append({"spell_id": spell_id, "name": mm["name"], "error": str(e)})

    time.sleep(0.5)

print(f"\n\nTotal fixes: {len(fixes)}, Failed: {len(failed)}")
with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    json.dump({"fixes": fixes, "failed": failed}, f, ensure_ascii=False, indent=2)
print(f"Saved to {OUTPUT_PATH}")

