use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;
use crate::error::AppError;

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, AppError>>>>>;

pub struct TranslationManager {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    pending: PendingMap,
    watchdog_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    reader_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    project_root: PathBuf,
}

impl TranslationManager {
    pub fn new(project_root: PathBuf) -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            watchdog_handle: Arc::new(Mutex::new(None)),
            reader_handle: Arc::new(Mutex::new(None)),
            project_root,
        }
    }

    pub fn find_python_executable(&self) -> String {
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
            venv_candidates.push(self.project_root.join(".venv-ocr").join("Scripts").join("python.exe"));
            venv_candidates.push(self.project_root.join(".venv").join("Scripts").join("python.exe"));
            if let Some(parent) = self.project_root.parent() {
                venv_candidates.push(parent.join(".venv-ocr").join("Scripts").join("python.exe"));
                venv_candidates.push(parent.join(".venv").join("Scripts").join("python.exe"));
            }
        } else {
            venv_candidates.push(self.project_root.join(".venv-ocr").join("bin").join("python"));
            venv_candidates.push(self.project_root.join(".venv").join("bin").join("python"));
            if let Some(parent) = self.project_root.parent() {
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

    pub fn get_bridge_script_path(&self) -> PathBuf {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                let res_script = exe_dir.join("resources").join("scripts").join("argos_translate_bridge.py");
                if res_script.exists() {
                    return res_script;
                }
            }
        }

        let candidate = self.project_root.join("scripts").join("argos_translate_bridge.py");
        if candidate.exists() {
            return candidate;
        }
        if let Some(parent) = self.project_root.parent() {
            let parent_cand = parent.join("scripts").join("argos_translate_bridge.py");
            if parent_cand.exists() {
                return parent_cand;
            }
        }
        PathBuf::from("scripts/argos_translate_bridge.py")
    }

    pub async fn ensure_started(&self) -> Result<(), AppError> {
        let mut child_lock = self.child.lock().await;
        if let Some(ref mut c) = *child_lock {
            if let Ok(None) = c.try_wait() {
                return Ok(());
            }
        }

        let python_exe = self.find_python_executable();
        let script_path = self.get_bridge_script_path();

        eprintln!(
            "[TranslationManager] Spawning Argos Python worker (exe: {}, script: {}, cwd: {})",
            python_exe,
            script_path.display(),
            self.project_root.display()
        );

        let mut cmd = Command::new(&python_exe);
        cmd.arg(&script_path)
            .arg("--stdio-server")
            .current_dir(&self.project_root)
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONUTF8", "1")
            .env("ARGOS_CHUNK_TYPE", "MINISBD")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| {
            AppError::Process(format!(
                "Failed to spawn Argos Python worker (exe: {}, script: {}): {}",
                python_exe,
                script_path.display(),
                e
            ))
        })?;

        let stdin = child.stdin.take().ok_or_else(|| {
            AppError::Process("Failed to capture Argos worker stdin".to_string())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            AppError::Process("Failed to capture Argos worker stdout".to_string())
        })?;

        // Drain stderr in background task
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    eprintln!("[Argos stderr] {}", line);
                }
            });
        }

        // Dedicated stdout reader task with Request ID matching
        let pending_clone = Arc::clone(&self.pending);
        let reader_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
                    if let Some(resp_id) = parsed.get("id").and_then(|v| v.as_str()) {
                        let mut map = pending_clone.lock().await;
                        if let Some(sender) = map.remove(resp_id) {
                            let _ = sender.send(Ok(parsed));
                            continue;
                        }
                    }
                    if parsed.get("translations").is_some() || parsed.get("ok").is_some() {
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
            let mut map = pending_clone.lock().await;
            let senders: Vec<_> = map.drain().map(|(_, s)| s).collect();
            for sender in senders {
                let _ = sender.send(Err(AppError::Process("Argos worker stdout closed unexpectedly".to_string())));
            }
        });

        // Dedicated proactive Watchdog task
        let child_arc = Arc::clone(&self.child);
        let stdin_arc = Arc::clone(&self.stdin);
        let pending_for_watchdog = Arc::clone(&self.pending);
        let watchdog_task = tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
                let mut lock = child_arc.lock().await;
                if let Some(ref mut c) = *lock {
                    match c.try_wait() {
                        Ok(Some(status)) => {
                            eprintln!("[TranslationManager Watchdog] Argos worker terminated: {:?}", status);
                            *lock = None;
                            *stdin_arc.lock().await = None;
                            let mut map = pending_for_watchdog.lock().await;
                            let senders: Vec<_> = map.drain().map(|(_, s)| s).collect();
                            for sender in senders {
                                let _ = sender.send(Err(AppError::Process(format!(
                                    "Argos worker exited unexpectedly with status: {:?}",
                                    status
                                ))));
                            }
                            break;
                        }
                        Ok(None) => {}
                        Err(e) => {
                            eprintln!("[TranslationManager Watchdog] Error checking child status: {}", e);
                        }
                    }
                } else {
                    break;
                }
            }
        });

        *child_lock = Some(child);
        *self.stdin.lock().await = Some(stdin);
        *self.reader_handle.lock().await = Some(reader_task);
        *self.watchdog_handle.lock().await = Some(watchdog_task);

        Ok(())
    }

    async fn internal_reset(&self) {
        if let Some(handle) = self.watchdog_handle.lock().await.take() {
            handle.abort();
        }
        if let Some(handle) = self.reader_handle.lock().await.take() {
            handle.abort();
        }
        let mut child_lock = self.child.lock().await;
        if let Some(mut child) = child_lock.take() {
            let _ = child.kill().await;
            let _ = child.wait().await; // Clean up zombie process handle
        }
        *self.stdin.lock().await = None;
        let mut map = self.pending.lock().await;
        let senders: Vec<_> = map.drain().map(|(_, s)| s).collect();
        for sender in senders {
            let _ = sender.send(Err(AppError::Process("Translation worker reset while awaiting response".to_string())));
        }
    }

    pub async fn send_command(&self, mut payload: Value) -> Result<Value, AppError> {
        self.ensure_started().await?;

        let req_id = payload
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                let id = format!("trans_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
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
            eprintln!("[TranslationManager] Pipe write failed ({}). Restarting Argos worker...", e);
            self.pending.lock().await.remove(&req_id);
            self.internal_reset().await;
            return Err(AppError::Process(format!("Argos pipe write failed: {}", e)));
        }

        let timeout_duration = std::time::Duration::from_secs(45);
        match tokio::time::timeout(timeout_duration, rx).await {
            Ok(Ok(resp)) => resp,
            Ok(Err(_)) => {
                self.pending.lock().await.remove(&req_id);
                Err(AppError::Process("Argos worker channel closed prematurely".to_string()))
            }
            Err(_) => {
                self.pending.lock().await.remove(&req_id);
                eprintln!("[TranslationManager] Timeout waiting for Argos response. Resetting worker...");
                self.internal_reset().await;
                Err(AppError::Process("Timeout waiting for Argos worker response".to_string()))
            }
        }
    }
}
