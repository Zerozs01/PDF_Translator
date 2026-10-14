from __future__ import annotations

import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parent))

from argos_translate_bridge import (
    get_argos_translate_module,
    get_translation,
    translate_texts,
    _extract_ct2_hops,
    _run_ct2_batch_hops,
)

def run_equivalence_test():
    argos_module = get_argos_translate_module()
    test_cases = [
        "Hello world!",
        "Manga panels often contain short exclamation phrases.",
        "What are you doing here?",
        "I cannot believe this happened so suddenly.",
        "Let's test batch processing performance on CPU.",
        "Offline translation pipeline optimization.",
        "Are you ready for the adventure?",
        "Stop right there, villain!",
        "She looked up at the stars and wondered about the universe.",
        "SUPPOSED",
        "MONEY!",
        "ORGASM!!",
        "HEiR!",
        "WINDiNG",
        "ABLETO",
        "You are ABLETO do this right now!",
        "What...?!",
        "Huh?!",
        "A regular sentence for sanity checking.",
        "Another sentence with numbers 123 and symbols #$%."
    ]

    print(f"--- Running Exact Equivalence Test on {len(test_cases)} sentences ---")
    
    # 1. Baseline: Force hops=None (executes legacy one-by-one loop in translate_texts)
    import argos_translate_bridge
    orig_extract = argos_translate_bridge._extract_ct2_hops
    argos_translate_bridge._extract_ct2_hops = lambda _trans: None
    
    from argos_translate_bridge import TEXT_TRANSLATION_CACHE
    TEXT_TRANSLATION_CACHE.clear()
    
    legacy_results = translate_texts(
        argos_module,
        test_cases,
        source_language="en",
        target_language="th",
        force_noop_sentencizer=True,
    )

    # 2. Vectorized 2-Wave fast path via translate_texts (restore hops extraction)
    argos_translate_bridge._extract_ct2_hops = orig_extract
    TEXT_TRANSLATION_CACHE.clear()
    
    vectorized_results = translate_texts(
        argos_module,
        test_cases,
        source_language="en",
        target_language="th",
        force_noop_sentencizer=True,
    )

    mismatches = 0
    for i, (orig, leg, vec) in enumerate(zip(test_cases, legacy_results, vectorized_results)):
        match = (leg.strip() == vec.strip())
        status = "MATCH" if match else "MISMATCH"
        if not match:
            mismatches += 1
            print(f"[{status}] #{i+1} '{orig}'")
            print(f"   Legacy:     '{leg}'")
            print(f"   Vectorized: '{vec}'")
        else:
            print(f"[{status}] #{i+1} '{orig}' -> '{vec}'")

    print("------------------------------------------------------------------")
    print(f"Total: {len(test_cases)}, Matches: {len(test_cases) - mismatches}, Mismatches: {mismatches}")
    match_rate = ((len(test_cases) - mismatches) / len(test_cases)) * 100
    print(f"Equivalence Rate: {match_rate:.2f}%")
    
    if mismatches > 0:
        print("[WARNING] Not 100% exact match, please inspect differences.")
        sys.exit(1)
    else:
        print("[SUCCESS] 100.0% Exact Match Parity Verified!")

if __name__ == "__main__":
    run_equivalence_test()
