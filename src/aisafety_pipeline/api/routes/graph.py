from __future__ import annotations

import datetime as dt
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, field_validator

from ...config import TOPIC_EMB_DIMS, TOPIC_EMB_MODEL
from ..deps import get_conn
from ..ratelimit import expensive_limit, limiter

router = APIRouter(prefix="/api/graph", tags=["graph"])

# Large enough for a month of relevant papers.
_MAX_SUBSET = 5000

# Filter-built graphs keep the newest papers up to this cap, so a broad
# filter stays readable; `meta.total` reports the full match count.
_MAX_RANGE = 500


class SubsetRequest(BaseModel):
    ids: list[str]

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("ids must not be empty")
        if len(v) > _MAX_SUBSET:
            raise ValueError(f"ids must contain at most {_MAX_SUBSET} items")
        return v


_GRAPH_COLUMNS = """
    id, title, authors, published, link, domain_tag,
    graph_x, graph_y,
    llm_tags AS tags
"""


def _build_subgraph(conn, paper_ids: list[str]) -> dict:
    rows = conn.execute(f"""
        SELECT {_GRAPH_COLUMNS}
        FROM papers
        WHERE id = ANY(%s) AND llm_relevant = TRUE
        ORDER BY published DESC
    """, (paper_ids,)).fetchall()
    # Corpus bounds, like /range, so a saved snapshot of a filter-built graph
    # renders with every node where it was before saving.
    return _graph_from_rows(rows, bounds=_corpus_bounds(conn))


def _build_range_graph(
    conn,
    from_date: dt.date | None,
    to_date: dt.date | None,
    tags: list[str],
    domains: list[str],
) -> dict:
    # `published` is TEXT (YYYY-MM-DD), so compare as ISO strings.
    where = ["llm_relevant = TRUE"]
    params: list = []
    if tags:
        where.append("llm_tags && %s")
        params.append(tags)
    if domains:
        where.append("domain_tag = ANY(%s)")
        params.append(domains)
    if from_date:
        where.append("published >= %s")
        params.append(from_date.isoformat())
    if to_date:
        where.append("published <= %s")
        params.append(to_date.isoformat())
    # count(*) OVER () reports the full match count alongside the capped rows.
    rows = conn.execute(f"""
        SELECT {_GRAPH_COLUMNS}, count(*) OVER () AS total
        FROM papers
        WHERE {" AND ".join(where)}
        ORDER BY published DESC, id
        LIMIT %s
    """, (*params, _MAX_RANGE)).fetchall()
    graph = _graph_from_rows(rows, bounds=_corpus_bounds(conn))
    graph["meta"]["total"] = rows[0][9] if rows else 0
    return graph


def _corpus_bounds(conn) -> dict | None:
    """Raw layout bounds over every relevant paper. Normalising range graphs
    against these (rather than each result's own extent) keeps a paper at the
    same canvas position whichever filters selected it."""
    row = conn.execute("""
        SELECT min(graph_x), max(graph_x), min(graph_y), max(graph_y)
        FROM papers
        WHERE llm_relevant = TRUE AND graph_x IS NOT NULL AND graph_y IS NOT NULL
    """).fetchone()
    if not row or row[0] is None:
        return None
    return {
        "x_min": float(row[0]), "x_max": float(row[1]),
        "y_min": float(row[2]), "y_max": float(row[3]),
    }


