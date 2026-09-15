from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...config import ENABLE_SEMANTIC_SEARCH
from ..deps import get_conn

router = APIRouter(prefix="/api/search", tags=["search"])

_generator = None


def _get_generator():
    global _generator
    if _generator is None:
        from ...embeddings import TopicEmbeddingGenerator
        _generator = TopicEmbeddingGenerator(batch_size=1)
    return _generator


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    limit: int = Field(20, ge=1, le=100)
    domain: str | None = None
    tag: str | None = None


@router.post("")
def semantic_search(req: SearchRequest, conn=Depends(get_conn)):
    if not ENABLE_SEMANTIC_SEARCH:
        raise HTTPException(
            status_code=503,
            detail="Semantic search is disabled on this deployment. "
            "Run the API locally with ENABLE_SEMANTIC_SEARCH=true to enable it.",
        )
    gen = _get_generator()
    embs = gen.encode_queries([req.query])
    query_vec = embs[0].tolist()

    filter_clauses = ["ai_stage2_keep = TRUE", "embedding_topic IS NOT NULL"]
    filter_params: list = []

    if req.domain:
        filter_clauses.append("domain_tag = %s")
        filter_params.append(req.domain)
    if req.tag is not None:
        filter_clauses.append("EXISTS (SELECT 1 FROM paper_tags pt WHERE pt.paper_id = papers.id AND pt.tag = %s)")
        filter_params.append(req.tag)

    where_sql = "WHERE " + " AND ".join(filter_clauses)

    # params: similarity SELECT uses query_vec, WHERE uses filter_params,
    # ORDER BY uses query_vec again, LIMIT uses req.limit
    sql = f"""
        SELECT id, title, authors, published, link, domain_tag,
               1 - (embedding_topic <=> %s::vector) AS similarity,
               (SELECT array_agg(tag ORDER BY score DESC) FROM paper_tags pt WHERE pt.paper_id = papers.id) AS tags
        FROM papers
        {where_sql}
        ORDER BY embedding_topic <=> %s::vector
        LIMIT %s
    """
    params = [query_vec] + filter_params + [query_vec, req.limit]

    rows = conn.execute(sql, params).fetchall()

    return {
        "query": req.query,
        "results": [
            {
                "aid": r[0],
                "t": r[1] or "",
                "au": r[2] or "",
                "pd": str(r[3]) if r[3] else "",
                "ln": r[4] or r[0],
                "dm": r[5] or "unknown",
                "sim": round(float(r[6]), 4) if r[6] is not None else None,
                "tags": list(r[7]) if r[7] else [],
            }
            for r in rows
        ],
    }
