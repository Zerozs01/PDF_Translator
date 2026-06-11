import sqlite3
import os
import json
import re

db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 337 AND page_number = 7 AND ocr_engine = 'paddleocr'")
row = cur.fetchone()
if not row:
    print("No row found.")
    conn.close()
    exit(0)

# Helper functions identical to external_ocr_bridge.py
def bbox_width(bbox):
    return float(bbox.get("x1", 0.0)) - float(bbox.get("x0", 0.0))

def bbox_height(bbox):
    return float(bbox.get("y1", 0.0)) - float(bbox.get("y0", 0.0))

def bbox_center_x(bbox):
    return (float(bbox.get("x0", 0.0)) + float(bbox.get("x1", 0.0))) / 2.0

def bbox_center_y(bbox):
    return (float(bbox.get("y0", 0.0)) + float(bbox.get("y1", 0.0))) / 2.0

def count_line_word_boxes(line):
    return len(line.get("words") or [])

def split_text_tokens(text):
    return len(re.sub(r"\s+", " ", text).split(" "))

def normalize_confidence(conf):
    return float(conf or 0.0)

def horizontal_overlap_ratio(b1, b2):
    w1 = bbox_width(b1)
    w2 = bbox_width(b2)
    x0 = max(float(b1.get("x0", 0.0)), float(b2.get("x0", 0.0)))
    x1 = min(float(b1.get("x1", 0.0)), float(b2.get("x1", 0.0)))
    if x1 <= x0:
        return 0.0
    overlap = x1 - x0
    return overlap / min(w1, w2)

def vertical_overlap_ratio(b1, b2):
    h1 = bbox_height(b1)
    h2 = bbox_height(b2)
    y0 = max(float(b1.get("y0", 0.0)), float(b2.get("y0", 0.0)))
    y1 = min(float(b1.get("y1", 0.0)), float(b2.get("y1", 0.0)))
    if y1 <= y0:
        return 0.0
    overlap = y1 - y0
    return overlap / min(h1, h2)

# Load all candidate lines (before contextual drops)
# We can rebuild the candidate lines by parsing the saved ocr_data
data = json.loads(row[0])
kept = data.get('lines', [])
dropped = data.get('debug', {}).get('droppedWords', [])

all_candidates = []
for line in kept:
    all_candidates.append(line)
for d in dropped:
    if 'bbox' in d and d['bbox'] is not None:
        # Reconstruct candidates that were dropped
        all_candidates.append({
            "text": d["text"],
            "confidence": d["confidence"],
            "bbox": d["bbox"],
            "words": d.get("words", [])
        })

print(f"Total candidates reconstructed: {len(all_candidates)}")

width = data.get('width', 1000)
height = data.get('height', 1000)

for line in all_candidates:
    text = line.get("text")
    if "LiKE GiANT" not in text and "FiELD. ARENT" not in text:
        continue
        
    bbox = line.get("bbox") or {}
    line_w = max(1.0, bbox_width(bbox))
    line_h = max(1.0, bbox_height(bbox))
    center_x = bbox_center_x(bbox)
    center_y = bbox_center_y(bbox)
    token_count = len(text.split())
    word_box_count = count_line_word_boxes(line)
    
    print(f"\nAnalyzing target: {repr(text)}")
    print(f"  BBox: {bbox} | Width: {line_w} | Height: {line_h}")
    
    # Simulate neighbor collection
    neighbors = []
    for other in all_candidates:
        if other is line:
            continue
        other_text = other.get("text", "")
        other_bbox = other.get("bbox") or {}
        other_w = max(1.0, bbox_width(other_bbox))
        other_h = max(1.0, bbox_height(other_bbox))
        overlap_x = horizontal_overlap_ratio(bbox, other_bbox)
        overlap_y = vertical_overlap_ratio(bbox, other_bbox)
        other_center_x = bbox_center_x(other_bbox)
        other_center_y = bbox_center_y(other_bbox)
        token_count_other = len(other_text.split())
        word_boxes_other = count_line_word_boxes(other)
        strong_signal = (
            word_boxes_other >= 2
            or token_count_other >= 2
            or normalize_confidence(other.get("confidence", 0.0)) >= normalize_confidence(line.get("confidence", 0.0)) + 2.0
        )
        neighbors.append({
            "text": other_text,
            "bbox": other_bbox,
            "width": other_w,
            "height": other_h,
            "overlapX": overlap_x,
            "overlapY": overlap_y,
            "centerDeltaX": abs(center_x - other_center_x),
            "centerDeltaY": abs(center_y - other_center_y),
            "centerY": other_center_y,
            "strongSignal": strong_signal,
        })
        
    same_band_neighbors = [
        n for n in neighbors
        if n["overlapY"] >= 0.18 or n["centerDeltaY"] <= max(96.0, line_h * 0.95)
    ]
    left_anchors = [
        n for n in same_band_neighbors
        if n["strongSignal"]
        and n["width"] <= line_w * 0.46
        and float(n["bbox"].get("x1", 0.0)) <= center_x - max(84.0, line_w * 0.08)
    ]
    right_anchors = [
        n for n in same_band_neighbors
        if n["strongSignal"]
        and n["width"] <= line_w * 0.46
        and float(n["bbox"].get("x0", 0.0)) >= center_x + max(84.0, line_w * 0.08)
    ]
    
    print(f"  same_band_neighbors count: {len(same_band_neighbors)}")
    print(f"  left_anchors: {[n['text'] for n in left_anchors]}")
    print(f"  right_anchors: {[n['text'] for n in right_anchors]}")
    
    for left_anchor in left_anchors:
        for right_anchor in right_anchors:
            y_check = abs(left_anchor["centerY"] - right_anchor["centerY"]) <= max(104.0, line_h * 0.9)
            dist_check = (float(right_anchor["bbox"].get("x0", 0.0)) - float(left_anchor["bbox"].get("x1", 0.0))) >= max(240.0, line_w * 0.18)
            print(f"    Comparing left: {repr(left_anchor['text'])} & right: {repr(right_anchor['text'])}")
            print(f"      y_check: {y_check} (delta Y = {abs(left_anchor['centerY'] - right_anchor['centerY'])})")
            print(f"      dist_check: {dist_check} (distance = {float(right_anchor['bbox'].get('x0', 0.0)) - float(left_anchor['bbox'].get('x1', 0.0))})")

conn.close()
