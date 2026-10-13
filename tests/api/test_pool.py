from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from aisafety_pipeline.api.deps import PoolTimeout, _BoundedPool


class _FakeInner:
    """Stands in for psycopg2's pool: fails like ThreadedConnectionPool when
    more than `maxconn` connections are out at once."""

    def __init__(self, maxconn: int):
        self.maxconn = maxconn
        self.out = 0
        self.peak = 0
        self.fail_next = False
        self._lock = threading.Lock()

    def getconn(self):
        with self._lock:
            if self.fail_next:
                self.fail_next = False
                raise RuntimeError("connect failed")
            if self.out >= self.maxconn:
                raise RuntimeError("connection pool exhausted")
            self.out += 1
            self.peak = max(self.peak, self.out)
            return object()

    def putconn(self, conn):
        with self._lock:
            self.out -= 1

    def closeall(self):
        pass


def test_burst_larger_than_pool_waits_instead_of_failing():
    inner = _FakeInner(maxconn=3)
    pool = _BoundedPool(inner, maxconn=3, timeout=5)

    def request():
        conn = pool.getconn()
        time.sleep(0.05)
        pool.putconn(conn)
        return True

    with ThreadPoolExecutor(max_workers=12) as ex:
        results = list(ex.map(lambda _: request(), range(12)))

    assert all(results)
    assert inner.peak == 3
    assert inner.out == 0


def test_times_out_when_no_connection_frees_up():
    pool = _BoundedPool(_FakeInner(maxconn=1), maxconn=1, timeout=0.1)
    held = pool.getconn()
    with pytest.raises(PoolTimeout):
        pool.getconn()
    pool.putconn(held)
    pool.putconn(pool.getconn())  # slot is usable again after release


def test_failed_connect_does_not_leak_a_slot():
    inner = _FakeInner(maxconn=1)
    pool = _BoundedPool(inner, maxconn=1, timeout=0.1)
    inner.fail_next = True
    with pytest.raises(RuntimeError, match="connect failed"):
        pool.getconn()
    pool.putconn(pool.getconn())  # would time out if the failed call kept the slot


def test_pool_timeout_returns_503_with_cors(monkeypatch: pytest.MonkeyPatch):
    from fastapi.testclient import TestClient

    from aisafety_pipeline.api import main as api_main
    from aisafety_pipeline.api.deps import get_conn
    from aisafety_pipeline.api.ratelimit import limiter

    monkeypatch.setattr(limiter, "enabled", False)

    def _busy():
        raise PoolTimeout("no database connection free within 5s")
        yield  # pragma: no cover - makes this a generator dependency like get_conn

    api_main.app.dependency_overrides[get_conn] = _busy
    try:
        origin = api_main.API_CORS_ORIGINS[0]
        res = TestClient(api_main.app).get("/api/tags", headers={"Origin": origin})
    finally:
        api_main.app.dependency_overrides.pop(get_conn, None)

    assert res.status_code == 503
    assert res.headers["retry-after"] == "1"
    assert res.headers.get("access-control-allow-origin") == origin
