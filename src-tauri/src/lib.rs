use std::sync::Arc;
use tauri::Manager;

pub mod commands;
pub mod core;
pub mod error;
pub mod protocol;

use core::db::DatabaseManager;
use core::pdf::engine::PdfEngine;
use core::process_manager::ProcessManager;
use core::translation_manager::TranslationManager;

pub struct AppState {
    pub db: Arc<DatabaseManager>,
    pub process_manager: Arc<ProcessManager>,
    pub translation_manager: Arc<TranslationManager>,
    pub pdf_engine: Arc<PdfEngine>,
}

/// Configures Rayon's global threadpool bounded to (num_cpus - 1) to prevent OS/UI freezes
pub fn init_bounded_rayon() {
    let num_threads = std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).max(1))
        .unwrap_or(1);
    let _ = rayon::ThreadPoolBuilder::new()
        .num_threads(num_threads)
        .thread_name(|idx| format!("pdf-worker-{}", idx))
        .build_global();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_bounded_rayon();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .register_uri_scheme_protocol("pdf-page", |ctx, req| {
            let app = ctx.app_handle();
            let state = app.state::<AppState>();
            protocol::document_stream::handle_pdf_page_protocol(&state, &req)
                .unwrap_or_else(|e| {
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                        .body(e.to_string().into_bytes())
                        .unwrap()
                })
        })
        .setup(|app| {
            let app_handle = app.handle();
            let app_data_dir = app_handle.path().app_data_dir().unwrap_or_else(|_| {
                std::env::current_dir().unwrap().join(".data")
            });
            let db_path = app_data_dir.join("pdf_translator.db");
            
            let resolve_project_root = || -> std::path::PathBuf {
                if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
                    let manifest_path = std::path::PathBuf::from(manifest_dir);
                    if manifest_path.join("../scripts/external_ocr_bridge.py").exists() {
                        if let Ok(canonical) = manifest_path.parent().unwrap().canonicalize() {
                            return crate::core::process_manager::strip_windows_unc_prefix(canonical);
                        }
                    }
                }
                if let Ok(cwd) = std::env::current_dir() {
                    if cwd.join("scripts").join("external_ocr_bridge.py").exists() {
                        return cwd;
                    }
                    if let Some(parent) = cwd.parent() {
                        if parent.join("scripts").join("external_ocr_bridge.py").exists() {
                            return parent.to_path_buf();
                        }
                    }
                }
                if let Ok(exe) = std::env::current_exe() {
                    let mut cur = exe.parent();
                    for _ in 0..5 {
                        if let Some(p) = cur {
                            if p.join("scripts").join("external_ocr_bridge.py").exists() {
                                return p.to_path_buf();
                            }
                            cur = p.parent();
                        } else {
                            break;
                        }
                    }
                }
                std::path::PathBuf::from(".")
            };

            let project_root = resolve_project_root();

            let db = Arc::new(DatabaseManager::new(db_path).expect("Failed to initialize SQLite database"));
            let process_manager = Arc::new(ProcessManager::new(project_root.clone()));
            let translation_manager = Arc::new(TranslationManager::new(project_root));
            let pdf_engine = Arc::new(PdfEngine::new().expect("Failed to initialize PdfEngine"));

            app.manage(AppState {
                db,
                process_manager,
                translation_manager,
                pdf_engine,
            });

            // DevTools is accessible via F12 or inspect, do not auto-open to eliminate WebView2 startup freeze

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::database::query_db,
            commands::database::execute_db,
            commands::database::init_database,
            commands::sidecar::check_health,
            commands::sidecar::restart_worker,
            commands::sidecar::send_sidecar_command,
            commands::sidecar::set_ocr_backend,
            commands::sidecar::get_ocr_backend,
            commands::pdf::open_document,
            commands::pdf::export_translated_pdf,
            commands::pdf::render_page_binary,
            commands::pdf::export_psd,
            commands::system::get_gpu_info,
            commands::system::read_file_binary,
            commands::system::read_file_raw,
            commands::system::import_file_binary,
            commands::system::open_file_dialog,
            commands::system::write_temp_image,
            commands::system::delete_temp_image,
            commands::system::read_auth_config,
            commands::system::write_auth_config,
            commands::system::delete_auth_config,
            commands::translate::translate_batch_offline,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
