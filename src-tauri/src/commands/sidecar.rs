use tauri::State;
use serde_json::Value;
use crate::core::process_manager::HealthStatus;
use crate::AppState;

#[tauri::command]
pub async fn check_health(state: State<'_, AppState>) -> Result<HealthStatus, String> {
    state.process_manager.check_health().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restart_worker(state: State<'_, AppState>) -> Result<(), String> {
    state.process_manager.restart_worker().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_sidecar_command(
    state: State<'_, AppState>,
    payload: Value,
) -> Result<Value, String> {
    state.process_manager.send_command(payload).await.map_err(|e| e.to_string())
}
