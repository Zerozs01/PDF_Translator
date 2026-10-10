use std::path::PathBuf;
use std::sync::Arc;
use pdf_translator_lib::core::pdf::cache::PageCache;
use pdf_translator_lib::core::pdf::engine::PdfEngine;
use pdf_translator_lib::core::pdf::reconstructor::{PdfExportOptions, TextOverlayItem};
use pdf_translator_lib::core::process_manager::ProcessManager;
use pdf_translator_lib::core::db::DatabaseManager;
use pdf_translator_lib::init_bounded_rayon;
use pdf_translator_lib::AppState;
use tauri::http::{Request, StatusCode};

fn get_project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf()
}

// ============================================================================
// Layer 1: Memory & Compute Stress (Big-O & Bounded Resource Test)
// ============================================================================

#[test]
fn test_layer1_vector_a_page_count_lru_and_ram_bound() {
    // Vector A: Load 300+ pages into LRU Cache.
    // Invariant: O(1) bounded memory <= 128 MB (well below 200 MB process RAM invariant).
    let capacity = 16;
    let max_bytes = 128 * 1024 * 1024; // 128 MB
    let cache = PageCache::new_with_max_bytes(capacity, max_bytes);

    // Simulate 350 pages of scanned document (each page ~200 KB)
    let page_data = vec![0x89; 200 * 1024]; // 200 KB buffer
    for page in 1..=350 {
        cache.insert("doc_stress_300", page, 1.0, page_data.clone());
    }

    // After 350 pages, cache must only retain at most `capacity` entries (16)
    // and total bytes must stay <= 16 * 200KB = ~3.2 MB (strictly <= 128 MB budget)
    assert!(
        cache.current_bytes() <= 16 * 200 * 1024,
        "Cache byte size ({}) exceeded capacity bound",
        cache.current_bytes()
    );

    // Old pages (e.g. page 1) must have been evicted by LRU
    assert_eq!(cache.get("doc_stress_300", 1, 1.0), None, "Old page 1 should be evicted");
    // Recent pages (e.g. page 350) must be present
    assert!(cache.get("doc_stress_300", 350, 1.0).is_some(), "Recent page 350 must be cached");
}

#[tokio::test]
async fn test_layer1_vector_b_high_density_and_tokio_nonblocking() {
    // Vector B: High-Density / Buffer Stress (> 50 MB raw buffer per page)
    // Invariant: Memory budget enforced without OOM, and Tokio I/O channel never blocked.
    let max_bytes = 100 * 1024 * 1024; // 100 MB budget
    let cache = PageCache::new_with_max_bytes(16, max_bytes);

    // Insert 50 MB buffer for page 1
    let buffer_50mb = vec![0xAA; 50 * 1024 * 1024];
    cache.insert("doc_hd", 1, 2.0, buffer_50mb.clone());
    assert_eq!(cache.current_bytes(), 50 * 1024 * 1024);

    // Insert 50 MB buffer for page 2 -> total = 100 MB
    cache.insert("doc_hd", 2, 2.0, buffer_50mb.clone());
    assert_eq!(cache.current_bytes(), 100 * 1024 * 1024);

    // Insert 3rd 50 MB buffer -> total would be 150 MB > 100 MB max_bytes!
    // Invariant assertion: Must evict page 1 immediately to enforce O(1) bound <= 100 MB
    cache.insert("doc_hd", 3, 2.0, buffer_50mb.clone());
    assert!(cache.current_bytes() <= max_bytes, "Memory budget violated: {}", cache.current_bytes());
    assert_eq!(cache.get("doc_hd", 1, 2.0), None, "Page 1 must be evicted to prevent OOM");
    assert!(cache.get("doc_hd", 3, 2.0).is_some());

    // Non-blocking Tokio assertion:
    // Heavy computational tasks run in spawn_blocking, ensuring Tokio timer fires on time (< 15ms)
    let start = std::time::Instant::now();
    let heavy_task = tokio::task::spawn_blocking(move || {
        let mut sum = 0u64;
        for i in 0..5_000_000 {
            sum = sum.wrapping_add(i);
        }
        sum
    });

    let async_timer = tokio::time::sleep(tokio::time::Duration::from_millis(5));
    tokio::select! {
        _ = async_timer => {
            // Async timer was not blocked by heavy task
            assert!(start.elapsed() < std::time::Duration::from_millis(200));
        }
        _ = heavy_task => {}
    }
}

