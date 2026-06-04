"""
Translation service for converting English D&D content to Chinese
"""
import re
import asyncio
import httpx
from typing import Optional, Callable
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.ai_service import AIService
from app.models.ai_settings import AIAPISettings
from app.db.session import async_session_maker


class TranslationService:
    """Service for translating D&D content from English to Chinese"""

    def __init__(self):
        self.api_url = None
        self.api_key = None
        self.model = None
        # D&D translation principles
        self.translation_prompt = """你是一位专业的龙与地下城（D&D）翻译专家。请将以下英文内容翻译成中文，遵循以下原则：

1. **术语一致性**：使用D&D官方中文术语，例如：
   - Dungeon Master → 地下城主（DM）
   - Player Character → 玩家角色（PC）
   - Non-Player Character → 非玩家角色（NPC）
   - Hit Points → 生命值（HP）
   - Armor Class → 护甲等级（AC）
   - Saving Throw → 豁免检定
   - Ability Check → 属性检定
   - Attack Roll → 攻击检定

2. **保持格式**：
   - 保留所有Markdown格式标记（#、*、-、[]()等）
   - 保留代码块、表格结构
   - 保留图片链接和引用
   - 保留HTML标签

3. **专有名词**：
   - 种族、职业、法术、怪物名称使用官方译名
   - 如无官方译名，音译并在括号中注明英文原文
   - 地名、人名保持英文或音译

4. **语言风格**：
   - 使用简洁、准确的中文
   - 保持原文的语气和风格
   - 游戏规则描述要清晰明确

5. **数字和单位**：
   - 保留原文中的数字
   - 距离单位：feet → 英尺，miles → 英里
   - 重量单位：pounds → 磅

请直接输出翻译结果，不要添加任何解释或说明。

---

待翻译内容：

{content}"""
    
    async def translate_titles_batch(self, titles: list[str]) -> list[str]:
        """
        Batch translate a list of short titles (e.g. chapter names).
        Returns translated titles in the same order.
        """
        if not self.api_url or not self.api_key or not self.model:
            await self._load_ai_settings()

        # Build numbered list for reliable parsing
        lines = [f"{i+1}. {t}" for i, t in enumerate(titles)]
        prompt = f"""请将以下D&D模组标题从英文翻译成中文。每行一个标题，保持编号对应。
注意：
- Chapter → 章
- Part → 部分
- Appendix → 附录
- 专有名词（人名、地名）音译或保留英文
- 只输出翻译结果（保持编号格式），不要添加任何解释

{chr(10).join(lines)}"""

        messages = [{"role": "user", "content": prompt}]
        response = await AIService.generate_completion(
            api_url=self.api_url,
            api_key=self.api_key,
            model=self.model,
            messages=messages,
            temperature=0.3,
            max_tokens=8000
        )

        # Parse numbered results
        result_lines = response.strip().split("\n")
        translated = {}
        for line in result_lines:
            line = line.strip()
            if not line:
                continue
            # Match "1. xxx" or "1、xxx" or "1.xxx"
            m = re.match(r'^(\d+)[.、．\s]+(.+)', line)
            if m:
                idx = int(m.group(1)) - 1
                translated[idx] = m.group(2).strip()

        # Return in order, falling back to original if parsing failed
        return [translated.get(i, titles[i]) for i in range(len(titles))]

    async def translate_contents_batch(self, contents: list[str], max_chars: int = 4000) -> list[str]:
        """
        Batch translate multiple content blocks in one API call.
        Concatenates blocks with numbered separators, translates, then splits back.
        Returns translated contents in the same order.
        """
        if not self.api_url or not self.api_key or not self.model:
            await self._load_ai_settings()

        sep = "===BLOCK{}==="
        parts = []
        for i, c in enumerate(contents):
            parts.append(f"{sep.format(i+1)}\n{c}")
        combined = "\n".join(parts)

        prompt = f"""请将以下D&D模组内容从英文翻译成中文。内容被分成多个编号块（===BLOCK N===），请保持相同的分块格式输出翻译结果。
注意：
- 使用D&D官方中文术语
- 保留Markdown格式、数字、专有名词
- 每个块独立翻译，保持===BLOCK N===分隔符
- 只输出翻译结果

{combined}"""

        messages = [{"role": "user", "content": prompt}]
        try:
            response = await AIService.generate_completion(
                api_url=self.api_url,
                api_key=self.api_key,
                model=self.model,
                messages=messages,
                temperature=0.3,
                max_tokens=16000
            )
        except Exception:
            return contents  # fallback to originals

        # Parse response back into blocks
        result = {}
        current_idx = None
        current_lines = []
        for line in response.split("\n"):
            m = re.match(r'^===BLOCK\s*(\d+)===', line.strip())
            if m:
                if current_idx is not None:
                    result[current_idx] = "\n".join(current_lines).strip()
                current_idx = int(m.group(1)) - 1
                current_lines = []
            elif current_idx is not None:
                current_lines.append(line)
        if current_idx is not None:
            result[current_idx] = "\n".join(current_lines).strip()

        return [result.get(i, contents[i]) for i in range(len(contents))]

    async def translate_text(self, text: str) -> str:
        """
        Translate a short text from English to Chinese

        Args:
            text: Text to translate

        Returns:
            Translated text
        """
        # Load API settings if not already loaded
        if not self.api_url or not self.api_key or not self.model:
            await self._load_ai_settings()

        # Simple translation prompt for short text
        prompt = f"""请将以下英文翻译成中文，保持简洁准确。注意：
- Chapter → 章
- Part → 部分
- Appendix → 附录

只输出翻译结果，不要添加任何解释。

英文：{text}
中文："""

        messages = [{"role": "user", "content": prompt}]

        response = await AIService.generate_completion(
            api_url=self.api_url,
            api_key=self.api_key,
            model=self.model,
            messages=messages,
            temperature=0.3  # Lower temperature for more consistent translations
        )

        return response.strip()

    async def translate_markdown(
        self,
        content: str,
        progress_callback: Optional[Callable[[str, int], None]] = None,
        batch_size: int = 3000,
        concurrent_batches: int = 5,
        skip_language_check: bool = False
    ) -> str:
        """
        Translate markdown content from English to Chinese

        Args:
            content: Markdown content to translate
            progress_callback: Optional callback for progress updates (msg, percent)
            batch_size: Number of characters per batch
            concurrent_batches: Number of concurrent translation batches
            skip_language_check: Skip language detection (already checked by caller)

        Returns:
            Translated markdown content
        """
        import time

        # Detect language (skip if already checked by caller)
        if not skip_language_check:
            if progress_callback:
                await progress_callback("🔍 检测文档语言...", 5)

            language = await self.detect_language(content)

            if language != 'en':
                if progress_callback:
                    await progress_callback("✅ 文档非纯英文，跳过翻译", 100)
                return content

        if progress_callback:
            await progress_callback("🌐 开始翻译...", 10)

        # Split content into batches
        batches = self._split_into_batches(content, batch_size)
        total_batches = len(batches)

        if progress_callback:
            await progress_callback(f"📝 文档已分为 {total_batches} 个批次进行翻译", 15)

        # Load AI settings
        await self._load_ai_settings()

        start_time = time.time()
        completed = [0]

        async def translate_batch_with_retry(i: int, batch: str, max_retries: int = 1):
            for attempt in range(max_retries):
                try:
                    translated = await self._translate_batch(batch)
                    completed[0] += 1
                    if progress_callback:
                        progress = 15 + int((completed[0] / total_batches) * 80)
                        await progress_callback(
                            f"✅ 翻译 {completed[0]}/{total_batches}",
                            progress
                        )
                    return i, translated
                except Exception as e:
                    if attempt == max_retries - 1:
                        print(f"❌ 批次 {i+1} 翻译失败: {e}")
                        completed[0] += 1
                        return i, batch  # Keep original on failure
                    await asyncio.sleep((attempt + 1) * 2)

        # Concurrent translation with semaphore
        semaphore = asyncio.Semaphore(concurrent_batches)

        async def limited_translate(i: int, batch: str):
            async with semaphore:
                return await translate_batch_with_retry(i, batch)

        tasks = [limited_translate(i, batch) for i, batch in enumerate(batches)]
        results = await asyncio.gather(*tasks)

        # Sort by index and combine
        results.sort(key=lambda x: x[0])
        translated_content = "\n\n".join([r[1] for r in results])

        total_time = time.time() - start_time
        print(f"⏱️ 翻译完成: {total_time:.2f}秒")

        if progress_callback:
            await progress_callback("✅ 翻译完成！", 100)

        return translated_content

    async def detect_language(self, text: str) -> str:
        """
        Detect if text is primarily English, Chinese, or bilingual using LLM

        Returns:
            'en' for English, 'zh' for Chinese, 'bilingual' for mixed
        """
        # Remove base64 image data before sampling (they contain no language info)
        # Do this on full text first, then sample
        clean_text = re.sub(r'!\[.*?\]\(data:image/[^)]+\)', '[IMAGE]', text)
        clean_text = re.sub(r'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+', '', clean_text)

        # Debug: show lengths
        print(f"[语言检测] 原始文本长度: {len(text)}, 清理后长度: {len(clean_text)}")

        # If cleaned text is too short, can't detect reliably - assume bilingual for D&D docs
        if len(clean_text.strip()) < 100:
            print(f"[语言检测] 清理后文本太短，无法检测，假设为双语")
            return 'bilingual'

        # Sample text for detection (avoid sending too much to LLM)
        sample = clean_text[:5000] if len(clean_text) > 5000 else clean_text

        # Debug: show what we're sending
        print(f"[语言检测] 采样长度: {len(sample)}, 前300字符: {sample[:300]}")

        await self._load_ai_settings()

        prompt = f"""判断以下文档的语言类型：
- 如果文档主要是英文（只有少量中文术语），回复：en
- 如果文档主要是中文（只有少量英文术语），回复：zh
- 如果文档是双语的（英文和中文交替出现，如英文标题+中文翻译），回复：bilingual

注意：D&D游戏术语（DC、HP、AC等）不算中英文混用。

只回复一个词：en、zh 或 bilingual

文档内容：
{sample}"""

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.api_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 10,
                        "temperature": 0
                    }
                )

                print(f"[语言检测] API响应状态: {response.status_code}")
                if response.status_code == 200:
                    result = response.json()
                    print(f"[语言检测] 原始响应: {result}")
                    answer = result["choices"][0]["message"]["content"].strip().lower()
                    print(f"[语言检测] LLM回答: '{answer}'")
                    if "bilingual" in answer or "双语" in answer:
                        return 'bilingual'
                    elif "zh" in answer or "中" in answer:
                        return 'zh'
                    elif "en" in answer or "英" in answer:
                        return 'en'
                else:
                    print(f"[语言检测] API错误: {response.text[:500]}")
        except Exception as e:
            print(f"LLM language detection failed: {e}, falling back to heuristic")

        # Fallback: simple heuristic based on Chinese character ratio
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', sample))
        english_words = len(re.findall(r'[a-zA-Z]+', sample))
        print(f"[语言检测] Fallback - 中文字符: {chinese_chars}, 英文单词: {english_words}")

        # If both Chinese and English are substantial, it's bilingual
        if chinese_chars > 100 and english_words > 50:
            print(f"[语言检测] Fallback结果: bilingual")
            return 'bilingual'
        result = 'zh' if chinese_chars > 50 else 'en'
        print(f"[语言检测] Fallback结果: {result}")
        return result

    async def translate_markdown_file(
        self,
        input_path: Path,
        output_path: Path,
        progress_callback: Optional[Callable[[str, int, dict], None]] = None,
        batch_size: int = 3000,
        debug_mode: bool = False,  # 调试模式：只翻译前3个批次（默认关闭）
        debug_batches: int = 3,
        concurrent_batches: int = 5,  # 并发翻译的批次数
        generate_toc: bool = True  # 是否生成目录
    ) -> dict:
        """
        Translate markdown file from English to Chinese

        Args:
            input_path: Path to input markdown file
            output_path: Path to output translated file
            progress_callback: Optional callback for progress updates
            batch_size: Number of characters per batch (default 3000)
            debug_mode: If True, only translate first few batches for debugging
            debug_batches: Number of batches to translate in debug mode
            concurrent_batches: Number of batches to translate concurrently
            generate_toc: Whether to generate table of contents

        Returns:
            dict with 'toc' (list of chapters/parts) and 'output_path'
        """
        # Read file
        with open(input_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Detect language
        if progress_callback:
            await progress_callback("🔍 检测文档语言...", 5, None)

        language = await self.detect_language(content)

        if language == 'zh':
            if progress_callback:
                await progress_callback("✅ 文档已是中文，无需翻译", 100, None)
            # Copy file as-is
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return

        if progress_callback:
            await progress_callback("🌐 检测到英文文档，开始翻译...", 10, None)
        
        # Split content into batches
        batches = self._split_into_batches(content, batch_size)
        total_batches = len(batches)

        # 调试模式：只翻译前几个批次
        if debug_mode:
            batches_to_translate = min(debug_batches, total_batches)
            if progress_callback:
                await progress_callback(
                    f"🐛 调试模式：只翻译前 {batches_to_translate}/{total_batches} 个批次",
                    15,
                    None
                )
        else:
            batches_to_translate = total_batches
            if progress_callback:
                await progress_callback(f"📝 文档已分为 {total_batches} 个批次进行翻译", 15, None)

        # 并发翻译批次
        import time
        start_time = time.time()

        # 预加载 AI 配置
        await self._load_ai_settings()

        # 创建翻译任务（带重试机制）
        async def translate_batch_with_index(i: int, batch: str, max_retries: int = 3):
            """翻译单个批次并返回索引和结果，失败时自动重试"""
            batch_num = i + 1

            # 调试模式：跳过后面的批次
            if debug_mode and i >= batches_to_translate:
                return i, batch  # 保留原文

            # 重试逻辑
            for attempt in range(max_retries):
                try:
                    batch_start = time.time()
                    translated = await self._translate_batch(batch)
                    batch_time = time.time() - batch_start

                    retry_info = f" (重试 {attempt + 1}/{max_retries})" if attempt > 0 else ""
                    print(f"✅ 批次 {batch_num} 翻译成功{retry_info} (耗时: {batch_time:.2f}秒)")

                    if progress_callback:
                        progress = 15 + int((i / batches_to_translate) * 75)
                        batch_info = {
                            'current': batch_num,
                            'total': batches_to_translate,
                            'retry_count': attempt
                        }
                        await progress_callback(
                            f"✅ 第 {batch_num}/{batches_to_translate} 批次翻译成功{retry_info} ({batch_time:.2f}秒)",
                            progress,
                            batch_info
                        )

                    return i, translated

                except Exception as e:
                    error_msg = str(e)
                    is_last_attempt = (attempt == max_retries - 1)

                    if is_last_attempt:
                        # 最后一次尝试失败，保留原文
                        print(f"\n❌ 批次 {batch_num} 翻译失败 (已重试 {max_retries} 次):")
                        print(f"   错误: {error_msg}")
                        print(f"   批次内容长度: {len(batch)} 字符")
                        print(f"   批次前100字符: {batch[:100]}")
                        print(f"   ⚠️ 保留原文")

                        if progress_callback:
                            progress = 15 + int((i / batches_to_translate) * 75)
                            batch_info = {
                                'current': batch_num,
                                'total': batches_to_translate,
                                'retry_count': max_retries
                            }
                            await progress_callback(
                                f"⚠️ 第 {batch_num} 批次翻译失败 (已重试{max_retries}次)，保留原文",
                                progress,
                                batch_info
                            )

                        return i, batch  # 保留原文
                    else:
                        # 还有重试机会，等待后重试
                        wait_time = (attempt + 1) * 2  # 递增等待时间：2秒、4秒、6秒
                        print(f"\n⚠️ 批次 {batch_num} 翻译失败 (尝试 {attempt + 1}/{max_retries}):")
                        print(f"   错误: {error_msg}")
                        print(f"   等待 {wait_time} 秒后重试...")

                        await asyncio.sleep(wait_time)
                        continue  # 继续下一次重试

        # 并发执行翻译任务
        print(f"\n🚀 开始并发翻译 (并发数: {concurrent_batches})")

        # 创建所有任务
        tasks = [translate_batch_with_index(i, batch) for i, batch in enumerate(batches)]

        # 使用 semaphore 限制并发数
        semaphore = asyncio.Semaphore(concurrent_batches)

        async def limited_translate(task):
            async with semaphore:
                return await task

        # 执行所有任务
        results = await asyncio.gather(*[limited_translate(task) for task in tasks])

        # 按索引排序结果
        results.sort(key=lambda x: x[0])
        translated_batches = [result[1] for result in results]

        total_time = time.time() - start_time
        print(f"\n⏱️ 总翻译时间: {total_time:.2f}秒")
        print(f"📊 平均每批次: {total_time / batches_to_translate:.2f}秒")
        
        # Combine translated batches
        translated_content = "\n\n".join(translated_batches)

        # Extract table of contents if requested
        toc = []
        if generate_toc:
            # Extract TOC from original content (not translated content)
            # This ensures we get all chapters even in debug mode
            toc = self._extract_toc(content)
            print(f"\n📚 从原文提取目录: 共 {len(toc)} 个章节")

            # Translate chapter titles
            if toc:
                if progress_callback:
                    await progress_callback("📚 翻译目录章节名...", 95, None)

                print(f"🌐 开始翻译章节名...")
                toc = await self._translate_toc(toc)

                print(f"✅ 目录翻译完成:")
                for item in toc[:10]:  # 只打印前10个
                    print(f"   {item['level_indent']}{item['full_title']}")
                if len(toc) > 10:
                    print(f"   ... 还有 {len(toc) - 10} 个章节")

            # Generate TOC markdown and prepend to content
            toc_markdown = self._generate_toc_markdown(toc)
            translated_content = toc_markdown + "\n\n---\n\n" + translated_content

        # Write output
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(translated_content)

        if progress_callback:
            await progress_callback("✅ 翻译完成！", 100, None)

        return {
            'toc': toc,
            'output_path': str(output_path),
            'translation_progress': {
                'total_batches': total_batches,
                'completed_batches': batches_to_translate,
                'is_complete': batches_to_translate == total_batches
            }
        }
    async def _translate_toc(self, toc: list[dict]) -> list[dict]:
        """
        Translate chapter/part titles in table of contents

        Args:
            toc: List of TOC entries with 'title' field

        Returns:
            TOC with translated titles
        """
        if not toc:
            return toc

        # Collect all titles to translate
        titles_to_translate = []
        for item in toc:
            if item.get('title'):
                titles_to_translate.append(item['title'])

        if not titles_to_translate:
            return toc

        # Translate all titles in one batch for efficiency
        translated_titles = []
        for title in titles_to_translate:
            try:
                translated = await self.translate_text(title)
                translated_titles.append(translated)
            except Exception as e:
                print(f"⚠️ 翻译章节名失败: {title} - {str(e)}")
                translated_titles.append(title)  # Keep original if translation fails

        # Update TOC with translated titles
        title_index = 0
        for item in toc:
            if item.get('title'):
                item['title'] = translated_titles[title_index]

                # Update full_title based on type
                if item['type'] == 'chapter':
                    item['full_title'] = f"第{item['number']}章: {item['title']}" if item['number'] and item['title'] else item['title']
                elif item['type'] == 'part':
                    item['full_title'] = f"第{item['number']}部分: {item['title']}" if item['number'] and item['title'] else item['title']
                elif item['type'] == 'appendix':
                    number = item.get('number', '')
                    item['full_title'] = f"附录{number}: {item['title']}" if number and item['title'] else '附录'
                elif item['type'] == 'preface':
                    item['full_title'] = '前言'

                title_index += 1

        return toc

    def _extract_toc(self, content: str) -> list[dict]:
        """
        Extract table of contents from markdown content (original or translated)

        Extracts:
        - Chapter X / 第X章
        - Part X / 第X部分
        - Appendix / 附录
        - Content before Chapter 1 or Part 1 is labeled as "前言" (Preface)

        Returns:
            List of dict with 'type', 'number', 'title', 'level', 'level_indent'
        """
        toc = []
        lines = content.split('\n')
        seen_entries = set()  # Track seen entries to avoid duplicates (by type and number only)

        # Patterns to match
        chapter_pattern = re.compile(r'^#+\s*(Chapter\s+(\d+|[IVX]+)|第\s*(\d+|[一二三四五六七八九十百]+)\s*章)[:\s]*(.*)$', re.IGNORECASE)
        part_pattern = re.compile(r'^#+\s*(Part\s+(\d+|[IVX]+)|第\s*(\d+|[一二三四五六七八九十百]+)\s*部分)[:\s]*(.*)$', re.IGNORECASE)
        appendix_pattern = re.compile(r'^#+\s*(Appendix|附录)(\s+[A-Z]|[一二三四五六七八九十])?[:\s]*(.*)$', re.IGNORECASE)

        found_first_chapter = False

        for i, line in enumerate(lines):
            line = line.strip()

            # Check for Chapter
            chapter_match = chapter_pattern.match(line)
            if chapter_match:
                found_first_chapter = True
                number = chapter_match.group(2) or chapter_match.group(3) or ''
                title = chapter_match.group(4).strip() if chapter_match.group(4) else ''

                # Normalize number for deduplication (convert Chinese numbers to Arabic)
                normalized_number = self._normalize_chapter_number(number)

                # Create unique key for deduplication (only by type and number)
                entry_key = f"chapter_{normalized_number}"
                if entry_key not in seen_entries:
                    seen_entries.add(entry_key)
                    full_title = f"第{number}章: {title}" if number and title else line.strip('#').strip()
                    toc.append({
                        'type': 'chapter',
                        'number': number,
                        'title': title,
                        'full_title': full_title,
                        'level': 1,
                        'level_indent': ''
                    })
                continue

            # Check for Part
            part_match = part_pattern.match(line)
            if part_match:
                found_first_chapter = True
                number = part_match.group(2) or part_match.group(3) or ''
                title = part_match.group(4).strip() if part_match.group(4) else ''

                # Normalize number for deduplication
                normalized_number = self._normalize_chapter_number(number)

                # Create unique key for deduplication (only by type and number)
                entry_key = f"part_{normalized_number}"
                if entry_key not in seen_entries:
                    seen_entries.add(entry_key)
                    full_title = f"第{number}部分: {title}" if number and title else line.strip('#').strip()
                    toc.append({
                        'type': 'part',
                        'number': number,
                        'title': title,
                        'full_title': full_title,
                        'level': 1,
                        'level_indent': ''
                    })
                continue

            # Check for Appendix
            appendix_match = appendix_pattern.match(line)
            if appendix_match:
                number = appendix_match.group(2).strip() if appendix_match.group(2) else ''
                title = appendix_match.group(3).strip() if appendix_match.group(3) else ''

                # Normalize number for deduplication
                normalized_number = number.strip() if number else 'default'

                # Create unique key for deduplication (only by type and number)
                entry_key = f"appendix_{normalized_number}"
                if entry_key not in seen_entries:
                    seen_entries.add(entry_key)
                    full_title = f"附录{number}: {title}" if number and title else '附录'
                    toc.append({
                        'type': 'appendix',
                        'number': number,
                        'title': title,
                        'full_title': full_title,
                        'level': 1,
                        'level_indent': ''
                    })
                continue

        # If we found chapters/parts, add preface at the beginning
        if found_first_chapter and toc:
            toc.insert(0, {
                'type': 'preface',
                'number': '',
                'title': '前言',
                'full_title': '前言',
                'level': 1,
                'level_indent': ''
            })

        return toc

    def _normalize_chapter_number(self, number: str) -> str:
        """
        Normalize chapter number for deduplication
        Converts Chinese numbers to Arabic numbers

        Args:
            number: Chapter number (e.g., "1", "一", "I")

        Returns:
            Normalized number string
        """
        if not number:
            return ''

        # Chinese number mapping
        chinese_numbers = {
            '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
            '六': '6', '七': '7', '八': '8', '九': '9', '十': '10'
        }

        # Roman numeral mapping (basic)
        roman_numbers = {
            'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5',
            'VI': '6', 'VII': '7', 'VIII': '8', 'IX': '9', 'X': '10'
        }

        # Try to convert
        number_str = number.strip()

        # Check if it's already Arabic
        if number_str.isdigit():
            return number_str

        # Check if it's Chinese
        if number_str in chinese_numbers:
            return chinese_numbers[number_str]

        # Check if it's Roman
        if number_str.upper() in roman_numbers:
            return roman_numbers[number_str.upper()]

        # Return as-is if no conversion found
        return number_str

    def _generate_toc_markdown(self, toc: list[dict]) -> str:
        """
        Generate markdown table of contents from TOC list

        Args:
            toc: List of TOC items with 'type', 'number', 'title', 'full_title'

        Returns:
            Markdown formatted table of contents
        """
        if not toc:
            return ""

        lines = [
            "# 目录",
            ""
        ]

        for item in toc:
            # Use full_title for display
            title = item['full_title']
            lines.append(f"- {title}")

        return "\n".join(lines)

    def _split_into_batches(self, content: str, batch_size: int) -> list[str]:
        """
        Split content into batches, trying to preserve markdown structure
        """
        # Split by double newlines (paragraphs)
        paragraphs = content.split('\n\n')
        
        batches = []
        current_batch = []
        current_size = 0
        
        for para in paragraphs:
            para_size = len(para)
            
            # If single paragraph is larger than batch_size, split it
            if para_size > batch_size:
                if current_batch:
                    batches.append('\n\n'.join(current_batch))
                    current_batch = []
                    current_size = 0
                
                # Split large paragraph by sentences
                sentences = re.split(r'([.!?]\s+)', para)
                temp_batch = []
                temp_size = 0
                
                for sentence in sentences:
                    if temp_size + len(sentence) > batch_size and temp_batch:
                        batches.append(''.join(temp_batch))
                        temp_batch = []
                        temp_size = 0
                    temp_batch.append(sentence)
                    temp_size += len(sentence)
                
                if temp_batch:
                    batches.append(''.join(temp_batch))
            
            # If adding this paragraph exceeds batch_size, start new batch
            elif current_size + para_size > batch_size and current_batch:
                batches.append('\n\n'.join(current_batch))
                current_batch = [para]
                current_size = para_size
            else:
                current_batch.append(para)
                current_size += para_size + 2  # +2 for \n\n
        
        # Add remaining batch
        if current_batch:
            batches.append('\n\n'.join(current_batch))
        
        return batches
    
    async def _load_ai_settings(self):
        """Load AI settings from database"""
        if self.api_url and self.api_key and self.model:
            return  # Already loaded

        async with async_session_maker() as session:
            from app.models.ai_settings import AIModelConfig, ModelType

            stmt = (
                select(AIModelConfig)
                .join(AIAPISettings)
                .where(
                    AIAPISettings.user_id == "global",
                    AIModelConfig.model_type == ModelType.TRANSLATION
                )
            )
            result = await session.execute(stmt)
            config = result.scalar_one_or_none()

            if config and config.api_url and config.api_key and config.model_name:
                self.api_url = config.api_url
                self.api_key = config.api_key
                self.model = config.model_name
                print(f"✅ 使用 Translation Model: {self.model}")
            else:
                raise Exception("Translation Model not configured in database")

    async def _translate_batch(self, content: str) -> str:
        """Translate a single batch of content"""
        print(f"\n🔄 开始翻译批次:")
        print(f"   内容长度: {len(content)} 字符")
        print(f"   内容预览: {content[:200]}...")

        # Load AI settings if not already loaded
        await self._load_ai_settings()

        print(f"   API URL: {self.api_url}")
        print(f"   Model: {self.model}")

        prompt = self.translation_prompt.format(content=content)

        print(f"   Prompt 长度: {len(prompt)} 字符")

        # Use fast model for translation
        try:
            response = await AIService.generate_completion(
                api_url=self.api_url,
                api_key=self.api_key,
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,  # Lower temperature for more consistent translations
                max_tokens=16000  # Large enough for 10000 character batches
            )

            print(f"   ✅ 翻译成功，响应长度: {len(response)} 字符")
            print(f"   响应前200字符: {response[:200]}")
            print(f"   响应后200字符: {response[-200:]}")
            return response.strip()
        except Exception as e:
            print(f"   ❌ 翻译失败: {str(e)}")
            raise

