//! The legacy raw-index search has no actor authorization contract.
//! Use `/v1/context/search` for metered retrieval with live actor reauthorization.

use crate::error::AppError;

/// Keep the legacy endpoint closed even for direct gateway callers: a tenant
/// filter alone cannot authorize disclosure of ERP records or a paid embedding.
pub async fn post_search() -> AppError {
    AppError::Unavailable("raw index search is unavailable; use authorized context search".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::StatusCode, response::IntoResponse};

    #[tokio::test]
    async fn legacy_search_stays_closed_without_provider_or_database_access() {
        assert_eq!(
            post_search().await.into_response().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
