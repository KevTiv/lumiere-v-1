//! Execution adapter for reviewed generated resource reads.
//!
//! Catalog review is not authorization. Each invocation is reauthorized with
//! server-resolved actor grants and then sent through the API server's existing
//! session, field-permission, organization and company checks.

use anyhow::{bail, ensure, Context, Result};
use serde_json::Value;
use std::time::Duration;

use super::{
    generated::{
        embedded_catalog, EffectiveGeneratedCapabilityView, GeneratedReadGrant,
        PreparedGeneratedRead,
    },
    types::{ToolContext, ToolOutput},
};
use crate::harness::ActorCredentials;
use crate::orchestrator::{
    resolve_effective_generated_capabilities, security_envelope::AuthorizationGeneration,
};
use crate::providers::llm::ToolCallRequest;
use crate::state::AppState;

const ACTOR_GRANT_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) struct ActorGrantSnapshot {
    pub authorization_generation: AuthorizationGeneration,
    pub grants: Vec<GeneratedReadGrant>,
}

pub(crate) async fn resolve_actor_grants(context: &ToolContext) -> Result<ActorGrantSnapshot> {
    let actor = context
        .actor
        .as_ref()
        .context("generated reads require actor credentials")?;
    resolve_actor_grants_for_actor(&context.state, context.org_id, context.company_id, actor).await
}

pub(crate) async fn resolve_actor_grants_for_actor(
    state: &AppState,
    organization_id: u64,
    company_id: u64,
    actor: &ActorCredentials,
) -> Result<ActorGrantSnapshot> {
    let api_base = api_base(state)?;
    resolve_actor_grants_for_scope(
        state.http.as_ref(),
        api_base,
        organization_id,
        company_id,
        actor,
    )
    .await
}

async fn resolve_actor_grants_for_scope(
    http: &reqwest::Client,
    api_base: &str,
    organization_id: u64,
    company_id: u64,
    actor: &ActorCredentials,
) -> Result<ActorGrantSnapshot> {
    resolve_actor_grants_for_scope_with_timeout(
        http,
        api_base,
        organization_id,
        company_id,
        actor,
        ACTOR_GRANT_TIMEOUT,
    )
    .await
}

async fn resolve_actor_grants_for_scope_with_timeout(
    http: &reqwest::Client,
    api_base: &str,
    organization_id: u64,
    company_id: u64,
    actor: &ActorCredentials,
    timeout: Duration,
) -> Result<ActorGrantSnapshot> {
    let context = lumiere_auth_context::ActorContext::new(
        &actor.identity_hex,
        &actor.stdb_token,
        organization_id,
        company_id,
    )?;
    let envelope =
        lumiere_auth_context::fetch_capability_grants(http, api_base, &context, timeout).await?;
    Ok(ActorGrantSnapshot {
        authorization_generation: AuthorizationGeneration::new(
            envelope
                .placement_generation
                .context("missing placement generation")?,
            envelope
                .policy_snapshot_hash
                .context("missing policy snapshot hash")?,
            envelope
                .capability_grants_hash
                .context("missing capability grants hash")?,
        )
        .context("generated capability authorization generation is invalid")?,
        grants: envelope.grants,
    })
}

async fn resolve_effective_view_for_scope(
    http: &reqwest::Client,
    api_base: &str,
    organization_id: u64,
    company_id: u64,
    actor: &ActorCredentials,
    declared_tool_names: &[String],
) -> Result<EffectiveGeneratedCapabilityView> {
    let current =
        resolve_actor_grants_for_scope(http, api_base, organization_id, company_id, actor).await?;
    resolve_effective_generated_capabilities(declared_tool_names, &current.grants)
}

pub(crate) struct GeneratedReadTools<'a> {
    declared_tool_names: &'a [String],
}

impl<'a> GeneratedReadTools<'a> {
    pub(crate) fn new(declared_tool_names: &'a [String]) -> Self {
        Self {
            declared_tool_names,
        }
    }

