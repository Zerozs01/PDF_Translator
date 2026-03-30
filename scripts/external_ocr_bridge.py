import argparse
import importlib.util
import json
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
DOMAIN_SUFFIX_TOKENS = {"COM", "NET", "ORG", "IO", "GG", "CO"}
HEADING_KEEP_TOKENS = {"CHAPTER", "SECTION", "PART", "OBJECTIVES", "CONDITIONS", "FIG"}


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


def make_line(text: str, confidence: float, bbox: Dict[str, float], words: List[Dict[str, Any]] | None = None) -> Dict[str, Any]:
    normalized_text = normalize_text(text)
    return {
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


def bbox_union(items: List[Dict[str, Any]]) -> Dict[str, float]:
    if not items:
        return {"x0": 0.0, "y0": 0.0, "x1": 0.0, "y1": 0.0}
    return {
        "x0": min(float(item["bbox"].get("x0", 0.0)) for item in items),
        "y0": min(float(item["bbox"].get("y0", 0.0)) for item in items),
        "x1": max(float(item["bbox"].get("x1", 0.0)) for item in items),
        "y1": max(float(item["bbox"].get("y1", 0.0)) for item in items),
    }


def make_line_from_words(words: List[Dict[str, Any]]) -> Dict[str, Any]:
    normalized_words = sorted(words, key=lambda item: (float(item["bbox"].get("x0", 0.0)), float(item["bbox"].get("y0", 0.0))))
    text = " ".join(str(word.get("text") or "").strip() for word in normalized_words).strip()
    confidences = [normalize_confidence(word.get("confidence", 0.0)) for word in normalized_words]
    confidence = sum(confidences) / len(confidences) if confidences else 0.0
    return make_line(text, confidence, bbox_union(normalized_words), normalized_words)


def looks_mostly_upper(text: str) -> bool:
    letters = [char for char in text if char.isalpha()]
    if not letters:
        return False
    uppercase = sum(1 for char in letters if char.isupper())
    return uppercase / len(letters) >= 0.8


def normalize_alpha_token(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "", str(text or "")).upper()


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
    if any(marker in alpha for marker in ("ASCENS", "SCENS", "ASURA", "NEWTOKI", "NSTINASCENS", "TINASCENS", "SCANSCOM")):
        return True
    if alpha.endswith("SCANS") and len(alpha) >= 6:
        return True
    if alpha.endswith("MANGA") and len(alpha) >= 6:
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
            if gap <= row_gap_threshold or overlap >= 0.35:
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


def minimal_cleanup_external_result(result: Dict[str, Any]) -> Dict[str, Any]:
    lines: List[Dict[str, Any]] = []
    words: List[Dict[str, Any]] = []

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

        normalized_words, removed_ad_words = strip_inline_ad_words(normalized_words)
        if not normalized_words:
            continue

        candidate_line = make_line_from_words(normalized_words) if removed_ad_words else make_line(text, confidence, bbox, normalized_words)
        if is_probable_ascii_ghost(candidate_line["text"]):
            continue
        lines.append(candidate_line)
        words.extend(candidate_line["words"])

    lines.sort(key=lambda item: (float(item["bbox"].get("y0", 0.0)), float(item["bbox"].get("x0", 0.0))))
    words.sort(key=lambda item: (float(item["bbox"].get("y0", 0.0)), float(item["bbox"].get("x0", 0.0))))
    return make_text_result(lines, words, result.get("pageSegMode"))


def cleanup_paddle_korean_panel_result(result: Dict[str, Any], width: int, height: int) -> Dict[str, Any]:
    candidate_lines: List[Dict[str, Any]] = []

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

        candidate_lines.append(make_line_from_words(line_kept_words))

    candidate_lines.sort(key=lambda item: (bbox_center_y(item["bbox"]), float(item["bbox"].get("x0", 0.0))))
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
            center_delta = abs(bbox_center_y(existing["bbox"]) - bbox_center_y(line_bbox))
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

    filtered_lines: List[Dict[str, Any]] = []
    filtered_words: List[Dict[str, Any]] = []
    for line in deduped_lines:
        filtered_lines.append(line)
        filtered_words.extend(line.get("words") or [])

    return make_text_result(filtered_lines, filtered_words, result.get("pageSegMode"))


def cleanup_external_result(result: Dict[str, Any], engine: str, pipeline_profile: str, width: int, height: int, language: str = "") -> Dict[str, Any]:
    if engine == "paddleocr" and pipeline_profile == "panel" and "kor" in str(language or "").split("+"):
        return cleanup_paddle_korean_panel_result(result, width, height)
    if engine == "paddleocr" and pipeline_profile == "panel":
        return minimal_cleanup_external_result(result)

    candidate_lines: List[Dict[str, Any]] = []
    candidate_words: List[Dict[str, Any]] = []
    short_speech_tokens = {"EH", "ME", "I", "OH", "AH", "NO"}

    for line in result.get("lines", []) or []:
        text = normalize_text(str(line.get("text") or ""))
        if not text:
            continue
        bbox = line.get("bbox") or {"x0": 0.0, "y0": 0.0, "x1": 0.0, "y1": 0.0}
        confidence = normalize_confidence(line.get("confidence", 0.0))
        alpha = re.sub(r"[^A-Za-z0-9]+", "", text).upper()
        tokens = [re.sub(r"[^A-Za-z0-9]+", "", part).upper() for part in text.split()]
        tokens = [token for token in tokens if token]

        if engine == "easyocr" and pipeline_profile == "panel":
            near_edge = float(bbox.get("y1", 0.0)) <= height * 0.16 or float(bbox.get("y0", 0.0)) >= height * 0.84
            if len(tokens) == 1 and tokens[0].isdigit() and confidence < 85:
                continue
            if confidence < 24 and near_edge and len(tokens) <= 2 and not any(token in short_speech_tokens for token in tokens):
                continue
            if confidence < 18 and len(alpha) <= 3 and not any(token in short_speech_tokens for token in tokens):
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
        candidate_line = make_line_from_words(normalized_words) if removed_ad_words else make_line(text, confidence, bbox, normalized_words)
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

    cleaned_lines, cleaned_words = reflow_external_words(candidate_words, pipeline_profile, width, height)
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

    if pipeline == "panel":
        if profile_key == "cpu_panel_fast":
            if shortest <= 420:
                det_limit = 2300
            elif shortest <= 720:
                det_limit = 1900
            else:
                det_limit = 1536
            rec_batch = 8
        elif profile_key == "cpu_korean_default":
            return {}
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

    return {
        "text_det_limit_type": "max",
        "text_det_limit_side_len": det_limit,
        "text_recognition_batch_size": rec_batch,
    }


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
    candidate_kwargs: List[Dict[str, Any]] = [
        dict(predict_kwargs),
        {k: v for k, v in predict_kwargs.items() if k != "text_det_limit_type"},
        {k: v for k, v in predict_kwargs.items() if k == "text_det_limit_side_len"},
        {},
    ]

    seen: set[Tuple[Tuple[str, Any], ...]] = set()
    last_error: Exception | None = None

    for kwargs in candidate_kwargs:
        key = tuple(sorted(kwargs.items()))
        if key in seen:
            continue
        seen.add(key)
        try:
            return ocr.predict(input=image_path, **kwargs), kwargs
        except TypeError as exc:
            message = str(exc)
            if "unexpected keyword argument" not in message.lower():
                raise
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
        line_words = explode_line_to_words(text, confidence, bbox)
        lines.append(make_line(text, confidence, bbox, line_words))
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
            bbox = bbox_from_points(polys[index] if index < len(polys) else [])
            raw_score = scores[index] if index < len(scores) else 0.0
            if hasattr(raw_score, "item"):
                raw_score = raw_score.item()
            confidence = float(raw_score or 0.0)
            line_words = explode_line_to_words(text_value, confidence, bbox)
            lines.append(make_line(text_value, confidence, bbox, line_words))
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
        cleaned["debug"] = {
            "profile": profile_key,
            "runtimeMs": round((time.perf_counter() - started_at) * 1000, 1),
            "dropCounts": {},
            "droppedWords": [],
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
        cleaned["debug"] = {
            "profile": profile_key,
            "runtimeMs": round((time.perf_counter() - started_at) * 1000, 1),
            "dropCounts": {},
            "droppedWords": [],
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
        if isinstance(bbox_value, dict):
            bbox = {
                "x0": float(bbox_value.get("x0", 0.0)),
                "y0": float(bbox_value.get("y0", 0.0)),
                "x1": float(bbox_value.get("x1", 0.0)),
                "y1": float(bbox_value.get("y1", 0.0)),
            }
        else:
            bbox = bbox_from_points(bbox_value)
        if text:
            return make_line(text, confidence, bbox)
    if isinstance(item, (list, tuple)) and len(item) >= 3:
        bbox = bbox_from_points(item[0])
        text = str(item[1] or "").strip()
        confidence = float(item[2] or 0.0)
        if text:
            return make_line(text, confidence, bbox)
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
        bbox = bbox_from_points(item[0])
        text = str(item[1] or "").strip()
        confidence = float(item[2] or 0.0)
        if not text:
            continue
        line_words = explode_line_to_words(text, confidence, bbox)
        lines.append(make_line(text, confidence, bbox, line_words))
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
    cleaned["debug"] = {
        "profile": "+".join(langs),
        "runtimeMs": round((time.perf_counter() - started_at) * 1000, 1),
        "dropCounts": {},
        "droppedWords": [],
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
    cleaned["debug"] = {
        "profile": "easy-yolo",
        "runtimeMs": round((time.perf_counter() - started_at) * 1000, 1),
        "dropCounts": {},
        "droppedWords": [],
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
