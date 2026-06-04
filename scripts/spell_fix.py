#!/usr/bin/env python3
"""
法术描述批量修复脚本
基于校对结果，使用 LLM 修正有问题的法术描述。
"""

import json
import time
import os
import sys
import copy
import httpx

# 确保输出不缓冲
sys.stdout.reconfigure(line_buffering=True)

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = os.environ.get("YUNWU_API_KEY", "")
MODEL = "gpt-5.2"

BATCH_SIZE = 3  # 每批修复3个法术（修复比校对需要更多token）
MAX_BATCHES = None  # None = 全部

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRD_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/references/5e-srd/5e-SRD-Spells.json")
OUR_PATH = os.path.join(PROJECT_ROOT, "frontend/app/data/rules/spells.json")
VERIFY_PATH = os.path.join(PROJECT_ROOT, "scripts/spell_verify_results.json")
OUTPUT_PATH = os.path.join(PROJECT_ROOT, "scripts/spell_fix_results.json")
BACKUP_PATH = os.path.join(PROJECT_ROOT, "scripts/spells_backup.json")


def load_data():
    with open(SRD_PATH, encoding="utf-8") as f:
        srd_list = json.load(f)
    srd_map = {s["name"]: s for s in srd_list}

    with open(OUR_PATH, encoding="utf-8") as f:
        our_data = json.load(f)

    with open(VERIFY_PATH, encoding="utf-8") as f:
        verify = json.load(f)

    # 只取有问题的法术
    errors = [e for e in verify["error_details"] if e["status"] == "error"]
    return srd_map, our_data, errors


def build_prompt(batch):
    """构建修复 prompt"""
    spells_text = ""
    for i, (name_en, srd_spell, our_spell, issues) in enumerate(batch, 1):
        srd_desc = "\n".join(srd_spell.get("desc", []))
        srd_higher = "\n".join(srd_spell.get("higher_level", []))
        our_desc = our_spell.get("description", "")
        issues_text = "\n".join(f"  - {iss}" for iss in issues)

        spells_text += f"""
--- 法术 {i}: {name_en} ({our_spell.get('name', '')}) ---
【SRD 英文原文】
{srd_desc}
{f"At Higher Levels: {srd_higher}" if srd_higher else ""}

【当前中文描述】
{our_desc}

【校对发现的问题】
{issues_text}

"""

    prompt = f"""你是 D&D 5E 法术描述修复专家。请根据校对发现的问题，修正以下法术的中文描述。

修复规则：
1. **只修正校对指出的问题**（数值错误、规则遗漏、参数不一致等）
2. **保持原有翻译风格和用词习惯**，不要重写整段描述
3. 对于"遗漏"类问题，在合适位置补充缺失内容
4. 对于"数值错误"类问题，将错误数值改为正确数值
5. 保持中文表述自然流畅，补充的内容要融入原文
6. 不要改动没有问题的部分

{spells_text}

请以 JSON 数组格式回复，每个法术一个对象：
```json
[
  {{
    "name_en": "法术英文名",
    "fixed_description": "修正后的完整中文描述"
  }}
]
```

返回修正后的**完整描述**（不是只返回修改的部分）。"""

    return prompt


def call_llm(prompt, retry=2):
    for attempt in range(retry + 1):
        try:
            resp = httpx.post(
                API_URL,
                headers={
                    "Authorization": f"Bearer {API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "max_tokens": 8192,
                },
                timeout=180,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            return json.loads(content.strip())
        except Exception as e:
            print(f"  [Attempt {attempt+1}] Error: {e}")
            if attempt < retry:
                time.sleep(5)
    return None


def main():
    srd_map, our_data, errors = load_data()
    print(f"需要修复 {len(errors)} 个法术")

    # 建立索引: nameEn -> spell index in our_data
    our_spells = our_data["spells"]
    our_idx = {s["nameEn"]: i for i, s in enumerate(our_spells) if s.get("nameEn")}

    # 备份原始数据
    with open(BACKUP_PATH, "w", encoding="utf-8") as f:
        json.dump(our_data, f, ensure_ascii=False, indent=2)
    print(f"原始数据已备份到: {BACKUP_PATH}")

    # 构建批次
    batches = []
    batch = []
    for err in errors:
        name_en = err["name_en"]
        if name_en not in srd_map or name_en not in our_idx:
            print(f"  跳过 {name_en}（未找到对应数据）")
            continue
        srd_spell = srd_map[name_en]
        our_spell = our_spells[our_idx[name_en]]
        batch.append((name_en, srd_spell, our_spell, err["issues"]))
        if len(batch) >= BATCH_SIZE:
            batches.append(batch)
            batch = []
    if batch:
        batches.append(batch)

    if MAX_BATCHES:
        batches = batches[:MAX_BATCHES]

    print(f"分为 {len(batches)} 批，每批 {BATCH_SIZE} 个")

    fix_log = []
    fixed_count = 0
    failed_count = 0

    for i, batch in enumerate(batches):
        names = [b[0] for b in batch]
        print(f"\n[{i+1}/{len(batches)}] 修复: {', '.join(names)}")

        prompt = build_prompt(batch)
        results = call_llm(prompt)

        if results:
            for r in results:
                name_en = r.get("name_en", "")
                fixed_desc = r.get("fixed_description", "")
                if name_en in our_idx and fixed_desc:
                    idx = our_idx[name_en]
                    old_desc = our_spells[idx].get("description", "")
                    our_spells[idx]["description"] = fixed_desc
                    fixed_count += 1
                    # 记录变更
                    fix_log.append({
                        "name_en": name_en,
                        "name_cn": our_spells[idx].get("name", ""),
                        "old_description": old_desc,
                        "new_description": fixed_desc,
                    })
                    print(f"  OK {name_en}")
                else:
                    failed_count += 1
                    print(f"  SKIP {name_en} (no match or empty)")
        else:
            failed_count += len(batch)
            print(f"  FAILED - skipping batch")

        if i < len(batches) - 1:
            time.sleep(1)

    # 写回 spells.json
    with open(OUR_PATH, "w", encoding="utf-8") as f:
        json.dump(our_data, f, ensure_ascii=False, indent=2)

    # 保存修复日志
    log_output = {
        "total_fixed": fixed_count,
        "total_failed": failed_count,
        "fixes": fix_log,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(log_output, f, ensure_ascii=False, indent=2)

    print(f"\n===== 修复完成 =====")
    print(f"已修复: {fixed_count} 个法术")
    print(f"失败: {failed_count} 个")
    print(f"spells.json 已更新")
    print(f"修复日志: {OUTPUT_PATH}")
    print(f"原始备份: {BACKUP_PATH}")


if __name__ == "__main__":
    main()
