from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.mistral_ocr_service import MistralOCRService
from app.services.module_parse_websocket_service import run_parse_raw_file_ws_session
from app.services.module_parse_websocket_service import run_parse_raw_file_ws_v2_session


class _FakeDb:
    def __init__(self):
        self.commit = AsyncMock()


class _FakeOCRService(MistralOCRService):
    def __init__(self):
        pass

    async def convert_pdf_to_markdown(self, pdf_path, output_dir, progress_callback=None):
        assert progress_callback is not None
        await progress_callback("convert", 15)
        assert pdf_path.suffix == ".pdf"
        assert output_dir.name == "converted"
        markdown_path = output_dir / "converted.md"
        markdown_path.write_text("# OCR内容", encoding="utf-8")
        return {
            "markdown_path": str(markdown_path),
            "ocr_result": {
                "pages": [
                    {
                        "images": [{"id": "img-1", "image_base64": "bWFzdGVy"}],
                    }
                ],
            },
            "ocr_provider": "mistral",
        }

    def extract_images_with_context(self, ocr_result, markdown_content):
        return [
            {
                "image_id": "img-1",
                "image_base64": "bWFzdGVy",
                "context": "上下文",
                "page_index": 0,
            }
        ]


class _FakeParser:
    def __init__(self, ai_settings, output_dir, raise_error: Exception | None = None):
        self.ai_settings = ai_settings
        self.output_dir = Path(output_dir)
        self.raise_error = raise_error

    async def parse_module_file(self, markdown_path, progress_callback, skip_monsters, skip_items):
        if self.raise_error:
            raise self.raise_error
        await progress_callback("parse", "解析中", 10)
        return {
            "chapters": [{"title": "第一章"}],
            "stats": {"chapters": 1},
        }


class _FakeSplitter:
    def extract_headings_from_markdown(self, markdown_content):
        return []

    def split_by_headings(self, markdown_content, headings, min_level=1, max_level=2):
        return []

    def find_chapter_for_image(self, image_id, markdown_content, chapters):
        return "测试章节"


class _FakeClassifier:
    async def classify_images_batch(self, db, images, progress_callback=None):
        assert images[0]["image_id"] == "img-1"
        if progress_callback:
            await progress_callback("分类中", 100)
        return [
            SimpleNamespace(
                category=SimpleNamespace(value="map"),
                description="地图",
                confidence="high",
                related_entity="测试",
            )
        ]


class _FakeV2Pipeline:
    def __init__(self, parse_result=None, raise_error: Exception | None = None):
        self.parse_result = parse_result
        self.raise_error = raise_error

    async def run(
        self,
        raw_file,
        pdf_path,
        progress_callback,
        skip_image_classify: bool = False,
        cancel_token=None,
    ):
        await progress_callback("parse", "解析中", 15)
        if self.raise_error:
            raise self.raise_error
        return self.parse_result


class _FakeV2CancelledError(Exception):
    """用于注入 parse-v2 cancel 分支的可控异常"""


def _make_register_cancel_token(tracking: list[str]) -> tuple:
    def register(task_id: str):
        tracking.append(task_id)
        return f"token-{task_id}"

    return register


def _make_cleanup_cancel_token(tracking: list[str]) -> callable:
    def cleanup(task_id: str):
        tracking.append(f"cleaned:{task_id}")

    return cleanup


def _make_update_task_recorder(tracking: list[dict]) -> callable:
    def update(task_id: str, updates: dict):
        tracking.append({"task_id": task_id, "updates": updates})
        return {"id": task_id, **updates}

    return update


