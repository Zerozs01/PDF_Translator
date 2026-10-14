from __future__ import annotations

import gc
import inspect
import os
import sys
import time
from pathlib import Path
from typing import Any, List

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def configure_runtime_dirs() -> None:
    local_app_data = os.getenv("LOCALAPPDATA")

    def ensure_writable_dir(candidates: List[Path]) -> Path:
        last_error: Exception | None = None
        for candidate in candidates:
            try:
                candidate.mkdir(parents=True, exist_ok=True)
                return candidate
            except Exception as exc:
                last_error = exc
                continue
        if last_error:
            raise last_error
        raise RuntimeError("No writable Argos runtime directory candidates were available")

    if not os.getenv("XDG_CONFIG_HOME"):
        config_candidates = [
            Path.cwd() / ".argos-runtime" / "config",
            Path.home() / ".local" / "state" / "pdf-translator" / "argos-config",
        ]
        if local_app_data:
            config_candidates.insert(0, Path(local_app_data) / "PDF_Translator" / "argos-config")
        config_root = ensure_writable_dir(config_candidates)
        os.environ["XDG_CONFIG_HOME"] = str(config_root)

    if not os.getenv("XDG_CACHE_HOME"):
        cache_candidates = [
            Path.cwd() / ".argos-runtime" / "cache",
            Path.home() / ".local" / "cache" / "pdf-translator" / "argos-cache",
        ]
        if local_app_data:
            cache_candidates.insert(0, Path(local_app_data) / "PDF_Translator" / "argos-cache")
        cache_root = ensure_writable_dir(cache_candidates)
        os.environ["XDG_CACHE_HOME"] = str(cache_root)