    pub(crate) async fn execute(
        &self,
        call: &ToolCallRequest,
        context: &ToolContext,
    ) -> Result<ToolOutput> {
        ensure!(context.run_id != 0, "durable run is required");
        let actor = context
            .actor
            .as_ref()
            .context("generated reads require actor credentials")?;
        // Grants are deliberately resolved for every invocation. A run may be
        // long lived, so caching them at run admission would let a revoked or
        // narrowed capability survive until the next run.
        let effective = resolve_effective_view_for_scope(
            context.state.http.as_ref(),
            api_base(&context.state)?,
            context.org_id,
            context.company_id,
            actor,
            self.declared_tool_names,
        )
        .await?;
        ensure!(
            effective.specs.iter().any(|spec| spec.name == call.name),
            "generated capability is not currently visible to this invocation"
        );
        let prepared = embedded_catalog()?
            .prepare_read(
                &call.name,
                &call.arguments,
                context.company_id,
                &effective.grants,
            )
            .map_err(anyhow::Error::from)?;
        let api_base = api_base(&context.state)?;
        let limit =
            u32::try_from(prepared.max_rows).context("generated read row limit exceeds u32")?;
        let response = context
            .state
            .http
            .get(format!("{api_base}/v1/query/{}", prepared.resource))
            .bearer_auth(actor.stdb_token.trim())
            .header("x-stdb-identity", actor.identity_hex.trim())
            .query(&[
                ("companyId", prepared.company_id),
                ("limit", u64::from(limit)),
            ])
            .send()
            .await
            .context("authorized generated read request failed")?;
        if !response.status().is_success() {
            bail!(
                "authorized generated read was denied or unavailable ({})",
                response.status()
            );
        }
        let envelope: Value = response
            .json()
            .await
            .context("authorized generated read returned invalid JSON")?;
        bounded_output(&prepared, envelope)
    }
}

fn api_base(state: &AppState) -> Result<&str> {
    Ok(state
        .config
        .api_server_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .context("LUMIERE_API_SERVER_URL is required for generated reads")?
        .trim_end_matches('/'))
}

