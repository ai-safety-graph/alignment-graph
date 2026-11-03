"""Rule tests for venue.classify_venue. Comment strings are real arXiv
comments from relevant papers unless noted."""
from __future__ import annotations

import pytest

from aisafety_pipeline.venue import classify_venue

# (comments, expected peer_reviewed, expected venue, expected venue_type)
COMMENT_CASES = [
    # Explicit acceptance
    ("6 pages, 5 figures, 1 table. Accepted at IROS 2021", True, "IROS 2021", "conference"),
    ("Accepted to ACL Findings 2023", True, "ACL 2023 Findings", "conference"),
    ("Accepted by NeurIPS2024", True, "NeurIPS 2024", "conference"),
    ("Published at ICLR 2025 (Oral)", True, "ICLR 2025", "conference"),
    ("Published as a conference paper at COLM '26; 24 pages", True, "COLM 2026", "conference"),
    ("Accepted at USENIX Security '21", True, "USENIX Security 2021", "conference"),
    ("To appear in the proceedings of the USENIX Security Symposium 2023", True, "USENIX Security 2023", "conference"),
    ("To appear in the Network and Distributed System Security Symposium (NDSS) 2024, San Diego",
     True, "NDSS 2024", "conference"),
    ("Accepted by TPAMI 2026", True, "TPAMI 2026", "journal"),
    ("Published in TMLR-2026", True, "TMLR 2026", "journal"),
    ("Accepted in CHI'24. Supplementary material will be available", True, "CHI 2024", "conference"),
    ("ICML 2023 Oral (camera-ready); 31 pages, 5 figures", True, "ICML 2023", "conference"),
    ("Accepted and to appear at AAAI 2022", True, "AAAI 2022", "conference"),
    ("Accetped to Findings of EACL", True, "EACL Findings", "conference"),
    ("Forthcoming: Sociological Methodology; USPTO patent pending", True, "Sociological Methodology", "unknown"),
    ("Accepted by DMLR", True, "DMLR", "unknown"),
    ("Camera-ready version. 10 pages, 3 figures, 2 tables", True, None, "unknown"),
    ("Accepted for publication at the IEEE Conference on Communications and Network Security (CNS), 2026",
     True, "IEEE Conference on Communications and Network Security", "conference"),
    # Workshops: reviewed, but labelled as workshops
    ("8 pages, 4 figures, to appear in AAAI 2026 AIGOV Workshop", True, "AAAI 2026 Workshop", "workshop"),
    ("Accepted to the NAACL PrivateNLP 2025 Workshop", True, "NAACL 2025 Workshop", "workshop"),
    ("9 pages, ICML 2024 Workshop on Mechanistic Interpretability", True, "ICML 2024 Workshop", "workshop"),
    ("Accepted to Games, Agents and Incentives Workshop at AAMAS-2026", True, "AAMAS 2026 Workshop", "workshop"),
    ("12 pages, EC 2026 Poster and EC 2026 Incentive-Based AI Alignment Workshop Poster",
     True, "Workshop", "workshop"),
    # A bare venue + year (authors don't name a venue before acceptance)
    ("ICLR 2026", True, "ICLR 2026", "conference"),
    ("EMNLP Findings 26", True, "EMNLP 2026 Findings", "conference"),
    ("CVPR2026", True, "CVPR 2026", "conference"),
    ("USENIX Security '26", True, "USENIX Security 2026", "conference"),
    ("Empirical Methods in Natural Language Processing, 2022 (Main-Long Paper)", True, "EMNLP 2022", "conference"),
    ("Conference on Uncertainty in Artificial Intelligence (UAI) 2023, first three authors contributed equally",
     True, "UAI 2023", "conference"),
    ("2 pages, 4 figures, The 54th Annual IEEE/IFIP International Conference on Dependable Systems and Networks",
     True, None, "conference"),
    # Positive phrase wins over a submission mentioned elsewhere
    ("Accepted at a workshop; extended version submitted to ICML 2026 (synthetic)", True, "Workshop", "workshop"),
    # Submitted / under review -> unknown
    ("Submitted to ICLR 2025", None, None, "unknown"),
    ("Submitted to AAAI-23", None, None, "unknown"),
    ("Under review at ICLR", None, None, "unknown"),
    ("12 pages, 10 figures, under-review conference", None, None, "unknown"),
    ("Under Submission at ICLR 2027", None, None, "unknown"),
    ("Preprint submitted to Elsevier on Jan 5th, 2024", None, None, "unknown"),
    ("Submitted to JMIR AI and currently under peer review", None, None, "unknown"),
    ("9 pages; ancillary evaluation artefacts. Previously submitted to NLLP 2026", None, None, "unknown"),
    ("Will be updated if accepted at NeurIPS (synthetic)", None, None, "unknown"),
    # Acceptance words that don't report an acceptance
    ("This conference paper was not accepted. It has been withdrawn because it was subsequently revised",
     None, None, "unknown"),
    ("Not yet accepted (synthetic)", None, None, "unknown"),
    ("Paper not accepted at ICML 2024; resubmission planned (synthetic)", None, None, "unknown"),
    ("Will appear in ICML 2025 if accepted (synthetic)", None, None, "unknown"),
    ("19 pages. Under Review. Please cite published version, if available", None, None, "unknown"),
    ("Accepted and published at Findings of NAACL 2025: cite published version whenever possible",
     True, "NAACL 2025 Findings", "conference"),
    ("Preprint of ACL 2025 paper", True, "ACL 2025", "conference"),
    ("OpenAI Red-teaming Challenge Winner and Oral Presentation | COLM 2026", True, "COLM 2026", "conference"),
    ("Submitted to ICML 2025. Code is published at https://github.com/x/y (synthetic)", None, None, "unknown"),
    ("Also published on the AI Alignment Forum (synthetic)", None, None, "unknown"),
    ("Accepted at ICRA 2026 (Vienna); published on arxiv for archival purposes",
     True, "ICRA 2026", "conference"),
    ("Accepted at NeurIPS 2025, code published at https://github.com/x/y (synthetic)",
     True, "NeurIPS 2025", "conference"),
    ("Rejected by AAAI25-AIA. Accepted by ICML25", True, "ICML 2025", "conference"),
    # A venue named for something other than this paper
    ("26 pages, 13 tables, 2 figures. Planning to submit to NeurIPS 2026", None, None, "unknown"),
    ("9-page NeurIPS 2025 preprint including 3 figures and 1 table. Prepared using the NeurIPS 2025 preprint template",
     None, None, "unknown"),
    ("This paper is a curated version of my keynote at the Web Conference 2022", None, None, "unknown"),
    ("2nd Place Winner, ICCV 2025 2COOOL Competition", None, None, "unknown"),
    ("Winning solution to the NeurIPS 2023 LLM Efficiency Challenge (synthetic)", None, None, "unknown"),
    # No signal
    ("15 pages, 4 figures", None, None, "unknown"),
    ("ICML 12 pages (synthetic: 12 is not a year)", None, None, "unknown"),
    ("Website: https://www.harmbench.org", None, None, "unknown"),
    ("Doctoral thesis", None, None, "unknown"),
]


