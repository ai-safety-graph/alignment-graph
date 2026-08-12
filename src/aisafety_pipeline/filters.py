from __future__ import annotations
import re, numpy as np
from pathlib import Path
from psycopg2.extras import execute_values
from .config import GREEN, YELLOW, BLUE, RESET
from .arxiv_ids import normalize_arxiv_id_or_url

_STAGE1_READ_CHUNK = 2000
_STAGE1_WRITE_BATCH = 500

_UPSERT_PAPERS = """
    INSERT INTO papers (id, title, authors, published, summary, link, ai_regex_hit, domain_tag)
    VALUES %s
    ON CONFLICT (id) DO UPDATE SET
      title=EXCLUDED.title,
      authors=EXCLUDED.authors,
      published=EXCLUDED.published,
      summary=EXCLUDED.summary,
      link=EXCLUDED.link,
      ai_regex_hit=EXCLUDED.ai_regex_hit,
      domain_tag=EXCLUDED.domain_tag
"""

_AI_SAFETY_PATTERNS = [
    r"\bAI safety\b", r"\bAI alignment\b", r"\bvalue alignment\b",
    r"\bcorrigib", r"\bsafe reinforcement learning\b",
    r"\bsafety evaluation\b", r"\b(model|capabilit(y|ies)) evaluation\b.*\bsafety\b",
    r"\bred[- ]?teaming\b", r"\bjailbreak(s|ing)?\b",
    r"\bfrontier model(s)?\b.*\bsafety\b",
    r"\b(system prompt|model spec(ification)?)\b.*\bsafety\b",
    r"\bAI security\b", r"\b(model (security|exfiltration)|guardrail|risk mitigation)\b",
    r"\bAI (governance|governance framework|safety governance)\b",
    r"\b(governance|oversight|accountability|compliance|assurance)\b.*\b(AI|model|system)s?\b",
    r"\b(AI|model|system)s?\b.*\b(oversight|governance|accountability|assurance)\b",
    r"\b(risk (management|assessment)|impact assessment|RIA)\b.*\b(AI|model|system)s?\b",
    r"\b(policy|policies|regulation|regulatory|legislation|law|standard(s)?)\b.*\b(AI|model|system)s?\b",
    r"\b(AI|model|system)s?\b.*\b(policy|regulation|standards?|compliance)\b",
    r"\bassurance case(s)?\b|\bsafety case(s)?\b.*\b(AI|model|system)s?\b",
    r"\bmodel cards?\b|\bsystem cards?\b|\bAI incident(s)?\b|\bpostmortem(s)?\b",
    r"\bresponsible AI\b|\btrustworthy AI\b.*\b(governance|policy|standard|assurance)\b",
    r"\bred team(ing)?\b.*\b(governance|policy|safety)\b",
    r"\b(taxonomy|framework|benchmark|standardization)\b.*\b(safety|risk|governance)\b.*\b(AI|model|system)s?\b",
    r"\bEU AI Act\b|\bAI Act\b|\bNIST AI RMF\b|\bISO/IEC\s*42001\b|\bISO/IEC\s*23894\b",
]
_AI_RE = re.compile("|".join(_AI_SAFETY_PATTERNS), re.IGNORECASE)
_POLICYish_CATS = ("cs.CY", "cs.SI", "cs.CR")


def _looks_like_ai_safety(title: str, abstract: str) -> bool:
    return bool(_AI_RE.search((title or "") + "\n" + (abstract or "")))


def _policyish(categories: str) -> bool:
    cats = set((categories or "").split())
    if any(c.startswith("econ.") for c in cats):   # economics domains
        return True
    return any(c in cats for c in _POLICYish_CATS)


def domain_from_arxiv_categories(categories: str) -> str:
    cats = set((categories or "").split())
    gov  = any(c.startswith("econ.") for c in cats)
    tech = any(c.startswith("cs.") or c.startswith("stat.") for c in cats)
    if gov and tech: return "both"
    if gov: return "gov"
    if tech: return "tech"
    return "unknown"