fn bounded_output(prepared: &PreparedGeneratedRead, envelope: Value) -> Result<ToolOutput> {
    let rows = envelope
        .get("data")
        .and_then(Value::as_array)
        .context("authorized generated read response has no data array")?;
    ensure!(
        rows.len() as u64 <= prepared.max_rows,
        "authorized generated read exceeded its row limit"
    );
    let data = Value::Array(rows.clone());
    let bytes = serde_json::to_vec(&data).context("serialize generated read output")?;
    ensure!(
        bytes.len() as u64 <= prepared.max_bytes,
        "authorized generated read exceeded its byte limit"
    );
    let row_count = u32::try_from(rows.len()).context("generated read row count exceeds u32")?;
    Ok(ToolOutput {
        summary: format!(
            "{} returned {} authorized rows",
            prepared.capability_key, row_count
        ),
        data,
        citations: Vec::new(),
        row_count: Some(row_count),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::Query, http::HeaderMap, routing::get, Json, Router};
    use serde_json::json;
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
    };

    fn prepared(max_rows: u64, max_bytes: u64) -> PreparedGeneratedRead {
        PreparedGeneratedRead {
            tool_name: "inventory_products_read".into(),
            capability_key: "inventory.products.read".into(),
            resource: "products".into(),
            company_id: 7,
            max_rows,
            max_bytes,
        }
    }

    #[test]
    fn output_must_stay_inside_both_effective_caps() {
        let output = bounded_output(&prepared(2, 100), json!({"data":[{"id":1},{"id":2}]}))
            .expect("bounded output");
        assert_eq!(output.row_count, Some(2));
        assert!(bounded_output(&prepared(1, 100), json!({"data":[{"id":1},{"id":2}]})).is_err());
        assert!(bounded_output(&prepared(2, 2), json!({"data":[{"id":1}]})).is_err());
    }

    #[test]
    fn output_requires_the_authorized_query_envelope() {
        assert!(bounded_output(&prepared(1, 100), json!({"rows":[]})).is_err());
        assert!(bounded_output(&prepared(1, 100), json!({"data":{}})).is_err());
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    struct GrantRequest {
        company_id: String,
        authorization: String,
        actor_identity: String,
    }

    struct RevokingGrantService {
        calls: AtomicUsize,
        requests: Mutex<Vec<GrantRequest>>,
        actor_identity: String,
    }

    async fn revoking_grants(
        axum::extract::State(state): axum::extract::State<Arc<RevokingGrantService>>,
        Query(query): Query<HashMap<String, String>>,
        headers: HeaderMap,
    ) -> Json<Value> {
        state
            .requests
            .lock()
            .expect("request log")
            .push(GrantRequest {
                company_id: query.get("companyId").cloned().unwrap_or_default(),
                authorization: headers
                    .get("authorization")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or_default()
                    .to_string(),
                actor_identity: headers
                    .get("x-stdb-identity")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or_default()
                    .to_string(),
            });
        let call = state.calls.fetch_add(1, Ordering::SeqCst);
        let grants = if call == 0 {
            json!([{
                "capabilityKey": "inventory.products.read",
                "maxRows": 7,
                "maxBytes": 1024,
            }])
        } else {
            json!([])
        };
        Json(json!({
            "organizationId": 11,
            "companyId": 29,
            "actorIdentity": state.actor_identity,
            "knowledgeTeamRefs": [],
            "placementGeneration": 3,
            "policySnapshotHash": "policy-v3",
            "capabilityGrantsHash": if call == 0 {
                format!("sha256:{}", "a".repeat(64))
            } else {
                format!("sha256:{}", "b".repeat(64))
            },
            "grants": grants,
        }))
    }

    async fn slow_grants() -> Json<Value> {
        tokio::time::sleep(Duration::from_millis(100)).await;
        Json(json!({
            "organizationId": 11,
            "companyId": 29,
            "actorIdentity": "actor",
            "knowledgeTeamRefs": [],
            "placementGeneration": 3,
            "policySnapshotHash": "policy-v3",
            "capabilityGrantsHash": format!("sha256:{}", "a".repeat(64)),
            "grants": [],
        }))
    }

    #[tokio::test]
    async fn actor_grant_resolution_has_a_bounded_deadline() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind slow grant service");
        let address = listener.local_addr().expect("grant service address");
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route("/v1/ai/capability-grants", get(slow_grants)),
            )
            .await
            .expect("grant service");
        });
        let actor = ActorCredentials::new("actor-token", "a".repeat(64)).expect("actor");

        let result = resolve_actor_grants_for_scope_with_timeout(
            &reqwest::Client::new(),
            &format!("http://{address}"),
            11,
            29,
            &actor,
            Duration::from_millis(10),
        )
        .await;

        assert!(
            result.is_err(),
            "slow authority must fail closed at deadline"
        );
        server.abort();
    }

    #[tokio::test]
    async fn next_invocation_refetches_company_actor_grants_and_observes_revocation() {
        let actor_identity = "a".repeat(64);
        let state = Arc::new(RevokingGrantService {
            calls: AtomicUsize::new(0),
            requests: Mutex::new(Vec::new()),
            actor_identity: actor_identity.clone(),
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind grant service");
        let address = listener.local_addr().expect("grant service address");
        let router = Router::new()
            .route("/v1/ai/capability-grants", get(revoking_grants))
            .with_state(state.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.expect("grant service");
        });

        let http = reqwest::Client::new();
        let actor = ActorCredentials::new("actor-token", actor_identity.clone()).expect("actor");
        let declared = ["inventory_products_read".to_string()];
        let api_base = format!("http://{address}");

        let first = resolve_effective_view_for_scope(&http, &api_base, 11, 29, &actor, &declared)
            .await
            .expect("first invocation is authorized");
        assert_eq!(first.specs.len(), 1);
        assert_eq!(first.grants.len(), 1);
        assert_eq!(first.grants[0].max_rows, 7);

        let second = resolve_effective_view_for_scope(&http, &api_base, 11, 29, &actor, &declared)
            .await
            .expect("revocation is a valid empty view");
        assert!(second.specs.is_empty());
        assert!(second.grants.is_empty());

        assert_eq!(state.calls.load(Ordering::SeqCst), 2);
        assert_eq!(
            *state.requests.lock().expect("request log"),
            vec![
                GrantRequest {
                    company_id: "29".into(),
                    authorization: "Bearer actor-token".into(),
                    actor_identity: actor_identity.clone(),
                },
                GrantRequest {
                    company_id: "29".into(),
                    authorization: "Bearer actor-token".into(),
                    actor_identity,
                },
            ]
        );
        server.abort();
    }
}
