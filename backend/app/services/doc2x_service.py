"""
Doc2X PDF to Markdown conversion service
"""
import asyncio
import os
import time
import json
import zipfile
import shutil
from pathlib import Path
from typing import Dict, Any, Optional, Callable
import httpx
from app.core.config import settings


class Doc2XService:
    """Service for converting PDF to Markdown using Doc2X API"""
    
    def __init__(self):
        self.base_url = settings.DOC2X_API_URL
        self.api_key = settings.DOC2X_API_KEY
        if not self.api_key:
            raise ValueError("DOC2X_API_KEY not found in environment variables")
    
    async def convert_pdf_to_markdown(
        self,
        pdf_path: Path,
        output_dir: Path,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> Dict[str, Any]:
        """
        Convert PDF to Markdown using Doc2X API
        
        Args:
            pdf_path: Path to PDF file
            output_dir: Directory to save output files
            progress_callback: Optional callback for progress updates (message, progress_percent)
        
        Returns:
            Dict with markdown_path and images_dir
        """
        try:
            output_dir.mkdir(parents=True, exist_ok=True)

            # Step 1: Preupload to get upload URL
            if progress_callback:
                await progress_callback("📤 正在获取上传链接...", 5)

            upload_data = await self._preupload()
            uid = upload_data["uid"]
            upload_url = upload_data["url"]

            # Step 2: Upload PDF file
            if progress_callback:
                await progress_callback(f"📤 正在上传PDF文件... (UID: {uid[:8]}...)", 10)

            await self._upload_file(pdf_path, upload_url)

            # Step 3: Poll for parsing status
            if progress_callback:
                await progress_callback("🔄 PDF解析中，请稍候...", 15)

            result = await self._poll_status(uid, progress_callback)

            # Step 4: Request export to markdown
            if progress_callback:
                await progress_callback("📦 正在导出Markdown文件...", 85)

            await self._request_export(uid)

            # Step 5: Poll for export result
            if progress_callback:
                await progress_callback("⏳ 等待导出完成...", 90)

            export_url = await self._poll_export_result(uid)

            # Step 6: Download and extract
            if progress_callback:
                await progress_callback("💾 正在下载并解压文件...", 95)
            
            markdown_path, images_dir = await self._download_and_extract(
                export_url, output_dir
            )
            markdown_content = markdown_path.read_text(encoding="utf-8")

            if progress_callback:
                await progress_callback("✅ PDF转换完成！", 100)

            return {
                "markdown_path": str(markdown_path),
                "images_dir": str(images_dir) if images_dir else None,
                "uid": uid,
                "markdown_content": markdown_content,
                "ocr_result": None,
                "ocr_provider": "doc2x",
            }
            
        except Exception as e:
            raise Exception(f"PDF转换失败: {str(e)}")
    
    async def _preupload(self) -> Dict[str, str]:
        """Get preupload URL"""
        url = f"{self.base_url}/api/v2/parse/preupload"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers)
            
            if response.status_code != 200:
                raise Exception(f"Preupload failed: {response.text}")
            
            data = response.json()
            if data["code"] != "success":
                raise Exception(f"Preupload failed: {data}")
            
            return data["data"]
    
    async def _upload_file(self, file_path: Path, upload_url: str):
        """Upload file to OSS"""
        async with httpx.AsyncClient(timeout=300.0) as client:
            with open(file_path, "rb") as f:
                response = await client.put(upload_url, content=f.read())
                
                if response.status_code != 200:
                    raise Exception(f"File upload failed: {response.text}")
    
    async def _poll_status(
        self,
        uid: str,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> Dict[str, Any]:
        """Poll parsing status until complete"""
        url = f"{self.base_url}/api/v2/parse/status"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                response = await client.get(url, headers=headers, params={"uid": uid})
                
                if response.status_code != 200:
                    raise Exception(f"Status check failed: {response.text}")
                
                data = response.json()
                
                if data["code"] != "success":
                    raise Exception(f"Parse failed: {data}")
                
                status_data = data["data"]
                status = status_data["status"]
                progress = status_data.get("progress", 0)
                detail = status_data.get("detail", "")
                
                if status == "success":
                    return status_data["result"]
                elif status == "failed":
                    raise Exception(f"Parse failed: {detail}")
                elif status == "processing":
                    # Map progress 0-100 to 15-80 range
                    mapped_progress = 15 + int(progress * 0.65)
                    if progress_callback:
                        await progress_callback(
                            f"🔄 PDF解析中... ({progress}%) - {detail}",
                            mapped_progress
                        )
                    await asyncio.sleep(3)
                else:
                    raise Exception(f"Unknown status: {status}")
    
    async def _request_export(self, uid: str):
        """Request export to markdown"""
        url = f"{self.base_url}/api/v2/convert/parse"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        data = {
            "uid": uid,
            "to": "md",
            "formula_mode": "normal",
            "filename": "output"
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, json=data)
            
            if response.status_code != 200:
                raise Exception(f"Export request failed: {response.text}")
            
            result = response.json()
            if result["code"] != "success":
                raise Exception(f"Export request failed: {result}")
    
    async def _poll_export_result(self, uid: str) -> str:
        """Poll export result until complete"""
        url = f"{self.base_url}/api/v2/convert/parse/result"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                response = await client.get(url, headers=headers, params={"uid": uid})
                
                if response.status_code != 200:
                    raise Exception(f"Export status check failed: {response.text}")
                
                data = response.json()
                
                if data["code"] != "success":
                    raise Exception(f"Export failed: {data}")
                
                status_data = data["data"]
                status = status_data["status"]
                
                if status == "success":
                    return status_data["url"]
                elif status == "failed":
                    raise Exception("Export failed")
                elif status == "processing":
                    await asyncio.sleep(2)
                else:
                    raise Exception(f"Unknown export status: {status}")
    
    async def _download_and_extract(
        self,
        download_url: str,
        output_dir: Path
    ) -> tuple[Path, Optional[Path]]:
        """Download and extract markdown zip file"""
        # Fix URL encoding if needed
        download_url = download_url.replace("\\u0026", "&")
        
        # Download zip file
        zip_path = output_dir / "temp_export.zip"
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.get(download_url)
            
            if response.status_code != 200:
                raise Exception(f"Download failed: {response.status_code}")
            
            with open(zip_path, "wb") as f:
                f.write(response.content)
        
        # Extract zip file
        extract_dir = output_dir / "extracted"
        extract_dir.mkdir(exist_ok=True)
        
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)
        
        # Find markdown file and images directory
        markdown_path = None
        images_dir = None
        
        for item in extract_dir.rglob("*"):
            if item.is_file() and item.suffix == ".md":
                markdown_path = item
            elif item.is_dir() and item.name == "images":
                images_dir = item
        
        if not markdown_path:
            raise Exception("No markdown file found in export")
        
        # Move files to output directory
        final_md_path = output_dir / "converted.md"
        shutil.copy(markdown_path, final_md_path)
        
        final_images_dir = None
        if images_dir and images_dir.exists():
            final_images_dir = output_dir / "images"
            if final_images_dir.exists():
                shutil.rmtree(final_images_dir)
            shutil.copytree(images_dir, final_images_dir)
        
        # Cleanup
        zip_path.unlink()
        shutil.rmtree(extract_dir)
        
        return final_md_path, final_images_dir


# Add missing import
import asyncio
