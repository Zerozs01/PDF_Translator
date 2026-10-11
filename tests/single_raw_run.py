import sys, os, json, argparse, time
import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts')))
import external_ocr_bridge as bridge
from paddleocr import PaddleOCR

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--backend', required=True, choices=['dml', 'cpu'])
    parser.add_argument('--rec_batch_num', type=int, default=None)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    if args.backend == 'dml':
        bridge.GLOBAL_USE_DML = True
    else:
        bridge.GLOBAL_USE_DML = False

    t0_init = time.perf_counter()
    ocr = bridge.get_paddle_ocr('en', 'cpu_panel_accurate', 'best')
    init_dur = time.perf_counter() - t0_init

    t0_infer = time.perf_counter()
    try:
        raw = ocr.predict(args.image)
    except Exception:
        raw = ocr.ocr(args.image)
    infer_dur = time.perf_counter() - t0_infer

    # Extract lines: support both paddle dict format and paddle list format
    lines = []
    if raw and isinstance(raw[0], dict):
        rec_texts = raw[0].get('rec_texts', [])
        rec_scores = raw[0].get('rec_scores', [])
        dt_polys = raw[0].get('dt_polys', [])
        for i in range(len(rec_texts)):
            txt = str(rec_texts[i])
            score = float(rec_scores[i]) if i < len(rec_scores) else 0.0
            poly = dt_polys[i].tolist() if i < len(dt_polys) and hasattr(dt_polys[i], 'tolist') else (dt_polys[i] if i < len(dt_polys) else [])
            lines.append({
                "line_idx": i,
                "text": txt,
                "score": round(score, 4),
                "box": poly
            })
    elif raw and isinstance(raw[0], list):
        for i, item in enumerate(raw[0]):
            box, (txt, score) = item
            lines.append({
                "line_idx": i,
                "text": str(txt),
                "score": round(float(score), 4),
                "box": box
            })

    output = {
        "backend": args.backend,
        "image": args.image,
        "pid": os.getpid(),
        "init_sec": round(init_dur, 4),
        "infer_sec": round(infer_dur, 4),
        "lines": lines
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

if __name__ == '__main__':
    main()
