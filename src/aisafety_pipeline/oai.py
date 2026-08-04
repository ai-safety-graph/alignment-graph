from __future__ import annotations
import datetime as dt, os, time as _time, xml.etree.ElementTree as ET, random
from pathlib import Path
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from .config import OAI_BASE, OAI_SETS, OAI_PREFIX, OAI_THROTTLE_SEC, STATE_FILE, BLUE, GREEN, RESET

# ---- Session with retries & polite UA ----
_SESSION: requests.Session | None = None

def _get_session() -> requests.Session:
    global _SESSION
    if _SESSION is not None:
        return _SESSION
    s = requests.Session()
    retry = Retry(
        total=8,                      # overall cap
        connect=5,                    # connection-level retries
        read=5,                       # read timeouts / incomplete reads
        backoff_factor=1.5,           # 0, 1.5, 3.0, 6.0, 12.0, ...
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        respect_retry_after_header=True,
        raise_on_status=False,        # let us inspect responses
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=8)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    ua = os.getenv("AIS_USER_AGENT", "aisafety-pipeline/1.0 (+contact: your-email@example.com)")
    s.headers.update({"User-Agent": ua, "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8"})
    _SESSION = s
    return s

def _iso_date(d: dt.date) -> str: return d.strftime("%Y-%m-%d")
def _today_iso() -> str: return _iso_date(dt.date.today())

def _sleep_with_jitter(base: float):
    # adds 0–30% jitter to avoid thundering herd
    _time.sleep(base * (1.0 + 0.3 * random.random()))

def _oai_fetch(params: dict) -> str:
    """
    Robust fetch that:
      - retries on read/connect timeout and 5xx/429
      - honors 503 Retry-After
      - applies polite throttle between successful requests
    """
    s = _get_session()
    # Slightly longer read timeout; separate connect/read tuple
    timeout = (10, 120)  # connect=10s, read=120s
    attempts = 6
    for attempt in range(attempts):
        try:
            r = s.get(OAI_BASE, params=params, timeout=timeout, allow_redirects=True)
            # If arXiv asks us to wait (503 + Retry-After), honor it explicitly
            if r.status_code == 503:
                ra = r.headers.get("Retry-After")
                if ra:
                    try:
                        secs = int(ra)
                    except ValueError:
                        secs = 10
                else:
                    secs = 10
                _sleep_with_jitter(secs)
                continue
            r.raise_for_status()
            # Success
            _sleep_with_jitter(OAI_THROTTLE_SEC)
            return r.text
        except (requests.exceptions.ReadTimeout,
                requests.exceptions.ConnectTimeout,
                requests.exceptions.ChunkedEncodingError,
                requests.exceptions.ConnectionError) as e:
            # exponential backoff with jitter
            backoff = OAI_THROTTLE_SEC * (2 ** attempt)
            _sleep_with_jitter(backoff)
            if attempt == attempts - 1:
                raise
        except requests.exceptions.HTTPError as e:
            # For persistent 4xx (other than 429) there's no point in retrying.
            if 400 <= r.status_code < 500 and r.status_code != 429:
                raise
            # Otherwise, let Retry + our loop handle it
            backoff = OAI_THROTTLE_SEC * (2 ** attempt)
            _sleep_with_jitter(backoff)
    # Should be unreachable
    raise RuntimeError("Exhausted retries calling arXiv OAI-PMH")

def _oai_iter_records(from_date: str, until_date: str, oai_set: str):
    params = {
        "verb": "ListRecords",
        "metadataPrefix": OAI_PREFIX,
        "set": oai_set,
        "from": from_date,
        "until": until_date,
    }
    token = None
    while True:
        q = {"verb": "ListRecords", "resumptionToken": token} if token else params
        xml = _oai_fetch(q)
        root = ET.fromstring(xml)
        ns = {"oai": "http://www.openarchives.org/OAI/2.0/"}
        for rec in root.findall(".//oai:ListRecords/oai:record", ns):
            yield rec
        rt = root.find(".//oai:ListRecords/oai:resumptionToken", ns)
        token = rt.text.strip() if (rt is not None and rt.text) else None
        if not token:
            break


def _oai_parse_record(rec) -> dict | None:
    ns = {"oai": "http://www.openarchives.org/OAI/2.0/", "arxiv": "http://arxiv.org/OAI/arXiv/"}
    header = rec.find("./oai:header", ns)
    if header is None or header.get("status") == "deleted":
        return None
    md = rec.find("./oai:metadata/arxiv:arXiv", ns)
    if md is None:
        return None

    def tx(path): return md.findtext(path, default="", namespaces=ns)

    arxiv_id = (tx("arxiv:id") or "").strip()
    if not arxiv_id:
        return None

    authors = []
    for a in md.findall("arxiv:authors/arxiv:author", ns):
        fore = (a.findtext("arxiv:forenames", default="", namespaces=ns) or "").strip()
        last = (a.findtext("arxiv:keyname", default="", namespaces=ns) or "").strip()
        nm = (fore + " " + last).strip()
        if nm:
            authors.append(nm)

    created = (tx("arxiv:created") or "").strip()
    abs_url = f"https://arxiv.org/abs/{arxiv_id}"
    pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"

    return {
        "id": abs_url,
        "title": (tx("arxiv:title") or "").strip(),
        "authors": ", ".join(authors),
        "published": created,
        "summary": (tx("arxiv:abstract") or "").strip(),
        "link": abs_url,
        "pdf_url": pdf_url,
        "categories": (tx("arxiv:categories") or "").strip(),
        "updated": (tx("arxiv:updated") or "").strip(),
    }


def harvest_arxiv_oai_to_papers_raw(conn, from_date: str | None = None, until_date: str | None = None, state_file: str = STATE_FILE):
    if not until_date:
        until_date = _today_iso()
    if not from_date:
        if os.path.exists(state_file):
            from_date = Path(state_file).read_text().strip() or "2005-09-16"
        else:
            from_date = "2005-09-16"

    print(f"{BLUE}OAI-PMH harvest {RESET}{OAI_SETS}{BLUE} {from_date} → {until_date}{RESET}")

    scanned = saved = 0
    cur = conn.cursor(); cur.execute("BEGIN")
    try:
        for oset in OAI_SETS:
            for rec_xml in _oai_iter_records(from_date, until_date, oset):
                scanned += 1
                rec = _oai_parse_record(rec_xml)
                if not rec:
                    continue
                cur.execute(
                    """
                    INSERT INTO papers_raw (id, title, authors, published, summary, link, categories, updated, pdf_url)
                    VALUES (:id, :title, :authors, :published, :summary, :link, :categories, :updated, :pdf_url)
                    ON CONFLICT(id) DO UPDATE SET
                      title=excluded.title, authors=excluded.authors, published=excluded.published,
                      summary=excluded.summary, link=excluded.link,
                      categories=excluded.categories, updated=excluded.updated, pdf_url=excluded.pdf_url
                """, rec)
                saved += 1
        cur.execute("COMMIT")
    except Exception:
        cur.execute("ROLLBACK"); raise

    Path(state_file).write_text(until_date)
    print(f"{GREEN}OAI done.{RESET} scanned={scanned} saved={saved} (state → {state_file})")
    return scanned, saved


def cmd_harvest(args):
    from .db import init_db
    conn = init_db(args.db)
    try:
        scanned, saved = harvest_arxiv_oai_to_papers_raw(conn, from_date=args.from_date, until_date=args.until_date, state_file=args.state_file)
        print(f"{GREEN}harvest complete:{RESET} scanned={scanned}, upserts={saved}")
    finally:
        conn.close()