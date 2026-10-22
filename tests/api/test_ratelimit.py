from __future__ import annotations

import pytest
from starlette.requests import Request

from aisafety_pipeline import config
from aisafety_pipeline.api.ratelimit import client_ip, limiter


def _request(headers: dict[str, str], client_host: str | None = "10.0.0.1") -> Request:
    scope = {
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": (client_host, 1234) if client_host else None,
    }
    return Request(scope)


def test_client_ip_uses_leftmost_forwarded_for():
    # Railway's edge overwrites X-Forwarded-For, so the leftmost entry is the client.
    req = _request({"X-Forwarded-For": "4.4.4.4, 100.64.0.2"})
    assert client_ip(req) == "4.4.4.4"


def test_client_ip_ignores_x_real_ip():
    # On Railway X-Real-IP is a shared edge IP; keying on it lumps users together.
    req = _request({"X-Real-IP": "151.101.1.1", "X-Forwarded-For": "4.4.4.4"})
    assert client_ip(req) == "4.4.4.4"
    assert client_ip(_request({"X-Real-IP": "151.101.1.1"})) == "10.0.0.1"


def test_client_ip_falls_back_to_socket_peer():
    assert client_ip(_request({})) == "10.0.0.1"
    assert client_ip(_request({}, client_host=None)) == "unknown"


class _StubCursor:
    def fetchone(self):
        return None

    def fetchall(self):
        return []


class _StubConn:
    def execute(self, *args, **kwargs):
        return _StubCursor()


@pytest.fixture
def limited_client(monkeypatch: pytest.MonkeyPatch):
    """App client with the limiter on, tiny limits, and a stub DB connection
    (every lookup misses -> 404), so these tests don't need Postgres.
    Not entered as a context manager, so the lifespan (DB pool) doesn't run."""
    from fastapi.testclient import TestClient

    from aisafety_pipeline.api import main as api_main
    from aisafety_pipeline.api.deps import get_conn

    monkeypatch.setattr(limiter, "enabled", True)
    monkeypatch.setattr(config, "RATE_LIMIT_DEFAULT", "3/minute")
    monkeypatch.setattr(config, "RATE_LIMIT_EXPENSIVE", "2/minute")
    limiter.reset()

    def _stub_conn():
        yield _StubConn()

    api_main.app.dependency_overrides[get_conn] = _stub_conn
    try:
        yield TestClient(api_main.app)
    finally:
        api_main.app.dependency_overrides.pop(get_conn, None)
        limiter.reset()


def _statuses(client, path: str, n: int, ip: str = "9.9.9.9") -> list[int]:
    return [client.get(path, headers={"X-Forwarded-For": ip}).status_code for _ in range(n)]


def test_default_limit_returns_429(limited_client):
    assert _statuses(limited_client, "/api/papers/0000.00000", 4) == [404, 404, 404, 429]


def test_expensive_limit_is_stricter(limited_client):
    assert _statuses(limited_client, "/api/papers/related?id=0000.00000", 3) == [404, 404, 429]


def test_limits_are_per_client_ip(limited_client):
    assert _statuses(limited_client, "/api/papers/0000.00000", 4, ip="1.1.1.1")[-1] == 429
    assert _statuses(limited_client, "/api/papers/0000.00000", 1, ip="2.2.2.2") == [404]


def test_health_is_exempt(limited_client):
    assert set(_statuses(limited_client, "/health", 10)) == {200}


def test_429_carries_cors_headers(limited_client):
    origin = config.API_CORS_ORIGINS[0]
    headers = {"X-Forwarded-For": "9.9.9.9", "Origin": origin}
    responses = [limited_client.get("/api/papers/0000.00000", headers=headers) for _ in range(4)]
    assert responses[-1].status_code == 429
    assert responses[-1].headers.get("access-control-allow-origin") == origin
