import sys
import os
import json
import hashlib
import argparse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts')))
import external_ocr_bridge as bridge
from paddleocr import PaddleOCR
import onnxruntime as ort

fixtures = [
    ('manga1', 'public/fixtures/ocr/manga/manga1.png', 2),
    ('manga2', 'public/fixtures/ocr/manga/manga2.png', 3),
    ('manga3', 'public/fixtures/ocr/manga/manga3.png', 5),
    ('document1', 'public/fixtures/ocr/document_test/document1.png', 101),
    ('document2', 'public/fixtures/ocr/document_test/document2.png', 102),
    ('document3', 'public/fixtures/ocr/document_test/document3.png', 103),
]

def run_isolated_candidate(candidate_mode):
    # candidate_mode: 'paddle_cpu', 'ort_cpu', 'ort_dml'
    print(f"[Process {os.getpid()}] Starting mode: {candidate_mode}", file=sys.stderr)
    
    if candidate_mode == 'paddle_cpu':
        bridge.GLOBAL_USE_DML = False
        kw = bridge.build_paddle_constructor_kwargs('en', 'cpu_panel_accurate', use_angle_cls=True)
        kw['use_onnx'] = False
        ocr = PaddleOCR(**kw)
    elif candidate_mode == 'ort_cpu':
        bridge.GLOBAL_USE_DML = False
        orig_init = ort.InferenceSession
        def force_cpu(path, *args, **kwargs):
            kwargs['providers'] = ['CPUExecutionProvider']
            return orig_init(path, *args, **kwargs)
        ort.InferenceSession = force_cpu
        kw = bridge.build_paddle_constructor_kwargs('en', 'cpu_panel_accurate', use_angle_cls=True)
        kw['use_onnx'] = True
        ocr = PaddleOCR(**kw)
    elif candidate_mode == 'ort_dml':
        bridge.GLOBAL_USE_DML = True
        kw = bridge.build_paddle_constructor_kwargs('en', 'cpu_panel_accurate', use_angle_cls=True)
        kw['use_onnx'] = True
        ocr = PaddleOCR(**kw)

    # Active providers
    loaded_providers = {
        'det': ocr.text_detector.predictor.get_providers() if hasattr(ocr, 'text_detector') and hasattr(ocr.text_detector, 'predictor') and hasattr(ocr.text_detector.predictor, 'get_providers') else ['NativePaddleC++'],
        'rec': ocr.text_recognizer.predictor.get_providers() if hasattr(ocr, 'text_recognizer') and hasattr(ocr.text_recognizer, 'predictor') and hasattr(ocr.text_recognizer.predictor, 'get_providers') else ['NativePaddleC++']
    }
    print(f"[Process {os.getpid()}] Providers: {loaded_providers}", file=sys.stderr)

    results = {}
    for fid, img_path, pnum in fixtures:
        raw = ocr.ocr(img_path, cls=True)
        results[fid] = raw

    # Convert to canonical json string
    dumped = json.dumps(results, sort_keys=True)
    out_hash = hashlib.sha256(dumped.encode('utf-8')).hexdigest()

    output = {
        'mode': candidate_mode,
        'pid': os.getpid(),
        'providers': loaded_providers,
        'hash': out_hash,
        'results': results
    }
    with open(f'.tmp_raw_{candidate_mode}.json', 'w', encoding='utf-8') as f:
        json.dump(output, f)
    print(f"[Process {os.getpid()}] Complete. Hash: {out_hash}", file=sys.stderr)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', required=True, choices=['paddle_cpu', 'ort_cpu', 'ort_dml'])
    args = parser.parse_args()
    run_isolated_candidate(args.mode)
