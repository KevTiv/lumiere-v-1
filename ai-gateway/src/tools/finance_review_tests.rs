use super::finance_review::*;
use axum::{
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use serde_json::json;

async fn serve(app: Router) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, task)
}

#[tokio::test]
async fn finance_transport_forwards_only_verified_actor_and_company_and_rejects_forged_response() {
    let app=Router::new().route("/v1/finance-reviews/period_close_review",post(|headers:HeaderMap,Json(body):Json<serde_json::Value>|async move{
        assert_eq!(headers["authorization"],"Bearer actor-token");assert_eq!(headers["x-stdb-identity"],"actor");assert_eq!(body,json!({"companyId":7,"inputs":{"periodId":1}}));
        Json(json!({"schemaVersion":1,"skillKey":"period_close_review","organizationId":9,"companyId":7,"observedAt":"2026-10-26T00:00:00Z","observation":{"periodId":1}}))
    }));
    let (url, task) = serve(app).await;
    assert!(fetch(
        &url,
        "actor-token",
        "actor",
        9,
        7,
        "period_close_review",
        &json!({"periodId":1})
    )
    .await
    .is_ok());
    assert!(fetch(
        &url,
        "actor-token",
        "actor",
        8,
        7,
        "period_close_review",
        &json!({"periodId":1})
    )
    .await
    .is_err());
    assert!(fetch(
        &url,
        "actor-token",
        "actor",
        9,
        7,
        "period_close_review",
        &json!({"periodId":1,"companyId":99})
    )
    .await
    .is_err());
    task.abort();
}

#[tokio::test]
async fn denied_failed_and_oversized_reads_never_become_empty_success() {
    for status in [
        StatusCode::UNAUTHORIZED,
        StatusCode::FORBIDDEN,
        StatusCode::NOT_FOUND,
        StatusCode::SERVICE_UNAVAILABLE,
    ] {
        let (url, task) = serve(Router::new().route(
            "/v1/finance-reviews/period_close_review",
            post(move || async move { status }),
        ))
        .await;
        let error = fetch(
            &url,
            "actor",
            "actor",
            9,
            7,
            "period_close_review",
            &json!({"periodId":1}),
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains(&status.as_u16().to_string()));
        task.abort();
    }
    let (url, task) = serve(Router::new().route(
        "/v1/finance-reviews/period_close_review",
        post(|| async { "x".repeat(lumiere_finance_review_core::MAX_BYTES + 1) }),
    ))
    .await;
    assert!(fetch(
        &url,
        "actor",
        "actor",
        9,
        7,
        "period_close_review",
        &json!({"periodId":1})
    )
    .await
    .unwrap_err()
    .to_string()
    .contains("byte bound"));
    task.abort();
}

#[tokio::test]
async fn redirects_cannot_forward_credentials_to_another_origin() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = calls.clone();
    let (target, task2) = serve(Router::new().route(
        "/steal",
        post(move || {
            let counted = counted.clone();
            async move {
                counted.fetch_add(1, Ordering::SeqCst);
                StatusCode::OK
            }
        }),
    ))
    .await;
    let destination = format!("{target}/steal");
    let (url, task) = serve(Router::new().route(
        "/v1/finance-reviews/period_close_review",
        post(move || {
            let destination = destination.clone();
            async move { axum::response::Redirect::temporary(&destination) }
        }),
    ))
    .await;
    assert!(fetch(
        &url,
        "secret-actor-token",
        "actor",
        9,
        7,
        "period_close_review",
        &json!({"periodId":1})
    )
    .await
    .is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    task.abort();
    task2.abort();
}
