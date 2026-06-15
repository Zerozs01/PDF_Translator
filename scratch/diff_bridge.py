import subprocess

cmd = ["git", "diff", "2296eb0", "HEAD", "--", "scripts/external_ocr_bridge.py"]
res = subprocess.run(cmd, capture_output=True, text=True)

lines = res.stdout.split('\n')
for line in lines:
    if line.startswith('+') and not line.startswith('+++'):
        if 'det' in line or 'rec' in line or 'cls' in line or 'drop' in line or 'filter' in line or 'ocr' in line or 'threshold' in line:
            print(line)
