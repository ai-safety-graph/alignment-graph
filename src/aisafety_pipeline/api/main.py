from __future__ import annotations
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes import graph, papers, search, clusters
from .deps import init_pool, close_pool
from ..config import API_CORS_ORIGINS, ENABLE_SEMANTIC_SEARCH


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
app.include_router(clusters.router)


@app.get("/health")
def health():
    return {"status": "ok", "semantic_search": ENABLE_SEMANTIC_SEARCH}
