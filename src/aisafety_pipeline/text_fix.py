"""Repair UTF-8-decoded-as-Latin-1 mojibake (e.g. "PaweÅ\\x82" -> "Paweł").

Rows harvested before the OAI-PMH decoding fix (see `oai._oai_fetch`) stored
every non-ASCII character as its UTF-8 bytes read as Latin-1. Kept free of
heavy imports so the API image can use it too.
"""
from __future__ import annotations

import re

# A complete UTF-8 multi-byte sequence, spelled as Latin-1 code points.
_MOJIBAKE_RE = re.compile(
    "[Â-ß][\u0080-¿]"
    "|[à-ï][\u0080-¿]{2}"
    "|[ð-ô][\u0080-¿]{3}"
)

# "à" is C3 A0; as mojibake that's "Ã\xa0", and the harvester's per-name
# .strip() treats \xa0 as whitespace -- so names ending in "à" ("Adrià",
# "Rodolà") lost the second byte. A bare "Ã" closing a word marks that loss.
_STRIPPED_A_GRAVE_RE = re.compile("(?<=[^\\W\\d_])Ã(?=[, ]|$)")


def _decode(m: re.Match) -> str:
    s = m.group(0)
    try:
        return s.encode("latin-1").decode("utf-8")
    except UnicodeDecodeError:
        return s


def fix_mojibake(text: str | None, *, restore_stripped_nbsp: bool = False) -> str | None:
    """Return `text` with each mojibake sequence decoded back to UTF-8.

    Works per sequence, so one damaged character doesn't block the rest of
    the string. Correctly-encoded text is returned unchanged.
    `restore_stripped_nbsp` re-attaches the byte lost from a trailing "à";
    only meaningful for the `authors` column.

    Repeats until stable: some arXiv metadata was already mojibake at
    submission, so those strings are double-encoded, and decoding one layer
    can turn the character before a bare "Ã" into a letter.
    """
    if not text:
        return text
    for _ in range(3):
        prev = text
        if restore_stripped_nbsp:
            text = _STRIPPED_A_GRAVE_RE.sub("Ã ", text)
        text = _MOJIBAKE_RE.sub(_decode, text)
        if text == prev:
            break
    return text
