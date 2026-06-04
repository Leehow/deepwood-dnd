"""
Mistral OCR PDF to Markdown conversion service
"""
import base64
import asyncio
import re
import json
import hashlib
import logging
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, Callable, List
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)

# 超过此大小(bytes)的PDF先上传OSS再传URL给Mistral，避免413错误
PDF_SIZE_THRESHOLD = 20 * 1024 * 1024  # 20MB
MISTRAL_TIMEOUT = httpx.Timeout(connect=10.0, read=600.0, write=60.0, pool=60.0)


class MistralOCRService:
    """Service for converting PDF to Markdown using Mistral OCR API"""

    def __init__(self):
        self.base_url = settings.MISTRAL_API_URL
        self.api_key = settings.MISTRAL_API_KEY
        if not self.api_key:
            raise ValueError("MISTRAL_API_KEY not found in environment variables")

    async def convert_pdf_to_markdown(
        self,
        pdf_path: Path,
        output_dir: Path,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> Dict[str, Any]:
        """
        Convert PDF to Markdown using Mistral OCR API

        Args:
            pdf_path: Path to PDF file
            output_dir: Directory to save output files
            progress_callback: Optional callback for progress updates

        Returns:
            Dict with markdown_path and images_dir
        """
        try:
            return await self._convert_pdf_to_markdown(
                pdf_path,
                output_dir,
                progress_callback=progress_callback,
            )
        except Exception as exc:
            if self._should_fallback_to_doc2x(exc):
                return await self._fallback_to_doc2x(
                    pdf_path,
                    output_dir,
                    exc,
                    progress_callback=progress_callback,
                )
            raise Exception(f"Mistral OCR conversion failed: {str(exc)}")

    async def _convert_pdf_to_markdown(
        self,
        pdf_path: Path,
        output_dir: Path,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> Dict[str, Any]:
        """Run the primary Mistral OCR conversion flow."""
        try:
            if progress_callback:
                await progress_callback("Reading PDF file...", 5)

            # Read PDF
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()

            pdf_size = len(pdf_bytes)
            logger.info(f"PDF size: {pdf_size / 1024 / 1024:.1f}MB")

            if progress_callback:
                await progress_callback("Sending to Mistral OCR...", 15)

            # 大文件先上传OSS，再用URL调用；小文件直接base64
            if pdf_size > PDF_SIZE_THRESHOLD:
                logger.info("PDF exceeds size threshold, uploading to OSS first")
                document_url = await self._upload_pdf_to_oss(pdf_bytes, pdf_path.name)
                ocr_result = await self._call_ocr_api_with_url(
                    document_url, progress_callback
                )
            else:
                pdf_base64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")
                ocr_result = await self._call_ocr_api(pdf_base64, progress_callback)
            ocr_result["provider"] = "mistral"

            if progress_callback:
                await progress_callback("Processing OCR results...", 85)

            # Build images map for embedding in markdown
            images_map = self._build_images_map(ocr_result)

            # Build tables map for embedding in markdown
            tables_map = self._build_tables_map(ocr_result)

            # Extract markdown content from pages with embedded images and tables
            markdown_content = self._extract_markdown(ocr_result, images_map, tables_map)

            # Save markdown file
            output_dir.mkdir(parents=True, exist_ok=True)
            markdown_path = output_dir / "converted.md"

            with open(markdown_path, "w", encoding="utf-8") as f:
                f.write(markdown_content)

            # Extract and save images if any
            images_dir = await self._extract_images(ocr_result, output_dir)

            if progress_callback:
                await progress_callback("PDF conversion complete!", 100)

            return {
                "markdown_path": str(markdown_path),
                "images_dir": str(images_dir) if images_dir else None,
                "pages_count": len(ocr_result.get("pages", [])),
                "ocr_result": ocr_result,  # Include raw OCR result for image classification
                "markdown_content": markdown_content,
                "ocr_provider": "mistral",
            }
        except Exception:
            raise

    def _should_fallback_to_doc2x(self, exc: Exception) -> bool:
        """Return True when a transient Mistral outage should use Doc2X instead."""
        if not settings.DOC2X_API_KEY:
            return False

        if isinstance(
            exc,
            (
                httpx.TransportError,
                httpx.TimeoutException,
            ),
        ):
            return True

        error_text = str(exc).lower()
        transport_markers = (
            "all connection attempts failed",
            "timed out",
            "temporary failure in name resolution",
            "name or service not known",
            "nodename nor servname provided",
            "network is unreachable",
            "connection reset by peer",
            "server disconnected without sending a response",
        )
        if any(marker in error_text for marker in transport_markers):
            return True

        retriable_status_markers = (
            "mistral ocr api error: 500",
            "mistral ocr api error: 502",
            "mistral ocr api error: 503",
            "mistral ocr api error: 504",
            "mistral ocr api error: 520",
            "mistral ocr api error: 521",
            "mistral ocr api error: 522",
            "mistral ocr api error: 524",
            "mistral ocr api error: 529",
        )
        return any(marker in error_text for marker in retriable_status_markers)

    async def _fallback_to_doc2x(
        self,
        pdf_path: Path,
        output_dir: Path,
        exc: Exception,
        progress_callback: Optional[Callable[[str, int], None]] = None,
    ) -> Dict[str, Any]:
        """Fallback to Doc2X, then local text extraction if backup providers fail."""
        from app.services.doc2x_service import Doc2XService

        logger.warning(
            "Mistral OCR unavailable, falling back to Doc2X for %s: %s",
            pdf_path.name,
            exc,
        )
        if progress_callback:
            await progress_callback("Mistral OCR unavailable, falling back to Doc2X...", 12)

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
        """Return True when the server can extract text locally with Ghostscript."""
        return shutil.which("gs") is not None

    async def _fallback_to_local_pdf_text(
        self,
        pdf_path: Path,
        output_dir: Path,
        exc: Exception,
        progress_callback: Optional[Callable[[str, int], None]] = None,
    ) -> Dict[str, Any]:
        """Fallback to local Ghostscript text extraction for text-based PDFs."""
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
        """Extract text from PDF via Ghostscript txtwrite as a last-resort fallback."""
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

    async def _call_ocr_api(
        self,
        pdf_base64: str,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> Dict[str, Any]:
        """Call Mistral OCR API with base64 encoded PDF"""
        url = f"{self.base_url}/ocr"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": "mistral-ocr-latest",
            "document": {
                "type": "document_url",
                "document_url": f"data:application/pdf;base64,{pdf_base64}"
            },
            # Explicitly set table_format to None to inline tables in markdown
            "table_format": None,
            "include_image_base64": True
        }

        # Fail fast on unreachable upstream, but allow long OCR processing once connected.
        async with httpx.AsyncClient(timeout=MISTRAL_TIMEOUT) as client:
            if progress_callback:
                await progress_callback("Processing with Mistral OCR...", 30)

            response = await client.post(url, headers=headers, json=payload)

            if response.status_code != 200:
                error_detail = response.text
                raise Exception(f"Mistral OCR API error: {response.status_code} - {error_detail}")

            return response.json()

    async def _upload_pdf_to_oss(self, pdf_bytes: bytes, filename: str) -> str:
        """Upload PDF to OSS and return public URL"""
        from app.domain.parsing.oss_storage import get_oss_storage

        oss = get_oss_storage()
        date_path = datetime.now().strftime("%Y/%m/%d")
        data_hash = hashlib.sha256(pdf_bytes).hexdigest()[:8]
        safe_name = re.sub(r'[^\w\-.]', '_', filename)
        object_key = f"dnd-modules/ocr-temp/{date_path}/{data_hash}_{safe_name}"

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: oss.bucket.put_object(
                object_key, pdf_bytes,
                headers={"Content-Type": "application/pdf"}
            )
        )

        url = oss.get_url(object_key)
        logger.info(f"PDF uploaded to OSS: {url}")
        return url

    async def _call_ocr_api_with_url(
        self,
        document_url: str,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> Dict[str, Any]:
        """Call Mistral OCR API with a public URL"""
        url = f"{self.base_url}/ocr"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "mistral-ocr-latest",
            "document": {
                "type": "document_url",
                "document_url": document_url
            },
            "table_format": None,
            "include_image_base64": True
        }

        async with httpx.AsyncClient(timeout=MISTRAL_TIMEOUT) as client:
            if progress_callback:
                await progress_callback("Processing with Mistral OCR (URL mode)...", 30)

            response = await client.post(url, headers=headers, json=payload)

            if response.status_code != 200:
                error_detail = response.text
                raise Exception(
                    f"Mistral OCR API error: {response.status_code} - {error_detail}"
                )

            return response.json()

    def _extract_markdown(
        self,
        ocr_result: Dict[str, Any],
        images_map: Dict[str, str] = None,
        tables_map: Dict[str, str] = None
    ) -> str:
        """Extract and combine markdown from all pages, fixing image and table references"""
        pages = ocr_result.get("pages", [])

        if not pages:
            return ""

        markdown_parts = []
        for page in pages:
            page_markdown = page.get("markdown", "")
            if page_markdown:
                # Replace image references with base64 data URLs if images_map provided
                if images_map:
                    for img_id, img_data_url in images_map.items():
                        # Replace various image reference formats
                        page_markdown = page_markdown.replace(f"![{img_id}]({img_id})", f"![{img_id}]({img_data_url})")
                        page_markdown = page_markdown.replace(f"![]({img_id})", f"![]({img_data_url})")
                        # Handle Mistral's image reference format
                        page_markdown = page_markdown.replace(f"![image]({img_id})", f"![image]({img_data_url})")

                # Replace table references with actual table content if tables_map provided
                if tables_map:
                    for tbl_id, tbl_content in tables_map.items():
                        # Replace [tbl-X.md](tbl-X.md) with actual table content
                        page_markdown = page_markdown.replace(f"[{tbl_id}]({tbl_id})", f"\n\n{tbl_content}\n\n")
                        # Also handle html format [tbl-X.html](tbl-X.html)
                        tbl_html_id = tbl_id.replace('.md', '.html')
                        page_markdown = page_markdown.replace(f"[{tbl_html_id}]({tbl_html_id})", f"\n\n{tbl_content}\n\n")

                markdown_parts.append(page_markdown)

        # Join pages with page break markers
        return "\n\n---\n\n".join(markdown_parts)

    def _build_images_map(self, ocr_result: Dict[str, Any]) -> Dict[str, str]:
        """Build a map of image IDs to base64 data URLs"""
        images_map = {}
        pages = ocr_result.get("pages", [])

        for page in pages:
            images = page.get("images", [])
            for img_info in images:
                img_base64 = img_info.get("image_base64", "")
                img_id = img_info.get("id", f"img-{page.get('index', 0)}")

                if img_base64:
                    # Strip any whitespace
                    img_base64 = img_base64.strip()
                    # Check if already a data URL
                    if img_base64.startswith("data:"):
                        data_url = img_base64
                    else:
                        # Create data URL for embedding in markdown
                        data_url = f"data:image/png;base64,{img_base64}"
                    images_map[img_id] = data_url

        return images_map

    def _build_tables_map(self, ocr_result: Dict[str, Any]) -> Dict[str, str]:
        """Build a map of table IDs to table markdown content"""
        tables_map = {}
        pages = ocr_result.get("pages", [])

        for page in pages:
            tables = page.get("tables", [])
            for tbl_info in tables:
                tbl_id = tbl_info.get("id", "")
                tbl_content = tbl_info.get("markdown", "") or tbl_info.get("html", "")

                if tbl_id and tbl_content:
                    tables_map[tbl_id] = tbl_content

        return tables_map

    async def _extract_images(
        self,
        ocr_result: Dict[str, Any],
        output_dir: Path
    ) -> Optional[Path]:
        """Extract embedded images from OCR result"""
        pages = ocr_result.get("pages", [])
        images_dir = output_dir / "images"
        has_images = False

        for page in pages:
            images = page.get("images", [])
            for img_info in images:
                # Check if base64 image data is available
                img_base64 = img_info.get("image_base64")
                img_id = img_info.get("id", f"img-{page.get('index', 0)}")

                if img_base64:
                    if not has_images:
                        images_dir.mkdir(parents=True, exist_ok=True)
                        has_images = True

                    # Decode and save image
                    try:
                        img_bytes = base64.b64decode(img_base64)
                        img_path = images_dir / f"{img_id}.png"
                        with open(img_path, "wb") as f:
                            f.write(img_bytes)
                    except Exception:
                        pass  # Skip failed image extractions

        return images_dir if has_images else None

    def extract_images_with_context(
        self,
        ocr_result: Dict[str, Any],
        markdown_content: str
    ) -> List[Dict[str, Any]]:
        """
        Extract images with their surrounding text context from OCR result

        Args:
            ocr_result: Raw OCR result from Mistral
            markdown_content: The full markdown content

        Returns:
            List of dicts with image_id, image_base64, context, page_index
        """
        images_with_context = []
        pages = ocr_result.get("pages", [])

        for page_idx, page in enumerate(pages):
            page_markdown = page.get("markdown", "")
            images = page.get("images", [])

            for img_info in images:
                img_base64 = img_info.get("image_base64")
                img_id = img_info.get("id", f"img-{page_idx}")

                if img_base64:
                    # Extract context around the image reference in markdown
                    context = self._extract_image_context(page_markdown, img_id)

                    images_with_context.append({
                        "image_id": img_id,
                        "image_base64": img_base64,
                        "context": context,
                        "page_index": page_idx
                    })

        return images_with_context

    def _extract_image_context(
        self,
        markdown: str,
        image_id: str,
        context_chars: int = 500
    ) -> str:
        """
        Extract text context around an image reference in markdown

        Args:
            markdown: The markdown text
            image_id: The image ID to find
            context_chars: Number of characters to extract before and after

        Returns:
            Surrounding text context
        """
        # Find image reference patterns
        patterns = [
            rf'!\[.*?\]\({re.escape(image_id)}\)',
            rf'!\[{re.escape(image_id)}\]',
        ]

        for pattern in patterns:
            match = re.search(pattern, markdown)
            if match:
                start = max(0, match.start() - context_chars)
                end = min(len(markdown), match.end() + context_chars)

                # Get surrounding text
                context = markdown[start:end]

                # Clean up the context - remove the image reference itself
                context = re.sub(r'!\[.*?\]\([^)]+\)', '[图片]', context)

                return context.strip()

        # If no reference found, return first part of page markdown
        return markdown[:context_chars * 2].strip() if markdown else ""


# Factory function to get the appropriate OCR service
def get_ocr_service():
    """Get the available OCR service, preferring MinerU over legacy providers."""
    if settings.MINERU_API_KEY:
        from app.services.mineru_ocr_service import MinerUOCRService

        return MinerUOCRService()
    if settings.DOC2X_API_KEY:
        from app.services.doc2x_service import Doc2XService

        return Doc2XService()
    if settings.MISTRAL_API_KEY:
        return MistralOCRService()
    raise ValueError(
        "No OCR service configured. Set MINERU_API_KEY, DOC2X_API_KEY, or MISTRAL_API_KEY."
    )
