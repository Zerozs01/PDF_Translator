from __future__ import annotations

# pyright: reportMissingImports=false

import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List

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
    """Clear argostranslate language/translation caches for deterministic retries."""
    try:
        argos_translate_module.get_installed_languages.cache_clear()
    except Exception:
        pass
    try:
        argos_translate_module.installed_translates.clear()
    except Exception:
        pass


def install_noop_sentencizers(argos_translate_module: Any) -> None:
    """Disable sentence boundary dependencies for fallback mode."""

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


def translate_texts(
    argos_translate_module: Any,
    texts: List[str],
    source_language: str,
    target_language: str,
    force_noop_sentencizer: bool = False,
) -> List[str]:
    if force_noop_sentencizer:
        install_noop_sentencizers(argos_translate_module)

    reset_argos_caches(argos_translate_module)
    translation = argos_translate_module.get_translation_from_codes(source_language, target_language)

    translations: List[str] = []
    for text in texts:
        if not text.strip():
            translations.append("")
            continue
        translated = translation.translate(text)
        translations.append(str(translated or ""))
    return translations


def main() -> None:
    # Avoid forcing Stanza downloads at runtime. Allow explicit override if user sets this env var.
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

    payload = load_payload()
    raw_texts = payload.get("texts", [])
    if not isinstance(raw_texts, list):
        raise ValueError("Field 'texts' must be an array")

    texts: List[str] = [str(item or "") for item in raw_texts]
    source_language = normalize_language(payload.get("sourceLanguage"), "en")
    target_language = normalize_language(payload.get("targetLanguage"), "th")

    installed_languages = argos_translate.get_installed_languages()
    installed_codes = sorted({str(language.code).lower() for language in installed_languages})

    if source_language not in installed_codes:
        raise RuntimeError(
            f"Argos source language '{source_language}' is not installed. Installed languages: {', '.join(installed_codes) or '(none)'}"
        )
    if target_language not in installed_codes:
        raise RuntimeError(
            f"Argos target language '{target_language}' is not installed. Installed languages: {', '.join(installed_codes) or '(none)'}"
        )

    if source_language == target_language:
        output = {
            "engine": "argos",
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "translations": texts,
        }
        print(json.dumps(output, ensure_ascii=False))
        return

    fallback_reason: str | None = None
    try:
        translations = translate_texts(
            argos_translate,
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
            argos_translate,
            texts,
            source_language,
            target_language,
            force_noop_sentencizer=True,
        )

    output = {
        "engine": "argos",
        "sourceLanguage": source_language,
        "targetLanguage": target_language,
        "translations": translations,
    }
    if fallback_reason:
        output["warning"] = "Recovered from Stanza/network sentence-splitting error by using local no-op sentence splitting."
        output["fallbackReason"] = fallback_reason
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
