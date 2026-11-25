//! Read-only low-stock capability for a locally hosted agent.
//!
//! Only the runner gateway may supply an authenticated attempt and privacy
//! policy. The wire tool and candidate contain neither customer credentials nor
//! scope. The gateway must revalidate the lease before sending results and
//! publishing the verified readback.

// The live runner mounts MCP only after wiring the durable lease authority.
#![allow(dead_code)]

use std::{collections::HashSet, fmt::Write};

use lumiere_auth_context::ActorContext;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    harness::{
        audit::DecisionOutcome,
        low_stock::{LowStockInput, LowStockItem, LOW_STOCK_RESOURCE, LOW_STOCK_SKILL_KEY},
        manifest::OrgPrivacyPolicy,
        snapshot::{fetch_authorized_live_snapshots, ActorCredentials, EntityRef},
    },
    orchestrator::skill_access::{ActorSkillAccess, SkillAccessError},
    state::AppState,
};

use super::inventory::run_scoped_low_stock;

pub(crate) const INVENTORY_LOW_STOCK_TOOL: &str = "inventory_low_stock";
const MAX_ATTEMPT_ID_BYTES: usize = 128;
const MAX_CANDIDATE_BYTES: usize = 8 * 1024;
const MAX_TOOL_RESULT_BYTES: usize = 48 * 1024;
const MAX_STORED_EVIDENCE_BYTES: usize = 128 * 1024;

/// Advertise the one named ERP read this module can perform.
pub(crate) fn inventory_tool_definition() -> Value {
    json!({
        "name": INVENTORY_LOW_STOCK_TOOL,
        "description": "Read current stock at or below a chosen threshold. Use the returned evidenceId to propose productIds in the final JSON answer.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "threshold": {"type": "number", "minimum": 0},
                "location_id": {"type": "integer", "minimum": 1}
            },
            "required": ["threshold"],
            "additionalProperties": false
        },
        "annotations": {
            "readOnlyHint": true,
            "destructiveHint": false,
            "idempotentHint": true,
            "openWorldHint": false
        }
    })
}

/// Trusted gateway-owned input. Construct after binding a current lease to the
/// authenticated browser actor and the explicitly granted inventory tool.
pub(crate) struct InventoryAttempt<'a> {
    actor: &'a ActorContext,
    privacy_policy: &'a OrgPrivacyPolicy,
    run_id: u64,
    attempt_id: &'a str,
}

impl<'a> InventoryAttempt<'a> {
    pub(crate) fn new(
        actor: &'a ActorContext,
        privacy_policy: &'a OrgPrivacyPolicy,
        run_id: u64,
        attempt_id: &'a str,
        allowed_tools: &[String],
    ) -> AppResult<Self> {
        if run_id == 0
            || attempt_id.trim().is_empty()
            || attempt_id.len() > MAX_ATTEMPT_ID_BYTES
            || !allowed_tools
                .iter()
                .any(|tool| tool == INVENTORY_LOW_STOCK_TOOL)
        {
            return Err(AppError::Forbidden(
                "inventory attempt is unauthorized".into(),
            ));
        }
        Ok(Self {
            actor,
            privacy_policy,
            run_id,
            attempt_id,
        })
    }

    pub(super) async fn require_access(&self, state: &AppState) -> Result<(), SkillAccessError> {
        ActorSkillAccess::new(
            state,
            self.actor.organization_id,
            self.actor.company_id,
            &self.actor.token,
            &self.actor.identity,
        )?
        .require(LOW_STOCK_SKILL_KEY)
        .await
    }
}

/// Retain only on the gateway. The transport cannot decode this internal
/// storage format from a client request.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LowStockEvidence {
    #[serde(
        serialize_with = "serialize_evidence_id",
        deserialize_with = "deserialize_evidence_id"
    )]
    id: Uuid,
    organization_id: u64,
    company_id: u64,
    identity_hex: String,
    run_id: u64,
    attempt_id: String,
    input: LowStockInput,
    items: Vec<LowStockItem>,
}

fn serialize_evidence_id<S: serde::Serializer>(
    id: &Uuid,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.collect_str(id)
}

