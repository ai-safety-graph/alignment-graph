from __future__ import annotations

from slowapi import Limiter
from starlette.requests import Request

from .. import config


def client_ip(request: Request) -> str:
    """Rate-limit key: the real client IP behind Railway's edge proxy.

    `request.client.host` is the proxy, so prefer forwarding headers. Take the
    *rightmost* X-Forwarded-For entry (appended by the trusted proxy), never
    the leftmost, which the client controls and could spoof to dodge limits.
    """
    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return real_ip
    forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    if forwarded:
        return forwarded[-1]
    return request.client.host if request.client else "unknown"


# Limits are passed as callables so slowapi re-reads them per request, which
# lets tests shrink them via monkeypatching `config` without rebuilding the app.
def default_limit() -> str:
    return config.RATE_LIMIT_DEFAULT


def expensive_limit() -> str:
    return config.RATE_LIMIT_EXPENSIVE


limiter = Limiter(
    key_func=client_ip,
    default_limits=[default_limit],
    enabled=config.RATE_LIMIT_ENABLED,
)
