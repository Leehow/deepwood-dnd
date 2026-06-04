from app.api.routes.module_chat import (
    SESSION_SUMMARY_MARKER,
    _build_fallback_rollover_summary,
    _build_rollover_session_title,
    _build_session_sse_meta,
    _is_session_summary_message,
    _strip_session_summary_marker,
)
from app.models.module_chat import ModuleChatMessage


def _make_message(role: str, content: str) -> ModuleChatMessage:
    return ModuleChatMessage(
        module_id="mod_1",
        user_id="user_1",
        role=role,
        content=content,
        session_id=1,
    )


def test_build_rollover_session_title_appends_once() -> None:
    assert _build_rollover_session_title("矿坑调查") == "矿坑调查（续）"
    assert _build_rollover_session_title("矿坑调查（续）") == "矿坑调查（续）"
    assert _build_rollover_session_title(None) == "新对话（续）"


def test_summary_marker_helpers_strip_internal_marker() -> None:
    content = f"{SESSION_SUMMARY_MARKER}\n这是压缩摘要"
    assert _is_session_summary_message(content) is True
    assert _strip_session_summary_marker(content) == "这是压缩摘要"
    assert _is_session_summary_message("普通消息") is False


def test_fallback_rollover_summary_keeps_recent_dialogue() -> None:
    messages = [
        _make_message("user", "我想把这张地图拆成三个战斗区。"),
        _make_message("assistant", "可以，先按入口大厅和祭坛分区。"),
        _make_message("assistant", f"{SESSION_SUMMARY_MARKER}\n旧摘要内容"),
    ]
    summary = _build_fallback_rollover_summary(messages)
    assert "上一窗口最近对话要点" in summary
    assert "我想把这张地图拆成三个战斗区" in summary
    assert SESSION_SUMMARY_MARKER not in summary


def test_build_session_sse_meta_shape() -> None:
    payload = _build_session_sse_meta(
        session_id=12,
        session_switched=True,
        previous_session_id=9,
        session_title="矿坑调查（续）",
        session_message_count=3,
        session_updated_at="2026-03-23T12:00:00+00:00",
    )
    assert payload["session_id"] == 12
    assert payload["session_switched"] is True
    assert payload["previous_session_id"] == 9
    assert payload["session_title"] == "矿坑调查（续）"
    assert payload["session_message_count"] == 3
