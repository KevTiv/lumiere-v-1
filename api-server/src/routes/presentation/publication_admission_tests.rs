use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

#[tokio::test]
async fn production_publication_routes_fail_closed_for_forged_authority() {
    for path in [
        "/presentation/publication",
        "/presentation/activation",
        "/presentation/revert",
    ] {
        let response = publication_admission_routes::<()>()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"organizationId":1,"actor":"owner","certified":true}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE, "{path}");
    }
}
