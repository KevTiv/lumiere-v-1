//! Streamable HTTP transport for the native runner's scoped inventory read.

use std::sync::Arc;

use async_trait::async_trait;
use axum::{
    body::to_bytes,
    extract::{Request, State},
    http::{
        header::{
            ACCEPT, ALLOW, AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, ORIGIN, WWW_AUTHENTICATE,
        },
        HeaderMap, HeaderValue, Method, StatusCode,
    },
    response::{IntoResponse, Response},
    routing::any,
    Extension, Json, Router,
};
use lumiere_auth_context::ActorContext;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    harness::manifest::OrgPrivacyPolicy,
    orchestrator::skill_access::SkillAccessError,
    state::AppState,
};

use super::runner_inventory::{
    inventory_low_stock, inventory_tool_definition, InventoryAttempt, LowStockEvidence,
    INVENTORY_LOW_STOCK_TOOL,
};

pub(crate) const MCP_PATH: &str = "/v1/local-runner/mcp";
const PROTOCOL_HEADER: &str = "mcp-protocol-version";
const SUPPORTED_VERSIONS: [&str; 2] = ["2025-11-25", "2025-06-18"];
const MAX_POST_BYTES: usize = 16 * 1024;
const MAX_BEARER_BYTES: usize = 4096;

/// Scope loaded from an active, authenticated runner lease on the server.
#[derive(Clone)]
pub(crate) struct RunnerMcpGrant {
    pub(crate) actor: ActorContext,
    pub(crate) privacy_policy: OrgPrivacyPolicy,
    pub(crate) run_id: u64,
    pub(crate) attempt_id: String,
    pub(crate) device_id: String,
    pub(crate) lease_id: String,
    pub(crate) allowed_tools: Vec<String>,
}

impl RunnerMcpGrant {
    pub(crate) fn inventory_attempt(&self) -> AppResult<InventoryAttempt<'_>> {
        InventoryAttempt::new(
            &self.actor,
            &self.privacy_policy,
            self.run_id,
            &self.attempt_id,
            &self.allowed_tools,
        )
    }
}

/// Resolve the native bearer against the current durable lease on each request.
#[async_trait]
pub(crate) trait RunnerMcpAuthority: Send + Sync {
    async fn authorize(&self, bearer: &str) -> AppResult<RunnerMcpGrant>;

    /// Persist gateway-owned evidence only while the exact lease and tool grant
    /// are still current. This check and the write must be atomic.
    async fn store_evidence(
        &self,
        bearer: &str,
        grant: &RunnerMcpGrant,
        evidence: LowStockEvidence,
    ) -> AppResult<()>;
}

/// Mount outside the internal gateway-secret routes, with the scoped runner
/// authority. The bearer has no meaning on any browser or gateway endpoint.
pub(crate) fn router(authority: Arc<dyn RunnerMcpAuthority>) -> Router<AppState> {
    Router::new()
        .route(MCP_PATH, any(handle))
        .layer(Extension(authority))
}

async fn handle(
    State(state): State<AppState>,
    Extension(authority): Extension<Arc<dyn RunnerMcpAuthority>>,
    request: Request,
) -> Response {
    let mut response = dispatch(&state, authority.as_ref(), request).await;
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    response
}