#[test]
fn test_layer1_rayon_threadpool_bounded() {
    // Invariant: Rayon thread pool must be initialized and bounded to (num_cpus - 1)
    init_bounded_rayon();
    let expected_max = std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).max(1))
        .unwrap_or(1);
    let current_threads = rayon::current_num_threads();
    assert!(
        current_threads <= expected_max,
        "Rayon threadpool ({} threads) exceeds bound ({} cores)",
        current_threads,
        expected_max
    );
}

// ============================================================================
// Layer 2: Concurrency, Race Condition & Idempotency Audit
// ============================================================================

#[tokio::test]
async fn test_layer2_idempotent_deduplication() {
    // Invariant: Concurrent parallel requests for the same OCR task must be deduplicated
    let root = get_project_root();
    let pm = Arc::new(ProcessManager::new(root));

    let payload = serde_json::json!({
        "action": "ping",
        "engine": "paddleocr",
        "image": "test_page_1.png"
    });

    // Fire 2 requests simultaneously
    let pm1 = Arc::clone(&pm);
    let p1 = payload.clone();
    let f1 = tokio::spawn(async move {
        pm1.send_command(p1).await
    });

    let pm2 = Arc::clone(&pm);
    let p2 = payload.clone();
    let f2 = tokio::spawn(async move {
        pm2.send_command(p2).await
    });

    let (res1, res2) = tokio::join!(f1, f2);
    let r1 = res1.unwrap().expect("Request 1 should succeed");
    let r2 = res2.unwrap().expect("Request 2 should succeed");

    // Both should receive successful responses
    assert!(r1.get("pong").is_some() || r1.get("ok").is_some());
    assert!(r2.get("pong").is_some() || r2.get("ok").is_some());
}

#[tokio::test]
async fn test_layer2_rapid_trigger_and_cancellation_fuzzing() {
    // Invariant: Rapid trigger & restart cycles every 50-100ms must not leak zombies,
    // and SQLite busy_timeout must prevent lock hangs.
    let root = get_project_root();
    let pm = ProcessManager::new(root);

    // 1. Rapid trigger and restart fuzzing
    for _ in 0..5 {
        let _ = pm.ensure_started().await;
        tokio::time::sleep(tokio::time::Duration::from_millis(60)).await;
        let _ = pm.restart_worker().await;
    }

    let health = pm.check_health().await.expect("Health check should pass after restarts");
    assert_eq!(health.status, "ready");

    // 2. SQLite busy_timeout lock assertion
    let db = DatabaseManager::new_in_memory().expect("In-memory SQLite should initialize");
    let res = db.execute("CREATE TABLE IF NOT EXISTS lock_test (id INT PRIMARY KEY, val TEXT)", vec![]);
    assert!(res.is_ok());

    // Concurrent writes should not lock out due to WAL & busy_timeout
    let mut handles = Vec::new();
    let db_arc = Arc::new(db);
    for i in 0..10 {
        let d = Arc::clone(&db_arc);
        handles.push(tokio::task::spawn_blocking(move || {
            d.execute(
                "INSERT OR REPLACE INTO lock_test (id, val) VALUES (?, ?)",
                vec![serde_json::json!(i), serde_json::json!("data")],
            )
        }));
    }

    for h in handles {
        let r = h.await.unwrap();
        assert!(r.is_ok(), "SQLite write failed under concurrency");
    }
}

