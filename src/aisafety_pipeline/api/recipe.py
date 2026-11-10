"""The WHERE clause of a graph recipe, shared by /api/graph/range and
/api/papers so a recipe's graph and its Browse listing always match the same
papers. Every facet is "any of" within itself and ANDed with the others."""

from __future__ import annotations

import datetime as dt
import re

from fastapi import HTTPException

from ..db import PAPER_TEXT_EXPR

# Per-facet caps for the free-text facets; the UI enforces the same.
MAX_TERMS = 10
MAX_TERM_LENGTH = 80
# A keyword needs a trigram to use idx_papers_text_trgm, and pg_trgm only
# indexes letters and digits: "RL" (too short) or "C++" (one alphanumeric)
# scan every relevant abstract instead (seconds on prod). Only the length is
# enforced: rejecting "C++" would block real keywords, and an unindexed
# keyword costs no more than `/api/papers?q=`, which always scans.
MIN_KEYWORD_LENGTH = 3

# Characters special in a Postgres ARE outside a bracket expression. Escaping
# `*` also defuses the `***:` / `***=` director prefixes, and `(` the `(?...)`
# embedded options.
_ARE_SPECIAL = re.compile(r"([\\.^$*+?()\[\]{}|])")
_WS = re.compile(r"\s+")


def _are_escape(text: str) -> str:
    return _ARE_SPECIAL.sub(r"\\\1", text)


def keyword_pattern(kw: str) -> str:
    """Case-insensitive ARE matching `kw` at a word start in title/abstract.
    A prefix match, so "jailbreak" also finds "jailbreaks"; inner whitespace
    matches any run (abstracts contain line breaks)."""
    words = kw.split()
    body = r"\s+".join(_are_escape(w) for w in words)
    # \m needs a word character after it, so skip it for e.g. "(foo".
    return (r"\m" + body) if re.match(r"\w", words[0]) else body


def author_pattern(name: str) -> str:
    """ARE matching `name` as a whole entry in the ", "-joined authors column
    (see oai.py), so "Li" doesn't match "Liang" or "Oliver"."""
    body = r"\s+".join(_are_escape(w) for w in name.split())
    return rf"(^|,\s*){body}\s*(,|$)"


def clean_terms(values: list[str], param: str, min_length: int = 1) -> list[str]:
    """Trim, drop blanks and duplicates (case-insensitive), and enforce caps."""
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        v = _WS.sub(" ", v).strip()
        if not v or v.lower() in seen:
            continue
        if len(v) < min_length:
            raise HTTPException(
                status_code=422,
                detail=f"each {param} must be at least {min_length} characters",
            )
        if len(v) > MAX_TERM_LENGTH:
            raise HTTPException(
                status_code=422,
                detail=f"each {param} must be at most {MAX_TERM_LENGTH} characters",
            )
        seen.add(v.lower())
        out.append(v)
    if len(out) > MAX_TERMS:
        raise HTTPException(
            status_code=422,
            detail=f"{param} must contain at most {MAX_TERMS} items",
        )
    return out


def recipe_where(
    *,
    tags: list[str],
    domains: list[str],
    from_date: dt.date | str | None,
    to_date: dt.date | str | None,
    peer_reviewed: bool,
    keywords: list[str],
    authors: list[str],
) -> tuple[list[str], list]:
    """Clauses (to AND together) and their params. `keywords`/`authors` are
    expected to have been through clean_terms."""
    where = ["llm_relevant = TRUE"]
    params: list = []
    if tags:
        where.append("llm_tags && %s")
        params.append(tags)
    if domains:
        where.append("domain_tag = ANY(%s)")
        params.append(domains)
    # `published` is TEXT (YYYY-MM-DD), so compare as ISO strings.
    if from_date:
        where.append("published >= %s")
        params.append(from_date.isoformat() if isinstance(from_date, dt.date) else from_date)
    if to_date:
        where.append("published <= %s")
        params.append(to_date.isoformat() if isinstance(to_date, dt.date) else to_date)
    if peer_reviewed:
        # Bare column (not `IS TRUE`) so it matches the predicate of
        # idx_papers_reviewed_published.
        where.append("peer_reviewed")
    # One alternation per facet, not `~* ANY(array)`: GIN can't serve an
    # array of patterns, so that form falls back to a heap scan.
    if keywords:
        where.append(f"{PAPER_TEXT_EXPR} ~* %s")
        params.append(_any_of(keyword_pattern(k) for k in keywords))
    if authors:
        where.append("authors ~* %s")
        params.append(_any_of(author_pattern(a) for a in authors))
    return where, params


def _any_of(patterns) -> str:
    return "|".join(f"(?:{p})" for p in patterns)
