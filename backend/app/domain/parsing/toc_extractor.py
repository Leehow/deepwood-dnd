"""
TOC提取器 - 正则提取标题 + LLM整理层级
"""
import re
import json
import asyncio
import httpx
import logging
from typing import List, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from .schemas import TocEntry

logger = logging.getLogger(__name__)

# LLM整理层级的Prompt
REORGANIZE_PROMPT = """你是D&D模组目录结构专家。请分析以下从PDF提取的标题列表，为每个标题分配合理的层级。

## 你的任务
这些标题的原始层级可能不正确（PDF提取问题）。请根据你对D&D冒险模组结构的理解，分析每个标题应该属于哪个层级。

## 层级树构建规则
层级数字决定了父子关系：
- 一个标题的"父节点"是它前面最近的、层级数字比它小的标题
- 例如：level=2的标题会成为它前面最近的level=1标题的子节点

## 分析要点
1. **章节标题**（"第X章"、"Chapter X"、"附录"、"简介"）→ level=1，作为顶级节点
2. **章节内的小节**（任务、背景、区域名等）→ level=2，嵌套在章节下
3. **编号房间**（"1. xxx"、"6A. xxx"）→ level=3，嵌套在区域下
4. **房间细节**（宝藏、陷阱、发展）→ level=4，嵌套在房间下

## 关键判断
- 看到"第X章"或"Chapter X"后，后续的非章节标题应该嵌套在它下面（level>=2）
- 直到遇到下一个"第X章"或"Chapter X"
- 数字编号的房间（1. 2. 3. 等）彼此同级
- **编号房间之间的非编号标题**（如"宝藏 Treasure"、"发展 Developments"、"蛇坑 Snake Pits"）通常是前一个编号房间的子项，应该比编号房间深一级
- **子编号**: N. 后面紧跟 NA./NB./NC./ND. 的标题，子编号应该比 N. 深一级（如 5.→level=3，则 5A./5B.→level=4）

## 标题列表：
{headings}

## 输出JSON数组：
[{{"title": "标题原文", "level": 数字}}]
只返回JSON。"""