def cmd_stage1(args):
    from .db import connect
    conn = connect(args.db)
    try:
        write_cur = conn.raw_cursor()
        scanned = copied = 0
        write_batch: list[tuple] = []

        def flush_writes():
            nonlocal write_batch, copied
            if not write_batch:
                return
            execute_values(write_cur, _UPSERT_PAPERS, write_batch)
            conn.commit()
            copied += len(write_batch)
            write_batch = []
            print(f"{BLUE}stage1 progress:{RESET} scanned={scanned} copied={copied}")

        try:
            last_id = ""
            while True:
                page = conn.execute(
                    "SELECT id, title, summary, authors, published, link, categories "
                    "FROM papers_raw WHERE id > %s ORDER BY id LIMIT %s",
                    (last_id, _STAGE1_READ_CHUNK),
                ).fetchall()
                if not page:
                    break
                for r in page:
                    scanned += 1
                    title, summary, cats = r["title"], r["summary"], (r["categories"] or "")
                    text_hit = _looks_like_ai_safety(title, summary)
                    cat_hit = False
                    if (not text_hit) and _policyish(cats):
                        cat_hit = bool(re.search(r"\b(AI|artificial intelligence|foundation model|frontier model|LLM|model|system)s?\b", (title or "") + " " + (summary or ""), re.I))
                    hit = int(text_hit or cat_hit)
                    if not hit and not args.keep_all_and_filter:
                        continue
                    ai_regex_hit = int(text_hit)
                    domain_tag = domain_from_arxiv_categories(cats)
                    write_batch.append(
                        (r["id"], r["title"], r["authors"], r["published"], r["summary"], r["link"], ai_regex_hit, domain_tag)
                    )
                    if len(write_batch) >= _STAGE1_WRITE_BATCH:
                        flush_writes()
                last_id = page[-1]["id"]
            flush_writes()
        except Exception:
            conn.rollback()
            raise

        print(f"{GREEN}stage1:{RESET} scanned {scanned} rows, copied/updated {copied} candidates into `papers`.")
    finally:
        conn.close()


# ---- Stage-2 filter (centroid) ----

def load_vectors(conn, ids, *, model="specter2", chunk_size=900):
    if not ids:
        return {}

    V = {}
    rows = conn.execute(
        "SELECT id, embedding FROM papers WHERE embedding IS NOT NULL AND id = ANY(%s)",
        (list(ids),),
    ).fetchall()
    for pid, vec in rows:
        if vec is not None:
            v = np.array(vec, dtype=np.float32)
            V[pid] = v / (np.linalg.norm(v) + 1e-12)
    return V


def build_centroid(conn, seeds_path):
    from pathlib import Path
    import numpy as np
    raw_lines = [ln.strip() for ln in Path(seeds_path).read_text().splitlines() if ln.strip()]
    seed_ids = sorted({normalize_arxiv_id_or_url(ln) for ln in raw_lines} - {""})
    V = load_vectors(conn, seed_ids)
    if not V:
        raise RuntimeError("No seed embeddings found—ensure seeds exist in `papers` and are embedded.")
    missing = [sid for sid in seed_ids if sid not in V]
    if missing:
        print(f"{YELLOW}filter:{RESET} {len(missing)} seed(s) not found/embedded in `papers`: {', '.join(missing)}")
    C = np.mean(np.vstack(list(V.values())), axis=0)
    return C / (np.linalg.norm(C)+1e-12)


def cmd_filter(args):
    from .db import connect
    conn = connect(args.db)
    try:
        ids = [r[0] for r in conn.execute("SELECT id FROM papers").fetchall()]
        if not ids:
            print(f"{YELLOW}filter:{RESET} nothing in `papers`. Run stage1 & embed first."); return
        V = load_vectors(conn, ids)
        kept = rej = 0
        all_sims = []
        cur = conn.cursor(); cur.execute("BEGIN")

        if args.method == "centroid":
            if not args.seeds: raise SystemExit("--seeds is required for centroid method")
            C = build_centroid(conn, args.seeds)
            for pid in ids:
                v = V.get(pid)
                if v is None:
                    cur.execute("UPDATE papers SET ai_stage2_keep=NULL, ai_stage2_reason=? WHERE id=?", ("missing-embedding", pid))
                    continue
                sim = float(v @ C)
                all_sims.append(sim)
                keep = bool(sim >= args.tau)
                cur.execute("UPDATE papers SET ai_sem_sim=?, ai_stage2_keep=?, ai_stage2_reason=? WHERE id=?", (sim, keep, f"centroid tau={args.tau}", pid))
                kept += keep; rej += (1-keep)
            if all_sims:
                import numpy as np
                arr = np.array(all_sims, dtype=float)
                print(f"sim stats: min={arr.min():.3f} p10={np.percentile(arr,10):.3f} median={np.median(arr):.3f} p90={np.percentile(arr,90):.3f} max={arr.max():.3f}")
        else:
            pass

        cur.execute("COMMIT")
        print(f"{GREEN}filter:{RESET} kept={kept} rejected={rej} (tau={args.tau})")
    finally:
        conn.close()