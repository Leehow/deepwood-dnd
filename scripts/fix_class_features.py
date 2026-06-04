#!/usr/bin/env python3
"""
D&D 5E 批量修复脚本
根据校对报告 + SRD 原文，自动修复 classes-progression.json 中的问题。

Usage:
    python3 scripts/fix_class_features.py [class_id]
    python3 scripts/fix_class_features.py           # 修复所有
    python3 scripts/fix_class_features.py monk       # 只修复某个
"""

import json
import sys
import os
import time
import re
import httpx

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = os.environ.get("YUNWU_API_KEY", "")
MODEL = "gpt-5.2"

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRD_FEATURES_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/references/5e-srd/5e-SRD-Features.json")
OUR_PROGRESSION_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/configs/rules/classes-progression.json")
AUDIT_DIR = os.path.join(PROJECT_ROOT, "dnd-platform/references/audit-reports")
BACKUP_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/configs/rules/classes-progression.json.bak")


def load_srd_base_features(class_id: str) -> list[dict]:
    all_features = json.load(open(SRD_FEATURES_PATH, encoding="utf-8"))
    features = []
    for f in all_features:
        if f.get("class", {}).get("index") == class_id and not f.get("subclass"):
            name = f["name"]
            # Skip individual invocation/maneuver entries (they bloat the context)
            if "Eldritch Invocation:" in name:
                continue
            features.append({
                "name": name,
                "level": f["level"],
                "desc": f["desc"],
            })
    features.sort(key=lambda x: (x["level"], x["name"]))
    return features


