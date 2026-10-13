from __future__ import annotations

from slowapi import Limiter
from starlette.requests import Request

from .. import config


def client_ip(request: Request) -> str:
    """Rate-limit key: the real client IP behind Railway's edge proxy.

    Railway's edge (Fastly) *overwrites* X-Forwarded-For, so its leftmost
    entry is the real client IP and a client-sent value can't spoof it.
    X-Real-IP is deliberately ignored: on Railway it carries a shared
    Fastly/edge IP, which lumped all users into a few buckets (verified with a
    two-network test). `request.client.host` is the proxy too, so it's only a
    fallback for local runs without a proxy.
    """
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded
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