class TocExtractor:
    """TOC提取器"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._contents_subsections: Dict[int, List[str]] = {}  # heading_idx -> [子条目标题]
        self._chapter_indices: set = set()  # group_by_chapters 识别出的章节边界索引

    def extract_headings(self, markdown: str) -> List[TocEntry]:
        """正则提取所有#标题，以及没有#但以数字编号开头的房间标题"""
        headings = []
        heading_pattern = r'^(#{1,6})\s+(.+)$'
        # 匹配没有#但以数字编号开头的房间（如 "7. 下层庭院 Lower Courtyard"）
        room_pattern = r'^(\d+[A-Z]?)[\.。]\s+(.+)$'

        for line_num, line in enumerate(markdown.split('\n'), 1):
            stripped = line.strip()

            # 优先匹配#标题
            match = re.match(heading_pattern, stripped)
            if match:
                level = len(match.group(1))
                title = match.group(2).strip()

                # 过滤无效标题
                if len(title) < 2:
                    continue
                if title.startswith('!'):  # 图片
                    continue
                if title.startswith('http'):  # URL
                    continue
                if re.match(r'^[\d\.\-\s]+$', title):  # 纯数字
                    continue

                headings.append(TocEntry(
                    title=title,
                    level=min(level, 3),  # 最多3级
                    line_number=line_num
                ))
                continue

            # 匹配没有#的数字编号房间
            room_match = re.match(room_pattern, stripped)
            if room_match:
                room_num = room_match.group(1)
                room_name = room_match.group(2).strip()
                # 确保不是纯数字或太短
                if len(room_name) >= 2 and not re.match(r'^[\d\.\-\s]+$', room_name):
                    full_title = f"{room_num}. {room_name}"
                    headings.append(TocEntry(
                        title=full_title,
                        level=3,  # 房间级别
                        line_number=line_num
                    ))

        logger.info(f"正则提取到 {len(headings)} 个标题")
        return headings

    def group_by_chapters(self, headings: List[TocEntry], markdown: str) -> Optional[List[tuple]]:
        """
        尝试从 CONTENTS/目录 段落解析顶级章节标题，
        再用这些标题把 headings 按章节分组。
        返回 [(chapter_title, [headings_in_chapter]), ...] 或 None。
        """
        # 1. 找 CONTENTS / 目录 标题
        contents_idx = None
        for i, h in enumerate(headings):
            if re.search(r'(?:^|\b)(CONTENTS|目录|Contents)(?:\b|$)', h.title):
                contents_idx = i
                break
        if contents_idx is None:
            return None

        # 2. 取 CONTENTS 到下一个 heading 之间的正文
        contents_line = headings[contents_idx].line_number
        next_line = headings[contents_idx + 1].line_number if contents_idx + 1 < len(headings) else None
        lines = markdown.split('\n')
        end = (next_line - 1) if next_line else len(lines)
        content_lines = lines[contents_line:end]

        # 3. 提取章节标题（去除页码）
        raw_entries = []
        for line in content_lines:
            stripped = line.strip()
            if not stripped or len(stripped) < 3:
                continue
            cleaned = re.sub(r'[\.\…·\s]+\d+\s*$', '', stripped).strip()
            if cleaned and len(cleaned) >= 3:
                raw_entries.append(cleaned)

        if len(raw_entries) < 3:
            return None

        # 4. 筛选顶级章节条目（Ch/Chapter/App/Appendix/第X章/附录/Introduction/Conclusion）
        chapter_re = re.compile(
            r'^(Ch\.?\s*\d+|Chapter\s*\d+|App\.?\s*[A-Z]|Appendix\s*[A-Z]'
            r'|第\s*[\d一二三四五六七八九十百]+\s*章|附录\s*[A-Z]?'
            r'|Introduction|简介|Conclusion|前言|Foreword|序言|Preface)',
            re.IGNORECASE
        )
        chapter_entries = [e for e in raw_entries if chapter_re.match(e)]

        if len(chapter_entries) < 2:
            return None

        # 5. 匹配到 headings 列表 —— 用章节编号精确匹配
        def find_heading(pattern_str: str, start_from: int) -> Optional[int]:
            """在 headings[start_from:] 中找第一个匹配 pattern 的索引"""
            pat = re.compile(pattern_str, re.IGNORECASE)
            for i in range(start_from, len(headings)):
                if pat.search(headings[i].title):
                    return i
            return None

        matched = {}  # CONTENTS 条目索引 -> heading 索引
        pending_fallback = []  # 第一轮没匹配到的条目

        # 第一轮：编号精确匹配
        for ci, ct in enumerate(chapter_entries):
            idx = None
            ch_m = re.search(r'(?:ch|chapter)\.?\s*(\d+)', ct, re.IGNORECASE)
            app_m = re.search(r'(?:app|appendix)\.?\s*([A-Z])', ct, re.IGNORECASE)
            zh_m = re.search(r'第\s*([\d一二三四五六七八九十百]+)\s*章', ct)

            if ch_m:
                idx = find_heading(rf'^CHAPTER\s*{ch_m.group(1)}\b', contents_idx + 1)
            elif app_m:
                idx = find_heading(rf'^APPENDIX\s*{app_m.group(1)}\b', contents_idx + 1)
            elif zh_m:
                idx = find_heading(rf'^第\s*{zh_m.group(1)}\s*章', contents_idx + 1)
            else:
                keyword = ct.split()[0] if ct.split() else ct
                idx = find_heading(rf'^{re.escape(keyword)}\b', contents_idx + 1)

            if idx is not None:
                matched[ci] = idx
            else:
                pending_fallback.append(ci)

        # 第二轮：对没匹配到的条目，用关键词在相邻已匹配章节范围内搜索
        used_indices = set(matched.values())
        for ci in pending_fallback:
            ct = chapter_entries[ci]
            title_part = re.sub(
                r'^(Ch\.?\s*\d+|Chapter\s*\d+|App\.?\s*[A-Z]|Appendix\s*[A-Z]'
                r'|第\s*[\d一二三四五六七八九十百]+\s*章|附录\s*[A-Z]?)\s*[:：]?\s*',
                '', ct, flags=re.IGNORECASE
            ).strip()
            words = [w for w in re.findall(r'\w{4,}', title_part)] if title_part else []
            if not words:
                continue

            # 确定搜索范围：在前一个和后一个已匹配章节之间
            all_matched_sorted = sorted(matched.values())
            # 找前一个已匹配章节的位置
            prev_bound = contents_idx + 1
            next_bound = len(headings)
            for ci2, hi in sorted(matched.items()):
                if ci2 < ci:
                    prev_bound = hi
                elif ci2 > ci:
                    next_bound = hi
                    break

            best_idx = None
            best_hits = 0
            for i in range(prev_bound, next_bound):
                if i in used_indices:
                    continue
                h_upper = headings[i].title.upper()
                # 只匹配标题前 80 字符，避免超长 OCR 标题误匹配
                h_check = h_upper[:80]
                hits = sum(1 for w in words if w.upper() in h_check)
                if hits > best_hits:
                    best_hits = hits
                    best_idx = i
            # 至少匹配一半关键词
            if best_idx is not None and best_hits >= max(1, (len(words) + 1) // 2):
                matched[ci] = best_idx
                used_indices.add(best_idx)

        matched_indices = sorted(matched.values())

        if len(matched_indices) < 2:
            return None

        matched_indices.sort()
        self._chapter_indices = set(matched_indices)

        # 5.5 收集每个章节在 CONTENTS 中的子条目（非章节级的行）
        # raw_entries 中，章节之间的非章节条目就是子条目
        chapter_entry_set = set(chapter_entries)
        for ci, ct in enumerate(chapter_entries):
            if ci not in matched:
                continue
            heading_idx = matched[ci]
            # 找此章节条目在 raw_entries 中的位置
            try:
                re_idx = raw_entries.index(ct)
            except ValueError:
                continue
            # 收集它后面直到下一个章节条目之间的非章节条目
            subs = []
            for j in range(re_idx + 1, len(raw_entries)):
                if raw_entries[j] in chapter_entry_set:
                    break
                subs.append(raw_entries[j])
            if subs:
                self._contents_subsections[heading_idx] = subs

        # 6. 按章节边界分组
        groups = []
        pre_start = contents_idx + 1
        if matched_indices[0] > pre_start:
            pre = headings[pre_start:matched_indices[0]]
            if pre:
                groups.append(("前导内容", pre))

        for g in range(len(matched_indices)):
            start = matched_indices[g]
            end = matched_indices[g + 1] if g + 1 < len(matched_indices) else len(headings)
            groups.append((headings[start].title, headings[start:end]))

        logger.info(f"CONTENTS 分组: {len(groups)} 组, 章节标题: {[g[0][:30] for g in groups]}")
        return groups

    def assign_levels_by_rules(self, headings: List[TocEntry]) -> List[TocEntry]:
        """基于规则分配层级（适用于D&D模组）"""
        # 一级标题模式
        level1_patterns = [
            r'^第\s*\d+\s*章',  # 第1章, 第 1 章
            r'^第\s*[一二三四五六七八九十百]+\s*章',  # 第一章, 第十二章
            r'^Chapter\s*\d+',  # Chapter 1
            r'^附录\s*[A-Z]?',  # 附录, 附录 A
            r'^Appendix\s*[A-Z]?',  # Appendix, Appendix A
            r'^简介',  # 简介
            r'^Introduction',
            r'^目录',  # 目录
            r'^Contents',
            r'^前言',
            r'^Foreword',
            r'^序言',
            r'^Preface',
            r'^制作组',
            r'^Credits',
            r'^封面故事',
            r'^关于翻译',
            r'^OUT OF THE ABYSS',  # 特定模组标题
        ]

        # 二级标题模式（章节内的主要小节）
        level2_patterns = [
            r'^\d+[A-Z]?\.',  # 1. 2. 1A. 等房间编号
            r'^任务',
            r'^Missions',
            r'^奖励',
            r'^Rewards',
            r'^宝藏',
            r'^Treasure',
            r'^发展',
            r'^Developments',
            r'^背景',
            r'^Background',
        ]

        for heading in headings:
            title = heading.title

            # 检查是否匹配一级模式
            is_level1 = False
            for pattern in level1_patterns:
                if re.search(pattern, title, re.IGNORECASE):
                    is_level1 = True
                    break

            if is_level1:
                heading.level = 1
            else:
                # 检查是否匹配二级模式
                is_level2 = False
                for pattern in level2_patterns:
                    if re.search(pattern, title, re.IGNORECASE):
                        is_level2 = True
                        break

                if is_level2:
                    heading.level = 2
                else:
                    # 默认为二级（大多数子章节）
                    heading.level = 2

        logger.info(f"规则分配层级完成: {len(headings)} 个标题")
        return headings

    async def reorganize_with_llm(
        self,
        headings: List[TocEntry],
        api_url: str,
        api_key: str,
        model: str
    ) -> tuple[List[TocEntry], Dict]:
        """调用LLM重新分配层级，返回(headings, status)"""
        status = {
            "llm_called": False,
            "llm_success": False,
            "llm_error": None,
            "headings_processed": 0,
            "json_parsed": False
        }

        if not headings:
            return [], status

        # 大型模组可能有1000+标题，但LLM处理太多会出问题
        # 这里不截断，让LLM尽量处理，但记录警告
        total_headings = len(headings)
        if total_headings > 1500:
            logger.warning(f"标题数量很多({total_headings})，LLM处理可能不完整")

        status["headings_processed"] = total_headings

        # 构建标题列表
        headings_str = "\n".join(f"- {h.title}" for h in headings)
        prompt = REORGANIZE_PROMPT.format(headings=headings_str)

        # 规范化URL
        endpoint = api_url.rstrip('/')
        if not endpoint.endswith('/chat/completions'):
            endpoint = endpoint + '/chat/completions'

        # 根据标题数量动态调整 max_tokens
        # 每个标题的JSON输出大约需要40-60字符，留足余量
        estimated_tokens = total_headings * 80
        max_output_tokens = max(16000, min(estimated_tokens, 64000))

        request_body = {
            "model": model,
            "messages": [
                {"role": "system", "content": "你是D&D模组目录专家，只返回JSON数组。"},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": max_output_tokens,
            "temperature": 0.1
        }

        # 根据标题数量动态调整超时时间
        # 每个标题约需0.3-0.5秒LLM处理时间，留足余量
        llm_timeout = max(180.0, total_headings * 0.5)

        try:
            status["llm_called"] = True
            async with httpx.AsyncClient(timeout=llm_timeout) as client:
                resp = await client.post(
                    endpoint,
                    json=request_body,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                )

            if resp.status_code != 200:
                status["llm_error"] = f"API返回{resp.status_code}"
                logger.error(f"LLM API错误: {resp.status_code}")
                return headings, status

            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            if not content:
                status["llm_error"] = "返回空内容"
                logger.warning("LLM返回空内容")
                return headings, status

            # 解析JSON
            json_obj = self._extract_json(content)
            if not json_obj:
                status["llm_error"] = "JSON解析失败"
                logger.warning(f"无法解析LLM返回的JSON，原始内容前200字: {content[:200]}")
                return headings, status

            status["json_parsed"] = True

            # 按索引更新层级
            updated_count = 0
            for i, item in enumerate(json_obj):
                if i < len(headings):
                    headings[i].level = item.get("level", 2)
                    updated_count += 1

            status["llm_success"] = True
            logger.info(f"LLM成功整理 {updated_count}/{len(headings)} 个标题的层级")
            return headings, status

        except Exception as e:
            status["llm_error"] = str(e)
            logger.error(f"LLM调用失败: {e}")
            return headings, status

    def _extract_json(self, text: str) -> Optional[List[Dict]]:
        """从LLM响应中提取JSON"""
        # 尝试直接解析
        try:
            return json.loads(text)
        except:
            pass

        # 尝试提取代码块
        code_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
        if code_match:
            try:
                return json.loads(code_match.group(1))
            except:
                pass

        # 尝试找[]包围的内容
        bracket_match = re.search(r'\[[\s\S]*\]', text)
        if bracket_match:
            try:
                return json.loads(bracket_match.group(0))
            except:
                pass

        return None

    def apply_contents_subsections(self, headings: List[TocEntry]) -> None:
        """用 CONTENTS 中的子条目信息校正 level=2。
        对每个章节，在其 heading 范围内搜索匹配 CONTENTS 子条目的 heading，
        将其 level 设为 2，并确保其下的 heading level >= 3。"""
        if not self._contents_subsections:
            return

        # 收集所有章节起始索引并排序
        chapter_starts = sorted(self._contents_subsections.keys())

        for ch_idx in chapter_starts:
            subs = self._contents_subsections[ch_idx]
            # 确定此章节的 heading 范围
            next_ch = None
            for cs in chapter_starts:
                if cs > ch_idx:
                    next_ch = cs
                    break
            end_idx = next_ch if next_ch else len(headings)

            # 对每个子条目，在范围内找最佳匹配的 heading
            matched_sub_indices = set()
            for sub_title in subs:
                # 提取关键词（4+字符的单词）
                words = re.findall(r'\w{4,}', sub_title)
                if not words:
                    words = re.findall(r'\w{2,}', sub_title)
                if not words:
                    continue

                best_i = None
                best_hits = 0
                for i in range(ch_idx + 1, end_idx):
                    h_upper = headings[i].title.upper()[:80]
                    hits = sum(1 for w in words if w.upper() in h_upper)
                    if hits > best_hits:
                        best_hits = hits
                        best_i = i
                if best_i is not None and best_hits >= max(1, (len(words) + 1) // 2):
                    matched_sub_indices.add(best_i)
                    headings[best_i].level = 2

            # 确保子条目之间的 heading level >= 3
            if matched_sub_indices:
                sub_sorted = sorted(matched_sub_indices)
                for si, sub_i in enumerate(sub_sorted):
                    next_sub = sub_sorted[si + 1] if si + 1 < len(sub_sorted) else end_idx
                    for i in range(sub_i + 1, next_sub):
                        if i not in matched_sub_indices and headings[i].level < 3:
                            headings[i].level = 3

        applied = sum(len(v) for v in self._contents_subsections.values())
        logger.info(f"CONTENTS 子条目校正: {len(self._contents_subsections)} 个章节，{applied} 个子条目")

    def refine_numbered_hierarchy(self, headings: List[TocEntry]) -> None:
        """基于编号模式细化层级关系。

        规则:
        1. N. 后跟 NA./NB./NC. → 子编号比父编号深一级
        2. 非编号标题后面紧跟 1./2./3. 序列 → 序列比父标题深一级
        3. 连续编号（如 9, 10）之间夹着非编号标题 → 非编号标题与编号同级
        """
        # 预解析: 提取每个标题的编号信息
        num_re = re.compile(r'^(\d+)([A-Z])?[\.。]\s')

        parsed = []  # [(main_num, sub_letter, match_obj) | None]
        for h in headings:
            m = num_re.match(h.title)
            if m:
                parsed.append((int(m.group(1)), m.group(2), m))
            else:
                parsed.append(None)

        changed = 0

        # 规则2: 非编号标题后面紧跟 1./2./3. 序列 → 序列深一级
        # 规则3: 连续编号间夹着的非编号标题 → 与编号同级
        # (必须先于规则1执行，这样子编号 3A 才能基于已调整的 3. 层级)
        i = 0
        while i < len(headings):
            p = parsed[i]
            if not p:
                i += 1
                continue

            # 找到一个编号序列的起点（main_num=1 或序列首项）
            seq_start = i
            seq_num = p[0]
            parent_idx = None

            # 如果是 1. 开头，检查前面是否有非编号标题作为父标题
            if seq_num == 1 and not p[1] and i > 0 and not parsed[i - 1]:
                parent_idx = i - 1

            # 扫描连续编号序列（允许中间夹杂非编号标题）
            expected = seq_num
            seq_end = i
            j = i
            while j < len(headings):
                pj = parsed[j]
                if pj and not pj[1]:
                    if pj[0] == expected:
                        seq_end = j
                        expected += 1
                        j += 1
                    elif pj[0] == expected + 1:
                        # 跳了一个编号也算连续
                        expected = pj[0] + 1
                        seq_end = j
                        j += 1
                    else:
                        break
                elif pj and pj[1]:
                    # 子编号 (5A) 属于序列
                    seq_end = j
                    j += 1
                else:
                    # 非编号标题 — 检查后面是否还有连续编号
                    next_num_idx = None
                    for k in range(j + 1, min(j + 5, len(headings))):
                        pk = parsed[k]
                        if pk and not pk[1] and pk[0] in (expected, expected + 1):
                            next_num_idx = k
                            break
                    if next_num_idx is not None:
                        # 规则3: 夹在连续编号间的非编号标题
                        seq_end = j
                        j += 1
                    else:
                        break

            seq_len = seq_end - seq_start + 1
            if seq_len < 2:
                i = seq_end + 1
                continue

            # 规则2: 如果有父标题，序列中所有项应该比父标题深一级
            if parent_idx is not None:
                parent_level = headings[parent_idx].level
                for k in range(seq_start, seq_end + 1):
                    if headings[k].level <= parent_level:
                        headings[k].level = parent_level + 1
                        changed += 1

            # 规则3: 序列中非编号标题与编号标题同级
            seq_level = headings[seq_start].level
            for k in range(seq_start, seq_end + 1):
                if not parsed[k] and headings[k].level != seq_level:
                    headings[k].level = seq_level
                    changed += 1

            i = seq_end + 1

        # 规则1: 子编号 (5A, 5B) 应该比父编号 (5) 深一级
        # (在规则2/3之后执行，此时父编号层级已经被调整)
        for i, h in enumerate(headings):
            p = parsed[i]
            if not p:
                continue
            main_num, sub_letter, _ = p

            if sub_letter:
                for j in range(i - 1, max(i - 30, -1), -1):
                    pj = parsed[j]
                    if pj and pj[0] == main_num and not pj[1]:
                        parent_level = headings[j].level
                        if h.level <= parent_level:
                            h.level = parent_level + 1
                            changed += 1
                        break
                    if pj and pj[0] != main_num:
                        break

        # 规则4: 怪物/NPC 属性块标题（动作、传奇动作、特质等）应该比前面的怪物名深一级
        # 匹配中文、英文、或"中文 英文"混合形式
        _stat_keywords = [
            '动作', 'Actions',
            '传奇动作', 'Legendary Actions',
            '传奇抗性', 'Legendary Resistance',
            '反应', 'Reactions',
            '特质', 'Traits',
            '先天施法', 'Innate Spellcasting',
            '施法', 'Spellcasting',
            '巢穴动作', 'Lair Actions',
        ]
        _stat_set = {k.lower() for k in _stat_keywords}

        def _is_stat_block(title: str) -> bool:
            t = title.strip().lower()
            if t in _stat_set:
                return True
            # "传奇动作 Legendary Actions" → 检查任一已知关键词是否是 title 的子串
            for kw in _stat_keywords:
                if kw.lower() in t:
                    return True
            return False
        for i, h in enumerate(headings):
            if not _is_stat_block(h.title):
                continue
            # 向前找第一个非 stat-block 标题作为怪物名
            for j in range(i - 1, max(i - 10, -1), -1):
                if not _is_stat_block(headings[j].title):
                    parent_level = headings[j].level
                    if h.level <= parent_level:
                        h.level = parent_level + 1
                        changed += 1
                    break

        if changed:
            logger.info(f"编号层级细化: 修改了 {changed} 个标题的层级")

    def clamp_top_level(self, headings: List[TocEntry]) -> None:
        """只保留章节级标题为 level=1，其余 level=1 降为 level=2。
        同时确保 CONTENTS 识别出的章节边界强制为 level=1。"""
        chapter_re = re.compile(
            r'^(Chapter\s*\d+|第\s*[\d一二三四五六七八九十百]+\s*章'
            r'|Appendix\s*[A-Z]|附录\s*[A-Z]?'
            r'|Introduction|Conclusion|简介|前言|序言|Foreword|Preface'
            r'|Contents|目录|Credits|制作组)',
            re.IGNORECASE
        )
        for i, h in enumerate(headings):
            if i in self._chapter_indices:
                h.level = 1  # 章节边界强制 level=1
            elif h.level == 1 and not chapter_re.match(h.title):
                h.level = 2

    def build_tree(self, flat_headings: List[TocEntry]) -> List[TocEntry]:
        """将扁平列表构建为树结构"""
        root = []
        stack = []  # (level, entry)

        for heading in flat_headings:
            level = heading.level

            # 弹出栈直到找到父节点
            while stack and stack[-1][0] >= level:
                stack.pop()

            if not stack:
                root.append(heading)
            else:
                stack[-1][1].children.append(heading)

            stack.append((level, heading))

        return root

    def extract_toc_from_contents(self, tree: List[TocEntry]) -> List[TocEntry]:
        """
        从"目录 Contents"部分提取真正的TOC结构

        OCR问题：实际内容的标题都是#级别，但"目录 Contents"部分
        包含了正确的章节列表结构（##级别的子标题）

        策略：找到"目录"或"Contents"条目，返回其children作为TOC
        """
        for entry in tree:
            # 匹配"目录"或"Contents"
            if '目录' in entry.title or 'Contents' in entry.title:
                if entry.children:
                    logger.info(f"从'{entry.title}'提取到 {len(entry.children)} 个章节")
                    return entry.children

        # 如果没找到目录部分，返回原始树
        logger.warning("未找到'目录/Contents'部分，返回原始树结构")
        return tree

    def deduplicate_toc(self, tree: List[TocEntry]) -> List[TocEntry]:
        """去重：移除目录页面的章节列表（没有子节点的重复章节标题）"""
        # 收集有子节点的章节标题
        titles_with_children = set()
        for entry in tree:
            if entry.children:
                # 标准化标题用于比较（移除空格差异）
                normalized = entry.title.replace(' ', '').replace('：', ':')
                titles_with_children.add(normalized)

        # 过滤掉没有子节点但标题重复的条目
        filtered = []
        for entry in tree:
            normalized = entry.title.replace(' ', '').replace('：', ':')
            # 如果没有子节点，且存在同名的有子节点条目，则跳过
            if not entry.children and normalized in titles_with_children:
                continue
            filtered.append(entry)

        logger.info(f"去重前: {len(tree)} 条目, 去重后: {len(filtered)} 条目")
        return filtered

    def fill_content(self, headings: List[TocEntry], markdown: str) -> None:
        """
        根据line_number从markdown中提取每个章节的内容

        策略：章节内容 = 从标题行下一行开始，到下一个标题行前结束
        """
        lines = markdown.split('\n')
        total_lines = len(lines)

        # 按line_number排序，获取所有标题行号
        sorted_headings = sorted(headings, key=lambda h: h.line_number)
        line_numbers = [h.line_number for h in sorted_headings]

        for i, heading in enumerate(sorted_headings):
            start_line = heading.line_number  # 标题行（1-based）

            # 找到下一个标题的行号
            if i + 1 < len(line_numbers):
                end_line = line_numbers[i + 1] - 1
            else:
                end_line = total_lines

            # 提取内容（跳过标题行本身）
            content_lines = lines[start_line:end_line]  # start_line是1-based，python切片会得到正确结果
            content = '\n'.join(content_lines).strip()

            # 只保留有实际内容的
            if content and len(content) > 10:
                heading.content = content

    async def extract_and_reorganize(
        self,
        markdown: str,
        api_url: str,
        api_key: str,
        model: str,
        use_llm: bool = True
    ) -> tuple[List[TocEntry], Dict]:
        """完整流程：提取 -> 分组并行LLM整理层级 -> 填充内容 -> 构建树
        与 refresh-toc 端点使用相同逻辑。
        返回: (toc_entries, llm_status)
        """
        llm_status = {"llm_called": False, "llm_success": False}

        # 1. 正则提取所有标题
        headings = self.extract_headings(markdown)

        if not headings:
            return [], llm_status

        # 2. 使用LLM重新分配层级（分组并行）
        if use_llm:
            llm_api_kwargs = dict(api_url=api_url, api_key=api_key, model=model)
            MAX_GROUP_SIZE = 400

            chapter_groups = self.group_by_chapters(headings, markdown)
            if chapter_groups:
                groups = []
                for ch_title, ch_headings in chapter_groups:
                    if len(ch_headings) > MAX_GROUP_SIZE:
                        for j in range(0, len(ch_headings), MAX_GROUP_SIZE):
                            groups.append(ch_headings[j:j+MAX_GROUP_SIZE])
                    else:
                        groups.append(ch_headings)
            elif len(headings) > 300:
                groups = [headings[i:i+300] for i in range(0, len(headings), 300)]
            else:
                groups = [headings]

            # 并行调 LLM
            import asyncio
            tasks = [
                asyncio.create_task(self.reorganize_with_llm(batch, **llm_api_kwargs))
                for batch in groups
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # 收集结果，失败的重试一次
            success_count = 0
            retry_indices = []
            for i, r in enumerate(results):
                if isinstance(r, Exception):
                    retry_indices.append(i)
                else:
                    _, batch_status = r
                    if batch_status.get("llm_success"):
                        success_count += 1
                    else:
                        retry_indices.append(i)

            if retry_indices:
                retry_tasks = [
                    asyncio.create_task(self.reorganize_with_llm(groups[i], **llm_api_kwargs))
                    for i in retry_indices
                ]
                retry_results = await asyncio.gather(*retry_tasks, return_exceptions=True)
                for r in retry_results:
                    if not isinstance(r, Exception):
                        _, batch_status = r
                        if batch_status.get("llm_success"):
                            success_count += 1

            llm_status = {
                "llm_called": True,
                "llm_success": success_count > 0,
                "groups_total": len(groups),
                "groups_success": success_count
            }
            logger.info(f"LLM分组处理: {success_count}/{len(groups)} 组成功")

        # 3. 填充每个章节的内容
        self.fill_content(headings, markdown)

        # 4. 校正层级 + 构建树
        self.apply_contents_subsections(headings)
        self.clamp_top_level(headings)
        self.refine_numbered_hierarchy(headings)
        tree = self.build_tree(headings)

        # 5. 去重
        tree = self.deduplicate_toc(tree)

        logger.info(f"TOC提取完成: {len(tree)} 个顶级章节, LLM状态: {llm_status}")
        return tree, llm_status
