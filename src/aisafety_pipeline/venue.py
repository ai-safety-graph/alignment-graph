"""Peer-review status and venue for relevant papers, derived from arXiv's
own author-supplied fields (papers_raw.journal_ref / doi / comments).

`classify_venue` is a pure rule set; `cmd_venue` is the pipeline stage that
applies it to `papers`. Rules, strongest signal first:

1. A journal-ref -> reviewed.
2. A publisher DOI (not arXiv's own or a preprint server's) -> reviewed.
3. Comments: an explicit acceptance phrase ("accepted at", "to appear in",
   "published in", "in proceedings of", "camera-ready") -> reviewed, even
   if the comment also mentions a submission elsewhere. Without one, any
   submission/review phrase ("submitted to", "under review") -> unknown.
   Acceptance words that don't report an acceptance ("not accepted",
   "if accepted", "code published on GitHub") don't count, and also rule
   out the venue-mention fallback. Otherwise a known venue with a year
   ("ICML 2026", "AAAI-23") or a "Conference/Workshop/Symposium ... <year>"
   mention -> reviewed, unless that clause names the venue for something
   else (a preprint template, a keynote, a competition).
4. Otherwise unknown (peer_reviewed NULL). Unknown is not "not reviewed":
   absence of a signal says nothing.

Workshop papers count as reviewed but are labelled `venue_type='workshop'`
(and "Workshop" in the venue name) so the UI can tell them apart.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .config import BLUE, GREEN, RESET

# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------

# DOIs that are minted for preprints/data, not for a peer-reviewed version.
_NON_PUBLISHER_DOI_PREFIXES = (
    "10.48550/",  # arXiv
    "10.5281/",   # Zenodo
    "10.13140/",  # ResearchGate
    "10.2139/",   # SSRN
    "10.31219/",  # OSF Preprints
    "10.31234/",  # PsyArXiv
    "10.31235/",  # SocArXiv
    "10.36227/",  # TechRxiv
    "10.20944/",  # Preprints.org
    "10.1101/",   # bioRxiv / medRxiv
    "10.21203/",  # Research Square
    "10.22541/",  # Authorea
    "10.26434/",  # ChemRxiv
)

# Canonical name -> regex alternatives. Matched case-insensitively with word
# boundaries; the canonical spelling is what's displayed.
_CONFERENCES = {
    "NeurIPS": r"neurips|nips|neural\s+information\s+processing\s+systems",
    "ICML": r"icml|international\s+conference\s+on\s+machine\s+learning(?!\s+and)",
    "ICLR": r"iclr|international\s+conference\s+on\s+learning\s+representations",
    "AAAI": r"aaai",
    "IJCAI": r"ijcai",
    "ACL": r"acl",
    "EMNLP": r"emnlp|empirical\s+methods\s+in\s+natural\s+language\s+processing",
    "IJCNLP": r"ijcnlp",
    "NAACL": r"naacl",
    "EACL": r"eacl",
    "AACL": r"aacl",
    "COLING": r"coling",
    "COLM": r"colm",
    "FAccT": r"facct|fat\*",
    "AIES": r"aies",
    "CVPR": r"cvpr",
    "ICCV": r"iccv",
    "ECCV": r"eccv",
    "WACV": r"wacv",
    "KDD": r"kdd|sigkdd",
    "SIGIR": r"sigir",
    "WWW": r"www(?!\.)",
    "CHI": r"chi",
    "CSCW": r"cscw",
    "UAI": r"uai",
    "AISTATS": r"aistats",
    "AAMAS": r"aamas",
    "IROS": r"iros",
    "ICRA": r"icra",
    "CoRL": r"corl",
    "USENIX Security": r"usenix\s+security",
    "NDSS": r"ndss",
    "CCS": r"ccs",
    "IEEE S&P": r"ieee\s+s&p",
    "SaTML": r"satml",
    "ICSE": r"icse",
    "FSE": r"fse",
    "ASE": r"ase",
    "ISSTA": r"issta",
    "ICDE": r"icde",
    "CIKM": r"cikm",
    "WSDM": r"wsdm",
    "ICWSM": r"icwsm",
    "ICASSP": r"icassp",
    "INTERSPEECH": r"interspeech",
    "MICCAI": r"miccai",
    "ECAI": r"ecai",
    "ECML-PKDD": r"ecml(?:[\s-]*pkdd)?",
    "ACM MM": r"acm\s+(?:mm|multimedia)",
    "AIED": r"aied",
    "EDM": r"edm",
    "SIGCSE": r"sigcse",
    "INFOCOM": r"infocom",
    "DAC": r"dac",
}
_JOURNALS = {
    "TMLR": r"tmlr",
    "JMLR": r"jmlr",
    "TPAMI": r"tpami",
    "TACL": r"tacl",
}
_ACRONYMS = {**_CONFERENCES, **_JOURNALS}
_ACRONYM_LOOKUP = [(canon, re.compile(rf"^(?:{alts})$", re.I)) for canon, alts in _ACRONYMS.items()]

# "<VENUE> 2025", "<VENUE>2025", "<VENUE>-23", "<VENUE>'23", "<VENUE> '23",
# "<VENUE> Findings 26". A bare two-digit year needs an apostrophe/hyphen, no
# space, or nothing word-like after it, so "ICML 12 pages" isn't 2012.
_YEAR = r"(?P<year>(?:19|20)\d\d|['’]\s?\d\d|(?<=[a-z*])-?\d\d(?!\d)|(?<=\s)\d\d(?=\s*(?:$|[;,.)\]])))"
_VENUE_YEAR_RE = re.compile(
    rf"(?<![\w/.-])(?P<venue>{'|'.join(f'(?:{a})' for a in _ACRONYMS.values())})"
    rf"(?:\)|[\s-]+(?!\d)[a-z][\w+&-]{{0,14}}){{0,2}}[\s,-]*{_YEAR}",
    re.I,
)
_VENUE_ANY_RE = re.compile(
    rf"(?<![\w/.-])(?P<venue>{'|'.join(f'(?:{a})' for a in _ACRONYMS.values())})(?!\w)",
    re.I,
)

# Explicit acceptance. "if/once/when accepted" is a plan, not a fact.
_POSITIVE_RE = re.compile(
    r"(?<!if )(?<!once )(?<!when )\bacc(?:ept|etp)ed\b"
    r"|(?<!un)\bpublished\b(?!\s+version)"
    r"|\bto\s+(?:be\s+)?appear"
    r"|\bto\s+be\s+published\b"
    r"|\bforthcoming\b"
    r"|\bcamera[\s-]?ready\b"
    r"|\bin\s+(?:the\s+)?proc(?:eedings|\.)"
    r"|^\s*proc(?:eedings|\.)"
    r"|\bpresented\s+at\b"
    r"|\bposter\s+at\b",
    re.I,
)
_NEGATIVE_RE = re.compile(
    r"\bsubmitted\b|\bsubmission\b|\bto\s+submit\b|\bunder[\s-]+(?:peer[\s-]+)?review\b"
    r"|\bunder\s+consideration\b|\brejected\b|\bin\s+review\b",
    re.I,
)
# Says the paper was NOT accepted (yet): negated or conditional acceptance.
# Rules out the venue-mention fallback for the whole comment.
_NEGATED_ACCEPTANCE_RE = re.compile(
    r"\bnot\s+(?:yet\s+)?(?:been\s+)?(?:accepted|published)\b"
    r"|\b(?:if|once|when|until)\s+(?:it\s+is\s+|is\s+)?accepted\b",
    re.I,
)
# Publisher / proceedings hosts: "published at <url>" with one of these is a venue.
_PUBLISHER_HOSTS = (
    r"aclanthology|proceedings\.mlr|openreview|(?:dx\.)?doi\.org|ieeexplore|dl\.acm|link\.springer"
    r"|sciencedirect|papers\.nips|proceedings\.neurips|neurips\.cc|ojs\.aaai|jmlr|ijcai|nature\.com"
    r"|science\.org|journals\.|onlinelibrary\.wiley|tandfonline|mdpi"
)
# An acceptance word that doesn't report an acceptance, within one part of a
# clause: the above, "published"/"available" as a condition, or "published"
# about a code/data/blog host rather than a venue.
_NOT_ACCEPTANCE_RE = re.compile(
    _NEGATED_ACCEPTANCE_RE.pattern
    + r"|\b(?:if|once|when|until)\s+(?:it\s+is\s+|is\s+)?(?:available|published)\b"
    + rf"|\bpublished\s+(?:on|at)\s+(?:https?://|www\.)(?!(?:www\.)?(?:{_PUBLISHER_HOSTS}))"
    + r"|\bpublished\s+(?:on|at|to|in)\s+(?:the\s+)?(?:github|hugging\s*face|arxiv|ssrn|zenodo"
    r"|medium|substack|lesswrong|(?:ai\s+)?alignment\s+forum|our\b|my\b)",
    re.I,
)
# A clause naming a venue for something other than this paper's acceptance.
# Only used for the venue-mention fallback (no acceptance phrase).
# Capitalised "Challenge" is a named challenge ("LLM Efficiency Challenge");
# lower-case "the challenge of jailbreaks" isn't. "Best paper winner" stays.
_NOT_A_PAPER_VENUE_RE = re.compile(
    r"\b(?:19|20)\d\d\s+preprint\b|\btemplate\b|\bkeynote\b|\bnon-archival\b"
    r"|\bcompetition\b|(?-i:\bChallenge\b)|\bshared\s+task\b"
    r"|\b(?:challenge|competition|track)\s+winners?\b|\bwinning\s+(?:solution|entry|team)\b"
    r"|\b\d+(?:st|nd|rd|th)\s+place\b",
    re.I,
)
_GENERIC_VENUE_RE = re.compile(
    r"\b(?:conference|symposium|workshop)\b[^;.]{0,120}?\b(?:19|20)\d\d\b"
    r"|\b(?:19|20)\d\d\b[^;.]{0,120}?\b(?:conference|symposium|workshop)\b",
    re.I,
)
# A venue named in full with no year ("The 54th Annual IEEE/IFIP International
# Conference on Dependable Systems", "The International Journal of ...").
_NAMED_VENUE_RE = re.compile(
    r"\b(?:international|annual)\s+(?:[\w/-]+\s+){0,3}(?:conference|symposium|workshop)\s+on\b"
    r"|\binternational\s+journal\s+of\b",
    re.I,
)
_WORKSHOP_RE = re.compile(r"\bworkshops?\b", re.I)
_JOURNAL_RE = re.compile(r"\bjournal\b|\btransactions\b|\btrans\.|\bletters\b|\bvol(?:ume|\.)\s*\d", re.I)
_CONFERENCE_RE = re.compile(r"\bconference\b|\bsymposium\b|\bproceedings\b|\bproc\.|\bmeeting\b", re.I)
# Text that follows an acceptance phrase is usually the venue.
_AFTER_PHRASE_RE = re.compile(
    r"(?:accepted|published|appear|forthcoming|presented|proceedings of)"
    r"(?:\s+(?:paper|work|as\s+an?\s+[\w\s-]+?|for\s+(?:presentation|publication)))?"
    r"(?:\s+(?:at|to|in|by|on|of)\s+|\s*:\s*)"
    r"(?:the\s+)?(?P<rest>[^;(\n]+)",
    re.I,
)

_VENUE_MAX_LEN = 80


@dataclass(frozen=True)
class VenueResult:
    peer_reviewed: bool | None
    venue: str | None
    venue_type: str  # conference | workshop | journal | unknown
    source: str | None  # journal_ref | doi | comments | None


UNKNOWN = VenueResult(None, None, "unknown", None)


def _canonical(raw: str) -> str:
    for canon, rx in _ACRONYM_LOOKUP:
        if rx.match(raw.strip()):
            return canon
    return raw


def _norm_year(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    return digits if len(digits) == 4 else f"20{digits}"


def _acronym_venue(text: str) -> str | None:
    """"ICML 2026", "EMNLP 2025 Findings", "NeurIPS 2025 Workshop", or just
    "TMLR" when no year is given."""
    m = _VENUE_YEAR_RE.search(text)
    if m:
        name = f"{_canonical(m['venue'])} {_norm_year(m['year'])}"
    else:
        m = _VENUE_ANY_RE.search(text)
        if not m:
            return None
        name = _canonical(m["venue"])
    if re.search(r"\bfindings\b", text, re.I):
        name += " Findings"
    if _WORKSHOP_RE.search(text):
        name += " Workshop"
    return name


# "Surname, X." -- a citation of the paper itself, not a venue name.
_CITATION_RE = re.compile(r"^[A-Z][\w'’-]+,\s+[A-Z]\.")


_GENERIC_WORD_RE = re.compile(r"^(?:an?\s+)?(?:conference|workshop|journal|symposium)s?$", re.I)


def _clip(text: str) -> str | None:
    text = text.strip(" ,.:;-–")
    if len(text) < 4 or _CITATION_RE.match(text) or _GENERIC_WORD_RE.match(text):
        return None
    if len(text) > _VENUE_MAX_LEN:
        text = text[: _VENUE_MAX_LEN - 1].rstrip() + "…"
    return text


def _phrase_venue(text: str) -> str | None:
    m = _AFTER_PHRASE_RE.search(text)
    if not m:
        return None
    rest = re.split(r"\.\s|,\s*\d|\s[-–]\s", m["rest"], maxsplit=1)[0]
    return _clip(rest)


def _journal_ref_venue(jr: str) -> str | None:
    if jr.lower().startswith("http"):
        return None
    if _CITATION_RE.match(jr):
        return None
    return _clip(re.split(r",\s|\s\(", jr, maxsplit=1)[0])


def _venue_type(text: str, venue: str | None) -> str:
    if _WORKSHOP_RE.search(text):
        return "workshop"
    if venue:
        base = venue.split(" ")[0]
        if base in _JOURNALS:
            return "journal"
        if _canonical(base) in _CONFERENCES or venue.startswith(("USENIX Security", "IEEE S&P", "ACM MM")):
            return "conference"
    if _JOURNAL_RE.search(text):
        return "journal"
    if _CONFERENCE_RE.search(text):
        return "conference"
    return "unknown"


_DOI_URL_PREFIX_RE = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", re.I)


def _is_publisher_doi(doi: str | None) -> bool:
    bare = _DOI_URL_PREFIX_RE.sub("", (doi or "").strip()).lower()
    return bool(bare) and not bare.startswith(_NON_PUBLISHER_DOI_PREFIXES)


def _clauses(comments: str) -> list[str]:
    # Split on ";", " | " and ". " before a capital, so "Proc. of the ..." stays whole.
    return re.split(r";|\s\|\s|\.\s+(?=[A-Z])", comments)


def _states_acceptance(clause: str) -> bool:
    """An acceptance phrase that isn't negated, conditional or about a code
    host. Checked per part (split on commas and brackets) so "Accepted at X,
    code published on GitHub" and "Accepted at X (not yet published)" still
    count."""
    return any(
        _POSITIVE_RE.search(part) and not _NOT_ACCEPTANCE_RE.search(part)
        for part in re.split(r"[,()\[\]]", clause)
    )


def _comments_say_reviewed(comments: str) -> bool:
    clauses = _clauses(comments)
    if any(_states_acceptance(c) for c in clauses):
        return True
    if _NEGATIVE_RE.search(comments) or _NEGATED_ACCEPTANCE_RE.search(comments):
        return False
    mentions = " ; ".join(c for c in clauses if not _NOT_A_PAPER_VENUE_RE.search(c))
    return bool(
        _VENUE_YEAR_RE.search(mentions)
        or _GENERIC_VENUE_RE.search(mentions)
        or _NAMED_VENUE_RE.search(mentions)
    )


def _comments_venue(comments: str) -> tuple[str | None, str]:
    """Venue name and type from the comments. Looks first at the clause with
    the acceptance phrase ("Accepted at X; extended version submitted to Y"
    names X), then at the rest minus submission/review clauses."""
    clauses = _clauses(comments)
    accepted = next((c for c in clauses if _states_acceptance(c)), None)
    rest = " ; ".join(
        c for c in clauses
        if c is not accepted and not _NEGATIVE_RE.search(c) and not _NOT_A_PAPER_VENUE_RE.search(c)
    )
    usable = " ; ".join(t for t in (accepted, rest) if t)
    for text in (accepted, rest):
        if not text:
            continue
        venue = _acronym_venue(text) or _phrase_venue(text)
        if venue and re.match(r"(?:https?://|www\.)", venue):
            venue = None  # a link, not a venue name
        if venue:
            vtype = _venue_type(text, venue)
            # The type word ("Proceedings", "Journal") may sit in another clause.
            return venue, vtype if vtype != "unknown" else _venue_type(usable, venue)
    vtype = _venue_type(usable, None)
    return ("Workshop" if vtype == "workshop" else None), vtype


def classify_venue(journal_ref: str | None, doi: str | None, comments: str | None) -> VenueResult:
    jr = (journal_ref or "").strip()
    cm = (comments or "").strip()
    cm_reviewed = bool(cm) and _comments_say_reviewed(cm)

    if jr:
        venue = _acronym_venue(jr) or _journal_ref_venue(jr)
        return VenueResult(True, venue, _venue_type(jr, venue), "journal_ref")

    if _is_publisher_doi(doi):
        venue, vtype = _comments_venue(cm) if cm_reviewed else (None, "unknown")
        return VenueResult(True, venue, vtype, "doi")

    if cm_reviewed:
        venue, vtype = _comments_venue(cm)
        return VenueResult(True, venue, vtype, "comments")

    return UNKNOWN


# ---------------------------------------------------------------------------
# Pipeline stage
# ---------------------------------------------------------------------------

_STATE_KEY = "venue_watermark"
_WRITE_BATCH = 1000

# Relevant papers never derived, plus relevant papers re-harvested since the
# last run (an author added a journal-ref or edited the comments). The
# second half uses idx_papers_raw_harvested_at like stage 1.
_SELECT_PENDING = """
    SELECT p.id, r.journal_ref, r.doi, r.comments, p.venue_source
    FROM papers p JOIN papers_raw r ON r.id = p.id
    WHERE p.llm_relevant AND p.venue_derived_at IS NULL
    UNION
    SELECT p.id, r.journal_ref, r.doi, r.comments, p.venue_source
    FROM papers_raw r JOIN papers p ON p.id = r.id
    WHERE r.harvested_at > %s::timestamptz AND r.harvested_at <= %s AND p.llm_relevant
