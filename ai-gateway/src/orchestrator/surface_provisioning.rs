//! Explicit, create-only setup for the bundled generation surface catalog.
//! Existing catalog identities and activation decisions remain authoritative.
//! Catalog registration does not configure agents, policies, or execution grants.

use anyhow::{ensure, Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use stdb_client::{ReducerCall, StdbClient, StdbClientError};

use super::skill_loader::sats_option;

const GENERATION_SURFACES: [&str; 3] = [
    "rag_generation",
    "form_suggestion",
    "action_draft_generation",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SurfaceProvisioningStatus {
    Created,
    Existing,
    Inactive,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ProvisionedSurface {
    pub skill_key: String,
    pub skill_id: u64,
    pub status: SurfaceProvisioningStatus,
}

#[derive(Debug, Deserialize)]
struct CatalogSurface {
    id: u64,
    #[serde(alias = "organizationId")]
    organization_id: u64,
    #[serde(alias = "skillKey")]
    skill_key: String,
    #[serde(alias = "isActive")]
    is_active: bool,
}

impl CatalogSurface {
    fn provisioned(&self, created: bool) -> ProvisionedSurface {
        ProvisionedSurface {
            skill_key: self.skill_key.clone(),
            skill_id: self.id,
            status: if !self.is_active {
                SurfaceProvisioningStatus::Inactive
            } else if created {
                SurfaceProvisioningStatus::Created
            } else {
                SurfaceProvisioningStatus::Existing
            },
        }
    }
}

async fn read_catalog(reader: &StdbClient, organization_id: u64) -> Result<Vec<CatalogSurface>> {
    let rows = reader
        .query_sql(&format!(
            "SELECT id, organization_id, skill_key, is_active FROM ai_skill \
             WHERE (organization_id = {organization_id} OR organization_id = 0) \
             AND (skill_key = 'rag_generation' OR skill_key = 'form_suggestion' \
             OR skill_key = 'action_draft_generation') LIMIT 7"
        ))
        .await
        .context("read generation surface catalog")?;
    ensure!(rows.len() <= 6, "generation surface catalog is ambiguous");
    let rows = rows
        .into_iter()
        .map(serde_json::from_value::<CatalogSurface>)
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("generation surface catalog is incomplete")?;
    for (index, row) in rows.iter().enumerate() {
        ensure!(
            row.id > 0
                && [0, organization_id].contains(&row.organization_id)
                && GENERATION_SURFACES.contains(&row.skill_key.as_str()),
            "generation surface catalog scope is invalid"
        );
        ensure!(
            !rows[..index].iter().any(|previous| {
                previous.id == row.id
                    || (previous.organization_id == row.organization_id
                        && previous.skill_key == row.skill_key)
            }),
            "generation surface catalog is ambiguous"
        );
    }
    Ok(rows)
}

fn existing_surface<'a>(
    rows: &'a [CatalogSurface],
    organization_id: u64,
    skill_key: &str,
) -> Option<&'a CatalogSurface> {
    // Include inactive rows: setup must not reactivate or shadow a deliberate
    // disablement by installing a new organization-scoped copy.
    rows.iter()
        .find(|row| row.organization_id == organization_id && row.skill_key == skill_key)
        .or_else(|| {
            rows.iter()
                .find(|row| row.organization_id == 0 && row.skill_key == skill_key)
        })
}

fn create_surface(organization_id: u64, skill_key: &str) -> Result<ReducerCall> {
    let bundled = crate::skills::load_bundled_skill(skill_key)?
        .with_context(|| format!("bundled generation surface '{skill_key}' is missing"))?;
    ensure!(
        bundled.skill_key == skill_key,
        "bundled generation surface key differs from its package"
    );
    let payload = crate::skills::bundled_to_sync_payload(&bundled)?;
    ensure!(
        payload.prompt_template.len() <= 32_000,
        "bundled generation surface exceeds the catalog prompt limit"
    );
    Ok(stdb_client::reducer_call!(
        "create_ai_skill",
        json!([
            organization_id,
            {
                "skill_key": payload.skill_key,
                "name": payload.name,
                "description": sats_option(payload.description.map(Value::String)),
                "category": payload.category,
                "prompt_template": payload.prompt_template,
                "required_tools": payload.required_tools,
                "optional_tools": payload.optional_tools,
                "default_max_steps": payload.default_max_steps,
                "default_max_tool_calls": payload.default_max_tool_calls,
                "output_schema": sats_option(None),
                "config_schema": sats_option(None),
                "dataset_specs": sats_option(payload.dataset_specs.map(Value::String)),
                "allowed_action_drafts": payload.allowed_action_drafts,
                "is_active": true,
                "is_system": false,
                "metadata": sats_option(Some(Value::String(payload.metadata))),
            }
        ]),
    )?)
}

/// The writer reports only a confirmed create or an explicit duplicate. Any
/// other outcome stops setup before another create can be attempted.
#[async_trait]
pub(crate) trait SurfaceWriter: Sync {
    async fn create_surface(&self, skill_key: &str, create: ReducerCall) -> Result<bool>;
}

#[async_trait]
impl SurfaceWriter for StdbClient {
    async fn create_surface(&self, skill_key: &str, create: ReducerCall) -> Result<bool> {
        match self.call_reducer(create).await {
            Ok(()) => Ok(true),
            Err(error) => {
                let duplicate = error
                    .downcast_ref::<StdbClientError>()
                    .and_then(StdbClientError::response_body)
                    .is_some_and(|body| {
                        body.contains(&format!("skill_key '{skill_key}' already exists"))
                    });
                if duplicate {
                    Ok(false)
                } else {
                    Err(error)
                }
            }
        }
    }
}

/// Operator-owned bootstrap uses its configured native database credential.
/// Interactive API credentials must use the session-owning API writer instead.
pub(crate) async fn ensure_bundled_generation_surfaces(
    writer: &StdbClient,
    reader: &StdbClient,
    organization_id: u64,
) -> Result<Vec<ProvisionedSurface>> {
    provision_generation_surfaces(writer, reader, organization_id).await
}

/// Provision only missing catalog rows after the caller has authorized setup.
/// A failed write is never retried; an explicit duplicate recovers only after
/// reading the concurrently created organization row.
pub(super) async fn provision_generation_surfaces(
    writer: &impl SurfaceWriter,
    reader: &StdbClient,
    organization_id: u64,
) -> Result<Vec<ProvisionedSurface>> {
    ensure!(organization_id > 0, "organization_id must be nonzero");
    let mut catalog = read_catalog(reader, organization_id).await?;
    // Compile and validate every package before the first write.
    let creates = GENERATION_SURFACES
        .iter()
        .map(|key| Ok((*key, create_surface(organization_id, key)?)))
        .collect::<Result<Vec<_>>>()?;
    let mut result = Vec::with_capacity(GENERATION_SURFACES.len());
    for (skill_key, create) in creates {
        if let Some(row) = existing_surface(&catalog, organization_id, skill_key) {
            result.push(row.provisioned(false));
            continue;
        }
        let created = writer
            .create_surface(skill_key, create)
            .await
            .with_context(|| {
                format!(
                    "create generation surface '{skill_key}' failed; inspect setup before retrying"
                )
            })?;
        catalog = read_catalog(reader, organization_id)
            .await
            .context("verify generation surface registration")?;
        let row = catalog
            .iter()
            .find(|row| row.organization_id == organization_id && row.skill_key == skill_key)
            .with_context(|| {
                format!("generation surface '{skill_key}' registration is unconfirmed")
            })?;
        result.push(row.provisioned(created));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::State,
        http::{HeaderMap, StatusCode},
        response::{IntoResponse, Response},
        routing::{get, post},
        Json, Router,
    };
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Copy, Default)]
    enum Behavior {
        #[default]
        Success,
        ConcurrentCreate,
        WriteDenied,
        LostResponse,
        MissingReadback,
        ReadUnavailable,
        SessionDenied,
        SessionWrongOrganization,
        SessionWrongFieldScope,
        SessionWrongIdentity,
        SessionMissingCreatePermission,
        SessionOrganizationDeniesCreate,
        SessionMalformed,
        OperationScopeChanged,
        WrongOperationReceipt,
        DuplicatePermissionDenied,
        DuplicateWithoutReadback,
        RedirectCreate,
    }

    #[derive(Default)]
    struct Database {
        rows: Vec<Value>,
        writes: Vec<Value>,
        reads: usize,
        behavior: Behavior,
        policy: Option<Value>,
        governed_writes: usize,
        session_reads: usize,
        api_writes: Vec<Value>,
        redirect_url: String,
        company_config: Option<Value>,
        company_writes: Vec<Value>,
    }

    struct Fixture {
        database: Arc<Mutex<Database>>,
        client: StdbClient,
        server: tokio::task::JoinHandle<()>,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            self.server.abort();
        }
    }

    struct ApiFixture {
        native: Fixture,
        origin: String,
        server: tokio::task::JoinHandle<()>,
    }

    impl Drop for ApiFixture {
        fn drop(&mut self) {
            self.server.abort();
        }
    }

    impl ApiFixture {
        async fn state(&self) -> crate::state::AppState {
            use crate::routes::harness_descriptor::test_support;

            let mut config = test_support::config();
            config.stdb_host = self.native.client.base_url().into();
            config.stdb_module = "fixture".into();
            config.stdb_token = "administrator".into();
            config.api_server_url = Some(self.origin.clone());
            test_support::state(config).await
        }

        async fn setup(
            &self,
        ) -> crate::error::AppResult<Json<crate::routes::skills::ProvisionSurfacesResponse>>
        {
            use crate::routes::skills::{post_provision_surfaces, GatewayProvisionSurfacesRequest};

            post_provision_surfaces(
                State(self.state().await),
                Json(GatewayProvisionSurfacesRequest {
                    company_id: None,
                    org_id: 9,
                    stdb_token: "workos-api-credential".into(),
                }),
            )
            .await
        }
    }

    fn catalog_row(id: u64, organization: u64, key: &str, active: bool) -> Value {
        json!({
            "id": id,
            "organization_id": organization,
            "skill_key": key,
            "is_active": active,
            "prompt_template": "Existing administrator-owned prompt",
            "metadata": "Existing certification and config identity",
        })
    }

    async fn sql(
        State(database): State<Arc<Mutex<Database>>>,
        headers: HeaderMap,
        statement: String,
    ) -> Response {
        assert_eq!(headers["authorization"], "Bearer administrator");
        let mut database = database.lock().unwrap();
        database.reads += 1;
        if statement.contains("skill_key = 'report_analysis'") {
            assert!(statement.contains("organization_id = 9"));
            return Json(json!([{"schema":{"elements":[{"name":{"some":"id"}}]},"rows":[[55]]}]))
                .into_response();
        }
        if statement.contains("FROM ai_skill_config ") {
            assert!(statement.contains("organization_id = 9"));
            assert!(statement.contains("company_id = 7"));
            assert!(statement.contains("skill_id = 55"));
            let rows: Vec<_> = database
                .company_config
                .iter()
                .map(|c| vec![c["is_enabled"].clone(), c["config_json"].clone()])
                .collect();
            return Json(json!([{"schema":{"elements":[{"name":{"some":"is_enabled"}},{"name":{"some":"config_json"}}]},"rows":rows}])).into_response();
        }
        if statement.contains("FROM ai_intelligence_policy ") {
            assert!(statement.contains("organization_id = 9"));
            assert!(statement.contains("policy_key = 'pilot'"));
            assert!(statement.contains("policy_version = 1"));
            let columns = database
                .policy
                .as_ref()
                .and_then(Value::as_object)
                .map(|policy| policy.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            return Json(json!([{
                "schema": {"elements": columns.iter().map(|name| json!({"name": {"some": name}})).collect::<Vec<_>>()},
                "rows": database.policy.iter().map(|row| columns.iter().map(|column| row[column].clone()).collect::<Vec<_>>()).collect::<Vec<_>>(),
            }])).into_response();
        }
        assert!(statement
            .starts_with("SELECT id, organization_id, skill_key, is_active FROM ai_skill "));
        assert!(statement.contains("organization_id = 9 OR organization_id = 0"));
        assert!(
            !statement.contains("is_active ="),
            "inactive rows must be preserved"
        );
        if matches!(database.behavior, Behavior::ReadUnavailable) {
            return (StatusCode::SERVICE_UNAVAILABLE, "catalog unavailable").into_response();
        }
        let columns = ["id", "organization_id", "skill_key", "is_active"];
        let rows = database
            .rows
            .iter()
            .filter(|row| {
                [0, 9].contains(&row["organization_id"].as_u64().unwrap())
                    && GENERATION_SURFACES.contains(&row["skill_key"].as_str().unwrap())
            })
            .map(|row| {
                columns
                    .iter()
                    .map(|column| row[column].clone())
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        Json(json!([{
            "schema": {"elements": columns.map(|name| json!({"name": {"some": name}}))},
            "rows": rows,
        }]))
        .into_response()
    }

    async fn create(
        State(database): State<Arc<Mutex<Database>>>,
        headers: HeaderMap,
        Json(args): Json<Value>,
    ) -> Response {
        assert_eq!(headers["authorization"], "Bearer administrator");
        assert_eq!(args[0], 9);
        assert_eq!(args[1]["is_system"], false);
        assert_eq!(args[1]["is_active"], true);
        let key = args[1]["skill_key"].as_str().unwrap();
        assert!(GENERATION_SURFACES.contains(&key));
        let mut database = database.lock().unwrap();
        database.writes.push(args.clone());
        match database.behavior {
            Behavior::WriteDenied => {
                return (StatusCode::FORBIDDEN, "ai_skill:create denied").into_response();
            }
            Behavior::MissingReadback => return StatusCode::OK.into_response(),
            _ => {}
        }
        let id = 100 + database.writes.len() as u64;
        let concurrent = matches!(database.behavior, Behavior::ConcurrentCreate);
        let row = if concurrent {
            catalog_row(id, 9, key, false)
        } else {
            let mut row = args[1].clone();
            row["id"] = json!(id);
            row["organization_id"] = json!(9);
            row
        };
        database.rows.push(row);
        if concurrent {
            return (
                StatusCode::CONFLICT,
                format!("skill_key '{key}' already exists"),
            )
                .into_response();
        }
        if matches!(database.behavior, Behavior::LostResponse) {
            return (StatusCode::SERVICE_UNAVAILABLE, "write outcome unknown").into_response();
        }
        StatusCode::OK.into_response()
    }

    async fn configure_governed_defaults(
        State(database): State<Arc<Mutex<Database>>>,
        headers: HeaderMap,
        Json(args): Json<Value>,
    ) -> StatusCode {
        assert_eq!(headers["authorization"], "Bearer administrator");
        assert_eq!(args[0], 9);
        let mut database = database.lock().unwrap();
        assert!(
            database.policy.is_some(),
            "reviewed policy is a prerequisite"
        );
        assert!(GENERATION_SURFACES.iter().all(|key| database
            .rows
            .iter()
            .any(|row| row["organization_id"] == 9 && row["skill_key"] == *key)));
        database.governed_writes += 1;
        StatusCode::OK
    }

    async fn fixture(rows: Vec<Value>, behavior: Behavior) -> Fixture {
        let database = Arc::new(Mutex::new(Database {
            rows,
            behavior,
            ..Database::default()
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new()
            .route("/v1/database/fixture/sql", post(sql))
            .route("/v1/database/fixture/call/create_ai_skill", post(create))
            .route(
                "/v1/database/fixture/call/register_ai_decision_type",
                post(configure_governed_defaults),
            )
            .route(
                "/v1/database/fixture/call/register_ai_calibration_profile",
                post(configure_governed_defaults),
            )
            .with_state(database.clone());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Fixture {
            database,
            client: StdbClient::new(base, "fixture".into(), "administrator".into()),
            server,
        }
    }

    async fn api_session(
        State(database): State<Arc<Mutex<Database>>>,
        headers: HeaderMap,
    ) -> Response {
        assert_eq!(headers["authorization"], "Bearer workos-api-credential");
        let mut database = database.lock().unwrap();
        database.session_reads += 1;
        if matches!(database.behavior, Behavior::SessionDenied) {
            return (
                StatusCode::UNAUTHORIZED,
                "credential must not appear in errors",
            )
                .into_response();
        }
        let mut access = stdb_auth::FieldAccessContext {
            organization_id: 9,
            role_permissions: vec!["ai_skill:create".into()],
            identity_hex: "a".repeat(64),
            ..Default::default()
        };
        match database.behavior {
            Behavior::SessionWrongOrganization | Behavior::SessionWrongFieldScope => {
                access.organization_id = 10;
            }
            Behavior::SessionWrongIdentity => access.identity_hex = "b".repeat(64),
            Behavior::SessionMissingCreatePermission => {
                access.role_permissions = vec!["ai_skill:read".into()];
            }
            Behavior::SessionOrganizationDeniesCreate => {
                access.org_permissions = vec![stdb_auth::ActionPermission {
                    resource: "ai_skill".into(),
                    action: "create".into(),
                    allow: false,
                }];
            }
            Behavior::SessionMalformed => {
                return Json(json!({"organizationId": 9})).into_response()
            }
            _ => {}
        }
        Json(json!({
            "identityHex": "a".repeat(64),
            "organizationId": if matches!(database.behavior, Behavior::SessionWrongOrganization) { 10 } else { 9 },
            "fieldAccess": access,
        }))
        .into_response()
    }

    async fn api_create(
        State(database): State<Arc<Mutex<Database>>>,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> Response {
        assert_eq!(headers["authorization"], "Bearer workos-api-credential");
        assert_eq!(headers["x-stdb-identity"], "a".repeat(64));
        assert_eq!(headers[lumiere_auth_context::ORGANIZATION_HEADER], "9");
        assert_eq!(body.as_object().unwrap().len(), 1);
        let params = &body["params"];
        assert_eq!(params["is_system"], false);
        assert_eq!(params["is_active"], true);
        let key = params["skill_key"].as_str().unwrap();
        assert!(GENERATION_SURFACES.contains(&key));
        let mut database = database.lock().unwrap();
        database.api_writes.push(body.clone());
        let duplicate = json!({"error": format!("skill_key '{key}' already exists")});
        let receipt = json!({
            "ok": true, "operationId": "erp.create_ai_skill", "correlationId": "receipt-1"
        });
        match database.behavior {
            Behavior::WriteDenied | Behavior::OperationScopeChanged => {
                return (
                    StatusCode::FORBIDDEN,
                    Json(
                        json!({"error": "credential and private upstream detail must be redacted"}),
                    ),
                )
                    .into_response();
            }
            Behavior::DuplicatePermissionDenied => {
                return (StatusCode::FORBIDDEN, Json(duplicate)).into_response();
            }
            Behavior::DuplicateWithoutReadback => {
                return (StatusCode::UNPROCESSABLE_ENTITY, Json(duplicate)).into_response();
            }
            Behavior::MissingReadback => return Json(receipt).into_response(),
            Behavior::RedirectCreate => {
                return (
                    StatusCode::TEMPORARY_REDIRECT,
                    [("location", database.redirect_url.clone())],
                )
                    .into_response();
            }
            _ => {}
        }
        let id = 100 + database.api_writes.len() as u64;
        let concurrent = matches!(database.behavior, Behavior::ConcurrentCreate);
        let row = if concurrent {
            catalog_row(id, 9, key, false)
        } else {
            let mut row = params.clone();
            row["id"] = json!(id);
            row["organization_id"] = json!(9);
            row
        };
        database.rows.push(row);
        match database.behavior {
            Behavior::ConcurrentCreate => {
                (StatusCode::UNPROCESSABLE_ENTITY, Json(duplicate)).into_response()
            }
            Behavior::LostResponse => {
                (StatusCode::SERVICE_UNAVAILABLE, "outcome unknown").into_response()
            }
            Behavior::WrongOperationReceipt => Json(json!({
                "ok": true, "operationId": "erp.update_ai_skill", "correlationId": "receipt-1"
            }))
            .into_response(),
            _ => Json(receipt).into_response(),
        }
    }

    async fn api_company_defaults(
        State(database): State<Arc<Mutex<Database>>>,
        headers: HeaderMap,
        Json(payload): Json<Value>,
    ) -> Response {
        assert_eq!(headers["authorization"], "Bearer workos-api-credential");
        assert_eq!(headers[lumiere_auth_context::ORGANIZATION_HEADER], "9");
        assert_eq!(
            payload,
            json!({"companyId":7,"agentId":42,"intelligencePolicyRef":"pilot@1"})
        );
        database.lock().unwrap().company_writes.push(payload);
        Json(json!({"ok":true,"operationId":"erp.provision_ai_company_defaults","correlationId":"setup-1"})).into_response()
    }

    async fn api_fixture(rows: Vec<Value>, behavior: Behavior) -> ApiFixture {
        let native = fixture(rows, behavior).await;
        native.database.lock().unwrap().redirect_url = format!(
            "{}/v1/database/fixture/call/create_ai_skill",
            native.client.base_url()
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new()
            .route("/v1/session/field-access", get(api_session))
            .route("/v1/operations/erp.create_ai_skill", post(api_create))
            .route(
                "/v1/operations/erp.provision_ai_company_defaults",
                post(api_company_defaults),
            )
            .with_state(native.database.clone());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        ApiFixture {
            native,
            origin,
            server,
        }
    }

    #[tokio::test]
    async fn company_setup_reuses_only_enabled_approved_binding() {
        use crate::routes::skills::{post_provision_surfaces, GatewayProvisionSurfacesRequest};
        for (config, expected, writes) in [
            (
                Some(
                    json!({"is_enabled":true,"config_json":"{\"defaultAgentId\":42,\"intelligencePolicyRef\":\"pilot@1\"}"}),
                ),
                "configured",
                1,
            ),
            (
                Some(
                    json!({"is_enabled":false,"config_json":"{\"defaultAgentId\":42,\"intelligencePolicyRef\":\"pilot@1\"}"}),
                ),
                "profile_required",
                0,
            ),
            (None, "profile_required", 0),
        ] {
            let fixture = api_fixture(Vec::new(), Behavior::Success).await;
            fixture.native.database.lock().unwrap().company_config = config;
            let result = post_provision_surfaces(
                State(fixture.state().await),
                Json(GatewayProvisionSurfacesRequest {
                    org_id: 9,
                    company_id: Some(7),
                    stdb_token: "workos-api-credential".into(),
                }),
            )
            .await
            .unwrap();
            assert_eq!(
                serde_json::to_value(result.0).unwrap()["company_setup"]["status"],
                expected
            );
            assert_eq!(
                fixture.native.database.lock().unwrap().company_writes.len(),
                writes
            );
        }
        for (company_id, behavior) in [(0, Behavior::Success), (7, Behavior::SessionDenied)] {
            let fixture = api_fixture(Vec::new(), behavior).await;
            let result = post_provision_surfaces(
                State(fixture.state().await),
                Json(GatewayProvisionSurfacesRequest {
                    org_id: 9,
                    company_id: Some(company_id),
                    stdb_token: "workos-api-credential".into(),
                }),
            )
            .await;
            assert!(result.is_err());
            let db = fixture.native.database.lock().unwrap();
            assert_eq!(db.reads, 0);
            assert!(db.company_writes.is_empty());
            assert!(db.api_writes.is_empty());
        }
    }

    #[tokio::test]
    async fn missing_surfaces_are_created_once_with_confirmed_ids() {
        let fixture = fixture(Vec::new(), Behavior::Success).await;
        let first = ensure_bundled_generation_surfaces(&fixture.client, &fixture.client, 9)
            .await
            .expect("provision missing surfaces");
        assert_eq!(first.len(), 3);
        assert!(first.iter().all(
            |surface| surface.status == SurfaceProvisioningStatus::Created && surface.skill_id > 0
        ));
        let repeated = ensure_bundled_generation_surfaces(&fixture.client, &fixture.client, 9)
            .await
            .expect("repeat setup");
        assert!(repeated
            .iter()
            .all(|surface| surface.status == SurfaceProvisioningStatus::Existing));
        assert_eq!(
            first
                .iter()
                .map(|surface| surface.skill_id)
                .collect::<Vec<_>>(),
            repeated
                .iter()
                .map(|surface| surface.skill_id)
                .collect::<Vec<_>>()
        );
        let database = fixture.database.lock().unwrap();
        assert_eq!(
            database.writes.len(),
            3,
            "repeat setup must not mutate any row"
        );
        assert!(database.writes.iter().all(
            |args| args[1]["default_max_steps"] == 1 && args[1]["default_max_tool_calls"] == 1
        ));
    }

    #[tokio::test]
    async fn setup_preserves_system_ids_and_inactive_organization_overrides() {
        let rows = vec![
            catalog_row(11, 0, "rag_generation", true),
            catalog_row(12, 9, "form_suggestion", false),
            catalog_row(13, 0, "form_suggestion", true),
            catalog_row(14, 0, "action_draft_generation", false),
            catalog_row(15, 0, "report_analysis", true),
            catalog_row(16, 10, "rag_generation", true),
        ];
        let fixture = fixture(rows.clone(), Behavior::Success).await;
        let result = ensure_bundled_generation_surfaces(&fixture.client, &fixture.client, 9)
            .await
            .expect("preserve registered surfaces");
        assert_eq!(
            result
                .iter()
                .map(|surface| surface.skill_id)
                .collect::<Vec<_>>(),
            [11, 12, 14]
        );
        assert_eq!(
            result
                .iter()
                .map(|surface| surface.status)
                .collect::<Vec<_>>(),
            [
                SurfaceProvisioningStatus::Existing,
                SurfaceProvisioningStatus::Inactive,
                SurfaceProvisioningStatus::Inactive
            ]
        );
        let database = fixture.database.lock().unwrap();
        assert!(database.writes.is_empty());
        assert_eq!(database.rows, rows);
    }

    #[tokio::test]
    async fn concurrent_creation_is_read_back_without_overwriting_or_reactivating_it() {
        let fixture = fixture(
            vec![
                catalog_row(11, 0, "form_suggestion", true),
                catalog_row(12, 0, "action_draft_generation", true),
            ],
            Behavior::ConcurrentCreate,
        )
        .await;
        let result = ensure_bundled_generation_surfaces(&fixture.client, &fixture.client, 9)
            .await
            .expect("recover explicit duplicate");
        assert_eq!(result[0].skill_id, 101);
        assert_eq!(result[0].status, SurfaceProvisioningStatus::Inactive);
        let database = fixture.database.lock().unwrap();
        assert_eq!(database.writes.len(), 1);
        assert_eq!(
            database.rows[2],
            catalog_row(101, 9, "rag_generation", false)
        );
    }

    #[tokio::test]
    async fn failed_or_unconfirmed_writes_stop_without_retry_or_further_creates() {
        for behavior in [
            Behavior::WriteDenied,
            Behavior::LostResponse,
            Behavior::MissingReadback,
        ] {
            let fixture = fixture(Vec::new(), behavior).await;
            assert!(
                ensure_bundled_generation_surfaces(&fixture.client, &fixture.client, 9)
                    .await
                    .is_err()
            );
            assert_eq!(fixture.database.lock().unwrap().writes.len(), 1);
        }
    }

    #[tokio::test]
    async fn unreadable_or_ambiguous_catalogs_fail_before_writing() {
        for (rows, behavior) in [
            (Vec::new(), Behavior::ReadUnavailable),
            (
                vec![
                    catalog_row(11, 9, "rag_generation", true),
                    catalog_row(12, 9, "rag_generation", false),
                ],
                Behavior::Success,
            ),
        ] {
            let fixture = fixture(rows, behavior).await;
            assert!(
                ensure_bundled_generation_surfaces(&fixture.client, &fixture.client, 9)
                    .await
                    .is_err()
            );
            assert!(fixture.database.lock().unwrap().writes.is_empty());
        }
    }

    #[tokio::test]
    async fn admin_route_sends_workos_token_only_to_api_and_reads_with_native_credentials() {
        use crate::routes::skills::{post_provision_surfaces, GatewayProvisionSurfacesRequest};

        let fixture = api_fixture(Vec::new(), Behavior::Success).await;
        let state = fixture.state().await;
        let denied = post_provision_surfaces(
            State(state.clone()),
            Json(GatewayProvisionSurfacesRequest {
                company_id: None,
                org_id: 9,
                stdb_token: " \t ".into(),
            }),
        )
        .await;
        assert!(matches!(denied, Err(crate::error::AppError::Forbidden(_))));
        assert_eq!(fixture.native.database.lock().unwrap().reads, 0);
        assert_eq!(fixture.native.database.lock().unwrap().session_reads, 0);
        assert!(
            serde_json::from_value::<GatewayProvisionSurfacesRequest>(json!({"org_id": 9}))
                .is_err()
        );

        let Json(result) = post_provision_surfaces(
            State(state),
            Json(GatewayProvisionSurfacesRequest {
                company_id: None,
                org_id: 9,
                stdb_token: "workos-api-credential".into(),
            }),
        )
        .await
        .expect("explicit actor setup");
        assert_eq!(result.skills.len(), 3);
        assert_eq!(
            serde_json::to_value(result).unwrap()["skills"][0],
            json!({"skill_key": "rag_generation", "skill_id": 101, "status": "created"})
        );
        let repeated = fixture.setup().await.expect("authorized no-op setup");
        assert!(repeated
            .0
            .skills
            .iter()
            .all(|surface| surface.status == SurfaceProvisioningStatus::Existing));
        let database = fixture.native.database.lock().unwrap();
        assert_eq!(
            database.session_reads, 2,
            "even no-op setup must authorize the actor"
        );
        assert_eq!(database.api_writes.len(), 3);
        assert_eq!(database.reads, 5);
        assert!(
            database.writes.is_empty(),
            "interactive setup never uses a native writer"
        );
    }

    #[tokio::test]
    async fn interactive_setup_checks_session_scope_and_create_permission_before_catalog_reads() {
        for behavior in [
            Behavior::SessionDenied,
            Behavior::SessionWrongOrganization,
            Behavior::SessionWrongFieldScope,
            Behavior::SessionWrongIdentity,
            Behavior::SessionMissingCreatePermission,
            Behavior::SessionOrganizationDeniesCreate,
            Behavior::SessionMalformed,
        ] {
            let existing = GENERATION_SURFACES
                .iter()
                .enumerate()
                .map(|(index, key)| catalog_row(index as u64 + 1, 9, key, true))
                .collect();
            let fixture = api_fixture(existing, behavior).await;
            let error = fixture.setup().await.unwrap_err();
            if matches!(behavior, Behavior::SessionMalformed) {
                assert!(matches!(error, crate::error::AppError::Unavailable(_)));
            } else {
                assert!(matches!(error, crate::error::AppError::Forbidden(_)));
            }
            assert!(!error.to_string().contains("credential must not appear"));
            let database = fixture.native.database.lock().unwrap();
            assert_eq!(database.session_reads, 1);
            assert_eq!(database.reads, 0);
            assert!(database.api_writes.is_empty());
            assert!(database.writes.is_empty());
        }
    }

    #[tokio::test]
    async fn interactive_setup_requires_api_configuration_without_native_write_fallback() {
        use crate::routes::{
            harness_descriptor::test_support,
            skills::{post_provision_surfaces, GatewayProvisionSurfacesRequest},
        };

        let fixture = fixture(Vec::new(), Behavior::Success).await;
        let mut config = test_support::config();
        config.stdb_host = fixture.client.base_url().into();
        config.stdb_module = "fixture".into();
        config.stdb_token = "administrator".into();
        config.api_server_url = None;
        let result = post_provision_surfaces(
            State(test_support::state(config).await),
            Json(GatewayProvisionSurfacesRequest {
                company_id: None,
                org_id: 9,
                stdb_token: "workos-api-credential".into(),
            }),
        )
        .await;
        assert!(matches!(
            result,
            Err(crate::error::AppError::Unavailable(_))
        ));
        let database = fixture.database.lock().unwrap();
        assert_eq!(database.reads, 0);
        assert!(database.writes.is_empty());
    }

    #[tokio::test]
    async fn interactive_setup_preserves_existing_ids_and_explicit_duplicate_readback() {
        let fixture = api_fixture(
            vec![
                catalog_row(11, 0, "form_suggestion", false),
                catalog_row(12, 9, "action_draft_generation", true),
            ],
            Behavior::ConcurrentCreate,
        )
        .await;
        let Json(result) = fixture
            .setup()
            .await
            .expect("read back concurrent registration");
        assert_eq!(
            result
                .skills
                .iter()
                .map(|surface| surface.skill_id)
                .collect::<Vec<_>>(),
            [101, 11, 12]
        );
        assert_eq!(result.skills[0].status, SurfaceProvisioningStatus::Inactive);
        assert_eq!(result.skills[1].status, SurfaceProvisioningStatus::Inactive);
        let database = fixture.native.database.lock().unwrap();
        assert_eq!(database.api_writes.len(), 1);
        assert_eq!(database.reads, 2);
        assert!(database.writes.is_empty());
    }

    #[tokio::test]
    async fn interactive_setup_stops_on_denied_unknown_or_unconfirmed_writes() {
        for behavior in [
            Behavior::WriteDenied,
            Behavior::OperationScopeChanged,
            Behavior::DuplicatePermissionDenied,
            Behavior::LostResponse,
            Behavior::WrongOperationReceipt,
            Behavior::MissingReadback,
            Behavior::DuplicateWithoutReadback,
            Behavior::RedirectCreate,
        ] {
            let fixture = api_fixture(Vec::new(), behavior).await;
            let error = fixture.setup().await.unwrap_err();
            match behavior {
                Behavior::WriteDenied
                | Behavior::OperationScopeChanged
                | Behavior::DuplicatePermissionDenied => {
                    assert!(matches!(error, crate::error::AppError::Forbidden(_)));
                }
                Behavior::LostResponse
                | Behavior::WrongOperationReceipt
                | Behavior::RedirectCreate => {
                    assert!(matches!(error, crate::error::AppError::Unavailable(_)));
                }
                _ => {}
            }
            assert!(!error.to_string().contains("private upstream detail"));
            assert!(!error.to_string().contains("workos-api-credential"));
            if matches!(behavior, Behavior::RedirectCreate) {
                assert!(error.to_string().contains("HTTP 307"));
            }
            let database = fixture.native.database.lock().unwrap();
            assert_eq!(database.api_writes.len(), 1, "no retries or later creates");
            assert!(database.writes.is_empty());
            let readback_expected = matches!(
                behavior,
                Behavior::MissingReadback | Behavior::DuplicateWithoutReadback
            );
            assert_eq!(database.reads, if readback_expected { 2 } else { 1 });
        }
    }

    #[tokio::test]
    async fn governed_bootstrap_requires_policy_before_any_catalog_or_default_writes() {
        let fixture = fixture(Vec::new(), Behavior::Success).await;
        let result = super::super::governed_bootstrap::bootstrap_governed_intelligence(
            &fixture.client,
            &fixture.client,
            9,
            Some("pilot@1"),
        )
        .await;
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must be registered before governed bootstrap"));
        let database = fixture.database.lock().unwrap();
        assert_eq!(database.reads, 1, "only the policy should be read");
        assert!(database.writes.is_empty());
        assert_eq!(database.governed_writes, 0);
    }

    #[tokio::test]
    async fn governed_bootstrap_reports_confirmed_surface_ids_alongside_existing_defaults() {
        let fixture = fixture(Vec::new(), Behavior::Success).await;
        fixture.database.lock().unwrap().policy = Some(json!({
            "policy_key": "pilot", "policy_version": 1,
            "default_decision_profile": "primary@1", "default_reasoning_profile": "primary@1",
            "default_generation_profile": "primary@1", "default_review_profile": "review@1",
            "shadow_profiles": [], "decision_type_overrides_json": "{}", "fallback_profiles_json": "{}",
        }));
        let result = super::super::governed_bootstrap::bootstrap_governed_intelligence(
            &fixture.client,
            &fixture.client,
            9,
            Some("pilot@1"),
        )
        .await
        .expect("bootstrap with existing reviewed policy");
        let response = serde_json::to_value(result).unwrap();
        assert_eq!(response["organizationId"], 9);
        assert_eq!(response["intelligencePolicyRef"], "pilot@1");
        assert_eq!(response["decisionTypesRegistered"], true);
        assert_eq!(
            response["calibrationProfiles"],
            json!(["report-attention@1"])
        );
        assert_eq!(response["generationSkills"].as_array().unwrap().len(), 3);
        assert_eq!(
            response["generationSkills"][0],
            json!({"skill_key": "rag_generation", "skill_id": 101, "status": "created"})
        );
        let database = fixture.database.lock().unwrap();
        assert_eq!(database.writes.len(), 3);
        assert!(database.governed_writes > 1);
    }
}
