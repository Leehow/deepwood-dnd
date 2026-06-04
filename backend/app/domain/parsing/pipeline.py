"""
模组解析流程 - 6步异步处理
"""
import asyncio
import base64
import logging
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable, List, Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession

from .schemas import ParseResult, ProcessedImage, TocEntry, OCRImage, OCRTable
from .oss_storage import get_oss_storage
from .toc_extractor import TocExtractor
from app.services.langextract_service import infer_heading_levels, rewrite_markdown_headings
from app.services.mineru_ocr_service import MinerUOCRService
from app.services.mistral_ocr_service import get_ocr_service
from app.services.module_image_classifier import ModuleImageClassifier
from app.services.module_parse_flow_service import (
    normalize_ocr_conversion_result,
    resolve_ocr_provider,
)
from app.services.ai_model_service import ai_model_service
from app.services.monster_item_extractor import monster_item_extractor
from app.models.ai_settings import ModelType
from app.models.raw_module_file import RawModuleFile
from app.models.parsed_module import ParsedModule

logger = logging.getLogger(__name__)

# 进度回调类型
ProgressCallback = Callable[[str, str, int], None]

# 全局取消令牌注册表: {task_id: asyncio.Event}
_cancel_tokens: Dict[str, asyncio.Event] = {}


def register_cancel_token(task_id: str) -> asyncio.Event:
    """注册一个取消令牌，返回 Event 对象"""
    token = asyncio.Event()
    _cancel_tokens[task_id] = token
    return token


def cancel_task(task_id: str) -> bool:
    """触发取消，如果找到令牌返回 True"""
    token = _cancel_tokens.get(task_id)
    if token:
        token.set()
        return True
    return False


def cleanup_cancel_token(task_id: str):
    """清理取消令牌"""
    _cancel_tokens.pop(task_id, None)


class CancelledError(Exception):
    """解析被用户取消"""
    pass


