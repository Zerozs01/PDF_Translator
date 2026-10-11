use tauri::State;
use serde_json::Value;
use crate::core::db::ExecuteResult;
use crate::AppState;

#[tauri::command]
pub async fn query_db(
    state: State<'_, AppState>,
    sql: String,
    params: Option<Vec<Value>>,
) -> Result<Vec<Value>, String> {
    let params = params.unwrap_or_default();
    state.db.query(&sql, params).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn execute_db(
    state: State<'_, AppState>,
    sql: String,
    params: Option<Vec<Value>>,
) -> Result<ExecuteResult, String> {
    let params = params.unwrap_or_default();
    state.db.execute(&sql, params).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn init_database(
    _app: tauri::AppHandle,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    // Database schema is automatically initialized on startup, command provided for explicit invocations
    Ok(())
}
