"""
Module Image Classifier Service
Uses vision models to classify and describe images in D&D modules
"""
import asyncio
import base64
import httpx
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from enum import Enum
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai_model_service import ai_model_service

# 并发控制配置
MAX_CONCURRENT_REQUESTS = 5  # 最大并发数


class ImageCategory(str, Enum):
    """Image category types for D&D modules"""
    MAP = "map"                    # 地图
    CHARACTER_PORTRAIT = "character_portrait"  # 角色立绘
    MONSTER_PORTRAIT = "monster_portrait"      # 怪物立绘
    SCENE = "scene"                # 场景图
    ITEM = "item"                  # 物品图
    UNKNOWN = "unknown"            # 未知


@dataclass
class ImageClassification:
    """Result of image classification"""
    category: ImageCategory
    description: str               # 描述，如 "哥布林的立绘"
    confidence: str               # high, medium, low
    related_entity: Optional[str] = None  # 相关实体名称
    chapter_context: Optional[str] = None  # 所在章节


class ModuleImageClassifier:
    """Service for classifying images in D&D modules using vision models"""

    CLASSIFICATION_PROMPT = """你是一个D&D模组图片分析专家。请分析这张图片并进行分类。

这是一个D&D 5E冒险模组中的图片。
{chapter_info}
图片周围的文字上下文如下：
---
{context}
---

请将图片分类为以下类别之一：
1. map - 地图（战斗地图、区域地图、世界地图、建筑平面图等，有网格/比例尺/地标标注）
2. character_portrait - 角色立绘（NPC、重要人物的肖像或全身像）
3. monster_portrait - 怪物立绘（敌人、生物的图像）
4. scene - 场景图（环境、地点、氛围插图）
5. item - 物品图（武器、装备、宝物等）
6. unknown - 无法确定

置信度判断标准：
- high: 图片特征明显，分类确定无疑（如明显的地图网格、清晰的角色全身像）
- medium: 图片可能属于某类，但有一些不确定因素
- low: 难以判断，只能猜测

请用JSON格式回复，包含以下字段：
{{
    "category": "分类名称",
    "description": "简短描述这张图片是什么，如'哥布林王的立绘'或'矿洞第一层地图'",
    "confidence": "high/medium/low",
    "related_entity": "相关的实体名称，如怪物名、NPC名、地点名等，没有则为null"
}}

只返回JSON，不要其他内容。"""

    async def classify_image(
        self,
        db: AsyncSession,
        image_base64: str,
        context_text: str = "",
        chapter_name: str = ""
    ) -> ImageClassification:
        """
        Classify a single image using the vision model

        Args:
            db: Database session
            image_base64: Base64 encoded image data
            context_text: Text surrounding the image in the document
            chapter_name: Name of the chapter where image appears

        Returns:
            ImageClassification with category and description
        """
        try:
            # Get vision model config
            vision_config = await ai_model_service.get_config_for_usage(db, "image_classification")

            # Prepare chapter info
            chapter_info = f"图片所在章节：{chapter_name}\n" if chapter_name else ""

            # Prepare the prompt with context
            prompt = self.CLASSIFICATION_PROMPT.format(
                chapter_info=chapter_info,
                context=context_text[:2000] if context_text else "（无上下文）"
            )

            # Call vision API
            result = await self._call_vision_api(
                api_url=vision_config.api_url,
                api_key=vision_config.api_key,
                model_name=vision_config.model_name,
                image_base64=image_base64,
                prompt=prompt
            )

            # Parse the response
            classification = self._parse_classification(result, chapter_name)
            return classification

        except Exception as e:
            # Return unknown classification on error
            return ImageClassification(
                category=ImageCategory.UNKNOWN,
                description=f"分类失败: {str(e)}",
                confidence="low",
                chapter_context=chapter_name
            )

    async def classify_images_batch(
        self,
        db: AsyncSession,
        images: List[Dict[str, Any]],
        progress_callback: Optional[callable] = None,
        max_concurrency: int = MAX_CONCURRENT_REQUESTS
    ) -> List[ImageClassification]:
        """
        Classify multiple images with concurrent processing

        Args:
            db: Database session
            images: List of dicts with 'image_base64', 'context', 'chapter'
            progress_callback: Optional callback for progress updates
            max_concurrency: Maximum number of concurrent requests (default 5)

        Returns:
            List of ImageClassification results
        """
        total = len(images)
        if total == 0:
            return []

        # Get vision config once for all requests
        vision_config = await ai_model_service.get_config_for_usage(db, "image_classification")

        # Semaphore for concurrency control
        semaphore = asyncio.Semaphore(max_concurrency)
        completed = [0]  # Use list to allow modification in nested function

        async def classify_with_semaphore(idx: int, img_info: Dict[str, Any]) -> ImageClassification:
            async with semaphore:
                # Support both base64 and OSS URLs (prefer oss_url for performance)
                image_source = (
                    img_info.get("oss_url") or
                    img_info.get("thumbnail_url") or
                    img_info.get("image_base64", "")
                )
                result = await self._classify_single_image(
                    vision_config=vision_config,
                    image_base64=image_source,  # Can be URL or base64
                    context_text=img_info.get("context", ""),
                    chapter_name=img_info.get("chapter", "")
                )
                completed[0] += 1
                if progress_callback:
                    await progress_callback(
                        f"分类图片 {completed[0]}/{total}...",
                        int((completed[0] / total) * 100)
                    )
                return result

        # Create all tasks and run concurrently
        tasks = [classify_with_semaphore(i, img) for i, img in enumerate(images)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Convert exceptions to unknown classifications
        final_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                final_results.append(ImageClassification(
                    category=ImageCategory.UNKNOWN,
                    description=f"分类失败: {str(result)}",
                    confidence="low",
                    chapter_context=images[i].get("chapter", "")
                ))
            else:
                final_results.append(result)

        return final_results

    async def _classify_single_image(
        self,
        vision_config,
        image_base64: str,
        context_text: str = "",
        chapter_name: str = ""
    ) -> ImageClassification:
        """Classify a single image using pre-fetched vision config"""
        try:
            # Prepare chapter info
            chapter_info = f"图片所在章节：{chapter_name}\n" if chapter_name else ""

            # Prepare the prompt with context
            prompt = self.CLASSIFICATION_PROMPT.format(
                chapter_info=chapter_info,
                context=context_text[:2000] if context_text else "（无上下文）"
            )

            # Call vision API
            result = await self._call_vision_api(
                api_url=vision_config.api_url,
                api_key=vision_config.api_key,
                model_name=vision_config.model_name,
                image_base64=image_base64,
                prompt=prompt
            )

            # Parse the response
            return self._parse_classification(result, chapter_name)

        except Exception as e:
            return ImageClassification(
                category=ImageCategory.UNKNOWN,
                description=f"分类失败: {str(e)}",
                confidence="low",
                chapter_context=chapter_name
            )

    async def _call_vision_api(
        self,
        api_url: str,
        api_key: str,
        model_name: str,
        image_base64: str,
        prompt: str
    ) -> str:
        """Call the vision API with image and prompt"""
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        # Support both base64 and HTTP URLs
        if image_base64.startswith("http://") or image_base64.startswith("https://"):
            # Already a valid URL (OSS URL)
            image_url = image_base64
        elif not image_base64.startswith("data:"):
            # Raw base64 data, add prefix
            image_url = f"data:image/png;base64,{image_base64}"
        else:
            # Already has data: prefix
            image_url = image_base64

        payload = {
            "model": model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": image_url
                            }
                        }
                    ]
                }
            ],
            "max_tokens": 500,
            "temperature": 0.3
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{api_url}/chat/completions",
                headers=headers,
                json=payload
            )

            if response.status_code != 200:
                raise Exception(f"Vision API error: {response.status_code} - {response.text}")

            result = response.json()
            return result.get("choices", [{}])[0].get("message", {}).get("content", "")

    def _parse_classification(
        self,
        response_text: str,
        chapter_name: str = ""
    ) -> ImageClassification:
        """Parse the LLM response into ImageClassification"""
        import json
        import re

        try:
            # Try to extract JSON from response
            json_match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
            else:
                data = json.loads(response_text)

            category_str = data.get("category", "unknown").lower()
            category = ImageCategory(category_str) if category_str in [e.value for e in ImageCategory] else ImageCategory.UNKNOWN

            return ImageClassification(
                category=category,
                description=data.get("description", "未知"),
                confidence=data.get("confidence", "low"),
                related_entity=data.get("related_entity"),
                chapter_context=chapter_name
            )

        except (json.JSONDecodeError, ValueError) as e:
            return ImageClassification(
                category=ImageCategory.UNKNOWN,
                description=f"解析失败: {response_text[:100]}",
                confidence="low",
                chapter_context=chapter_name
            )


# Singleton instance
module_image_classifier = ModuleImageClassifier()
