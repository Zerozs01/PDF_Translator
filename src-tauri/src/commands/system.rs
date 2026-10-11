use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub struct GpuInfoResponse {
    pub gpus: Vec<String>,
    pub has_directml: bool,
    pub has_cuda: bool,
    pub mode: String,
    pub gpu_vendor: String,
}

#[derive(Debug, Serialize)]
pub struct FileDataResponse {
    pub filepath: String,
    pub name: String,
    pub mime_type: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct FileInfoResponse {
    pub filepath: String,
    pub name: String,
    pub mime_type: String,
}

#[derive(Debug, Serialize)]
pub struct ImportResultResponse {
    pub filepath: String,
}

static CACHED_GPU: Mutex<Option<GpuInfoResponse>> = Mutex::new(None);

/// ตรวจจับ GPU ในเครื่องและการรองรับ Hardware Acceleration (DirectML / CUDA)
#[tauri::command]
pub async fn get_gpu_info(_app: AppHandle) -> Result<GpuInfoResponse, String> {
    // 🚀 Fast-path: คืนค่าจากหน่วยความจำทันที 0ms หากเคยตรวจจับไปแล้ว
    if let Ok(guard) = CACHED_GPU.lock() {
        if let Some(cached) = guard.as_ref() {
            return Ok(cached.clone());
        }
    }

    let res = tokio::task::spawn_blocking(move || {
        let mut gpus = Vec::new();

        // 1. ตรวจสอบชื่อ GPU ผ่าน Windows Registry ตรงๆ (<15ms) แทนที่จะรัน PowerShell (2,500ms)
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            use std::os::windows::process::CommandExt;

            for subkey in ["0000", "0001", "0002"] {
                let key_path = format!(
                    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{{4d36e968-e325-11ce-bfc1-08002be10318}}\\{}",
                    subkey
                );
                let mut cmd = Command::new("reg");
                cmd.args(["query", &key_path, "/v", "DriverDesc"])
                    .creation_flags(CREATE_NO_WINDOW);

                if let Ok(out) = cmd.output() {
                    if out.status.success() {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        for line in stdout.lines() {
                            if line.contains("DriverDesc") && line.contains("REG_SZ") {
                                if let Some(val) = line.split("REG_SZ").nth(1) {
                                    let trimmed = val.trim();
                                    if !trimmed.is_empty() && !gpus.contains(&trimmed.to_string()) {
                                        gpus.push(trimmed.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Fallback: PowerShell ในกรณีที่ Registry ไม่พบ
            if gpus.is_empty() {
                let mut cmd = Command::new("powershell");
                cmd.args(["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"])
                    .creation_flags(CREATE_NO_WINDOW);
                if let Ok(out) = cmd.output() {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    for line in stdout.lines() {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() && !gpus.contains(&trimmed.to_string()) {
                            gpus.push(trimmed.to_string());
                        }
                    }
                }
            }
        }

        if gpus.is_empty() {
            gpus.push("CPU Display Adapter".to_string());
        }

        let has_nvidia = gpus.iter().any(|g| g.to_lowercase().contains("nvidia"));
        let has_amd = gpus.iter().any(|g| {
            let lower = g.to_lowercase();
            lower.contains("amd") || lower.contains("radeon")
        });
        let has_intel = gpus.iter().any(|g| g.to_lowercase().contains("intel"));

        let mut gpu_vendor = "unknown".to_string();
        if has_nvidia {
            gpu_vendor = "nvidia".to_string();
        } else if has_amd {
            gpu_vendor = "amd".to_string();
        } else if has_intel {
            gpu_vendor = "intel".to_string();
        }

        // ตรวจหา DirectML หรือ CUDA ในไดเรกทอรีของ Python .venv-ocr
        let mut has_directml = false;
        let mut has_cuda = false;

        let mut venv_candidates = Vec::new();
        if let Ok(cur) = std::env::current_dir() {
            venv_candidates.push(cur.join(".venv-ocr/Lib/site-packages"));
            if cur.ends_with("src-tauri") {
                if let Some(p) = cur.parent() {
                    venv_candidates.push(p.join(".venv-ocr/Lib/site-packages"));
                }
            }
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                venv_candidates.push(dir.join(".venv-ocr/Lib/site-packages"));
                if let Some(up1) = dir.parent() {
                    venv_candidates.push(up1.join(".venv-ocr/Lib/site-packages"));
                    if let Some(up2) = up1.parent() {
                        venv_candidates.push(up2.join(".venv-ocr/Lib/site-packages"));
                    }
                }
            }
        }
        venv_candidates.push(PathBuf::from("C:\\App\\Electron\\PDF_Translator\\.venv-ocr\\Lib\\site-packages"));

        for site_packages in venv_candidates {
            if site_packages.exists() {
                if let Ok(entries) = std::fs::read_dir(&site_packages) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_lowercase();
                        if name.contains("directml") {
                            has_directml = true;
                        }
                        if name.contains("torch") && name.contains("cuda") {
                            has_cuda = true;
                        }
                    }
                }
                if has_directml {
                    break;
                }
            }
        }

        // DirectML ตรวจสอบ Windows DirectML.dll ใน System32
        if !has_directml && std::path::Path::new("C:\\Windows\\System32\\DirectML.dll").exists() {
            if has_amd || has_intel || has_nvidia {
                has_directml = true;
            }
        }

        // ถ้ามี AMD หรือ Intel หรือ NVIDIA GPU และพบ DirectML
        let mode = if has_cuda && has_nvidia {
            "CUDA".to_string()
        } else if has_directml && (has_amd || has_intel || has_nvidia) {
            "DirectML".to_string()
        } else {
            "CPU".to_string()
        };

        GpuInfoResponse {
            gpus,
            has_directml,
            has_cuda: has_cuda && has_nvidia,
            mode,
            gpu_vendor,
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Ok(mut guard) = CACHED_GPU.lock() {
        *guard = Some(res.clone());
    }

    Ok(res)
}

/// อ่านไฟล์เป็น Raw Binary Bytes
#[tauri::command]
pub async fn read_file_binary(file_path: String) -> Result<FileDataResponse, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&file_path);
        if !path.exists() {
            return Err(format!("File does not exist: {}", file_path));
        }

        let data = std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "document.pdf".to_string());

        let mime_type = if name.to_lowercase().ends_with(".pdf") {
            "application/pdf".to_string()
        } else {
            "application/octet-stream".to_string()
        };

        Ok(FileDataResponse {
            filepath: file_path,
            name,
            mime_type,
            data,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// อ่านไฟล์เป็น Raw Bytes ส่งกลับเป็น ArrayBuffer ตรงๆ (ไม่ผ่าน JSON)
/// ทำไมถึงแยกจาก read_file_binary: Vec<u8> ใน serde_json กลายเป็น number array ขนาด ~3-4 เท่าของไฟล์
/// ทำให้ PDF ใหญ่ๆ ช้ามากทั้งฝั่ง serialize (Rust) และ JSON.parse (WebView)
#[tauri::command]
pub async fn read_file_raw(file_path: String) -> Result<Response, String> {
    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("Failed to read file '{}': {}", file_path, e))?;
    Ok(Response::new(data))
}

/// นำเข้าไฟล์ (Import) ลงใน app imports directory
#[tauri::command]
pub async fn import_file_binary(
    app: AppHandle,
    _name: String,
    data: Option<Vec<u8>>,
    file_path: Option<String>,
) -> Result<ImportResultResponse, String> {
    tokio::task::spawn_blocking(move || {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::current_dir().unwrap().join(".data"));
        let imports_dir = app_data_dir.join("imports");
        std::fs::create_dir_all(&imports_dir)
            .map_err(|e| format!("Failed to create imports dir: {}", e))?;

        // สร้าง unique file hash
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let unique_id = format!("{:032x}", now);
        let dest_filename = format!("{}.pdf", &unique_id[..24]);
        let target_path = imports_dir.join(dest_filename);

        if let Some(src_path) = file_path {
            let p = Path::new(&src_path);
            if p.exists() {
                // ตรวจสอบอย่างปลอดภัยว่าไฟล์อยู่ใน imports อยู่แล้วหรือไม่โดยใช้ canonicalize
                if let (Ok(canonical_imports), Ok(canonical_src)) = (imports_dir.canonicalize(), p.canonicalize()) {
                    if canonical_src.starts_with(&canonical_imports) {
                        return Ok(ImportResultResponse {
                            filepath: canonical_src.to_string_lossy().to_string(),
                        });
                    }
                }
                std::fs::copy(p, &target_path)
                    .map_err(|e| format!("Failed to copy file to imports: {}", e))?;
                return Ok(ImportResultResponse {
                    filepath: target_path.to_string_lossy().to_string(),
                });
            }
        }

        if let Some(bytes) = data {
            std::fs::write(&target_path, bytes)
                .map_err(|e| format!("Failed to write file to imports: {}", e))?;
            return Ok(ImportResultResponse {
                filepath: target_path.to_string_lossy().to_string(),
            });
        }

        Err("No file data or file path provided for import".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// เปิดหน้าต่างเลือกไฟล์ Native File Dialog (PDF) ส่งกลับเฉพาะ Metadata (เลี่ยงการอ่าน byte เข้า JSON)
#[tauri::command]
pub async fn open_file_dialog() -> Result<Vec<FileInfoResponse>, String> {
    tokio::task::spawn_blocking(move || {
        let files = rfd::FileDialog::new()
            .add_filter("PDF Document (*.pdf)", &["pdf"])
            .add_filter("All Files (*.*)", &["*"])
            .set_title("Select PDF Document")
            .pick_files();

        let mut results = Vec::new();
        if let Some(file_paths) = files {
            for path in file_paths {
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                results.push(FileInfoResponse {
                    filepath: path.to_string_lossy().to_string(),
                    name,
                    mime_type: "application/pdf".to_string(),
                });
            }
        }

        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// บันทึกไฟล์ภาพชั่วคราวสำหรับ OCR Pipeline
/// รับ body เป็น raw bytes (invoke(cmd, Uint8Array, { headers })) เพื่อเลี่ยง JSON number array
/// mime ส่งผ่าน header `x-image-mime` เพราะ raw body ไม่มีที่ใส่ argument อื่น
#[tauri::command]
pub async fn write_temp_image(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("write_temp_image expects a raw binary body".to_string());
    };
    let mime = request
        .headers()
        .get("x-image-mime")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png");
    let ext = match mime {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    };

    let temp_dir = std::env::temp_dir().join("pdf_translator_ocr");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("Failed to create temp OCR dir: {}", e))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file_path = temp_dir.join(format!("ocr_temp_{:032x}.{}", now, ext));

    tokio::fs::write(&file_path, data)
        .await
        .map_err(|e| format!("Failed to write temp image: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

/// ลบไฟล์ภาพชั่วคราว (จำกัดเฉพาะในไดเรกทอรี temp_ocr เท่านั้นเพื่อความปลอดภัย)
#[tauri::command]
pub async fn delete_temp_image(file_path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let temp_dir = std::env::temp_dir().join("pdf_translator_ocr");
        let p = std::path::Path::new(&file_path);
        // Security check: ตรวจสอบ canonical path ป้องกัน path traversal และห้ามลบไฟล์นอก temp dir
        if let (Ok(canonical_temp), Ok(canonical_file)) = (temp_dir.canonicalize(), p.canonicalize()) {
            if canonical_file.starts_with(&canonical_temp) && canonical_file.is_file() {
                let _ = std::fs::remove_file(canonical_file);
                return Ok(true);
            }
        }
        Ok(false)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn get_auth_config_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(app_data) = app.path().app_data_dir() {
        paths.push(app_data.join("authConfig.json"));
    }
    if let Ok(app_data_env) = std::env::var("APPDATA") {
        let base = PathBuf::from(app_data_env);
        paths.push(base.join("pdf_translator").join("authConfig.json"));
        paths.push(base.join("com.pdftranslator.app").join("authConfig.json"));
    }
    paths
}

/// อ่านค่าการตั้งค่าความปลอดภัย Authentication Config (JSON)
#[tauri::command]
pub async fn read_auth_config(app: AppHandle) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let paths = get_auth_config_paths(&app);
        for p in paths {
            if p.exists() {
                if let Ok(content) = std::fs::read_to_string(&p) {
                    return Ok(Some(content));
                }
            }
        }
        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// บันทึกค่าการตั้งค่าความปลอดภัย Authentication Config (JSON)
#[tauri::command]
pub async fn write_auth_config(app: AppHandle, content: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let paths = get_auth_config_paths(&app);
        let mut wrote = false;
        for p in paths {
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if std::fs::write(&p, &content).is_ok() {
                wrote = true;
            }
        }
        Ok(wrote)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ลบไฟล์การตั้งค่าความปลอดภัย (ใช้สำหรับ Hard Reset ด้วย Emergency PIN)
#[tauri::command]
pub async fn delete_auth_config(app: AppHandle) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let paths = get_auth_config_paths(&app);
        let mut deleted = false;
        for p in paths {
            if p.exists() {
                let _ = std::fs::remove_file(&p);
                deleted = true;
            }
        }
        Ok(deleted)
    })
    .await
    .map_err(|e| e.to_string())?
}

