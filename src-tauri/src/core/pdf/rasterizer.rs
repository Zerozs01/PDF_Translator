use std::io::Cursor;
use std::path::Path;
use image::ImageFormat;
use pdfium_render::prelude::*;
use crate::error::AppError;

pub fn render_page_to_buffer(
    pdfium: &Pdfium,
    doc_path: &Path,
    page_index: u32,
    scale: f32,
) -> Result<Vec<u8>, AppError> {
    let doc = pdfium.load_pdf_from_file(doc_path, None).map_err(|e| {
        AppError::Custom(format!("Failed to load PDF for rendering: {}", e))
    })?;

    let pages = doc.pages();
    if page_index >= pages.len() as u32 {
        return Err(AppError::Custom(format!(
            "Page index {} out of range (total pages: {})",
            page_index,
            pages.len()
        )));
    }

    let page = pages.get(page_index as u16).map_err(|e| {
        AppError::Custom(format!("Failed to access page {}: {}", page_index, e))
    })?;

    let render_scale = if scale <= 0.0 { 1.0 } else { scale };
    let target_width = (page.width().value * render_scale).round() as i32;
    let target_height = (page.height().value * render_scale).round() as i32;

    let render_config = PdfRenderConfig::new()
        .set_target_width(target_width)
        .set_target_height(target_height);

    let bitmap = page.render_with_config(&render_config).map_err(|e| {
        AppError::Custom(format!("Pdfium render error on page {}: {}", page_index, e))
    })?;

    let dynamic_img = bitmap.as_image();
    let mut bytes = Vec::new();
    dynamic_img
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .map_err(|e| AppError::Custom(format!("Failed to encode page image to PNG: {}", e)))?;

    Ok(bytes)
}
