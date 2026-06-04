"""
Heading level inference using bbox height + LLM.

MinerU OCR 将所有标题标为 # (level 1)。本服务利用 content_list.json 中的
bbox 高度（≈ 字号）+ LLM 语义分析，推断正确的标题层级 (0-4)。

推断成功后回写 markdown 中的 # 层级，后续 TOC 提取只需正则，无需 LLM。
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

BATCH_SIZE = 350

INFER_PROMPT = """你是 D&D 模组标题层级专家。下面是一批从 PDF 提取的标题，每个标题附带 bbox_height（越大表示字号越大）。

## bbox_height 高度分布
{height_distribution}

## 重复标题提醒
{repeated_info}

## 标题列表
{titles_json}

## 任务
为每个标题分配 level（0-4）：
- level 0: 不是标题（重复出现的表头、游戏机制标签等假阳性）→ 将被转为粗体文本
- level 1: 大章/大部分（书名、章节标题），通常只有 3-10 个
- level 2: 小节
- level 3: 子小节（编号房间等）
- level 4: 细节项

## 判断依据
1. **bbox_height 聚类**: 同一文档中，高度相近的标题通常属于同一层级。高度越大 → 层级越高
2. **语义结构**: Chapter/第X章 → level 1; 编号序列 (A1,A2...) 彼此同级
3. **重复标题**: 出现 3+ 次的标题大概率是 level 0
4. **编号房间与子项**: 编号标题 (1. xxx, 2. xxx) 之间的非编号标题（如"宝藏 Treasure"、"发展 Developments"）通常是前一个编号房间的子项，应该比编号房间深一级
5. **子编号**: N. 后面紧跟 NA./NB./NC. 的标题，子编号应该比 N. 深一级（如 5. 是 level 3，则 5A./5B. 是 level 4）

