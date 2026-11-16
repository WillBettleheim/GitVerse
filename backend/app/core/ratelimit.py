"""A per-client sliding-window limit for expensive requests."""

import math
import time
from collections import deque
from collections.abc import Callable

from starlette.requests import Request


class SlidingWindowLimiter:
    def __init__(
        self,
        limit: int,
        window_seconds: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
        max_clients: int = 10_000,
    ) -> None:
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._max_clients = max_clients
        self._hits: dict[str, deque[float]] = {}

    def check(self, client: str) -> float | None:
        """Records a request. Returns None if allowed, or seconds to wait if not."""
        now = self._clock()
        hits = self._hits.setdefault(client, deque())
        while hits and now - hits[0] >= self._window:
            hits.popleft()
        if len(hits) >= self._limit:
            return max(1.0, math.ceil(self._window - (now - hits[0])))
        hits.append(now)
        self._prune(now)
        return None

    def _prune(self, now: float) -> None:
        # Bounded memory: drop idle clients once there are many of them.
        if len(self._hits) <= self._max_clients:
            return
        for client in [c for c, h in self._hits.items() if not h or now - h[-1] >= self._window]:
            del self._hits[client]


def client_address(request: Request) -> str:
    """Who a request counts against for rate limits.

    By default, the connecting address. Behind a platform proxy that overwrites a header with the
    real client address (such as Fly.io's Fly-Client-IP), name that header in
    GITVERSE_CLIENT_IP_HEADER. X-Forwarded-For isn't used: clients can prepend to it.
    """
    header: str | None = getattr(request.app.state, "client_ip_header", None)
    if header:
        value = request.headers.get(header, "").strip()
        if value:
            return value[:64]
    return request.client.host if request.client else "unknown"
