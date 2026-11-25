//! Trusted browser capability discovery for the local runner.

use ai_gateway::local_runner::PROTOCOL_VERSION;
use axum::{
    extract::{Query, State},
    http::{header::CACHE_CONTROL, HeaderMap},
    response::{IntoResponse, Response},
    Json,
};
use lumiere_auth_context::ActorContext;
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    routes::{evidence::require_scoped_capability_grant, run_lifecycle::LIFECYCLE_CAPABILITY},
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DevicesQuery {
    pub(super) company_id: u64,
}

#[derive(Serialize)]
struct DiscoveryUnavailable {
    version: u8,
    enabled: bool,
    devices: [(); 0],
}

pub async fn get_devices(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<DevicesQuery>,
) -> AppResult<Response> {
    if query.company_id == 0 {
        return Err(AppError::BadRequest("companyId is required".into()));
    }
    let actor = ActorContext::from_headers(&headers)?;
    actor.require_company(query.company_id)?;
    disabled_discovery(&state, &actor).await
}

pub(super) async fn disabled_discovery(
    state: &AppState,
    actor: &ActorContext,
) -> AppResult<Response> {
    require_scoped_capability_grant(
        state,
        &actor.identity,
        &actor.token,
        actor.organization_id,
        actor.company_id,
        LIFECYCLE_CAPABILITY,
    )
    .await?;

    // Real discovery requires the durable registry and native auth transport.
    Ok((
        [(CACHE_CONTROL, "private, no-store")],
        Json(DiscoveryUnavailable {
            version: PROTOCOL_VERSION,
            enabled: false,
            devices: [],
        }),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routes::harness_descriptor::test_support;
    use axum::{
        body::to_bytes,
        http::{header::AUTHORIZATION, StatusCode},
        routing::get,
        Router,
    };
    use serde_json::{json, Value};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    #[tokio::test]
    async fn discovery_requires_the_exact_company_grant_and_stays_disabled() {
        let actor = ActorContext::new(&"a".repeat(64), "test-token", 7, 4097).unwrap();
        let grant_exact = Arc::new(AtomicBool::new(false));
        let authority = Router::new().route(
            "/v1/ai/capability-grants",
            get({
                let grant_exact = Arc::clone(&grant_exact);
                let identity = actor.identity.clone();
                move |headers: HeaderMap, Query(query): Query<DevicesQuery>| {
                    let identity = identity.clone();
                    let grant_exact = Arc::clone(&grant_exact);
                    async move {
                        assert_eq!(headers[AUTHORIZATION], "Bearer test-token");
                        assert_eq!(query.company_id, 4097);
                        Json(json!({
                            "organizationId": 7,
                            "companyId": 4097,
                            "actorIdentity": identity,
                            "grants": [{
                                "capabilityKey": if grant_exact.load(Ordering::SeqCst) {
                                    LIFECYCLE_CAPABILITY
                                } else {
                                    "ai.evidence.inspect"
                                },
                                "maxRows": 1,
                                "maxBytes": 65536
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, authority).await });
        let mut config = test_support::config();
        config.api_server_url = Some(format!("http://{addr}"));
        let state = test_support::state(config).await;

        assert!(matches!(
            get_devices(
                State(state.clone()),
                actor.headers().unwrap(),
                Query(DevicesQuery { company_id: 4098 }),
            )
            .await,
            Err(AppError::Forbidden(_))
        ));
        assert!(matches!(
            get_devices(
                State(state.clone()),
                actor.headers().unwrap(),
                Query(DevicesQuery { company_id: 4097 }),
            )
            .await,
            Err(AppError::Forbidden(_))
        ));
        grant_exact.store(true, Ordering::SeqCst);
        let response = get_devices(
            State(state),
            actor.headers().unwrap(),
            Query(DevicesQuery { company_id: 4097 }),
        )
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap(),
            json!({"version": 1, "enabled": false, "devices": []})
        );
        task.abort();
    }
}
