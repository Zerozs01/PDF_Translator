from __future__ import annotations

# pyright: reportMissingImports=false

import json
import sys
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


def main() -> None:
    try:
        import argostranslate.translate
    except Exception as exc:
        print(
            "Argos Translate Python package is not available. "
            "Install it in the active Python environment: python -m pip install argostranslate",
            file=sys.stderr,
        )
        raise SystemExit(3) from exc

    payload = load_payload()
    raw_texts = payload.get("texts", [])
    if not isinstance(raw_texts, list):
        raise ValueError("Field 'texts' must be an array")

    texts: List[str] = [str(item or "") for item in raw_texts]
    source_language = normalize_language(payload.get("sourceLanguage"), "en")
    target_language = normalize_language(payload.get("targetLanguage"), "th")

    installed_languages = argostranslate.translate.get_installed_languages()
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

    translations: List[str] = []
    for text in texts:
        if not text.strip():
            translations.append("")
            continue
        translated = argostranslate.translate.translate(text, source_language, target_language)
        translations.append(str(translated or ""))

    output = {
        "engine": "argos",
        "sourceLanguage": source_language,
        "targetLanguage": target_language,
        "translations": translations,
    }
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
