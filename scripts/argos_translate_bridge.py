from __future__ import annotations

# pyright: reportMissingImports=false

import argparse
import gc
import json
import os
import re
import sys
import traceback
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Tuple

_ipc_stdout = sys.stdout


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
) -> List[str]:
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
            translations[idx] = normalized_text
            continue

        cache_key = (source_language, target_language, force_noop_sentencizer, normalized_text)
        cached = TEXT_TRANSLATION_CACHE.get(cache_key)
        if cached is not None:
            TEXT_TRANSLATION_CACHE.move_to_end(cache_key)
            translations[idx] = cached
            continue

        if normalized_text not in unique_to_translate:
            unique_to_translate[normalized_text] = []
        unique_to_translate[normalized_text].append(idx)

    for unique_text, indices in unique_to_translate.items():
        cache_key = (source_language, target_language, force_noop_sentencizer, unique_text)
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


def process_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
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
        )
    else:
        try:
            translations = translate_texts(
                argos_translate_module,
                texts,
                source_language,
                target_language,
                force_noop_sentencizer=False,
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
    global _ipc_stdout
    _ipc_stdout = sys.stdout
    sys.stdout = sys.stderr

    request_count = 0
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request_id: str | None = None
        try:
            payload = json.loads(line)
            if not isinstance(payload, dict):
                raise ValueError("Payload must be a JSON object")
            request_id = str(payload.get("id")) if payload.get("id") is not None else None
            response = process_payload(payload)
        except Exception as exc:
            response = {"ok": False, "reason": str(exc)}

        if request_id:
            response["id"] = request_id

        send_ipc_json(response)

        request_count += 1
        if request_count % 10 == 0:
            gc.collect()


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
    parser = argparse.ArgumentParser()
    parser.add_argument("--stdio-server", action="store_true")
    args = parser.parse_args()

    if args.stdio_server:
        serve_stdio()
        return

    payload = load_payload()
    response = process_payload(payload)
    send_ipc_json(response)




if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
