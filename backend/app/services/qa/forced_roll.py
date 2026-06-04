"""QA-only forced-roll queue.

When QA_MODE is on and the queue is non-empty, qa_randint pops a fixed value
instead of using RNG. Empty queue -> normal random.randint. The queue is a
process-global FIFO; QA runs single-worker (uvicorn --reload), so this is safe
for QA but must never be enabled in the multi-worker production deployment.
"""
import random
from collections import deque
from typing import Iterable

from app.core.config import settings

_forced: "deque[int]" = deque()


def push_forced_rolls(rolls: Iterable[int]) -> None:
    """Append fixed roll results to the FIFO queue."""
    _forced.extend(int(r) for r in rolls)


def clear_forced_rolls() -> None:
    _forced.clear()


def queue_size() -> int:
    return len(_forced)


def qa_randint(a: int, b: int) -> int:
    """random.randint shim: pops a forced value in QA_MODE, else real RNG."""
    if settings.QA_MODE and _forced:
        return _forced.popleft()
    return random.randint(a, b)