@pytest.mark.asyncio
async def test_run_parse_raw_file_ws_session_runs_fresh_pdf_flow(
    tmp_path: Path,
) -> None:
    raw_file = SimpleNamespace(
        id=12,
        status="uploaded",
        file_type="pdf",
        markdown_content=None,
        image_classifications=[],
        source_language=None,
    )
    db = _FakeDb()

    async def resolve_task_fn(file_id, raw_file_status):
        assert raw_file_status == "uploaded"
        assert file_id == "12"
        return {
            "task_id": "task-12",
            "task": {"id": "task-12"},
            "resumed": False,
        }

    async def detect_language(markdown_content, report_progress=None):
        if report_progress:
            await report_progress("detect language", 41)
        return "en"

    async def translate_markdown(markdown_content, source_language, report_progress=None):
        if report_progress:
            await report_progress("translate done", 60)
        return {
            "markdown_content": "# translated",
            "is_translated": "yes",
        }

    async def persist_ocr_snapshot(db, file, markdown_content, source_language, ocr_provider=None):
        file.markdown_content = markdown_content
        file.source_language = source_language
        file.ocr_provider = ocr_provider

    async def persist_translated_markdown(db, file, markdown_content, is_translated):
        file.status = "converted"

    async def persist_parsed_module_output(db, file, file_id, parse_result, image_classifications):
        file.status = "parsed"
        return {
            "module_id": "module_12",
            "result": {
                "stats": {"chapters": 1},
                "images": image_classifications,
            },
        }

    progress_events = []
    ws_events = []

    async def send_progress(task_id: str, step: str, message: str, progress: int) -> None:
        progress_events.append((task_id, step, message, progress))

    async def send_json(payload: dict) -> None:
        ws_events.append(payload)

    (tmp_path / "12.pdf").write_text("dummy", encoding="utf-8")

    async def get_raw_file(_: str, __) -> SimpleNamespace:
        return raw_file

    async def send_progress_for_progress(_task_id, _step, _message, _progress):
        await send_progress(_task_id, _step, _message, _progress)

    task_id = await run_parse_raw_file_ws_session(
        file_id="12",
        db=db,
        progress_sender=send_progress_for_progress,
        send_json=send_json,
        raw_files_dir=tmp_path,
        get_raw_file_by_id_fn=get_raw_file,
        resolve_parse_task_fn=resolve_task_fn,
        get_ocr_service_fn=_FakeOCRService,
        ocr_image_classifier=_FakeClassifier(),
        chapter_splitter_fn=_FakeSplitter(),
        detect_markdown_language_fn=detect_language,
        translate_markdown_fn=translate_markdown,
        get_ai_settings_fn=lambda: {},
        parsing_service_factory=_FakeParser,
        persist_ocr_snapshot_fn=persist_ocr_snapshot,
        persist_translated_markdown_fn=persist_translated_markdown,
        persist_parsed_module_output_fn=persist_parsed_module_output,
    )

    assert task_id == "task-12"
    assert raw_file.status == "parsed"
    assert raw_file.ocr_provider == "mistral"
    assert raw_file.image_classifications == [
        {
            "image_id": "img-1",
            "image_base64": "data:image/png;base64,bWFzdGVy",
            "category": "map",
            "description": "地图",
            "confidence": "high",
            "related_entity": "测试",
            "chapter": "测试章节",
            "page_index": 0,
        }
    ]
    assert ws_events[0] == {"type": "task_created", "task_id": "task-12"}
    assert any(item["type"] == "complete" for item in ws_events)
    assert any(
        event[0] == "task-12" and event[1] == "complete" and event[3] == 100
        for event in progress_events
    )