"""
_SELECT_ALL = """
    SELECT p.id, r.journal_ref, r.doi, r.comments, p.venue_source
    FROM papers p JOIN papers_raw r ON r.id = p.id
    WHERE p.llm_relevant
"""
# The cast matters: a batch where every value is NULL makes Postgres type the
# VALUES column as text.
_UPDATE = """
    UPDATE papers AS p SET
      peer_reviewed = v.peer_reviewed::boolean, venue = v.venue, venue_type = v.venue_type,
      venue_source = v.venue_source, venue_derived_at = now()
    FROM (VALUES %s) AS v(id, peer_reviewed, venue, venue_type, venue_source)
    WHERE p.id = v.id
"""
_TOUCH = "UPDATE papers SET venue_derived_at = now() WHERE id = ANY(%s)"


def derive_venues(conn, full: bool = False) -> dict[str, int]:
    """Apply classify_venue to pending relevant papers and write the result.
    Returns counts by outcome. Commits per batch."""
    from psycopg2.extras import execute_values

    from .db import get_state, set_state

    cutoff = conn.execute("SELECT max(harvested_at) AS m FROM papers_raw").fetchone()["m"]
    watermark = None if full else get_state(conn, _STATE_KEY)
    if full:
        rows = conn.execute(_SELECT_ALL).fetchall()
    else:
        # No watermark yet: both halves match every relevant paper on a first
        # run (all are NULL-derived and harvested after epoch); UNION dedupes.
        since = watermark["harvested_at"] if watermark else "epoch"
        rows = conn.execute(_SELECT_PENDING, (since, cutoff or "epoch")).fetchall()

    counts = {"reviewed": 0, "unknown": 0, "kept_openalex": 0}
    updates: list[tuple] = []
    touch: list[str] = []
    cur = conn.raw_cursor()

    def flush():
        nonlocal updates, touch
        if updates:
            execute_values(cur, _UPDATE, updates)
        if touch:
            cur.execute(_TOUCH, (touch,))
        conn.commit()
        updates, touch = [], []

    for r in rows:
        res = classify_venue(r["journal_ref"], r["doi"], r["comments"])
        if res.peer_reviewed is None and r["venue_source"] == "openalex":
            # OpenAlex found a venue the arXiv fields don't show; don't let
            # a re-derivation erase it.
            touch.append(r["id"])
            counts["kept_openalex"] += 1
        else:
            updates.append((r["id"], res.peer_reviewed, res.venue, res.venue_type, res.source))
            counts["reviewed" if res.peer_reviewed else "unknown"] += 1
        if len(updates) + len(touch) >= _WRITE_BATCH:
            flush()
    flush()

    if cutoff is not None:
        set_state(conn, _STATE_KEY, {"harvested_at": cutoff.isoformat()})
    return counts


def cmd_venue(args):
    from .db import connect
    conn = connect(args.db)
    try:
        print(f"{BLUE}venue:{RESET} deriving peer-review status" + (" (full)" if args.full else ""))
        counts = derive_venues(conn, full=args.full)
        print(
            f"{GREEN}venue:{RESET} {counts['reviewed']} reviewed, {counts['unknown']} unknown"
            + (f", {counts['kept_openalex']} kept from OpenAlex" if counts["kept_openalex"] else "")
        )
    finally:
        conn.close()
