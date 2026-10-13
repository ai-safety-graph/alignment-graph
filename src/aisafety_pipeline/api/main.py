from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from ..config import API_CORS_ORIGINS, ENABLE_SEMANTIC_SEARCH
from .deps import PoolTimeout, close_pool, init_pool
from .ratelimit import limiter
from .routes import graph, meta, papers, search, tags


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pool()
    # Warm the search generator on startup so the first query isn't slow.
    # Only self-hosted deployments enable this: it loads a transformer model.
    if ENABLE_SEMANTIC_SEARCH:
        try:
            from .routes.search import _get_generator
            _get_generator()
        except Exception:
            pass  # model load is optional at startup; will load on first request
    yield
    close_pool()


app = FastAPI(
    title="AI Safety ArXiv API",
    version="1.0.0",
    description="REST API for the AI Safety ArXiv corpus with semantic search",
    lifespan=lifespan,
)

def _pool_timeout_handler(request: Request, exc: PoolTimeout) -> JSONResponse:
    # Every DB connection stayed busy for API_DB_POOL_TIMEOUT: a transient
    # overload, so tell the client to retry rather than returning a 500.
    return JSONResponse({"detail": "Server busy, please retry."}, status_code=503, headers={"Retry-After": "1"})


app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_exception_handler(PoolTimeout, _pool_timeout_handler)
# Added before CORS so CORS is the outermost middleware (Starlette wraps in
# reverse order) and 429 responses still carry CORS headers -- otherwise the
# browser reports a throttled request as an opaque CORS failure.
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=API_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graph.router)
app.include_router(papers.router)
app.include_router(search.router)
app.include_router(tags.router)
app.include_router(meta.router)


@app.get("/health")
@limiter.exempt
def health():
    return {"status": "ok", "semantic_search": ENABLE_SEMANTIC_SEARCH}
