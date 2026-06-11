import re

cases = [
    # text, token_count, compact_length
    ("THAt's tOO", 2, 9),
    ("I WOuLD BE", 3, 8),
    ("I'LL Let yOu", 3, 10),
    ("GetTING", 1, 7),
    ("gT", 1, 2),
    ("xY", 1, 2),
    ("lI", 1, 2),
    ("eX", 1, 2)
]

for text, token_count, compact_length in cases:
    has_vowel = bool(re.search(r"[aeiouAEIOUyY]", text))
    malformed_mixed_case = bool(re.search(r"[a-z][A-Z]", text)) and (not has_vowel or (token_count <= 1 and compact_length <= 3))
    print(f"Text: {text:15} | Casing Typo / Noise: {'DROPPED' if malformed_mixed_case else 'KEPT'}")
