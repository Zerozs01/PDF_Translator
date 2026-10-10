use tauri::http::{header, Request, Response, StatusCode};
use crate::AppState;

pub fn handle_pdf_page_protocol(
    state: &AppState,
    req: &Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let raw_path = req.uri().path();

    // 1. Path Traversal Boundary Audit: reject '..' or path separators in segments
    if raw_path.contains("..") || raw_path.contains('\\') || raw_path.contains("%2e%2e") || raw_path.contains("%2E%2E") {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "text/plain")
            .body(b"403 Forbidden: Path traversal attempt detected".to_vec())
            .map_err(Into::into);
    }

    let uri = req.uri();
    let path = uri.path().trim_start_matches('/');
    // Expected format: {doc_id}/{page_num}
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    if parts.len() < 2 {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .header(header::CONTENT_TYPE, "text/plain")
            .body(b"Invalid URL format. Expected pdf-page://localhost/{doc_id}/{page_number}".to_vec())
            .map_err(Into::into);
    }

    let doc_id = parts[0];

    // Whitelist check: doc_id must be strictly alphanumeric/dash/underscore
    if !doc_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "text/plain")
            .body(b"403 Forbidden: Invalid characters in document identifier".to_vec())
            .map_err(Into::into);
    }

    // Security & Existence Boundary: Document must be registered in PdfEngine
    let doc_meta = match state.pdf_engine.get_meta(doc_id) {
        Some(m) => m,
        None => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header(header::CONTENT_TYPE, "text/plain")
                .body(format!("404 Not Found: Document '{}' is not registered", doc_id).into_bytes())
                .map_err(Into::into);
        }
    };

    let page_number: u32 = match parts[1].parse() {
        Ok(n) => n,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header(header::CONTENT_TYPE, "text/plain")
                .body(b"Invalid page number".to_vec())
                .map_err(Into::into);
        }
    };

    // Range check: page_number must be within [1, total_pages]
    if page_number == 0 || page_number > doc_meta.page_count as u32 {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "text/plain")
            .body(format!("404 Not Found: Page {} out of range (1..={})", page_number, doc_meta.page_count).into_bytes())
            .map_err(Into::into);
    }

    // Parse scale from query string: e.g. scale=1.5
    let mut scale: f32 = 1.0;
    if let Some(query) = uri.query() {
        for param in query.split('&') {
            let mut kv = param.split('=');
            if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
                if k == "scale" {
                    if let Ok(parsed_scale) = v.parse::<f32>() {
                        if parsed_scale > 0.0 {
                            scale = parsed_scale;
                        }
                    }
                }
            }
        }
    }

    match state.pdf_engine.render_page(doc_id, page_number, scale) {
        Ok(png_bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/png")
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(png_bytes)
            .map_err(Into::into),
        Err(e) => {
            let err_str = e.to_string();
            let status = if err_str.contains("not found") || err_str.contains("out of range") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            Response::builder()
                .status(status)
                .header(header::CONTENT_TYPE, "text/plain")
                .body(format!("Failed to render page: {}", err_str).into_bytes())
                .map_err(Into::into)
        }
    }
}
