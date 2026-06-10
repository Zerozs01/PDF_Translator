import sys
import os

# Ensure scripts directory is in sys.path
sys.path.append(os.path.abspath('scripts'))

from external_ocr_bridge import is_advertisement_brand_token

words_to_test = ["Newton's", "Newton", "NEWTOKI", "NEWTOK1", "Asuras", "Asurascans", "Manga", "normal_word"]

for word in words_to_test:
    result = is_advertisement_brand_token(word)
    print(f"{word:12} -> {'DROPPED' if result else 'KEPT'}")
