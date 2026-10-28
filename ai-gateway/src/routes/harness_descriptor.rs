//! `GET /v1/harness/descriptor`: versioned harness capability negotiation.
//!
//! The descriptor tells a client what this gateway build/config actually
//! admits so web, desktop and offline clients can upgrade independently
//! (plan: `docs/plans/ai-harness-t3-control-plane-adoption.md` section 3).
//!
//! Rules this module enforces:
//! - Every flag is derived from build admission and live configuration. A flag
//!   is `false` when the capability is absent or disabled; nothing is claimed
//!   optimistically. `proposalWorkspaces` and `specialistDelegation` are not
//!   admitted by this build and stay `false` until their gates pass.
//! - The descriptor is discovery information, never authorization. Reading it
//!   needs a current acting-user grant, and every tool, reducer and resource
//!   is still rechecked per invocation.
//! - No tenant data, credentials, endpoints, model names or other
//!   organizations' providers are serialized. Only driver labels and coarse
//!   status are exposed.
//!
//! Client downgrade rule: absence of a capability means the client hides it.
//! When `etag` differs from a cached descriptor the client must REPLACE its
//! cached capability state with the new descriptor and never merge, so a
//! removed or disabled capability always overrides stale cache. `etag` is
//! content-addressed (SHA-256 of the descriptor), so any flag flip, provider
//! change, registry change or release change produces a new value. It is
//! comparable for equality, not ordered; `descriptorVersion` is the ordered
//! schema version of the descriptor shape itself.

use std::sync::OnceLock;

use axum::{
    extract::State,
    http::{
        header::{CACHE_CONTROL, ETAG},
        HeaderMap, HeaderValue,
    },
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    config::Config,
    error::{AppError, AppResult},
    providers::Providers,
    routes::evidence::require_scoped_capability_grant,
    state::AppState,
};

/// Dedicated read-only grant for this route (owner baseline in the module).
pub(crate) const DESCRIPTOR_CAPABILITY: &str = "ai.harness.descriptor.read";

/// Ordered schema version of the descriptor shape. Bump on any shape change.
pub const DESCRIPTOR_SCHEMA_VERSION: u32 = 1;

/// Checked-in release contract; the gateway reports the contracts release it
/// was built against.
const RELEASE_MANIFEST_JSON: &str = include_str!("../../../release-compatibility-manifest.json");

/// What this build wires. These are build-time facts about code that exists in
/// this binary; configuration can only narrow them further in
/// [`derive_features`]. Flip one only in the change that wires and gates it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BuildAdmission {
    /// Orchestrator tool loop with reviewed generated reads is compiled in.
    pub tool_loop: bool,
    /// `/v1/internal/harness/runs/lifecycle`
    /// (ask/reply/steer/interrupt/resume/fork/compare).
    pub run_lifecycle_routes: bool,
    /// `/v1/evidence/*` routes and the answer evidence gate.
    pub evidence_gate: bool,
    /// AI proposal workspace aggregate (plan section 5). Not built.
    pub proposal_workspaces: bool,
    /// Specialist delegation (plan section 7.4). Not built.
    pub specialist_delegation: bool,
}

