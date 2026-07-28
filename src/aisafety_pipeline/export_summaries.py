from __future__ import annotations

import datetime as dt
import gzip
import json
import re
from pathlib import Path
from typing import Optional, Dict, Any

from .config import GREEN, RESET

def _trim(s: Optional[str], max_len: int = 500) -> str:
    if not s:
        return ""
    s = s.strip()
    return (s[:max_len] + "…") if len(s) > max_len else s


def _to_jsonable(obj: Any):
    """Recursively convert NumPy-like types if they appear (defensive)."""
    try:
        import numpy as _np  # optional
    except Exception:  # pragma: no cover
        _np = None

    if isinstance(obj, dict):
        return {str(k): _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_jsonable(v) for v in obj]
    if _np is not None and isinstance(obj, (_np.integer,)):
        return int(obj)
    if _np is not None and isinstance(obj, (_np.floating,)):
        return float(obj)
    if _np is not None and isinstance(obj, (_np.ndarray,)):
        return obj.tolist()
    return obj


_ID_RE = re.compile(r"/(\d{4}\.\d{4,5}(v\d+)?)")


def _normalize_arxiv_id_or_url(s: str) -> str:
    """
    Accepts a bare id like '2401.01234' (with optional vN) or any arXiv URL.
    Returns the canonical abs URL used as `papers.id` in the DB.
    """
    s = (s or "").strip()
    if not s:
        return ""
    if s.startswith(("http://", "https://")):
        m = _ID_RE.search(s)
        return f"https://arxiv.org/abs/{m.group(1)}" if m else s
    return f"https://arxiv.org/abs/{s}"



def export_summaries_json(
    db_path: str | None = None,
    out_path: str = "paper_summaries.json",
    ids_path: Optional[str] = None,          # newline-delimited ids/urls to include
    include_all_kept: bool = True,           # include all ai_stage2_keep=1 if no ids
    only_clustered: bool = False,            # require kmeans_cluster IS NOT NULL
    include_metadata: bool = True,           # include title/authors/published/link
    include_domain: bool = True,             # include domain_tag
    include_cluster_id: bool = True,         # include kmeans_cluster
    include_full_summary: bool = True,       # if False, trim via max_summary_len
    max_summary_len: int = 1000,
    gzip_out: bool = False,
) -> str:
    """
    Emit a compact JSON mapping paper id (abs URL) -> summary (+ optional metadata).

    Schema:
      {
        "meta": { "generated_at": "...", "count": N, "filters": {...} },
        "summaries": {
          "<abs_url>": {
            "sm": "<summary or trimmed>",
            "t": "<title>", "au": "<authors>", "pd": "<YYYY-MM-DD>", "ln": "<link>",
            "dm": "<domain>", "cid": <kmeans_cluster>
          },
          ...
        }
      }
    """
    from .db import connect
    conn = connect(db_path)
    try:
        id_whitelist: Optional[set[str]] = None
        if ids_path:
            p = Path(ids_path)
            if not p.exists():
                raise RuntimeError(f"ids file not found: {ids_path}")
            lines = [ln.strip() for ln in p.read_text(encoding="utf-8").splitlines()]
            norm = [_normalize_arxiv_id_or_url(ln) for ln in lines if ln]
            id_whitelist = {x for x in norm if x}

        where = []
        params: list = []

        if id_whitelist:
            where.append("id = ANY(%s)")
            params.append(list(id_whitelist))

        if include_all_kept and not id_whitelist:
            where.append("ai_stage2_keep")

        if only_clustered:
            where.append("kmeans_cluster IS NOT NULL")

        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        cur = conn.cursor()
        cur.execute(f"""
            SELECT id, title, authors, published, summary, link, kmeans_cluster, domain_tag
            FROM papers
            {where_sql}
            ORDER BY published DESC
        """, params if params else None)
        rows = cur.fetchall()

        if not rows:
            raise RuntimeError("No papers matched the selection. Run earlier stages or adjust filters.")

        summaries: Dict[str, Dict[str, object]] = {}
        for r in rows:
            sm = (r["summary"] or "").strip()
            if not include_full_summary:
                sm = _trim(sm, max_summary_len)
            rec: Dict[str, object] = {"sm": sm}

            if include_metadata:
                rec.update({
                    "t": r["title"] or "",
                    "au": r["authors"] or "",
                    "pd": r["published"] or "",
                    "ln": r["link"] or r["id"],
                })
            if include_domain:
                rec["dm"] = r["domain_tag"] or "unknown"
            if include_cluster_id and r["kmeans_cluster"] is not None:
                rec["cid"] = int(r["kmeans_cluster"])

            summaries[r["id"]] = rec

        payload = {
            "meta": {
                "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                "count": len(summaries),
                "filters": {
                    "ids_path": ids_path is not None,
                    "include_all_kept": bool(include_all_kept),
                    "only_clustered": bool(only_clustered),
                    "include_metadata": bool(include_metadata),
                    "include_domain": bool(include_domain),
                    "include_cluster_id": bool(include_cluster_id),
                    "include_full_summary": bool(include_full_summary),
                    "max_summary_len": int(max_summary_len),
                },
            },
            "summaries": summaries,
        }

        safe_payload = _to_jsonable(payload)
        if gzip_out:
            gz_path = out_path + ".gz"
            with gzip.open(gz_path, "wt", encoding="utf-8") as f:
                json.dump(safe_payload, f, ensure_ascii=False, separators=(",", ":"))
            print(f"{GREEN}export-summaries:{RESET} wrote {gz_path} (papers={len(summaries)})")
            return gz_path
        else:
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(safe_payload, f, ensure_ascii=False, separators=(",", ":"))
            print(f"{GREEN}export-summaries:{RESET} wrote {out_path} (papers={len(summaries)})")
            return out_path
    finally:
        conn.close()

def cmd_export_summaries(args) -> None:
    export_summaries_json(
        db_path=args.db,
        out_path=args.out,
        ids_path=args.ids,
        include_all_kept=not args.only_ids,
        only_clustered=args.only_clustered,
        include_metadata=not args.no_meta,
        include_domain=not args.no_domain,
        include_cluster_id=not args.no_cid,
        include_full_summary=not args.trim,
        max_summary_len=args.max_summary_len,
        gzip_out=args.gzip,
    )
