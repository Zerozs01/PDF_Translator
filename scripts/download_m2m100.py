import os
import sys
from pathlib import Path

def download_model():
    print("[m2m100:download] Checking/downloading M2M100 model...")
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("[m2m100:download] Error: huggingface_hub is not installed in the python environment.")
        sys.exit(1)

    model_id = "michaelfeil/ct2fast-m2m100_418M"
    dest_dir = Path(__file__).parent.parent / "models" / "m2m100_ct2"
    dest_dir.mkdir(parents=True, exist_ok=True)

    print(f"[m2m100:download] Downloading model repo '{model_id}' to: {dest_dir}")
    try:
        snapshot_download(
            repo_id=model_id,
            local_dir=dest_dir,
            local_dir_use_symlinks=False,
            resume_download=True
        )
        print("[m2m100:download] Download completed successfully!")
    except Exception as e:
        print(f"[m2m100:download] Error downloading model: {e}")
        sys.exit(1)

if __name__ == "__main__":
    download_model()
