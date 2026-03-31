from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Dict, Iterable, List, Tuple
import re

os.environ.setdefault("FLAGS_enable_pir_api", "0")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

DEFAULT_EASY_YOLO_URL = "http://127.0.0.1:5000/easy-yolo-ocr"
PADDLE_OCR_CACHE: Dict[Tuple[str, str], Any] = {}
EASYOCR_READER_CACHE: Dict[Tuple[str, ...], Any] = {}
WATERMARK_TOKENS = {
    "LIKEMANGA", "MANGA", "MANGAIO", "COLAMANGA", "CLOUDMERGE", "ACLOUDMERGE",
    "ASURASCANS", "MANHWAS", "SCANS", "ASURASCANSCOM", "LIKEMANGAIO",
}
WATERMARK_PHRASE_MARKERS = {
    "ASURASCANS", "LIKEMANGA", "CLOUDMERGE", "COLAMANGA", "NEWTOKI", "FNSTINASCENS",
}
KOREAN_WATERMARK_MARKERS = {
    "가장빠른입문제공사이트", "입문제공사이트", "웹툰왕국", "뉴토끼",
}
DOMAIN_SUFFIX_TOKENS = {"COM", "NET", "ORG", "IO", "GG", "CO"}
HEADING_KEEP_TOKENS = {"CHAPTER", "SECTION", "PART", "OBJECTIVES", "CONDITIONS", "FIG"}
SHORT_SPEECH_TOKENS = {"EH", "ME", "I", "OH", "AH", "NO", "A"}
KOREAN_PARTICLE_SUFFIXES = {"이", "가", "은", "는", "을", "를", "의"}
LATIN_SHORT_KEEP_TOKENS = {
    "A", "I", "IN", "ON", "AT", "TO", "OF", "DO", "GO", "NO", "MY", "WE", "ME", "OH", "AH",
    "IT", "IS", "BE", "IF", "OR", "AN", "AS", "AM", "UP", "SO", "IM", "US", "THE",
}
LATIN_COMMON_WORDS = {
    "THE", "YOU", "HE", "SHE", "WE", "THEY", "TO", "OF", "IN", "ON", "AT", "FOR", "AND", "OR", "ARE",
    "THAT", "THIS", "THOSE", "THESE", "PAST", "ONLY", "FOUND", "TOP", "GIRLS", "CITY", "BUT", "NOW",
    "CAN", "MAKE", "WITH", "KIND", "STUFF", "ROOM", "DOOR", "LOCK", "TAKE", "LOOK", "OVER", "GO",
    "STUDENTS", "MAY", "DOING", "BAD", "THINGS", "ELDERLY", "WEAK", "WOMEN", "CHILDREN", "TOWN",
    "NOT", "JUST", "ALL", "COME", "ACROSS", "POSSIBILITY", "WHAT", "THINK", "BEST", "ITS", "ILL",
    "HERE", "PEOPLE", "LIVE", "THERE", "WHY", "OKAY", "FINE", "ACTING", "MYSTERIOUS", "WHATEVER",
    "WANT", "SAY", "TIANHAI", "CHAPTER", "SECTION", "PART", "FIGURE", "FIG", "TABLE", "UNIT",
    "LESSON", "VOLUME", "VOL", "APPENDIX",
}


def respond(payload: Dict[str, Any], exit_code: int = 0) -> None:
    print(json.dumps(payload, ensure_ascii=True))
    raise SystemExit(exit_code)


def bbox_from_points(points: Any) -> Dict[str, float]:
    xs: List[float] = []
    ys: List[float] = []
    for point in points or []:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            xs.append(float(point[0]))
            ys.append(float(point[1]))
    if not xs or not ys:
        return {"x0": 0.0, "y0": 0.0, "x1": 0.0, "y1": 0.0}
    return {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)}


def sort_hint_from_points(points: Any) -> Tuple[float | None, float | None]:
    normalized_points: List[Tuple[float, float]] = []
    for point in points or []:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            normalized_points.append((float(point[0]), float(point[1])))
    if not normalized_points:
        return None, None

    baseline_dx = 1.0
    baseline_dy = 0.0
    longest_length = 0.0
    point_count = len(normalized_points)
    for index in range(point_count):
        next_index = (index + 1) % point_count
        x0, y0 = normalized_points[index]
        x1, y1 = normalized_points[next_index]
        dx = x1 - x0
        dy = y1 - y0
        length = math.hypot(dx, dy)
        if length > longest_length:
            longest_length = length
            baseline_dx = dx / length
            baseline_dy = dy / length

    if baseline_dx < 0 or (abs(baseline_dx) < 0.15 and baseline_dy < 0):
        baseline_dx *= -1
        baseline_dy *= -1

    normal_x = -baseline_dy
    normal_y = baseline_dx
    if normal_y < 0 or (abs(normal_y) < 0.15 and normal_x < 0):
        normal_x *= -1
        normal_y *= -1

    normal_projections = [(x * normal_x) + (y * normal_y) for x, y in normalized_points]
    baseline_projections = [(x * baseline_dx) + (y * baseline_dy) for x, y in normalized_points]
    primary = min(normal_projections)
    normal_band_tolerance = max(8.0, longest_length * 0.12)
    edge_points = [
        baseline_projection
        for baseline_projection, normal_projection in zip(baseline_projections, normal_projections)
        if abs(normal_projection - primary) <= normal_band_tolerance
    ]
    secondary = min(edge_points or baseline_projections)
    return primary, secondary


def split_text_tokens(text: str) -> List[str]:
    stripped = (text or "").strip()
    if not stripped:
        return []
    parts = [part for part in stripped.split() if part]
    return parts or [stripped]


def normalize_confidence(value: Any) -> float:
    try:
        confidence = float(value or 0.0)
    except Exception:
        confidence = 0.0
    if 0.0 <= confidence <= 1.0001:
        confidence *= 100.0
    return confidence


