from __future__ import annotations

import xml.etree.ElementTree as ET

import pytest

from aisafety_pipeline import oai

requests = pytest.importorskip("requests")

_RECORD_XML = """<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <ListRecords>
    <record>
      <header><identifier>oai:arXiv.org:2603.03298</identifier></header>
      <metadata>
        <arXiv xmlns="http://arxiv.org/OAI/arXiv/">
          <id>2603.03298</id>
          <created>2026-02-06</created>
          <authors>
            <author><keyname>Batorski</keyname><forenames>Paweł</forenames></author>
            <author><keyname>Rodolà</keyname><forenames>Emanuele</forenames></author>
          </authors>
          <title>A title</title>
          <abstract>An abstract with ε.</abstract>
        </arXiv>
      </metadata>
    </record>
  </ListRecords>
</OAI-PMH>
"""


class _FakeSession:
    def __init__(self, response):
        self._response = response

    def get(self, *args, **kwargs):
        return self._response


def test_oai_fetch_decodes_utf8_body_without_charset(monkeypatch):
    # arXiv sends Content-Type without a charset, which makes requests
    # default to ISO-8859-1 and turns "ł" into "Å\x82".
    resp = requests.Response()
    resp.status_code = 200
    resp.headers["Content-Type"] = "text/xml"
    resp._content = _RECORD_XML.encode("utf-8")
    # What requests' HTTPAdapter does when building a real response.
    resp.encoding = requests.utils.get_encoding_from_headers(resp.headers)
    assert resp.encoding == "ISO-8859-1"
    monkeypatch.setattr(oai, "_get_session", lambda: _FakeSession(resp))
    monkeypatch.setattr(oai, "_sleep_with_jitter", lambda base: None)

    xml = oai._oai_fetch({"verb": "ListRecords"})
    rec = ET.fromstring(xml).find(".//{http://www.openarchives.org/OAI/2.0/}record")
    parsed = oai._oai_parse_record(rec)

    assert parsed["authors"] == "Paweł Batorski, Emanuele Rodolà"
    assert parsed["summary"] == "An abstract with ε."
