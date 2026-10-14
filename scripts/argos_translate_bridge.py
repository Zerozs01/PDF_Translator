from __future__ import annotations

# pyright: reportMissingImports=false

import argparse
import gc
import json
import os
import re
import sys
import time
import traceback
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Tuple

_ipc_stdout = sys.stdout
_profile_seq = 0



def send_ipc_json(payload: Dict[str, Any]) -> None:
    global _ipc_stdout
    out = _ipc_stdout or sys.stdout
    out.write(json.dumps(payload, ensure_ascii=False) + "\n")
    out.flush()


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

LANGUAGE_ALIASES: Dict[str, str] = {
    "en": "en",
    "eng": "en",
    "english": "en",
    "th": "th",
    "tha": "th",
    "thai": "th",
    "ja": "ja",
    "jpn": "ja",
    "ko": "ko",
    "kor": "ko",
    "zh": "zh",
    "chi": "zh",
    "chi_sim": "zh",
    "chi_tra": "zh",
    "vi": "vi",
    "vie": "vi",
    "de": "de",
    "deu": "de",
    "fr": "fr",
    "fra": "fr",
    "ru": "ru",
    "rus": "ru",
    "es": "es",
    "spa": "es",
}

TRANSLATION_CACHE: Dict[Tuple[str, str, bool], Any] = {}
# Strictly caches raw model output before glossary/rule post-processing
TEXT_TRANSLATION_CACHE: "OrderedDict[Tuple[str, str, bool, str], str]" = OrderedDict()
TEXT_TRANSLATION_CACHE_LIMIT = 4096
INSTALLED_LANGUAGE_CODES_CACHE: List[str] | None = None


def should_skip_translation(text: str) -> bool:
    stripped = text.strip()
    if not stripped or len(stripped) <= 1:
        return True
    # If all characters are digits, punctuation, whitespace, or symbols (no translatable words)
    # e.g. "12", "2024", "1.23", "$100", "---", "...", "1/2", "#99"
    if all(not ch.isalnum() or ch.isdigit() for ch in stripped):
        return True
    return False



def normalize_language(raw_value: Any, fallback: str) -> str:
    raw = str(raw_value or "").strip().lower()
    if not raw:
        return fallback
    if raw in LANGUAGE_ALIASES:
        return LANGUAGE_ALIASES[raw]
    base = raw.split("-")[0].strip()
    return LANGUAGE_ALIASES.get(base, base or fallback)


def load_payload() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("Missing JSON payload on stdin")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("Payload must be a JSON object")
    return data


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


def reset_argos_caches(argos_translate_module: Any) -> None:
    global INSTALLED_LANGUAGE_CODES_CACHE
    try:
        argos_translate_module.get_installed_languages.cache_clear()
    except Exception:
        pass
    try:
        argos_translate_module.installed_translates.clear()
    except Exception:
        pass
    INSTALLED_LANGUAGE_CODES_CACHE = None


def install_noop_sentencizers(argos_translate_module: Any) -> None:
    class NoOpSentencizer:
        def __init__(self, _pkg: Any):
            self.pkg = _pkg

        def split_sentences(self, text: str) -> List[str]:
            compact = str(text or "")
            return [compact] if compact else [""]

        def __str__(self) -> str:
            return "NoOpSentencizer"

    argos_translate_module.StanzaSentencizer = NoOpSentencizer
    argos_translate_module.MiniSBDSentencizer = NoOpSentencizer
    argos_translate_module.SpacySentencizerSmall = NoOpSentencizer


def is_sentence_split_network_error(error: Exception) -> bool:
    message = str(error or "").lower()
    markers = [
        "resources_1.10.0.json",
        "too many requests",
        "429 client error",
        "stanfordnlp/stanza-resources",
        "stanza",
    ]
    return any(marker in message for marker in markers)


def remember_text_translation(cache_key: Tuple[str, str, bool, str], translated: str) -> None:
    TEXT_TRANSLATION_CACHE[cache_key] = translated
    TEXT_TRANSLATION_CACHE.move_to_end(cache_key)
    while len(TEXT_TRANSLATION_CACHE) > TEXT_TRANSLATION_CACHE_LIMIT:
        TEXT_TRANSLATION_CACHE.popitem(last=False)


