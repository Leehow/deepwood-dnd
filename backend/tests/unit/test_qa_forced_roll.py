from app.services.qa import forced_roll


def setup_function():
    forced_roll.clear_forced_rolls()


def test_qa_randint_falls_through_when_queue_empty(monkeypatch):
    monkeypatch.setattr(forced_roll.settings, "QA_MODE", True)
    monkeypatch.setattr(forced_roll.random, "randint", lambda a, b: 13)
    assert forced_roll.qa_randint(1, 20) == 13


def test_qa_randint_pops_queue_in_fifo_order(monkeypatch):
    monkeypatch.setattr(forced_roll.settings, "QA_MODE", True)
    forced_roll.push_forced_rolls([5, 18])
    assert forced_roll.qa_randint(1, 20) == 5
    assert forced_roll.qa_randint(1, 20) == 18


def test_qa_randint_ignores_queue_when_qa_mode_off(monkeypatch):
    monkeypatch.setattr(forced_roll.settings, "QA_MODE", False)
    monkeypatch.setattr(forced_roll.random, "randint", lambda a, b: 7)
    forced_roll.push_forced_rolls([5])
    assert forced_roll.qa_randint(1, 20) == 7


def test_clear_empties_queue(monkeypatch):
    monkeypatch.setattr(forced_roll.settings, "QA_MODE", True)
    forced_roll.push_forced_rolls([5, 6])
    forced_roll.clear_forced_rolls()
    monkeypatch.setattr(forced_roll.random, "randint", lambda a, b: 99)
    assert forced_roll.qa_randint(1, 20) == 99


def test_spell_resolver_imports_qa_randint():
    # Guards the seam: the resolver must use the shim, not bare random.randint.
    import inspect

    import app.services.spell_resolver as sr

    src = inspect.getsource(sr)
    assert "qa_randint(1, 20)" in src
    assert "random.randint(1, 20)" not in src
