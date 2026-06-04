#!/usr/bin/env python3
"""
D&D 5E 数据校对脚本
对比 5e-SRD 官方数据与我们 classes-progression.json 的职业特性，
使用 AI 逐职业校对，输出差异报告。

Usage:
    python3 scripts/audit_class_features.py [class_id]

    # 校对所有职业
    python3 scripts/audit_class_features.py

    # 只校对某个职业
    python3 scripts/audit_class_features.py monk
"""

import json
import sys
import os
import time
import httpx

# --- Config ---
API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = os.environ.get("YUNWU_API_KEY", "")
MODEL = "gpt-5.2"

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRD_FEATURES_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/references/5e-srd/5e-SRD-Features.json")
SRD_CLASSES_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/references/5e-srd/5e-SRD-Classes.json")
OUR_PROGRESSION_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/configs/rules/classes-progression.json")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "dnd-platform/references/audit-reports")


def load_srd_features_by_class(class_id: str) -> list[dict]:
    """Extract SRD features for a specific class (base features only, skip subclass)."""
    all_features = json.load(open(SRD_FEATURES_PATH, encoding="utf-8"))
    features = []
    for f in all_features:
        if f.get("class", {}).get("index") == class_id:
            # Skip subclass-specific features (we don't compare those)
            if f.get("subclass"):
                continue
            features.append({
                "name": f["name"],
                "level": f["level"],
                "desc": f["desc"],
            })
    features.sort(key=lambda x: (x["level"], x["name"]))
    return features


def load_our_class_data(class_id: str) -> dict:
    """Extract our progression data for a specific class."""
    data = json.load(open(OUR_PROGRESSION_PATH, encoding="utf-8"))
    classes = data.get("classes", data)
    cls = classes.get(class_id)
    if not cls:
        return {}

    # Flatten level progression into feature list
    features = []
    level_prog = cls.get("levelProgression", {})
    for level_str, level_data in sorted(level_prog.items(), key=lambda x: int(x[0])):
        level = int(level_str)
        for f in level_data.get("features", []):
            entry = {
                "name": f.get("name", ""),
                "nameEn": f.get("nameEn", ""),
                "level": level,
                "description": f.get("description", ""),
                "type": f.get("type", ""),
            }
            # Include subclass choices if present
            if f.get("choices"):
                subclasses = []
                for choice in f["choices"]:
                    if isinstance(choice, str):
                        subclasses.append({"id": choice, "name": choice})
                        continue
                    sub = {
                        "id": choice.get("id", ""),
                        "name": choice.get("name", ""),
                        "nameEn": choice.get("nameEn", ""),
                        "features": choice.get("features", []),
                    }
                    subclasses.append(sub)
                entry["subclass_choices"] = subclasses
            features.append(entry)

        # Include extra numeric data
        extra = {}
        for key in ["kiPoints", "martialArtsDie", "unarmoredMovement", "rages", "rageDamage",
                     "sneakAttack", "sorceryPoints", "invocationsKnown", "cantripsKnown",
                     "spellsKnown", "slotLevel", "numSlots", "superiorityDice"]:
            if key in level_data:
                extra[key] = level_data[key]
        if extra:
            features.append({
                "name": f"[数值数据 level {level}]",
                "level": level,
                "numeric_data": extra,
            })

    return {
        "id": cls.get("id", class_id),
        "name": cls.get("name", ""),
        "nameEn": cls.get("nameEn", ""),
        "hitDie": cls.get("hitDie"),
        "features": features,
    }


