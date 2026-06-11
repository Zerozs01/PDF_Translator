import os

user_data = os.path.join(os.environ['APPDATA'], 'pdf_translator')
user_data_root = os.path.join(user_data, 'argos-runtime')
local_packages = os.path.join(user_data_root, 'packages')
global_packages = os.path.join(os.path.expanduser('~'), '.local', 'share', 'argos-translate', 'packages')

output_file = os.path.join(os.path.dirname(__file__), 'check_packages_output.txt')

with open(output_file, 'w', encoding='utf-8') as f:
    f.write(f"Local Packages Path: {local_packages} (Exists: {os.path.exists(local_packages)})\n")
    if os.path.exists(local_packages):
        f.write("Contents:\n")
        f.write(str(os.listdir(local_packages)) + "\n")
        
    f.write(f"\nGlobal Packages Path: {global_packages} (Exists: {os.path.exists(global_packages)})\n")
    if os.path.exists(global_packages):
        f.write("Contents:\n")
        f.write(str(os.listdir(global_packages)) + "\n")
        
print("Check complete. Output written to scratch/check_packages_output.txt")
