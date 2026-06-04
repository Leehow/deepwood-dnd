"""
MinerU PDF to Markdown conversion service.
"""
import asyncio
import base64
import json
import logging
import shutil
import uuid
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

MINERU_API_TIMEOUT = httpx.Timeout(connect=20.0, read=120.0, write=60.0, pool=60.0)
MINERU_DOWNLOAD_TIMEOUT = httpx.Timeout(connect=20.0, read=300.0, write=60.0, pool=60.0)


class MinerUOCRService:
    """Service for converting PDF to Markdown using MinerU."""

    def __init__(self):
        self.base_url = settings.MINERU_API_URL.rstrip("/")
        self.api_key = settings.MINERU_API_KEY
        self.model_version = settings.MINERU_MODEL_VERSION or "pipeline"
        self.language = settings.MINERU_LANGUAGE or "ch"
        if not self.api_key:
            raise ValueError("MINERU_API_KEY not found in environment variables")

    async def convert_pdf_to_markdown(
        self,
        pdf_path: Path,
        output_dir: Path,
        progress_callback: Optional[Callable[[str, int], None]] = None,
    ) -> Dict[str, Any]:
        try:
            return await self._convert_pdf_to_markdown(
                pdf_path,
                output_dir,
                progress_callback=progress_callback,
            )
        except Exception as exc:
            if settings.DOC2X_API_KEY:
                return await self._fallback_to_doc2x(
                    pdf_path,
                    output_dir,
                    exc,
                    progress_callback=progress_callback,
                )
            if self._local_pdf_text_fallback_available():
                return await self._fallback_to_local_pdf_text(
                    pdf_path,
                    output_dir,
                    exc,
                    progress_callback=progress_callback,
                )
            raise Exception(f"MinerU OCR conversion failed: {str(exc)}")

    async def _convert_pdf_to_markdown(
        self,
        pdf_path: Path,
        output_dir: Path,
        progress_callback: Optional[Callable[[str, int], None]] = None,
    ) -> Dict[str, Any]:
        output_dir.mkdir(parents=True, exist_ok=True)
        request_token = f"dw-{uuid.uuid4().hex[:12]}"
        data_id = f"{pdf_path.stem[:40]}-{uuid.uuid4().hex[:8]}"

        if progress_callback:
            await progress_callback("Getting MinerU upload URL...", 5)

        batch_id, upload_url = await self._create_batch_upload(
            filename=pdf_path.name,
            data_id=data_id,
            request_token=request_token,
        )

        if progress_callback:
            await progress_callback("Uploading PDF to MinerU...", 10)

        await self._upload_file(pdf_path, upload_url)

        if progress_callback:
            await progress_callback("Processing with MinerU OCR...", 15)

        extract_result = await self._poll_extract_result(
            batch_id=batch_id,
            request_token=request_token,
            progress_callback=progress_callback,
        )

        if progress_callback:
            await progress_callback("Downloading MinerU output...", 90)

        markdown_path, images_dir, content_list, markdown_content = await self._download_and_extract(
            extract_result["full_zip_url"],
            output_dir,
        )

        ocr_result = self._build_ocr_result(
            markdown_content=markdown_content,
            content_list=content_list,
            output_dir=output_dir,
        )

        if progress_callback:
            await progress_callback("MinerU conversion complete!", 100)

        return {
            "markdown_path": str(markdown_path),
            "images_dir": str(images_dir) if images_dir else None,
            "pages_count": len(ocr_result.get("pages", [])),
            "ocr_result": ocr_result,
            "markdown_content": markdown_content,
            "ocr_provider": "mineru",
        }

    async def _create_batch_upload(
        self,
        filename: str,
        data_id: str,
        request_token: str,
    ) -> tuple[str, str]:
        payload = {
            "files": [
                {
                    "name": filename,
                    "is_ocr": True,
                    "data_id": data_id,
                }
            ],
            "model_version": self.model_version,
            "language": self.language,
            "enable_formula": True,
            "enable_table": True,
        }

        async with httpx.AsyncClient(timeout=MINERU_API_TIMEOUT) as client:
            response = await client.post(
                f"{self.base_url}/file-urls/batch",
                headers=self._build_headers(request_token, include_content_type=True),
                json=payload,
            )

        response.raise_for_status()
        data = response.json()
        if data.get("code") != 0:
            raise Exception(f"MinerU file upload init failed: {data}")

        batch_id = data["data"]["batch_id"]
        upload_url = data["data"]["file_urls"][0]
        return batch_id, upload_url

    async def _upload_file(self, pdf_path: Path, upload_url: str) -> None:
        pdf_bytes = pdf_path.read_bytes()
        async with httpx.AsyncClient(timeout=MINERU_DOWNLOAD_TIMEOUT) as client:
            response = await client.put(upload_url, content=pdf_bytes)

        response.raise_for_status()

    async def _poll_extract_result(
        self,
        batch_id: str,
        request_token: str,
        progress_callback: Optional[Callable[[str, int], None]] = None,
    ) -> Dict[str, Any]:
        headers = self._build_headers(request_token)
        async with httpx.AsyncClient(timeout=MINERU_API_TIMEOUT) as client:
            for attempt in range(90):
                response = await client.get(
                    f"{self.base_url}/extract-results/batch/{batch_id}",
                    headers=headers,
                )
                response.raise_for_status()

                data = response.json()
                if data.get("code") != 0:
                    raise Exception(f"MinerU batch poll failed: {data}")

                item = data["data"]["extract_result"][0]
                state = item.get("state")

                if state == "done":
                    return item

                if state == "failed":
                    raise Exception(f"MinerU extraction failed: {item.get('err_msg') or item}")

                if progress_callback:
                    mapped_progress = min(85, 15 + attempt)
                    message = "MinerU is preparing the file..." if state == "waiting-file" else "MinerU is parsing the PDF..."
                    await progress_callback(message, mapped_progress)

                await asyncio.sleep(5)

        raise TimeoutError(f"Timed out waiting for MinerU batch {batch_id}")

    async def _download_and_extract(
        self,
        download_url: str,
        output_dir: Path,
    ) -> tuple[Path, Optional[Path], List[Dict[str, Any]], str]:
        zip_path = output_dir / "temp_export.zip"
        extract_dir = output_dir / "extract_tmp"

        if extract_dir.exists():
            shutil.rmtree(extract_dir)
        extract_dir.mkdir(parents=True, exist_ok=True)

        async with httpx.AsyncClient(timeout=MINERU_DOWNLOAD_TIMEOUT) as client:
            response = await client.get(download_url)
        response.raise_for_status()
        zip_path.write_bytes(response.content)

        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(extract_dir)

        markdown_source = extract_dir / "full.md"
        if not markdown_source.exists():
            md_candidates = sorted(extract_dir.rglob("*.md"))
            if not md_candidates:
                raise Exception("MinerU export does not contain a markdown file")
            markdown_source = md_candidates[0]

        markdown_content = markdown_source.read_text(encoding="utf-8", errors="replace")
        final_md_path = output_dir / "converted.md"
        final_md_path.write_text(markdown_content, encoding="utf-8")

        final_images_dir = None
        images_source = extract_dir / "images"
        if images_source.exists():
            final_images_dir = output_dir / "images"
            if final_images_dir.exists():
                shutil.rmtree(final_images_dir)
            shutil.copytree(images_source, final_images_dir)

        content_list: List[Dict[str, Any]] = []
        content_files = sorted(extract_dir.glob("*_content_list.json"))
        if content_files:
            content_list = json.loads(content_files[0].read_text(encoding="utf-8"))

        zip_path.unlink(missing_ok=True)
        shutil.rmtree(extract_dir, ignore_errors=True)

        return final_md_path, final_images_dir, content_list, markdown_content

    def _build_ocr_result(
        self,
        markdown_content: str,
        content_list: List[Dict[str, Any]],
        output_dir: Path,
    ) -> Dict[str, Any]:
        page_map: dict[int, Dict[str, Any]] = defaultdict(
            lambda: {"markdown": "", "images": [], "tables": []}
        )

        for item in content_list:
            page_idx = item.get("page_idx", 0)
            page = page_map[page_idx]

            item_type = item.get("type")
            if item_type == "text":
                text = item.get("text", "").strip()
                if text:
                    if page["markdown"]:
                        page["markdown"] += "\n"
                    page["markdown"] += text
                continue

            if item_type != "image":
                continue

            image_id = item.get("img_path")
            if not image_id:
                continue

            image_path = output_dir / image_id
            if not image_path.exists():
                continue

            image_base64 = base64.b64encode(image_path.read_bytes()).decode("utf-8")
            page["images"].append(
                {
                    "id": image_id,
                    "image_base64": image_base64,
                    "image_caption": item.get("image_caption", []),
                    "image_footnote": item.get("image_footnote", []),
                }
            )

        pages = [
            {
                "index": page_idx,
                "markdown": page_data["markdown"],
                "images": page_data["images"],
                "tables": page_data["tables"],
            }
            for page_idx, page_data in sorted(page_map.items())
        ]

        return {
            "provider": "mineru",
            "pages": pages,
            "content_list": content_list,
            "markdown": markdown_content,
        }

    def extract_images_with_context(
        self,
        ocr_result: Dict[str, Any],
        markdown_content: str,
    ) -> List[Dict[str, Any]]:
        content_list = ocr_result.get("content_list", [])
        page_images: dict[int, dict[str, str]] = {}

        for page in ocr_result.get("pages", []):
            image_map = {
                img["id"]: img["image_base64"]
                for img in page.get("images", [])
                if img.get("id") and img.get("image_base64")
            }
            page_images[page.get("index", 0)] = image_map

        images_with_context: List[Dict[str, Any]] = []
        for item in content_list:
            if item.get("type") != "image":
                continue

            page_idx = item.get("page_idx", 0)
            image_id = item.get("img_path")
            if not image_id:
                continue

            image_base64 = page_images.get(page_idx, {}).get(image_id)
            if not image_base64:
                continue

            context = self._extract_image_context_from_content_list(
                content_list=content_list,
                page_idx=page_idx,
                image_id=image_id,
                markdown_content=markdown_content,
            )
            images_with_context.append(
                {
                    "image_id": image_id,
                    "image_base64": image_base64,
                    "context": context,
                    "page_index": page_idx,
                }
            )

        return images_with_context

    def _extract_image_context_from_content_list(
        self,
        content_list: List[Dict[str, Any]],
        page_idx: int,
        image_id: str,
        markdown_content: str,
        window_size: int = 3,
    ) -> str:
        page_items = [item for item in content_list if item.get("page_idx", 0) == page_idx]
        for index, item in enumerate(page_items):
            if item.get("type") == "image" and item.get("img_path") == image_id:
                window = page_items[max(0, index - window_size): index + window_size + 1]
                parts: List[str] = []
                for candidate in window:
                    if candidate.get("type") == "text" and candidate.get("text"):
                        parts.append(candidate["text"])
                    if candidate.get("type") == "equation" and candidate.get("text"):
                        parts.append(candidate["text"])
                    if candidate.get("type") == "discarded" and candidate.get("text"):
                        parts.append(candidate["text"])
                    if candidate.get("type") == "image":
                        parts.extend(candidate.get("image_caption", []))
                        parts.extend(candidate.get("image_footnote", []))
                context = "\n".join(part.strip() for part in parts if part and part.strip()).strip()
                if context:
                    return context
                break

        return self._extract_image_context(markdown_content, image_id)

    def _extract_image_context(
        self,
        markdown: str,
        image_id: str,
        context_chars: int = 500,
    ) -> str:
        marker = f"![]({image_id})"
        image_pos = markdown.find(marker)
        if image_pos == -1:
            return markdown[: context_chars * 2].strip() if markdown else ""

        start = max(0, image_pos - context_chars)
        end = min(len(markdown), image_pos + len(marker) + context_chars)
        context = markdown[start:end]
        return context.replace(marker, "[图片]").strip()

    async def _fallback_to_doc2x(
        self,
        pdf_path: Path,
        output_dir: Path,
        exc: Exception,
        progress_callback: Optional[Callable[[str, int], None]] = None,
    ) -> Dict[str, Any]:
        from app.services.doc2x_service import Doc2XService

        logger.warning(
            "MinerU unavailable, falling back to Doc2X for %s: %s",
            pdf_path.name,
            exc,
        )
        if progress_callback:
            await progress_callback("MinerU unavailable, falling back to Doc2X...", 12)

        try:
            fallback_service = Doc2XService()
            return await fallback_service.convert_pdf_to_markdown(
                pdf_path,
                output_dir,
                progress_callback=progress_callback,
            )
        except Exception as doc2x_exc:
            if self._local_pdf_text_fallback_available():
                return await self._fallback_to_local_pdf_text(
                    pdf_path,
                    output_dir,
                    doc2x_exc,
                    progress_callback=progress_callback,
                )
            raise

    def _local_pdf_text_fallback_available(self) -> bool:
        return shutil.which("gs") is not None

    async def _fallback_to_local_pdf_text(
        self,
        pdf_path: Path,
        output_dir: Path,
        exc: Exception,
        progress_callback: Optional[Callable[[str, int], None]] = None,
    ) -> Dict[str, Any]:
        logger.warning(
            "Doc2X unavailable, falling back to local PDF text extraction for %s: %s",
            pdf_path.name,
            exc,
        )
        if progress_callback:
            await progress_callback(
                "Doc2X unavailable, falling back to local PDF text extraction...",
                18,
            )

        output_dir.mkdir(parents=True, exist_ok=True)
        markdown_content = await self._extract_text_with_ghostscript(pdf_path)
        markdown_path = output_dir / "converted.md"
        markdown_path.write_text(markdown_content, encoding="utf-8")

        if progress_callback:
            await progress_callback("Local PDF text extraction complete.", 100)

        return {
            "markdown_path": str(markdown_path),
            "images_dir": None,
            "pages_count": None,
            "ocr_result": None,
            "markdown_content": markdown_content,
            "ocr_provider": "local_gs",
        }

    async def _extract_text_with_ghostscript(self, pdf_path: Path) -> str:
        process = await asyncio.create_subprocess_exec(
            "gs",
            "-q",
            "-dNOPAUSE",
            "-dBATCH",
            "-sDEVICE=txtwrite",
            "-sOutputFile=-",
            str(pdf_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            error_text = stderr.decode("utf-8", errors="ignore").strip()
            raise Exception(error_text or "Ghostscript text extraction failed")

        extracted_text = stdout.decode("utf-8", errors="ignore").replace("\x0c", "\n\n---\n\n").strip()
        if not extracted_text:
            raise Exception("Ghostscript extracted no text from PDF")

        return extracted_text

    @staticmethod
    def extract_title_blocks(
        content_list: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """从 content_list.json 提取标题块及其 bbox 高度信息。

        返回: [{"text": str, "page_idx": int, "bbox_height": float}, ...]
        """
        from collections import Counter

        titles: List[Dict[str, Any]] = []
        text_counter: Counter = Counter()

        for item in content_list:
            # MinerU 中 text_level 存在时表示标题
            if item.get("type") != "text":
                continue
            text_level = item.get("text_level")
            if text_level is None:
                continue

            text = (item.get("text") or "").strip()
            if not text or len(text) < 2:
                continue

            bbox = item.get("bbox")
            bbox_height = 0.0
            if bbox and len(bbox) >= 4:
                bbox_height = round(bbox[3] - bbox[1], 1)

            text_counter[text] += 1
            titles.append({
                "text": text,
                "page_idx": item.get("page_idx", 0),
                "bbox_height": bbox_height,
            })

        # 标记重复标题（出现 3+ 次的大概率不是真正的标题）
        for t in titles:
            t["repeat_count"] = text_counter[t["text"]]

        logger.info(
            "从 content_list 提取到 %d 个标题块, 其中 %d 个重复>=3次",
            len(titles),
            sum(1 for t in titles if t["repeat_count"] >= 3),
        )
        return titles

    def _build_headers(
        self,
        request_token: str,
        include_content_type: bool = False,
    ) -> Dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "token": request_token,
            "Accept": "application/json",
        }
        if include_content_type:
            headers["Content-Type"] = "application/json"
        return headers
