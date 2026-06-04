import json
from pathlib import Path

import pytest

from app.services import doc2x_service
from app.services import mineru_ocr_service
from app.services.mistral_ocr_service import get_ocr_service


class _FakeDoc2XService:
    async def convert_pdf_to_markdown(self, pdf_path, output_dir, progress_callback=None):
        output_dir.mkdir(parents=True, exist_ok=True)
        markdown_path = output_dir / "converted.md"
        markdown_path.write_text("# doc2x fallback", encoding="utf-8")
        if progress_callback:
            await progress_callback("Doc2X complete", 100)
        return {
            "markdown_path": str(markdown_path),
            "markdown_content": "# doc2x fallback",
            "ocr_provider": "doc2x",
        }


@pytest.mark.asyncio
async def test_convert_pdf_to_markdown_builds_compatible_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 test")
    output_dir = tmp_path / "converted"

    monkeypatch.setattr(mineru_ocr_service.settings, "MINERU_API_KEY", "mineru-test")
    monkeypatch.setattr(mineru_ocr_service.settings, "DOC2X_API_KEY", "")

    service = mineru_ocr_service.MinerUOCRService()

    async def fake_create_batch_upload(filename, data_id, request_token):
        assert filename == "sample.pdf"
        assert data_id
        assert request_token.startswith("dw-")
        return "batch-1", "https://example.com/upload"

    async def fake_upload_file(file_path, upload_url):
        assert file_path == pdf_path
        assert upload_url == "https://example.com/upload"

    async def fake_poll_extract_result(batch_id, request_token, progress_callback=None):
        assert batch_id == "batch-1"
        assert request_token.startswith("dw-")
        if progress_callback:
            await progress_callback("MinerU is parsing the PDF...", 30)
        return {"full_zip_url": "https://example.com/result.zip"}

    async def fake_download_and_extract(download_url, destination):
        assert download_url == "https://example.com/result.zip"
        assert destination == output_dir
        destination.mkdir(parents=True, exist_ok=True)

        images_dir = destination / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        image_path = images_dir / "scene.jpg"
        image_path.write_bytes(b"fake-image")

        markdown_path = destination / "converted.md"
        markdown_content = "# 第一章\n\n![](images/scene.jpg)\n\n这里是说明。"
        markdown_path.write_text(markdown_content, encoding="utf-8")
        content_list = [
            {"type": "text", "text": "第一章", "page_idx": 0},
            {"type": "image", "img_path": "images/scene.jpg", "page_idx": 0},
            {"type": "text", "text": "这里是说明。", "page_idx": 0},
        ]
        return markdown_path, images_dir, content_list, markdown_content

    monkeypatch.setattr(service, "_create_batch_upload", fake_create_batch_upload)
    monkeypatch.setattr(service, "_upload_file", fake_upload_file)
    monkeypatch.setattr(service, "_poll_extract_result", fake_poll_extract_result)
    monkeypatch.setattr(service, "_download_and_extract", fake_download_and_extract)

    progress_events: list[tuple[str, int]] = []

    async def progress_callback(message: str, progress: int) -> None:
        progress_events.append((message, progress))

    result = await service.convert_pdf_to_markdown(
        pdf_path,
        output_dir,
        progress_callback=progress_callback,
    )

    assert result["markdown_content"].startswith("# 第一章")
    assert Path(result["markdown_path"]).exists()
    assert result["images_dir"] == str(output_dir / "images")
    assert result["pages_count"] == 1
    assert result["ocr_provider"] == "mineru"
    assert result["ocr_result"]["provider"] == "mineru"
    assert result["ocr_result"]["pages"][0]["images"][0]["id"] == "images/scene.jpg"
    assert ("MinerU conversion complete!", 100) in progress_events

    images_with_context = service.extract_images_with_context(
        result["ocr_result"],
        result["markdown_content"],
    )
    assert images_with_context == [
        {
            "image_id": "images/scene.jpg",
            "image_base64": "ZmFrZS1pbWFnZQ==",
            "context": "第一章\n这里是说明。",
            "page_index": 0,
        }
    ]


@pytest.mark.asyncio
async def test_convert_pdf_to_markdown_falls_back_to_doc2x(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 test")
    output_dir = tmp_path / "converted"

    monkeypatch.setattr(mineru_ocr_service.settings, "MINERU_API_KEY", "mineru-test")
    monkeypatch.setattr(mineru_ocr_service.settings, "DOC2X_API_KEY", "doc2x-test")
    monkeypatch.setattr(doc2x_service, "Doc2XService", _FakeDoc2XService)

    service = mineru_ocr_service.MinerUOCRService()

    async def raise_upload_error(*args, **kwargs):
        raise Exception("upload failed")

    monkeypatch.setattr(service, "_create_batch_upload", raise_upload_error)

    progress_events: list[tuple[str, int]] = []

    async def progress_callback(message: str, progress: int) -> None:
        progress_events.append((message, progress))

    result = await service.convert_pdf_to_markdown(
        pdf_path,
        output_dir,
        progress_callback=progress_callback,
    )

    assert result["markdown_content"] == "# doc2x fallback"
    assert result["ocr_provider"] == "doc2x"
    assert Path(result["markdown_path"]).exists()
    assert ("MinerU unavailable, falling back to Doc2X...", 12) in progress_events


def test_get_ocr_service_prefers_mineru(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mineru_ocr_service.settings, "MINERU_API_KEY", "mineru-test")
    monkeypatch.setattr(mineru_ocr_service.settings, "DOC2X_API_KEY", "doc2x-test")
    monkeypatch.setattr(mineru_ocr_service.settings, "MISTRAL_API_KEY", "mistral-test")

    service = get_ocr_service()

    assert isinstance(service, mineru_ocr_service.MinerUOCRService)
