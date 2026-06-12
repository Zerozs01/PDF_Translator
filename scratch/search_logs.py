import json
import os
import sys

# บังคับใช้ utf-8 สำหรับ stdout ในกรณีที่รันผ่าน terminal
if sys.stdout.encoding != 'utf-8':
    try:
        import codecs
        sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
        sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')
    except AttributeError:
        pass

logs_path = r"C:\Users\auand\.gemini\antigravity-ide\brain\82c87eb9-f06b-45ba-a576-26b0239329f3\.system_generated\logs\transcript.jsonl"
output_path = r"c:\App\Electron\PDF_Translator\scratch\search_logs_output.txt"

print(f"Reading logs from: {logs_path}")
if not os.path.exists(logs_path):
    print("Log file not found!")
    exit(1)

diag_logs = []
error_logs = []
queue_logs = []

with open(logs_path, "r", encoding="utf-8") as f:
    for line in f:
        try:
            data = json.loads(line)
            content = data.get("content", "")
            if not content:
                continue
            
            # ค้นหาคำว่า TranslateDiag
            if "[TranslateDiag]" in content:
                diag_logs.append((data.get("step_index"), content))
            
            # ค้นหาคำที่มี error หรือ warning
            if "error" in content.lower() or "fail" in content.lower() or "warning" in content.lower() or "skip" in content.lower():
                error_logs.append((data.get("step_index"), content))
                
            if "QueueProcessor" in content:
                queue_logs.append((data.get("step_index"), content))
        except Exception as e:
            pass

with open(output_path, "w", encoding="utf-8") as out:
    out.write(f"--- Found {len(diag_logs)} TranslateDiag logs ---\n")
    for step, log in diag_logs:
        out.write(f"Step {step}:\n{log}\n" + "-" * 40 + "\n")

    out.write(f"\n--- Found {len(queue_logs)} QueueProcessor logs ---\n")
    for step, log in queue_logs:
        out.write(f"Step {step}:\n{log}\n" + "-" * 40 + "\n")

    out.write(f"\n--- Found {len(error_logs)} error/warning logs ---\n")
    for step, log in error_logs:
        out.write(f"Step {step}:\n{log}\n" + "-" * 40 + "\n")

print(f"Successfully wrote logs search output to: {output_path}")
