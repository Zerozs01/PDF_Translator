import json
import os

transcript_path = r"C:\Users\auand\.gemini\antigravity-ide\brain\8e1ae0b1-3eef-4319-a748-cfe9a7c23a28\.system_generated\logs\transcript.jsonl"
if not os.path.exists(transcript_path):
    print("Transcript not found.")
    exit(0)

print("Searching transcript...")
with open(transcript_path, 'r', encoding='utf-8') as f:
    for line_num, line in enumerate(f, 1):
        try:
            data = json.loads(line)
            content = str(data.get("content", ""))
            tool_calls = data.get("tool_calls", [])
            tc_str = str(tool_calls)
            
            # Look for keywords
            if "FiTTiNG" in content or "FiTTiNG" in tc_str or "LayerGroupingService.ts" in content or "LayerGroupingService.ts" in tc_str:
                print(f"--- Line {line_num} | Step {data.get('step_index')} | Type: {data.get('type')} ---")
                if content:
                    print("CONTENT SUMMARY:")
                    # print first 500 chars and last 500 chars
                    if len(content) > 1000:
                        print(content[:500] + "\n... [TRUNCATED] ...\n" + content[-500:])
                    else:
                        print(content)
                if tool_calls:
                    print("TOOL CALLS:")
                    print(json.dumps(tool_calls, indent=2, ensure_ascii=False))
                print()
        except Exception as e:
            pass
