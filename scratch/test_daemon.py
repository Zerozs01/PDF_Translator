import os
import subprocess
import json

user_data = os.path.join(os.environ['APPDATA'], 'pdf_translator')
user_data_root = os.path.join(user_data, 'argos-runtime')

config_home = os.path.join(user_data_root, 'config')
cache_home = os.path.join(user_data_root, 'cache')
package_dir = os.path.join(os.path.expanduser('~'), '.local', 'share', 'argos-translate', 'packages')

# Setup environment exactly like Electron
daemon_env = os.environ.copy()
daemon_env['PYTHONUTF8'] = '1'
daemon_env['XDG_CONFIG_HOME'] = config_home
daemon_env['XDG_CACHE_HOME'] = cache_home
if os.path.exists(package_dir):
    daemon_env['ARGOS_PACKAGES_DIR'] = package_dir
    daemon_env['ARGOS_TRANSLATE_PACKAGE_DIR'] = package_dir

# Path to python interpreter
python_exe = sys_exe = os.path.join(os.path.dirname(sys_exe := subprocess.check_output(['where', 'python']).decode('utf-8').split('\n')[0].strip()), 'python.exe')
if not os.path.exists(python_exe):
    python_exe = 'python'

bridge_path = os.path.join(os.path.dirname(__file__), '..', 'scripts', 'argos_translate_bridge.py')
bridge_path = os.path.abspath(bridge_path)

output_file = os.path.join(os.path.dirname(__file__), 'test_daemon_output.txt')

with open(output_file, 'w', encoding='utf-8') as f:
    f.write(f"Python: {python_exe}\n")
    f.write(f"Bridge Path: {bridge_path}\n")
    
    try:
        # Spawn daemon process
        process = subprocess.Popen(
            [python_exe, bridge_path, '--stdio-server'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=daemon_env,
            text=True,
            encoding='utf-8'
        )
        
        # 1. Send first payload (test translation)
        payload = {
            "id": "req-1",
            "sourceLanguage": "en",
            "targetLanguage": "th",
            "texts": ["682110209", "come with me", "mama"]
        }
        
        f.write("\n--- Sending Payload 1 ---\n")
        f.write(json.dumps(payload) + "\n")
        
        process.stdin.write(json.dumps(payload) + "\n")
        process.stdin.flush()
        
        response = process.stdout.readline()
        f.write("Response 1:\n")
        f.write(response + "\n")
        
        # 2. Send second payload with capital case (to see what happens)
        payload2 = {
            "id": "req-2",
            "sourceLanguage": "en",
            "targetLanguage": "th",
            "texts": ["682110209", "Come with me", "MAMA"]
        }
        
        f.write("\n--- Sending Payload 2 ---\n")
        f.write(json.dumps(payload2) + "\n")
        
        process.stdin.write(json.dumps(payload2) + "\n")
        process.stdin.flush()
        
        response2 = process.stdout.readline()
        f.write("Response 2:\n")
        f.write(response2 + "\n")
        
        # Close process
        process.stdin.close()
        process.terminate()
        process.wait()
        
    except Exception as e:
        import traceback
        f.write("\n--- Error ---\n")
        traceback.print_exc(file=f)

print("Daemon test complete. Output written to scratch/test_daemon_output.txt")
