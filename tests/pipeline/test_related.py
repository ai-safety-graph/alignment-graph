from __future__ import annotations

import numpy as np

from aisafety_pipeline.related import top_k_neighbours


def test_top_k_matches_brute_force_and_excludes_self():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(1100, 16)).astype(np.float32)  # spans multiple chunks
    X /= np.linalg.norm(X, axis=1, keepdims=True)

    idx, sims = top_k_neighbours(X, 5)

    S = X @ X.T
    np.fill_diagonal(S, -np.inf)
    expected = np.argsort(-S, axis=1)[:, :5]
    assert (idx == expected).all()
    assert np.allclose(sims, np.take_along_axis(S, expected, axis=1), atol=1e-6)
    assert not (idx == np.arange(len(X))[:, None]).any()
    assert (np.diff(sims, axis=1) <= 0).all()


def test_top_k_caps_k_at_corpus_size_minus_one():
    X = np.eye(3, dtype=np.float32)
    idx, sims = top_k_neighbours(X, 50)
    assert idx.shape == sims.shape == (3, 2)
