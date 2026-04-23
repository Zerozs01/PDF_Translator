import os, pathlib
for sub in ("~/.paddleocr", "~/.paddlex", "~/.paddlex/official_models"):
    p = pathlib.Path(os.path.expanduser(sub))
    print(f"\n=== {p} EXISTS={p.exists()} ===")
    if p.exists():
        for entry in sorted(p.iterdir()):
            tag = "DIR " if entry.is_dir() else "FILE"
            print(f"  {tag} {entry.name}")
            if entry.is_dir() and entry.name not in {"whl"}:
                for child in sorted(entry.iterdir())[:8]:
                    print(f"      - {child.name}")
