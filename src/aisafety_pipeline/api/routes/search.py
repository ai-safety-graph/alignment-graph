from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from ..deps import get_conn

router = APIRouter(prefix="/api/search", tags=["search"])

_generator = None


def _get_generator():
    global _generator
    if _generator is None:
        from ...embeddings import EmbeddingGenerator
        _generator = EmbeddingGenerator(batch_size=1)
    return _generator


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    limit: int = Field(20, ge=1, le=100)
    domain: Optional[str] = None
    cluster: Optional[int] = None


@router.post("")
def semantic_search(req: SearchRequest, conn=Depends(get_conn)):
    gen = _get_generator()
    embs = gen.encode([req.query], [""])
    query_vec = embs[0].tolist()

    filter_clauses = ["ai_stage2_keep = TRUE", "embedding IS NOT NULL"]
    filter_params: list = []

    if req.domain:
        filter_clauses.append("domain_tag = %s")
        filter_params.append(req.domain)
    if req.cluster is not None:
        filter_clauses.append("kmeans_cluster = %s")
        filter_params.append(req.cluster)

    where_sql = "WHERE " + " AND ".join(filter_clauses)

    # params: similarity SELECT uses query_vec, WHERE uses filter_params,
    # ORDER BY uses query_vec again, LIMIT uses req.limit
    sql = f"""
        SELECT id, title, authors, published, link, domain_tag, kmeans_cluster,
               1 - (embedding <=> %s::vector) AS similarity
        FROM papers
        {where_sql}
        ORDER BY embedding <=> %s::vector
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
                "cid": r[6],
                "sim": round(float(r[7]), 4) if r[7] is not None else None,
            }
            for r in rows
        ],
    }