impl BuildAdmission {
    pub const CURRENT: Self = Self {
        tool_loop: true,
        run_lifecycle_routes: true,
        evidence_gate: true,
        proposal_workspaces: false,
        specialist_delegation: false,
    };
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessFeatures {
    pub tool_calling: bool,
    pub resumable_runs: bool,
    pub evidence_gate: bool,
    pub durable_questions: bool,
    pub proposal_workspaces: bool,
    pub specialist_delegation: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Llm,
    Embedding,
    Vision,
    DocumentParser,
    WebSearch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderStatus {
    /// Configured and usable by this gateway.
    Available,
    /// Explicitly turned off by configuration.
    Disabled,
    /// Selectable but missing the configuration it needs.
    Unconfigured,
}

/// Capability-only view of one provider. Deliberately has no endpoint, model,
/// credential, account or tenant field.
///
/// INTEGRATION POINT: the instance-based provider manifest (H5d
/// `ProviderDriver`/`ProviderInstance`) will replace [`provider_descriptors`]
/// as the source of this list. Keep this type as the wire contract; add
/// `instanceId` there when instances exist.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilityDescriptor {
    pub kind: ProviderKind,
    pub driver: String,
    pub status: ProviderStatus,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessDescriptor {
    pub descriptor_version: u32,
    pub etag: String,
    pub contract_release: String,
    pub capability_registry_hash: String,
    pub environment_id: String,
    pub features: HarnessFeatures,
    pub providers: Vec<ProviderCapabilityDescriptor>,
}

fn provider(
    kind: ProviderKind,
    driver: &str,
    status: ProviderStatus,
    capabilities: &[&str],
) -> ProviderCapabilityDescriptor {
    ProviderCapabilityDescriptor {
        kind,
        driver: driver.to_string(),
        status,
        // A provider that cannot serve requests advertises no capability.
        capabilities: if status == ProviderStatus::Available {
            capabilities
                .iter()
                .map(|value| (*value).to_string())
                .collect()
        } else {
            Vec::new()
        },
    }
}

fn present(value: Option<&str>) -> bool {
    value.is_some_and(|value| !value.trim().is_empty())
}

/// Provider list from the existing flat `Providers` surface plus config.
///
/// INTEGRATION POINT: replace this function body with the provider-instance
/// manifest once `providers/` exposes it; the descriptor builder only needs
/// `Vec<ProviderCapabilityDescriptor>`.
pub fn provider_descriptors(
    config: &Config,
    providers: &Providers,
) -> Vec<ProviderCapabilityDescriptor> {
    let mut out = Vec::new();

    // LLM routing: Kong, when configured, carries every chat completion.
    if present(config.kong_llm_url.as_deref()) {
        out.push(provider(
            ProviderKind::Llm,
            "kong",
            ProviderStatus::Available,
            &["chat", "tool_calling"],
        ));
    } else {
        for (driver, key) in [
            ("mistral", config.mistral_api_key.as_deref()),
            ("gemini", config.google_api_key.as_deref()),
        ] {
            let status = if present(key) {
                ProviderStatus::Available
            } else {
                ProviderStatus::Unconfigured
            };
            out.push(provider(
                ProviderKind::Llm,
                driver,
                status,
                &["chat", "tool_calling"],
            ));
        }
        let ollama_status = if present(Some(&config.ollama_url)) {
            ProviderStatus::Available
        } else {
            ProviderStatus::Unconfigured
        };
        // Ollama tool calling is an explicit opt-in (see `Config`).
        let ollama_caps: &[&str] = if config.ollama_supports_tool_calling {
            &["chat", "tool_calling"]
        } else {
            &["chat"]
        };
        out.push(provider(
            ProviderKind::Llm,
            "ollama",
            ollama_status,
            ollama_caps,
        ));
    }

    let status_of = |name: &str| {
        if name == "disabled" {
            ProviderStatus::Disabled
        } else {
            ProviderStatus::Available
        }
    };
    out.push(provider(
        ProviderKind::Embedding,
        providers.embedder.name(),
        status_of(providers.embedder.name()),
        &["embeddings"],
    ));
    out.push(provider(
        ProviderKind::Vision,
        providers.vision.name(),
        status_of(providers.vision.name()),
        &["ocr"],
    ));
    out.push(provider(
        ProviderKind::DocumentParser,
        providers.parser.name(),
        ProviderStatus::Available,
        &["document_parsing"],
    ));
    out.push(provider(
        ProviderKind::WebSearch,
        providers.web_search.name(),
        status_of(providers.web_search.name()),
        &["web_search"],
    ));
    out
}

/// Derive feature flags. A flag needs both build admission and the runtime
/// configuration that makes the wired code reachable.
pub fn derive_features(
    config: &Config,
    admission: &BuildAdmission,
    providers: &[ProviderCapabilityDescriptor],
) -> HarnessFeatures {
    // Lifecycle and evidence routes re-resolve actor grants through the API
    // server; without it they fail closed, so the capability is absent.
    let grants_reachable = present(config.api_server_url.as_deref());
    let llm_tool_calling = providers.iter().any(|entry| {
        entry.kind == ProviderKind::Llm
            && entry.status == ProviderStatus::Available
            && entry
                .capabilities
                .iter()
                .any(|value| value == "tool_calling")
    });
    HarnessFeatures {
        tool_calling: admission.tool_loop && llm_tool_calling,
        resumable_runs: admission.run_lifecycle_routes && grants_reachable,
        evidence_gate: admission.evidence_gate && grants_reachable,
        durable_questions: admission.run_lifecycle_routes && grants_reachable,
        proposal_workspaces: admission.proposal_workspaces,
        specialist_delegation: admission.specialist_delegation,
    }
}

/// Opaque, stable identifier of this deployment. Hashed so the database host
/// and module name are not disclosed.
fn environment_id(config: &Config) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"lumiere-harness-environment-v1\0");
    hasher.update(config.stdb_host.as_bytes());
    hasher.update(b"\0");
    hasher.update(config.stdb_module.as_bytes());
    format!("env_{}", &hex(&hasher.finalize())[..16])
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn contract_release() -> AppResult<&'static str> {
    static RELEASE: OnceLock<Option<String>> = OnceLock::new();
    RELEASE
        .get_or_init(|| {
            let manifest: Value = serde_json::from_str(RELEASE_MANIFEST_JSON).ok()?;
            manifest
                .pointer("/lumiere_contracts/version")?
                .as_str()
                .map(str::to_string)
        })
        .as_deref()
        .ok_or_else(|| AppError::Unavailable("contract release is unavailable".into()))
}

