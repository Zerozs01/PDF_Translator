use std::sync::Arc;
use tauri::State;
use crate::core::pdf::engine::PdfDocumentMeta;
use crate::core::pdf::reconstructor::PdfExportOptions;
use crate::AppState;

#[tauri::command]
pub async fn open_document(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<PdfDocumentMeta, String> {
    state.pdf_engine.load_document(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_translated_pdf(
    state: State<'_, AppState>,
    options: PdfExportOptions,
) -> Result<String, String> {
    let pdf_engine = Arc::clone(&state.pdf_engine);

    // Strict constraint: Never run PDF CPU intensive work directly on Tokio worker thread
    tokio::task::spawn_blocking(move || {
        pdf_engine.export_pdf(&options).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn render_page_binary(
    state: State<'_, AppState>,
    doc_id: String,
    page_number: u32,
    scale: Option<f32>,
) -> Result<Vec<u8>, String> {
    let scale = scale.unwrap_or(1.0);
    let pdf_engine = Arc::clone(&state.pdf_engine);

    tokio::task::spawn_blocking(move || {
        pdf_engine.render_page(&doc_id, page_number, scale).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