def _graph_from_rows(rows, bounds: dict | None = None) -> dict:
    """Compact graph for `rows`. Coords are normalised to the canvas using
    `bounds` when given, else the rows' own min/max."""
    if not rows:
        return {
            "meta": {
                "model": TOPIC_EMB_MODEL,
                "embedding_dim": TOPIC_EMB_DIMS,
                "generated_at": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat(),
                "neighbors": None,
                "coords": {
                    "included": False,
                    "method": "none",
                    "canvas": {"w": 1000, "h": 700, "pad": 24},
                    "bounds": None,
                },
                "compact": True,
            },
            "tags": {},
            "nodes": [],
            "links": [],
        }

    papers = []
    ids = []

    tag_counts: dict[str, int] = defaultdict(int)

    for r in rows:
        tags = list(r[8]) if r[8] else []
        papers.append({
            "aid": r[0], "t": r[1] or "", "au": r[2] or "",
            "pd": str(r[3]) if r[3] else "", "dm": r[5] or "unknown",
            "ln": r[4] or r[0], "tags": tags,
            "raw_x": float(r[6]) if r[6] is not None else None,
            "raw_y": float(r[7]) if r[7] is not None else None,
        })
        ids.append(r[0])
        for t in tags:
            tag_counts[t] += 1

    N = len(papers)
    CANVAS_W, CANVAS_H, PAD = 1000, 700, 24

    x_vals = [p["raw_x"] for p in papers if p["raw_x"] is not None]
    y_vals = [p["raw_y"] for p in papers if p["raw_y"] is not None]
    has_coords = len(x_vals) == N

    if has_coords:
        if bounds:
            x_min, x_max = bounds["x_min"], bounds["x_max"]
            y_min, y_max = bounds["y_min"], bounds["y_max"]
        else:
            x_min, x_max = min(x_vals), max(x_vals)
            y_min, y_max = min(y_vals), max(y_vals)
        x_range = max(x_max - x_min, 1e-9)
        y_range = max(y_max - y_min, 1e-9)
        for p in papers:
            p["x"] = PAD + (p["raw_x"] - x_min) / x_range * (CANVAS_W - 2 * PAD)
            p["y"] = PAD + (p["raw_y"] - y_min) / y_range * (CANVAS_H - 2 * PAD)
    else:
        for p in papers:
            p["x"] = 0.0
            p["y"] = 0.0

    nodes = [
        {"id": i, "aid": p["aid"], "t": p["t"], "au": p["au"],
         "pd": p["pd"], "dm": p["dm"], "ln": p["ln"], "tags": p["tags"],
         "x": p["x"], "y": p["y"], "rx": p["raw_x"], "ry": p["raw_y"]}
        for i, p in enumerate(papers)
    ]

    # Counts every tag a node holds (any rank), matching /api/tags' `size`
    # semantics -- distinct from the pie chart's primary-tag-only counts.
    tags_legend = {
        tag: {"size": count} for tag, count in sorted(tag_counts.items())
    }

    return {
        "meta": {
            "model": TOPIC_EMB_MODEL,
            "embedding_dim": TOPIC_EMB_DIMS,
            "generated_at": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat(),
            "neighbors": None,
            "coords": {
                "included": has_coords,
                "method": "stored-subset" if has_coords else "none",
                "canvas": {"w": CANVAS_W, "h": CANVAS_H, "pad": PAD},
                "bounds": (
                    {"x_min": x_min, "x_max": x_max, "y_min": y_min, "y_max": y_max}
                    if has_coords else None
                ),
            },
            "compact": True,
        },
        "tags": tags_legend,
        "nodes": nodes,
        "links": [],
    }


@router.post("/subset")
@limiter.limit(expensive_limit)
def get_subgraph(request: Request, body: SubsetRequest, conn=Depends(get_conn)):
    try:
        return _build_subgraph(conn, body.ids)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/range")
@limiter.limit(expensive_limit)
def get_range_graph(
    request: Request,
    from_date: dt.date | None = Query(None, alias="from"),
    to_date: dt.date | None = Query(None, alias="to"),
    tags: list[str] = Query(default=[]),
    domain: list[str] = Query(default=[]),
    conn=Depends(get_conn),
):
    """Graph of relevant papers matching the filters (any of `tags`, any of
    `domain`, published in [from, to]), newest first, capped at _MAX_RANGE."""
    return _build_range_graph(conn, from_date, to_date, tags, domain)
