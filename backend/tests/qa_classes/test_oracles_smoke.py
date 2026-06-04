import pytest
from tests.qa_classes import oracles


class _Resp:
    def __init__(self, status_code, text="", payload=None):
        self.status_code = status_code
        self.text = text
        self._payload = payload or {}
    def json(self):
        return self._payload


def test_assert_status_ok_passes_for_2xx():
    oracles.assert_status_ok(_Resp(201), "create fighter")  # no raise


def test_assert_status_ok_raises_on_500():
    with pytest.raises(AssertionError, match="500"):
        oracles.assert_status_ok(_Resp(500, text="boom"), "level up bard L7")


def test_assert_status_ok_raises_fail_not_app_bug_on_4xx():
    # 4xx is a [FAIL] (not [BLOCKED_BY_APP_BUG]) — this branch drives owner classification.
    with pytest.raises(AssertionError, match=r"\[FAIL\]"):
        oracles.assert_status_ok(_Resp(422, text="validation"), "create bad body")


def test_option_landed_handles_str_dict_and_list():
    assert oracles.option_landed({"fighting_style": "archery"}, "fighting_style", "archery")
    assert oracles.option_landed(
        {"fighting_style": {"value": "archery"}}, "fighting_style", "archery")
    assert oracles.option_landed(
        {"eldritch_invocations": [{"value": "agonizing_blast"}]},
        "eldritch_invocations", "agonizing_blast")
    assert oracles.option_landed({"subclass_id": "champion"}, "subclass_id", "champion")
    assert not oracles.option_landed({"fighting_style": None}, "fighting_style", "archery")


def test_option_landed_nested_path():
    char = {"subclass_choices": {"pactBoon": "blade"}}
    assert oracles.option_landed(char, "subclass_choices.pactBoon", "blade")
    assert not oracles.option_landed(char, "subclass_choices.pactBoon", "tome")
    assert not oracles.option_landed({}, "subclass_choices.pactBoon", "x")
