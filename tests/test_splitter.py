import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from scripts.external_ocr_bridge import split_compact_latin_token


def test_should_not_split_known_english_words():
    # Directive specified: CONNECTION, DIRECTION, REACTION, TOGETHER, ANALYSIS, EQUATION, INTERSECTION, SOLUTION
    protected_words = [
        "CONNECTION",
        "DIRECTION",
        "REACTION",
        "TOGETHER",
        "ANALYSIS",
        "EQUATION",
        "INTERSECTION",
        "SOLUTION",
        "Reaction",
        "Connection",
        "Direction",
        "Together",
        "Analysis",
        "Equation",
        "Intersection",
        "Solution",
    ]
    for word in protected_words:
        parts = split_compact_latin_token(word)
        assert parts is None, f"Expected '{word}' not to be split, but got {parts}"


def test_should_split_truly_merged_compact_words():
    # Truly merged words where each piece has length >= 4 and is known in baseline lexicon
    cases = [
        ("STUDENTSFOUND", ["STUDENTS", "FOUND"]),
        ("PEOPLELIVE", ["PEOPLE", "LIVE"]),
        ("TRAININGBRAT", ["TRAINING", "BRAT"]),
    ]
    for merged, expected in cases:
        parts = split_compact_latin_token(merged)
        assert parts == expected, f"Expected '{merged}' to split into {expected}, got {parts}"


def test_disallow_short_edge_pieces():
    # Should not split if short pieces (<= 2) are at word boundaries
    assert split_compact_latin_token("REACTI") is None
    assert split_compact_latin_token("REACTION") is None
