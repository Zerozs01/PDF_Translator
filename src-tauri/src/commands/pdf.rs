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

use crate::core::pdf::psd::{PsdDocument, PsdLayer, PsdLayerInput, PsdWriter};

#[derive(serde::Deserialize)]
pub struct PsdExportOptions {
    pub output_path: String,
    pub width: u32,
    pub height: u32,
    pub layers: Vec<PsdLayerInput>,
}

#[tauri::command]
pub async fn export_psd(options: PsdExportOptions) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut doc = PsdDocument::new(options.width, options.height);

        for l in options.layers {
            let opacity = l.opacity.unwrap_or(255);
            let visible = l.visible.unwrap_or(true);
            let rgba = l.rgba_data.unwrap_or_default();

            let mut layer = PsdLayer::new(
                l.name,
                l.left,
                l.top,
                l.width,
                l.height,
                &rgba,
                opacity,
                visible,
            );
            layer.is_text = l.is_text.unwrap_or(false);
            layer.text_content = l.text_content;
            layer.font_size = l.font_size;
            doc.add_layer(layer);
        }

        let bytes = PsdWriter::write_to_bytes(&doc)?;
        std::fs::write(&options.output_path, &bytes)
            .map_err(|e| format!("Failed to write PSD file {}: {}", options.output_path, e))?;

        Ok(options.output_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