/// The capability registry this build embeds. An invalid embedded registry
/// means reviewed tools cannot be offered, so the descriptor fails closed.
fn capability_registry_hash() -> AppResult<&'static str> {
    crate::tools::generated::embedded_catalog()
        .map_err(|_| AppError::Unavailable("capability registry is unavailable".into()))?;
    Ok(lumiere_contracts::generated::agent_capabilities::AGENT_CAPABILITY_REGISTRY_SHA256)
}

/// Pure descriptor construction; no I/O, deterministic for a given input.
pub fn build_descriptor(
    config: &Config,
    admission: &BuildAdmission,
    providers: Vec<ProviderCapabilityDescriptor>,
    contract_release: &str,
    capability_registry_hash: &str,
) -> HarnessDescriptor {
    let features = derive_features(config, admission, &providers);
    let mut descriptor = HarnessDescriptor {
        descriptor_version: DESCRIPTOR_SCHEMA_VERSION,
        etag: String::new(),
        contract_release: contract_release.to_string(),
        capability_registry_hash: capability_registry_hash.to_string(),
        environment_id: environment_id(config),
        features,
        providers,
    };
    // Struct field order is fixed, so this serialization is canonical.
    let canonical = serde_json::to_vec(&descriptor).unwrap_or_default();
    descriptor.etag = format!("sha256-{}", hex(&Sha256::digest(canonical)));
    descriptor
}

fn actor_from_headers(headers: &HeaderMap) -> AppResult<lumiere_auth_context::ActorContext> {
    Ok(lumiere_auth_context::ActorContext::from_headers(headers)?)
}

