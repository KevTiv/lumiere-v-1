use std::time::Duration;

use anyhow::{bail, ensure, Context, Result};
use reqwest::{header::HeaderValue, Method, Url};
use serde::{de::DeserializeOwned, Serialize};

use crate::harness::ActorCredentials;

use super::protocol::{
    is_hash, DatasetEnvelope, DatasetHandle, DatasetIssueRequest, ExecutionEnvelope,
    ExecutionRequest, ExecutionSnapshot, SandboxScope, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
};

const CONTROLLER_TIMEOUT: Duration = Duration::from_secs(30);

/// The trusted controller endpoint is deployment configuration. This type is
/// never deserialized from a model request and deliberately has no Debug impl
/// because it owns service and per-request actor credentials. Neither is
/// serialized into a dataset, execution record, or guest runtime input.
pub(crate) struct SandboxControllerClient {
    http: reqwest::Client,
    base: Url,
    secret: HeaderValue,
    actor_identity: String,
    actor_identity_header: HeaderValue,
    actor_authorization: HeaderValue,
}

impl SandboxControllerClient {
    /// Construction itself is unavailable in an uncertified release, before
    /// configuration or HTTP transport can be used to dispatch customer data.
    pub(crate) fn for_release(
        endpoint: &str,
        secret: &str,
        actor: &ActorCredentials,
    ) -> Result<Self> {
        super::require_production_admission()?;
        Self::connect(endpoint, secret, actor)
    }

