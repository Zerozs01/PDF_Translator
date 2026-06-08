import subprocess
import os

cwd = r"c:\App\Electron\PDF_Translator"
output_path = os.path.join(cwd, "scratch", "git_diff_output.txt")

print("Running git show...")
res = subprocess.run(
    ["git", "show", "3483cb9dba0912d85c4dc588271836dd1d358b2c"],
    cwd=cwd,
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="ignore"
)

with open(output_path, "w", encoding="utf-8") as f:
    f.write(res.stdout)

print("Git show complete. Output written to scratch/git_diff_output.txt")