@pytest.mark.parametrize(("comments", "reviewed", "venue", "venue_type"), COMMENT_CASES)
def test_classify_from_comments(comments, reviewed, venue, venue_type):
    res = classify_venue(None, None, comments)
    assert (res.peer_reviewed, res.venue, res.venue_type) == (reviewed, venue, venue_type)
    assert res.source == ("comments" if reviewed else None)


@pytest.mark.parametrize(
    ("journal_ref", "venue", "venue_type"),
    [
        ("ICLR 2023", "ICLR 2023", "conference"),
        ("Transactions on Machine Learning Research (2026)", "Transactions on Machine Learning Research", "journal"),
        ("Proc. EMNLP (2024) 9004-9018", "EMNLP", "conference"),
        ("CVPR 2021 Workshop: Beyond Fairness", "CVPR 2021 Workshop", "workshop"),
        ("Artificial Intelligence in Medicine, Volume 151, May 2024", "Artificial Intelligence in Medicine", "journal"),
        ("npj Digital Medicine 8, 557 (2025)", "npj Digital Medicine 8", "unknown"),
        # Self-citation or URL: reviewed, but no usable venue name
        ("Mokander, J., Axente, M., Casolari, F. & Floridi, L. (2021). Conformity Assessments", None, "unknown"),
        ("https://aclanthology.org/2025.emnlp-main.359/", None, "unknown"),
    ],
)
def test_journal_ref_means_reviewed(journal_ref, venue, venue_type):
    # Even when the comments say "submitted": the journal-ref is newer evidence.
    res = classify_venue(journal_ref, None, "Submitted to somewhere")
    assert (res.peer_reviewed, res.venue, res.venue_type, res.source) == (True, venue, venue_type, "journal_ref")


def test_publisher_doi_means_reviewed_and_takes_venue_from_comments():
    res = classify_venue(None, "10.1145/3726302.3731962", "Accepted at SIGIR 2025 Industry Track. 5 pages")
    assert (res.peer_reviewed, res.venue, res.venue_type, res.source) == (True, "SIGIR 2025", "conference", "doi")

    res = classify_venue(None, "10.1109/ACCESS.2024.1", "19 pages, 4 figures")
    assert (res.peer_reviewed, res.venue, res.venue_type, res.source) == (True, None, "unknown", "doi")


@pytest.mark.parametrize(
    "doi",
    ["10.48550/arXiv.2401.00001", "10.5281/zenodo.19672575", "10.13140/RG.2.2.16827.13602", "10.2139/ssrn.1"],
)
def test_preprint_dois_are_not_evidence(doi):
    assert classify_venue(None, doi, "15 pages").peer_reviewed is None


@pytest.mark.parametrize(
    "doi", ["https://doi.org/10.48550/arXiv.2401.00001", "doi:10.48550/arXiv.2401.00001",
            "http://dx.doi.org/10.5281/zenodo.1"],
)
def test_preprint_dois_with_a_url_prefix_are_not_evidence(doi):
    assert classify_venue(None, doi, "15 pages").peer_reviewed is None


def test_publisher_doi_with_a_url_prefix_still_counts():
    assert classify_venue(None, "https://doi.org/10.1109/ACCESS.2024.1", None).peer_reviewed is True


def test_nothing_at_all_is_unknown():
    res = classify_venue(None, None, None)
    assert (res.peer_reviewed, res.venue, res.venue_type, res.source) == (None, None, "unknown", None)
