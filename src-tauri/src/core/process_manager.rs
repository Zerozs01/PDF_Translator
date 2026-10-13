use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub status: String, // "ready" | "starting" | "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, AppError>>>>>;
type InflightMap = Arc<Mutex<HashMap<String, tokio::sync::broadcast::Sender<Result<Value, String>>>>>;

pub struct ProcessManager {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    pending: PendingMap,
    watchdog_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    reader_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    project_root: PathBuf,
    inflight: InflightMap,
    is_shutting_down: Arc<std::sync::atomic::AtomicBool>,
    ocr_backend: Arc<Mutex<String>>,
    dml_adapter_name: Arc<Mutex<Option<String>>>,
}

impl ProcessManager {
    pub fn new(project_root: PathBuf) -> Self {
        let (initial_backend, initial_adapter) = if let Ok(b) = std::env::var("OCR_BACKEND") {
            (b, std::env::var("OCR_DML_ADAPTER_NAME").ok().filter(|s| !s.trim().is_empty()))
        } else {
            let has_directml = std::path::Path::new("C:\\Windows\\System32\\DirectML.dll").exists();
            if has_directml {
                ("ort_dml".to_string(), Some("AMD Radeon RX 6700 XT".to_string()))
            } else {
                ("paddle".to_string(), None)
            }
        };
        Self {
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            watchdog_handle: Arc::new(Mutex::new(None)),
            reader_handle: Arc::new(Mutex::new(None)),
            project_root,
            inflight: Arc::new(Mutex::new(HashMap::new())),
            is_shutting_down: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            ocr_backend: Arc::new(Mutex::new(initial_backend)),
            dml_adapter_name: Arc::new(Mutex::new(initial_adapter)),
        }
    }