@pytest.mark.asyncio
async def test_run_parse_raw_file_ws_session_marks_task_failed_and_reports_error(
    tmp_path: Path,
) -> None:
    raw_file = SimpleNamespace(
        id=14,
        status="uploaded",
        file_type="pdf",
        markdown_content=None,
        image_classifications=[],
        source_language=None,
    )
    db = _FakeDb()
    updates = []
    sent = []

    async def resolve_task_fn(file_id, raw_file_status):
        return {
            "task_id": "task-14",
            "task": {"id": "task-14"},
            "resumed": False,
        }

    async def send_progress(task_id: str, step: str, message: str, progress: int) -> None:
        return None

    async def send_json(payload: dict) -> None:
        sent.append(payload)

    async def get_raw_file(_: str, __) -> SimpleNamespace:
        return raw_file

    async def persist_ocr_snapshot(db, file, markdown_content, source_language, ocr_provider=None):
        return None

    async def persist_translated_markdown(db, file, markdown_content, is_translated):
        return None

    async def persist_parsed_module_output(db, file, file_id, parse_result, image_classifications):
        return {
            "module_id": "module_14",
            "result": {"stats": {"chapters": 1}},
        }

    def update_task(task_id: str, patch: dict) -> None:
        updates.append((task_id, patch))

    (tmp_path / "14.pdf").write_text("dummy", encoding="utf-8")

    task_id = await run_parse_raw_file_ws_session(
        file_id="14",
        db=db,
        progress_sender=send_progress,
        send_json=send_json,
        raw_files_dir=tmp_path,
        get_raw_file_by_id_fn=get_raw_file,
        resolve_parse_task_fn=resolve_task_fn,
        get_ocr_service_fn=_FakeOCRService,
        ocr_image_classifier=_FakeClassifier(),
        chapter_splitter_fn=_FakeSplitter(),
        detect_markdown_language_fn=AsyncMock(return_value="en"),
        translate_markdown_fn=AsyncMock(return_value={"markdown_content": "#translated", "is_translated": "yes"}),
        get_ai_settings_fn=lambda: {},
        parsing_service_factory=lambda ai_settings, output_dir: _FakeParser(
            ai_settings=ai_settings,
            output_dir=output_dir,
            raise_error=RuntimeError("parse failed"),
        ),
        persist_ocr_snapshot_fn=persist_ocr_snapshot,
        persist_translated_markdown_fn=persist_translated_markdown,
        persist_parsed_module_output_fn=persist_parsed_module_output,
        update_task_fn=update_task,
    )

    assert task_id == "task-14"
    assert sent[-1] == {"type": "error", "message": "parse failed"}
    assert updates == [("task-14", {"status": "failed", "error_message": "parse failed"})]


@pytest.mark.asyncio
async def test_run_parse_raw_file_ws_v2_session_runs_pdf_flow_and_returns_task_id(
    tmp_path: Path,
) -> None:
    raw_file = SimpleNamespace(
        id=20,
        status="uploaded",
        file_type="pdf",
        parsed_module_id="module_20",
        markdown_content=None,
        image_classifications=[],
    )
    db = _FakeDb()
    token_tracker: list[str] = []

    async def resolve_task_fn(file_id, raw_file_status):
        assert file_id == "20"
        assert raw_file_status == "uploaded"
        return {
            "task_id": "task-v2-20",
            "task": {"id": "task-v2-20"},
            "resumed": False,
        }

    progress_events = []
    sent_messages = []

    async def send_progress(step: str, message: str, percent: int) -> None:
        progress_events.append((step, message, percent))

    async def send_json(payload: dict) -> None:
        sent_messages.append(payload)

    async def get_raw_file(_: str, __) -> SimpleNamespace:
        return raw_file

    (tmp_path / "20.pdf").write_text("dummy", encoding="utf-8")

    task_id = await run_parse_raw_file_ws_v2_session(
        file_id="20",
        db=db,
        send_json=send_json,
        raw_files_dir=tmp_path,
        get_raw_file_by_id_fn=get_raw_file,
        resolve_parse_task_fn=resolve_task_fn,
        register_cancel_token_fn=_make_register_cancel_token(token_tracker),
        cleanup_cancel_token_fn=_make_cleanup_cancel_token(token_tracker),
        pipeline_factory=lambda _db: _FakeV2Pipeline(
            parse_result=SimpleNamespace(
                toc=[{"title": "toc1"}, {"title": "toc2"}],
                images=["img1", "img2", "img3"],
            )
        ),
    )

    assert task_id == "task-v2-20"
    assert sent_messages[0] == {"type": "task_created", "task_id": "task-v2-20"}
    assert sent_messages[-1] == {
        "type": "complete",
        "message": "解析完成",
        "module_id": "module_20",
        "toc_count": 2,
        "images_count": 3,
    }
    assert any(
        item == {"type": "progress", "step": "parse", "message": "解析中", "progress": 15}
        for item in sent_messages
    )
    assert token_tracker == ["task-v2-20", "cleaned:task-v2-20"]