pub async fn get_descriptor(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let actor = actor_from_headers(&headers)?;
    // Reading the descriptor needs its own read-only grant; the run lifecycle
    // grant does not imply it. The grant is rechecked on every request.
    require_scoped_capability_grant(
        &state,
        &actor.identity,
        &actor.token,
        actor.organization_id,
        actor.company_id,
        DESCRIPTOR_CAPABILITY,
    )
    .await?;

    let providers = provider_descriptors(&state.config, &state.providers);
    let descriptor = build_descriptor(
        &state.config,
        &BuildAdmission::CURRENT,
        providers,
        contract_release()?,
        capability_registry_hash()?,
    );
    let etag = HeaderValue::from_str(&format!("\"{}\"", descriptor.etag))
        .map_err(|_| AppError::Internal("descriptor etag is invalid".into()))?;
    let mut response = Json(descriptor).into_response();
    response.headers_mut().insert(ETAG, etag);
    // Clients must revalidate; a stale descriptor never outlives a downgrade.
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-cache"));
    Ok(response)
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::Arc;

    use crate::{
        config::Config, providers, qdrant_client::VectorStore, rate_limit::AgentRateLimiter,
        rig_agent::RigContext, state::AppState,
    };
    use stdb_client::StdbClient;

    pub(crate) fn config() -> Config {
        Config {
            port: 8080,
            internal_secret: Some("gateway-secret".into()),
            ai_execution_envelope_key: None,
            qdrant_url: "http://127.0.0.1:6334".into(),
            qdrant_api_key: None,
            qdrant_collection: "test".into(),
            stdb_host: "http://stdb.internal.example".into(),
            stdb_module: "tenant_module".into(),
            stdb_token: "stdb-secret-token".into(),
            ai_certification_stdb_token: None,
            ai_spend_read_stdb_token: None,
            ai_certification_runtime_hash: None,
            ai_certification_poll_secs: 5,
            ai_certification_batch_size: 10,
            ai_certification_timeout_secs: 30,
            worker_poll_secs: 10,
            worker_batch_size: 20,
            kaggle_username: None,
            kaggle_api_key: None,
            dataset_cache_dir: "/tmp".into(),
            kaggle_cache_ttl_secs: 60,
            embedding_provider: "disabled".into(),
            ollama_url: "http://ollama.internal.example:11434".into(),
            ollama_embed_model: "embed-model".into(),
            ollama_vision_model: "vision-model".into(),
            ollama_llm_model: "llm-model".into(),
            ollama_supports_tool_calling: false,
            mistral_api_key: None,
            mistral_reasoning_effort: None,
            mistral_reasoning_models: Vec::new(),
            google_api_key: None,
            gemini_embed_model: "gemini-embed".into(),
            kong_llm_url: None,
            kong_llm_service_token: None,
            kong_llm_readiness_url: None,
            vision_provider: "disabled".into(),
            document_parser: "plaintext".into(),
            unstructured_url: "http://parser.internal.example".into(),
            unstructured_api_key: None,
            activity_refs_collection: "test".into(),
            activity_ingest_interval_secs: 60,
            max_upload_bytes: 1024,
            web_search_provider: "disabled".into(),
            web_search_api_key: None,
            web_fetch_max_bytes: 1024,
            api_server_url: None,
        }
    }

    pub(crate) async fn state(config: Config) -> AppState {
        let http = reqwest::Client::new();
        let providers = providers::build(&config, http.clone()).expect("test providers");
        let vector_store = Arc::new(
            VectorStore::new(
                &config.qdrant_url,
                config.qdrant_api_key.as_deref(),
                config.activity_refs_collection.clone(),
            )
            .await
            .expect("test vector store"),
        );
        let rig = Arc::new(
            RigContext::new(&config, providers.clone())
                .await
                .expect("test rig context"),
        );
        let stdb = Arc::new(StdbClient::new(
            config.stdb_host.clone(),
            config.stdb_module.clone(),
            config.stdb_token.clone(),
        ));
        AppState {
            config: Arc::new(config),
            providers,
            vector_store,
            rig,
            stdb,
            spend_read_stdb: None,
            http: Arc::new(http),
            activity_watermarks: Arc::new(dashmap::DashMap::new()),
            download_jobs: Arc::new(dashmap::DashMap::new()),
            kaggle_search_cache: Arc::new(dashmap::DashMap::new()),
            agent_rate_limiter: Arc::new(AgentRateLimiter::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;
    use serde_json::json;

    const IDENTITY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-lumiere-actor-identity",
            HeaderValue::from_static(IDENTITY),
        );
        headers.insert("x-lumiere-actor-token", HeaderValue::from_static("token"));
        headers.insert("x-lumiere-organization-id", HeaderValue::from_static("7"));
        headers.insert("x-lumiere-company-id", HeaderValue::from_static("9"));
        headers
    }

    async fn serve(router: axum::Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let address = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        format!("http://{address}")
    }

    async fn grant_service(capability: Option<&'static str>) -> String {
        let grants = match capability {
            Some(key) => json!([{"capabilityKey": key, "maxRows": 10, "maxBytes": 1024}]),
            None => json!([]),
        };
        let body = json!({
            "organizationId": 7, "companyId": 9, "actorIdentity": IDENTITY, "grants": grants,
        });
        serve(axum::Router::new().route(
            "/v1/ai/capability-grants",
            axum::routing::get(move || {
                let body = body.clone();
                async move { axum::Json(body) }
            }),
        ))
        .await
    }

    fn describe(
        config: &Config,
        state: &AppState,
        admission: &BuildAdmission,
    ) -> HarnessDescriptor {
        build_descriptor(
            config,
            admission,
            provider_descriptors(config, &state.providers),
            "0.0.0-test",
            "registry-hash",
        )
    }

    fn all_keys(value: &Value, out: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (key, inner) in map {
                    out.push(key.to_lowercase());
                    all_keys(inner, out);
                }
            }
            Value::Array(items) => items.iter().for_each(|item| all_keys(item, out)),
            _ => {}
        }
    }

    #[tokio::test]
    async fn unauthenticated_and_ungranted_callers_are_denied() {
        let mut config = test_support::config();
        let state = test_support::state(config.clone()).await;

        // No acting-user headers at all.
        let denied = get_descriptor(State(state.clone()), HeaderMap::new()).await;
        assert!(matches!(denied, Err(AppError::Forbidden(_))));

        // Headers present but grant service not configured: fail closed.
        let denied = get_descriptor(State(state), headers()).await;
        assert!(matches!(denied, Err(AppError::Unavailable(_))));

        // Grant service reachable but the actor lacks the capability.
        config.api_server_url = Some(grant_service(None).await);
        let state = test_support::state(config.clone()).await;
        let denied = get_descriptor(State(state.clone()), headers()).await;
        assert!(matches!(denied, Err(AppError::Forbidden(_))));

        // A grant for a different capability does not authorize the read.
        config.api_server_url = Some(grant_service(Some("ai.evidence.inspect")).await);
        let state = test_support::state(config.clone()).await;
        let denied = get_descriptor(State(state), headers()).await;
        assert!(matches!(denied, Err(AppError::Forbidden(_))));

        // The run lifecycle grant no longer authorizes the descriptor.
        config.api_server_url = Some(grant_service(Some("ai.run.lifecycle")).await);
        let state = test_support::state(config).await;
        let denied = get_descriptor(State(state), headers()).await;
        assert!(matches!(denied, Err(AppError::Forbidden(_))));
    }

    #[tokio::test]
    async fn granted_caller_gets_a_stable_descriptor_with_etag() {
        let mut config = test_support::config();
        config.api_server_url = Some(grant_service(Some(DESCRIPTOR_CAPABILITY)).await);
        let state = test_support::state(config).await;

        let first = get_descriptor(State(state.clone()), headers())
            .await
            .expect("granted");
        let second = get_descriptor(State(state), headers())
            .await
            .expect("granted");
        let etag = first.headers().get(ETAG).cloned().expect("etag header");
        assert_eq!(Some(&etag), second.headers().get(ETAG));
        assert_eq!(
            first.headers().get(CACHE_CONTROL).unwrap(),
            "private, no-cache"
        );
        let body = axum::body::to_bytes(first.into_body(), 1 << 20)
            .await
            .expect("body");
        let value: Value = serde_json::from_slice(&body).expect("json");
        assert_eq!(value["descriptorVersion"], json!(DESCRIPTOR_SCHEMA_VERSION));
        assert_eq!(
            etag.to_str().unwrap(),
            format!("\"{}\"", value["etag"].as_str().unwrap())
        );
        assert_eq!(value["features"]["proposalWorkspaces"], json!(false));
        assert_eq!(value["features"]["specialistDelegation"], json!(false));
    }

    #[tokio::test]
    async fn flags_reflect_disabled_and_missing_configuration() {
        let config = test_support::config();
        let state = test_support::state(config.clone()).await;
        let descriptor = describe(&config, &state, &BuildAdmission::CURRENT);

        let find = |kind: ProviderKind| {
            descriptor
                .providers
                .iter()
                .filter(|entry| entry.kind == kind)
                .collect::<Vec<_>>()
        };
        let embedding = find(ProviderKind::Embedding);
        assert_eq!(embedding[0].status, ProviderStatus::Disabled);
        assert!(embedding[0].capabilities.is_empty());
        let vision = find(ProviderKind::Vision);
        assert_eq!(vision[0].status, ProviderStatus::Disabled);
        assert!(vision[0].capabilities.is_empty());
        assert_eq!(
            find(ProviderKind::WebSearch)[0].status,
            ProviderStatus::Disabled
        );

        let llm = find(ProviderKind::Llm);
        let mistral = llm.iter().find(|entry| entry.driver == "mistral").unwrap();
        assert_eq!(mistral.status, ProviderStatus::Unconfigured);
        assert!(mistral.capabilities.is_empty());

        // Ollama without the tool-calling opt-in and no cloud keys: no tools.
        assert!(!descriptor.features.tool_calling);
        // No API server means no grant resolution: lifecycle/evidence absent.
        assert!(!descriptor.features.resumable_runs);
        assert!(!descriptor.features.durable_questions);
        assert!(!descriptor.features.evidence_gate);
        assert!(!descriptor.features.proposal_workspaces);
        assert!(!descriptor.features.specialist_delegation);
    }

    #[tokio::test]
    async fn gated_features_stay_false_even_when_everything_is_configured() {
        let mut config = test_support::config();
        config.api_server_url = Some("http://api.internal.example".into());
        config.mistral_api_key = Some("sk-live-secret".into());
        let state = test_support::state(config.clone()).await;
        let descriptor = describe(&config, &state, &BuildAdmission::CURRENT);

        assert!(descriptor.features.tool_calling);
        assert!(descriptor.features.resumable_runs);
        assert!(descriptor.features.durable_questions);
        assert!(descriptor.features.evidence_gate);
        assert!(!BuildAdmission::CURRENT.proposal_workspaces);
        assert!(!BuildAdmission::CURRENT.specialist_delegation);
        assert!(!descriptor.features.proposal_workspaces);
        assert!(!descriptor.features.specialist_delegation);
    }

    #[tokio::test]
    async fn etag_is_stable_and_changes_when_a_feature_flips() {
        let mut config = test_support::config();
        let state = test_support::state(config.clone()).await;
        let base = describe(&config, &state, &BuildAdmission::CURRENT);
        assert_eq!(base, describe(&config, &state, &BuildAdmission::CURRENT));
        assert!(base.etag.starts_with("sha256-"));

        // Config flip: API server reachable enables lifecycle/evidence.
        config.api_server_url = Some("http://api.internal.example".into());
        let enabled = describe(&config, &state, &BuildAdmission::CURRENT);
        assert!(enabled.features.resumable_runs);
        assert_ne!(base.etag, enabled.etag);

        // Downgrade flip: removing it again restores the earlier descriptor.
        config.api_server_url = None;
        assert_eq!(
            base.etag,
            describe(&config, &state, &BuildAdmission::CURRENT).etag
        );

        // Build admission flip changes the etag too.
        let mut admission = BuildAdmission::CURRENT;
        admission.evidence_gate = true;
        config.api_server_url = Some("http://api.internal.example".into());
        let with_evidence = describe(&config, &state, &admission);
        admission.evidence_gate = false;
        assert_ne!(
            with_evidence.etag,
            describe(&config, &state, &admission).etag
        );

        // Release or registry change changes the etag.
        let other = build_descriptor(
            &config,
            &BuildAdmission::CURRENT,
            provider_descriptors(&config, &state.providers),
            "0.0.0-test",
            "other-registry-hash",
        );
        assert_ne!(with_evidence.etag, other.etag);
    }

    #[tokio::test]
    async fn serialized_descriptor_carries_no_secret_endpoint_or_credential_fields() {
        let mut config = test_support::config();
        config.api_server_url = Some("http://api.internal.example".into());
        config.mistral_api_key = Some("sk-live-secret".into());
        config.google_api_key = Some("google-live-secret".into());
        config.kong_llm_url = Some("http://kong.internal.example".into());
        config.kong_llm_service_token = Some("kong-service-secret".into());
        config.web_search_api_key = Some("search-secret".into());
        config.unstructured_api_key = Some("parser-secret".into());
        let state = test_support::state(config.clone()).await;
        let descriptor = describe(&config, &state, &BuildAdmission::CURRENT);

        let value = serde_json::to_value(&descriptor).expect("json");
        let text = value.to_string();
        for leaked in [
            "secret",
            "internal.example",
            "http://",
            "tenant_module",
            "stdb",
            "llm-model",
            "vision-model",
            "embed-model",
        ] {
            assert!(!text.contains(leaked), "descriptor leaked {leaked}: {text}");
        }
        let mut keys = Vec::new();
        all_keys(&value, &mut keys);
        for key in keys {
            for forbidden in [
                "url",
                "endpoint",
                "token",
                "secret",
                "credential",
                "password",
                "apikey",
                "host",
                "model",
                "organization",
                "company",
                "tenant",
            ] {
                assert!(!key.contains(forbidden), "field {key} looks sensitive");
            }
        }
    }

    #[test]
    fn contract_release_and_registry_are_the_embedded_build_facts() {
        let release = contract_release().expect("release");
        assert!(release.split('.').count() == 3, "{release}");
        assert_eq!(
            capability_registry_hash().expect("registry"),
            lumiere_contracts::generated::agent_capabilities::AGENT_CAPABILITY_REGISTRY_SHA256
        );
    }
}