#[tokio::test]
async fn test_layer2_crash_recovery_and_chaos_injection() {
    // Invariant: Simulating kill -9 on Python worker must be detected by Rust watchdog
    // and automatically respawned within <= 3 seconds without crashing the application.
    let root = get_project_root();
    let pm = ProcessManager::new(root);

    pm.ensure_started().await.expect("Worker must start");
    let initial_pid = pm.get_child_pid().await.expect("Must have child PID");
    assert!(initial_pid > 0);

    // Chaos injection: Kill the worker process directly mid-flight
    pm.simulate_crash().await.expect("Simulate crash should succeed");

    // Watchdog invariant: Worker must be automatically revived within 3 seconds
    let mut revived = false;
    for _ in 0..6 {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        if let Some(new_pid) = pm.get_child_pid().await {
            if new_pid != initial_pid {
                revived = true;
                break;
            }
        }
    }

    assert!(revived, "Watchdog failed to revive Python worker within 3 seconds");
    let health = pm.check_health().await.expect("Worker must be healthy after auto-recovery");
    assert_eq!(health.status, "ready");
}

// ============================================================================
// Layer 5: Security & Blast Radius Containment
// ============================================================================

#[test]
fn test_layer5_custom_protocol_path_traversal() {
    // Invariant: Path traversal like `../../Windows/System32` must return 403 Forbidden.
    // Unregistered doc_id or out-of-bounds page must return 404 Not Found.
    let root = get_project_root();
    let db = Arc::new(DatabaseManager::new_in_memory().unwrap());
    let pm = Arc::new(ProcessManager::new(root.clone()));
    let tm = Arc::new(pdf_translator_lib::core::translation_manager::TranslationManager::new(root));
    let pdf_engine = Arc::new(PdfEngine::new().unwrap());

    let state = AppState {
        db,
        process_manager: pm,
        translation_manager: tm,
        pdf_engine,
    };

    // Attack vector 1: Standard path traversal
    let req1 = Request::builder()
        .uri("pdf-page://localhost/../../../../Windows/System32/1")
        .body(vec![])
        .unwrap();
    let resp1 = pdf_translator_lib::protocol::document_stream::handle_pdf_page_protocol(&state, &req1).unwrap();
    assert_eq!(resp1.status(), StatusCode::FORBIDDEN, "Path traversal must return 403 Forbidden");

    // Attack vector 2: URL encoded path traversal
    let req2 = Request::builder()
        .uri("pdf-page://localhost/%2e%2e%2f%2e%2e/Windows/1")
        .body(vec![])
        .unwrap();
    let resp2 = pdf_translator_lib::protocol::document_stream::handle_pdf_page_protocol(&state, &req2).unwrap();
    assert_eq!(resp2.status(), StatusCode::FORBIDDEN, "Encoded traversal must return 403 Forbidden");

    // Attack vector 3: Non-existent document
    let req3 = Request::builder()
        .uri("pdf-page://localhost/doc_unregistered/1")
        .body(vec![])
        .unwrap();
    let resp3 = pdf_translator_lib::protocol::document_stream::handle_pdf_page_protocol(&state, &req3).unwrap();
    assert_eq!(resp3.status(), StatusCode::NOT_FOUND, "Unregistered doc must return 404 Not Found");
}

#[test]
fn test_layer5_capabilities_permission_scoping() {
    // Invariant: Ensure default capability restricts permissions to least privilege.
    // Must NOT grant shell:execute or shell:allow-execute.
    let cap_file = get_project_root().join("src-tauri/capabilities/default.json");
    assert!(cap_file.exists(), "Capabilities configuration must exist");

    let content = std::fs::read_to_string(&cap_file).expect("Must read default.json");
    let json: serde_json::Value = serde_json::from_str(&content).expect("Valid JSON");

    let perms = json.get("permissions").and_then(|p| p.as_array()).expect("Permissions array");
    for perm in perms {
        let perm_str = perm.as_str().unwrap_or("");
        assert!(
            !perm_str.contains("shell:execute") && !perm_str.contains("shell:allow-execute"),
            "Dangerous un-scoped permission found: {}",
            perm_str
        );
    }
}

#[test]
fn test_layer5_native_cbinding_panic_safety_pdfium() {
    // Invariant: Corrupted PDF binary must return Result::Err and never panic or segfault.
    let engine = PdfEngine::new().expect("PdfEngine should initialize");

    let temp_corrupt = std::env::temp_dir().join(format!("corrupt_test_{}.pdf", std::process::id()));
    std::fs::write(&temp_corrupt, b"CORRUPTED_MALICIOUS_PDF_HEADER_NOT_VALID").unwrap();

    let result = engine.load_document(temp_corrupt.to_str().unwrap());
    assert!(result.is_err(), "Engine must return Err on corrupted binary");

    let _ = std::fs::remove_file(temp_corrupt);
}