    fn connect(endpoint: &str, secret: &str, actor: &ActorCredentials) -> Result<Self> {
        let base = Url::parse(endpoint).context("sandbox controller endpoint is invalid")?;
        ensure!(
            matches!(base.scheme(), "http" | "https")
                && base.username().is_empty()
                && base.password().is_none()
                && base.query().is_none()
                && base.fragment().is_none()
                && base.path() == "/"
                && base.host_str().is_some(),
            "sandbox controller endpoint must be an origin without embedded credentials"
        );
        let host = base
            .host_str()
            .context("sandbox controller host is missing")?;
        ensure!(
            base.scheme() == "https"
                || matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1")
                || host.ends_with(".railway.internal"),
            "sandbox controller HTTP endpoint must use private networking or loopback"
        );
        ensure!(
            secret.len() >= 32 && secret.len() <= 256,
            "sandbox controller credential has an invalid length"
        );
        let mut secret = HeaderValue::from_str(secret)
            .map_err(|_| anyhow::anyhow!("sandbox controller credential is invalid"))?;
        secret.set_sensitive(true);
        let identity = actor.identity_hex.trim();
        let token = actor.stdb_token.trim();
        ensure!(
            !identity.is_empty()
                && identity.len() <= 256
                && identity.bytes().all(|byte| byte.is_ascii_graphic())
                && !token.is_empty()
                && token.len() <= 8192
                && token.bytes().all(|byte| byte.is_ascii_graphic()),
            "sandbox actor credentials are invalid"
        );
        let mut actor_identity_header = HeaderValue::from_str(identity)
            .map_err(|_| anyhow::anyhow!("sandbox actor credentials are invalid"))?;
        actor_identity_header.set_sensitive(true);
        let mut actor_authorization = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| anyhow::anyhow!("sandbox actor credentials are invalid"))?;
        actor_authorization.set_sensitive(true);
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(CONTROLLER_TIMEOUT)
            .build()
            .context("construct sandbox controller transport")?;
        Ok(Self {
            http,
            base,
            secret,
            actor_identity: identity.to_string(),
            actor_identity_header,
            actor_authorization,
        })
    }

    /// This client is per actor request, never a shared service-token proxy.
    /// A reused client must not acquire under different caller credentials.
    pub(super) fn ensure_actor(&self, actor: &ActorCredentials) -> Result<()> {
        ensure!(
            actor.identity_hex.trim() == self.actor_identity
                && self.actor_authorization.as_bytes()
                    == format!("Bearer {}", actor.stdb_token.trim()).as_bytes(),
            "sandbox controller actor binding mismatch"
        );
        Ok(())
    }

    fn ensure_scope(&self, scope: &SandboxScope) -> Result<()> {
        scope.validate()?;
        ensure!(
            scope.actor_identity == self.actor_identity,
            "sandbox controller actor binding mismatch"
        );
        Ok(())
    }

    pub(super) async fn issue_dataset(
        &self,
        request: &DatasetIssueRequest,
    ) -> Result<DatasetHandle> {
        request.validate()?;
        let result: DatasetEnvelope = self.post("v1/datasets", request, &request.scope).await?;
        result.dataset.validate_against(request)?;
        Ok(result.dataset)
    }

    pub(crate) async fn execute(
        &self,
        scope: SandboxScope,
        program: String,
        dataset_ids: Vec<String>,
        profile_ref: String,
    ) -> Result<ExecutionSnapshot> {
        super::require_production_admission()?;
        let request = ExecutionRequest::new(scope, program, dataset_ids, profile_ref)?;
        self.submit(&request).await
    }

    async fn submit(&self, request: &ExecutionRequest) -> Result<ExecutionSnapshot> {
        // No retry middleware: a connection failure may occur after dispatch.
        // The durable governed capability owner must inspect this exact key
        // before deciding whether any subsequent operation is safe.
        let envelope: ExecutionEnvelope =
            self.post("v1/executions", request, &request.scope).await?;
        envelope.execution.validate_against(request)?;
        Ok(envelope.execution)
    }

    pub(crate) async fn inspect(
        &self,
        scope: &SandboxScope,
        request_key: &str,
    ) -> Result<ExecutionSnapshot> {
        super::require_production_admission()?;
        self.inspect_bound(scope, request_key).await
    }

    async fn inspect_bound(
        &self,
        scope: &SandboxScope,
        request_key: &str,
    ) -> Result<ExecutionSnapshot> {
        self.ensure_scope(scope)?;
        ensure!(
            is_hash(request_key),
            "sandbox execution request key is invalid"
        );
        let path = format!("v1/executions/{request_key}");
        let url = self
            .base
            .join(&path)
            .context("construct sandbox inspection URL")?;
        let response = self
            .http
            .get(url)
            .header("x-lumiere-sandbox-secret", self.secret.clone())
            .header(
                reqwest::header::AUTHORIZATION,
                self.actor_authorization.clone(),
            )
            .header("x-stdb-identity", self.actor_identity_header.clone())
            .query(scope)
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("sandbox inspection transport failed"))?;
        let envelope: ExecutionEnvelope = decode(response).await?;
        envelope.execution.validate_metadata()?;
        ensure!(
            envelope.execution.scope == *scope && envelope.execution.request_key == request_key,
            "sandbox inspection scope or identity mismatch"
        );
        Ok(envelope.execution)
    }

    pub(crate) async fn cancel(
        &self,
        scope: &SandboxScope,
        request_key: &str,
    ) -> Result<ExecutionSnapshot> {
        super::require_production_admission()?;
        self.cancel_bound(scope, request_key).await
    }

    async fn cancel_bound(
        &self,
        scope: &SandboxScope,
        request_key: &str,
    ) -> Result<ExecutionSnapshot> {
        self.ensure_scope(scope)?;
        ensure!(
            is_hash(request_key),
            "sandbox execution request key is invalid"
        );
        #[derive(Serialize)]
        struct CancelRequest<'a> {
            scope: &'a SandboxScope,
        }
        let path = format!("v1/executions/{request_key}/cancel");
        let envelope: ExecutionEnvelope = self.post(&path, &CancelRequest { scope }, scope).await?;
        envelope.execution.validate_metadata()?;
        ensure!(
            envelope.execution.scope == *scope && envelope.execution.request_key == request_key,
            "sandbox cancellation scope or identity mismatch"
        );
        Ok(envelope.execution)
    }

    async fn post<T: Serialize, R: DeserializeOwned>(
        &self,
        path: &str,
        value: &T,
        scope: &SandboxScope,
    ) -> Result<R> {
        self.ensure_scope(scope)?;
        let bytes = serde_json::to_vec(value).context("serialize sandbox controller request")?;
        ensure!(
            bytes.len() <= MAX_REQUEST_BYTES,
            "sandbox controller request byte limit exceeded"
        );
        let url = self
            .base
            .join(path)
            .context("construct sandbox controller URL")?;
        let response = self.http.request(Method::POST, url)
            .header("x-lumiere-sandbox-secret", self.secret.clone())
            .header(reqwest::header::AUTHORIZATION, self.actor_authorization.clone())
            .header("x-stdb-identity", self.actor_identity_header.clone())
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(bytes)
            .send().await
            .map_err(|_| anyhow::anyhow!("sandbox controller transport failed; reconcile the existing request before redispatch"))?;
        decode(response).await
    }
}

