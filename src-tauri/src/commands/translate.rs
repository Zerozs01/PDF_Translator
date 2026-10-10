use tauri::State;
use serde_json::{json, Value};
use crate::AppState;

#[tauri::command]
pub async fn translate_batch_offline(
    state: State<'_, AppState>,
    texts: Vec<String>,
    source_language: Option<String>,
    target_language: Option<String>,
    mode: Option<String>,
    source_type: Option<String>,
    engine: Option<String>,
) -> Result<Value, String> {
    let payload = json!({
        "texts": texts,
        "sourceLanguage": source_language.unwrap_or_else(|| "en".to_string()),
        "targetLanguage": target_language.unwrap_or_else(|| "th".to_string()),
        "mode": mode.unwrap_or_else(|| "manga".to_string()),
        "sourceType": source_type.unwrap_or_else(|| "text".to_string()),
        "engine": engine.unwrap_or_else(|| "argos".to_string()),
    });

    state.translation_manager.send_command(payload).await.map_err(|e| e.to_string())
}