def get_translation(
    argos_translate_module: Any,
    source_language: str,
    target_language: str,
    force_noop_sentencizer: bool = False,
) -> Any:
    cache_key = (source_language, target_language, force_noop_sentencizer)
    cached = TRANSLATION_CACHE.get(cache_key)
    if cached is not None:
        return cached

    if force_noop_sentencizer:
        install_noop_sentencizers(argos_translate_module)
        reset_argos_caches(argos_translate_module)

    translation = argos_translate_module.get_translation_from_codes(source_language, target_language)
    TRANSLATION_CACHE[cache_key] = translation
    return translation


def translate_texts(
    argos_translate_module: Any,
    texts: List[str],
    source_language: str,
    target_language: str,
    force_noop_sentencizer: bool = False,
    stats: Dict[str, int] | None = None,
) -> List[str]:
    if stats is not None:
        stats["n_texts"] = len(texts)
        stats.setdefault("n_skipped", 0)
        stats.setdefault("n_lru_hit", 0)
        stats.setdefault("n_unique", 0)
        stats.setdefault("n_model_calls", 0)
        stats.setdefault("n_variant_calls", 0)

    translation = get_translation(
        argos_translate_module,
        source_language,
        target_language,
        force_noop_sentencizer=force_noop_sentencizer,
    )

    translations: List[str | None] = [None] * len(texts)
    unique_to_translate: Dict[str, List[int]] = {}

    for idx, text in enumerate(texts):
        normalized_text = str(text or "")
        stripped = normalized_text.strip()
        if not stripped:
            translations[idx] = ""
            continue

        if should_skip_translation(normalized_text):
            if stats is not None:
                stats["n_skipped"] += 1
            translations[idx] = normalized_text
            continue

        cache_key = (source_language, target_language, force_noop_sentencizer, normalized_text)
        cached = TEXT_TRANSLATION_CACHE.get(cache_key)
        if cached is not None:
            if stats is not None:
                stats["n_lru_hit"] += 1
            TEXT_TRANSLATION_CACHE.move_to_end(cache_key)
            translations[idx] = cached
            continue

        if normalized_text not in unique_to_translate:
            unique_to_translate[normalized_text] = []
        unique_to_translate[normalized_text].append(idx)

    if stats is not None:
        stats["n_unique"] = len(unique_to_translate)

    for unique_text, indices in unique_to_translate.items():
        cache_key = (source_language, target_language, force_noop_sentencizer, unique_text)
        if stats is not None:
            stats["n_model_calls"] += 1
        translated = str(translation.translate(unique_text) or "")

        # OpenNMT SentencePiece Casing & Punctuation Fallback:
        # ALL-CAPS text (e.g. "SUPPOSED", "MONEY!", "ORGASM!!") or mixed-case OCR artifacts (e.g. "HEiR!", "WINDiNG")
        # confuses OpenNMT subword tokenizers. If translation produced no target script (e.g. Thai),
        # strip punctuation and retry with Title-case ("Money") or Lower-case ("money").
        if target_language == "th" and (not translated or translated == unique_text or not any('\u0e00' <= c <= '\u0e7f' for c in translated)):
            stripped = unique_text.rstrip("!?.,… ")
            trailing_punct = unique_text[len(stripped):]
            variants: List[str] = []
            if stripped:
                variants.extend([stripped.title(), stripped.lower(), stripped.capitalize()])
            if "ABLETO" in unique_text.upper():
                variants.append(re.sub(r"\bABLETO\b", "able to", unique_text, flags=re.I))
            for variant in variants:
                if not variant or variant == unique_text:
                    continue
                if stats is not None:
                    stats["n_variant_calls"] += 1
                alt_translated = str(translation.translate(variant) or "")
                if alt_translated and any('\u0e00' <= c <= '\u0e7f' for c in alt_translated):
                    if trailing_punct and not any(alt_translated.endswith(p) for p in "!?.,…"):
                        translated = alt_translated + trailing_punct
                    else:
                        translated = alt_translated
                    break

        remember_text_translation(cache_key, translated)
        for idx in indices:
            translations[idx] = translated

    return [t if t is not None else "" for t in translations]



