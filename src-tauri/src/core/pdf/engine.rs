use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use crate::core::pdf::cache::PageCache;
use crate::core::pdf::reconstructor::PdfExportOptions;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageDimension {
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfDocumentMeta {
    pub doc_id: String,
    pub file_path: String,
    pub page_count: usize,
    pub dimensions: Vec<PageDimension>,
}

pub struct PdfEngine {
    pdfium: Mutex<Pdfium>,
    docs: Mutex<HashMap<String, (PathBuf, PdfDocumentMeta)>>,
    pub cache: Arc<PageCache>,
}

// Safety: PdfEngine wraps Pdfium inside a Mutex, ensuring all C API calls are serialized
unsafe impl Send for PdfEngine {}
unsafe impl Sync for PdfEngine {}

impl PdfEngine {
    pub fn new() -> Result<Self, AppError> {
        let pdfium_lib = Self::find_and_bind_pdfium()?;
        let pdfium = Mutex::new(Pdfium::new(pdfium_lib));
        let cache = Arc::new(PageCache::new(16)); // Bounded 16-page LRU memory cache

        Ok(Self {
            pdfium,
            docs: Mutex::new(HashMap::new()),
            cache,
        })
    }

    fn find_and_bind_pdfium() -> Result<Box<dyn PdfiumLibraryBindings>, AppError> {
        // 1. Look adjacent to current executable
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let candidate = exe_dir.join(Pdfium::pdfium_platform_library_name_at_path("./"));
                if candidate.exists() {
                    if let Ok(b) = Pdfium::bind_to_library(&candidate) {
                        return Ok(b);
                    }
                }
            }
        }

        // 2. Look in project binaries directory
        let search_dirs = [
            PathBuf::from("binaries"),
            PathBuf::from("src-tauri/binaries"),
            PathBuf::from("../src-tauri/binaries"),
            PathBuf::from("target/debug"),
            PathBuf::from("src-tauri/target/debug"),
        ];

        for dir in &search_dirs {
            let candidate = dir.join(Pdfium::pdfium_platform_library_name_at_path("./"));
            if candidate.exists() {
                if let Ok(b) = Pdfium::bind_to_library(&candidate) {
                    return Ok(b);
                }
            }
        }

        // 3. Fallback to system library
        Pdfium::bind_to_system_library().map_err(|e| {
            AppError::Custom(format!(
                "Failed to bind Pdfium native library: {}. Ensure pdfium.dll / libpdfium exists in binaries/",
                e
            ))
        })
    }

    pub fn with_pdfium<F, R>(&self, f: F) -> Result<R, AppError>
    where
        F: FnOnce(&Pdfium) -> Result<R, AppError>,
    {
        let guard = self.pdfium.lock().map_err(|e| AppError::Custom(e.to_string()))?;
        f(&guard)
    }

    pub fn load_document(&self, file_path_str: &str) -> Result<PdfDocumentMeta, AppError> {
        let path = PathBuf::from(file_path_str);
        if !path.exists() {
            return Err(AppError::Custom(format!("File does not exist: {}", file_path_str)));
        }

        // Generate stable doc_id based on path
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        file_path_str.hash(&mut hasher);
        let doc_id = format!("doc_{:x}", hasher.finish());

        {
            let lock = self.docs.lock().map_err(|e| AppError::Custom(e.to_string()))?;
            if let Some((_, meta)) = lock.get(&doc_id) {
                return Ok(meta.clone());
            }
        }

        // Open temporarily to read metadata and page dimensions, then drop immediately
        let (page_count, dimensions) = self.with_pdfium(|pdfium| {
            let doc = pdfium.load_pdf_from_file(&path, None).map_err(|e| {
                AppError::Custom(format!("Pdfium failed to open document: {}", e))
            })?;

            let count = doc.pages().len() as usize;
            let mut dims = Vec::with_capacity(count);

            for page in doc.pages().iter() {
                dims.push(PageDimension {
                    width: page.width().value,
                    height: page.height().value,
                });
            }

            Ok((count, dims))
        })?;

        let meta = PdfDocumentMeta {
            doc_id: doc_id.clone(),
            file_path: file_path_str.to_string(),
            page_count,
            dimensions,
        };

        // Cache document path and metadata (NOT keeping the document handle open in RAM)
        let mut lock = self.docs.lock().map_err(|e| AppError::Custom(e.to_string()))?;
        lock.insert(doc_id, (path, meta.clone()));

        Ok(meta)
    }

    pub fn render_page(&self, doc_id: &str, page_number: u32, scale: f32) -> Result<Vec<u8>, AppError> {
        if let Some(cached) = self.cache.get(doc_id, page_number, scale) {
            return Ok(cached);
        }
        let doc_path = self
            .get_document_path(doc_id)
            .ok_or_else(|| AppError::Custom(format!("Document not found for id: {}", doc_id)))?;

        let page_idx = if page_number > 0 { page_number - 1 } else { 0 };
        let bytes = self.with_pdfium(|pdfium| {
            crate::core::pdf::rasterizer::render_page_to_buffer(pdfium, &doc_path, page_idx, scale)
        })?;

        self.cache.insert(doc_id, page_number, scale, bytes.clone());
        Ok(bytes)
    }

    pub fn export_pdf(&self, options: &PdfExportOptions) -> Result<String, AppError> {
        let doc_path = self
            .get_document_path(&options.doc_id)
            .ok_or_else(|| AppError::Custom(format!("Document not found for id: {}", options.doc_id)))?;

        self.with_pdfium(|pdfium| {
            crate::core::pdf::reconstructor::reconstruct_pdf(pdfium, &doc_path, options)
        })
    }

    pub fn get_document_path(&self, doc_id: &str) -> Option<PathBuf> {
        let lock = self.docs.lock().ok()?;
        lock.get(doc_id).map(|(p, _)| p.clone())
    }

    pub fn get_meta(&self, doc_id: &str) -> Option<PdfDocumentMeta> {
        let lock = self.docs.lock().ok()?;
        lock.get(doc_id).map(|(_, m)| m.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::pdf::reconstructor::TextOverlayItem;

    fn create_test_pdf(engine: &PdfEngine) -> PathBuf {
        let temp_dir = std::env::temp_dir();
        let path = temp_dir.join(format!("test_pdf_{}.pdf", std::process::id()));

        engine.with_pdfium(|pdfium| {
            let mut doc = pdfium.create_new_pdf().map_err(|e| AppError::Custom(e.to_string()))?;
            doc.pages_mut()
                .create_page_at_end(PdfPagePaperSize::a4())
                .map_err(|e| AppError::Custom(e.to_string()))?;
            doc.save_to_file(&path)
                .map_err(|e| AppError::Custom(e.to_string()))?;
            Ok(())
        }).expect("Failed to create temporary test PDF");

        path
    }

    #[test]
    fn test_pdf_engine_render_and_export() {
        let engine = PdfEngine::new().expect("PdfEngine should initialize with native Pdfium");
        let test_pdf_path = create_test_pdf(&engine);

        // 1. Load document
        let meta = engine
            .load_document(test_pdf_path.to_str().unwrap())
            .expect("Should load document metadata");
        assert_eq!(meta.page_count, 1);
        assert_eq!(meta.dimensions.len(), 1);
        assert!((meta.dimensions[0].width - 595.0).abs() < 1.0);
        assert!((meta.dimensions[0].height - 842.0).abs() < 1.0);

        // 2. Render page to PNG buffer
        let png_bytes = engine
            .render_page(&meta.doc_id, 1, 1.0)
            .expect("Should render page to PNG");
        assert!(!png_bytes.is_empty());
        // Verify PNG magic signature [137, 80, 78, 71] (0x89 'P' 'N' 'G')
        assert_eq!(&png_bytes[0..4], &[137, 80, 78, 71]);

        // 3. Test LRU Cache hit
        let cached_bytes = engine
            .cache
            .get(&meta.doc_id, 1, 1.0)
            .expect("Buffer should be in cache");
        assert_eq!(cached_bytes.len(), png_bytes.len());

        // 4. Test Export/Reconstruct PDF with Text Layer
        let export_out = std::env::temp_dir().join(format!("exported_{}.pdf", std::process::id()));
        let export_opts = PdfExportOptions {
            doc_id: meta.doc_id.clone(),
            output_path: export_out.to_string_lossy().to_string(),
            page_images: vec![],
            overlays: vec![TextOverlayItem {
                page_number: 1,
                x: 50.0,
                y: 50.0,
                width: 200.0,
                height: 30.0,
                text: "Hello PDF World!".to_string(),
                font_size: 16.0,
                font_color: Some("#ff0000".to_string()),
            }],
            embed_original_images: true,
        };

        let result_path = engine
            .export_pdf(&export_opts)
            .expect("Export PDF should succeed");
        assert!(std::path::Path::new(&result_path).exists());
        assert!(std::fs::metadata(&result_path).unwrap().len() > 0);

        // Cleanup
        let _ = std::fs::remove_file(test_pdf_path);
        let _ = std::fs::remove_file(export_out);
    }
}

