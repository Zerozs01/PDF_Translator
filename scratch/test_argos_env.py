import os
import sys

# Setup environment exactly like Electron
user_data = os.path.join(os.environ['APPDATA'], 'pdf_translator')
user_data_root = os.path.join(user_data, 'argos-runtime')

config_home = os.path.join(user_data_root, 'config')
cache_home = os.path.join(user_data_root, 'cache')

package_candidates = [
    os.path.join(os.path.expanduser('~'), '.local', 'share', 'argos-translate', 'packages'),
    os.path.join(user_data_root, 'packages')
]

package_dir = None
for candidate in package_candidates:
    if os.path.exists(candidate):
        package_dir = candidate
        break

os.environ['XDG_CONFIG_HOME'] = config_home
os.environ['XDG_CACHE_HOME'] = cache_home
if package_dir:
    os.environ['ARGOS_PACKAGES_DIR'] = package_dir
    os.environ['ARGOS_TRANSLATE_PACKAGE_DIR'] = package_dir

output_file = os.path.join(os.path.dirname(__file__), 'test_argos_env_output.txt')

with open(output_file, 'w', encoding='utf-8') as f:
    f.write(f"Config Home: {config_home}\n")
    f.write(f"Cache Home: {cache_home}\n")
    f.write(f"Package Dir: {package_dir}\n")
    
    try:
        import argostranslate.translate as t
        
        f.write("\n--- Installed Languages in Electron Env ---\n")
        langs = t.get_installed_languages()
        f.write(str([l.code for l in langs]) + "\n")
        
        f.write("\n--- Translation Test ---\n")
        trans = t.get_translation_from_codes('en', 'th')
        if trans:
            f.write(f"come with me -> {repr(trans.translate('come with me'))}\n")
            f.write(f"come -> {repr(trans.translate('come'))}\n")
            f.write(f"with -> {repr(trans.translate('with'))}\n")
            f.write(f"me -> {repr(trans.translate('me'))}\n")
            f.write(f"mama -> {repr(trans.translate('mama'))}\n")
            
            # test capitalization too!
            f.write(f"Come with me -> {repr(trans.translate('Come with me'))}\n")
            f.write(f"MAMA -> {repr(trans.translate('MAMA'))}\n")
        else:
            f.write("No translation from en to th found!\n")
    except Exception as e:
        import traceback
        f.write("\n--- Error ---\n")
        traceback.print_exc(file=f)

print("Test complete. Output written to scratch/test_argos_env_output.txt")
