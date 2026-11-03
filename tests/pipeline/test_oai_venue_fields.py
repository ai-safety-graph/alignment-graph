from __future__ import annotations

import xml.etree.ElementTree as ET

from aisafety_pipeline import oai

_OAI_NS = "{http://www.openarchives.org/OAI/2.0/}"


def _record(extra: str) -> ET.Element:
    xml = f"""<record xmlns="http://www.openarchives.org/OAI/2.0/">
      <header><identifier>oai:arXiv.org:2111.03319</identifier></header>
      <metadata>
        <arXiv xmlns="http://arxiv.org/OAI/arXiv/">
          <id>2111.03319</id>
          <created>2021-11-05</created>
          <authors><author><keyname>Doe</keyname><forenames>Jane</forenames></author></authors>
          <title>A title</title>
          <abstract>An abstract.</abstract>
          {extra}
        </arXiv>
      </metadata>
    </record>"""
    return ET.fromstring(xml)


def test_parse_record_reads_venue_fields_and_collapses_whitespace():
    rec = _record(
        """<comments>Accepted at
              NeurIPS 2025</comments>
           <journal-ref>IEEE Trans. Ind. Inform. 19 (2023)</journal-ref>
           <doi>10.1109/TII.2022.1234</doi>"""
    )
    parsed = oai._oai_parse_record(rec)
    assert parsed["comments"] == "Accepted at NeurIPS 2025"
    assert parsed["journal_ref"] == "IEEE Trans. Ind. Inform. 19 (2023)"
    assert parsed["doi"] == "10.1109/TII.2022.1234"


def test_parse_record_missing_or_blank_venue_fields_are_none():
    parsed = oai._oai_parse_record(_record("<comments>  </comments>"))
    assert parsed["comments"] is None
    assert parsed["journal_ref"] is None
    assert parsed["doi"] is None


_API_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2111.03319v2</id>
    <title>A title</title>
    <arxiv:comment>6 pages, accepted to CCECE 2022</arxiv:comment>
    <arxiv:journal_ref>IEEE CCECE (2022)</arxiv:journal_ref>
    <arxiv:doi>10.1109/CCECE.2022.1</arxiv:doi>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/cs/0601001v1</id>
    <title>Old-style id, no venue fields</title>
  </entry>
  <entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format_for_bogus</id>
    <title>Error</title>
  </entry>
</feed>
"""


def test_parse_arxiv_api_feed_keys_by_versionless_abs_url():
    out = oai._parse_arxiv_api_feed(_API_FEED)
    assert set(out) == {
        "https://arxiv.org/abs/2111.03319",
        "https://arxiv.org/abs/cs/0601001",
    }
    assert out["https://arxiv.org/abs/2111.03319"] == {
        "journal_ref": "IEEE CCECE (2022)",
        "doi": "10.1109/CCECE.2022.1",
        "comments": "6 pages, accepted to CCECE 2022",
    }
    assert out["https://arxiv.org/abs/cs/0601001"] == {
        "journal_ref": None, "doi": None, "comments": None,
    }


def test_strip_version():
    assert oai._strip_version("2111.03319v12") == "2111.03319"
    assert oai._strip_version("2111.03319") == "2111.03319"
    assert oai._strip_version("cs/0601001v1") == "cs/0601001"
    # An old-style archive name containing "v" with no version suffix
    assert oai._strip_version("solv-int/9901001") == "solv-int/9901001"


def test_fetch_arxiv_venue_fields_sends_bare_ids(monkeypatch):
    captured = {}

    def fake_fetch(params, url=oai.OAI_BASE):
        captured.update(params=params, url=url)
        return _API_FEED

    monkeypatch.setattr(oai, "_oai_fetch", fake_fetch)
    out = oai.fetch_arxiv_venue_fields(
        ["https://arxiv.org/abs/2111.03319", "https://arxiv.org/abs/cs/0601001"]
    )
    assert captured["url"] == oai.ARXIV_API_URL
    assert captured["params"] == {"id_list": "2111.03319,cs/0601001", "max_results": "2"}
    assert len(out) == 2