输出 JSON 数组: [{{"i": 原始索引, "level": 0-4}}]
只返回 JSON，不要其他内容。"""


def _build_height_distribution(titles: List[Dict[str, Any]]) -> str:
    """统计 bbox_height 分布，供 LLM 参考。"""
    from collections import Counter

    heights = [round(t["bbox_height"]) for t in titles if t["bbox_height"] > 0]
    if not heights:
        return "无 bbox 高度数据"

    counter = Counter(heights)
    # 按高度降序，展示前 15 个
    top = counter.most_common()
    top.sort(key=lambda x: -x[0])
    lines = [f"  h={h}: {cnt} 个标题" for h, cnt in top[:15]]
    return "\n".join(lines)


def _build_repeated_info(titles: List[Dict[str, Any]]) -> str:
    """列出重复 3+ 次的标题。"""
    repeated = {}
    for t in titles:
        if t.get("repeat_count", 0) >= 3:
            text = t["text"]
            if text not in repeated:
                repeated[text] = t["repeat_count"]

    if not repeated:
        return "无重复标题"

    sorted_items = sorted(repeated.items(), key=lambda x: -x[1])
    lines = [f'  "{text}" ({cnt}x)' for text, cnt in sorted_items[:20]]
    return "以下标题频繁重复（很可能不是真正的标题 → level 0）:\n" + "\n".join(lines)


async def _infer_batch(
    titles: List[Dict[str, Any]],
    all_titles: List[Dict[str, Any]],
    api_url: str,
    api_key: str,
    model: str,
) -> List[Dict[str, Any]]:
    """对一批标题调用 LLM 推断层级。

    Args:
        titles: 本批标题（带 _global_idx 字段标记全局索引）
        all_titles: 全部标题（用于计算整体高度分布）
    Returns:
        [{"i": global_index, "level": 0-4}, ...]
    """
    # 构建给 LLM 的标题 JSON（只包含需要的字段）
    titles_for_llm = []
    for t in titles:
        entry = {"i": t["_global_idx"], "text": t["text"], "h": t["bbox_height"]}
        if t.get("repeat_count", 0) >= 3:
            entry["repeat"] = t["repeat_count"]
        titles_for_llm.append(entry)

    prompt = INFER_PROMPT.format(
        height_distribution=_build_height_distribution(all_titles),
        repeated_info=_build_repeated_info(all_titles),
        titles_json=json.dumps(titles_for_llm, ensure_ascii=False),
    )

    endpoint = api_url.rstrip("/")
    if not endpoint.endswith("/chat/completions"):
        endpoint += "/chat/completions"

    estimated_tokens = len(titles) * 30
    max_tokens = max(4000, min(estimated_tokens, 32000))
    timeout = max(120.0, len(titles) * 0.4)

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            endpoint,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "你是标题层级推断专家，只返回JSON数组。"},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": max_tokens,
                "temperature": 0.1,
            },
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    if resp.status_code != 200:
        raise RuntimeError(f"LLM API 返回 {resp.status_code}: {resp.text[:200]}")

    content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    return _parse_json_response(content)


def _parse_json_response(text: str) -> List[Dict[str, Any]]:
    """从 LLM 响应中提取 JSON 数组。"""
    # 直接解析
    try:
        return json.loads(text)
    except Exception:
        pass

    # 代码块
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass

    # 方括号包围
    m = re.search(r"\[[\s\S]*\]", text)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass

    return []


async def infer_heading_levels(
    title_blocks: List[Dict[str, Any]],
    api_url: str,
    api_key: str,
    model: str,
) -> Optional[List[Dict[str, Any]]]:
    """推断所有标题的层级。

    Args:
        title_blocks: extract_title_blocks() 的输出
        api_url, api_key, model: LLM 配置

    Returns:
        [{"i": index, "level": 0-4}, ...] 或 None（失败时）
    """
    if not title_blocks:
        return None

    # 为每个标题添加全局索引
    for idx, t in enumerate(title_blocks):
        t["_global_idx"] = idx

    # 分批
    import asyncio

    batches = [
        title_blocks[i : i + BATCH_SIZE]
        for i in range(0, len(title_blocks), BATCH_SIZE)
    ]

    logger.info(
        "开始推断标题层级: %d 个标题, %d 个批次", len(title_blocks), len(batches)
    )

    tasks = [
        asyncio.create_task(
            _infer_batch(batch, title_blocks, api_url, api_key, model)
        )
        for batch in batches
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # 合并结果
    all_levels: List[Dict[str, Any]] = []
    success_count = 0
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            logger.warning("批次 %d 推断失败: %s", i, r)
        elif r:
            all_levels.extend(r)
            success_count += 1
        else:
            logger.warning("批次 %d 返回空结果", i)

    if success_count == 0:
        logger.error("所有批次均推断失败")
        return None

    logger.info(
        "标题层级推断完成: %d/%d 批次成功, 共 %d 个结果",
        success_count, len(batches), len(all_levels),
    )
    return all_levels


def rewrite_markdown_headings(
    markdown: str,
    title_blocks: List[Dict[str, Any]],
    level_results: List[Dict[str, Any]],
) -> str:
    """根据推断的层级回写 markdown 中的 # 标题。

    - level 0 → 转为 **粗体文本**（不再是标题）
    - level 1-4 → 对应 #, ##, ###, ####
    """
    # 构建 title_text -> level 的映射（用全局索引）
    idx_to_level = {}
    for item in level_results:
        idx = item.get("i")
        level = item.get("level")
        if idx is not None and level is not None:
            idx_to_level[idx] = level

    # 构建 title_text -> [levels] 映射（用于匹配 markdown 行）
    # 一个标题可能在 title_blocks 中出现多次，按顺序匹配
    title_queue: Dict[str, List[int]] = {}
    for idx, t in enumerate(title_blocks):
        text = t["text"]
        level = idx_to_level.get(idx)
        if level is not None:
            title_queue.setdefault(text, []).append(level)

    # 遍历 markdown 行，匹配 # 标题并回写
    heading_re = re.compile(r"^(#{1,6})\s+(.+)$")
    lines = markdown.split("\n")
    changed = 0

    for i, line in enumerate(lines):
        m = heading_re.match(line)
        if not m:
            continue

        title_text = m.group(2).strip()
        levels = title_queue.get(title_text)
        if not levels:
            continue

        new_level = levels.pop(0)
        if not levels:
            del title_queue[title_text]

        if new_level == 0:
            # 转为粗体
            lines[i] = f"**{title_text}**"
            changed += 1
        elif 1 <= new_level <= 4:
            new_hashes = "#" * new_level
            lines[i] = f"{new_hashes} {title_text}"
            changed += 1

    logger.info("回写 markdown 标题层级: 修改了 %d 行", changed)
    return "\n".join(lines)