async fn dispatch(
    state: &AppState,
    authority: &dyn RunnerMcpAuthority,
    request: Request,
) -> Response {
    let (parts, body) = request.into_parts();
    let headers = &parts.headers;
    // Only the native runner connects to this endpoint. Browser-origin
    // requests are denied, including browser preflights and opaque origins.
    if headers.contains_key(ORIGIN) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if parts.method != Method::POST {
        return (StatusCode::METHOD_NOT_ALLOWED, [(ALLOW, "POST")]).into_response();
    }
    let Some(bearer) = bearer_token(headers) else {
        return unauthorized();
    };
    let grant = match authority.authorize(bearer).await {
        Ok(grant) => grant,
        Err(AppError::Forbidden(_) | AppError::NotFound(_)) => return unauthorized(),
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };

    if !headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|media| media.trim().eq_ignore_ascii_case("application/json"))
        })
    {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    if !accepts_json(headers) {
        return StatusCode::NOT_ACCEPTABLE.into_response();
    }
    if headers
        .get(PROTOCOL_HEADER)
        .is_some_and(|value| !valid_protocol(value))
    {
        return rpc_bad_request("Unsupported MCP protocol version");
    }
    let body = match to_bytes(body, MAX_POST_BYTES).await {
        Ok(body) => body,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    let request = match serde_json::from_slice::<Value>(&body) {
        Ok(request) => request,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                rpc_error(&Value::Null, -32700, "Parse error"),
            )
                .into_response()
        }
    };
    let Some(object) = request.as_object() else {
        return rpc_bad_request("Invalid request");
    };
    let Some(method) = object.get("method").and_then(Value::as_str) else {
        return rpc_bad_request("Invalid request");
    };
    let id = object.get("id");
    let params = object.get("params");
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || id.is_some_and(|id| !id.is_string() && !id.is_i64() && !id.is_u64())
        || params.is_some_and(|params| !params.is_object())
    {
        return rpc_bad_request("Invalid request");
    }
    let Some(id) = id else {
        return match method {
            "notifications/initialized" | "notifications/cancelled" => {
                StatusCode::ACCEPTED.into_response()
            }
            _ => StatusCode::BAD_REQUEST.into_response(),
        };
    };

    let result = match method {
        "initialize" => {
            let Some(requested) = params
                .and_then(|params| params.get("protocolVersion"))
                .and_then(Value::as_str)
            else {
                return rpc_error(id, -32602, "A protocol version is required").into_response();
            };
            let version = SUPPORTED_VERSIONS
                .iter()
                .copied()
                .find(|version| *version == requested)
                .unwrap_or(SUPPORTED_VERSIONS[0]);
            json!({
                "protocolVersion": version,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "lumiere", "version": env!("CARGO_PKG_VERSION")}
            })
        }
        "ping" => json!({}),
        "tools/list" => {
            if params.is_some_and(|params| params.get("cursor").is_some()) {
                return rpc_error(id, -32602, "Invalid tool list cursor").into_response();
            }
            match may_list_inventory(state, &grant).await {
                Ok(true) => json!({"tools": [inventory_tool_definition()]}),
                Ok(false) => json!({"tools": []}),
                Err(_) => {
                    return rpc_error(id, -32603, "Tool discovery is unavailable").into_response()
                }
            }
        }
        "tools/call" => {
            let Some(params) =
                params.and_then(|params| serde_json::from_value::<CallParams>(params.clone()).ok())
            else {
                return rpc_error(id, -32602, "Invalid tool call").into_response();
            };
            if params.name != INVENTORY_LOW_STOCK_TOOL {
                return rpc_error(id, -32602, "Unknown tool").into_response();
            }
            match call_inventory(state, authority, bearer, &grant, params.arguments).await {
                Ok(payload) => json!({
                    "content": [{"type": "text", "text": payload.to_string()}],
                    "structuredContent": payload
                }),
                Err(error) => inventory_error(error),
            }
        }
        _ => return rpc_error(id, -32601, "Method not found").into_response(),
    };
    Json(json!({"jsonrpc": "2.0", "id": id, "result": result})).into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CallParams {
    name: String,
    #[serde(default)]
    arguments: Value,
    #[serde(rename = "_meta")]
    _meta: Option<Value>,
}

async fn may_list_inventory(state: &AppState, grant: &RunnerMcpGrant) -> AppResult<bool> {
    let Ok(scope) = grant.inventory_attempt() else {
        return Ok(false);
    };
    match scope.require_access(state).await {
        Ok(()) => Ok(true),
        Err(SkillAccessError::Denied) => Ok(false),
        Err(error) => Err(error.into()),
    }
}

async fn call_inventory(
    state: &AppState,
    authority: &dyn RunnerMcpAuthority,
    bearer: &str,
    grant: &RunnerMcpGrant,
    arguments: Value,
) -> AppResult<Value> {
    let scope = grant.inventory_attempt()?;
    let evidence = inventory_low_stock(state, &scope, arguments).await?;
    let payload = evidence.tool_result()?;
    authority.store_evidence(bearer, grant, evidence).await?;
    Ok(payload)
}

fn inventory_error(error: AppError) -> Value {
    let message = match error {
        AppError::BadRequest(_) => "Invalid inventory tool arguments",
        AppError::Forbidden(_) | AppError::NotFound(_) => "Inventory read was denied",
        _ => "Inventory read is unavailable",
    };
    json!({"isError": true, "content": [{"type": "text", "text": message}]})
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let mut values = headers.get_all(AUTHORIZATION).iter();
    let (scheme, token) = values.next()?.to_str().ok()?.split_once(' ')?;
    if values.next().is_some()
        || !scheme.eq_ignore_ascii_case("bearer")
        || token.is_empty()
        || token.len() > MAX_BEARER_BYTES
        || !token.bytes().all(|byte| byte.is_ascii_graphic())
    {
        return None;
    }
    Some(token)
}

fn unauthorized() -> Response {
    (StatusCode::UNAUTHORIZED, [(WWW_AUTHENTICATE, "Bearer")]).into_response()
}

fn valid_protocol(value: &HeaderValue) -> bool {
    value
        .to_str()
        .is_ok_and(|value| SUPPORTED_VERSIONS.contains(&value))
}