fn deserialize_evidence_id<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Uuid, D::Error> {
    let id = String::deserialize(deserializer)?;
    Uuid::parse_str(&id).map_err(serde::de::Error::custom)
}

impl LowStockEvidence {
    fn new(scope: &InventoryAttempt<'_>, input: LowStockInput, items: Vec<LowStockItem>) -> Self {
        Self {
            id: Uuid::new_v4(),
            organization_id: scope.actor.organization_id,
            company_id: scope.actor.company_id,
            identity_hex: canonical_identity(&scope.actor.identity).to_ascii_lowercase(),
            run_id: scope.run_id,
            attempt_id: scope.attempt_id.to_owned(),
            input,
            items,
        }
    }

    pub(crate) fn id(&self) -> Uuid {
        self.id
    }

    /// Encode for the gateway's attempt evidence store.
    pub(crate) fn encode_stored(&self) -> AppResult<String> {
        let payload = serde_json::to_string(self)
            .map_err(|_| AppError::Unavailable("inventory evidence is unavailable".into()))?;
        if payload.len() > MAX_STORED_EVIDENCE_BYTES {
            return Err(AppError::Unavailable(
                "inventory evidence is too large".into(),
            ));
        }
        Ok(payload)
    }

    /// Decode only from a server-owned record scoped to the authenticated lease.
    pub(crate) fn decode_stored(payload: &str) -> AppResult<Self> {
        if payload.len() > MAX_STORED_EVIDENCE_BYTES {
            return Err(AppError::Unavailable(
                "inventory evidence is too large".into(),
            ));
        }
        serde_json::from_str(payload)
            .map_err(|_| AppError::Unavailable("inventory evidence is unavailable".into()))
    }

    /// Only the minimum approved fields and the evidence selector go to the CLI.
    pub(crate) fn tool_result(&self) -> AppResult<Value> {
        let items: Vec<_> = self
            .items
            .iter()
            .map(|item| {
                json!({
                    "productId": item.product_id.to_string(),
                    "name": item.name,
                    "quantityOnHand": item.quantity_on_hand
                })
            })
            .collect();
        let payload = json!({
            "evidenceId": self.id.to_string(),
            "capability": LOW_STOCK_RESOURCE,
            "threshold": self.input.threshold,
            "items": items,
        });
        if payload.to_string().len() > MAX_TOOL_RESULT_BYTES {
            return Err(AppError::Forbidden(
                "inventory tool result exceeds its size limit".into(),
            ));
        }
        Ok(payload)
    }

    fn validate_scope(&self, scope: &InventoryAttempt<'_>) -> AppResult<()> {
        if self.organization_id != scope.actor.organization_id
            || self.company_id != scope.actor.company_id
            || !self
                .identity_hex
                .eq_ignore_ascii_case(canonical_identity(&scope.actor.identity))
            || self.run_id != scope.run_id
            || self.attempt_id != scope.attempt_id
        {
            return Err(AppError::Forbidden(
                "inventory evidence is outside this attempt".into(),
            ));
        }
        Ok(())
    }
}

fn canonical_identity(identity: &str) -> &str {
    identity
        .strip_prefix("0x")
        .or_else(|| identity.strip_prefix("0X"))
        .unwrap_or(identity)
}

fn parse_arguments(arguments: Value) -> AppResult<LowStockInput> {
    let input: LowStockInput = serde_json::from_value(arguments)
        .map_err(|_| AppError::BadRequest("invalid inventory tool arguments".into()))?;
    if !input.threshold.is_finite() || input.threshold < 0.0 || input.location_id == Some(0) {
        return Err(AppError::BadRequest(
            "invalid inventory tool arguments".into(),
        ));
    }
    Ok(input)
}

