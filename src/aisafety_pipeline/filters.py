from __future__ import annotations

import re
from pathlib import Path

import numpy as np
from psycopg2.extras import execute_values

from .arxiv_ids import normalize_arxiv_id_or_url
from .config import BLUE, GREEN, RESET, YELLOW
from .db import vector_to_array

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
    r"\bsafety evaluations?\b", r"\b(model|capabilit(y|ies)) evaluation\b.*\bsafety\b",
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
    # --- alignment-theory / inner-alignment vocabulary ---
    r"\bsafety[- ]align(ed|ment|ing)?\b", r"\bsafety[- ]tun(ed|ing)\b",
    r"\breward hacking\b", r"\breward tampering\b",
    r"\bmesa[- ]?optimi[sz](ers?|ation)\b",
    r"\bpower[- ]seeking\b|\bseeks?\s+power\b|\bseeking\s+power\b",
    r"\binstrumental convergence\b", r"\bgoal misgeneralization\b",
    r"\boff[- ]switch(es)?\b", r"\bagent alignment\b",
    r"\bRLHF\b|\breinforcement learning from human feedback\b",
    # --- interpretability vocabulary ---
    r"\blatent knowledge\b", r"\bactivation steering\b",
    r"\bmechanistic interpretability\b", r"\brepresentation engineering\b",
    r"\brefusal direction(s)?\b",
    r"\bsparse autoencoders?\b.*\b(language models?|LLMs?|large language models?|interpretab)\b",
    r"\b(language models?|LLMs?|large language models?|interpretab)\b.*\bsparse autoencoders?\b",
    # --- risk/eval vocabulary ---
    r"\bextreme risks?\b", r"\bdangerous capabilit(y|ies)\b",
    # --- bare "safety"/"toxic(ity)" only when co-occurring with LM/LLM context,
    # to avoid matching unrelated ML papers that happen to say "safe"/"aligned" ---
    r"\btoxic(ity)?\b.*\b(language models?|LLMs?|large language models?)\b",
    r"\b(language models?|LLMs?|large language models?)\b.*\btoxic(ity)?\b",
    r"\bsafety\b.*\b(language models?|LLMs?|large language models?)\b",
    r"\b(language models?|LLMs?|large language models?)\b.*\bsafety\b",
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


_SELECT_EXISTING_PAPERS = """
    SELECT id, title, authors, published, summary, link, ai_regex_hit, domain_tag
    FROM papers WHERE id = ANY(%s)
"""


def cmd_stage1(args):
    from .db import connect
    conn = connect(args.db)
    try:
        write_cur = conn.raw_cursor()
        scanned = copied = unchanged = 0
        write_batch: list[tuple] = []

        def flush_writes():
            nonlocal write_batch, copied
            if not write_batch:
                return
            execute_values(write_cur, _UPSERT_PAPERS, write_batch)
            conn.commit()
            copied += len(write_batch)
            write_batch = []
            print(f"{BLUE}stage1 progress:{RESET} scanned={scanned} copied={copied} unchanged_skipped={unchanged}")

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

                # First pass: figure out which rows in this chunk are candidates
                # for `papers` (matched the filter, or --keep-all-and-filter).
                candidates = []
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
                    candidates.append((
                        r["id"], r["title"], r["authors"], r["published"], r["summary"], r["link"],
                        ai_regex_hit, domain_tag,
                    ))

                # Second pass: drop candidates that are already present in `papers`
                # with identical values. `papers` carries a 654MB HNSW index that
                # this upsert never touches (embedding isn't in the column list),
                # but with fillfactor=100 Postgres still can't do a HOT update for
                # most rows (no free space in the heap page for the new tuple
                # version), so a no-op re-upsert still forces a full write to
                # every index on the table. Skipping unchanged rows avoids that
                # write entirely instead of just avoiding the embedding column.
                if candidates:
                    cand_ids = [c[0] for c in candidates]
                    existing = {
                        row["id"]: (
                            row["title"], row["authors"], row["published"],
                            row["summary"], row["link"], row["ai_regex_hit"], row["domain_tag"],
                        )
                        for row in conn.execute(_SELECT_EXISTING_PAPERS, (cand_ids,)).fetchall()
                    }
                    for cid, *rest in candidates:
                        if existing.get(cid) == tuple(rest):
                            unchanged += 1
                            continue
                        write_batch.append((cid, *rest))
                        if len(write_batch) >= _STAGE1_WRITE_BATCH:
                            flush_writes()

                last_id = page[-1]["id"]
            flush_writes()
        except Exception:
            conn.rollback()
            raise

        print(
            f"{GREEN}stage1:{RESET} scanned {scanned} rows, copied/updated {copied} candidates into "
            f"`papers` ({unchanged} already up to date, skipped)."
        )
    finally:
        conn.close()


_STAGE2_WRITE_BATCH = 500

