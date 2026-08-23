import subprocess

cmd = ["git", "diff", "2296eb0", "HEAD", "--", "scripts/external_ocr_bridge.py"]
res = subprocess.run(cmd, capture_output=True, text=True)

lines = res.stdout.split('\n')
in_paddle = False
for line in lines:
    if 'PaddleOCR' in line or 'paddle' in line.lower() or 'kwargs' in line.lower():
        print(line)
