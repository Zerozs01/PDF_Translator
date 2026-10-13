import json
import numpy as np

def bbox_iou(b1, b2):
    def to_rect(b):
        if isinstance(b, dict):
            return b['x0'], b['y0'], b['x1'], b['y1']
        xs = [pt[0] for pt in b]
        ys = [pt[1] for pt in b]
        return min(xs), min(ys), max(xs), max(ys)
    r1 = to_rect(b1)
    r2 = to_rect(b2)
    ix0 = max(r1[0], r2[0])
    iy0 = max(r1[1], r2[1])
    ix1 = min(r1[2], r2[2])
    iy1 = min(r1[3], r2[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    a1 = (r1[2] - r1[0]) * (r1[3] - r1[1])
    a2 = (r2[2] - r2[0]) * (r2[3] - r2[1])
    union = a1 + a2 - inter
    return inter / union if union > 0 else 0.0

with open('public/fixtures/ocr/baseline/golden-snapshot-main.json', encoding='utf-8') as f:
    golden = json.load(f)

with open('.tmp-cand-ort_dml.json', encoding='utf-8') as f:
    cand_dml = json.load(f)

with open('.tmp-cand-ort_cpu.json', encoding='utf-8') as f:
    cand_cpu = json.load(f)

with open('.tmp-cand-paddle_cpu.json', encoding='utf-8') as f:
    cand_paddle = json.load(f)

page_map = {'manga1': 2, 'manga2': 3, 'manga3': 5, 'document1': 101, 'document2': 102, 'document3': 103}
golden_pages = {page_map[c['id']]: c for c in golden['cases']}
dml_pages = {p['pageNumber']: p for p in cand_dml['pages']}
cpu_pages = {p['pageNumber']: p for p in cand_cpu['pages']}
paddle_pages = {p['pageNumber']: p for p in cand_paddle['pages']}

print('=== 1. COMPARE CANDIDATES BETWEEN BACKENDS (ORT-DML vs ORT-CPU vs Paddle-CPU) ===')
for pnum in [2, 3, 5, 101, 102, 103]:
    dlines = [l['text'].strip() for l in dml_pages[pnum]['lines']]
    clines = [l['text'].strip() for l in cpu_pages[pnum]['lines']]
    plines = [l['text'].strip() for l in paddle_pages[pnum]['lines']]
    dml_vs_cpu_diff = sum(1 for a, b in zip(dlines, clines) if a != b) + abs(len(dlines) - len(clines))
    dml_vs_paddle_diff = sum(1 for a, b in zip(dlines, plines) if a != b) + abs(len(dlines) - len(plines))
    print(f'Page {pnum}: DML vs ORT-CPU diffs = {dml_vs_cpu_diff}, DML vs Paddle-CPU diffs = {dml_vs_paddle_diff}')

print('\n=== 2. BBOX MATCHING & RECOGNITION COMPARISON (Golden vs ORT-DML) ===')
total_matched_exact = 0
total_matched_diff = 0
total_det_miss = 0

for pnum in [2, 3, 5, 101, 102, 103]:
    g = golden_pages[pnum]
    d = dml_pages[pnum]
    glines = g['lines']
    dlines = d['lines']
    
    matched_exact_text = 0
    matched_diff_text = 0
    unmatched_det = 0
    
    diff_examples = []
    for g_idx, gl in enumerate(glines):
        gbox = gl['box']
        gtxt = gl['text'].strip()
        best_iou = 0.0
        best_dl = None
        for dl in dlines:
            iou = bbox_iou(gbox, dl['bbox'])
            if iou > best_iou:
                best_iou = iou
                best_dl = dl
        if best_iou >= 0.5:
            dtxt = best_dl['text'].strip()
            if gtxt == dtxt:
                matched_exact_text += 1
            else:
                matched_diff_text += 1
                diff_examples.append((gtxt, dtxt, round(best_iou, 2)))
        else:
            unmatched_det += 1
            
    total_matched_exact += matched_exact_text
    total_matched_diff += matched_diff_text
    total_det_miss += unmatched_det
    
    print(f'Page {pnum} (Golden: {len(glines)} lines, Candidate: {len(dlines)} lines):')
    print(f'  BBox Match (IoU>=0.5): Exact Text={matched_exact_text}, Text Diff={matched_diff_text}, Det Miss/Shift={unmatched_det}')
    if diff_examples:
        for gt, dt, iou in diff_examples[:4]:
            print(f'    Golden: \"{gt}\" vs Cand: \"{dt}\" (IoU={iou})')

print(f'\nTOTAL OVER 6 PAGES: Exact Text={total_matched_exact}, Text Diff={total_matched_diff}, Det Miss={total_det_miss}')
