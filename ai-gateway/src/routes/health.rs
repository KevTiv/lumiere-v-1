use axum::Json;
use serde_json::{json, Value};

pub async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "lumiere-ai-gateway",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn health_returns_ok_payload() {
        let Json(body) = health().await;
        assert_eq!(body["status"], "ok");
        assert_eq!(body["service"], "lumiere-ai-gateway");
    }
}