fn accepts_json(headers: &HeaderMap) -> bool {
    headers.get_all(ACCEPT).iter().any(|value| {
        value.to_str().is_ok_and(|value| {
            value.split(',').any(|range| {
                matches!(
                    range.split(';').next().map(str::trim),
                    Some("application/json" | "application/*" | "*/*")
                )
            })
        })
    })
}

fn rpc_bad_request(message: &'static str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        rpc_error(&Value::Null, -32600, message),
    )
        .into_response()
}

fn rpc_error(id: &Value, code: i32, message: &'static str) -> Json<Value> {
    Json(json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routes::runner_inventory::{
        candidate_evidence_id, tests::inventory_fixture, verify_inventory_candidate,
    };
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    };

    const BEARER: &str = "runner-tool-credential";

    struct FixtureRunner {
        lease: Mutex<Option<RunnerMcpGrant>>,
        saved: Mutex<Option<String>>,
        revoke_on_write: AtomicBool,
    }

    impl FixtureRunner {
        fn new() -> Self {
            Self {
                lease: Mutex::new(Some(RunnerMcpGrant {
                    actor: ActorContext::new(&"a".repeat(64), "test-session", 7, 9).unwrap(),
                    privacy_policy: OrgPrivacyPolicy::default(),
                    run_id: 4,
                    attempt_id: "attempt-one".into(),
                    device_id: "device-one".into(),
                    lease_id: "lease-one".into(),
                    allowed_tools: vec![INVENTORY_LOW_STOCK_TOOL.into()],
                })),
                saved: Mutex::new(None),
                revoke_on_write: AtomicBool::new(false),
            }
        }
    }

    #[async_trait]
    impl RunnerMcpAuthority for FixtureRunner {
        async fn authorize(&self, bearer: &str) -> AppResult<RunnerMcpGrant> {
            assert!(!bearer.is_empty());
            self.lease
                .lock()
                .unwrap()
                .clone()
                .filter(|_| bearer == BEARER)
                .ok_or_else(|| AppError::Forbidden("inactive lease".into()))
        }

        async fn store_evidence(
            &self,
            bearer: &str,
            grant: &RunnerMcpGrant,
            evidence: LowStockEvidence,
        ) -> AppResult<()> {
            let mut lease = self.lease.lock().unwrap();
            if self.revoke_on_write.load(Ordering::Relaxed) {
                *lease = None;
            }
            if bearer != BEARER
                || !lease.as_ref().is_some_and(|current| {
                    current.run_id == grant.run_id
                        && current.attempt_id == grant.attempt_id
                        && current.device_id == grant.device_id
                        && current.lease_id == grant.lease_id
                        && current.actor == grant.actor
                        && current.allowed_tools == grant.allowed_tools
                })
            {
                return Err(AppError::Forbidden("inactive lease".into()));
            }
            *self.saved.lock().unwrap() = Some(evidence.encode_stored()?);
            Ok(())
        }
    }

    async fn serve(
        state: AppState,
        authority: Arc<FixtureRunner>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}{}", listener.local_addr().unwrap(), MCP_PATH);
        let app = router(authority).with_state(state);
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (endpoint, task)
    }

    fn post(client: &reqwest::Client, endpoint: &str) -> reqwest::RequestBuilder {
        client
            .post(endpoint)
            .header(ACCEPT, "application/json, text/event-stream")
            .bearer_auth(BEARER)
    }

    async fn rpc(client: &reqwest::Client, endpoint: &str, request: Value) -> Value {
        let response = post(client, endpoint).json(&request).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
        assert_eq!(response.headers()[CONTENT_TYPE], "application/json");
        let reply: Value = response.json().await.unwrap();
        assert_eq!(reply["jsonrpc"], "2.0");
        assert_eq!(reply["id"], request["id"]);
        reply
    }

    fn low_stock_call(arguments: Value) -> Value {
        json!({
            "jsonrpc": "2.0", "id": "low-stock", "method": "tools/call",
            "params": {"name": INVENTORY_LOW_STOCK_TOOL, "arguments": arguments}
        })
    }

    #[tokio::test]
    async fn fixture_runner_gets_only_scoped_inventory_and_reusable_verified_evidence() {
        let (state, (actor_revoked, reads), inventory) = inventory_fixture().await;
        let authority = Arc::new(FixtureRunner::new());
        let (endpoint, server) = serve(state.clone(), Arc::clone(&authority)).await;
        let client = reqwest::Client::new();

        let init = rpc(
            &client,
            &endpoint,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18", "capabilities": {},
                    "clientInfo": {"name": "fixture", "version": "1"}
                }
            }),
        )
        .await;
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(init["result"]["capabilities"], json!({"tools": {}}));
        let initialized = post(&client, &endpoint)
            .header(PROTOCOL_HEADER, "2025-06-18")
            .json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
            .send()
            .await
            .unwrap();
        assert_eq!(initialized.status(), StatusCode::ACCEPTED);
        assert!(initialized.bytes().await.unwrap().is_empty());

        let list = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"});
        let discovered = rpc(&client, &endpoint, list.clone()).await;
        assert_eq!(
            discovered["result"]["tools"],
            json!([inventory_tool_definition()])
        );
        let foreign = rpc(
            &client,
            &endpoint,
            low_stock_call(json!({
                "threshold": 5, "location_id": 8, "companyId": 4098
            })),
        )
        .await;
        assert_eq!(foreign["result"]["isError"], true);
        assert_eq!(reads.load(Ordering::Relaxed), 0);

        let reply = rpc(
            &client,
            &endpoint,
            low_stock_call(json!({
                "threshold": 5, "location_id": 8
            })),
        )
        .await;
        let result = &reply["result"]["structuredContent"];
        assert_eq!(
            result["items"],
            json!([{
                "productId": "42", "name": "Test Product", "quantityOnHand": 3.0
            }])
        );
        assert_eq!(
            serde_json::from_str::<Value>(reply["result"]["content"][0]["text"].as_str().unwrap())
                .unwrap(),
            *result
        );
        let serialized = reply.to_string();
        for excluded in [BEARER, "test-session", "organizationId", "companyId", "ABC"] {
            assert!(!serialized.contains(excluded));
        }

        let candidate =
            json!({"evidenceId": result["evidenceId"], "productIds": ["42"]}).to_string();
        let persisted = authority.saved.lock().unwrap().take().unwrap();
        let recovered = LowStockEvidence::decode_stored(&persisted).unwrap();
        assert_eq!(candidate_evidence_id(&candidate).unwrap(), recovered.id());
        let grant = authority.authorize(BEARER).await.unwrap();
        let scope = grant.inventory_attempt().unwrap();
        let readback = verify_inventory_candidate(&state, &scope, &recovered, &candidate)
            .await
            .unwrap();
        let verified = serde_json::to_value(readback).unwrap();
        assert_eq!(
            verified["sources"][0]["href"],
            "/products?tab=products&filter=id%3A42"
        );
        assert!(verified["answer"].as_str().unwrap().contains("3 on hand"));

        actor_revoked.store(true, Ordering::Relaxed);
        let undiscoverable = rpc(&client, &endpoint, list).await;
        assert_eq!(undiscoverable["result"]["tools"], json!([]));
        let denied = rpc(
            &client,
            &endpoint,
            low_stock_call(json!({
                "threshold": 5, "location_id": 8
            })),
        )
        .await;
        assert_eq!(denied["result"]["isError"], true);
        assert_eq!(reads.load(Ordering::Relaxed), 4);
        assert!(authority.saved.lock().unwrap().is_none());

        server.abort();
        inventory.abort();
    }

    #[tokio::test]
    async fn denies_browser_origins_invalid_protocol_and_revocation_during_a_read() {
        let (state, (_, reads), inventory) = inventory_fixture().await;
        let authority = Arc::new(FixtureRunner::new());
        let (endpoint, server) = serve(state, Arc::clone(&authority)).await;
        let client = reqwest::Client::new();
        let ping = json!({"jsonrpc":"2.0", "id":1, "method":"ping"});

        let origin = post(&client, &endpoint)
            .header(ORIGIN, "https://lumiere.invalid")
            .json(&ping)
            .send()
            .await
            .unwrap();
        assert_eq!(origin.status(), StatusCode::FORBIDDEN);
        let missing_bearer = client
            .post(&endpoint)
            .header(ACCEPT, "application/json, text/event-stream")
            .json(&ping)
            .send()
            .await
            .unwrap();
        assert_eq!(missing_bearer.status(), StatusCode::UNAUTHORIZED);
        let invalid_version = post(&client, &endpoint)
            .header(PROTOCOL_HEADER, "unsupported")
            .json(&ping)
            .send()
            .await
            .unwrap();
        assert_eq!(invalid_version.status(), StatusCode::BAD_REQUEST);
        let get = client.get(&endpoint).send().await.unwrap();
        assert_eq!(get.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(get.headers()[ALLOW], "POST");

        authority.revoke_on_write.store(true, Ordering::Relaxed);
        let call = low_stock_call(json!({"threshold": 5, "location_id": 8}));
        let reply = rpc(&client, &endpoint, call.clone()).await;
        assert_eq!(reads.load(Ordering::Relaxed), 2);
        assert_eq!(reply["result"]["isError"], true);
        assert!(reply["result"].get("structuredContent").is_none());
        assert!(authority.saved.lock().unwrap().is_none());
        let next = post(&client, &endpoint).json(&call).send().await.unwrap();
        assert_eq!(next.status(), StatusCode::UNAUTHORIZED);

        server.abort();
        inventory.abort();
    }
}
