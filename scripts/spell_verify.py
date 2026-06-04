#!/usr/bin/env python3
"""
法术描述批量校对脚本
对比 SRD 英文原文和我们的中文描述，使用 LLM 判断翻译准确性。
"""

import json
import time
import sys
import os
import httpx

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = os.environ.get("YUNWU_API_KEY", "")
MODEL = "gpt-5.2"

BATCH_SIZE = 5  # 每次发送几个法术给 LLM 校对
MAX_BATCHES = None  # None = 校对全部，设为数字限制批次

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRD_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/references/5e-srd/5e-SRD-Spells.json")
OUR_PATH = os.path.join(PROJECT_ROOT, "frontend/app/data/rules/spells.json")
OUTPUT_PATH = os.path.join(PROJECT_ROOT, "scripts/spell_verify_results.json")


def load_spells():
    with open(SRD_PATH, encoding="utf-8") as f:
        srd_list = json.load(f)
    srd_map = {s["name"]: s for s in srd_list}

    with open(OUR_PATH, encoding="utf-8") as f:
        our_data = json.load(f)
    our_map = {s["nameEn"]: s for s in our_data["spells"] if s.get("nameEn")}

    overlap = sorted(set(srd_map.keys()) & set(our_map.keys()))
    return srd_map, our_map, overlap


def build_prompt(batch):
    """构建校对 prompt，一次校对多个法术"""
    spells_text = ""
    for i, (name, srd_spell, our_spell) in enumerate(batch, 1):
        srd_desc = "\n".join(srd_spell.get("desc", []))
        srd_higher = "\n".join(srd_spell.get("higher_level", []))
        our_desc = our_spell.get("description", "")

        spells_text += f"""
--- 法术 {i}: {name} ({our_spell.get('name', '')}) ---
【SRD 英文原文】
{srd_desc}
{f"At Higher Levels: {srd_higher}" if srd_higher else ""}

【我们的中文描述】
{our_desc}

"""

    prompt = f"""你是一位 D&D 5E 法术校对专家。请对比以下法术的 SRD 英文原文和中文描述，只检查**数值和规则参数**是否一致。

只检查以下内容：
1. 骰子数值（如 8d6 写成了 6d8、2d4 写成了 2d6 等）
2. 距离/范围数值（如 120尺写成了60尺）
3. 持续时间数值（如 1分钟写成了10分钟）
4. 伤害/治疗数值
5. 豁免类型（如敏捷豁免写成了体质豁免）
6. 升环加成数值
7. 影响目标数量
8. 关键规则条件被遗漏（如缺少"命中时"、"豁免成功减半"等重要判定条件）

不需要检查：
- 翻译风格、用词习惯
- 语序调整
- 补充说明性文字
- 字段名、格式差异

{spells_text}

请以 JSON 数组格式回复，每个法术一个对象：
```json
[
  {{
    "name_en": "法术英文名",
    "name_cn": "法术中文名",
    "status": "ok" 或 "error",
    "issues": ["简短描述：原文是X，中文写成了Y"]
  }}
]
```

如果数值参数都正确，status 设为 "ok"，issues 为空数组。
只有数值/规则参数确实不一致才标记为 "error"。"""

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
                    "max_tokens": 4096,
                },
                timeout=120,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            # 提取 JSON
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            return json.loads(content.strip())
        except Exception as e:
            print(f"  [Attempt {attempt+1}] Error: {e}")
            if attempt < retry:
                time.sleep(3)
    return None


def main():
    srd_map, our_map, overlap = load_spells()
    print(f"共 {len(overlap)} 个法术需要校对")

    # 构建批次
    batches = []
    batch = []
    for name in overlap:
        batch.append((name, srd_map[name], our_map[name]))
        if len(batch) >= BATCH_SIZE:
            batches.append(batch)
            batch = []
    if batch:
        batches.append(batch)

    if MAX_BATCHES:
        batches = batches[:MAX_BATCHES]

    print(f"分为 {len(batches)} 批，每批 {BATCH_SIZE} 个")

    all_results = []
    errors_found = []

    for i, batch in enumerate(batches):
        names = [b[0] for b in batch]
        print(f"\n[{i+1}/{len(batches)}] 校对: {', '.join(names)}")

        prompt = build_prompt(batch)
        results = call_llm(prompt)

        if results:
            all_results.extend(results)
            for r in results:
                if r.get("status") == "error":
                    errors_found.append(r)
                    print(f"  !! {r['name_en']} ({r.get('name_cn','')}): {r['issues']}")
                else:
                    print(f"  OK {r['name_en']}")
        else:
            print(f"  FAILED - skipping batch")

        # 每批之间稍等，避免限流
        if i < len(batches) - 1:
            time.sleep(1)

    # 保存结果
    output = {
        "total_checked": len(all_results),
        "errors_found": len(errors_found),
        "results": all_results,
        "error_details": errors_found,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n===== 校对完成 =====")
    print(f"已检查: {len(all_results)} 个法术")
    print(f"发现问题: {len(errors_found)} 个")
    print(f"详细结果已保存到: {OUTPUT_PATH}")

    if errors_found:
        print(f"\n===== 问题法术列表 =====")
        for e in errors_found:
            print(f"  {e['name_en']} ({e.get('name_cn','')})")
            for issue in e.get("issues", []):
                print(f"    - {issue}")


if __name__ == "__main__":
    main()