async fn read_protected(
    state: &AppState,
    scope: &InventoryAttempt<'_>,
    input: LowStockInput,
) -> AppResult<Vec<LowStockItem>> {
    if let Some(location_id) = input.location_id {
        let actor = ActorCredentials::new(&scope.actor.token, &scope.actor.identity)
            .map_err(|_| AppError::Forbidden("inventory read was denied".into()))?;
        let location = EntityRef {
            entity_type: "stock_location".into(),
            entity_id: location_id,
            priority: 1.0,
        };
        let authorized = fetch_authorized_live_snapshots(
            state,
            &actor,
            scope.actor.organization_id,
            scope.actor.company_id,
            &[location],
        )
        .await
        .map_err(|_| AppError::Unavailable("inventory location is unavailable".into()))?;
        if authorized.is_empty() {
            return Err(AppError::Forbidden(
                "inventory location is unauthorized".into(),
            ));
        }
    }
    let scan = run_scoped_low_stock(state, scope.actor, input, scope.privacy_policy.clone())
        .await
        .map_err(|error| match error {
            AppError::Forbidden(_) => AppError::Forbidden("inventory read was denied".into()),
            _ => AppError::Unavailable("inventory read is unavailable".into()),
        })?;
    if scan.decision.decision.outcome != DecisionOutcome::Allow
        || scan.items.iter().any(|item| {
            item.organization_id != scope.actor.organization_id
                || item.company_id != scope.actor.company_id
        })
    {
        return Err(AppError::Forbidden("inventory read was denied".into()));
    }
    scope.require_access(state).await?;
    Ok(scan.items)
}

/// Run the existing governed skill as the active browser user.
pub(crate) async fn inventory_low_stock(
    state: &AppState,
    scope: &InventoryAttempt<'_>,
    arguments: Value,
) -> AppResult<LowStockEvidence> {
    let input = parse_arguments(arguments)?;
    let items = read_protected(state, scope, input.clone()).await?;
    Ok(LowStockEvidence::new(scope, input, items))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LowStockCandidate {
    evidence_id: String,
    product_ids: Vec<String>,
}

impl LowStockCandidate {
    fn parse(candidate: &str) -> AppResult<Self> {
        if candidate.len() > MAX_CANDIDATE_BYTES {
            return Err(AppError::BadRequest(
                "inventory candidate exceeds its size limit".into(),
            ));
        }
        serde_json::from_str(candidate)
            .map_err(|_| AppError::BadRequest("inventory candidate is malformed".into()))
    }
}

/// Read the opaque evidence selector. Verification also validates scope and
/// selected products against the gateway's retained inventory read.
pub(crate) fn candidate_evidence_id(candidate: &str) -> AppResult<Uuid> {
    let evidence_id = LowStockCandidate::parse(candidate)?.evidence_id;
    Uuid::parse_str(&evidence_id)
        .ok()
        .filter(|id| id.to_string() == evidence_id)
        .ok_or_else(|| AppError::BadRequest("inventory evidence ID is invalid".into()))
}

/// Server-authored text and direct record links for the verified reply. These
/// are live tool readbacks, with no claim of independent human review.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifiedLowStockReadback {
    answer: String,
    evidence_id: String,
    sources: Vec<LowStockSource>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LowStockSource {
    product_id: String,
    label: String,
    href: String,
}

fn selected_items<'a>(
    evidence: &'a LowStockEvidence,
    candidate: &str,
) -> AppResult<Vec<&'a LowStockItem>> {
    let candidate = LowStockCandidate::parse(candidate)?;
    if candidate.evidence_id != evidence.id.to_string()
        || candidate.product_ids.is_empty() != evidence.items.is_empty()
        || candidate.product_ids.len() > evidence.items.len()
    {
        return Err(AppError::Forbidden(
            "inventory candidate is unsupported".into(),
        ));
    }

    let mut seen = HashSet::new();
    candidate
        .product_ids
        .iter()
        .map(|id| {
            let valid_id = id
                .parse::<u64>()
                .ok()
                .filter(|value| value.to_string() == *id);
            valid_id
                .filter(|value| seen.insert(*value))
                .and_then(|value| evidence.items.iter().find(|item| item.product_id == value))
                .ok_or_else(|| AppError::Forbidden("inventory candidate is unsupported".into()))
        })
        .collect()
}