def load_audit_report(class_id: str) -> str:
    path = os.path.join(AUDIT_DIR, f"{class_id}.md")
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def fix_class(class_id: str, full_data: dict) -> dict | None:
    """Use AI to fix a single class, return the corrected class dict."""
    classes = full_data.get("classes", full_data)
    cls_data = classes.get(class_id)
    if not cls_data:
        print(f"  Class {class_id} not found in our data!")
        return None

    srd_features = load_srd_base_features(class_id)
    audit_report = load_audit_report(class_id)

    if not audit_report or len(audit_report.strip()) < 50:
        print(f"  No audit report for {class_id}, skipping.")
        return None

    # Check if report says no issues
    if "未发现问题" in audit_report and "###" not in audit_report:
        print(f"  No issues found for {class_id}, skipping.")
        return None

    prompt = f"""你是 D&D 5E 规则专家和 JSON 数据工程师。请根据校对报告修复我们的职业数据。

## 任务
根据下方的"校对报告"和"SRD 官方数据"，修复"我们当前的数据"中的问题。

## 修复规则
1. **只修改 levelProgression 中的 features 数组**，不要改 hitDie、primaryAbility 等元数据
2. **不要改数值字段**（kiPoints, martialArtsDie, rages 等）除非校对报告明确指出数值错误
3. **修复描述**：根据 SRD 补全关键遗漏的机制细节（豁免类型、DC、射程、持续时间、限制条件等）
4. **补充缺失特性**：校对报告标记为"缺失特性"的，添加到对应等级的 features 数组中
5. **保持中文**：所有 description 用中文，保持精简但准确（不需要逐字翻译 SRD，关键数值和规则机制不能遗漏）
6. **保留现有字段结构**：每个 feature 保持 id, name, nameEn, type, description 等字段；子职业选择(choices)保持不变
7. **不要删除任何现有特性或子职业数据**
8. **不要修改子职业的 features 数组**（choices 里的 features），子职业特性不在本次修复范围

## 输出格式
直接输出修复后的完整 JSON 对象（就是这个职业的完整数据，包含 id, name, hitDie, levelProgression 等所有字段）。
不要输出解释文字，只输出 JSON。用 ```json 包裹。

---

## 校对报告
{audit_report}

## SRD 官方基础特性（英文原文）
```json
{json.dumps(srd_features, ensure_ascii=False, indent=2)}
```

## 我们当前的数据
```json
{json.dumps(cls_data, ensure_ascii=False, indent=2)}
```
"""

    print(f"  Calling API...", end=" ", flush=True)
    start = time.time()

    try:
        resp = httpx.post(
            API_URL,
            headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
            json={
                "model": MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.05,
                "max_tokens": 16384,
            },
            timeout=600,
        )
        resp.raise_for_status()
        result = resp.json()
        content = result["choices"][0]["message"]["content"]
        elapsed = time.time() - start
        tokens = result.get("usage", {})
        print(f"OK ({elapsed:.1f}s, in:{tokens.get('prompt_tokens','?')} out:{tokens.get('completion_tokens','?')})")

        # Extract JSON from response
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', content)
        if not json_match:
            # Try parsing the whole content as JSON
            json_match = re.search(r'(\{[\s\S]*\})', content)

        if not json_match:
            print(f"  ERROR: Could not extract JSON from response")
            # Save raw response for debugging
            debug_path = os.path.join(AUDIT_DIR, f"{class_id}_fix_raw.txt")
            with open(debug_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"  Raw response saved to {debug_path}")
            return None

        try:
            fixed = json.loads(json_match.group(1))
        except json.JSONDecodeError as e:
            print(f"  ERROR: Invalid JSON in response: {e}")
            debug_path = os.path.join(AUDIT_DIR, f"{class_id}_fix_raw.txt")
            with open(debug_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"  Raw response saved to {debug_path}")
            return None

        # Validate basic structure
        if "levelProgression" not in fixed and "id" not in fixed:
            print(f"  ERROR: Response doesn't look like a class object")
            return None

        # Verify no data loss: check that all original levels still exist
        orig_levels = set(cls_data.get("levelProgression", {}).keys())
        fixed_levels = set(fixed.get("levelProgression", {}).keys())
        missing = orig_levels - fixed_levels
        if missing:
            print(f"  WARNING: Fixed data is missing levels: {missing}")

        return fixed

    except Exception as e:
        elapsed = time.time() - start
        print(f"ERROR ({elapsed:.1f}s): {e}")
        return None


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else None

    # Load full progression data
    with open(OUR_PROGRESSION_PATH, "r", encoding="utf-8") as f:
        full_data = json.load(f)

    classes = full_data.get("classes", full_data)
    class_ids = sorted(k for k in classes.keys() if k not in ("version", "classes"))

    if target:
        if target not in class_ids:
            print(f"Error: class '{target}' not found. Available: {class_ids}")
            sys.exit(1)
        class_ids = [target]

    print(f"=== D&D 5E Batch Fix ===")
    print(f"Model: {MODEL}")
    print(f"Classes to fix: {class_ids}")
    print()

    # Backup
    import shutil
    if not os.path.exists(BACKUP_PATH):
        shutil.copy2(OUR_PROGRESSION_PATH, BACKUP_PATH)
        print(f"Backup saved: {BACKUP_PATH}")
    else:
        print(f"Backup already exists: {BACKUP_PATH}")
    print()

    fixed_count = 0
    error_count = 0

    for cid in class_ids:
        name = classes[cid].get("name", cid)
        print(f"[{class_ids.index(cid)+1}/{len(class_ids)}] Fixing {name} ({cid})...")

        fixed = fix_class(cid, full_data)
        if fixed:
            # Apply fix
            if "classes" in full_data:
                full_data["classes"][cid] = fixed
            else:
                full_data[cid] = fixed
            fixed_count += 1
            print(f"  ✅ Applied fix for {cid}")
        else:
            error_count += 1
            print(f"  ⏭ Skipped {cid}")

        if cid != class_ids[-1]:
            time.sleep(2)

    # Save
    if fixed_count > 0:
        with open(OUR_PROGRESSION_PATH, "w", encoding="utf-8") as f:
            json.dump(full_data, f, ensure_ascii=False, indent=2)
        print(f"\n=== Done ===")
        print(f"Fixed: {fixed_count}, Skipped: {error_count}")
        print(f"Saved to: {OUR_PROGRESSION_PATH}")
        print(f"Backup at: {BACKUP_PATH}")

        # Validate JSON
        try:
            json.load(open(OUR_PROGRESSION_PATH, encoding="utf-8"))
            print("✅ JSON validation passed")
        except json.JSONDecodeError as e:
            print(f"❌ JSON validation FAILED: {e}")
            print("Restoring from backup...")
            shutil.copy2(BACKUP_PATH, OUR_PROGRESSION_PATH)
            print("Restored.")
    else:
        print(f"\nNo fixes applied.")


if __name__ == "__main__":
    main()
