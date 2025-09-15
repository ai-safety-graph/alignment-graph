from __future__ import annotations
import re, sqlite3, numpy as np
from pathlib import Path
from .config import GREEN, YELLOW, BLUE, RESET
from .embeddings import vec_from_bytes

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


def ensure_filter_columns(conn):
    cur = conn.cursor()
    for coldef in [
        "ai_regex_hit INTEGER",
        "ai_sem_sim REAL",
        "ai_stage2_keep INTEGER",
        "ai_stage2_reason TEXT",
        "domain_tag TEXT"
    ]:
        try: cur.execute(f"ALTER TABLE papers ADD COLUMN {coldef}")
        except sqlite3.OperationalError: pass
    try: cur.execute("CREATE INDEX idx_papers_domain_tag ON papers(domain_tag)")
    except sqlite3.OperationalError: pass
    conn.commit()


def cmd_stage1(args):
    conn = sqlite3.connect(args.db); conn.row_factory = sqlite3.Row
    ensure_filter_columns(conn)
    try:
        rows = conn.execute("SELECT id, title, summary, authors, published, link, categories FROM papers_raw").fetchall()
        cur = conn.cursor(); cur.execute("BEGIN")
        copied = 0
        for r in rows:
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
            cur.execute(
              """
              INSERT INTO papers (id, title, authors, published, summary, link, ai_regex_hit, domain_tag)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                authors=excluded.authors,
                published=excluded.published,
                summary=excluded.summary,
                link=excluded.link,
                ai_regex_hit=excluded.ai_regex_hit,
                domain_tag=excluded.domain_tag
            """,
              (r["id"], r["title"], r["authors"], r["published"], r["summary"], r["link"], ai_regex_hit, domain_tag)
            )
            copied += 1
        cur.execute("COMMIT")
        print(f"{GREEN}stage1:{RESET} copied/updated {copied} candidates into `papers`.")
    finally:
        conn.close()


# ---- Stage-2 filter (centroid) ----

def load_vectors(conn, ids):
    if not ids: return {}
    placeholders = ",".join(["?"]*len(ids))
    rows = conn.execute(
        f"SELECT paper_id, dim, vector FROM embeddings WHERE model=? AND paper_id IN ({placeholders})",
        ("specter2", *ids)
    ).fetchall()
    V = {}
    for pid, d, blob in rows:
        import numpy as np
        v = vec_from_bytes(blob, d).astype(np.float32)
        V[pid] = v / (np.linalg.norm(v)+1e-12)
    return V


def build_centroid(conn, seeds_path):
    from pathlib import Path
    import numpy as np
    seed_ids = [ln.strip() for ln in Path(seeds_path).read_text().splitlines() if ln.strip()]
    V = load_vectors(conn, seed_ids)
    if not V:
        raise RuntimeError("No seed embeddings found—ensure seeds exist in `papers` and are embedded.")
    C = np.mean(np.vstack(list(V.values())), axis=0)
    return C / (np.linalg.norm(C)+1e-12)


def cmd_filter(args):
    conn = sqlite3.connect(args.db); conn.row_factory = sqlite3.Row
    ensure_filter_columns(conn)
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
                keep = int(sim >= args.tau)
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