@pytest.mark.asyncio
async def test_run_parse_raw_file_ws_v2_session_reuses_existing_markdown_for_reparse(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw_file = SimpleNamespace(
        id=24,
        status="parsed",
        file_type="pdf",
        parsed_module_id="module_24",
        markdown_content="# cached markdown",
        image_classifications=[],
    )
    db = _FakeDb()
    sent_messages = []
    delegated_calls = []

    async def send_json(payload: dict) -> None:
        sent_messages.append(payload)

    async def get_raw_file(_: str, __) -> SimpleNamespace:
        return raw_file

    async def fake_legacy_runner(**kwargs):
        delegated_calls.append(kwargs)
        await kwargs["send_json"]({"type": "complete", "module_id": "module_24", "stats": {"chapters": 3}})
        return "task-legacy-24"

    monkeypatch.setattr(
        "app.services.module_parse_websocket_service.run_parse_raw_file_ws_session",
        fake_legacy_runner,
    )

    task_id = await run_parse_raw_file_ws_v2_session(
        file_id="24",
        db=db,
        send_json=send_json,
        raw_files_dir=tmp_path,
        get_raw_file_by_id_fn=get_raw_file,
    )

    assert task_id == "task-legacy-24"
    assert len(delegated_calls) == 1
    assert delegated_calls[0]["file_id"] == "24"
    assert delegated_calls[0]["raw_files_dir"] == tmp_path
    assert sent_messages[-1] == {"type": "complete", "module_id": "module_24", "stats": {"chapters": 3}}


@pytest.mark.asyncio
async def test_run_parse_raw_file_ws_v2_session_replays_resume_path(
    tmp_path: Path,
) -> None:
    raw_file = SimpleNamespace(
        id=21,
        status="converted",
        file_type="pdf",
        parsed_module_id=None,
        markdown_content=None,
        image_classifications=[],
    )
    db = _FakeDb()
    token_tracker: list[str] = []

    async def resolve_task_fn(file_id, raw_file_status):
        return {
            "task_id": "task-v2-21",
            "task": {
                "id": "task-v2-21",
                "current_step": "parse",
                "batch_messages": ["继续执行", "剩余步骤"],
                "progress": 44,
            },
            "resumed": True,
        }

    sent_messages = []

    async def send_json(payload: dict) -> None:
        sent_messages.append(payload)

    async def get_raw_file(_: str, __) -> SimpleNamespace:
        return raw_file

    (tmp_path / "21.pdf").write_text("dummy", encoding="utf-8")

    await run_parse_raw_file_ws_v2_session(
        file_id="21",
        db=db,
        send_json=send_json,
        raw_files_dir=tmp_path,
        get_raw_file_by_id_fn=get_raw_file,
        resolve_parse_task_fn=resolve_task_fn,
        register_cancel_token_fn=_make_register_cancel_token(token_tracker),
        cleanup_cancel_token_fn=_make_cleanup_cancel_token(token_tracker),
        pipeline_factory=lambda _db: _FakeV2Pipeline(
            parse_result=SimpleNamespace(toc=[], images=[]),
        ),
    )

    assert sent_messages[1] == {"type": "resume", "task": {
        "id": "task-v2-21",
        "current_step": "parse",
        "batch_messages": ["继续执行", "剩余步骤"],
        "progress": 44,
    }}
    assert sent_messages[2] == {
        "type": "progress",
        "step": "parse",
        "message": "继续执行",
        "progress": 44,
    }
    assert sent_messages[3] == {
        "type": "progress",
        "step": "parse",
        "message": "剩余步骤",
        "progress": 44,
    }
    assert sent_messages[-1]["type"] == "complete"


@pytest.mark.asyncio
async def test_run_parse_raw_file_ws_v2_session_reports_parse_error(
    tmp_path: Path,
) -> None:
    raw_file = SimpleNamespace(
        id=22,
        status="uploaded",
        file_type="pdf",
        parsed_module_id=None,
        markdown_content=None,
        image_classifications=[],
    )
    db = _FakeDb()
    task_updates = []

    async def resolve_task_fn(file_id, raw_file_status):
        return {
            "task_id": "task-v2-22",
            "task": {"id": "task-v2-22"},
            "resumed": False,
        }

    sent_messages = []

    async def send_json(payload: dict) -> None:
        sent_messages.append(payload)

    async def get_raw_file(_: str, __) -> SimpleNamespace:
        return raw_file

    (tmp_path / "22.pdf").write_text("dummy", encoding="utf-8")

    task_id = await run_parse_raw_file_ws_v2_session(
        file_id="22",
        db=db,
        send_json=send_json,
        raw_files_dir=tmp_path,
        get_raw_file_by_id_fn=get_raw_file,
        resolve_parse_task_fn=resolve_task_fn,
        register_cancel_token_fn=_make_register_cancel_token([]),
        pipeline_factory=lambda _db: _FakeV2Pipeline(
            raise_error=RuntimeError("boom"),
        ),
        update_task_fn=_make_update_task_recorder(task_updates),
    )

    assert task_id == "task-v2-22"
    assert sent_messages[-1] == {"type": "error", "message": "解析失败: boom"}
    assert task_updates == [
        {
            "task_id": "task-v2-22",
            "updates": {"status": "failed", "error_message": "boom"},
        }
    ]


@pytest.mark.asyncio
async def test_run_parse_raw_file_ws_v2_session_stopped_when_pipeline_cancelled(
    tmp_path: Path,
) -> None:
    raw_file = SimpleNamespace(
        id=23,
        status="uploaded",
        file_type="pdf",
        parsed_module_id=None,
        markdown_content=None,
        image_classifications=[],
    )
    db = _FakeDb()
    task_updates = []

    async def resolve_task_fn(file_id, raw_file_status):
        return {
            "task_id": "task-v2-23",
            "task": {"id": "task-v2-23"},
            "resumed": False,
        }

    sent_messages = []

    async def send_json(payload: dict) -> None:
        sent_messages.append(payload)

    async def get_raw_file(_: str, __) -> SimpleNamespace:
        return raw_file

    (tmp_path / "23.pdf").write_text("dummy", encoding="utf-8")

    task_id = await run_parse_raw_file_ws_v2_session(
        file_id="23",
        db=db,
        send_json=send_json,
        raw_files_dir=tmp_path,
        get_raw_file_by_id_fn=get_raw_file,
        resolve_parse_task_fn=resolve_task_fn,
        register_cancel_token_fn=_make_register_cancel_token([]),
        pipeline_factory=lambda _db: _FakeV2Pipeline(
            raise_error=_FakeV2CancelledError("用户手动停止解析"),
        ),
        cancelled_error_type=_FakeV2CancelledError,
        update_task_fn=_make_update_task_recorder(task_updates),
    )

    assert task_id == "task-v2-23"
    assert sent_messages[-1] == {"type": "stopped", "message": "解析已停止"}
    assert task_updates == [
        {
            "task_id": "task-v2-23",
            "updates": {"status": "stopped", "current_message": "解析已停止"},
        }
    ]


@pytest.mark.asyncio
async def test_run_parse_raw_file_ws_session_marks_task_failed_when_parser_raises(
    tmp_path: Path,
) -> None:
    raw_file = SimpleNamespace(
        id=31,
        status="converted",
        file_type="markdown",
        markdown_content="# ready",
        image_classifications=[],
        source_language="en",
    )
    db = _FakeDb()
    task_updates = []
    sent_messages = []

    async def resolve_task_fn(file_id, raw_file_status):
        return {
            "task_id": "task-31",
            "task": {"id": "task-31"},
            "resumed": False,
        }

    async def send_progress(task_id: str, step: str, message: str, progress: int) -> None:
        return None

    async def send_json(payload: dict) -> None:
        sent_messages.append(payload)

    async def get_raw_file(_: str, __) -> SimpleNamespace:
        return raw_file

    class _ExplodingParser:
        def __init__(self, ai_settings, output_dir):
            self.ai_settings = ai_settings
            self.output_dir = output_dir

        async def parse_module_file(self, markdown_path, progress_callback, skip_monsters, skip_items):
            raise RuntimeError("parser blew up")

    task_id = await run_parse_raw_file_ws_session(
        file_id="31",
        db=db,
        progress_sender=send_progress,
        send_json=send_json,
        raw_files_dir=tmp_path,
        get_raw_file_by_id_fn=get_raw_file,
        resolve_parse_task_fn=resolve_task_fn,
        get_ai_settings_fn=lambda: {},
        parsing_service_factory=_ExplodingParser,
        update_task_fn=_make_update_task_recorder(task_updates),
    )

    assert task_id == "task-31"
    assert sent_messages[-1] == {"type": "error", "message": "parser blew up"}
    assert task_updates == [
        {
            "task_id": "task-31",
            "updates": {"status": "failed", "error_message": "parser blew up"},
        }
    ]


@pytest.mark.asyncio
async def test_run_parse_raw_file_ws_session_handles_resumed_pdf_translation(
    tmp_path: Path,
) -> None:
    raw_file = SimpleNamespace(
        id=13,
        status="ocr_complete",
        file_type="pdf",
        markdown_content="# from ocr",
        source_language="en",
        image_classifications=[],
    )
    db = _FakeDb()

    async def resolve_task_fn(file_id, raw_file_status):
        return {
            "task_id": "task-13",
            "task": {
                "id": "task-13",
                "current_step": "translate",
                "batch_messages": ["continue"],
            },
            "resumed": True,
        }

    progress_calls = []

    async def send_progress(task_id: str, step: str, message: str, progress: int) -> None:
        progress_calls.append((task_id, step, message, progress))

    sent = []

    async def send_json(payload: dict) -> None:
        sent.append(payload)

    async def get_raw_file(_: str, __) -> SimpleNamespace:
        return raw_file

    async def persist_ocr_marked_translated(db, file, markdown_content, is_translated):
        file.status = "converted"

    async def persist_parsed_module_output(db, file, file_id, parse_result, image_classifications):
        file.status = "parsed"
        return {
            "module_id": "module_13",
            "result": {"stats": {"chapters": 1}},
        }

    async def translate_markdown(markdown_content, source_language, report_progress=None):
        if report_progress:
            await report_progress("resume translate", 50)
        return {
            "markdown_content": "# translated",
            "is_translated": "yes",
        }

    async def _resume_translate(markdown_content, source_language, report_progress=None, db=None):
        if report_progress:
            await report_progress("resume translate", 50)
            return {
                "markdown_content": "# translated",
                "is_translated": "yes",
            }
        return {
            "markdown_content": "# translated",
            "is_translated": "yes",
        }

    task_id = await run_parse_raw_file_ws_session(
        file_id="13",
        db=db,
        progress_sender=send_progress,
        send_json=send_json,
        raw_files_dir=tmp_path,
        get_raw_file_by_id_fn=get_raw_file,
        resolve_parse_task_fn=resolve_task_fn,
        detect_markdown_language_fn=AsyncMock(),
        translate_markdown_fn=_resume_translate,
        get_ai_settings_fn=lambda: {},
        parsing_service_factory=_FakeParser,
        persist_translated_markdown_fn=persist_ocr_marked_translated,
        persist_parsed_module_output_fn=persist_parsed_module_output,
    )

    assert task_id == "task-13"
    assert raw_file.status == "parsed"
    assert sent[0]["type"] == "task_created"
    assert sent[1]["type"] == "resume"
    assert sent[1]["task"]["id"] == "task-13"
    assert sent[-1]["type"] == "complete"
    assert any(
        item[1] == "translate"
        for item in progress_calls
    )


@pytest.mark.asyncio
async def test_run_parse_raw_file_ws_session_returns_none_and_reports_missing_file(
    tmp_path: Path,
) -> None:
    db = _FakeDb()
    messages = []

    async def send_json(payload: dict) -> None:
        messages.append(payload)

    task_id = await run_parse_raw_file_ws_session(
        file_id="999",
        db=db,
        progress_sender=_noop_progress,
        send_json=send_json,
        raw_files_dir=tmp_path,
        get_raw_file_by_id_fn=_get_raw_none,
    )

    assert task_id is None
    assert messages == [{"type": "error", "message": "File not found"}]


async def _get_raw_none(file_id: str, db) -> None:
    return None


async def _noop_progress(task_id: str, step: str, message: str, progress: int) -> None:
    return None
