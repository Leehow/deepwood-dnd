from pathlib import Path

import httpx
import pytest

from app.services import doc2x_service
from app.services import mistral_ocr_service


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


class _QuotaDoc2XService:
    async def convert_pdf_to_markdown(self, pdf_path, output_dir, progress_callback=None):
        raise Exception("PDF转换失败: Parse failed: {'code': 'parse_quota_limit', 'msg': '解析额度不足'}")


@pytest.mark.asyncio
async def test_convert_pdf_to_markdown_falls_back_to_doc2x_on_transport_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 test")
    output_dir = tmp_path / "converted"

    monkeypatch.setattr(mistral_ocr_service.settings, "MISTRAL_API_KEY", "mistral-test")
    monkeypatch.setattr(mistral_ocr_service.settings, "DOC2X_API_KEY", "doc2x-test")
    monkeypatch.setattr(doc2x_service, "Doc2XService", _FakeDoc2XService)

    service = mistral_ocr_service.MistralOCRService()

    async def raise_connect_error(*args, **kwargs):
        raise httpx.ConnectError("All connection attempts failed")

    monkeypatch.setattr(service, "_call_ocr_api", raise_connect_error)

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
    assert ("Mistral OCR unavailable, falling back to Doc2X...", 12) in progress_events


@pytest.mark.asyncio
async def test_convert_pdf_to_markdown_falls_back_to_local_text_when_doc2x_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 test")
    output_dir = tmp_path / "converted"

    monkeypatch.setattr(mistral_ocr_service.settings, "MISTRAL_API_KEY", "mistral-test")
    monkeypatch.setattr(mistral_ocr_service.settings, "DOC2X_API_KEY", "doc2x-test")
    monkeypatch.setattr(doc2x_service, "Doc2XService", _QuotaDoc2XService)

    service = mistral_ocr_service.MistralOCRService()

    async def raise_connect_timeout(*args, **kwargs):
        raise httpx.ConnectTimeout("timed out")

    async def fake_local_fallback(pdf_path_arg, output_dir_arg, exc, progress_callback=None):
        output_dir_arg.mkdir(parents=True, exist_ok=True)
        markdown_path = output_dir_arg / "converted.md"
        markdown_path.write_text("# local fallback", encoding="utf-8")
        if progress_callback:
            await progress_callback("Local PDF text extraction complete.", 100)
        return {
            "markdown_path": str(markdown_path),
            "markdown_content": "# local fallback",
            "ocr_result": None,
            "ocr_provider": "local_gs",
        }

    monkeypatch.setattr(service, "_call_ocr_api", raise_connect_timeout)
    monkeypatch.setattr(service, "_local_pdf_text_fallback_available", lambda: True)
    monkeypatch.setattr(service, "_fallback_to_local_pdf_text", fake_local_fallback)

    progress_events: list[tuple[str, int]] = []

    async def progress_callback(message: str, progress: int) -> None:
        progress_events.append((message, progress))

    result = await service.convert_pdf_to_markdown(
        pdf_path,
        output_dir,
        progress_callback=progress_callback,
    )

    assert result["markdown_content"] == "# local fallback"
    assert result["ocr_provider"] == "local_gs"
    assert Path(result["markdown_path"]).exists()
    assert ("Local PDF text extraction complete.", 100) in progress_events


@pytest.mark.asyncio
async def test_convert_pdf_to_markdown_raises_without_doc2x_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 test")

    monkeypatch.setattr(mistral_ocr_service.settings, "MISTRAL_API_KEY", "mistral-test")
    monkeypatch.setattr(mistral_ocr_service.settings, "DOC2X_API_KEY", "")

    service = mistral_ocr_service.MistralOCRService()

    async def raise_connect_error(*args, **kwargs):
        raise httpx.ConnectError("All connection attempts failed")

    monkeypatch.setattr(service, "_call_ocr_api", raise_connect_error)

    with pytest.raises(Exception, match="Mistral OCR conversion failed"):
        await service.convert_pdf_to_markdown(pdf_path, tmp_path / "converted")
