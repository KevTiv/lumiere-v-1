use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn health(State(_state): State<AppState>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "lumiere-ai-gateway",
    }))
}