class ModuleParsingPipeline:
    """
    模组解析流程

    7步流程：
    1. 上传PDF (已完成)
    2. Mistral OCR -> markdown + 图片
    3. 图片上传OSS (webp + 缩略图)
    4. 图片分类 (Vision API)
    5. TOC提取 (正则 + LLM)
    6. 怪物/物品提取 (LLM)
    7. 存数据库
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.ocr_service = get_ocr_service()
        self.image_classifier = ModuleImageClassifier()
        self.toc_extractor = TocExtractor(db)

    async def run(
        self,
        raw_file: RawModuleFile,
        pdf_path: Path,
        progress_callback: Optional[ProgressCallback] = None,
        skip_image_classify: bool = False,
        cancel_token: Optional[asyncio.Event] = None
    ) -> ParseResult:
        """
        执行完整解析流程

        Args:
            raw_file: RawModuleFile数据库记录
            pdf_path: PDF文件路径
            progress_callback: 进度回调 (stage, message, percent)
            cancel_token: asyncio.Event，被 set() 时中止解析

        Returns:
            ParseResult
        """
        result = ParseResult()
        module_id = str(raw_file.id)

        def check_cancelled():
            if cancel_token and cancel_token.is_set():
                raise CancelledError("用户手动停止解析")

        async def update_progress(stage: str, message: str, percent: int):
            check_cancelled()
            if progress_callback:
                try:
                    await progress_callback(stage, message, percent)
                except Exception as e:
                    logger.warning(f"进度回调失败: {e}")

        try:
            # ========== Step 2: Mistral OCR ==========
            await update_progress("ocr", "📄 PDF解析中...", 10)
            raw_file.status = "converting"
            await self.db.commit()

            ocr_result = normalize_ocr_conversion_result(
                await self.ocr_service.convert_pdf_to_markdown(
                    pdf_path=pdf_path,
                    output_dir=pdf_path.parent
                )
            )

            # MistralOCRService返回markdown_content，不是success
            if not ocr_result.get("markdown_content") and not ocr_result.get("ocr_result"):
                raise RuntimeError(f"OCR失败: 无法解析PDF内容")

            result.markdown = ocr_result.get("markdown_content", "")
            raw_file.markdown_content = result.markdown
            raw_file.status = "ocr_complete"
            raw_file.ocr_provider = resolve_ocr_provider(ocr_result)

            # 提取图片数据
            ocr_images = self._extract_ocr_images(ocr_result)
            raw_file.ocr_images = [img.__dict__ for img in ocr_images]

            # 提取表格数据
            ocr_tables = self._extract_ocr_tables(ocr_result)
            result.tables = ocr_tables
            await self.db.commit()

            logger.info(f"OCR完成: {len(result.markdown)}字符, {len(ocr_images)}张图片, {len(ocr_tables)}张表格")

            check_cancelled()

            # ========== Step 2.5: bbox 标题层级推断 (MinerU only) ==========
            headings_inferred = False
            content_list = (ocr_result.get("ocr_result") or {}).get("content_list", [])
            if content_list and raw_file.ocr_provider == "mineru":
                await update_progress("heading_infer", "🔤 推断标题层级...", 25)
                try:
                    title_blocks = MinerUOCRService.extract_title_blocks(content_list)
                    if title_blocks:
                        toc_config = await ai_model_service.get_config_for_usage(
                            self.db, "module_refresh_toc"
                        )
                        if not toc_config:
                            toc_config = await ai_model_service.get_model_config(
                                self.db, ModelType.ADVANCED
                            )
                        level_results = await infer_heading_levels(
                            title_blocks,
                            api_url=toc_config.api_url,
                            api_key=toc_config.api_key,
                            model=toc_config.model_name,
                        )
                        if level_results:
                            result.markdown = rewrite_markdown_headings(
                                result.markdown, title_blocks, level_results
                            )
                            raw_file.markdown_content = result.markdown
                            headings_inferred = True
                            logger.info("bbox 标题层级推断成功，已回写 markdown")
                except Exception as e:
                    logger.warning("bbox 标题层级推断失败，后续 TOC 将使用 LLM: %s", e)

            raw_file.headings_inferred = headings_inferred
            await self.db.commit()

            # ========== Step 3: 图片上传OSS ==========
            await update_progress("upload", f"📤 上传{len(ocr_images)}张图片...", 30)

            processed_images = await self._upload_images_to_oss(
                ocr_images, module_id, update_progress
            )
            result.images = processed_images
            logger.info(f"OSS上传完成: {len(processed_images)}张")

            # 清除base64数据，只保留元数据（节省数据库存储）
            # 构建oss_url映射
            oss_url_map = {img.image_id: (img.oss_url, img.thumbnail_url) for img in processed_images}
            cleaned_ocr_images = []
            for img in (raw_file.ocr_images or []):
                img_id = img.get("image_id", "")
                urls = oss_url_map.get(img_id, ("", ""))
                cleaned_ocr_images.append({
                    "image_id": img_id,
                    "page_index": img.get("page_index"),
                    "context": img.get("context", ""),
                    "oss_url": urls[0],
                    "thumbnail_url": urls[1],
                    # 不再保存 image_base64
                })
            raw_file.ocr_images = cleaned_ocr_images
            await self.db.commit()
            logger.info(f"已清除OCR图片base64数据，节省存储空间")

            # 替换markdown中的base64图片引用为OSS URL
            result.markdown = self._replace_image_refs_with_oss_urls(
                result.markdown, oss_url_map
            )
            raw_file.markdown_content = result.markdown
            await self.db.commit()
            logger.info(f"已替换markdown中的图片引用为OSS URL")

            check_cancelled()

            # 清理本地图片文件（OSS上传成功后）
            all_uploaded = all(url[0] for url in oss_url_map.values())
            if all_uploaded and oss_url_map:
                # converted 目录在 RAW_FILES_DIR / {file_id} / converted
                images_dir = pdf_path.parent / str(raw_file.id) / "converted" / "images"
                if images_dir.exists():
                    shutil.rmtree(images_dir)
                    logger.info(f"已清理本地图片目录: {images_dir}")

            # ========== Step 4: 图片分类 ==========
            if skip_image_classify:
                await update_progress("classify", "⏭️ 跳过图片分类", 55)
                logger.info(f"跳过图片分类，共{len(processed_images)}张图片")
            else:
                await update_progress("classify", f"🔍 分类{len(processed_images)}张图片...", 50)
                result.images = await self._classify_images(
                    processed_images, ocr_images, update_progress
                )
                logger.info(f"图片分类完成: {len(result.images)}张")

            # 保存分类结果
            raw_file.image_classifications = [img.to_dict() for img in result.images]
            await self.db.commit()

            check_cancelled()

            # ========== Step 5: TOC提取 ==========
            await update_progress("toc", "📑 提取目录结构...", 70)

            # 获取TOC刷新模型配置（与刷新TOC按钮使用相同配置）
            toc_config = await ai_model_service.get_config_for_usage(self.db, "module_refresh_toc")
            if not toc_config:
                # 回退到 ADVANCED 模型
                toc_config = await ai_model_service.get_model_config(self.db, ModelType.ADVANCED)

            toc_entries, llm_status = await self.toc_extractor.extract_and_reorganize(
                result.markdown,
                api_url=toc_config.api_url,
                api_key=toc_config.api_key,
                model=toc_config.model_name,
                use_llm=not headings_inferred,
            )
            result.toc = toc_entries
            logger.info(f"TOC LLM状态: {llm_status}")
            logger.info(f"TOC提取完成: {len(toc_entries)}个顶级章节")

            # 关联图片与章节
            self._associate_images_with_chapters(result.images, result.toc, result.markdown)

            # 关联表格与章节
            self._associate_tables_with_chapters(result.tables, result.toc, result.markdown)

            check_cancelled()

            # ========== Step 6: 怪物/物品提取 ==========
            await update_progress("extract", "👹 提取怪物和物品...", 75)

            # 先保存 TOC 到数据库（monster_item_extractor 需要从数据库读取 TOC）
            temp_module = await self._save_to_database(raw_file, result)

            # 提取怪物
            async def monster_progress(msg: str, pct: int):
                await update_progress("extract", f"👹 {msg}", 75 + int(pct * 0.07))

            monster_result = await monster_item_extractor.extract_monsters_from_toc(
                self.db, temp_module.module_id, monster_progress
            )
            result.monsters = monster_result.get("monsters", [])
            logger.info(f"怪物提取完成: {len(result.monsters)}个")

            check_cancelled()

            # 提取物品
            async def item_progress(msg: str, pct: int):
                await update_progress("extract", f"⚔️ {msg}", 82 + int(pct * 0.07))

            item_result = await monster_item_extractor.extract_items_from_toc(
                self.db, temp_module.module_id, item_progress
            )
            result.items = item_result.get("items", [])
            logger.info(f"物品提取完成: {len(result.items)}个")

            # ========== Step 7: 完成 ==========
            await update_progress("save", "💾 保存结果...", 90)

            # 不需要再次保存，monster_item_extractor 已经更新了数据库
            # 使用之前保存的 temp_module
            parsed_module = temp_module

            raw_file.status = "parsed"
            raw_file.parsed_module_id = parsed_module.module_id
            raw_file.parsed_at = datetime.utcnow()
            await self.db.commit()

            # ========== Step 8: 后台异步 Embedding ==========
            # 启动后台任务进行向量化，不阻塞主流程
            asyncio.create_task(
                self._background_embedding(parsed_module.module_id)
            )

            await update_progress("complete", "✅ 解析完成", 100)
            logger.info(f"模组解析完成: {parsed_module.module_id}")

            return result

        except CancelledError as e:
            logger.info(f"解析被用户取消: {e}")
            result.errors.append(str(e))
            raw_file.status = "error"
            raw_file.error_message = str(e)
            await self.db.commit()
            raise

        except Exception as e:
            logger.error(f"解析失败: {e}")
            result.errors.append(str(e))
            raw_file.status = "error"
            raw_file.error_message = str(e)
            await self.db.commit()
            raise

    async def _background_embedding(self, module_id: str):
        """后台异步执行模组向量化"""
        from app.db.session import async_session_factory
        from app.services.module_embedding_service import ModuleEmbeddingService

        logger.info(f"开始后台向量化模组: {module_id}")

        try:
            # 创建新的数据库 session（后台任务需要独立的 session）
            async with async_session_factory() as db:
                embedding_service = ModuleEmbeddingService(db)

                async def log_progress(msg: str, pct: int):
                    logger.info(f"[Embedding {module_id}] {msg} ({pct}%)")

                result = await embedding_service.embed_module(
                    module_id,
                    progress_callback=log_progress
                )
                logger.info(f"模组向量化完成: {module_id}, {result}")

        except Exception as e:
            logger.error(f"模组向量化失败 {module_id}: {e}")

    def _extract_ocr_images(self, ocr_result: Dict) -> List[OCRImage]:
        """从OCR结果提取图片"""
        images = []
        # MistralOCRService返回的ocr_result里面嵌套了实际的ocr_result
        raw_ocr = ocr_result.get("ocr_result", ocr_result)
        pages = raw_ocr.get("pages", [])

        for page_idx, page in enumerate(pages):
            page_images = page.get("images", [])
            markdown = page.get("markdown", "")

            for img in page_images:
                image_id = img.get("id", f"img_{page_idx}_{len(images)}")
                image_base64 = img.get("image_base64", "")

                if image_base64:
                    # 提取图片周围的上下文
                    context = self._extract_image_context(markdown, image_id)

                    images.append(OCRImage(
                        image_id=image_id,
                        image_base64=image_base64,
                        page_index=page_idx,
                        context=context
                    ))

        return images

    def _extract_image_context(self, markdown: str, image_id: str) -> str:
        """提取图片周围的文字上下文"""
        # 简单实现：返回markdown的前500字符作为上下文
        return markdown[:500] if markdown else ""

    def _extract_ocr_tables(self, ocr_result: Dict) -> List[OCRTable]:
        """从OCR结果或markdown内容提取表格"""
        tables = []

        # 方法1: 尝试从OCR结果的pages[].tables[]提取
        raw_ocr = ocr_result.get("ocr_result", ocr_result)
        pages = raw_ocr.get("pages", [])

        for page_idx, page in enumerate(pages):
            page_tables = page.get("tables", [])
            for tbl in page_tables:
                table_id = tbl.get("id", f"tbl_{page_idx}_{len(tables)}")
                content = tbl.get("markdown", "") or tbl.get("html", "")
                if content:
                    tables.append(OCRTable(
                        table_id=table_id,
                        content=content,
                        page_index=page_idx
                    ))

        # 方法2: 如果没有找到表格，从markdown内容中提取
        if not tables:
            markdown_content = ocr_result.get("markdown_content", "")
            if markdown_content:
                tables = self._extract_tables_from_markdown(markdown_content)

        logger.info(f"提取到 {len(tables)} 个表格")
        return tables

    def _extract_tables_from_markdown(self, markdown: str) -> List[OCRTable]:
        """从markdown内容中提取表格"""
        import re
        tables = []
        lines = markdown.split('\n')

        table_lines = []
        in_table = False
        table_start_line = 0

        for i, line in enumerate(lines):
            stripped = line.strip()
            # 检测表格行（以|开头或包含|---|的行）
            is_table_line = stripped.startswith('|') or re.match(r'^\|[\s\-:|]+\|$', stripped)

            if is_table_line:
                if not in_table:
                    in_table = True
                    table_start_line = i
                table_lines.append(line)
            else:
                if in_table and table_lines:
                    # 只保存有实际内容的表格（至少3行：标题+分隔+数据）
                    if len(table_lines) >= 3:
                        table_content = '\n'.join(table_lines)
                        tables.append(OCRTable(
                            table_id=f"table_{len(tables)+1}",
                            content=table_content,
                            line_number=table_start_line + 1
                        ))
                    table_lines = []
                    in_table = False

        # 处理最后一个表格
        if in_table and table_lines and len(table_lines) >= 3:
            table_content = '\n'.join(table_lines)
            tables.append(OCRTable(
                table_id=f"table_{len(tables)+1}",
                content=table_content,
                line_number=table_start_line + 1
            ))

        return tables

    def _replace_image_refs_with_oss_urls(
        self,
        markdown: str,
        oss_url_map: Dict[str, tuple]
    ) -> str:
        """
        替换markdown中的图片引用为OSS URL

        Args:
            markdown: 原始markdown内容
            oss_url_map: {image_id: (oss_url, thumbnail_url)}

        Returns:
            替换后的markdown
        """
        import re

        result = markdown
        replaced_count = 0

        # 允许 ] 和 ( 之间有换行/空白，用 \s* 匹配
        for image_id, (oss_url, thumbnail_url) in oss_url_map.items():
            if not oss_url:
                continue

            # 模式1: ![alt](image_id) - 支持跨行
            pattern1 = re.compile(
                rf'!\[([^\]]*)\]\s*\({re.escape(image_id)}\)',
                re.IGNORECASE
            )
            if pattern1.search(result):
                result = pattern1.sub(f'![\\1]({oss_url})', result)
                replaced_count += 1
                continue

            # 模式2: ![image_id](data:image/...) - base64内联，支持跨行
            pattern2 = re.compile(
                rf'!\[{re.escape(image_id)}\]\s*\(data:image/[^)]+\)',
                re.IGNORECASE | re.DOTALL
            )
            if pattern2.search(result):
                result = pattern2.sub(f'![{image_id}]({oss_url})', result)
                replaced_count += 1
                continue

            # 模式3: ![含image_id的alt](data:image/...) - alt包含文件名
            esc_id = re.escape(image_id)
            # 去掉扩展名也尝试匹配 (img-0.jpeg -> img-0)
            base_id = re.escape(image_id.rsplit('.', 1)[0]) if '.' in image_id else esc_id
            pattern3 = re.compile(
                rf'!\[([^\]]*(?:{esc_id}|{base_id})[^\]]*)\]\s*\(data:image/[^)]+\)',
                re.IGNORECASE | re.DOTALL
            )
            if pattern3.search(result):
                result = pattern3.sub(f'![{image_id}]({oss_url})', result)
                replaced_count += 1
                continue

        # 清理剩余的base64图片（支持跨行格式）
        result = re.sub(
            r'!\[([^\]]*)\]\s*\(data:image/[^)]+\)',
            r'![\1]()',
            result,
            flags=re.DOTALL
        )

        logger.info(f"替换了 {replaced_count} 个图片引用")
        return result

    async def _upload_images_to_oss(
        self,
        ocr_images: List[OCRImage],
        module_id: str,
        progress_callback: ProgressCallback
    ) -> List[ProcessedImage]:
        """上传图片到OSS"""
        processed = []

        try:
            oss = get_oss_storage()
        except Exception as e:
            logger.warning(f"OSS不可用，跳过上传: {e}")
            # 返回空URL的图片列表
            for img in ocr_images:
                processed.append(ProcessedImage(
                    image_id=img.image_id,
                    oss_url="",
                    thumbnail_url="",
                    page_index=img.page_index
                ))
            return processed

        total = len(ocr_images)
        for i, img in enumerate(ocr_images):
            try:
                # 解码base64
                if img.image_base64.startswith("data:image/"):
                    _, encoded = img.image_base64.split(",", 1)
                else:
                    encoded = img.image_base64

                image_data = base64.b64decode(encoded)

                # 上传
                result = await oss.upload_image_with_thumbnail_async(
                    image_data=image_data,
                    module_id=module_id,
                    image_id=img.image_id
                )

                if result:
                    oss_url, thumbnail_url = result
                    processed.append(ProcessedImage(
                        image_id=img.image_id,
                        oss_url=oss_url,
                        thumbnail_url=thumbnail_url,
                        page_index=img.page_index
                    ))
                else:
                    processed.append(ProcessedImage(
                        image_id=img.image_id,
                        oss_url="",
                        thumbnail_url="",
                        page_index=img.page_index
                    ))

            except Exception as e:
                logger.warning(f"图片上传失败 {img.image_id}: {e}")
                processed.append(ProcessedImage(
                    image_id=img.image_id,
                    oss_url="",
                    thumbnail_url="",
                    page_index=img.page_index
                ))

            # 更新进度
            percent = 30 + int((i + 1) / total * 20)  # 30-50%
            await progress_callback("upload", f"📤 上传图片 {i+1}/{total}", percent)

        return processed

    async def _classify_images(
        self,
        processed_images: List[ProcessedImage],
        ocr_images: List[OCRImage],
        progress_callback: ProgressCallback
    ) -> List[ProcessedImage]:
        """分类图片"""
        # 构建image_id -> context映射
        context_map = {img.image_id: img.context for img in ocr_images}
        base64_map = {img.image_id: img.image_base64 for img in ocr_images}

        total = len(processed_images)
        for i, img in enumerate(processed_images):
            try:
                context = context_map.get(img.image_id, "")
                image_base64 = base64_map.get(img.image_id, "")

                if image_base64:
                    classification = await self.image_classifier.classify_image(
                        db=self.db,
                        image_base64=image_base64,
                        context_text=context
                    )
                    img.category = classification.category.value
                    img.description = classification.description

            except Exception as e:
                logger.warning(f"图片分类失败 {img.image_id}: {e}")
                img.category = "unknown"
                img.description = ""

            # 更新进度
            percent = 50 + int((i + 1) / total * 20)  # 50-70%
            await progress_callback("classify", f"🔍 分类图片 {i+1}/{total}", percent)

        return processed_images

    def _associate_images_with_chapters(
        self,
        images: List[ProcessedImage],
        toc: List[TocEntry],
        markdown: str
    ) -> None:
        """
        将图片与章节关联

        根据图片在markdown中出现的位置，确定其所属章节
        """
        import re

        # 1. 找到每个图片在markdown中的行号
        lines = markdown.split('\n')
        image_pattern = r'!\[([^\]]*)\]\(([^)]+)\)'

        image_line_map = {}  # image_id -> line_number
        for line_num, line in enumerate(lines, 1):
            matches = re.finditer(image_pattern, line)
            for match in matches:
                # 从引用中提取image_id
                img_ref = match.group(1) or match.group(2)
                # 处理各种格式: img-0.jpeg, data:image/jpeg;base64,...
                if img_ref.startswith('data:'):
                    # base64格式，用alt text
                    img_id = match.group(1)
                else:
                    img_id = img_ref
                if img_id:
                    image_line_map[img_id] = line_num

        # 2. 扁平化TOC获取所有章节及其行号范围
        def flatten_toc(entries: List[TocEntry], result: List = None) -> List:
            if result is None:
                result = []
            for entry in entries:
                result.append(entry)
                if entry.children:
                    flatten_toc(entry.children, result)
            return result

        flat_toc = flatten_toc(toc)
        # 按line_number排序
        flat_toc.sort(key=lambda x: x.line_number)

        # 3. 为每个图片找到所属章节
        for img in images:
            img_line = image_line_map.get(img.image_id, 0)
            img.line_number = img_line

            if img_line > 0:
                # 找到该行属于哪个章节（最近的前一个章节）
                chapter = None
                for entry in flat_toc:
                    if entry.line_number <= img_line:
                        chapter = entry
                    else:
                        break

                if chapter:
                    img.chapter_title = chapter.title

        logger.info(f"图片章节关联完成: {len(images)} 张图片")

    def _associate_tables_with_chapters(
        self,
        tables: List[OCRTable],
        toc: List[TocEntry],
        markdown: str
    ) -> None:
        """
        将表格与章节关联

        根据表格引用在markdown中出现的位置，确定其所属章节
        """
        import re

        # 1. 找到每个表格在markdown中的行号
        lines = markdown.split('\n')
        # 表格引用格式: [tbl-0.md](tbl-0.md) 或 [tbl-0.html](tbl-0.html)
        table_pattern = r'\[(tbl-\d+\.(?:md|html))\]'

        table_line_map = {}  # table_id -> line_number
        for line_num, line in enumerate(lines, 1):
            matches = re.finditer(table_pattern, line)
            for match in matches:
                tbl_id = match.group(1)
                if tbl_id:
                    table_line_map[tbl_id] = line_num

        # 2. 扁平化TOC获取所有章节及其行号范围
        def flatten_toc(entries: List[TocEntry], result: List = None) -> List:
            if result is None:
                result = []
            for entry in entries:
                result.append(entry)
                if entry.children:
                    flatten_toc(entry.children, result)
            return result

        flat_toc = flatten_toc(toc)
        flat_toc.sort(key=lambda x: x.line_number)

        # 3. 为每个表格找到所属章节
        for tbl in tables:
            tbl_line = table_line_map.get(tbl.table_id, 0)
            tbl.line_number = tbl_line

            if tbl_line > 0:
                chapter = None
                for entry in flat_toc:
                    if entry.line_number <= tbl_line:
                        chapter = entry
                    else:
                        break

                if chapter:
                    tbl.chapter_title = chapter.title

        logger.info(f"表格章节关联完成: {len(tables)} 个表格")

    async def _save_to_database(
        self,
        raw_file: RawModuleFile,
        result: ParseResult
    ) -> ParsedModule:
        """保存到数据库"""
        module_id = str(uuid.uuid4())

        parsed_module = ParsedModule(
            module_id=module_id,
            title=raw_file.title,
            chapters_count=len(result.toc),
            images_count=len(result.images),
            tables_count=len(result.tables),
            toc=[t.to_dict() for t in result.toc],
            images=[i.to_dict() for i in result.images],
            tables=[t.to_dict() for t in result.tables],
            source_file_id=str(raw_file.id),
            created_by=raw_file.created_by,
            parsed_date=datetime.utcnow()
        )

        self.db.add(parsed_module)
        await self.db.commit()
        await self.db.refresh(parsed_module)

        return parsed_module
