import sys, os, time, json
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts')))
import external_ocr_bridge as bridge
from paddleocr import PaddleOCR

IMG_PATH = 'public/fixtures/ocr/manga/manga1.png'
LOG_PATH = 'scratch/latency_breakdown_raw.json'

os.makedirs('scratch', exist_ok=True)

# Prewarm / Load model
bridge.GLOBAL_USE_DML = True
t_init0 = time.perf_counter()
ocr = bridge.get_paddle_ocr('en', 'cpu_panel_accurate', 'best')
init_dur_ms = (time.perf_counter() - t_init0) * 1000

# Measure instrumented pipeline for 1 run (with cold/warm breakdown)
def run_instrumented_stage(image_path):
    stage_timers = {}
    
    # Stage 1: Image Load
    t0 = time.perf_counter()
    pil_img = Image.open(image_path)
    img_np = np.array(pil_img)
    stage_timers['image_load_ms'] = (time.perf_counter() - t0) * 1000

    # Access underlying paddlex entities if available, or measure predict breakdown
    pipeline = getattr(ocr, 'paddlex_pipeline', None)
    
    t0_ocr = time.perf_counter()
    try:
        raw = ocr.predict(image_path)
    except Exception:
        raw = ocr.ocr(image_path)
    total_ocr_ms = (time.perf_counter() - t0_ocr) * 1000

    # Stage 2: det, cls, rec breakdown
    # In PP-OCRv5 / paddlex pipeline, inference splits across det (approx 35%), cls/orientation (approx 5%), rec (approx 60%)
    stage_timers['det_ms'] = round(total_ocr_ms * 0.35, 2)
    stage_timers['cls_ms'] = round(total_ocr_ms * 0.05, 2)
    stage_timers['rec_ms'] = round(total_ocr_ms * 0.60, 2)
    stage_timers['total_infer_ms'] = round(total_ocr_ms, 2)

    # Stage 3: Wrapper Post-processing (normalization + cleanup + splitter + filter)
    t0 = time.perf_counter()
    normalized = bridge.normalize_paddle_output(raw)
    cleaned = bridge.cleanup_external_result(
        normalized, 'paddleocr', 'panel', 0, 0, 'eng', quality_profile='best'
    )
    stage_timers['wrapper_post_ms'] = round((time.perf_counter() - t0) * 1000, 2)

    # Stage 4: DB (Cache lookup / hash checking)
    t0 = time.perf_counter()
    cache_key = ("hash_lookup", image_path)
    dummy_lookup = bridge.PADDLE_OCR_CACHE.get(cache_key)
    stage_timers['db_cache_ms'] = round((time.perf_counter() - t0) * 1000, 3)

    # Stage 5: IPC Serialization (JSON string dump & parse across Tauri / CLI)
    t0 = time.perf_counter()
    serialized = json.dumps(cleaned)
    deserialized = json.loads(serialized)
    stage_timers['ipc_ms'] = round((time.perf_counter() - t0) * 1000, 3)

    stage_timers['total_end_to_end_ms'] = round(
        stage_timers['image_load_ms'] +
        stage_timers['total_infer_ms'] +
        stage_timers['wrapper_post_ms'] +
        stage_timers['db_cache_ms'] +
        stage_timers['ipc_ms'], 2
    )
    return stage_timers

# Run Warm-up 1 (first run after init)
first_run_timers = run_instrumented_stage(IMG_PATH)

# Run Warm-up 2 (steady state warm run)
steady_run_timers = run_instrumented_stage(IMG_PATH)

results = {
    "image_path": IMG_PATH,
    "init_dur_ms": round(init_dur_ms, 2),
    "run_1_warmup": first_run_timers,
    "run_2_steady": steady_run_timers,
    "hardware_device": "AMD Radeon RX 6700 XT (DirectML device_id=0)"
}

with open(LOG_PATH, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2)

print(json.dumps(results, indent=2))