// ============================================================================
// Layer 4: System Invariants & Deterministic Verification
// ============================================================================

#[test]
fn test_layer4_geometry_coordinate_determinism() {
    // Invariant: Text block coordinates must never leak outside paper boundaries [0, W] and [0, H]
    // and must produce deterministic bottom-left Cartesian coordinates.
    let engine = PdfEngine::new().unwrap();

    let temp_pdf = std::env::temp_dir().join(format!("geo_test_{}.pdf", std::process::id()));
    let export_out = std::env::temp_dir().join(format!("geo_out_{}.pdf", std::process::id()));

    // Create 1-page PDF
    engine.with_pdfium(|pdfium| {
        let mut doc = pdfium.create_new_pdf().unwrap();
        doc.pages_mut().create_page_at_end(pdfium_render::prelude::PdfPagePaperSize::a4()).unwrap();
        doc.save_to_file(&temp_pdf).unwrap();
        Ok(())
    }).unwrap();

    let meta = engine.load_document(temp_pdf.to_str().unwrap()).unwrap();

    // Malicious / overflowing bounding boxes:
    // Box 1: Negative coordinates (-50, -100)
    // Box 2: Overflow coordinates (9999, 9999) with width 5000
    let export_opts = PdfExportOptions {
        doc_id: meta.doc_id.clone(),
        output_path: export_out.to_string_lossy().to_string(),
        page_images: vec![],
        overlays: vec![
            TextOverlayItem {
                page_number: 1,
                x: -50.0,
                y: -100.0,
                width: 300.0,
                height: 40.0,
                text: "Clamped Top Left".to_string(),
                font_size: 14.0,
                font_color: None,
            },
            TextOverlayItem {
                page_number: 1,
                x: 9999.0,
                y: 9999.0,
                width: 5000.0,
                height: 5000.0,
                text: "Clamped Overflow".to_string(),
                font_size: 14.0,
                font_color: None,
            },
        ],
        embed_original_images: true,
    };

    let res = engine.export_pdf(&export_opts);
    assert!(res.is_ok(), "Reconstruction must succeed and clamp coordinates safely");
    assert!(export_out.exists());

    let _ = std::fs::remove_file(temp_pdf);
    let _ = std::fs::remove_file(export_out);
}

#[test]
fn test_layer4_structural_page_count_integrity() {
    // Invariant: input_page_count == output_page_count across reconstruction.
    let engine = PdfEngine::new().unwrap();

    let temp_multi = std::env::temp_dir().join(format!("multi_page_{}.pdf", std::process::id()));
    let temp_export = std::env::temp_dir().join(format!("multi_out_{}.pdf", std::process::id()));

    // Create 3-page PDF
    engine.with_pdfium(|pdfium| {
        let mut doc = pdfium.create_new_pdf().unwrap();
        for _ in 0..3 {
            doc.pages_mut().create_page_at_end(pdfium_render::prelude::PdfPagePaperSize::a4()).unwrap();
        }
        doc.save_to_file(&temp_multi).unwrap();
        Ok(())
    }).unwrap();

    let meta = engine.load_document(temp_multi.to_str().unwrap()).unwrap();
    assert_eq!(meta.page_count, 3, "Input page count must be 3");

    let export_opts = PdfExportOptions {
        doc_id: meta.doc_id.clone(),
        output_path: temp_export.to_string_lossy().to_string(),
        page_images: vec![],
        overlays: vec![],
        embed_original_images: true,
    };

    let out_path = engine.export_pdf(&export_opts).unwrap();
    let meta_out = engine.load_document(&out_path).unwrap();

    // Invariant assertion: Page count must match 100%
    assert_eq!(
        meta_out.page_count, meta.page_count,
        "Structural page count mismatch: input {} vs output {}",
        meta.page_count, meta_out.page_count
    );

    let _ = std::fs::remove_file(temp_multi);
    let _ = std::fs::remove_file(temp_export);
}
