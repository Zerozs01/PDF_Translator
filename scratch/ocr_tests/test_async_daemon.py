import subprocess
import json
import time
import sys
import os

def main():
    venv_python = os.path.join(os.getcwd(), ".venv-ocr", "Scripts", "python.exe")
    bridge_script = os.path.join(os.getcwd(), "scripts", "external_ocr_bridge.py")
    
    print(f"Spawning daemon using: {venv_python}")
    proc = subprocess.Popen(
        [venv_python, bridge_script, "--stdio-server", "--action", "ocr", "--engine", "paddleocr"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1 # line buffered
    )
    
    # Send prewarm request
    prewarm_req = {
        "id": "test-prewarm-id-1234",
        "action": "prewarm",
        "engine": "paddleocr",
        "language": "eng"
    }
    
    print("Sending prewarm request...")
    proc.stdin.write(json.dumps(prewarm_req) + "\n")
    proc.stdin.flush()
    
    # Read response
    print("Waiting for response...")
    # Read stderr in a non-blocking way or monitor stdout
    line = proc.stdout.readline()
    print(f"Response: {line}")
    
    proc.terminate()

if __name__ == "__main__":
    main()
