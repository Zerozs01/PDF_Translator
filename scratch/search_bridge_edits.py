import json
import os

transcript_path = r"C:\Users\auand\.gemini\antigravity-ide\brain\8e1ae0b1-3eef-4319-a748-cfe9a7c23a28\.system_generated\logs\transcript.jsonl"
if not os.path.exists(transcript_path):
    print("Transcript not found.")
    exit(0)

print("Searching transcript for external_ocr_bridge.py edits...")
with open(transcript_path, 'r', encoding='utf-8') as f:
    for line_num, line in enumerate(f, 1):
        try:
            data = json.loads(line)
            content = str(data.get("content", ""))
            tool_calls = data.get("tool_calls", [])
            tc_str = str(tool_calls)
            
            if "external_ocr_bridge.py" in content or "external_ocr_bridge.py" in tc_str:
                # check if there was a replace_file_content or write_to_file call
                for tc in tool_calls:
                    if tc.get("name") in ["replace_file_content", "multi_replace_file_content"]:
                        args = tc.get("args", {})
                        target = args.get("TargetFile", "")
                        if "external_ocr_bridge.py" in target:
                            print(f"--- Line {line_num} | Step {data.get('step_index')} | Type: {data.get('type')} ---")
                            print("INSTRUCTION:")
                            print(args.get("Instruction"))
                            print("REPLACEMENT CONTENT:")
                            print(args.get("ReplacementContent"))
                            print()
        except Exception as e:
            pass
