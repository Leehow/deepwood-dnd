from pathlib import Path

import pytest

from app.services import doc2x_service


@pytest.mark.asyncio
async def test_convert_pdf_to_markdown_creates_output_dir(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 test")
    output_dir = tmp_path / "nested" / "converted"

    monkeypatch.setattr(doc2x_service.settings, "DOC2X_API_KEY", "doc2x-test")
    service = doc2x_service.Doc2XService()

    async def fake_preupload():
        return {"uid": "uid-1", "url": "https://example.com/upload"}

    async def fake_upload(file_path, upload_url):
        assert file_path == pdf_path
        assert upload_url == "https://example.com/upload"
        assert output_dir.exists()

    async def fake_poll_status(uid, progress_callback=None):
        assert uid == "uid-1"
        return {}

    async def fake_request_export(uid):
        assert uid == "uid-1"

    async def fake_poll_export_result(uid):
        assert uid == "uid-1"
        return "https://example.com/export.zip"

    async def fake_download_and_extract(download_url, destination):
        assert download_url == "https://example.com/export.zip"
        assert destination == output_dir
        assert destination.exists()
        markdown_path = destination / "converted.md"
        markdown_path.write_text("# converted", encoding="utf-8")
        return markdown_path, None

    monkeypatch.setattr(service, "_preupload", fake_preupload)
    monkeypatch.setattr(service, "_upload_file", fake_upload)
    monkeypatch.setattr(service, "_poll_status", fake_poll_status)
    monkeypatch.setattr(service, "_request_export", fake_request_export)
    monkeypatch.setattr(service, "_poll_export_result", fake_poll_export_result)
    monkeypatch.setattr(service, "_download_and_extract", fake_download_and_extract)

    result = await service.convert_pdf_to_markdown(pdf_path, output_dir)

    assert output_dir.exists()
    assert Path(result["markdown_path"]).exists()
    assert result["markdown_content"] == "# converted"
    assert result["ocr_provider"] == "doc2x"