def normalize_text(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    raw = re.sub(r"^[|¦│┃￨︱︲]+\s*(?=[A-Za-z0-9])", "", raw)
    raw = re.sub(r"\s*[|¦│┃￨︱︲]+$", "", raw)
    return raw.strip()


def normalize_pipeline_profile(value: str) -> str:
    return "panel" if str(value or "").strip().lower() == "panel" else "export"


def has_terminal_sentence_punct(text: str) -> bool:
    return bool(re.search(r"[!?…\.]+$", str(text or "").strip()))


def explode_line_to_words(text: str, confidence: float, bbox: Dict[str, float]) -> List[Dict[str, Any]]:
    tokens = split_text_tokens(text)
    if not tokens:
        return []

    width = max(1.0, float(bbox["x1"]) - float(bbox["x0"]))
    total_weight = sum(max(1, len(token)) for token in tokens)
    cursor = float(bbox["x0"])
    words: List[Dict[str, Any]] = []

    for index, token in enumerate(tokens):
        token_weight = max(1, len(token))
        remaining = max(0.0, float(bbox["x1"]) - cursor)
        token_width = remaining if index == len(tokens) - 1 else width * (token_weight / total_weight)
        next_cursor = min(float(bbox["x1"]), cursor + token_width)
        words.append({
            "text": token,
            "confidence": confidence,
            "bbox": {
                "x0": round(cursor, 2),
                "y0": round(float(bbox["y0"]), 2),
                "x1": round(next_cursor, 2),
                "y1": round(float(bbox["y1"]), 2),
            },
        })
        cursor = next_cursor

    return words


def make_line(
    text: str,
    confidence: float,
    bbox: Dict[str, float],
    words: List[Dict[str, Any]] | None = None,
    sort_y: float | None = None,
    sort_x: float | None = None,
) -> Dict[str, Any]:
    normalized_text = normalize_text(text)
    line = {
        "text": normalized_text,
        "confidence": normalize_confidence(confidence),
        "bbox": {
            "x0": float(bbox["x0"]),
            "y0": float(bbox["y0"]),
            "x1": float(bbox["x1"]),
            "y1": float(bbox["y1"]),
        },
        "words": words or explode_line_to_words(normalized_text, normalize_confidence(confidence), bbox),
    }
    if sort_y is not None:
        line["_sortY"] = float(sort_y)
    if sort_x is not None:
        line["_sortX"] = float(sort_x)
    return line


def make_text_result(lines: List[Dict[str, Any]], words: List[Dict[str, Any]], page_seg_mode: int | None = None) -> Dict[str, Any]:
    text = "\n".join(line["text"] for line in lines if line["text"]).strip()
    confidences = [normalize_confidence(word.get("confidence", 0.0)) for word in words] or [normalize_confidence(line.get("confidence", 0.0)) for line in lines]
    avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
    return {
        "ok": True,
        "lines": lines,
        "words": words,
        "text": text,
        "confidence": avg_conf,
        "pageSegMode": page_seg_mode,
    }


def bbox_width(bbox: Dict[str, Any]) -> float:
    return max(0.0, float(bbox.get("x1", 0.0)) - float(bbox.get("x0", 0.0)))


def bbox_height(bbox: Dict[str, Any]) -> float:
    return max(0.0, float(bbox.get("y1", 0.0)) - float(bbox.get("y0", 0.0)))


def bbox_center_x(bbox: Dict[str, Any]) -> float:
    return (float(bbox.get("x0", 0.0)) + float(bbox.get("x1", 0.0))) / 2.0


def bbox_center_y(bbox: Dict[str, Any]) -> float:
    return (float(bbox.get("y0", 0.0)) + float(bbox.get("y1", 0.0))) / 2.0


def line_sort_y(line: Dict[str, Any]) -> float:
    return float(line.get("_sortY", line.get("bbox", {}).get("y0", 0.0)))


def line_sort_x(line: Dict[str, Any]) -> float:
    return float(line.get("_sortX", line.get("bbox", {}).get("x0", 0.0)))


def line_sort_key(line: Dict[str, Any]) -> Tuple[float, float, float, float]:
    bbox = line.get("bbox") or {}
    return (
        line_sort_y(line),
        line_sort_x(line),
        bbox_center_y(bbox),
        bbox_center_x(bbox),
    )


def source_sequence_key(line: Dict[str, Any]) -> Tuple[float, float, float, float, float]:
    bbox = line.get("bbox") or {}
    source_index = line.get("_sourceIndex")
    if source_index is not None:
        return (
            0.0,
            float(source_index),
            line_sort_y(line),
            bbox_center_y(bbox),
            bbox_center_x(bbox),
        )
    return (
        1.0,
        line_sort_y(line),
        line_sort_x(line),
        bbox_center_y(bbox),
        bbox_center_x(bbox),
    )


def visual_line_key(line: Dict[str, Any]) -> Tuple[float, float, float, float]:
    bbox = line.get("bbox") or {}
    return (
        float(bbox.get("y0", 0.0)),
        float(bbox.get("x0", 0.0)),
        bbox_center_y(bbox),
        bbox_center_x(bbox),
    )


def visual_band_key(line: Dict[str, Any]) -> Tuple[float, float, float, float]:
    bbox = line.get("bbox") or {}
    return (
        bbox_center_y(bbox),
        float(bbox.get("y0", 0.0)),
        bbox_center_x(bbox),
        float(bbox.get("x0", 0.0)),
    )


def merge_same_band_fragments(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(lines) <= 1:
        return list(lines)

    ordered = sorted(lines, key=visual_band_key)
    merged: List[Dict[str, Any]] = []
    current = ordered[0]

    for candidate in ordered[1:]:
        current_bbox = current.get("bbox") or {}
        candidate_bbox = candidate.get("bbox") or {}
        current_text = str(current.get("text") or "")
        candidate_text = str(candidate.get("text") or "")
        is_cjk_like = has_non_latin_characters(current_text) or has_non_latin_characters(candidate_text)
        current_has_terminal_punct = has_terminal_sentence_punct(current_text)
        candidate_has_terminal_punct = has_terminal_sentence_punct(candidate_text)
        min_height = max(8.0, min(bbox_height(current_bbox), bbox_height(candidate_bbox)))
        center_delta = abs(line_sort_y(current) - line_sort_y(candidate))
        overlap_y = vertical_overlap_ratio(current_bbox, candidate_bbox)
        overlap_x = horizontal_overlap_ratio(current_bbox, candidate_bbox)
        gap_x = float(candidate_bbox.get("x0", 0.0)) - float(current_bbox.get("x1", 0.0))
        current_text_len = len(normalize_multilingual_token(current_text))
        candidate_text_len = len(normalize_multilingual_token(candidate_text))
        fragment_like = (
            current_text_len <= 7
            or candidate_text_len <= 7
            or bbox_width(current_bbox) <= bbox_width(candidate_bbox) * 0.62
            or bbox_width(candidate_bbox) <= bbox_width(current_bbox) * 0.62
        )
        if is_cjk_like:
            fragment_like = (
                current_text_len <= 5
                or candidate_text_len <= 5
                or bbox_width(current_bbox) <= bbox_width(candidate_bbox) * 0.52
                or bbox_width(candidate_bbox) <= bbox_width(current_bbox) * 0.52
            )
            if current_has_terminal_punct and current_text_len > 2 and not (candidate_has_terminal_punct and min(current_text_len, candidate_text_len) <= 2):
                merged.append(current)
                current = candidate
                continue
            same_band = (
                center_delta <= min_height * 0.22
                or (overlap_y >= 0.78 and center_delta <= min_height * 0.34)
            )
            close_enough = (
                gap_x <= max(26.0, min_height * 1.6)
                and gap_x >= -max(10.0, min_height * 0.65)
                and overlap_x <= 0.28
            )
        else:
            same_band = (
                center_delta <= min_height * 0.34
                or (overlap_y >= 0.62 and center_delta <= min_height * 0.56)
            )
            close_enough = gap_x <= max(42.0, min_height * 2.4) or overlap_x >= 0.34

        if same_band and close_enough and fragment_like:
            merged_words = list(current.get("words") or []) + list(candidate.get("words") or [])
            merged_line = make_line_from_words(
                merged_words,
                min(line_sort_y(current), line_sort_y(candidate)),
                min(line_sort_x(current), line_sort_x(candidate)),
            )
            source_index = min(
                float(current.get("_sourceIndex", float("inf"))),
                float(candidate.get("_sourceIndex", float("inf"))),
            )
            if math.isfinite(source_index):
                merged_line["_sourceIndex"] = int(source_index)
            current = merged_line
            continue

        merged.append(current)
        current = candidate

    merged.append(current)
    return merged


def merge_cjk_diagonal_continuations(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(lines) <= 1:
        return list(lines)

    ordered = sorted(lines, key=visual_line_key)
    merged: List[Dict[str, Any]] = []
    index = 0

    while index < len(ordered):
        current = ordered[index]
        current_text = str(current.get("text") or "").strip()
        current_bbox = current.get("bbox") or {}
        current_token = normalize_multilingual_token(current_text)

        if index + 1 < len(ordered) and has_hangul_characters(current_text):
            next_line = ordered[index + 1]
            next_text = str(next_line.get("text") or "").strip()
            next_bbox = next_line.get("bbox") or {}
            next_token = normalize_multilingual_token(next_text)

            if has_hangul_characters(next_text) and current_token and next_token:
                min_height = max(8.0, min(bbox_height(current_bbox), bbox_height(next_bbox)))
                center_delta = abs(bbox_center_y(current_bbox) - bbox_center_y(next_bbox))
                overlap_y = vertical_overlap_ratio(current_bbox, next_bbox)
                overlap_x = horizontal_overlap_ratio(current_bbox, next_bbox)
                gap_lr = float(next_bbox.get("x0", 0.0)) - float(current_bbox.get("x1", 0.0))
                gap_rl = float(current_bbox.get("x0", 0.0)) - float(next_bbox.get("x1", 0.0))
                max_gap = max(84.0, min_height * 3.8)
                close_horizontal = abs(gap_lr) <= max_gap or abs(gap_rl) <= max_gap
                same_line_band = center_delta <= min_height * 1.15 or overlap_y >= 0.24
                current_terminal = has_terminal_sentence_punct(current_text)
                next_terminal = has_terminal_sentence_punct(next_text)
                continuation_like = (
                    (not current_terminal)
                    and (
                        next_terminal
                        or len(current_token) <= 12
                        or len(next_token) <= 10
                    )
                )
                non_duplicate = not are_near_duplicate_tokens(current_token, next_token)
                non_nested = overlap_x <= 0.9
                forward_progress = float(next_bbox.get("x0", 0.0)) >= float(current_bbox.get("x0", 0.0)) - max(14.0, min_height * 0.5)

                if same_line_band and close_horizontal and continuation_like and non_duplicate and non_nested and forward_progress:
                    merged_words = list(current.get("words") or []) + list(next_line.get("words") or [])
                    merged_words.sort(key=lambda item: (float(item["bbox"].get("x0", 0.0)), float(item["bbox"].get("y0", 0.0))))
                    merged_line = make_line_from_words(
                        merged_words,
                        min(line_sort_y(current), line_sort_y(next_line)),
                        min(line_sort_x(current), line_sort_x(next_line)),
                    )
                    source_index = min(
                        float(current.get("_sourceIndex", float("inf"))),
                        float(next_line.get("_sourceIndex", float("inf"))),
                    )
                    if math.isfinite(source_index):
                        merged_line["_sourceIndex"] = int(source_index)
                    merged.append(merged_line)
                    index += 2
                    continue

        merged.append(current)
        index += 1

    return merged


def merge_cjk_terminal_left_fragments(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(lines) <= 1:
        return list(lines)

    ordered = reorder_tilted_line_clusters(lines)
    consumed: set[int] = set()
    merged: List[Dict[str, Any]] = []

    for index, line in enumerate(ordered):
        if index in consumed:
            continue

        text = str(line.get("text") or "").strip()
        token = normalize_multilingual_token(text)
        bbox = line.get("bbox") or {}

        if not has_hangul_characters(text) or not has_terminal_sentence_punct(text):
            merged.append(line)
            continue

        best_index: int | None = None
        best_score = float("inf")

        for candidate_index, candidate in enumerate(ordered):
            if candidate_index == index or candidate_index in consumed:
                continue

            candidate_text = str(candidate.get("text") or "").strip()
            candidate_token = normalize_multilingual_token(candidate_text)
            candidate_bbox = candidate.get("bbox") or {}

            if not has_hangul_characters(candidate_text):
                continue
            if has_terminal_sentence_punct(candidate_text):
                continue
            if len(candidate_token) < 2 or len(candidate_token) > 12:
                continue
            if are_near_duplicate_tokens(token, candidate_token):
                continue

            min_height = max(8.0, min(bbox_height(bbox), bbox_height(candidate_bbox)))
            center_delta = abs(bbox_center_y(bbox) - bbox_center_y(candidate_bbox))
            overlap_y = vertical_overlap_ratio(bbox, candidate_bbox)
            overlap_x = horizontal_overlap_ratio(bbox, candidate_bbox)
            left_gap = float(bbox.get("x0", 0.0)) - float(candidate_bbox.get("x1", 0.0))

            same_band = center_delta <= min_height * 1.45 or overlap_y >= 0.18
            if not same_band:
                continue
            if overlap_x > 0.45:
                continue
            if left_gap < -max(24.0, min_height * 1.5):
                continue
            if left_gap > max(96.0, min_height * 4.4):
                continue

            score = center_delta + max(0.0, left_gap) * 0.35 - overlap_y * 8.0
            if score < best_score:
                best_score = score
                best_index = candidate_index

        if best_index is None:
            merged.append(line)
            continue

        candidate = ordered[best_index]
        candidate_bbox = candidate.get("bbox") or {}
        if float(candidate_bbox.get("x0", 0.0)) <= float(bbox.get("x0", 0.0)):
            merged_words = list(candidate.get("words") or []) + list(line.get("words") or [])
        else:
            merged_words = list(line.get("words") or []) + list(candidate.get("words") or [])
        merged_words.sort(key=lambda item: (float(item["bbox"].get("x0", 0.0)), float(item["bbox"].get("y0", 0.0))))
        merged_line = make_line_from_words(
            merged_words,
            min(line_sort_y(line), line_sort_y(candidate)),
            min(line_sort_x(line), line_sort_x(candidate)),
        )
        source_index = min(
            float(line.get("_sourceIndex", float("inf"))),
            float(candidate.get("_sourceIndex", float("inf"))),
        )
        if math.isfinite(source_index):
            merged_line["_sourceIndex"] = int(source_index)
        merged.append(merged_line)
        consumed.add(best_index)

    return reorder_tilted_line_clusters(merged)


def suppress_contained_hangul_fragments(
    lines: List[Dict[str, Any]],
    drop_reasons: List[Dict[str, Any]] | None = None,
    source: str = "generic",
) -> List[Dict[str, Any]]:
    if len(lines) <= 1:
        return list(lines)

    filtered: List[Dict[str, Any]] = []
    for line in lines:
        text = str(line.get("text") or "").strip()
        raw_compact = re.sub(r"\s+", "", text)
        has_symbol_noise = bool(re.search(r"[=~`|]+", raw_compact))
        token = normalize_multilingual_token(text)
        raw_token = raw_compact
        particle_stem = ""
        is_particle_candidate = False
        if len(token) >= 3 and raw_token and raw_token[-1] in KOREAN_PARTICLE_SUFFIXES:
            particle_stem = normalize_multilingual_token(raw_token[:-1])
            is_particle_candidate = len(particle_stem) >= 2
        if not has_hangul_characters(text) or not token or len(token) > 4:
            filtered.append(line)
            continue
        if has_terminal_sentence_punct(text) and not has_symbol_noise and not is_particle_candidate:
            filtered.append(line)
            continue

        bbox = line.get("bbox") or {}
        confidence = float(line.get("confidence", 0.0) or 0.0)
        line_center_x = bbox_center_x(bbox)
        should_drop = False
        drop_meta: Dict[str, Any] | None = None

        for other in lines:
            if other is line:
                continue
            other_text = str(other.get("text") or "").strip()
            other_token = normalize_multilingual_token(other_text)
            if len(other_token) < len(token) + 2:
                continue
            if token == other_token:
                continue
            token_shadow = token in other_token or are_near_duplicate_tokens(token, other_token[:len(token) + 1])
            stem_shadow_hint = is_particle_candidate and (
                particle_stem in other_token
                or other_token.startswith(particle_stem)
                or are_near_duplicate_tokens(particle_stem, other_token[:len(particle_stem)])
            )
            if not token_shadow and not stem_shadow_hint:
                continue

            other_bbox = other.get("bbox") or {}
            other_conf = float(other.get("confidence", 0.0) or 0.0)
            overlap_y = vertical_overlap_ratio(bbox, other_bbox)
            overlap_x = horizontal_overlap_ratio(bbox, other_bbox)
            contained_x = horizontal_containment_ratio(bbox, other_bbox)
            center_delta = abs(bbox_center_y(bbox) - bbox_center_y(other_bbox))
            center_dx = abs(line_center_x - bbox_center_x(other_bbox))
            min_height = max(8.0, min(bbox_height(bbox), bbox_height(other_bbox)))
            min_width = max(8.0, min(bbox_width(bbox), bbox_width(other_bbox)))
            narrow_fragment = bbox_width(bbox) <= bbox_width(other_bbox) * 0.58
            same_band = center_delta <= max(52.0, min_height * 2.4)
            prefix_shadow = (
                bool(token)
                and bool(other_token)
                and token[:1] == other_token[:1]
                and narrow_fragment
                and contained_x >= 0.62
                and center_delta <= max(120.0, min_height * 5.6)
            )
            particle_shadow = False
            if is_particle_candidate:
                stem_shadow = (
                    particle_stem in other_token
                    or other_token.startswith(particle_stem)
                    or are_near_duplicate_tokens(particle_stem, other_token[:len(particle_stem)])
                )
                particle_shadow = (
                    stem_shadow
                    and (narrow_fragment or len(token) <= 3)
                    and center_delta <= max(420.0, min_height * 16.0)
                    and (contained_x >= 0.1 or overlap_x >= 0.02 or center_dx <= max(380.0, min_width * 3.5))
                    and confidence <= other_conf + 12.0
                )
            overlap_shadow = same_band and narrow_fragment and overlap_y >= 0.22 and (contained_x >= 0.55 or overlap_x >= 0.42)
            particle_prefix_clone = False
            if is_particle_candidate and len(token) <= 4:
                stem_in_other = particle_stem in other_token or other_token.startswith(particle_stem)
                longer_other = len(other_token) >= len(particle_stem) + 3
                same_cluster = center_delta <= max(560.0, min_height * 22.0)
                particle_prefix_clone = stem_in_other and longer_other and same_cluster
            symbol_shadow = (
                has_symbol_noise
                and len(token) <= 3
                and narrow_fragment
                and (token in other_token or are_near_duplicate_tokens(token, other_token[:len(token) + 1]))
                and (contained_x >= 0.34 or overlap_x >= 0.08 or center_dx <= max(170.0, min_width * 1.5))
                and center_delta <= max(260.0, min_height * 10.0)
            )
            if particle_prefix_clone:
                should_drop = True
                drop_meta = {
                    "reason": "particle_prefix_clone",
                    "source": source,
                    "text": text,
                    "shadowWith": other_text,
                }
                break
            if (overlap_shadow or prefix_shadow or particle_shadow or symbol_shadow) and confidence <= 98.0:
                should_drop = True
                if particle_shadow:
                    reason = "particle_shadow"
                elif symbol_shadow:
                    reason = "symbol_shadow"
                elif prefix_shadow:
                    reason = "prefix_shadow"
                else:
                    reason = "overlap_shadow"
                drop_meta = {
                    "reason": reason,
                    "source": source,
                    "text": text,
                    "shadowWith": other_text,
                }
                break

        if should_drop:
            if drop_reasons is not None:
                drop_reasons.append(drop_meta or {
                    "reason": "hangul_fragment_suppression",
                    "source": source,
                    "text": text,
                })
        else:
            filtered.append(line)

    return filtered


def drop_final_particle_shadow_lines(
    lines: List[Dict[str, Any]],
    source: str = "paddle_korean_panel",
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if len(lines) <= 1:
        return list(lines), []

    filtered: List[Dict[str, Any]] = []
    drops: List[Dict[str, Any]] = []

    for line in lines:
        text = str(line.get("text") or "").strip()
        token = normalize_multilingual_token(text)
        raw_compact = re.sub(r"\s+", "", text)

        if not has_hangul_characters(text) or not token or len(token) > 4:
            filtered.append(line)
            continue
        if has_terminal_sentence_punct(text):
            filtered.append(line)
            continue
        if not raw_compact or raw_compact[-1] not in KOREAN_PARTICLE_SUFFIXES:
            filtered.append(line)
            continue

        stem = normalize_multilingual_token(raw_compact[:-1])
        if len(stem) < 2:
            filtered.append(line)
            continue

        line_conf = float(line.get("confidence", 0.0) or 0.0)
        shadow_other: Dict[str, Any] | None = None
        for other in lines:
            if other is line:
                continue
            other_text = str(other.get("text") or "").strip()
            other_token = normalize_multilingual_token(other_text)
            if len(other_token) < len(token) + 2:
                continue
            stem_match = (
                stem in other_token
                or other_token.startswith(stem)
                or are_near_duplicate_tokens(stem, other_token[:len(stem)])
            )
            if not stem_match:
                continue
            other_conf = float(other.get("confidence", 0.0) or 0.0)
            if line_conf <= other_conf + 40.0:
                shadow_other = other
                break

        if shadow_other is None:
            filtered.append(line)
            continue

        drops.append({
            "reason": "lexical_particle_shadow_final",
            "source": source,
            "text": text,
            "shadowWith": str(shadow_other.get("text") or "").strip(),
        })

    return filtered, drops


def bbox_union(items: List[Dict[str, Any]]) -> Dict[str, float]:
    if not items:
        return {"x0": 0.0, "y0": 0.0, "x1": 0.0, "y1": 0.0}
    return {
        "x0": min(float(item["bbox"].get("x0", 0.0)) for item in items),
        "y0": min(float(item["bbox"].get("y0", 0.0)) for item in items),
        "x1": max(float(item["bbox"].get("x1", 0.0)) for item in items),
        "y1": max(float(item["bbox"].get("y1", 0.0)) for item in items),
    }


def make_line_from_words(words: List[Dict[str, Any]], sort_y: float | None = None, sort_x: float | None = None) -> Dict[str, Any]:
    normalized_words = sorted(words, key=lambda item: (float(item["bbox"].get("x0", 0.0)), float(item["bbox"].get("y0", 0.0))))
    text = " ".join(str(word.get("text") or "").strip() for word in normalized_words).strip()
    confidences = [normalize_confidence(word.get("confidence", 0.0)) for word in normalized_words]
    confidence = sum(confidences) / len(confidences) if confidences else 0.0
    bbox = bbox_union(normalized_words)
    if sort_y is None:
        sort_y = min(float(word["bbox"].get("y0", 0.0)) for word in normalized_words) if normalized_words else None
    if sort_x is None:
        sort_x = min(float(word["bbox"].get("x0", 0.0)) for word in normalized_words) if normalized_words else None
    return make_line(text, confidence, bbox, normalized_words, sort_y, sort_x)


def looks_mostly_upper(text: str) -> bool:
    letters = [char for char in text if char.isalpha()]
    if not letters:
        return False
    uppercase = sum(1 for char in letters if char.isupper())
    return uppercase / len(letters) >= 0.8


def normalize_alpha_token(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "", str(text or "")).upper()


def normalize_latin_token_for_lexicon(text: str) -> str:
    token = normalize_alpha_token(text)
    if not token:
        return ""
    return (
        token.replace("0", "O")
        .replace("1", "I")
        .replace("5", "S")
        .replace("6", "G")
        .replace("7", "T")
        .replace("8", "B")
    )


def normalize_multilingual_token(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9\uAC00-\uD7A3]+", "", str(text or "")).upper()


def normalize_domain_token(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9.]+", "", str(text or "")).upper()


def has_non_latin_characters(text: str) -> bool:
    return any(ord(char) > 127 for char in str(text or ""))


def has_hangul_characters(text: str) -> bool:
    return any(0xAC00 <= ord(char) <= 0xD7A3 for char in str(text or ""))


def is_advertisement_brand_token(text: str) -> bool:
    alpha = normalize_alpha_token(text)
    if not alpha:
        return False
    if alpha in WATERMARK_TOKENS:
        return True
    if any(marker in alpha for marker in WATERMARK_TOKENS if len(marker) >= 6):
        return True
    if any(marker in alpha for marker in WATERMARK_PHRASE_MARKERS if len(marker) >= 6):
        return True
    if any(marker in alpha for marker in ("ASCENS", "SCENS", "ASURA", "NEWTOKI", "NSTINASCENS", "TINASCENS", "SCANSCOM")):
        return True
    if alpha.endswith("SCANS") and len(alpha) >= 6:
        return True
    if alpha.endswith("MANGA") and len(alpha) >= 6:
        return True
    fuzzy_markers = [marker for marker in (WATERMARK_TOKENS | WATERMARK_PHRASE_MARKERS) if len(marker) >= 6]
    for marker in fuzzy_markers:
        if abs(len(alpha) - len(marker)) > 2:
            continue
        if levenshtein_distance(alpha, marker, max_distance=2) <= 2:
            return True
    return False


def is_domain_suffix_token(text: str) -> bool:
    domain = normalize_domain_token(text)
    if not domain:
        return False
    if domain in DOMAIN_SUFFIX_TOKENS:
        return True
    if domain in {"COE", "C0M", "CQM"}:
        return True
    if domain.startswith(".") and domain[1:] in DOMAIN_SUFFIX_TOKENS:
        return True
    return False


def is_domain_like_token(text: str) -> bool:
    raw = str(text or "").strip().upper()
    domain = normalize_domain_token(text)
    if not domain:
        return False
    if raw.startswith("WWW") or raw.startswith("HTTP"):
        return True
    if any(suffix in raw for suffix in (".COM", ".NET", ".ORG", ".IO", ".GG", ".CO")):
        return True
    if any(marker in domain for marker in WATERMARK_TOKENS if len(marker) >= 6):
        return True
    return False


def contains_known_watermark_phrase(text: str) -> bool:
    raw = str(text or "").strip()
    if not raw:
        return False
    compact_upper = re.sub(r"[^A-Za-z0-9]+", "", raw).upper()
    compact_hangul = re.sub(r"\s+", "", raw)
    if any(marker in compact_upper for marker in WATERMARK_PHRASE_MARKERS):
        return True
    if any(marker in compact_hangul for marker in KOREAN_WATERMARK_MARKERS):
        return True
    return False


def is_probable_korean_watermark_noise(text: str, bbox: Dict[str, Any], width: int, height: int) -> bool:
    raw = str(text or "").strip()
    if not raw or not has_hangul_characters(raw):
        return False
    compact = re.sub(r"\s+", "", raw)
    y0 = float(bbox.get("y0", 0.0))
    y1 = float(bbox.get("y1", 0.0))
    x0 = float(bbox.get("x0", 0.0))
    x1 = float(bbox.get("x1", 0.0))
    edge_band = y1 <= height * 0.16 or y0 >= height * 0.84 or x1 <= width * 0.15 or x0 >= width * 0.85
    marker_hit = (
        any(marker in compact for marker in KOREAN_WATERMARK_MARKERS)
        or (
            "입문" in compact
            and any(token in compact for token in ("사이트", "권", "뉴토끼", "미트", "웹툰"))
        )
    )
    symbol_noise = sum(1 for char in raw if char in "'[]-_`|")
    return edge_band and marker_hit and symbol_noise >= 1


def strip_inline_ad_words(words: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], bool]:
    if not words:
        return [], False

    remove_indexes: set[int] = set()

    for index, word in enumerate(words):
        text = str(word.get("text") or "").strip()
        if not text:
            remove_indexes.add(index)
            continue

        brand_like = is_advertisement_brand_token(text)
        domain_like = is_domain_like_token(text)
        suffix_like = is_domain_suffix_token(text)

        if brand_like or domain_like:
            remove_indexes.add(index)
            if index > 0 and is_domain_suffix_token(str(words[index - 1].get("text") or "")):
                remove_indexes.add(index - 1)
            if index + 1 < len(words) and is_domain_suffix_token(str(words[index + 1].get("text") or "")):
                remove_indexes.add(index + 1)
            continue

        if suffix_like:
            prev_is_brand = index > 0 and (
                is_advertisement_brand_token(str(words[index - 1].get("text") or ""))
                or is_domain_like_token(str(words[index - 1].get("text") or ""))
            )
            next_is_brand = index + 1 < len(words) and (
                is_advertisement_brand_token(str(words[index + 1].get("text") or ""))
                or is_domain_like_token(str(words[index + 1].get("text") or ""))
            )
            if prev_is_brand or next_is_brand:
                remove_indexes.add(index)

    if not remove_indexes:
        return words, False

    filtered = [word for index, word in enumerate(words) if index not in remove_indexes]
    return filtered, len(filtered) != len(words)


def vertical_overlap_ratio(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    overlap = min(float(a.get("y1", 0.0)), float(b.get("y1", 0.0))) - max(float(a.get("y0", 0.0)), float(b.get("y0", 0.0)))
    min_height = max(1.0, min(bbox_height(a), bbox_height(b)))
    return max(0.0, overlap) / min_height


def horizontal_overlap_ratio(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    overlap = min(float(a.get("x1", 0.0)), float(b.get("x1", 0.0))) - max(float(a.get("x0", 0.0)), float(b.get("x0", 0.0)))
    min_width = max(1.0, min(bbox_width(a), bbox_width(b)))
    return max(0.0, overlap) / min_width


def horizontal_containment_ratio(inner: Dict[str, Any], outer: Dict[str, Any]) -> float:
    inner_width = max(1.0, bbox_width(inner))
    overlap = min(float(inner.get("x1", 0.0)), float(outer.get("x1", 0.0))) - max(float(inner.get("x0", 0.0)), float(outer.get("x0", 0.0)))
    return max(0.0, overlap) / inner_width


def is_probable_ascii_ghost(text: str) -> bool:
    raw = str(text or "").strip()
    if not raw or has_non_latin_characters(raw):
        return False
    alpha_num = normalize_alpha_token(raw)
    if re.fullmatch(r"[\W_]+", raw):
        return True
    if any(marker in raw for marker in ("\\", "{", "}", "[", "]", "|")) and len(alpha_num) <= 4:
        return True
    if len(alpha_num) <= 2 and any(marker in raw for marker in ("\\", "/", "{", "}", "[", "]", "_", "|", "~", "`")):
        return True
    return False


def split_compact_latin_token(token: str) -> List[str] | None:
    normalized = normalize_latin_token_for_lexicon(token)
    if not normalized:
        return None
    if len(normalized) < 8:
        return None
    if not re.fullmatch(r"[A-Z0-9]+", normalized):
        return None
    if normalized in LATIN_COMMON_WORDS or normalized in LATIN_SHORT_KEEP_TOKENS:
        return None

    max_piece = 13
    n = len(normalized)
    best_score: List[float] = [-1e9] * (n + 1)
    best_parts: List[List[str] | None] = [None] * (n + 1)
    best_lex_hits: List[int] = [0] * (n + 1)
    best_score[0] = 0.0
    best_parts[0] = []

    for i in range(n):
        if best_parts[i] is None:
            continue
        for j in range(i + 1, min(n, i + max_piece) + 1):
            piece = normalized[i:j]
            is_common = piece in LATIN_COMMON_WORDS
            is_short_keep = piece in LATIN_SHORT_KEEP_TOKENS
            if is_short_keep and len(piece) > 4:
                is_short_keep = False
            if not is_common and not is_short_keep and len(piece) <= 2:
                continue

            if is_common:
                delta = 5.0
            elif is_short_keep:
                delta = 3.0
            elif len(piece) >= 5:
                # Keep one unknown chunk as fallback for names/rare words.
                delta = -1.5
            else:
                continue

            next_score = best_score[i] + delta
            next_lex_hits = best_lex_hits[i] + (1 if (is_common or is_short_keep) else 0)
            next_parts = list(best_parts[i] or [])
            next_parts.append(piece)

            replace = False
            if next_score > best_score[j]:
                replace = True
            elif math.isclose(next_score, best_score[j], rel_tol=1e-9, abs_tol=1e-9):
                if next_lex_hits > best_lex_hits[j]:
                    replace = True
                elif next_lex_hits == best_lex_hits[j] and best_parts[j] is not None and len(next_parts) < len(best_parts[j] or []):
                    replace = True

            if replace:
                best_score[j] = next_score
                best_parts[j] = next_parts
                best_lex_hits[j] = next_lex_hits

    parts = best_parts[n]
    if not parts or len(parts) <= 1:
        return None
    if best_lex_hits[n] < 2:
        return None

    reconstructed = "".join(parts)
    if reconstructed != normalized:
        return None
    return parts


def split_merged_latin_words(words: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    if not words:
        return [], 0

    output: List[Dict[str, Any]] = []
    split_count = 0
    for word in words:
        text = str(word.get("text") or "").strip()
        if not text or has_non_latin_characters(text):
            output.append(word)
            continue

        parts = split_compact_latin_token(text)
        if not parts:
            output.append(word)
            continue

        bbox = word.get("bbox") or {}
        x0 = float(bbox.get("x0", 0.0))
        x1 = float(bbox.get("x1", 0.0))
        y0 = float(bbox.get("y0", 0.0))
        y1 = float(bbox.get("y1", 0.0))
        total_width = max(1.0, x1 - x0)
        total_weight = max(1, sum(max(1, len(part)) for part in parts))
        cursor = x0

        for index, part in enumerate(parts):
            weight = max(1, len(part))
            remaining = max(0.0, x1 - cursor)
            part_width = remaining if index == len(parts) - 1 else total_width * (weight / total_weight)
            next_cursor = min(x1, cursor + part_width)
            output.append({
                "text": part,
                "confidence": normalize_confidence(word.get("confidence", 0.0)),
                "bbox": {
                    "x0": round(cursor, 2),
                    "y0": round(y0, 2),
                    "x1": round(next_cursor, 2),
                    "y1": round(y1, 2),
                },
            })
            cursor = next_cursor
        split_count += len(parts) - 1

    return output, split_count


def is_probable_panel_watermark_line(
    line: Dict[str, Any],
    width: int,
    height: int,
    pipeline_profile: str,
) -> bool:
    if pipeline_profile != "panel":
        return False

    text = str(line.get("text") or "").strip()
    if not text:
        return False
    if contains_known_watermark_phrase(text) or is_advertisement_brand_token(text) or is_domain_like_token(text):
        return True

    if has_non_latin_characters(text):
        return False

    bbox = line.get("bbox") or {}
    confidence = normalize_confidence(line.get("confidence", 0.0))
    x0 = float(bbox.get("x0", 0.0))
    y0 = float(bbox.get("y0", 0.0))
    x1 = float(bbox.get("x1", 0.0))
    y1 = float(bbox.get("y1", 0.0))
    line_h = bbox_height(bbox)
    line_w = bbox_width(bbox)

    near_bottom = y0 >= height * 0.78
    near_top = y1 <= height * 0.22
    near_side = x0 >= width * 0.55 or x1 <= width * 0.45
    cornerish = near_side and (near_bottom or near_top)
    tiny_label = line_h <= height * 0.03 and line_w <= width * 0.58

    if not cornerish or not tiny_label:
        return False

    tokens = [normalize_latin_token_for_lexicon(part) for part in re.split(r"\s+", text)]
    tokens = [token for token in tokens if token]
    alpha = normalize_latin_token_for_lexicon(text)
    lexical_hits = sum(1 for token in tokens if token in LATIN_COMMON_WORDS or token in LATIN_SHORT_KEEP_TOKENS)
    compact_long = len(tokens) == 1 and len(alpha) >= 8
    symbol_noise = bool(re.search(r"[\\/|_{}\[\]~`]+", text))
    low_confidence = confidence < 88
    likely_garbage_line = compact_long and lexical_hits == 0

    if low_confidence and (likely_garbage_line or symbol_noise):
        return True
    return False


def reflow_external_words(words: List[Dict[str, Any]], pipeline_profile: str, width: int, height: int) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if not words:
        return [], []

    sorted_words = sorted(words, key=lambda word: (bbox_center_y(word["bbox"]), float(word["bbox"].get("x0", 0.0))))
    rows: List[Dict[str, Any]] = []

    for word in sorted_words:
        word_bbox = word["bbox"]
        word_center_y = bbox_center_y(word_bbox)
        word_height = max(10.0, bbox_height(word_bbox))
        best_row: Dict[str, Any] | None = None
        best_score = float("inf")

        for row in rows:
            row_bbox = row["bbox"]
            row_height = max(10.0, bbox_height(row_bbox))
            center_delta = abs(word_center_y - row["centerY"])
            overlap = vertical_overlap_ratio(word_bbox, row_bbox)
            center_tolerance = max(10.0, min(word_height, row_height) * (0.58 if pipeline_profile == "export" else 0.52))
            overlap_threshold = 0.5 if pipeline_profile == "export" else 0.48
            same_band = center_delta <= center_tolerance or overlap >= overlap_threshold
            if not same_band:
                continue
            score = center_delta - (overlap * 10.0)
            if score < best_score:
                best_score = score
                best_row = row

        if best_row is None:
            rows.append({
                "words": [word],
                "bbox": dict(word_bbox),
                "centerY": word_center_y,
            })
            continue

        best_row["words"].append(word)
        best_row["bbox"] = bbox_union(best_row["words"])
        best_row["centerY"] = bbox_center_y(best_row["bbox"])

    lines: List[Dict[str, Any]] = []
    output_words: List[Dict[str, Any]] = []

    for row in sorted(rows, key=lambda item: (float(item["bbox"].get("y0", 0.0)), float(item["bbox"].get("x0", 0.0)))):
        row_words = sorted(row["words"], key=lambda item: float(item["bbox"].get("x0", 0.0)))
        if not row_words:
            continue

        average_height = sum(max(8.0, bbox_height(word["bbox"])) for word in row_words) / len(row_words)
        row_gap_threshold = max(
            average_height * (2.6 if pipeline_profile == "export" else 1.45),
            width * (0.018 if pipeline_profile == "export" else 0.012),
        )
        if float(row["bbox"].get("y1", 0.0)) <= height * 0.22:
            row_gap_threshold *= 1.35
        current_group: List[Dict[str, Any]] = [row_words[0]]
        for word in row_words[1:]:
            previous = current_group[-1]
            gap = float(word["bbox"].get("x0", 0.0)) - float(previous["bbox"].get("x1", 0.0))
            overlap = vertical_overlap_ratio(previous["bbox"], word["bbox"])
            lead_token = normalize_alpha_token(str(current_group[0].get("text") or ""))
            leading_short_speech = len(current_group) == 1 and lead_token in SHORT_SPEECH_TOKENS and gap <= row_gap_threshold * 2.4
            if gap <= row_gap_threshold or overlap >= 0.35 or leading_short_speech:
                current_group.append(word)
                continue
            line = make_line_from_words(current_group)
            if line["text"]:
                lines.append(line)
                output_words.extend(line["words"])
            current_group = [word]

        if current_group:
            line = make_line_from_words(current_group)
            if line["text"]:
                lines.append(line)
                output_words.extend(line["words"])

    return lines, output_words


def merge_short_lead_lines(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(lines) <= 1:
        return lines

    merged: List[Dict[str, Any]] = []
    index = 0
    while index < len(lines):
        current = lines[index]
        token = normalize_alpha_token(str(current.get("text") or ""))
        if token in SHORT_SPEECH_TOKENS and index + 1 < len(lines):
            next_line = lines[index + 1]
            current_bbox = current.get("bbox") or {}
            next_bbox = next_line.get("bbox") or {}
            center_delta = abs(bbox_center_y(current_bbox) - bbox_center_y(next_bbox))
            min_height = max(8.0, min(bbox_height(current_bbox), bbox_height(next_bbox)))
            gap = float(next_bbox.get("x0", 0.0)) - float(current_bbox.get("x1", 0.0))
            overlap = vertical_overlap_ratio(current_bbox, next_bbox)
            if (center_delta <= min_height * 1.2 or overlap >= 0.15) and gap <= max(64.0, min_height * 5.0):
                merged_words = list(current.get("words") or []) + list(next_line.get("words") or [])
                merged_line = make_line_from_words(
                    merged_words,
                    min(line_sort_y(current), line_sort_y(next_line)),
                    min(line_sort_x(current), line_sort_x(next_line)),
                )
                source_index = min(
                    float(current.get("_sourceIndex", float("inf"))),
                    float(next_line.get("_sourceIndex", float("inf"))),
                )
                if math.isfinite(source_index):
                    merged_line["_sourceIndex"] = int(source_index)
                merged.append(merged_line)
                index += 2
                continue

        merged.append(current)
        index += 1

    return merged


def prune_easyocr_panel_weak_singletons(
    lines: List[Dict[str, Any]],
    width: int,
    height: int,
    language_codes: List[str],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if len(lines) <= 1:
        return list(lines), []

    # Keep CJK/Thai panel behavior separate; this guard targets Latin-like EasyOCR panel noise.
    if any(code in {"kor", "jpn", "jpn_vert", "chi_sim", "chi_tra", "tha"} for code in language_codes):
        return list(lines), []

    kept: List[Dict[str, Any]] = []
    drops: List[Dict[str, Any]] = []

    for line in lines:
        text = str(line.get("text") or "").strip()
        if not text:
            continue
        if has_non_latin_characters(text):
            kept.append(line)
            continue

        parts = [part for part in re.split(r"\s+", text) if part]
        if len(parts) != 1:
            kept.append(line)
            continue

        token_raw = parts[0]
        token = normalize_latin_token_for_lexicon(token_raw)
        if not token:
            kept.append(line)
            continue

        bbox = line.get("bbox") or {}
        confidence = normalize_confidence(line.get("confidence", 0.0))
        line_h = max(1.0, bbox_height(bbox))
        line_w = max(1.0, bbox_width(bbox))
        center_x = bbox_center_x(bbox)
        center_y = bbox_center_y(bbox)
        near_edge = (
            float(bbox.get("y1", 0.0)) <= height * 0.20
            or float(bbox.get("y0", 0.0)) >= height * 0.76
            or float(bbox.get("x0", 0.0)) <= width * 0.10
            or float(bbox.get("x1", 0.0)) >= width * 0.90
        )
        tiny = line_h <= height * 0.03 or line_w <= width * 0.08
        numeric_short = token.isdigit() and len(token) <= 2

        letters = [char for char in token_raw if char.isalpha()]
        lower_ratio = (sum(1 for char in letters if char.islower()) / len(letters)) if letters else 0.0
        mostly_lower = len(letters) >= 3 and lower_ratio >= 0.8

        # Preserve short/high-confidence speech-style keep tokens.
        if token in LATIN_SHORT_KEEP_TOKENS and confidence >= 90:
            kept.append(line)
            continue

        neighbor_support = 0
        for other in lines:
            if other is line:
                continue
            other_text = str(other.get("text") or "").strip()
            if not other_text:
                continue
            other_bbox = other.get("bbox") or {}
            other_h = max(1.0, bbox_height(other_bbox))
            center_delta = abs(center_y - bbox_center_y(other_bbox))
            center_dx = abs(center_x - bbox_center_x(other_bbox))
            overlap_x = horizontal_overlap_ratio(bbox, other_bbox)
            min_height = max(8.0, min(line_h, other_h))
            if center_delta <= min_height * 2.2 and (overlap_x >= 0.18 or center_dx <= max(130.0, line_w * 1.8)):
                neighbor_support += 1
                if neighbor_support >= 2:
                    break

        drop_reason = ""
        if numeric_short and (near_edge or confidence < 88):
            drop_reason = "easyNumericSingleton"
        elif mostly_lower and len(token) <= 8 and confidence < 92 and neighbor_support == 0:
            drop_reason = "easyLowercaseSingleton"
        elif len(token) <= 4 and confidence < 86 and tiny and near_edge and neighbor_support == 0:
            drop_reason = "easyShortEdgeSingleton"

        if drop_reason:
            drops.append({
                "reason": drop_reason,
                "source": "easyocr_panel",
                "text": text,
                "confidence": confidence,
            })
            continue

        kept.append(line)

    return kept, drops


def prune_easyocr_panel_shadow_singletons(
    lines: List[Dict[str, Any]],
    language_codes: List[str],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if len(lines) <= 1:
        return list(lines), []

    if any(code in {"kor", "jpn", "jpn_vert", "chi_sim", "chi_tra", "tha"} for code in language_codes):
        return list(lines), []

    kept: List[Dict[str, Any]] = []
    drops: List[Dict[str, Any]] = []

    for line in lines:
        text = str(line.get("text") or "").strip()
        if not text:
            continue
        if has_non_latin_characters(text):
            kept.append(line)
            continue

        tokens = [normalize_latin_token_for_lexicon(part) for part in re.split(r"\s+", text)]
        tokens = [token for token in tokens if token]
        if len(tokens) != 1:
            kept.append(line)
            continue

        token = tokens[0]
        if len(token) <= 2:
            kept.append(line)
            continue

        bbox = line.get("bbox") or {}
        confidence = normalize_confidence(line.get("confidence", 0.0))
        center_y = bbox_center_y(bbox)
        line_h = max(1.0, bbox_height(bbox))

        shadowed_by_longer_line = False
        shadow_line_text = ""
        for other in lines:
            if other is line:
                continue
            other_text = str(other.get("text") or "").strip()
            if not other_text or has_non_latin_characters(other_text):
                continue

            other_tokens = [normalize_latin_token_for_lexicon(part) for part in re.split(r"\s+", other_text)]
            other_tokens = [part for part in other_tokens if part]
            if len(other_tokens) < 4:
                continue
            if token not in other_tokens:
                continue

            other_bbox = other.get("bbox") or {}
            other_h = max(1.0, bbox_height(other_bbox))
            overlap_x = horizontal_overlap_ratio(bbox, other_bbox)
            overlap_y = vertical_overlap_ratio(bbox, other_bbox)
            contained_x = horizontal_containment_ratio(bbox, other_bbox)
            center_delta = abs(center_y - bbox_center_y(other_bbox))
            min_height = max(8.0, min(line_h, other_h))

            if (
                (overlap_x >= 0.32 or contained_x >= 0.45)
                and (overlap_y >= 0.08 or center_delta <= min_height * 4.5)
                and confidence <= normalize_confidence(other.get("confidence", 0.0)) + 10.0
            ):
                shadowed_by_longer_line = True
                shadow_line_text = other_text
                break

        if shadowed_by_longer_line:
            drops.append({
                "reason": "easyShadowSingleton",
                "source": "easyocr_panel",
                "text": text,
                "confidence": confidence,
                "shadowWith": shadow_line_text,
            })
            continue

        kept.append(line)

    return kept, drops


def reorder_tilted_line_clusters(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(lines) <= 1:
        return list(lines)
    return sorted(lines, key=line_sort_key)


def levenshtein_distance(left: str, right: str, max_distance: int = 2) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    if abs(len(left) - len(right)) > max_distance:
        return max_distance + 1

    previous = list(range(len(right) + 1))
    for i, left_char in enumerate(left, start=1):
        current = [i]
        row_min = current[0]
        for j, right_char in enumerate(right, start=1):
            cost = 0 if left_char == right_char else 1
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost,
            ))
            row_min = min(row_min, current[j])
        if row_min > max_distance:
            return max_distance + 1
        previous = current
    return previous[-1]


def are_near_duplicate_tokens(left: str, right: str) -> bool:
    if not left or not right:
        return False
    if left == right:
        return True
    if left in right or right in left:
        return True
    max_len = max(len(left), len(right))
    if max_len > 16:
        return False
    distance = levenshtein_distance(left, right, max_distance=2)
    return distance <= 1 if max_len <= 8 else distance <= 2


def minimal_cleanup_external_result(result: Dict[str, Any], width: int, height: int, pipeline_profile: str) -> Dict[str, Any]:
    lines: List[Dict[str, Any]] = []
    words: List[Dict[str, Any]] = []
    drop_counts: Dict[str, int] = {
        "inlineAdWord": 0,
        "watermarkLine": 0,
        "mergedLatinSplit": 0,
    }
    dropped_words: List[Dict[str, Any]] = []

    for line in result.get("lines", []) or []:
        text = normalize_text(str(line.get("text") or ""))
        if not text:
            continue
        bbox = line.get("bbox") or {"x0": 0.0, "y0": 0.0, "x1": 0.0, "y1": 0.0}
        confidence = normalize_confidence(line.get("confidence", 0.0))
        line_words = line.get("words") or explode_line_to_words(text, confidence, bbox)
        normalized_words: List[Dict[str, Any]] = []
        for word in line_words:
            word_text = normalize_text(str(word.get("text") or ""))
            if not word_text:
                continue
            if is_probable_ascii_ghost(word_text):
                continue
            word_conf = normalize_confidence(word.get("confidence", confidence))
            word_bbox = word.get("bbox") or bbox
            normalized_words.append({
                "text": word_text,
                "confidence": word_conf,
                "bbox": {
                    "x0": float(word_bbox.get("x0", 0.0)),
                    "y0": float(word_bbox.get("y0", 0.0)),
                    "x1": float(word_bbox.get("x1", 0.0)),
                    "y1": float(word_bbox.get("y1", 0.0)),
                },
            })

        before_ad = len(normalized_words)
        normalized_words, removed_ad_words = strip_inline_ad_words(normalized_words)
        removed_ad_count = max(0, before_ad - len(normalized_words))
        if removed_ad_count > 0:
            drop_counts["inlineAdWord"] = drop_counts.get("inlineAdWord", 0) + removed_ad_count
        if not normalized_words:
            continue

        normalized_words, split_count = split_merged_latin_words(normalized_words)
        if split_count > 0:
            drop_counts["mergedLatinSplit"] = drop_counts.get("mergedLatinSplit", 0) + split_count

        candidate_line = make_line_from_words(normalized_words, line.get("_sortY"), line.get("_sortX")) if (removed_ad_words or split_count > 0) else make_line(text, confidence, bbox, normalized_words, line.get("_sortY"), line.get("_sortX"))
        if is_probable_ascii_ghost(candidate_line["text"]):
            continue
        if is_probable_panel_watermark_line(candidate_line, width, height, pipeline_profile):
            drop_counts["watermarkLine"] = drop_counts.get("watermarkLine", 0) + 1
            dropped_words.append({
                "reason": "panel_watermark_suppression",
                "source": "paddle_panel",
                "text": candidate_line.get("text", ""),
                "confidence": normalize_confidence(candidate_line.get("confidence", 0.0)),
            })
            continue
        lines.append(candidate_line)
        words.extend(candidate_line["words"])

    lines = reorder_tilted_line_clusters(lines)
    words = []
    for line in lines:
        words.extend(line.get("words") or [])
    output = make_text_result(lines, words, result.get("pageSegMode"))
    output["debug"] = {
        "cleanupRoute": "paddle_panel_minimal",
        "dropCounts": {key: int(value) for key, value in drop_counts.items() if int(value) > 0},
        "droppedWords": dropped_words,
    }
    return output


def cleanup_paddle_korean_panel_result(result: Dict[str, Any], width: int, height: int) -> Dict[str, Any]:
    candidate_lines: List[Dict[str, Any]] = []

    for source_index, line in enumerate(result.get("lines", []) or []):
        text = normalize_text(str(line.get("text") or ""))
        if not text:
            continue
        bbox = line.get("bbox") or {"x0": 0.0, "y0": 0.0, "x1": 0.0, "y1": 0.0}
        if is_probable_korean_watermark_noise(text, bbox, width, height):
            continue
        confidence = normalize_confidence(line.get("confidence", 0.0))
        line_words = line.get("words") or explode_line_to_words(text, confidence, bbox)
        normalized_words: List[Dict[str, Any]] = []

        for word in line_words:
            word_text = normalize_text(str(word.get("text") or ""))
            if not word_text:
                continue
            word_conf = normalize_confidence(word.get("confidence", confidence))
            word_bbox = word.get("bbox") or bbox
            normalized_words.append({
                "text": word_text,
                "confidence": word_conf,
                "bbox": {
                    "x0": float(word_bbox.get("x0", 0.0)),
                    "y0": float(word_bbox.get("y0", 0.0)),
                    "x1": float(word_bbox.get("x1", 0.0)),
                    "y1": float(word_bbox.get("y1", 0.0)),
                },
            })

        normalized_words, _ = strip_inline_ad_words(normalized_words)
        if not normalized_words:
            continue

        line_kept_words: List[Dict[str, Any]] = []
        for word in normalized_words:
            word_text = str(word.get("text") or "").strip()
            word_bbox = word["bbox"]
            ascii_token = not has_non_latin_characters(word_text)
            alpha_num = normalize_alpha_token(word_text)
            near_bottom = float(word_bbox.get("y0", 0.0)) >= height * 0.86
            tiny_token = bbox_height(word_bbox) <= height * 0.025 or bbox_width(word_bbox) <= width * 0.045

            if ascii_token and len(alpha_num) <= 2 and tiny_token:
                continue
            if ascii_token and near_bottom and len(alpha_num) <= 4:
                continue
            line_kept_words.append(word)

        if not line_kept_words:
            continue

        candidate_line = make_line_from_words(
            line_kept_words,
            line.get("_sortY"),
            line.get("_sortX"),
        )
        candidate_line["_sourceIndex"] = source_index
        candidate_lines.append(candidate_line)

    filtered_candidates: List[Dict[str, Any]] = []

    for line in candidate_lines:
        text = str(line.get("text") or "").strip()
        if not text:
            continue
        alpha_num = normalize_alpha_token(text)
        line_bbox = line["bbox"]
        near_bottom = float(line_bbox.get("y0", 0.0)) >= height * 0.86
        lower_band = float(line_bbox.get("y0", 0.0)) >= height * 0.74
        right_side = float(line_bbox.get("x0", 0.0)) >= width * 0.42
        has_hangul = has_hangul_characters(text)
        line_height = bbox_height(line_bbox)
        line_width = bbox_width(line_bbox)
        punctuation_ghost = bool(re.fullmatch(r"[\W_]+", text)) or text in {"—", "——", "-", "--", "–", "— —"}

        if punctuation_ghost:
            continue
        if is_probable_korean_watermark_noise(text, line_bbox, width, height):
            continue
        if contains_known_watermark_phrase(text):
            continue
        if not has_hangul and len(alpha_num) <= 4:
            continue
        if near_bottom and (not has_hangul and len(alpha_num) <= 12):
            continue
        if near_bottom and any(char.isdigit() for char in text) and not has_hangul:
            continue
        if near_bottom and line_height <= height * 0.02 and len(text) >= 8:
            continue
        if near_bottom and has_hangul and line_width <= width * 0.48 and line_height <= height * 0.022 and len(text) >= 8:
            continue
        if near_bottom and has_hangul and any(char.isdigit() for char in text) and len(text) >= 10:
            continue
        if lower_band and right_side and line_height <= height * 0.024 and line_width <= width * 0.42 and len(text) >= 8:
            continue

        filtered_candidates.append(line)

    deduped_lines: List[Dict[str, Any]] = []
    for line in filtered_candidates:
        text = str(line.get("text") or "").strip()
        alpha_num = normalize_multilingual_token(text)
        line_bbox = line["bbox"]
        replaced = False

        for index, existing in enumerate(deduped_lines):
            existing_text = str(existing.get("text") or "").strip()
            existing_alpha = normalize_multilingual_token(existing_text)
            center_delta = abs(line_sort_y(existing) - line_sort_y(line))
            min_height = max(8.0, min(bbox_height(existing["bbox"]), bbox_height(line_bbox)))
            overlap_x = horizontal_overlap_ratio(existing["bbox"], line_bbox)
            same_band = center_delta <= min_height * 0.9 and (
                overlap_x >= 0.35
                or horizontal_containment_ratio(existing["bbox"], line_bbox) >= 0.72
                or horizontal_containment_ratio(line_bbox, existing["bbox"]) >= 0.72
            )
            if not same_band:
                continue

            same_or_subset = (
                bool(existing_alpha)
                and bool(alpha_num)
                and (
                existing_alpha == alpha_num
                or (alpha_num and alpha_num in existing_alpha)
                or (existing_alpha and existing_alpha in alpha_num)
                or are_near_duplicate_tokens(existing_alpha, alpha_num)
                )
            )
            if not same_or_subset:
                continue

            existing_score = len(existing_text) + float(existing.get("confidence", 0.0))
            candidate_score = len(text) + float(line.get("confidence", 0.0))
            if candidate_score > existing_score:
                deduped_lines[index] = line
            replaced = True
            break

        if not replaced:
            deduped_lines.append(line)

    hangul_fragment_drops: List[Dict[str, Any]] = []
    deduped_lines = suppress_contained_hangul_fragments(
        deduped_lines,
        drop_reasons=hangul_fragment_drops,
        source="paddle_korean_panel",
    )

    post_filtered_lines: List[Dict[str, Any]] = []
    for line in deduped_lines:
        text = str(line.get("text") or "").strip()
        alpha_num = normalize_multilingual_token(text)
        line_bbox = line["bbox"]
        has_terminal_punct = bool(re.search(r"[!?…\.]+$", text))
        is_short_hangul = has_hangul_characters(text) and len(alpha_num) <= 2
        should_drop = False
        if not should_drop and has_hangul_characters(text) and len(alpha_num) <= 3:
            raw_compact = re.sub(r"\s+", "", text)
            if raw_compact and raw_compact[-1] in KOREAN_PARTICLE_SUFFIXES:
                stem = normalize_multilingual_token(raw_compact[:-1])
                if len(stem) >= 2:
                    line_conf = float(line.get("confidence", 0.0) or 0.0)
                    for other in deduped_lines:
                        if other is line:
                            continue
                        other_text = str(other.get("text") or "").strip()
                        other_alpha = normalize_multilingual_token(other_text)
                        if len(other_alpha) <= len(stem) + 1:
                            continue
                        stem_match = (
                            stem in other_alpha
                            or other_alpha.startswith(stem)
                            or are_near_duplicate_tokens(stem, other_alpha[:len(stem)])
                        )
                        if not stem_match:
                            continue
                        other_conf = float(other.get("confidence", 0.0) or 0.0)
                        if line_conf <= other_conf + 22.0:
                            should_drop = True
                            hangul_fragment_drops.append({
                                "reason": "lexical_particle_shadow_hard",
                                "source": "paddle_korean_panel",
                                "text": text,
                                "shadowWith": other_text,
                            })
                            break
        if is_short_hangul and not has_terminal_punct:
            for other in deduped_lines:
                if other is line:
                    continue
                other_text = str(other.get("text") or "").strip()
                other_alpha = normalize_multilingual_token(other_text)
                if len(other_alpha) <= len(alpha_num):
                    continue
                center_delta = abs(line_sort_y(other) - line_sort_y(line))
                min_height = max(8.0, min(bbox_height(other["bbox"]), bbox_height(line_bbox)))
                contained = horizontal_containment_ratio(line_bbox, other["bbox"]) >= 0.72
                overlap_x = horizontal_overlap_ratio(line_bbox, other["bbox"])
                shared_edge = bool(alpha_num) and bool(other_alpha) and (
                    alpha_num[:1] == other_alpha[:1]
                    or alpha_num[-1:] == other_alpha[-1:]
                )
                if (
                    (center_delta <= min_height * 3.2 and contained)
                    or (center_delta <= min_height * 2.6 and overlap_x >= 0.52 and shared_edge)
                    or (len(alpha_num) <= 2 and center_delta <= min_height * 3.4 and contained)
                    or (len(alpha_num) <= 3 and center_delta <= min_height * 3.8 and overlap_x >= 0.35 and bbox_width(line_bbox) <= bbox_width(other["bbox"]) * 0.58)
                    or (len(alpha_num) <= 3 and center_delta <= min_height * 2.2 and overlap_x >= 0.4 and bbox_width(line_bbox) <= bbox_width(other["bbox"]) * 0.45)
                    or (len(alpha_num) <= 4 and center_delta <= min_height * 3.0 and overlap_x >= 0.35 and bbox_width(line_bbox) <= bbox_width(other["bbox"]) * 0.5 and shared_edge)
                ):
                    should_drop = True
                    break
        if not should_drop and has_hangul_characters(text) and len(alpha_num) <= 4:
            for other in deduped_lines:
                if other is line:
                    continue
                other_text = str(other.get("text") or "").strip()
                other_alpha = normalize_multilingual_token(other_text)
                if len(other_alpha) <= len(alpha_num):
                    continue
                overlap_x = horizontal_overlap_ratio(line_bbox, other["bbox"])
                overlap_y = vertical_overlap_ratio(line_bbox, other["bbox"])
                starts_similar = bool(alpha_num) and bool(other_alpha) and alpha_num[:1] == other_alpha[:1]
                narrow_fragment = bbox_width(line_bbox) <= bbox_width(other["bbox"]) * 0.55
                if starts_similar and overlap_x >= 0.28 and overlap_y >= 0.1 and narrow_fragment:
                    should_drop = True
                    break
        if not should_drop and has_hangul_characters(text) and len(alpha_num) <= 2 and not has_terminal_punct:
            for other in deduped_lines:
                if other is line:
                    continue
                other_text = str(other.get("text") or "").strip()
                other_alpha = normalize_multilingual_token(other_text)
                if len(other_alpha) < len(alpha_num) + 2:
                    continue
                if not alpha_num or alpha_num not in other_alpha:
                    continue
                other_bbox = other["bbox"]
                overlap_x = horizontal_overlap_ratio(line_bbox, other_bbox)
                overlap_y = vertical_overlap_ratio(line_bbox, other_bbox)
                contained_x = horizontal_containment_ratio(line_bbox, other_bbox) >= 0.52
                center_delta = abs(line_sort_y(other) - line_sort_y(line))
                min_height = max(8.0, min(bbox_height(other_bbox), bbox_height(line_bbox)))
                nearby_band = center_delta <= min_height * 3.0
                narrower = bbox_width(line_bbox) <= bbox_width(other_bbox) * 0.62
                if narrower and nearby_band and (contained_x or overlap_x >= 0.24) and overlap_y >= 0.06:
                    should_drop = True
                    break
        if not should_drop and has_hangul_characters(text) and len(alpha_num) <= 2 and not has_terminal_punct:
            for other in deduped_lines:
                if other is line:
                    continue
                other_text = str(other.get("text") or "").strip()
                other_alpha = normalize_multilingual_token(other_text)
                if len(other_alpha) <= len(alpha_num):
                    continue
                other_bbox = other["bbox"]
                center_delta = abs(line_sort_y(other) - line_sort_y(line))
                min_height = max(8.0, min(bbox_height(other_bbox), bbox_height(line_bbox)))
                nearby_band = center_delta <= min_height * 4.0
                overlap_x = horizontal_overlap_ratio(line_bbox, other_bbox)
                overlap_y = vertical_overlap_ratio(line_bbox, other_bbox)
                narrow_fragment = bbox_width(line_bbox) <= bbox_width(other_bbox) * 0.52
                same_head = bool(alpha_num) and bool(other_alpha) and alpha_num[:1] == other_alpha[:1]
                similar_short = bool(alpha_num) and bool(other_alpha) and are_near_duplicate_tokens(alpha_num, other_alpha[:len(alpha_num) + 1])
                if nearby_band and narrow_fragment and (overlap_x >= 0.14 or overlap_y >= 0.08) and (same_head or similar_short):
                    should_drop = True
                    break
        if not should_drop and has_hangul_characters(text) and len(alpha_num) <= 2:
            for other in deduped_lines:
                if other is line:
                    continue
                other_text = str(other.get("text") or "").strip()
                other_alpha = normalize_multilingual_token(other_text)
                if len(other_alpha) < len(alpha_num) + 2:
                    continue
                other_bbox = other["bbox"]
                center_delta = abs(line_sort_y(other) - line_sort_y(line))
                min_height = max(8.0, min(bbox_height(other_bbox), bbox_height(line_bbox)))
                nearby_band = center_delta <= min_height * 4.2
                overlap_x = horizontal_overlap_ratio(line_bbox, other_bbox)
                overlap_y = vertical_overlap_ratio(line_bbox, other_bbox)
                contained_x = horizontal_containment_ratio(line_bbox, other_bbox) >= 0.42
                share_head = bool(alpha_num) and bool(other_alpha) and alpha_num[:1] == other_alpha[:1]
                if not share_head:
                    continue
                near_prefix = are_near_duplicate_tokens(alpha_num, other_alpha[:len(alpha_num)])
                if nearby_band and (contained_x or overlap_x >= 0.12) and overlap_y >= 0.04 and near_prefix:
                    should_drop = True
                    break
        if not should_drop and has_hangul_characters(text) and len(alpha_num) <= 2 and not has_terminal_punct:
            line_conf = float(line.get("confidence", 0.0) or 0.0)
            for other in deduped_lines:
                if other is line:
                    continue
                other_text = str(other.get("text") or "").strip()
                other_alpha = normalize_multilingual_token(other_text)
                if len(other_alpha) <= len(alpha_num) + 1:
                    continue
                if not alpha_num or alpha_num[0] != other_alpha[0]:
                    continue
                if alpha_num not in other_alpha and not are_near_duplicate_tokens(alpha_num, other_alpha[:len(alpha_num)]):
                    continue
                other_bbox = other["bbox"]
                center_delta = abs(bbox_center_y(other_bbox) - bbox_center_y(line_bbox))
                min_height = max(8.0, min(bbox_height(other_bbox), bbox_height(line_bbox)))
                overlap_x = horizontal_overlap_ratio(line_bbox, other_bbox)
                contained_x = horizontal_containment_ratio(line_bbox, other_bbox) >= 0.38
                narrow_fragment = bbox_width(line_bbox) <= bbox_width(other_bbox) * 0.6
                nearby_band = center_delta <= max(140.0, min_height * 7.0)
                if nearby_band and narrow_fragment and (contained_x or overlap_x >= 0.2) and line_conf <= 96.0:
                    should_drop = True
                    break
        if not should_drop:
            post_filtered_lines.append(line)

    post_filtered_lines = reorder_tilted_line_clusters(post_filtered_lines)

    filtered_lines: List[Dict[str, Any]] = []
    filtered_words: List[Dict[str, Any]] = []
    for line in post_filtered_lines:
        filtered_lines.append(line)
        filtered_words.extend(line.get("words") or [])

    final_lines, final_particle_drops = drop_final_particle_shadow_lines(
        filtered_lines,
        source="paddle_korean_panel",
    )
    final_words: List[Dict[str, Any]] = []
    for line in final_lines:
        final_words.extend(line.get("words") or [])

    output = make_text_result(final_lines, final_words, result.get("pageSegMode"))
    output["debug"] = {
        "cleanupRoute": "paddle_korean_panel",
        "dropCounts": {
            "hangulFragmentSuppression": len(hangul_fragment_drops),
            "finalParticleShadowSuppression": len(final_particle_drops),
        },
        "droppedWords": list(hangul_fragment_drops) + list(final_particle_drops),
    }
    return output


def cleanup_external_result(result: Dict[str, Any], engine: str, pipeline_profile: str, width: int, height: int, language: str = "") -> Dict[str, Any]:
    language_codes = [code.strip() for code in str(language or "").split("+") if code.strip()]
    is_korean_panel = pipeline_profile == "panel" and "kor" in language_codes
    if engine == "paddleocr" and is_korean_panel:
        return cleanup_paddle_korean_panel_result(result, width, height)
    if engine == "paddleocr" and pipeline_profile == "panel":
        return minimal_cleanup_external_result(result, width, height, pipeline_profile)

    candidate_lines: List[Dict[str, Any]] = []
    candidate_words: List[Dict[str, Any]] = []
    for source_index, line in enumerate(result.get("lines", []) or []):
        text = normalize_text(str(line.get("text") or ""))
        if not text:
            continue
        bbox = line.get("bbox") or {"x0": 0.0, "y0": 0.0, "x1": 0.0, "y1": 0.0}
        if is_korean_panel and is_probable_korean_watermark_noise(text, bbox, width, height):
            continue
        confidence = normalize_confidence(line.get("confidence", 0.0))
        alpha = re.sub(r"[^A-Za-z0-9]+", "", text).upper()
        tokens = [re.sub(r"[^A-Za-z0-9]+", "", part).upper() for part in text.split()]
        tokens = [token for token in tokens if token]

        if engine == "easyocr" and pipeline_profile == "panel":
            is_latin_like = not has_non_latin_characters(text)
            near_edge = float(bbox.get("y1", 0.0)) <= height * 0.16 or float(bbox.get("y0", 0.0)) >= height * 0.84
            if len(tokens) == 1 and tokens[0].isdigit() and confidence < 85:
                continue
            if is_latin_like and confidence < 24 and near_edge and len(tokens) <= 2 and not any(token in SHORT_SPEECH_TOKENS for token in tokens):
                continue
            if is_latin_like and confidence < 18 and len(alpha) <= 3 and not any(token in SHORT_SPEECH_TOKENS for token in tokens):
                continue

        line_words = line.get("words") or explode_line_to_words(text, confidence, bbox)
        normalized_words: List[Dict[str, Any]] = []
        for word in line_words:
            word_text = normalize_text(str(word.get("text") or ""))
            if not word_text:
                continue
            word_conf = normalize_confidence(word.get("confidence", confidence))
            word_bbox = word.get("bbox") or bbox
            normalized_words.append({
                "text": word_text,
                "confidence": word_conf,
                "bbox": {
                    "x0": float(word_bbox.get("x0", 0.0)),
                    "y0": float(word_bbox.get("y0", 0.0)),
                    "x1": float(word_bbox.get("x1", 0.0)),
                    "y1": float(word_bbox.get("y1", 0.0)),
                },
            })

        normalized_words, removed_ad_words = strip_inline_ad_words(normalized_words)
        if not normalized_words:
            continue
        candidate_line = make_line_from_words(normalized_words, line.get("_sortY"), line.get("_sortX")) if removed_ad_words else make_line(text, confidence, bbox, normalized_words, line.get("_sortY"), line.get("_sortX"))
        candidate_line["_sourceIndex"] = source_index
        candidate_lines.append(candidate_line)
        candidate_words.extend(candidate_line["words"])

    if pipeline_profile == "export" and candidate_lines:
        filtered_words: List[Dict[str, Any]] = []
        for line in candidate_lines:
            text = str(line.get("text") or "").strip()
            if not text:
                continue
            bbox = line["bbox"]
            alpha_upper = normalize_alpha_token(text)
            line_tokens = [normalize_alpha_token(part) for part in text.split()]
            line_tokens = [token for token in line_tokens if token]
            if not line_tokens:
                continue
            if has_non_latin_characters(text):
                filtered_words.extend(line["words"])
                continue

            line_height = bbox_height(bbox)
            near_title_band = float(bbox.get("y1", 0.0)) <= height * 0.22
            title_like = near_title_band and (
                line_height >= height * 0.032
                or any(token in HEADING_KEEP_TOKENS for token in line_tokens)
                or not looks_mostly_upper(text)
            )
            mostly_upper = looks_mostly_upper(text)
            small_label = line_height <= height * 0.024
            lower_image_band = float(bbox.get("y0", 0.0)) >= height * 0.46
            cornerish = float(bbox.get("x1", 0.0)) <= width * 0.3 or float(bbox.get("x0", 0.0)) >= width * 0.7

            if len(alpha_upper) <= 1 and not title_like:
                continue
            if (
                small_label
                and mostly_upper
                and not title_like
                and len(line_tokens) <= 3
                and (
                    (lower_image_band and cornerish)
                    or (len(alpha_upper) <= 4 and not any(token in HEADING_KEEP_TOKENS for token in line_tokens))
                )
            ):
                continue
            filtered_words.extend(line["words"])

        candidate_words = filtered_words

    if engine == "easyocr" and pipeline_profile == "panel":
        is_cjk_panel = any(code in {"kor", "jpn", "jpn_vert", "chi_sim", "chi_tra", "tha"} for code in language_codes)
        if is_cjk_panel:
            cleaned_lines = reorder_tilted_line_clusters(candidate_lines)
            cleaned_lines = merge_same_band_fragments(cleaned_lines)
            cleaned_lines = merge_cjk_terminal_left_fragments(cleaned_lines)
            cleaned_lines = merge_cjk_diagonal_continuations(cleaned_lines)
            cleaned_lines = merge_same_band_fragments(cleaned_lines)
            if "kor" in language_codes:
                cleaned_lines = suppress_contained_hangul_fragments(cleaned_lines)
            cleaned_lines = merge_short_lead_lines(cleaned_lines)
            cleaned_lines = reorder_tilted_line_clusters(cleaned_lines)
        else:
            cleaned_lines = merge_same_band_fragments(reorder_tilted_line_clusters(candidate_lines))
            cleaned_lines = merge_short_lead_lines(cleaned_lines)
            cleaned_lines = reorder_tilted_line_clusters(cleaned_lines)

        cleaned_lines, singleton_drops = prune_easyocr_panel_weak_singletons(
            cleaned_lines,
            width,
            height,
            language_codes,
        )
        cleaned_lines, shadow_drops = prune_easyocr_panel_shadow_singletons(
            cleaned_lines,
            language_codes,
        )
        all_easy_drops = singleton_drops + shadow_drops
        cleaned_words: List[Dict[str, Any]] = []
        for line in cleaned_lines:
            cleaned_words.extend(line.get("words") or [])
        cleaned_result = make_text_result(cleaned_lines, cleaned_words, result.get("pageSegMode"))
        if all_easy_drops:
            cleaned_result["debug"] = {
                "cleanupRoute": "easyocr_panel",
                "dropCounts": {
                    "easyPanelSingleton": len(singleton_drops),
                    "easyShadowSingleton": len(shadow_drops),
                },
                "droppedWords": all_easy_drops,
            }
        return cleaned_result

    cleaned_lines, cleaned_words = reflow_external_words(candidate_words, pipeline_profile, width, height)
    if pipeline_profile == "panel":
        cleaned_lines = merge_short_lead_lines(cleaned_lines)
        cleaned_lines.sort(key=line_sort_key)
        cleaned_words = []
        for line in cleaned_lines:
            cleaned_words.extend(line.get("words") or [])
    return make_text_result(cleaned_lines, cleaned_words, result.get("pageSegMode"))


def status_python_module(module_name: str, runtime: str, label: str, timeout_seconds: int = 20) -> Dict[str, Any]:
    if importlib.util.find_spec(module_name) is None:
        return {
            "ok": True,
            "available": False,
            "runtime": runtime,
            "description": f"{label} Python package is not installed",
        }

    try:
        probe = subprocess.run(
            [sys.executable, "-c", f"import {module_name}; print(getattr({module_name}, '__version__', 'unknown'))"],
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": True,
            "available": False,
            "runtime": runtime,
            "description": f"{label} import smoke test timed out after {timeout_seconds}s",
        }

    if probe.returncode != 0:
        message = (probe.stderr or probe.stdout or "").strip() or "unknown import error"
        return {
            "ok": True,
            "available": False,
            "runtime": runtime,
            "description": f"{label} unavailable: {message}",
        }

    return {
        "ok": True,
        "available": True,
        "runtime": runtime,
        "description": f"{label} import OK ({(probe.stdout or 'unknown version').strip()})",
    }


def status_paddleocr() -> Dict[str, Any]:
    return status_python_module("paddleocr", "Python bridge", "PaddleOCR", timeout_seconds=20)


def easy_yolo_service_url() -> str:
    return os.environ.get("EASY_YOLO_OCR_URL", DEFAULT_EASY_YOLO_URL)


def check_http_reachable(url: str) -> Tuple[bool, str]:
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=0.3):
            return True, f"Easy-Yolo-OCR service reachable at {url}"
    except Exception as exc:  # pragma: no cover - depends on local service
        return False, str(exc)


def status_easy_yolo() -> Dict[str, Any]:
    adapter = os.environ.get("EASY_YOLO_OCR_ADAPTER")
    if adapter:
        if os.path.exists(adapter):
            return {
                "ok": True,
                "available": True,
                "runtime": "Adapter bridge",
                "description": f"Easy-Yolo-OCR adapter detected: {adapter}",
            }
        return {
            "ok": True,
            "available": False,
            "runtime": "Adapter bridge",
                "description": f"Easy-Yolo-OCR adapter path not found: {adapter}",
        }

    easyocr_status = status_python_module("easyocr", "Python bridge", "EasyOCR", timeout_seconds=20)
    if easyocr_status.get("available"):
        return easyocr_status

    url = easy_yolo_service_url()
    reachable, message = check_http_reachable(url)
    if reachable:
        return {
            "ok": True,
            "available": True,
            "runtime": "REST service",
            "description": message,
        }
    return {
        "ok": True,
        "available": False,
        "runtime": "REST service",
        "description": f"Easy-Yolo-OCR service unavailable: {message}",
    }


def select_paddle_lang(language: str) -> str:
    codes = [code.strip() for code in (language or "eng").split("+") if code.strip()]
    if not codes:
        return "en"

    priority = [code for code in codes if code != "eng"]
    code = priority[0] if priority else codes[0]
    mapping = {
        "eng": "en",
        "jpn": "japan",
        "jpn_vert": "japan",
        "kor": "korean",
        "chi_sim": "ch",
        "chi_tra": "chinese_cht",
        "tha": "th",
        "vie": "vi",
        "deu": "german",
        "fra": "fr",
        "spa": "es",
        "rus": "ru",
    }
    return mapping.get(code, "en")


def select_easyocr_langs(language: str) -> List[str]:
    codes = [code.strip() for code in (language or "eng").split("+") if code.strip()]
    if not codes:
        return ["en"]

    mapping = {
        "eng": "en",
        "jpn": "ja",
        "jpn_vert": "ja",
        "kor": "ko",
        "chi_sim": "ch_sim",
        "chi_tra": "ch_tra",
        "tha": "th",
        "vie": "vi",
        "deu": "de",
        "fra": "fr",
        "spa": "es",
        "rus": "ru",
    }

    langs: List[str] = []
    for code in codes:
        mapped = mapping.get(code)
        if mapped and mapped not in langs:
            langs.append(mapped)
    if "en" not in langs:
        langs.append("en")
    return langs or ["en"]


def get_paddle_profile_key(args: argparse.Namespace) -> str:
    lang = select_paddle_lang(args.language)
    if normalize_pipeline_profile(args.pipeline_profile) == "panel" and lang == "korean":
        return "cpu_korean_default"
    if normalize_pipeline_profile(args.pipeline_profile) == "panel":
        return "cpu_panel_fast"
    if lang in {"korean", "japan", "ch", "chinese_cht", "th"}:
        return "cpu_cjk"
    return "cpu_shared"


def build_paddle_constructor_kwargs(lang: str, profile_key: str) -> Dict[str, Any]:
    if profile_key == "cpu_korean_default":
        return {
            "text_detection_model_name": "PP-OCRv5_mobile_det",
            "text_recognition_model_name": "korean_PP-OCRv5_mobile_rec",
            "device": "cpu",
            "enable_mkldnn": False,
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        }

    enable_textline_orientation = (
        profile_key == "cpu_korean_default"
        or (
            lang in {"korean", "japan", "ch", "chinese_cht", "th"}
            and profile_key != "cpu_panel_fast"
        )
    )
    text_detection_model_name = None
    if profile_key == "cpu_cjk":
        text_detection_model_name = "PP-OCRv5_server_det"
    elif profile_key != "cpu_korean_default":
        text_detection_model_name = "PP-OCRv5_mobile_det"
    kwargs: Dict[str, Any] = {
        "lang": lang,
        "device": "cpu",
        "enable_mkldnn": False,
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": enable_textline_orientation,
    }
    if text_detection_model_name:
        kwargs["text_detection_model_name"] = text_detection_model_name

    return kwargs


def build_paddle_predict_kwargs(args: argparse.Namespace) -> Dict[str, Any]:
    pipeline = normalize_pipeline_profile(args.pipeline_profile)
    lang = select_paddle_lang(args.language)
    profile_key = get_paddle_profile_key(args)
    is_cjk_like = lang in {"korean", "japan", "ch", "chinese_cht", "th"}
    width = max(1, int(args.width or 0))
    height = max(1, int(args.height or 0))
    shortest = min(width, height)
    longest = max(width, height)
    aspect_ratio = longest / max(1, shortest)
    det_thresh: float | None = None
    det_box_thresh: float | None = None
    det_unclip_ratio: float | None = None
    rec_score_thresh: float | None = None

    if pipeline == "panel":
        if profile_key == "cpu_panel_fast":
            if shortest <= 420:
                det_limit = 2300
            elif shortest <= 720:
                det_limit = 1900
            else:
                det_limit = 1536
            rec_batch = 8
        if is_cjk_like:
            if profile_key != "cpu_panel_fast":
                if aspect_ratio >= 2.3 or longest >= 7000:
                    det_limit = 2560
                    rec_batch = 8
                elif longest >= 5000:
                    det_limit = 2300
                    rec_batch = 8
                elif shortest <= 900:
                    det_limit = 2400
                    rec_batch = 8
                elif shortest <= 1600:
                    det_limit = 2200
                    rec_batch = 8
                else:
                    det_limit = 2000
                    rec_batch = 8
            if lang == "korean":
                # Keep detector thresholds near Paddle defaults to avoid dropping short valid text
                # and rely on deterministic fragment suppression for ghosts.
                det_thresh = 0.30
                det_box_thresh = 0.62
                det_unclip_ratio = 1.50
                rec_score_thresh = 0.32
        else:
            if profile_key != "cpu_panel_fast":
                if shortest <= 420:
                    det_limit = 2300
                elif shortest <= 720:
                    det_limit = 1900
                else:
                    det_limit = 1536
                rec_batch = 8
    else:
        if is_cjk_like:
            det_limit = 2800 if shortest <= 1200 else 3200
        else:
            det_limit = 2200 if shortest <= 900 else 1800
        rec_batch = 10

    predict_kwargs: Dict[str, Any] = {
        "text_det_limit_type": "max",
        "text_det_limit_side_len": det_limit,
        "text_recognition_batch_size": rec_batch,
    }
    if det_thresh is not None:
        predict_kwargs["text_det_thresh"] = det_thresh
    if det_box_thresh is not None:
        predict_kwargs["text_det_box_thresh"] = det_box_thresh
    if det_unclip_ratio is not None:
        predict_kwargs["text_det_unclip_ratio"] = det_unclip_ratio
    if rec_score_thresh is not None:
        predict_kwargs["text_rec_score_thresh"] = rec_score_thresh
    return predict_kwargs


def build_paddle_legacy_predict_kwargs(predict_kwargs: Dict[str, Any]) -> Dict[str, Any]:
    legacy: Dict[str, Any] = {}
    if "text_det_limit_type" in predict_kwargs:
        legacy["det_limit_type"] = predict_kwargs["text_det_limit_type"]
    if "text_det_limit_side_len" in predict_kwargs:
        legacy["det_limit_side_len"] = predict_kwargs["text_det_limit_side_len"]
    if "text_recognition_batch_size" in predict_kwargs:
        legacy["rec_batch_num"] = predict_kwargs["text_recognition_batch_size"]
    return legacy


def call_paddle_predict(ocr: Any, image_path: str, predict_kwargs: Dict[str, Any]) -> Tuple[Any, Dict[str, Any]]:
    adaptive_kwargs = dict(predict_kwargs)
    last_error: Exception | None = None

    while True:
        try:
            return ocr.predict(input=image_path, **adaptive_kwargs), adaptive_kwargs
        except TypeError as exc:
            message = str(exc)
            lowered = message.lower()
            if "unexpected keyword argument" not in lowered:
                raise
            last_error = exc
            match = re.search(r"unexpected keyword argument ['\"]([^'\"]+)['\"]", message, flags=re.IGNORECASE)
            if not match:
                break
            bad_key = match.group(1)
            if bad_key not in adaptive_kwargs:
                break
            adaptive_kwargs.pop(bad_key, None)
            if not adaptive_kwargs:
                break

    try:
        return ocr.predict(input=image_path), {}
    except TypeError as exc:
        last_error = exc

    if last_error is not None:
        raise last_error
    raise RuntimeError("PaddleOCR predict failed without returning a result")


def normalize_paddle_v2_output(raw_result: Any) -> Dict[str, Any]:
    if not isinstance(raw_result, list):
        raise ValueError("Unexpected PaddleOCR response format")

    pages = raw_result[0] if raw_result and isinstance(raw_result[0], list) else raw_result
    lines: List[Dict[str, Any]] = []
    words: List[Dict[str, Any]] = []

    for item in pages:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        points = item[0]
        rec = item[1]
        if not isinstance(rec, (list, tuple)) or len(rec) < 2:
            continue
        text = str(rec[0] or "").strip()
        confidence = float(rec[1] or 0.0)
        if not text:
            continue
        bbox = bbox_from_points(points)
        sort_y, sort_x = sort_hint_from_points(points)
        line_words = explode_line_to_words(text, confidence, bbox)
        lines.append(make_line(text, confidence, bbox, line_words, sort_y, sort_x))
        words.extend(line_words)

    return make_text_result(lines, words)


def normalize_paddle_v3_output(raw_result: Any) -> Dict[str, Any]:
    lines: List[Dict[str, Any]] = []
    words: List[Dict[str, Any]] = []
    iterable = raw_result if isinstance(raw_result, list) else [raw_result]

    for item in iterable:
        if hasattr(item, "json") and isinstance(item.json, dict):
            item = item.json.get("res", item.json)
        if hasattr(item, "to_dict"):
            item = item.to_dict()
        if hasattr(item, "items") and not isinstance(item, dict):
            item = dict(item)
        if not isinstance(item, dict):
            continue

        texts = item.get("rec_texts")
        if texts is None:
            texts = item.get("texts")
        scores = item.get("rec_scores")
        if scores is None:
            scores = item.get("scores")
        polys = item.get("dt_polys")
        if polys is None:
            polys = item.get("polys")
        if polys is None:
            polys = item.get("boxes")

        if hasattr(texts, "tolist"):
            texts = texts.tolist()
        if hasattr(scores, "tolist"):
            scores = scores.tolist()
        if hasattr(polys, "tolist"):
            polys = polys.tolist()

        if texts is None:
            texts = []
        if scores is None:
            scores = []
        if polys is None:
            polys = []
        for index, text in enumerate(texts):
            text_value = str("" if text is None else text).strip()
            if not text_value:
                continue
            points = polys[index] if index < len(polys) else []
            bbox = bbox_from_points(points)
            sort_y, sort_x = sort_hint_from_points(points)
            raw_score = scores[index] if index < len(scores) else 0.0
            if hasattr(raw_score, "item"):
                raw_score = raw_score.item()
            confidence = float(raw_score or 0.0)
            line_words = explode_line_to_words(text_value, confidence, bbox)
            lines.append(make_line(text_value, confidence, bbox, line_words, sort_y, sort_x))
            words.extend(line_words)

    if not lines and not words:
        raise ValueError("No text boxes returned from PaddleOCR")

    return make_text_result(lines, words)


def get_paddle_ocr(lang: str, profile_key: str) -> Any:
    cache_key = (lang, profile_key)
    cached = PADDLE_OCR_CACHE.get(cache_key)
    if cached is not None:
        return cached

    from paddleocr import PaddleOCR  # type: ignore

    constructor_kwargs = build_paddle_constructor_kwargs(lang, profile_key)
    try:
        ocr = PaddleOCR(**constructor_kwargs)
    except TypeError:
        legacy_kwargs = {
            "lang": lang,
            "show_log": False,
            "use_angle_cls": False,
            "use_gpu": False,
        }
        if constructor_kwargs.get("text_detection_model_name"):
            legacy_kwargs["det_model_name"] = constructor_kwargs["text_detection_model_name"]
        ocr = PaddleOCR(**legacy_kwargs)

    PADDLE_OCR_CACHE[cache_key] = ocr
    return ocr


def run_paddleocr(args: argparse.Namespace) -> Dict[str, Any]:
    lang = select_paddle_lang(args.language)
    profile_key = get_paddle_profile_key(args)
    ocr = get_paddle_ocr(lang, profile_key)
    predict_kwargs = build_paddle_predict_kwargs(args)
    started_at = time.perf_counter()

    if hasattr(ocr, "predict"):
        raw_result, applied_predict_kwargs = call_paddle_predict(ocr, args.image, predict_kwargs)

        cleaned = cleanup_external_result(
            normalize_paddle_v3_output(raw_result),
            "paddleocr",
            args.pipeline_profile,
            args.width,
            args.height,
            args.language,
        )
        cleanup_debug = cleaned.get("debug") or {}
        cleaned["debug"] = {
            "profile": profile_key,
            "runtimeMs": round((time.perf_counter() - started_at) * 1000, 1),
            "dropCounts": dict(cleanup_debug.get("dropCounts") or {}),
            "droppedWords": list(cleanup_debug.get("droppedWords") or []),
            "timingsMs": {
                "ocr": round((time.perf_counter() - started_at) * 1000, 1),
            },
            "predictConfig": applied_predict_kwargs,
        }
        return cleaned
    if hasattr(ocr, "ocr"):
        try:
            cleaned = cleanup_external_result(
                normalize_paddle_v2_output(ocr.ocr(args.image, cls=False)),
                "paddleocr",
                args.pipeline_profile,
                args.width,
                args.height,
                args.language,
            )
        except TypeError:
            cleaned = cleanup_external_result(
                normalize_paddle_v2_output(ocr.ocr(args.image)),
                "paddleocr",
                args.pipeline_profile,
                args.width,
                args.height,
                args.language,
            )
        cleanup_debug = cleaned.get("debug") or {}
        cleaned["debug"] = {
            "profile": profile_key,
            "runtimeMs": round((time.perf_counter() - started_at) * 1000, 1),
            "dropCounts": dict(cleanup_debug.get("dropCounts") or {}),
            "droppedWords": list(cleanup_debug.get("droppedWords") or []),
            "timingsMs": {
                "ocr": round((time.perf_counter() - started_at) * 1000, 1),
            },
            "predictConfig": predict_kwargs,
        }
        return cleaned

    raise RuntimeError("Unsupported PaddleOCR API: neither ocr() nor predict() is available")


def run_adapter(adapter_path: str, args: argparse.Namespace) -> Dict[str, Any]:
    command: List[str]
    started_at = time.perf_counter()
    if adapter_path.lower().endswith(".py"):
        command = [
            sys.executable,
            adapter_path,
            "--image",
            args.image,
            "--language",
            args.language,
            "--width",
            str(args.width),
            "--height",
            str(args.height),
            "--dpi",
            str(args.dpi),
        ]
    else:
        command = [
            adapter_path,
            "--image",
            args.image,
            "--language",
            args.language,
            "--width",
            str(args.width),
            "--height",
            str(args.height),
            "--dpi",
            str(args.dpi),
        ]

    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "Easy-Yolo adapter failed")
    output = (completed.stdout or "").strip()
    if not output:
        raise RuntimeError("Easy-Yolo adapter returned an empty response")
    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        payload = output
    if isinstance(payload, dict) and payload.get("ok") is not None:
        cleaned = cleanup_external_result(payload, "easyocr", args.pipeline_profile, args.width, args.height, args.language)
    else:
        cleaned = cleanup_external_result(
        normalize_easy_yolo_response(payload, args.width, args.height),
        "easyocr",
        args.pipeline_profile,
        args.width,
        args.height,
        args.language,
        )
    cleaned["debug"] = {
        **(cleaned.get("debug") or {}),
        "profile": f"adapter:{os.path.basename(adapter_path)}",
        "runtimeMs": round((time.perf_counter() - started_at) * 1000, 1),
        "dropCounts": dict((cleaned.get("debug") or {}).get("dropCounts") or {}),
        "droppedWords": list((cleaned.get("debug") or {}).get("droppedWords") or []),
        "timingsMs": {
            "ocr": round((time.perf_counter() - started_at) * 1000, 1),
        },
    }
    return cleaned


def encode_multipart_file(field_name: str, filename: str, file_bytes: bytes) -> Tuple[bytes, str]:
    boundary = f"----PDFTranslator{uuid.uuid4().hex}"
    lines = [
        f"--{boundary}",
        f'Content-Disposition: form-data; name="{field_name}"; filename="{os.path.basename(filename)}"',
        "Content-Type: application/octet-stream",
        "",
    ]
    body = "\r\n".join(lines).encode("utf-8") + b"\r\n" + file_bytes + b"\r\n" + f"--{boundary}--\r\n".encode("utf-8")
    return body, boundary


def iter_generic_items(payload: Any) -> Iterable[Any]:
    if isinstance(payload, dict):
        if "lines" in payload and isinstance(payload["lines"], list):
            return payload["lines"]
        if "words" in payload and isinstance(payload["words"], list):
            return payload["words"]
        if "result" in payload:
            return iter_generic_items(payload["result"])
    if isinstance(payload, list):
        return payload
    return []


def generic_item_to_line(item: Any) -> Dict[str, Any] | None:
    if isinstance(item, dict):
        text = str(item.get("text") or item.get("label") or item.get("value") or "").strip()
        confidence = float(item.get("confidence") or item.get("score") or item.get("probability") or 0.0)
        bbox_value = item.get("bbox") or item.get("box") or item.get("points") or item.get("polygon")
        sort_y = None
        sort_x = None
        if isinstance(bbox_value, dict):
            bbox = {
                "x0": float(bbox_value.get("x0", 0.0)),
                "y0": float(bbox_value.get("y0", 0.0)),
                "x1": float(bbox_value.get("x1", 0.0)),
                "y1": float(bbox_value.get("y1", 0.0)),
            }
        else:
            bbox = bbox_from_points(bbox_value)
            sort_y, sort_x = sort_hint_from_points(bbox_value)
        if text:
            return make_line(text, confidence, bbox, None, sort_y, sort_x)
    if isinstance(item, (list, tuple)) and len(item) >= 3:
        points = item[0]
        bbox = bbox_from_points(points)
        sort_y, sort_x = sort_hint_from_points(points)
        text = str(item[1] or "").strip()
        confidence = float(item[2] or 0.0)
        if text:
            return make_line(text, confidence, bbox, None, sort_y, sort_x)
    return None


def normalize_easy_yolo_response(payload: Any, width: int, height: int) -> Dict[str, Any]:
    if isinstance(payload, dict) and isinstance(payload.get("lines"), list) and isinstance(payload.get("words"), list):
        return make_text_result(payload["lines"], payload["words"])

    lines: List[Dict[str, Any]] = []
    words: List[Dict[str, Any]] = []
    for item in iter_generic_items(payload):
        line = generic_item_to_line(item)
        if line is None:
            continue
        lines.append(line)
        words.extend(line["words"])

    if lines or words:
        return make_text_result(lines, words)

    text = ""
    if isinstance(payload, dict):
        text = str(payload.get("text") or "").strip()
    elif isinstance(payload, str):
        text = payload.strip()
    if not text:
        raise RuntimeError("Easy-Yolo-OCR response did not include usable text boxes")

    fallback_lines: List[Dict[str, Any]] = []
    fallback_words: List[Dict[str, Any]] = []
    for index, line_text in enumerate([part.strip() for part in text.splitlines() if part.strip()]):
        y0 = (height / max(1, len(text.splitlines()) + 1)) * index
        y1 = y0 + max(24.0, height / max(4, len(text.splitlines()) + 1))
        bbox = {"x0": 0.0, "y0": y0, "x1": float(width), "y1": min(float(height), y1)}
        line = make_line(line_text, 0.0, bbox)
        fallback_lines.append(line)
        fallback_words.extend(line["words"])

    return make_text_result(fallback_lines, fallback_words)


def normalize_easyocr_output(raw_result: Any) -> Dict[str, Any]:
    lines: List[Dict[str, Any]] = []
    words: List[Dict[str, Any]] = []
    if not isinstance(raw_result, list):
        raise RuntimeError("EasyOCR returned an unexpected result shape")

    for item in raw_result:
        if not isinstance(item, (list, tuple)) or len(item) < 3:
            continue
        points = item[0]
        bbox = bbox_from_points(points)
        sort_y, sort_x = sort_hint_from_points(points)
        text = str(item[1] or "").strip()
        confidence = float(item[2] or 0.0)
        if not text:
            continue
        line_words = explode_line_to_words(text, confidence, bbox)
        lines.append(make_line(text, confidence, bbox, line_words, sort_y, sort_x))
        words.extend(line_words)

    if not lines and not words:
        raise RuntimeError("EasyOCR did not return usable text boxes")
    return make_text_result(lines, words)


def get_easyocr_reader(langs: List[str]) -> Any:
    cache_key = tuple(langs)
    cached = EASYOCR_READER_CACHE.get(cache_key)
    if cached is not None:
        return cached

    import easyocr  # type: ignore

    reader = easyocr.Reader(langs, gpu=False, verbose=False)
    EASYOCR_READER_CACHE[cache_key] = reader
    return reader


def run_easyocr_python(args: argparse.Namespace) -> Dict[str, Any]:
    langs = select_easyocr_langs(args.language)
    reader = get_easyocr_reader(langs)
    started_at = time.perf_counter()
    result = reader.readtext(args.image, detail=1, paragraph=False)
    cleaned = cleanup_external_result(
        normalize_easyocr_output(result),
        "easyocr",
        args.pipeline_profile,
        args.width,
        args.height,
        args.language,
    )
    cleanup_debug = cleaned.get("debug") or {}
    cleaned["debug"] = {
        "profile": "+".join(langs),
        "runtimeMs": round((time.perf_counter() - started_at) * 1000, 1),
        "dropCounts": dict(cleanup_debug.get("dropCounts") or {}),
        "droppedWords": list(cleanup_debug.get("droppedWords") or []),
        "timingsMs": {
            "ocr": round((time.perf_counter() - started_at) * 1000, 1),
        },
    }
    return cleaned


def run_easy_yolo(args: argparse.Namespace) -> Dict[str, Any]:
    adapter = os.environ.get("EASY_YOLO_OCR_ADAPTER")
    if adapter:
        return run_adapter(adapter, args)

    if importlib.util.find_spec("easyocr") is not None:
        return run_easyocr_python(args)

    service_url = easy_yolo_service_url()
    started_at = time.perf_counter()
    with open(args.image, "rb") as file_handle:
        file_bytes = file_handle.read()
    body, boundary = encode_multipart_file("file_param_1", args.image, file_bytes)
    request = urllib.request.Request(
        service_url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload_bytes = response.read()
    except urllib.error.HTTPError as exc:
        payload_bytes = exc.read()
        raise RuntimeError(f"Easy-Yolo-OCR HTTP {exc.code}: {payload_bytes.decode('utf-8', errors='replace')}")

    payload_text = payload_bytes.decode("utf-8", errors="replace").strip()
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError:
        payload = payload_text
    cleaned = cleanup_external_result(
        normalize_easy_yolo_response(payload, args.width, args.height),
        "easyocr",
        args.pipeline_profile,
        args.width,
        args.height,
        args.language,
    )
    cleanup_debug = cleaned.get("debug") or {}
    cleaned["debug"] = {
        "profile": "easy-yolo",
        "runtimeMs": round((time.perf_counter() - started_at) * 1000, 1),
        "dropCounts": dict(cleanup_debug.get("dropCounts") or {}),
        "droppedWords": list(cleanup_debug.get("droppedWords") or []),
        "timingsMs": {
            "ocr": round((time.perf_counter() - started_at) * 1000, 1),
        },
    }
    return cleaned


def make_namespace_from_payload(payload: Dict[str, Any], fallback_engine: str) -> argparse.Namespace:
    return argparse.Namespace(
        action=str(payload.get("action") or "ocr"),
        engine=str(payload.get("engine") or fallback_engine),
        image=payload.get("image"),
        language=str(payload.get("language") or "eng"),
        width=int(payload.get("width") or 0),
        height=int(payload.get("height") or 0),
        dpi=int(payload.get("dpi") or 300),
        page_seg_mode=int(payload.get("pageSegMode") or payload.get("page_segm_mode") or 0),
        pipeline_profile=str(payload.get("pipelineProfile") or payload.get("pipeline_profile") or "panel"),
        quality_profile=str(payload.get("qualityProfile") or payload.get("quality_profile") or "best"),
        stdio_server=False,
    )


def prewarm_engine(args: argparse.Namespace) -> Dict[str, Any]:
    if args.engine == "paddleocr":
        lang = select_paddle_lang(args.language)
        profile_key = get_paddle_profile_key(args)
        get_paddle_ocr(lang, profile_key)
        return {
            "ok": True,
            "available": True,
            "runtime": "Python bridge",
            "description": f"PaddleOCR warmed ({lang}, {profile_key})",
        }

    adapter = os.environ.get("EASY_YOLO_OCR_ADAPTER")
    if adapter:
        return {
            "ok": True,
            "available": True,
            "runtime": "Adapter bridge",
            "description": f"Easy-Yolo-OCR adapter ready: {adapter}",
        }

    if importlib.util.find_spec("easyocr") is not None:
        langs = select_easyocr_langs(args.language)
        get_easyocr_reader(langs)
        return {
            "ok": True,
            "available": True,
            "runtime": "Python bridge",
            "description": f"EasyOCR warmed ({'+'.join(langs)})",
        }

    status = status_easy_yolo()
    if not status.get("available"):
        raise RuntimeError(str(status.get("description") or "EasyOCR is unavailable"))
    return status


def handle_action(args: argparse.Namespace) -> Dict[str, Any]:
    if args.action == "status":
        if args.engine == "paddleocr":
            return status_paddleocr()
        return status_easy_yolo()
    if args.action == "prewarm":
        return prewarm_engine(args)

    if not args.image:
        raise RuntimeError("--image is required for OCR actions")

    if args.engine == "paddleocr":
        return run_paddleocr(args)
    return run_easy_yolo(args)


def serve_stdio(default_engine: str) -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request_id: str | None = None
        try:
            payload = json.loads(line)
            if not isinstance(payload, dict):
                raise RuntimeError("Expected a JSON object")
            request_id = str(payload.get("id")) if payload.get("id") is not None else None
            args = make_namespace_from_payload(payload, default_engine)
            response = handle_action(args)
        except Exception as exc:
            response = {"ok": False, "reason": str(exc)}

        if request_id:
            response["id"] = request_id

        sys.stdout.write(json.dumps(response, ensure_ascii=True) + "\n")
        sys.stdout.flush()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True, choices=["status", "ocr", "prewarm"])
    parser.add_argument("--engine", required=True, choices=["paddleocr", "easyocr"])
    parser.add_argument("--image")
    parser.add_argument("--language", default="eng")
    parser.add_argument("--width", type=int, default=0)
    parser.add_argument("--height", type=int, default=0)
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--page-seg-mode", type=int, default=0)
    parser.add_argument("--pipeline-profile", default="panel")
    parser.add_argument("--quality-profile", default="best")
    parser.add_argument("--stdio-server", action="store_true")
    args = parser.parse_args()

    try:
        if args.stdio_server:
            serve_stdio(args.engine)
            return
        respond(handle_action(args))
    except Exception as exc:  # pragma: no cover - exercised through Electron bridge
        respond({"ok": False, "reason": str(exc)}, exit_code=1)


if __name__ == "__main__":
    main()