_UPDATE_STAGE2 = """
    UPDATE papers AS p SET
      ai_sem_sim = v.sim,
      ai_stage2_keep = v.keep,
      ai_stage2_reason = v.reason
    FROM (VALUES %s) AS v(id, sim, keep, reason)
    WHERE p.id = v.id
"""

_SELECT_EXISTING_STAGE2 = "SELECT id, ai_sem_sim, ai_stage2_keep FROM papers WHERE id = ANY(%s)"
_STAGE2_READ_CHUNK = 900
# ai_sem_sim is stored as `real` (float32), so a value round-tripped through
# Postgres won't compare bit-equal to the float64 the same computation
# produces in Python; a tolerance well above float32 precision (~1.2e-7
# relative) avoids treating that round-trip noise as a real change.
_SIM_UNCHANGED_TOL = 1e-4

# ---- Stage-2 filter (centroid) ----

def load_vectors(conn, ids, *, model="specter2", chunk_size=900):
    if not ids:
        return {}

    ids = list(ids)
    V = {}
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i:i + chunk_size]
        rows = conn.execute(
            "SELECT id, embedding FROM papers WHERE embedding IS NOT NULL AND id = ANY(%s)",
            (chunk,),
        ).fetchall()
        for pid, vec in rows:
            if vec is not None:
                v = vector_to_array(vec)
                V[pid] = v / (np.linalg.norm(v) + 1e-12)
    return V


def build_centroid(conn, seeds_path):
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
        if args.method != "centroid":
            raise SystemExit(f"--method {args.method!r} is not implemented yet")
        if not args.seeds:
            raise SystemExit("--seeds is required for centroid method")

        ids = [r[0] for r in conn.execute("SELECT id FROM papers").fetchall()]
        if not ids:
            print(f"{YELLOW}filter:{RESET} nothing in `papers`. Run stage1 & embed first."); return
        V = load_vectors(conn, ids)
        C = build_centroid(conn, args.seeds)

        # Existing (sim, keep) per id, so unchanged rows can be skipped below.
        # `papers` carries a 654MB HNSW index that this UPDATE never touches
        # (embedding isn't in the SET list), but with fillfactor=100 Postgres
        # still can't do a HOT update for most rows, so writing a row that
        # didn't actually change still forces a full rewrite of every index
        # on the table. This matters most when re-running `filter` with a
        # different --tau: sim doesn't depend on tau at all, and `keep` only
        # flips for rows near the new threshold, so most rows are unchanged.
        existing: dict[str, tuple] = {}
        for i in range(0, len(ids), _STAGE2_READ_CHUNK):
            chunk = ids[i:i + _STAGE2_READ_CHUNK]
            for row in conn.execute(_SELECT_EXISTING_STAGE2, (chunk,)).fetchall():
                existing[row[0]] = (row[1], row[2])

        write_cur = conn.raw_cursor()
        scanned = kept = rej = missing = unchanged = 0
        all_sims = []
        write_batch: list[tuple] = []

        def flush_writes():
            nonlocal write_batch
            if not write_batch:
                return
            execute_values(
                write_cur, _UPDATE_STAGE2, write_batch,
                template="(%s, %s::real, %s::boolean, %s::text)",
            )
            conn.commit()
            write_batch = []
            print(f"{BLUE}filter progress:{RESET} scanned={scanned} kept={kept} rejected={rej} missing={missing} unchanged_skipped={unchanged}")

        try:
            for pid in ids:
                scanned += 1
                v = V.get(pid)
                if v is None:
                    missing += 1
                    sim, keep, reason = None, None, "missing-embedding"
                else:
                    sim = float(v @ C)
                    all_sims.append(sim)
                    keep = bool(sim >= args.tau)
                    kept += keep; rej += (1 - keep)
                    reason = f"centroid tau={args.tau}"

                prev_sim, prev_keep = existing.get(pid, (None, None))
                sim_unchanged = (sim is None and prev_sim is None) or (
                    sim is not None and prev_sim is not None and abs(float(prev_sim) - sim) < _SIM_UNCHANGED_TOL
                )
                if sim_unchanged and prev_keep == keep:
                    unchanged += 1
                    continue

                write_batch.append((pid, sim, keep, reason))
                if len(write_batch) >= _STAGE2_WRITE_BATCH:
                    flush_writes()
            flush_writes()
        except Exception:
            conn.rollback()
            raise

        if all_sims:
            arr = np.array(all_sims, dtype=float)
            print(f"sim stats: min={arr.min():.3f} p10={np.percentile(arr,10):.3f} median={np.median(arr):.3f} p90={np.percentile(arr,90):.3f} max={arr.max():.3f}")

        print(
            f"{GREEN}filter:{RESET} scanned={scanned} kept={kept} rejected={rej} "
            f"missing_embedding={missing} unchanged_skipped={unchanged} (tau={args.tau})"
        )
    finally:
        conn.close()