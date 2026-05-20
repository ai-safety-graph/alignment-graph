from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from ..deps import get_conn

router = APIRouter(prefix="/api/papers", tags=["papers"])


@router.get("")
def list_papers(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    cluster: Optional[int] = Query(None),
    domain: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    conn=Depends(get_conn),
):
    offset = (page - 1) * limit
    where = ["ai_stage2_keep = TRUE"]
    params: list = []

    if cluster is not None:
        where.append("kmeans_cluster = %s")
        params.append(cluster)
    if domain:
        where.append("domain_tag = %s")
        params.append(domain)
    if from_date:
        where.append("published >= %s")
        params.append(from_date)
    if to_date:
        where.append("published <= %s")
        params.append(to_date)

    where_sql = "WHERE " + " AND ".join(where)

    total_row = conn.execute(
        f"SELECT COUNT(*) FROM papers {where_sql}", params
    ).fetchone()
    total = total_row[0] if total_row else 0

    rows = conn.execute(
        f"""
        SELECT id, title, authors, published, link, domain_tag, kmeans_cluster
        FROM papers {where_sql}
        ORDER BY published DESC
        LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    ).fetchall()

    items = [
        {
            "aid": r[0],
            "t": r[1] or "",
            "au": r[2] or "",
            "pd": str(r[3]) if r[3] else "",
            "ln": r[4] or r[0],
            "dm": r[5] or "unknown",
            "cid": r[6],
        }
        for r in rows
    ]
    return {"total": total, "page": page, "limit": limit, "items": items}


@router.get("/related")
def get_related_papers(
    id: str = Query(...),
    limit: int = Query(10, ge=1, le=50),
    conn=Depends(get_conn),
):
    paper_id = id if id.startswith("http") else f"https://arxiv.org/abs/{id}"

    emb_row = conn.execute(
        "SELECT embedding FROM papers WHERE id = %s AND embedding IS NOT NULL",
        (paper_id,),
    ).fetchone()

    if not emb_row:
        raise HTTPException(status_code=404, detail="Paper not found or has no embedding")

    embedding = emb_row[0]

    rows = conn.execute(
        """
        SELECT id, title, authors, published, link, domain_tag, kmeans_cluster,
               1 - (embedding <=> %s) AS sim
        FROM papers
        WHERE id != %s
          AND ai_stage2_keep = TRUE
          AND embedding IS NOT NULL
        ORDER BY embedding <=> %s
        LIMIT %s
        """,
        (embedding, paper_id, embedding, limit),
    ).fetchall()

    return [
        {
            "aid": r[0],
            "t": r[1] or "",
            "au": r[2] or "",
            "pd": str(r[3]) if r[3] else "",
            "ln": r[4] or r[0],
            "dm": r[5] or "unknown",
            "cid": r[6],
            "sim": float(r[7]),
        }
        for r in rows
    ]


@router.get("/{arxiv_id:path}")
def get_paper(arxiv_id: str, conn=Depends(get_conn)):
    # Accept bare ID like "2503.01694" or full URL
    if not arxiv_id.startswith("http"):
        arxiv_id = f"https://arxiv.org/abs/{arxiv_id}"

    row = conn.execute(
        """
        SELECT id, title, authors, published, summary, link, domain_tag, kmeans_cluster
        FROM papers WHERE id = %s
        """,
        (arxiv_id,),
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Paper not found")

    return {
        "aid": row[0],
        "t": row[1] or "",
        "au": row[2] or "",
        "pd": str(row[3]) if row[3] else "",
        "sm": row[4] or "",
        "ln": row[5] or row[0],
        "dm": row[6] or "unknown",
        "cid": row[7],
    }
