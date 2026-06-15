import subprocess

cmd = ["git", "diff", "2296eb0", "HEAD", "--", "src/App.tsx"]
res = subprocess.run(cmd, capture_output=True, text=True)

lines = res.stdout.split('\n')
for i, line in enumerate(lines):
    if line.startswith('+') and not line.startswith('+++'):
        if 'filter' in line or 'dedup' in line or 'safety' in line or 'shouldSkip' in line:
            print(f"Line {i}: {line}")
