from __future__ import annotations

# pyright: reportMissingImports=false

import argparse
import json
import os
import sys
import traceback
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Tuple

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
TEXT_TRANSLATION_CACHE: "OrderedDict[Tuple[str, str, bool, str], str]" = OrderedDict()
TEXT_TRANSLATION_CACHE_LIMIT = 2048
INSTALLED_LANGUAGE_CODES_CACHE: List[str] | None = None


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

    translations: List[str] = []
    for text in texts:
        normalized_text = str(text or "")
        if not normalized_text.strip():
            translations.append("")
            continue

        cache_key = (source_language, target_language, force_noop_sentencizer, normalized_text)
        cached = TEXT_TRANSLATION_CACHE.get(cache_key)
        if cached is not None:
            TEXT_TRANSLATION_CACHE.move_to_end(cache_key)
            translations.append(cached)
            continue

        translated = str(translation.translate(normalized_text) or "")
        remember_text_translation(cache_key, translated)
        translations.append(translated)
    return translations


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


def process_payload(argos_translate_module: Any, payload: Dict[str, Any]) -> Dict[str, Any]:
    raw_texts = payload.get("texts", [])
    if not isinstance(raw_texts, list):
        raise ValueError("Field 'texts' must be an array")

    texts: List[str] = [str(item or "") for item in raw_texts]
    source_language = normalize_language(payload.get("sourceLanguage"), "en")
    target_language = normalize_language(payload.get("targetLanguage"), "th")

    validate_languages(argos_translate_module, source_language, target_language)

    if source_language == target_language:
        return {
            "ok": True,
            "engine": "argos",
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "translations": texts,
        }

    fallback_reason: str | None = None
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


def serve_stdio(argos_translate_module: Any) -> None:
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
            response = process_payload(argos_translate_module, payload)
        except Exception as exc:
            response = {"ok": False, "reason": str(exc)}

        if request_id:
            response["id"] = request_id

        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()


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

    argos_translate = init_argos_module()

    if args.stdio_server:
        serve_stdio(argos_translate)
        return

    payload = load_payload()
    response = process_payload(argos_translate, payload)
    print(json.dumps(response, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
