from __future__ import annotations

import pytest

from aisafety_pipeline.text_fix import fix_mojibake


def test_fixes_polish_names():
    assert (
        fix_mojibake("PaweÅ\x82 Batorski, PrzemysÅ\x82aw Spurek")
        == "Paweł Batorski, Przemysław Spurek"
    )


def test_fixes_three_byte_sequence():
    # "’" (U+2019) is E2 80 99 in UTF-8.
    assert fix_mojibake("modelâ\u0080\u0099s") == "model’s"


def test_one_damaged_name_does_not_block_the_rest():
    # Without NBSP restoration the bare "Ã" stays, but "á" still gets fixed.
    assert (
        fix_mojibake("IvÃ¡n Arcuschin, AdriÃ Garriga-Alonso")
        == "Iván Arcuschin, AdriÃ Garriga-Alonso"
    )


@pytest.mark.parametrize(
    "garbled, fixed",
    [
        ("IvÃ¡n Arcuschin, AdriÃ Garriga-Alonso", "Iván Arcuschin, Adrià Garriga-Alonso"),
        ("Emanuele RodolÃ, Kamil Deja", "Emanuele Rodolà, Kamil Deja"),
        ("Marta R. Costa-jussÃ", "Marta R. Costa-jussà"),
        ("Mar GonzÃ\xa0lez I CatalÃ", "Mar Gonzàlez I Català"),
    ],
)
def test_restores_stripped_a_grave_in_authors(garbled, fixed):
    assert fix_mojibake(garbled, restore_stripped_nbsp=True) == fixed


@pytest.mark.parametrize(
    "text",
    ["Kajetan Ożóg, Jürgen Schmidhuber", "François Chollet", "Plain ASCII", "", None],
)
def test_correct_text_is_unchanged(text):
    assert fix_mojibake(text, restore_stripped_nbsp=True) == text


def test_fixes_double_encoded_text():
    assert fix_mojibake("BjÃ\x83Â¶rn Victor") == "Björn Victor"


def test_restores_a_grave_revealed_by_decoding_a_preceding_char():
    assert fix_mojibake("MarÃ§Ã Boronat", restore_stripped_nbsp=True) == "Marçà Boronat"


def test_idempotent():
    once = fix_mojibake("Å\x81ukasz Struski, Kamil KsiÄ\x85Å¼ek, RodolÃ", restore_stripped_nbsp=True)
    assert once == "Łukasz Struski, Kamil Książek, Rodolà"
    assert fix_mojibake(once, restore_stripped_nbsp=True) == once