def audit_class(class_id: str, class_name: str) -> str:
    """Use AI to audit a single class, return the report text."""
    srd_features = load_srd_features_by_class(class_id)
    our_data = load_our_class_data(class_id)

    if not srd_features:
        return f"# {class_name} ({class_id})\n\nSRD 中未找到该职业数据。\n"
    if not our_data:
        return f"# {class_name} ({class_id})\n\n我们的数据中未找到该职业。\n"

    prompt = f"""你是 D&D 5E 规则专家。请对比以下两份数据，找出我们的数据中存在的问题。

## 任务
逐条对比 SRD 官方特性描述与我们的中文描述，找出：
1. **规则错误**：豁免类型错误、伤害骰错误、DC 公式错误、使用次数/恢复方式错误、动作类型错误等
2. **关键遗漏**：缺少重要的限制条件、触发条件、持续时间、射程等机制细节
3. **数值错误**：等级数值、加值、骰子类型等数字错误
4. **缺失特性**：SRD 中有但我们完全没有的特性

## 不需要报告的
- 翻译风格差异（只要意思对就行）
- 描述简略但没有错误的（我们的描述本身就是精简版）
- 子职业特性（SRD 每个职业只有一个子职业，我们有全部，不用对比子职业内容）
- 属性值提升(ASI)特性（每个职业都一样）

## 输出格式
对每个发现的问题，输出：
```
### [特性名] (Level X)
- **问题类型**: 规则错误/关键遗漏/数值错误/缺失特性
- **SRD 原文**: [相关英文原文]
- **我们的描述**: [我们当前的中文描述]
- **问题**: [具体什么问题]
- **建议修正**: [建议的中文描述]
```

如果没有问题，输出 "✅ 未发现问题"。

---

## SRD 官方数据 ({class_id})
```json
{json.dumps(srd_features, ensure_ascii=False, indent=2)}
```

## 我们的数据 ({class_id} - {our_data.get('name', '')})
```json
{json.dumps(our_data['features'], ensure_ascii=False, indent=2)}
```
"""

    print(f"  Calling API for {class_id}...", end=" ", flush=True)
    start = time.time()

    try:
        resp = httpx.post(
            API_URL,
            headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
            json={
                "model": MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "max_tokens": 8192,
            },
            timeout=120,
        )
        resp.raise_for_status()
        result = resp.json()
        content = result["choices"][0]["message"]["content"]
        elapsed = time.time() - start
        tokens = result.get("usage", {})
        print(f"OK ({elapsed:.1f}s, in:{tokens.get('prompt_tokens','?')} out:{tokens.get('completion_tokens','?')})")
        return f"# {our_data.get('name', class_id)} ({class_id})\n\n{content}\n"
    except Exception as e:
        elapsed = time.time() - start
        print(f"ERROR ({elapsed:.1f}s): {e}")
        return f"# {our_data.get('name', class_id)} ({class_id})\n\n❌ API 调用失败: {e}\n"


def main():
    # Determine which classes to audit
    target = sys.argv[1] if len(sys.argv) > 1 else None

    data = json.load(open(OUR_PROGRESSION_PATH, encoding="utf-8"))
    classes = data.get("classes", data)
    class_ids = sorted(k for k in classes.keys() if k not in ("version", "classes"))

    if target:
        if target not in class_ids:
            print(f"Error: class '{target}' not found. Available: {class_ids}")
            sys.exit(1)
        class_ids = [target]

    print(f"=== D&D 5E Feature Audit ===")
    print(f"Model: {MODEL}")
    print(f"Classes to audit: {class_ids}")
    print(f"SRD source: {SRD_FEATURES_PATH}")
    print(f"Our data: {OUR_PROGRESSION_PATH}")
    print()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    reports = []
    for cid in class_ids:
        cls = classes[cid]
        name = cls.get("name", cid)
        print(f"[{class_ids.index(cid)+1}/{len(class_ids)}] Auditing {name} ({cid})...")

        # Skip if already done (check for existing report)
        out_path = os.path.join(OUTPUT_DIR, f"{cid}.md")
        if not target and os.path.exists(out_path) and os.path.getsize(out_path) > 100:
            print(f"  -> Skipping (already exists: {out_path})")
            with open(out_path, "r", encoding="utf-8") as f:
                reports.append(f.read())
            continue

        report = audit_class(cid, name)
        reports.append(report)

        # Save individual report
        out_path = os.path.join(OUTPUT_DIR, f"{cid}.md")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"  -> {out_path}")

        # Rate limit
        if cid != class_ids[-1]:
            time.sleep(1)

    # Save combined report
    combined = "# D&D 5E 职业特性校对报告\n\n"
    combined += f"对比来源: 5e-bits/5e-database SRD vs 本项目 classes-progression.json\n\n"
    combined += f"校对模型: {MODEL}\n\n---\n\n"
    combined += "\n---\n\n".join(reports)

    combined_path = os.path.join(OUTPUT_DIR, "full-audit.md")
    with open(combined_path, "w", encoding="utf-8") as f:
        f.write(combined)

    print(f"\n=== Done ===")
    print(f"Combined report: {combined_path}")
    print(f"Individual reports: {OUTPUT_DIR}/<class_id>.md")


if __name__ == "__main__":
    main()
