from __future__ import annotations
import datetime as dt, os, time as _time, xml.etree.ElementTree as ET
from pathlib import Path
import requests
from .config import OAI_BASE, OAI_SETS, OAI_PREFIX, OAI_THROTTLE_SEC, STATE_FILE, BLUE, GREEN, RESET
from .db import init_db


def _iso_date(d: dt.date) -> str: return d.strftime("%Y-%m-%d")

def _today_iso() -> str: return _iso_date(dt.date.today())


def _oai_fetch(params: dict) -> str:
    for attempt in range(5):
        if attempt:
            _time.sleep(OAI_THROTTLE_SEC * (attempt + 1))
        r = requests.get(OAI_BASE, params=params, timeout=60)
        if r.ok:
            _time.sleep(OAI_THROTTLE_SEC)
            return r.text
    r.raise_for_status()


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


def harvest_arxiv_oai_to_sqlite_raw(conn, from_date: str | None = None, until_date: str | None = None, state_file: str = STATE_FILE):
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
        scanned, saved = harvest_arxiv_oai_to_sqlite_raw(conn, from_date=args.from_date, until_date=args.until_date, state_file=args.state_file)
        print(f"{GREEN}harvest complete:{RESET} scanned={scanned}, upserts={saved}")
    finally:
        conn.close()