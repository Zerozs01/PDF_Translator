import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from scripts.external_ocr_bridge import (
    is_advertisement_brand_token,
    is_probable_panel_watermark_line,
    is_domain_like_token,
    contains_known_watermark_phrase,
)


def test_advertisement_brand_token_detection():
    # Known watermark / brand markers must be identified
    assert is_advertisement_brand_token("ASURA") is True
    assert is_advertisement_brand_token("NEWTOKI") is True
    assert is_advertisement_brand_token("SCANSCOM") is True
    assert is_advertisement_brand_token("TINASCENS") is True

    # Standard English / Latin words must NEVER be flagged as ad brands
    assert is_advertisement_brand_token("REACTION") is False
    assert is_advertisement_brand_token("CONNECTION") is False
    assert is_advertisement_brand_token("DIRECTION") is False
    assert is_advertisement_brand_token("TOGETHER") is False
    assert is_advertisement_brand_token("ANALYSIS") is False
    assert is_advertisement_brand_token("EQUATION") is False
    assert is_advertisement_brand_token("SOLUTION") is False
    assert is_advertisement_brand_token("INTERSECTION") is False
    assert is_advertisement_brand_token("THE") is False
    assert is_advertisement_brand_token("PEOPLE") is False


def test_domain_like_and_watermark_phrase_detection():
    assert is_domain_like_token("WWW.MANGA.COM") is True
    assert is_domain_like_token("HTTP://READ.ORG") is True
    assert is_domain_like_token("REGULAR_TEXT") is False

    assert contains_known_watermark_phrase("READ AT ASURA SCANS") is True
    assert contains_known_watermark_phrase("NORMAL DIALOGUE TEXT") is False


def test_probable_panel_watermark_line():
    # Watermark line in bottom corner
    wm_line = {
        "text": "WWW.ASURA.COM",
        "bbox": {"x0": 800.0, "y0": 1150.0, "x1": 950.0, "y1": 1180.0},
        "confidence": 92.0,
    }
    assert is_probable_panel_watermark_line(wm_line, width=1000, height=1200, pipeline_profile="panel") is True

    # Normal dialogue line in the center of the panel
    dialogue_line = {
        "text": "WHAT IS THE REACTION FORCE?",
        "bbox": {"x0": 200.0, "y0": 400.0, "x1": 600.0, "y1": 450.0},
        "confidence": 95.0,
    }
    assert is_probable_panel_watermark_line(dialogue_line, width=1000, height=1200, pipeline_profile="panel") is False
