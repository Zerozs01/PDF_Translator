use std::path::{Path, PathBuf};
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextOverlayItem {
    pub page_number: u32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub text: String,
    pub font_size: f32,
    pub font_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageImageOverlay {
    pub page_number: u32,
    pub image_data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfExportOptions {
    pub doc_id: String,
    pub output_path: String,
    #[serde(default)]
    pub page_images: Vec<PageImageOverlay>,
    #[serde(default)]
    pub overlays: Vec<TextOverlayItem>,
    pub embed_original_images: bool,
}

pub fn reconstruct_pdf(
    pdfium: &Pdfium,
    source_path: &Path,
    options: &PdfExportOptions,
) -> Result<String, AppError> {
    let mut doc = pdfium.load_pdf_from_file(source_path, None).map_err(|e| {
        AppError::Custom(format!("Failed to load source PDF for reconstruction: {}", e))
    })?;

    // 1. Pre-group raster image overlays by page_number
    let mut page_images_map: std::collections::HashMap<u32, &PageImageOverlay> =
        std::collections::HashMap::new();
    for item in &options.page_images {
        page_images_map.insert(item.page_number, item);
    }

    // 2. Pre-group text overlays by page_number
    let mut page_overlays: std::collections::HashMap<u32, Vec<&TextOverlayItem>> =
        std::collections::HashMap::new();
    for item in &options.overlays {
        page_overlays.entry(item.page_number).or_default().push(item);
    }

    let font = doc.fonts_mut().helvetica();
    let total_pages = doc.pages().len() as u32;

    for page_num in 1..=total_pages {
        let page_index = (page_num - 1) as u16;
        let mut page = doc.pages_mut().get(page_index).map_err(|e| {
            AppError::Custom(format!("Failed to get page {}: {}", page_num, e))
        })?;

        let page_width = page.width();
        let page_height = page.height();

        // A. Draw raster image overlay if provided (pixel-perfect Thai font & mask render from Webview Canvas)
        if let Some(overlay_img) = page_images_map.get(&page_num) {
            if let Ok(dynamic_img) = image::load_from_memory(&overlay_img.image_data) {
                let _ = page.objects_mut().create_image_object(
                    PdfPoints::new(0.0),
                    PdfPoints::new(0.0),
                    &dynamic_img,
                    Some(page_width),
                    Some(page_height),
                );
            }
        }

        // B. Insert text objects (acts as searchable / highlightable text layer)
        if let Some(items) = page_overlays.get(&page_num) {
            let page_w = page_width.value;
            let page_h = page_height.value;

            for item in items {
                // Defensive Coordinate Clamping & Geometry Determinism:
                // Ensure text box stays strictly within page bounds [0, page_w] and [0, page_h]
                let x = item.x.max(0.0).min(page_w);
                let y = item.y.max(0.0).min(page_h);
                let _width = item.width.max(0.0).min(page_w - x);
                let height = item.height.max(0.0).min(page_h - y);

                // Deterministic PDF bottom-left Cartesian transformation:
                let pdf_x = x;
                let pdf_y = (page_h - y - height).max(0.0).min(page_h);
                let font_size = if item.font_size <= 0.0 { 12.0 } else { item.font_size };

                if let Ok(mut text_obj) = page.objects_mut().create_text_object(
                    PdfPoints::new(pdf_x),
                    PdfPoints::new(pdf_y),
                    &item.text,
                    font,
                    PdfPoints::new(font_size),
                ) {
                    if let Some(ref hex) = item.font_color {
                        if let Some(color) = parse_hex_color(hex) {
                            let _ = text_obj.set_fill_color(color);
                        }
                    } else if !options.page_images.is_empty() {
                        // Invisible text layer: transparent so it is hidden behind/with the image but selectable
                        let _ = text_obj.set_fill_color(PdfColor::new(0, 0, 0, 0));
                    }
                }
            }
        }
    }

    let out_path = PathBuf::from(&options.output_path);
    if let Some(parent) = out_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    doc.save_to_file(&out_path).map_err(|e| {
        AppError::Custom(format!("Failed to save reconstructed PDF to {}: {}", options.output_path, e))
    })?;

    Ok(options.output_path.clone())
}

fn parse_hex_color(hex: &str) -> Option<PdfColor> {
    let clean = hex.trim_start_matches('#');
    if clean.len() == 6 {
        let r = u8::from_str_radix(&clean[0..2], 16).ok()?;
        let g = u8::from_str_radix(&clean[2..4], 16).ok()?;
        let b = u8::from_str_radix(&clean[4..6], 16).ok()?;
        Some(PdfColor::new(r, g, b, 255))
    } else {
        None
    }
}