    pub fn resolve_python_executable(project_root: &Path) -> String {
        // 1. Env vars
        if let Ok(p) = std::env::var("OCR_PYTHON_PATH") {
            if Path::new(&p).exists() {
                return p;
            }
        }
        if let Ok(p) = std::env::var("PADDLE_OCR_PYTHON_PATH") {
            if Path::new(&p).exists() {
                return p;
            }
        }

        // 2. Bundled sidecar / embedded Python in production bundle
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                let bundled_py = exe_dir.join("binaries").join("python").join("python.exe");
                if bundled_py.exists() {
                    return bundled_py.to_string_lossy().to_string();
                }
                let bundled_res_py = exe_dir.join("resources").join("python").join("python.exe");
                if bundled_res_py.exists() {
                    return bundled_res_py.to_string_lossy().to_string();
                }
            }
        }

        // 3. Relative venvs in project root and its parent
        let mut venv_candidates = Vec::new();
        if cfg!(windows) {
            venv_candidates.push(project_root.join(".venv-ocr").join("Scripts").join("python.exe"));
            venv_candidates.push(project_root.join(".venv").join("Scripts").join("python.exe"));
            venv_candidates.push(PathBuf::from(r"C:\App\Electron\PDF_Translator\.venv-ocr\Scripts\python.exe"));
            if let Some(parent) = project_root.parent() {
                venv_candidates.push(parent.join(".venv-ocr").join("Scripts").join("python.exe"));
                venv_candidates.push(parent.join(".venv").join("Scripts").join("python.exe"));
            }
        } else {
            venv_candidates.push(project_root.join(".venv-ocr").join("bin").join("python"));
            venv_candidates.push(project_root.join(".venv").join("bin").join("python"));
            if let Some(parent) = project_root.parent() {
                venv_candidates.push(parent.join(".venv-ocr").join("bin").join("python"));
                venv_candidates.push(parent.join(".venv").join("bin").join("python"));
            }
        }

        for candidate in venv_candidates {
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }

        // 4. Fallback to system python
        "python".to_string()
    }

    pub fn find_python_executable(&self) -> String {
        Self::resolve_python_executable(&self.project_root)
    }

    pub fn resolve_bridge_script_path(project_root: &Path) -> PathBuf {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                let res_script = exe_dir.join("resources").join("scripts").join("external_ocr_bridge.py");
                if res_script.exists() {
                    return res_script;
                }
            }
        }

        let candidate = project_root.join("scripts").join("external_ocr_bridge.py");
        if candidate.exists() {
            return candidate;
        }
        let fallback_fixed = PathBuf::from(r"C:\App\Electron\PDF_Translator\scripts\external_ocr_bridge.py");
        if fallback_fixed.exists() {
            return fallback_fixed;
        }
        if let Some(parent) = project_root.parent() {
            let parent_cand = parent.join("scripts").join("external_ocr_bridge.py");
            if parent_cand.exists() {
                return parent_cand;
            }
        }
        PathBuf::from("scripts/external_ocr_bridge.py")
    }

    pub fn get_bridge_script_path(&self) -> PathBuf {
        Self::resolve_bridge_script_path(&self.project_root)
    }

    async fn spawn_child_and_reader(
        project_root: &Path,
        child_arc: &Arc<Mutex<Option<Child>>>,
        stdin_arc: &Arc<Mutex<Option<ChildStdin>>>,
        reader_handle: &Arc<Mutex<Option<JoinHandle<()>>>>,
        pending: &PendingMap,
        ocr_backend: &Arc<Mutex<String>>,
        dml_adapter_name: &Arc<Mutex<Option<String>>>,
    ) -> Result<(), AppError> {
        let python_exe = Self::resolve_python_executable(project_root);
        let script_path = Self::resolve_bridge_script_path(project_root);

        let backend_val = ocr_backend.lock().await.clone();
        let adapter_val = dml_adapter_name.lock().await.clone();

        eprintln!(
            "[ProcessManager] Spawning Python worker (exe: {}, script: {}, cwd: {}, backend: {}, adapter: {:?})",
            python_exe,
            script_path.display(),
            project_root.display(),
            backend_val,
            adapter_val
        );

        let mut cmd = Command::new(&python_exe);
        cmd.arg(&script_path)
            .arg("--stdio-server")
            .arg("--action")
            .arg("ocr")
            .arg("--engine")
            .arg("paddleocr")
            .current_dir(project_root)
            .env("PYTHONUNBUFFERED", "1")
            .env("OCR_BACKEND", &backend_val);

        if let Some(ref adapter) = adapter_val {
            if !adapter.trim().is_empty() {
                cmd.env("OCR_DML_ADAPTER_NAME", adapter);
            }
        }

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| {
            AppError::Process(format!(
                "Failed to spawn Python worker (exe: {}, script: {}): {}",
                python_exe,
                script_path.display(),
                e
            ))
        })?;

        let stdin = child.stdin.take().ok_or_else(|| {
            AppError::Process("Failed to capture Python worker stdin".to_string())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            AppError::Process("Failed to capture Python worker stdout".to_string())
        })?;

        // Read stderr in background task
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    eprintln!("[Python stderr] {}", line);
                }
            });
        }

        // Dedicated background stdout reader task with Request ID demuxing
        let pending_clone = Arc::clone(pending);
        let reader_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
                    if parsed.get("type").and_then(|v| v.as_str()) == Some("progress") {
                        continue;
                    }
                    if let Some(resp_id) = parsed.get("id").and_then(|v| v.as_str()) {
                        let mut map = pending_clone.lock().await;
                        if let Some(sender) = map.remove(resp_id) {
                            let _ = sender.send(Ok(parsed));
                            continue;
                        }
                    }
                    // Fallback for responses without explicit id (e.g. legacy ping/pong)
                    if parsed.get("pong").is_some() || parsed.get("ok").is_some() {
                        let mut map = pending_clone.lock().await;
                        let first_key = map.keys().next().cloned();
                        if let Some(k) = first_key {
                            if let Some(sender) = map.remove(&k) {
                                let _ = sender.send(Ok(parsed));
                            }
                        }
                    }
                }
            }
            // Stream EOF
            let mut map = pending_clone.lock().await;
            let senders: Vec<_> = map.drain().map(|(_, s)| s).collect();
            for sender in senders {
                let _ = sender.send(Err(AppError::Process("Python worker stdout closed unexpectedly".to_string())));
            }
        });

        *child_arc.lock().await = Some(child);
        *stdin_arc.lock().await = Some(stdin);
        *reader_handle.lock().await = Some(reader_task);

        Ok(())
    }

    pub async fn ensure_started(&self) -> Result<(), AppError> {
        let mut child_lock = self.child.lock().await;
        if let Some(ref mut c) = *child_lock {
            if let Ok(None) = c.try_wait() {
                return Ok(());
            }
        }
        drop(child_lock);

        Self::spawn_child_and_reader(
            &self.project_root,
            &self.child,
            &self.stdin,
            &self.reader_handle,
            &self.pending,
            &self.ocr_backend,
            &self.dml_adapter_name,
        ).await?;

        // Proactive Watchdog task with auto-recovery within <= 3 seconds
        let mut wd_lock = self.watchdog_handle.lock().await;
        if wd_lock.is_none() {
            let child_arc = Arc::clone(&self.child);
            let stdin_arc = Arc::clone(&self.stdin);
            let pending_for_watchdog = Arc::clone(&self.pending);
            let reader_handle_clone = Arc::clone(&self.reader_handle);
            let project_root_clone = self.project_root.clone();
            let is_shutting_down_clone = Arc::clone(&self.is_shutting_down);
            let ocr_backend_clone = Arc::clone(&self.ocr_backend);
            let dml_adapter_clone = Arc::clone(&self.dml_adapter_name);

            let watchdog_task = tokio::spawn(async move {
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    if is_shutting_down_clone.load(std::sync::atomic::Ordering::Relaxed) {
                        break;
                    }
                    let mut lock = child_arc.lock().await;
                    if let Some(ref mut c) = *lock {
                        match c.try_wait() {
                            Ok(Some(status)) => {
                                eprintln!("[ProcessManager Watchdog] Python worker terminated unexpectedly: {:?}", status);
                                *lock = None;
                                *stdin_arc.lock().await = None;
                                let mut map = pending_for_watchdog.lock().await;
                                let senders: Vec<_> = map.drain().map(|(_, s)| s).collect();
                                for sender in senders {
                                    let _ = sender.send(Err(AppError::Process(format!(
                                        "Python worker exited unexpectedly with status: {:?}",
                                        status
                                    ))));
                                }
                                drop(lock);

                                // Auto-recover within <= 3 seconds if not shutting down
                                if !is_shutting_down_clone.load(std::sync::atomic::Ordering::Relaxed) {
                                    eprintln!("[ProcessManager Watchdog] Proactively reviving Python worker in <= 3s...");
                                    tokio::time::sleep(tokio::time::Duration::from_millis(600)).await;
                                    if let Err(e) = Self::spawn_child_and_reader(
                                        &project_root_clone,
                                        &child_arc,
                                        &stdin_arc,
                                        &reader_handle_clone,
                                        &pending_for_watchdog,
                                        &ocr_backend_clone,
                                        &dml_adapter_clone,
                                    ).await {
                                        eprintln!("[ProcessManager Watchdog] Auto-recovery failed: {}", e);
                                    } else {
                                        eprintln!("[ProcessManager Watchdog] Python worker revived successfully!");
                                    }
                                }
                            }
                            Ok(None) => {}
                            Err(e) => {
                                eprintln!("[ProcessManager Watchdog] Error polling child status: {}", e);
                            }
                        }
                    }
                }
            });
            *wd_lock = Some(watchdog_task);
        }

        Ok(())
    }

    pub async fn get_child_pid(&self) -> Option<u32> {
        let lock = self.child.lock().await;
        lock.as_ref().and_then(|c| c.id())
    }

    pub async fn simulate_crash(&self) -> Result<(), AppError> {
        let mut lock = self.child.lock().await;
        if let Some(ref mut c) = *lock {
            c.kill().await.map_err(|e| AppError::Process(e.to_string()))?;
            Ok(())
        } else {
            Err(AppError::Process("No active child process to crash".to_string()))
        }
    }

    async fn internal_reset(&self) {
        self.is_shutting_down.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(handle) = self.watchdog_handle.lock().await.take() {
            handle.abort();
        }
        if let Some(handle) = self.reader_handle.lock().await.take() {
            handle.abort();
        }
        let mut child_lock = self.child.lock().await;
        if let Some(mut child) = child_lock.take() {
            let _ = child.kill().await;
            let _ = child.wait().await; // Clean up zombie handle
        }
        *self.stdin.lock().await = None;
        let mut map = self.pending.lock().await;
        let senders: Vec<_> = map.drain().map(|(_, s)| s).collect();
        for sender in senders {
            let _ = sender.send(Err(AppError::Process("Process reset while awaiting response".to_string())));
        }
        self.is_shutting_down.store(false, std::sync::atomic::Ordering::SeqCst);
    }

    pub async fn send_command(&self, payload: Value) -> Result<Value, AppError> {
        let dedup_key = {
            let action = payload.get("action").and_then(|v| v.as_str()).unwrap_or("");
            let engine = payload.get("engine").and_then(|v| v.as_str()).unwrap_or("");
            let img = payload.get("image").or_else(|| payload.get("imagePath")).and_then(|v| v.as_str()).unwrap_or("");
            if !action.is_empty() && !img.is_empty() {
                format!("{}:{}:{}", action, engine, img)
            } else {
                String::new()
            }
        };

        if !dedup_key.is_empty() {
            let mut inflight = self.inflight.lock().await;
            if let Some(tx) = inflight.get(&dedup_key) {
                let mut rx = tx.subscribe();
                drop(inflight);
                return match rx.recv().await {
                    Ok(Ok(val)) => Ok(val),
                    Ok(Err(err)) => Err(AppError::Process(err)),
                    Err(_) => Err(AppError::Process("In-flight task cancelled".to_string())),
                };
            }
            let (tx, _) = tokio::sync::broadcast::channel(4);
            inflight.insert(dedup_key.clone(), tx);
        }

        let res = self.execute_command(payload).await;

        if !dedup_key.is_empty() {
            let mut inflight = self.inflight.lock().await;
            if let Some(tx) = inflight.remove(&dedup_key) {
                let mapped = match &res {
                    Ok(v) => Ok(v.clone()),
                    Err(e) => Err(e.to_string()),
                };
                let _ = tx.send(mapped);
            }
        }

        res
    }

    pub async fn execute_command(&self, mut payload: Value) -> Result<Value, AppError> {
        self.ensure_started().await?;

        let req_id = payload
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                let id = format!("req_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
                if let Value::Object(ref mut map) = payload {
                    map.insert("id".to_string(), json!(id));
                }
                id
            });

        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(req_id.clone(), tx);
        }

        let serialized = serde_json::to_string(&payload)?;

        let write_res = {
            let mut stdin_lock = self.stdin.lock().await;
            if let Some(stdin) = stdin_lock.as_mut() {
                let mut res = stdin.write_all(format!("{}\n", serialized).as_bytes()).await;
                if res.is_ok() {
                    res = stdin.flush().await;
                }
                res
            } else {
                Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "Stdin is None"))
            }
        };

        if let Err(e) = write_res {
            eprintln!("[ProcessManager] Pipe write failed ({}). Resetting worker...", e);
            self.pending.lock().await.remove(&req_id);
            self.internal_reset().await;
            return Err(AppError::Process(format!("Pipe write failed: {}", e)));
        }

        let timeout_duration = std::time::Duration::from_secs(60);
        match tokio::time::timeout(timeout_duration, rx).await {
            Ok(Ok(resp)) => resp,
            Ok(Err(_)) => {
                self.pending.lock().await.remove(&req_id);
                Err(AppError::Process("Python worker channel closed prematurely".to_string()))
            }
            Err(_) => {
                self.pending.lock().await.remove(&req_id);
                eprintln!("[ProcessManager] Timeout waiting for Python response. Resetting worker...");
                self.internal_reset().await;
                Err(AppError::Process("Timeout waiting for Python worker response".to_string()))
            }
        }
    }

    pub async fn check_health(&self) -> Result<HealthStatus, AppError> {
        let ping_payload = json!({
            "id": "health_check",
            "action": "ping",
            "engine": "paddleocr"
        });

        match self.send_command(ping_payload).await {
            Ok(resp) => {
                let is_pong = resp.get("pong").and_then(|v| v.as_bool()).unwrap_or(false);
                let is_ok = resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                if is_pong || is_ok {
                    Ok(HealthStatus {
                        status: "ready".to_string(),
                        message: Some("Pong: Python sidecar is ready".to_string()),
                    })
                } else {
                    Ok(HealthStatus {
                        status: "starting".to_string(),
                        message: Some("Worker responded but not ready".to_string()),
                    })
                }
            }
            Err(e) => Ok(HealthStatus {
                status: "error".to_string(),
                message: Some(e.to_string()),
            }),
        }
    }

    pub async fn restart_worker(&self) -> Result<(), AppError> {
        self.internal_reset().await;
        self.ensure_started().await?;
        Ok(())
    }

    pub async fn set_ocr_backend(&self, backend: String, adapter_name: Option<String>) -> Result<(), AppError> {
        {
            let mut b = self.ocr_backend.lock().await;
            *b = backend;
            let mut a = self.dml_adapter_name.lock().await;
            *a = adapter_name.filter(|s| !s.trim().is_empty());
        }
        self.restart_worker().await
    }

    pub async fn get_ocr_backend(&self) -> (String, Option<String>) {
        let b = self.ocr_backend.lock().await.clone();
        let a = self.dml_adapter_name.lock().await.clone();
        (b, a)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_python_discovery() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
        let pm = ProcessManager::new(root);
        let python = pm.find_python_executable();
        assert!(!python.is_empty(), "Python executable should be discovered");
    }

    #[tokio::test]
    async fn test_python_health_check() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
        let pm = ProcessManager::new(root);
        let health = pm.check_health().await.expect("Health check should complete");
        println!("Sidecar health status: {:?}", health);
        assert_eq!(health.status, "ready");
        assert!(health.message.unwrap().contains("Pong"));
    }
}