fn render_verified_readback(
    evidence: &LowStockEvidence,
    selected: &[&LowStockItem],
    current: &[LowStockItem],
) -> AppResult<VerifiedLowStockReadback> {
    if current != evidence.items {
        return Err(AppError::Unavailable(
            "inventory changed during the turn; read it again".into(),
        ));
    }
    let threshold = evidence.input.threshold;
    let mut answer = format!(
        "The selected stock scope has {} products at or below the threshold of {threshold}.",
        current.len()
    );
    let mut sources = Vec::with_capacity(selected.len());
    for item in selected {
        let id = item.product_id;
        // Labels are returned as separate plain text. Product names can include
        // Markdown or links and do not become instructions or link targets.
        let _ = write!(
            answer,
            "\n- Product #{id}: {} on hand.",
            item.quantity_on_hand
        );
        sources.push(LowStockSource {
            product_id: id.to_string(),
            label: item.name.clone(),
            href: format!("/products?tab=products&filter=id%3A{id}"),
        });
    }
    Ok(VerifiedLowStockReadback {
        answer,
        evidence_id: evidence.id.to_string(),
        sources,
    })
}

/// Release only a deterministic readback after validating the proposed
/// citations and confirming that the corresponding ERP facts are still current.
/// The raw provider candidate is never part of the returned response.
pub(crate) async fn verify_inventory_candidate(
    state: &AppState,
    scope: &InventoryAttempt<'_>,
    evidence: &LowStockEvidence,
    candidate: &str,
) -> AppResult<VerifiedLowStockReadback> {
    evidence.validate_scope(scope)?;
    let selected = selected_items(evidence, candidate)?;
    let current = read_protected(state, scope, evidence.input.clone()).await?;
    render_verified_readback(evidence, &selected, &current)
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use axum::{
        extract::{Query, State},
        http::{HeaderMap, StatusCode},
        response::IntoResponse,
        routing::{get, post},
        Json, Router,
    };
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        },
    };

    use crate::routes::harness_descriptor::test_support;

    fn actor(company: u64, identity: char) -> ActorContext {
        ActorContext::new(&identity.to_string().repeat(64), "test-session", 7, company).unwrap()
    }

    fn tool_scope<'a>(
        actor: &'a ActorContext,
        privacy: &'a OrgPrivacyPolicy,
        run_id: u64,
        attempt_id: &'a str,
    ) -> InventoryAttempt<'a> {
        InventoryAttempt::new(
            actor,
            privacy,
            run_id,
            attempt_id,
            &[INVENTORY_LOW_STOCK_TOOL.into()],
        )
        .unwrap()
    }

    fn stock() -> LowStockItem {
        LowStockItem {
            organization_id: 7,
            company_id: 9,
            product_id: 42,
            sku: "internal-sku".into(),
            name: "[name](https://example.invalid/)".into(),
            quantity_on_hand: 3.0,
            reorder_level: 5.0,
        }
    }

    fn proof(scope: &InventoryAttempt<'_>) -> LowStockEvidence {
        LowStockEvidence::new(
            scope,
            LowStockInput {
                threshold: 5.0,
                location_id: None,
            },
            vec![stock()],
        )
    }

    fn candidate(evidence: &LowStockEvidence, products: Value) -> String {
        json!({"evidenceId": evidence.id.to_string(), "productIds": products}).to_string()
    }

    #[test]
    fn tool_and_arguments_carry_no_scope_or_authority() {
        let actor = actor(9, 'a');
        let privacy = OrgPrivacyPolicy::default();
        assert!(InventoryAttempt::new(&actor, &privacy, 4, "one", &["*".into()]).is_err());
        assert!(parse_arguments(json!({"threshold": 5, "companyId": 9})).is_err());
        assert!(parse_arguments(json!({"threshold": 5, "token": "attempt"})).is_err());
        assert!(parse_arguments(json!({"threshold": 5, "location_id": 0})).is_err());
        assert!(parse_arguments(json!({"threshold": -1})).is_err());
        assert!(parse_arguments(json!({"threshold": 5, "location_id": 8})).is_ok());

        let evidence = proof(&tool_scope(&actor, &privacy, 4, "one"));
        let payload = evidence.tool_result().unwrap();
        assert_eq!(payload["capability"], LOW_STOCK_RESOURCE);
        assert_eq!(payload["items"][0]["productId"], "42");
        assert_eq!(payload["items"][0]["quantityOnHand"], 3.0);
        for suppressed in [
            "test-session",
            "internal-sku",
            "organizationId",
            "companyId",
        ] {
            assert!(!payload.to_string().contains(suppressed));
        }
    }

    #[test]
    fn evidence_is_bound_to_the_exact_actor_company_run_and_attempt() {
        let owner = actor(9, 'a');
        let privacy = OrgPrivacyPolicy::default();
        let evidence = proof(&tool_scope(&owner, &privacy, 4, "one"));
        assert!(evidence
            .validate_scope(&tool_scope(&owner, &privacy, 4, "one"))
            .is_ok());
        for scope in [
            tool_scope(&owner, &privacy, 5, "one"),
            tool_scope(&owner, &privacy, 4, "two"),
            tool_scope(&actor(10, 'a'), &privacy, 4, "one"),
            tool_scope(&actor(9, 'b'), &privacy, 4, "one"),
        ] {
            assert!(evidence.validate_scope(&scope).is_err());
        }
    }

    #[test]
    fn release_rejects_unbound_forged_and_stale_claims() {
        let owner = actor(9, 'a');
        let privacy = OrgPrivacyPolicy::default();
        let scope = tool_scope(&owner, &privacy, 4, "one");
        let evidence = proof(&scope);
        let other = proof(&scope);
        let forged = json!({
            "evidenceId": evidence.id.to_string(),
            "productIds": ["42"],
            "answer": "invented statement"
        });
        for rejected in [
            candidate(&other, json!(["42"])),
            candidate(&evidence, json!(["89"])),
            candidate(&evidence, json!(["042"])),
            candidate(&evidence, json!(["42", "42"])),
            candidate(&evidence, json!([])),
            forged.to_string(),
        ] {
            assert!(selected_items(&evidence, &rejected).is_err());
        }

        let selection = selected_items(&evidence, &candidate(&evidence, json!(["42"]))).unwrap();
        let mut changed = stock();
        changed.quantity_on_hand = 4.0;
        assert!(render_verified_readback(&evidence, &selection, &[changed]).is_err());

        let reply = render_verified_readback(&evidence, &selection, &[stock()]).unwrap();
        assert!(reply.answer.contains("3 on hand"));
        assert!(!reply.answer.contains("https:"));
        assert_eq!(
            reply.sources[0].href,
            "/products?tab=products&filter=id%3A42"
        );
    }

    pub(in crate::routes) type Fixture = (Arc<AtomicBool>, Arc<AtomicUsize>);

    pub(in crate::routes) async fn inventory_fixture(
    ) -> (AppState, Fixture, tokio::task::JoinHandle<()>) {
        let revoked = Arc::new(AtomicBool::new(false));
        let inventory_reads = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route(
                "/v1/ai/skills/access/check",
                get(
                    |State((revoked, _)): State<Fixture>,
                     headers: HeaderMap,
                     Query(query): Query<HashMap<String, String>>| async move {
                        assert_eq!(headers["authorization"], "Bearer test-session");
                        assert_eq!(query["companyId"], "9");
                        assert_eq!(query["skillKey"], LOW_STOCK_SKILL_KEY);
                        if revoked.load(Ordering::Relaxed) {
                            return StatusCode::FORBIDDEN.into_response();
                        }
                        Json(json!({
                            "organizationId": 7,
                            "companyId": 9,
                            "actorIdentity": "a".repeat(64),
                            "skillKey": LOW_STOCK_SKILL_KEY,
                            "allowed": true
                        }))
                        .into_response()
                    },
                ),
            )
            .route(
                "/v1/authoritative/stock-locations/8",
                get(
                    |headers: HeaderMap, Query(query): Query<HashMap<String, String>>| async move {
                        assert_eq!(headers["authorization"], "Bearer test-session");
                        assert_eq!(query["companyId"], "9");
                        Json(json!({
                            "data": {"id": 8, "organizationId": 7, "companyId": 9}
                        }))
                    },
                ),
            )
            .route(
                "/v1/database/tenant_module/sql",
                post(
                    |State((_, reads)): State<Fixture>, headers: HeaderMap, sql: String| async move {
                        fake_inventory_sql(&reads, &headers, &sql)
                    },
                ),
            )
            .with_state((Arc::clone(&revoked), Arc::clone(&inventory_reads)));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let mut config = test_support::config();
        config.api_server_url = Some(origin.clone());
        config.stdb_host = origin;
        let state = test_support::state(config).await;
        (state, (revoked, inventory_reads), server)
    }

    #[tokio::test]
    async fn authenticated_scan_uses_actor_token_and_release_rechecks_revocation() {
        let (state, (revoked, inventory_reads), server) = inventory_fixture().await;
        let owner = actor(9, 'a');
        let privacy = OrgPrivacyPolicy::default();
        let scope = tool_scope(&owner, &privacy, 4, "one");
        let evidence =
            inventory_low_stock(&state, &scope, json!({"threshold": 5, "location_id": 8}))
                .await
                .unwrap();
        let candidate = candidate(&evidence, json!(["42"]));
        let verified = verify_inventory_candidate(&state, &scope, &evidence, &candidate)
            .await
            .unwrap();
        assert!(verified.answer.contains("3 on hand"));
        assert_eq!(inventory_reads.load(Ordering::Relaxed), 4);

        let result =
            inventory_low_stock(&state, &scope, json!({"threshold": 5, "location_id": 10})).await;
        assert!(matches!(result, Err(AppError::Forbidden(_))));
        assert_eq!(inventory_reads.load(Ordering::Relaxed), 4);

        revoked.store(true, Ordering::Relaxed);
        let result = verify_inventory_candidate(&state, &scope, &evidence, &candidate).await;
        assert!(matches!(result, Err(AppError::Forbidden(_))));
        assert_eq!(inventory_reads.load(Ordering::Relaxed), 4);
        server.abort();
    }

    fn fake_inventory_sql(reads: &AtomicUsize, headers: &HeaderMap, sql: &str) -> Json<Value> {
        let (names, rows) = if sql.contains(" FROM ai_skill WHERE ") {
            assert_eq!(headers["authorization"], "Bearer stdb-secret-token");
            (
                vec!["id", "organization_id", "skill_key", "is_active"],
                vec![json!([2, 7, LOW_STOCK_SKILL_KEY, true])],
            )
        } else if sql.contains(" FROM ai_skill_config ") {
            assert_eq!(headers["authorization"], "Bearer stdb-secret-token");
            (Vec::new(), Vec::new())
        } else if sql.contains(" FROM product ") {
            assert_eq!(headers["authorization"], "Bearer test-session");
            assert!(sql.contains("WHERE organization_id = 7 LIMIT 501"));
            reads.fetch_add(1, Ordering::Relaxed);
            (
                vec!["id", "organization_id", "default_code", "name"],
                vec![json!([42, 7, "ABC", "Test Product"])],
            )
        } else {
            assert_eq!(headers["authorization"], "Bearer test-session");
            assert!(sql.contains("FROM stock_quant WHERE organization_id = 7 AND company_id = 9 AND location_id = 8 LIMIT 501"));
            reads.fetch_add(1, Ordering::Relaxed);
            (
                vec![
                    "organization_id",
                    "company_id",
                    "product_id",
                    "location_id",
                    "quantity",
                ],
                vec![json!([7, 9, 42, 8, 3.0])],
            )
        };
        Json(json!([{
            "schema": {"elements": names.into_iter().map(|name| {
                let kind = match name {
                    "skill_key" | "default_code" | "name" => json!({"String": []}),
                    "is_active" => json!({"Bool": []}),
                    "quantity" => json!({"F64": []}),
                    _ => json!({"U64": []}),
                };
                json!({"name": {"some": name}, "algebraic_type": kind})
            }).collect::<Vec<_>>()},
            "rows": rows,
        }]))
    }
}
