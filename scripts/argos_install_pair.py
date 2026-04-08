from __future__ import annotations

# pyright: reportMissingImports=false

import argparse
import sys
from typing import Dict, Iterable

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


def normalize_language(raw_value: str) -> str:
    raw = (raw_value or "").strip().lower()
    if not raw:
        raise ValueError("Language code cannot be empty")
    if raw in LANGUAGE_ALIASES:
        return LANGUAGE_ALIASES[raw]
    base = raw.split("-")[0].strip()
    return LANGUAGE_ALIASES.get(base, base)


def contains_pair(installed_languages: Iterable, source_code: str, target_code: str) -> bool:
    for source in installed_languages:
        if str(getattr(source, "code", "")).lower() != source_code:
            continue
        for target in getattr(source, "translations_from", []):
            direct_code = str(getattr(target, "code", "")).lower()
            to_lang = getattr(target, "to_lang", None)
            to_lang_code = str(getattr(to_lang, "code", "")).lower()
            candidate_code = direct_code or to_lang_code
            if candidate_code == target_code:
                return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Install Argos Translate model pair")
    parser.add_argument("--from", dest="source", default="en", help="Source language code (default: en)")
    parser.add_argument("--to", dest="target", default="th", help="Target language code (default: th)")
    args = parser.parse_args()

    try:
        import argostranslate.package
        import argostranslate.translate
    except Exception as exc:
        print(
            "Argos Translate package not available. Install first: python -m pip install argostranslate",
            file=sys.stderr,
        )
        raise SystemExit(2) from exc

    source_code = normalize_language(args.source)
    target_code = normalize_language(args.target)

    installed_languages = argostranslate.translate.get_installed_languages()
    if contains_pair(installed_languages, source_code, target_code):
        print(f"Argos package {source_code}->{target_code} is already installed")
        return

    print("Updating Argos package index...")
    argostranslate.package.update_package_index()

    available_packages = argostranslate.package.get_available_packages()
    match = next(
        (
            package
            for package in available_packages
            if str(package.from_code).lower() == source_code and str(package.to_code).lower() == target_code
        ),
        None,
    )

    if match is None:
        available_pairs = sorted({f"{pkg.from_code}->{pkg.to_code}" for pkg in available_packages})
        print(
            f"No Argos package found for {source_code}->{target_code}.\n"
            f"Available pairs: {', '.join(available_pairs[:60])}{' ...' if len(available_pairs) > 60 else ''}",
            file=sys.stderr,
        )
        raise SystemExit(3)

    print(f"Downloading Argos model {source_code}->{target_code}...")
    package_path = match.download()

    print(f"Installing Argos model {source_code}->{target_code}...")
    argostranslate.package.install_from_path(package_path)

    print(f"Installed Argos model {source_code}->{target_code} successfully")


if __name__ == "__main__":
    main()
