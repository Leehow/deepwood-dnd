from pathlib import Path

from app.services.module_parse_flow_service import normalize_ocr_conversion_result


def test_normalize_ocr_conversion_result_reads_markdown_from_path(tmp_path: Path) -> None:
    markdown_path = tmp_path / "converted.md"
    markdown_path.write_text("# converted", encoding="utf-8")

    result = normalize_ocr_conversion_result(
        {
            "markdown_path": str(markdown_path),
            "ocr_provider": "doc2x",
        }
    )

    assert result["markdown_content"] == "# converted"
    assert result["ocr_provider"] == "doc2x"
    assert result["ocr_result"] is None


def test_normalize_ocr_conversion_result_backfills_nested_provider() -> None:
    result = normalize_ocr_conversion_result(
        {
            "markdown_path": "/tmp/unused.md",
            "markdown_content": "# content",
            "ocr_provider": "mistral",
            "ocr_result": {"pages": []},
        }
    )

    assert result["ocr_result"]["provider"] == "mistral"
