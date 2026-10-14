from __future__ import annotations

import os
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).parent))

from argos_translate_bridge import (
    get_argos_translate_module,
    get_translation,
    translate_texts,
    _extract_ct2_hops,
    _run_ct2_batch_hops,
    TEXT_TRANSLATION_CACHE,
)

def run_ablation():
    argos_module = get_argos_translate_module()
    
    # 25 realistic Manga & general sentences
    sentences = [
        "Hello world!",
        "Manga panels often contain short exclamation phrases.",
        "What are you doing here?",
        "I cannot believe this happened so suddenly.",
        "Let's test batch processing performance on CPU.",
        "Offline translation pipeline optimization.",
        "Are you ready for the adventure?",
        "Stop right there, villain!",
        "She looked up at the stars and wondered about the universe.",
        "Wait, is that really true?",
        "Don't worry about it, everything will be just fine.",
        "Could you please explain this in more detail?",
        "He quietly closed the door and walked away.",
        "They have been working on this project for months.",
        "I need a cup of hot coffee before starting work.",
        "Look at that amazing view from the mountaintop!",
        "Why did you leave without saying anything?",
        "This software runs completely offline without any cloud connection.",
        "Fast response time is critical for good user experience.",
        "SUPPOSED",
        "MONEY!",
        "ORGASM!!",
        "HEiR!",
        "WINDiNG",
        "ABLETO",
    ]

    print("================================================================")
    print("  Task 2b: Beam Size Ablation Study (Beam 4 vs Beam 1 Greedy)")
    print("================================================================")
    print(f"Test Corpus: {len(sentences)} sample sentences\n")

    # Warmup
    _ = translate_texts(argos_module, ["Warmup test"], "en", "th", force_noop_sentencizer=True)

    # 1. Run with beam_size = 4
    TEXT_TRANSLATION_CACHE.clear()
    os.environ["ARGOS_BEAM_SIZE"] = "4"
    t0 = time.perf_counter()
    results_b4 = translate_texts(argos_module, sentences, "en", "th", force_noop_sentencizer=True)
    t_b4 = (time.perf_counter() - t0) * 1000

    # 2. Run with beam_size = 1 (Greedy search)
    TEXT_TRANSLATION_CACHE.clear()
    os.environ["ARGOS_BEAM_SIZE"] = "1"
    t0 = time.perf_counter()
    results_b1 = translate_texts(argos_module, sentences, "en", "th", force_noop_sentencizer=True)
    t_b1 = (time.perf_counter() - t0) * 1000

    print(f"Timing Results ({len(sentences)} sentences):")
    print(f"  • beam_size=4: {t_b4:.2f} ms")
    print(f"  • beam_size=1: {t_b1:.2f} ms")
    speedup = t_b4 / max(1.0, t_b1)
    print(f"  🚀 Speedup: {speedup:.2f}x faster with beam_size=1!\n")

    # Quality / Semantic Comparison
    exact_matches = 0
    diffs = []
    for i, (orig, b4, b1) in enumerate(zip(sentences, results_b4, results_b1)):
        if b4.strip() == b1.strip():
            exact_matches += 1
        else:
            diffs.append((i + 1, orig, b4, b1))

    match_pct = (exact_matches / len(sentences)) * 100
    print(f"Parity & Differences Analysis:")
    print(f"  • Exact Match: {exact_matches}/{len(sentences)} ({match_pct:.1f}%)")
    print(f"  • Differences: {len(diffs)}/{len(sentences)}\n")

    if diffs:
        print("Detailed Comparison of Differing Translations:")
        for idx, orig, b4, b1 in diffs:
            print(f"  [#{idx}] '{orig}'")
            print(f"     Beam 4: '{b4}'")
            print(f"     Beam 1: '{b1}'")

    print("\n================================================================")

if __name__ == "__main__":
    run_ablation()