async fn decode<R: DeserializeOwned>(mut response: reqwest::Response) -> Result<R> {
    if !response.status().is_success() {
        // Do not print controller response bodies, which may contain guest
        // diagnostics or private input. Status is enough to fail closed.
        bail!(
            "sandbox controller request was denied or unavailable ({})",
            response.status()
        );
    }
    ensure!(
        response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value
                .split(';')
                .next()
                .is_some_and(|mime| mime.trim() == "application/json")),
        "sandbox controller returned an unexpected content type"
    );
    ensure!(
        response
            .content_length()
            .is_none_or(|length| length <= MAX_RESPONSE_BYTES as u64),
        "sandbox controller response byte limit exceeded"
    );
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| anyhow::anyhow!("sandbox controller response was interrupted"))?
    {
        ensure!(
            bytes.len().saturating_add(chunk.len()) <= MAX_RESPONSE_BYTES,
            "sandbox controller response byte limit exceeded"
        );
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| anyhow::anyhow!("sandbox controller returned an invalid protocol response"))
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use axum::{
        http::{HeaderMap, StatusCode},
        routing::{get, post},
        Json, Router,
    };
    use serde_json::{json, Value};
    use sha2::Digest;

    use super::*;

    fn scope() -> SandboxScope {
        SandboxScope {
            actor_identity: "actor-a".into(),
            organization_id: "1".into(),
            company_id: "2".into(),
            run_id: "3".into(),
            policy_generation: "a".repeat(64),
        }
    }

    fn actor() -> ActorCredentials {
        ActorCredentials {
            stdb_token: "synthetic-actor-token".into(),
            identity_hex: "actor-a".into(),
        }
    }

    fn assert_actor_headers(headers: &HeaderMap) {
        assert_eq!(headers["x-lumiere-sandbox-secret"], "s".repeat(32));
        assert_eq!(headers["authorization"], "Bearer synthetic-actor-token");
        assert_eq!(headers["x-stdb-identity"], "actor-a");
    }

    async fn server(router: Router) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        (format!("http://{address}/"), task)
    }

    fn request() -> ExecutionRequest {
        ExecutionRequest::new(
            scope(),
            "1 + 1".into(),
            vec![format!("ds_{}", "a".repeat(32))],
            "js-v1".into(),
        )
        .unwrap()
    }

    #[test]
    fn endpoint_configuration_cannot_embed_credentials_or_redirect_identity() {
        let secret = "s".repeat(32);
        for url in [
            "http://public.example/",
            "https://user:pass@example.com/",
            "https://example.com/?token=secret",
            "https://example.com/#part",
            "https://example.com/path",
        ] {
            assert!(
                SandboxControllerClient::connect(url, &secret, &actor()).is_err(),
                "accepted {url}"
            );
        }
        assert!(SandboxControllerClient::for_release(
            "https://controller.example/",
            &secret,
            &actor()
        )
        .is_err());
    }

    #[tokio::test]
    async fn submitted_identity_and_scope_are_verified() {
        let app = Router::new().route("/v1/executions", post(|headers: HeaderMap, Json(body): Json<Value>| async move {
            assert_actor_headers(&headers);
            Json(json!({"execution":{
                "requestKey":body["requestKey"],"status":"completed","scope":body["scope"],"profileRef":body["profileRef"],
                "programHash": format!("{:x}", sha2::Sha256::digest(body["program"].as_str().unwrap().as_bytes())),
                "datasetIds":body["datasetIds"],"createdAt":"2026-10-28T12:00:00Z","updatedAt":"2026-10-28T12:00:01Z",
                "evidence":[],"artifacts":[]
            }}))
        }));
        let (url, task) = server(app).await;
        let client = SandboxControllerClient::connect(&url, &"s".repeat(32), &actor()).unwrap();
        let input = request();
        assert_eq!(client.submit(&input).await.unwrap().scope, input.scope);
        task.abort();
    }

    #[tokio::test]
    async fn foreign_scope_and_private_diagnostic_body_fail_closed() {
        let app = Router::new().route("/v1/executions", post(|Json(body): Json<Value>| async move {
            let mut scope = body["scope"].clone();
            scope["companyId"] = json!("999");
            Json(json!({"execution":{
                "requestKey":body["requestKey"],"status":"completed","scope":scope,"profileRef":body["profileRef"],
                "programHash": format!("{:x}", sha2::Sha256::digest(body["program"].as_str().unwrap().as_bytes())),
                "datasetIds":body["datasetIds"],"createdAt":"2026-10-28T12:00:00Z","updatedAt":"2026-10-28T12:00:01Z"
            }}))
        }));
        let (url, task) = server(app).await;
        let client = SandboxControllerClient::connect(&url, &"s".repeat(32), &actor()).unwrap();
        assert!(client
            .submit(&request())
            .await
            .unwrap_err()
            .to_string()
            .contains("scope substitution"));
        task.abort();

        let app = Router::new().route(
            "/v1/executions",
            post(|| async { (StatusCode::SERVICE_UNAVAILABLE, "PRIVATE-TENANT-ROW") }),
        );
        let (url, task) = server(app).await;
        let client = SandboxControllerClient::connect(&url, &"s".repeat(32), &actor()).unwrap();
        let error = client.submit(&request()).await.unwrap_err().to_string();
        assert!(!error.contains("PRIVATE-TENANT-ROW"));
        task.abort();
    }

    #[tokio::test]
    async fn redirects_never_redispatch_programs_or_credentials() {
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let app = Router::new()
            .route(
                "/v1/executions",
                post(|| async { (StatusCode::TEMPORARY_REDIRECT, [("location", "/forbidden")]) }),
            )
            .route(
                "/forbidden",
                post(move || {
                    let observed = observed.clone();
                    async move {
                        observed.fetch_add(1, Ordering::SeqCst);
                        Json(json!({}))
                    }
                }),
            );
        let (url, task) = server(app).await;
        let client = SandboxControllerClient::connect(&url, &"s".repeat(32), &actor()).unwrap();
        assert!(client.submit(&request()).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        task.abort();
    }

    #[tokio::test]
    async fn oversized_controller_payload_is_rejected_before_protocol_parse() {
        let app = Router::new().route(
            "/v1/executions",
            post(|| async { Json(json!({"private": "x".repeat(MAX_RESPONSE_BYTES)})) }),
        );
        let (url, task) = server(app).await;
        let client = SandboxControllerClient::connect(&url, &"s".repeat(32), &actor()).unwrap();
        assert!(client
            .submit(&request())
            .await
            .unwrap_err()
            .to_string()
            .contains("byte limit"));
        task.abort();
    }

    #[tokio::test]
    async fn actor_binding_rejects_scope_or_token_substitution_before_transport() {
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let app = Router::new().route(
            "/v1/executions",
            post(move || {
                let observed = observed.clone();
                async move {
                    observed.fetch_add(1, Ordering::SeqCst);
                    Json(json!({}))
                }
            }),
        );
        let (url, task) = server(app).await;
        let client = SandboxControllerClient::connect(&url, &"s".repeat(32), &actor()).unwrap();
        assert!(client.ensure_actor(&actor()).is_ok());
        let mut changed_actor = actor();
        changed_actor.stdb_token = "different-actor-token".into();
        assert!(client.ensure_actor(&changed_actor).is_err());
        changed_actor = actor();
        changed_actor.identity_hex = "actor-b".into();
        assert!(client.ensure_actor(&changed_actor).is_err());
        let mut altered = request();
        altered.scope.actor_identity = "actor-b".into();
        assert!(client.submit(&altered).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(client.actor_authorization.is_sensitive());
        assert!(client.actor_identity_header.is_sensitive());
        assert!(client.secret.is_sensitive());
        task.abort();
    }

    #[tokio::test]
    async fn dataset_issue_inspect_and_cancel_forward_only_header_credentials() {
        let input = request();
        let snapshot = json!({"execution":{
            "requestKey":input.request_key,"status":"completed","scope":input.scope,"profileRef":input.profile_ref,
            "programHash":format!("{:x}", sha2::Sha256::digest(input.program.as_bytes())),
            "datasetIds":input.dataset_ids,"createdAt":"2026-10-28T12:00:00Z","updatedAt":"2026-10-28T12:00:01Z"
        }});
        let inspection = snapshot.clone();
        let cancellation = snapshot;
        let app = Router::new()
            .route("/v1/datasets", post(|headers: HeaderMap, Json(body): Json<Value>| async move {
                assert_actor_headers(&headers);
                assert!(!body.to_string().contains("synthetic-actor-token"));
                Json(json!({"dataset":{
                    "id":format!("ds_{}", "a".repeat(32)),"schemaRef":body["schema"]["ref"],
                    "rowCount":0,"expiresAt":body["expiresAt"],"sourceCapabilities":body["sourceCapabilities"]
                }}))
            }))
            .route("/v1/executions/:key", get(move |headers: HeaderMap| {
                let inspection = inspection.clone();
                async move { assert_actor_headers(&headers); Json(inspection) }
            }))
            .route("/v1/executions/:key/cancel", post(move |headers: HeaderMap, Json(body): Json<Value>| {
                let cancellation = cancellation.clone();
                async move {
                    assert_actor_headers(&headers);
                    assert!(!body.to_string().contains("synthetic-actor-token"));
                    Json(cancellation)
                }
            }));
        let (url, task) = server(app).await;
        let client = SandboxControllerClient::connect(&url, &"s".repeat(32), &actor()).unwrap();
        let issue = DatasetIssueRequest {
            scope: scope(),
            schema: super::super::protocol::DatasetSchema {
                schema_ref: "finance-v1".into(),
                fields: vec![super::super::protocol::DatasetField {
                    name: "amount".into(),
                    kind: super::super::protocol::DatasetFieldType::Number,
                    nullable: false,
                }],
            },
            rows: vec![],
            expires_at: (chrono::Utc::now() + chrono::Duration::seconds(60)).to_rfc3339(),
            source_capabilities: vec!["finance.read".into()],
            watermark: None,
            provenance_ref: None,
        };
        client.issue_dataset(&issue).await.unwrap();
        client
            .inspect_bound(&input.scope, &input.request_key)
            .await
            .unwrap();
        client
            .cancel_bound(&input.scope, &input.request_key)
            .await
            .unwrap();
        task.abort();
    }
}