def get_installed_language_codes(argos_translate_module: Any) -> List[str]:
    global INSTALLED_LANGUAGE_CODES_CACHE
    if INSTALLED_LANGUAGE_CODES_CACHE is not None:
        return INSTALLED_LANGUAGE_CODES_CACHE

    installed_languages = argos_translate_module.get_installed_languages()
    INSTALLED_LANGUAGE_CODES_CACHE = sorted(
        {str(language.code).lower() for language in installed_languages}
    )
    return INSTALLED_LANGUAGE_CODES_CACHE


def validate_languages(argos_translate_module: Any, source_language: str, target_language: str) -> List[str]:
    installed_codes = get_installed_language_codes(argos_translate_module)

    if source_language not in installed_codes:
        raise RuntimeError(
            f"Argos source language '{source_language}' is not installed. Installed languages: {', '.join(installed_codes) or '(none)'}"
        )
    if target_language not in installed_codes:
        raise RuntimeError(
            f"Argos target language '{target_language}' is not installed. Installed languages: {', '.join(installed_codes) or '(none)'}"
        )

    return installed_codes


_kiwi_instance = None


def get_kiwi_instance() -> Any:
    global _kiwi_instance
    if _kiwi_instance is None:
        try:
            from kiwipiepy import Kiwi
            _kiwi_instance = Kiwi()
        except ImportError:
            _kiwi_instance = False
    return _kiwi_instance


_argos_translate_module = None


def get_argos_translate_module() -> Any:
    global _argos_translate_module
    if _argos_translate_module is None:
        _argos_translate_module = init_argos_module()
    return _argos_translate_module


_m2m_translator = None
_m2m_tokenizer = None


def get_m2m_components() -> Tuple[Any, Any]:
    global _m2m_translator, _m2m_tokenizer
    if _m2m_translator is None or _m2m_tokenizer is None:
        try:
            import ctranslate2
            import transformers

            model_path = Path(__file__).parent.parent / "models" / "m2m100_ct2"
            if not model_path.exists():
                raise RuntimeError(f"M2M100 model directory does not exist: {model_path}")

            device = "cpu"
            compute_type = "int8"
            try:
                if ctranslate2.get_cuda_device_count() > 0:
                    device = "cuda"
                    compute_type = "int8_float16"
            except Exception:
                pass

            _m2m_translator = ctranslate2.Translator(str(model_path), device=device, compute_type=compute_type)
            _m2m_tokenizer = transformers.AutoTokenizer.from_pretrained(str(model_path))
        except Exception as e:
            raise RuntimeError(f"Failed to initialize M2M100 translator: {e}")

    return _m2m_translator, _m2m_tokenizer


def process_m2m_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw_texts = payload.get("texts", [])
    if not isinstance(raw_texts, list):
        raise ValueError("Field 'texts' must be an array")

    texts: List[str] = [str(item or "") for item in raw_texts]
    source_language = normalize_language(payload.get("sourceLanguage"), "en")
    target_language = normalize_language(payload.get("targetLanguage"), "th")

    if source_language == "ko":
        kiwi = get_kiwi_instance()
        if kiwi:
            texts = [kiwi.space(t, reset_whitespace=False) for t in texts]

    if source_language == target_language:
        return {
            "ok": True,
            "engine": "m2m100",
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "translations": texts,
        }

    translator, tokenizer = get_m2m_components()
    tokenizer.src_lang = source_language

    source_tokens = []
    for t in texts:
        if not t.strip():
            source_tokens.append([])
            continue
        ids = tokenizer.encode(t)
        tokens = tokenizer.convert_ids_to_tokens(ids)
        source_tokens.append(tokens)

    active_indices = [i for i, tokens in enumerate(source_tokens) if tokens]
    if not active_indices:
        return {
            "ok": True,
            "engine": "m2m100",
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "translations": [""] * len(texts),
        }

    active_tokens = [source_tokens[i] for i in active_indices]
    target_prefix_token = tokenizer.lang_code_to_token[target_language]
    target_prefixes = [[target_prefix_token] for _ in range(len(active_tokens))]

    results = translator.translate_batch(
        active_tokens,
        target_prefix=target_prefixes
    )

    translations = [""] * len(texts)
    for idx, res in zip(active_indices, results):
        translated_tokens = res.hypotheses[0]
        translated_text = tokenizer.decode(tokenizer.convert_tokens_to_ids(translated_tokens), skip_special_tokens=True)
        translations[idx] = translated_text

    return {
        "ok": True,
        "engine": "m2m100",
        "sourceLanguage": source_language,
        "targetLanguage": target_language,
        "translations": translations,
    }


