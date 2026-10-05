import math
import threading
from collections import deque
from collections.abc import Callable


class RateLimited(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = retry_after


class RollingLimits:
    """Atomic per-layer charging for one process/worker, using monotonic time."""

    def __init__(self, monotonic: Callable[[], float]):
        self._time = monotonic
        self._lock = threading.Lock()
        self._records: dict[tuple[str, ...], deque[float]] = {}

    def charge(self, key: tuple[str, ...], quota: int) -> None:
        with self._lock:
            now = self._time()
            for existing in list(self._records):
                times = self._records[existing]
                while times and times[0] <= now - 60:
                    times.popleft()
                if not times:
                    del self._records[existing]
            times = self._records.setdefault(key, deque())
            if len(times) >= quota:
                raise RateLimited(max(1, math.ceil(times[0] + 60 - now)))
            times.append(now)
