//! Explicit, create-only setup for the bundled generation surface catalog.
//! Existing catalog identities and activation decisions remain authoritative.
//! Catalog registration does not configure agents, policies, or execution grants.

use anyhow::{ensure, Context, Result};
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

/// Provision only missing generation catalog rows during an explicit admin
/// operation. Native reducers recheck the writer's `ai_skill:create` authority.
/// A failed write is never retried; only an explicit duplicate can recover by
/// reading the concurrently created organization row.
pub(crate) async fn ensure_bundled_generation_surfaces(
    writer: &StdbClient,
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
        let created = match writer.call_reducer(create).await {
            Ok(()) => true,
            Err(error) => {
                let duplicate = error
                    .downcast_ref::<StdbClientError>()
                    .and_then(StdbClientError::response_body)
                    .is_some_and(|body| {
                        body.contains(&format!("skill_key '{skill_key}' already exists"))
                    });
                if !duplicate {
                    return Err(error).with_context(|| {
                        format!("create generation surface '{skill_key}' failed; inspect setup before retrying")
                    });
                }
                false
            }
        };
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
        routing::post,
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
    }

    #[derive(Default)]
    struct Database {
        rows: Vec<Value>,
        writes: Vec<Value>,
        reads: usize,
        behavior: Behavior,
        policy: Option<Value>,
        governed_writes: usize,
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
    async fn admin_route_requires_and_uses_actor_token_without_service_fallback() {
        use crate::routes::{
            harness_descriptor::test_support,
            skills::{post_provision_surfaces, GatewayProvisionSurfacesRequest},
        };

        let fixture = fixture(Vec::new(), Behavior::Success).await;
        let mut config = test_support::config();
        config.stdb_host = fixture.client.base_url().into();
        config.stdb_module = "fixture".into();
        config.stdb_token = "service-token-must-not-be-used".into();
        let state = test_support::state(config).await;
        let denied = post_provision_surfaces(
            State(state.clone()),
            Json(GatewayProvisionSurfacesRequest {
                org_id: 9,
                stdb_token: " \t ".into(),
            }),
        )
        .await;
        assert!(matches!(denied, Err(crate::error::AppError::Forbidden(_))));
        assert_eq!(fixture.database.lock().unwrap().reads, 0);
        assert!(
            serde_json::from_value::<GatewayProvisionSurfacesRequest>(json!({"org_id": 9}))
                .is_err()
        );

        let Json(result) = post_provision_surfaces(
            State(state),
            Json(GatewayProvisionSurfacesRequest {
                org_id: 9,
                stdb_token: "administrator".into(),
            }),
        )
        .await
        .expect("explicit actor setup");
        assert_eq!(result.skills.len(), 3);
        assert_eq!(
            serde_json::to_value(result).unwrap()["skills"][0],
            json!({"skill_key": "rag_generation", "skill_id": 101, "status": "created"})
        );
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
