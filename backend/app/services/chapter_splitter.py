"""
Chapter Splitter Service
Extracts TOC from markdown and splits content into chapters
"""
import re
import json
import httpx
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai_model_service import ai_model_service
from app.models.ai_settings import ModelType


@dataclass
class Chapter:
    """Represents a chapter segment"""
    title: str
    title_en: Optional[str]
    level: int
    start_line: int
    end_line: int
    content: str
    chapter_type: str  # 'chapter' or 'appendix'


class ChapterSplitter:
    """Service for extracting TOC and splitting markdown into chapters"""

    TOC_EXTRACTION_PROMPT = """你是D&D模组解析专家。请从下面的文档内容中提取目录结构。

要求：
1. 识别所有章节标题（# 或 ## 开头的标题）
2. 返回JSON格式的目录列表
3. 每个条目包含：title（标题）、level（层级，1=章，2=节）、type（"chapter"或"appendix"）

文档内容：
---
{content}
---

只返回JSON数组，格式如：
[
  {{"title": "第一章：冒险开始", "level": 1, "type": "chapter"}},
  {{"title": "附录A：怪物", "level": 1, "type": "appendix"}}
]
"""

    def extract_headings_from_markdown(self, markdown_content: str) -> List[Dict]:
        """Extract all headings from markdown with line numbers"""
        headings = []
        lines = markdown_content.split('\n')

        for i, line in enumerate(lines):
            match = re.match(r'^(#{1,6})\s+(.+)$', line.strip())
            if match:
                level = len(match.group(1))
                title = match.group(2).strip()
                headings.append({
                    'level': level,
                    'title': title,
                    'line_number': i,
                    'type': 'appendix' if self._is_appendix(title) else 'chapter'
                })

        return headings

    def _is_appendix(self, title: str) -> bool:
        """Check if a heading is an appendix"""
        appendix_patterns = [
            r'^附录\s*[A-Za-z\d]',
            r'^Appendix\s*[A-Za-z\d]',
            r'^APPENDIX\s*[A-Za-z\d]',
        ]
        return any(re.match(p, title, re.IGNORECASE) for p in appendix_patterns)

    def split_by_headings(
        self,
        markdown_content: str,
        headings: List[Dict],
        min_level: int = 1,
        max_level: int = 2
    ) -> List[Chapter]:
        """
        Split markdown content into chapters based on headings

        Args:
            markdown_content: Full markdown text
            headings: List of headings from extract_headings_from_markdown
            min_level: Minimum heading level to split on (1 = #)
            max_level: Maximum heading level to split on (2 = ##)

        Returns:
            List of Chapter objects with content
        """
        lines = markdown_content.split('\n')
        chapters = []

        # Filter headings by level
        split_headings = [
            h for h in headings
            if min_level <= h['level'] <= max_level
        ]

        if not split_headings:
            # No headings found, return entire content as one chapter
            return [Chapter(
                title="Module Content",
                title_en=None,
                level=1,
                start_line=0,
                end_line=len(lines) - 1,
                content=markdown_content,
                chapter_type='chapter'
            )]

        # Create chapters from headings
        for i, heading in enumerate(split_headings):
            start_line = heading['line_number']

            # End at next heading or end of document
            if i + 1 < len(split_headings):
                end_line = split_headings[i + 1]['line_number'] - 1
            else:
                end_line = len(lines) - 1

            # Extract content for this chapter
            chapter_lines = lines[start_line:end_line + 1]
            content = '\n'.join(chapter_lines)

            chapters.append(Chapter(
                title=heading['title'],
                title_en=None,
                level=heading['level'],
                start_line=start_line,
                end_line=end_line,
                content=content,
                chapter_type=heading['type']
            ))

        return chapters

    async def extract_toc_with_ai(
        self,
        db: AsyncSession,
        markdown_content: str,
        max_chars: int = 8000
    ) -> List[Dict]:
        """
        Use AI to extract TOC from markdown content

        Args:
            db: Database session
            markdown_content: Full markdown text
            max_chars: Maximum characters to send to AI

        Returns:
            List of TOC entries with title, level, type
        """
        try:
            # Get FAST model for quick TOC extraction
            model_config = await ai_model_service.get_model_config(db, ModelType.FAST)

            # Use first N characters for TOC extraction
            snippet = self._get_toc_snippet(markdown_content, max_chars)

            prompt = self.TOC_EXTRACTION_PROMPT.format(content=snippet)

            # Call AI API
            result = await self._call_ai_api(
                api_url=model_config.api_url,
                api_key=model_config.api_key,
                model_name=model_config.model_name,
                prompt=prompt
            )

            # Parse JSON response
            toc = self._parse_toc_response(result)
            return toc

        except Exception as e:
            print(f"AI TOC extraction failed: {e}")
            # Fallback to rule-based extraction
            return self.extract_headings_from_markdown(markdown_content)

    def _get_toc_snippet(self, content: str, max_chars: int) -> str:
        """Get a snippet focused on TOC area of the document"""
        lines = content.split('\n')

        # Look for explicit TOC section
        toc_patterns = [
            re.compile(r'^\s*#{1,3}\s*(目录|contents|table of contents)', re.IGNORECASE),
        ]

        start_idx = 0
        for i, line in enumerate(lines[:500]):
            if any(p.search(line) for p in toc_patterns):
                start_idx = i
                break

        # Get content from start_idx
        snippet_lines = lines[start_idx:]
        snippet = '\n'.join(snippet_lines)

        return snippet[:max_chars]

    async def _call_ai_api(
        self,
        api_url: str,
        api_key: str,
        model_name: str,
        prompt: str
    ) -> str:
        """Call AI API for TOC extraction"""
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        endpoint = api_url.rstrip('/')
        if not endpoint.endswith('/chat/completions'):
            endpoint = endpoint + '/chat/completions'

        payload = {
            "model": model_name,
            "messages": [
                {
                    "role": "system",
                    "content": "你是D&D模组解析专家。只返回JSON，不要其他内容。"
                },
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 2000,
            "temperature": 0.3
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(endpoint, headers=headers, json=payload)

            if response.status_code != 200:
                raise Exception(f"AI API error: {response.status_code}")

            result = response.json()
            return result.get("choices", [{}])[0].get("message", {}).get("content", "")

    def _parse_toc_response(self, response_text: str) -> List[Dict]:
        """Parse AI response to extract TOC list"""
        # Try to extract JSON from response
        json_match = re.search(r'\[[\s\S]*\]', response_text)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

        return []

    def find_chapter_for_line(
        self,
        line_number: int,
        chapters: List[Chapter]
    ) -> Optional[Chapter]:
        """Find which chapter contains a given line number"""
        for chapter in chapters:
            if chapter.start_line <= line_number <= chapter.end_line:
                return chapter
        return None

    def find_chapter_for_image(
        self,
        image_id: str,
        markdown_content: str,
        chapters: List[Chapter]
    ) -> Optional[str]:
        """
        Find which chapter contains an image by its ID

        Args:
            image_id: Image ID to find
            markdown_content: Full markdown text
            chapters: List of chapters

        Returns:
            Chapter title or None
        """
        lines = markdown_content.split('\n')

        # Find line containing the image reference
        image_patterns = [
            rf'!\[.*?\]\({re.escape(image_id)}\)',
            rf'!\[{re.escape(image_id)}\]',
        ]

        for i, line in enumerate(lines):
            for pattern in image_patterns:
                if re.search(pattern, line):
                    chapter = self.find_chapter_for_line(i, chapters)
                    if chapter:
                        return chapter.title

        return None


# Singleton instance
chapter_splitter = ChapterSplitter()
