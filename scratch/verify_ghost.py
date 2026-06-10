import sys
import os

# Ensure scripts directory is in sys.path
sys.path.append(os.path.abspath('scripts'))

from external_ocr_bridge import is_probable_ascii_ghost

ghosts_to_test = [
    "(2)].",
    "[1]",
    "(2)",
    "[usually",
    "[a]",
    "{1}",
    "[|]",
    "\\",
    "}",
    "a}"
]

for word in ghosts_to_test:
    result = is_probable_ascii_ghost(word)
    print(f"{word:12} -> {'GHOST (DROPPED)' if result else 'VALID (KEPT)'}")
