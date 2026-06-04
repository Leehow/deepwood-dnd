#!/usr/bin/env python3
"""
Fix monster actions/abilities using SRD reference + AI translation.
Processes in batches, with checkpoint saving to resume on failure.
"""

import json
import os
import sys
import time
import httpx

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRD_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/references/5e-srd/5e-SRD-Monsters.json")
OUR_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/configs/npc/monsters.json")
CHECKPOINT_PATH = os.path.join(PROJECT_ROOT, "scripts/monster_actions_checkpoint.json")

AI_API_URL = "https://yunwu.ai/v1/chat/completions"
AI_API_KEY = os.environ.get("YUNWU_API_KEY", "")
AI_MODEL = "gpt-5.2"

BATCH_SIZE = 5  # monsters per AI call


def load_data():
    with open(SRD_PATH) as f:
        srd = json.load(f)
    with open(OUR_PATH) as f:
        ours = json.load(f)
    return srd, ours


def load_checkpoint():
    if os.path.exists(CHECKPOINT_PATH):
        with open(CHECKPOINT_PATH) as f:
            return json.load(f)
    return {"done": []}


def save_checkpoint(cp):
    with open(CHECKPOINT_PATH, "w") as f:
        json.dump(cp, f)


def build_srd_summary(srd_monster):
    """Extract action/ability text from SRD monster for AI prompt."""
    parts = []

    sa = srd_monster.get("special_abilities", [])
    if sa:
        parts.append("Special Abilities:")
        for a in sa:
            parts.append(f"  - {a['name']}: {a['desc']}")

    actions = srd_monster.get("actions", [])
    if actions:
        parts.append("Actions:")
        for a in actions:
            parts.append(f"  - {a['name']}: {a['desc']}")

    la = srd_monster.get("legendary_actions", [])
    if la:
        parts.append("Legendary Actions:")
        for a in la:
            parts.append(f"  - {a['name']}: {a['desc']}")

    reactions = srd_monster.get("reactions", [])
    if reactions:
        parts.append("Reactions:")
        for a in reactions:
            parts.append(f"  - {a['name']}: {a['desc']}")

    return "\n".join(parts)


def call_ai(prompt, retries=3):
    for attempt in range(retries):
        try:
            resp = httpx.post(
                AI_API_URL,
                headers={
                    "Authorization": f"Bearer {AI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": AI_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "max_tokens": 8000,
                },
                timeout=120,
            )
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"].strip()
            # Extract JSON from markdown code blocks
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            return json.loads(text)
        except json.JSONDecodeError as e:
            print(f"    JSON parse error (attempt {attempt+1}): {e}")
            if attempt < retries - 1:
                time.sleep(2)
        except Exception as e:
            print(f"    API error (attempt {attempt+1}): {e}")
            if attempt < retries - 1:
                time.sleep(5)
    return None


def build_batch_prompt(batch):
    """Build a prompt for a batch of monsters."""
    prompt = """你是D&D 5E怪物数据翻译专家。请将以下怪物的SRD英文动作/能力数据翻译为中文。

要求：
1. name格式: "中文名 English Name"（如 "多重攻击 Multiattack"）
2. description: 完整翻译为中文，保留所有机制数据（命中加值、伤害骰、DC、距离等）
3. 严格保留原文的机制细节，不要编造或省略
4. 输出纯JSON，格式如下：

```json
[
  {
    "nameEn": "Monster Name",
    "specialAbilities": [{"name": "中文 English", "description": "..."}],
    "actions": [{"name": "中文 English", "description": "..."}],
    "legendaryActions": {"description": "...(传奇动作说明)", "actions": [{"name": "...", "description": "..."}]},
    "reactions": [{"name": "中文 English", "description": "..."}]
  }
]
```

如果某个怪物没有legendaryActions/reactions，对应字段设为null。

以下是需要翻译的怪物数据：
"""
    for name_en, srd_text in batch:
        prompt += f"\n### {name_en}\n{srd_text}\n"

    prompt += "\n请输出JSON数组（不要输出其他内容）："
    return prompt


def main():
    print("Loading data...")
    srd_list, our_data = load_data()
    srd_by_name = {m["name"].lower(): m for m in srd_list}
    our_by_name_en = {}
    for i, m in enumerate(our_data["monsters"]):
        key = m.get("nameEn", "").lower().strip()
        if key:
            our_by_name_en[key] = i

    checkpoint = load_checkpoint()
    done_set = set(checkpoint["done"])

    # Build work list: matched monsters needing action fixes
    work = []
    for m in our_data["monsters"]:
        name_en = m.get("nameEn", "").lower().strip()
        if name_en not in srd_by_name:
            continue
        if name_en in done_set:
            continue
        srd_m = srd_by_name[name_en]
        srd_text = build_srd_summary(srd_m)
        if not srd_text.strip():
            continue
        work.append((m.get("nameEn", ""), srd_text))

    print(f"Total to process: {len(work)} monsters ({len(done_set)} already done)")

    if not work:
        print("Nothing to do!")
        return

    total_batches = (len(work) + BATCH_SIZE - 1) // BATCH_SIZE
    fixed = 0

    for batch_idx in range(0, len(work), BATCH_SIZE):
        batch = work[batch_idx : batch_idx + BATCH_SIZE]
        batch_num = batch_idx // BATCH_SIZE + 1
        names = [b[0] for b in batch]
        print(f"\nBatch {batch_num}/{total_batches}: {', '.join(names)}")

        prompt = build_batch_prompt(batch)
        result = call_ai(prompt)

        if not result or not isinstance(result, list):
            print(f"  FAILED - skipping batch")
            continue

        # Apply results
        result_map = {r["nameEn"].lower(): r for r in result if "nameEn" in r}

        for name_en, _ in batch:
            key = name_en.lower()
            r = result_map.get(key)
            idx = our_by_name_en.get(key)

            if r is None or idx is None:
                print(f"  {name_en}: no AI result, skipped")
                continue

            m = our_data["monsters"][idx]

            if r.get("specialAbilities"):
                m["specialAbilities"] = r["specialAbilities"]
            if r.get("actions"):
                m["actions"] = r["actions"]
            if r.get("legendaryActions"):
                m["legendaryActions"] = r["legendaryActions"]
            elif "legendaryActions" in m and not srd_by_name[key].get("legendary_actions"):
                del m["legendaryActions"]
            if r.get("reactions"):
                m["reactions"] = r["reactions"]

            checkpoint["done"].append(key)
            done_set.add(key)
            fixed += 1
            print(f"  {name_en}: OK")

        # Save checkpoint and data after each batch
        save_checkpoint(checkpoint)
        with open(OUR_PATH, "w") as f:
            json.dump(our_data, f, indent=2, ensure_ascii=False)

        time.sleep(1)

    print(f"\nDone! Fixed {fixed} monsters total.")
    # Cleanup checkpoint
    if os.path.exists(CHECKPOINT_PATH):
        os.remove(CHECKPOINT_PATH)
        print("Checkpoint cleaned up.")


if __name__ == "__main__":
    main()