def process_payload(payload: Dict[str, Any], stats: Dict[str, int] | None = None) -> Dict[str, Any]:
    engine = payload.get("engine", "argos")
    if engine == "m2m100":
        return process_m2m_payload(payload)

    raw_texts = payload.get("texts", [])
    if not isinstance(raw_texts, list):
        raise ValueError("Field 'texts' must be an array")

    texts: List[str] = [str(item or "") for item in raw_texts]
    source_language = normalize_language(payload.get("sourceLanguage"), "en")
    target_language = normalize_language(payload.get("targetLanguage"), "th")

    argos_translate_module = get_argos_translate_module()
    validate_languages(argos_translate_module, source_language, target_language)

    if source_language == "ko":
        kiwi = get_kiwi_instance()
        if kiwi:
            texts = [kiwi.space(t, reset_whitespace=False) for t in texts]

    if source_language == target_language:
        return {
            "ok": True,
            "engine": "argos",
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "translations": texts,
        }

    fallback_reason: str | None = None
    force_noop = (
        os.getenv("ARGOS_FORCE_NOOP_SENTENCIZER", "1") == "1"
        or bool(payload.get("forceNoOpSentencizer"))
        or payload.get("sourceType") in ("ocr_lines", "text")
        or payload.get("mode") in ("manga", "panel")
    )

    if force_noop:
        translations = translate_texts(
            argos_translate_module,
            texts,
            source_language,
            target_language,
            force_noop_sentencizer=True,
            stats=stats,
        )
    else:
        try:
            translations = translate_texts(
                argos_translate_module,
                texts,
                source_language,
                target_language,
                force_noop_sentencizer=False,
                stats=stats,
            )
        except Exception as primary_error:
            if not is_sentence_split_network_error(primary_error):
                raise

            fallback_reason = str(primary_error)
            translations = translate_texts(
                argos_translate_module,
                texts,
                source_language,
                target_language,
                force_noop_sentencizer=True,
                stats=stats,
            )

    output: Dict[str, Any] = {
        "ok": True,
        "engine": "argos",
        "sourceLanguage": source_language,
        "targetLanguage": target_language,
        "translations": translations,
    }
    if fallback_reason:
        output["warning"] = "Recovered from Stanza/network sentence-splitting error by using local no-op sentence splitting."
        output["fallbackReason"] = fallback_reason
    return output