def main() -> None:
    configure_runtime_dirs()

    print("==================================================")
    print("  Task 0.1: Argos / CTranslate2 Internal Inspection")
    print("==================================================")

    # 1. Print package versions
    packages = ["argostranslate", "ctranslate2", "sentencepiece", "stanza"]
    for pkg in packages:
        try:
            mod = __import__(pkg)
            version = getattr(mod, "__version__", "unknown")
            print(f"[Version] {pkg}: {version}")
        except ImportError:
            print(f"[Version] {pkg}: NOT INSTALLED")

    import argostranslate.settings as settings
    import argostranslate.translate
    import ctranslate2

    # 2. Load en -> th translation
    print("\n[Loading Translation] en -> th...")
    translation = argostranslate.translate.get_translation_from_codes("en", "th")
    if not translation:
        print("[ERROR] Translation 'en -> th' not found! Make sure Argos en->th package is installed.")
        return

    print(f"[Translation Object] type: {type(translation)}")
    underlying = getattr(translation, "underlying", translation)
    print(f"[Underlying Translation] type: {type(underlying)}")

    # Ensure translator is initialized in underlying PackageTranslation
    if hasattr(underlying, "translator") and underlying.translator is None:
        model_path = str(underlying.pkg.package_path / "model")
        print(f"[Initializing ctranslate2.Translator from package_path]: {model_path}")
        underlying.translator = ctranslate2.Translator(
            model_path,
            device=settings.device,
            inter_threads=settings.inter_threads,
            intra_threads=settings.intra_threads,
            compute_type=settings.compute_type,
        )

    translator: ctranslate2.Translator = getattr(underlying, "translator", None)
    pkg = getattr(underlying, "pkg", None)
    tokenizer = getattr(pkg, "tokenizer", None) if pkg else None
    target_prefix = getattr(pkg, "target_prefix", "") if pkg else ""

    print(f"\n[CTranslate2 Translator Inspection]")
    if translator:
        print(f"  type: {type(translator)}")
        print(f"  device: {getattr(translator, 'device', 'N/A')}")
        print(f"  compute_type: {getattr(translator, 'compute_type', 'N/A')}")
        print(f"  num_threads (inter/intra): inter={settings.inter_threads}, intra={settings.intra_threads}")
        print(f"  max_queued_batches: {getattr(translator, 'max_queued_batches', 'N/A')}")
        print(f"  model_is_loaded: {getattr(translator, 'model_is_loaded', 'N/A')}")
    else:
        print("  Translator not found!")

    print(f"\n[Tokenizer & Package Inspection]")
    if pkg:
        print(f"  package_path: {getattr(pkg, 'package_path', 'N/A')}")
        print(f"  from_code: {getattr(pkg, 'from_code', 'N/A')} -> to_code: {getattr(pkg, 'to_code', 'N/A')}")
        print(f"  target_prefix: '{target_prefix}'")
    if tokenizer:
        print(f"  tokenizer type: {type(tokenizer)}")
        print(f"  tokenizer dir: {dir(tokenizer)}")

    # 4. Micro-benchmark with 16 sample sentences
    sample_sentences = [
        "Hello world!",
        "This is an engineering benchmark for Argos Translate and CTranslate2.",
        "The quick brown fox jumps over the lazy dog.",
        "Manga panels often contain short exclamation phrases.",
        "What are you doing here?",
        "I cannot believe this happened so suddenly.",
        "Let's test batch processing performance on CPU.",
        "Offline translation pipeline optimization.",
        "Are you ready for the adventure?",
        "Stop right there, villain!",
        "She looked up at the stars and wondered about the universe.",
        "To be or not to be, that is the question.",
        "High performance computing requires careful resource allocation.",
        "Please make sure all unit tests pass before shipping.",
        "Artificial intelligence and deep learning models on personal computers.",
        "End of the benchmark test set.",
    ]

    print("\n==================================================")
    print("  Running Micro-benchmarks (16 sentences)")
    print("==================================================")

    # Warmup
    _ = translation.translate(sample_sentences[0])

    # 1. Baseline: translation.translate(text) one-by-one
    gc.collect()
    t0 = time.perf_counter()
    baseline_results = []
    for s in sample_sentences:
        res = translation.translate(s)
        baseline_results.append(res)
    t_baseline = (time.perf_counter() - t0) * 1000

    print(f"\n1. Baseline loop (translation.translate): {t_baseline:.2f} ms")
    for s, r in zip(sample_sentences[:3], baseline_results[:3]):
        print(f"   Sample: '{s}' -> '{r}'")

    if translator and tokenizer:
        # Batch tokenization
        tokenized_batch = [tokenizer.encode(s) for s in sample_sentences]
        target_prefixes = [[target_prefix]] * len(tokenized_batch) if target_prefix else None

        # Helper to decode
        def decode_results(batch_results: Any) -> List[str]:
            decoded = []
            for item in batch_results:
                toks = item.hypotheses[0]
                text = tokenizer.decode(toks)
                if target_prefix and text.startswith(target_prefix):
                    text = text[len(target_prefix):]
                if text.startswith(" "):
                    text = text[1:]
                decoded.append(text)
            return decoded

        # 2a: translate_batch with beam_size=4
        gc.collect()
        t0 = time.perf_counter()
        batch_res_b4 = translator.translate_batch(
            tokenized_batch,
            target_prefix=target_prefixes,
            beam_size=4,
            max_batch_size=2048,
            batch_type="tokens",
            replace_unknowns=True,
            length_penalty=0.2,
        )
        detok_b4 = decode_results(batch_res_b4)
        t_batch_b4 = (time.perf_counter() - t0) * 1000
        print(f"\n2. translate_batch (beam_size=4, max_batch_size=2048 tokens): {t_batch_b4:.2f} ms (Speedup vs Baseline: {t_baseline / t_batch_b4:.2f}x)")
        for s, r in zip(sample_sentences[:3], detok_b4[:3]):
            print(f"   Sample: '{s}' -> '{r}'")

        # 2b: translate_batch with beam_size=2
        gc.collect()
        t0 = time.perf_counter()
        batch_res_b2 = translator.translate_batch(
            tokenized_batch,
            target_prefix=target_prefixes,
            beam_size=2,
            max_batch_size=2048,
            batch_type="tokens",
            replace_unknowns=True,
            length_penalty=0.2,
        )
        detok_b2 = decode_results(batch_res_b2)
        t_batch_b2 = (time.perf_counter() - t0) * 1000
        print(f"\n3. translate_batch (beam_size=2, max_batch_size=2048 tokens): {t_batch_b2:.2f} ms (Speedup vs Baseline: {t_baseline / t_batch_b2:.2f}x, vs b4: {t_batch_b4 / t_batch_b2:.2f}x)")
        for s, r in zip(sample_sentences[:3], detok_b2[:3]):
            print(f"   Sample: '{s}' -> '{r}'")

        # Check equivalence between beam_size=4 batch and baseline
        match_count = sum(1 for b, d in zip(baseline_results, detok_b4) if b.strip() == d.strip())
        print(f"\n[Quality / Equivalence Check] beam_size=4 matches baseline: {match_count}/{len(sample_sentences)} ({match_count/len(sample_sentences)*100:.1f}%)")

    print("\n[Done] Task 0.1 Inspection script finished successfully.")


if __name__ == "__main__":
    main()
