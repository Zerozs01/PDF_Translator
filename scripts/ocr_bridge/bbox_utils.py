"""Bounding Box utilities for OCR Python Bridge."""
from typing import List

BBox = List[int]  # [x, y, w, h]


def compute_iou(box1: BBox, box2: BBox) -> float:
    x1, y1, w1, h1 = box1
    x2, y2, w2, h2 = box2

    inter_x1 = max(x1, x2)
    inter_y1 = max(y1, y2)
    inter_x2 = min(x1 + w1, x2 + w2)
    inter_y2 = min(y1 + h1, y2 + h2)

    inter_w = max(0, inter_x2 - inter_x1)
    inter_h = max(0, inter_y2 - inter_y1)

    inter_area = inter_w * inter_h
    area1 = w1 * h1
    area2 = w2 * h2
    union_area = area1 + area2 - inter_area

    if union_area <= 0:
        return 0.0

    return inter_area / union_area


def is_contained(small_box: BBox, large_box: BBox, threshold: float = 0.8) -> bool:
    x1, y1, w1, h1 = small_box
    x2, y2, w2, h2 = large_box

    inter_x1 = max(x1, x2)
    inter_y1 = max(y1, y2)
    inter_x2 = min(x1 + w1, x2 + w2)
    inter_y2 = min(y1 + h1, y2 + h2)

    inter_w = max(0, inter_x2 - inter_x1)
    inter_h = max(0, inter_y2 - inter_y1)

    inter_area = inter_w * inter_h
    small_area = w1 * h1

    if small_area <= 0:
        return False

    return (inter_area / small_area) >= threshold