def serve_stdio() -> None:
    global _ipc_stdout, _profile_seq
    _ipc_stdout = sys.stdout
    sys.stdout = sys.stderr

    request_count = 0
    profile_log_enabled = os.getenv("ARGOS_PROFILE_LOG") == "1"
    dump_payloads_path = os.getenv("ARGOS_DUMP_PAYLOADS")

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        _profile_seq += 1
        t_start_epoch_ms = round(time.time() * 1000)
        stats = {
            "n_texts": 0,
            "n_skipped": 0,
            "n_lru_hit": 0,
            "n_unique": 0,
            "n_model_calls": 0,
            "n_variant_calls": 0,
        }

        request_id: str | None = None
        try:
            payload = json.loads(line)
            if not isinstance(payload, dict):
                raise ValueError("Payload must be a JSON object")
            request_id = str(payload.get("id")) if payload.get("id") is not None else None

            if dump_payloads_path:
                try:
                    with open(dump_payloads_path, "a", encoding="utf-8") as dump_file:
                        dump_file.write(
                            json.dumps(
                                {"seq": _profile_seq, "t_start_epoch_ms": t_start_epoch_ms, "payload": payload},
                                ensure_ascii=False,
                            )
                            + "\n"
                        )
                except Exception as dump_err:
                    print(f"[ARGOS_PROFILE] Failed to dump payload: {dump_err}", file=sys.stderr)

            t0 = time.perf_counter()
            response = process_payload(payload, stats=stats)
            compute_ms = (time.perf_counter() - t0) * 1000
        except Exception as exc:
            compute_ms = 0.0
            response = {"ok": False, "reason": str(exc)}

        if request_id:
            response["id"] = request_id

        send_ipc_json(response)

        gc_ms = 0.0
        request_count += 1
        if request_count % 10 == 0:
            t_gc0 = time.perf_counter()
            gc.collect()
            gc_ms = (time.perf_counter() - t_gc0) * 1000

        if profile_log_enabled:
            print(
                f"[ARGOS_PROFILE] {json.dumps({'seq': _profile_seq, 'id': request_id, 'pid': os.getpid(), 't_start_epoch_ms': t_start_epoch_ms, 'n_texts': stats['n_texts'], 'n_skipped': stats['n_skipped'], 'n_lru_hit': stats['n_lru_hit'], 'n_unique': stats['n_unique'], 'n_model_calls': stats['n_model_calls'], 'n_variant_calls': stats['n_variant_calls'], 'compute_ms': round(compute_ms, 2), 'gc_ms': round(gc_ms, 2)})}",
                file=sys.stderr,
                flush=True,
            )


def init_argos_module() -> Any:
    os.environ.setdefault("ARGOS_CHUNK_TYPE", "MINISBD")
    configure_runtime_dirs()

    try:
        import argostranslate.translate as argos_translate
    except ModuleNotFoundError as exc:
        print(
            "Argos Translate Python package is not available. "
            "Install it in the active Python environment: python -m pip install argostranslate",
            file=sys.stderr,
        )
        raise SystemExit(3) from exc
    except Exception as exc:
        print(f"Failed to initialize Argos Translate runtime: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise SystemExit(3) from exc

    return argos_translate


def main() -> None:
    global _profile_seq
    parser = argparse.ArgumentParser()
    parser.add_argument("--stdio-server", action="store_true")
    args = parser.parse_args()

    if args.stdio_server:
        serve_stdio()
        return

    _profile_seq += 1
    t_start_epoch_ms = round(time.time() * 1000)
    stats = {
        "n_texts": 0,
        "n_skipped": 0,
        "n_lru_hit": 0,
        "n_unique": 0,
        "n_model_calls": 0,
        "n_variant_calls": 0,
    }

    payload = load_payload()
    dump_payloads_path = os.getenv("ARGOS_DUMP_PAYLOADS")
    if dump_payloads_path:
        try:
            with open(dump_payloads_path, "a", encoding="utf-8") as dump_file:
                dump_file.write(
                    json.dumps(
                        {"seq": _profile_seq, "t_start_epoch_ms": t_start_epoch_ms, "payload": payload},
                        ensure_ascii=False,
                    )
                    + "\n"
                )
        except Exception:
            pass

    t0 = time.perf_counter()
    response = process_payload(payload, stats=stats)
    compute_ms = (time.perf_counter() - t0) * 1000
    send_ipc_json(response)

    if os.getenv("ARGOS_PROFILE_LOG") == "1":
        request_id = str(payload.get("id")) if isinstance(payload, dict) and payload.get("id") is not None else None
        print(
            f"[ARGOS_PROFILE] {json.dumps({'seq': _profile_seq, 'id': request_id, 'pid': os.getpid(), 't_start_epoch_ms': t_start_epoch_ms, 'n_texts': stats['n_texts'], 'n_skipped': stats['n_skipped'], 'n_lru_hit': stats['n_lru_hit'], 'n_unique': stats['n_unique'], 'n_model_calls': stats['n_model_calls'], 'n_variant_calls': stats['n_variant_calls'], 'compute_ms': round(compute_ms, 2), 'gc_ms': 0.0})}",
            file=sys.stderr,
            flush=True,
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise

