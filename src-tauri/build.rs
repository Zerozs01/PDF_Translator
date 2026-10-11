use std::path::Path;

fn main() {
    tauri_build::build();

    #[cfg(target_os = "windows")]
    {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
        let binaries_dir = Path::new(&manifest_dir).join("binaries");
        
        let dll_names = ["pdfium.dll", "pdfium-x86_64-pc-windows-msvc.dll"];
        if let Ok(out_dir) = std::env::var("OUT_DIR") {
            if let Some(target_dir) = Path::new(&out_dir).ancestors().nth(3) {
                for name in dll_names {
                    let src = binaries_dir.join(name);
                    if src.exists() {
                        let _ = std::fs::copy(&src, target_dir.join(name));
                        if let Some(deps_dir) = target_dir.join("deps").canonicalize().ok() {
                            let _ = std::fs::copy(&src, deps_dir.join(name));
                        }
                    }
                }
            }
        }
    }
}
