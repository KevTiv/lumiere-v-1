//! Organization administrators can revoke built-in skill access for individual members.

use std::{collections::BTreeSet, sync::Arc};

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header::CACHE_CONTROL, HeaderValue, Request},
    middleware::{self, Next},
    response::Response,
    routing::get,
    Json, Router,
};
use lumiere_policy_core::ai_skills::{
    is_builtin_skill, BUILTIN_SKILL_KEYS, USER_SKILL_PERMISSION_PREFIX,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use stdb_auth::{identity_sql_literal, permission_allowed};
use stdb_client::StdbClient;

use crate::{
    commands::dispatch_session_reducer,
    error::ApiError,
    query_exec::resolve_membership_company_id,
    session::{identity_json_for_reducer_call, parse_stdb_identity_hex},
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};

const MAX_SKILL_DENIAL_ROWS: usize = 5_000;
const MAX_SKILL_DENIAL_BYTES: usize = 2 * 1024 * 1024;

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/ai/skills/user-access",
            get(list_member_skill_denials).put(set_member_skill_access),
        )
        .route("/ai/skills/access/check", get(check_own_skill_access))
        .route_layer(middleware::from_fn(no_store))
}

async fn no_store(request: Request<Body>, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MemberSkillDenialsQuery {
    skill_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetMemberSkillAccess {
    skill_key: String,
    user_identity: String,
    revoked: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SkillAccessCheckQuery {
    company_id: u64,
    skill_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemberSkillDenials {
    built_in_skill_keys: &'static [&'static str],
    revoked_user_identities: BTreeSet<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillAccessCheck<'a> {
    organization_id: u64,
    company_id: u64,
    actor_identity: &'a str,
    skill_key: &'a str,
    allowed: bool,
}

struct MemberSkillDenial {
    id: u64,
    user_identity: String,
}

fn builtin_skill_resource(skill_key: &str) -> Result<String, ApiError> {
    if !is_builtin_skill(skill_key) {
        return Err(ApiError::BadRequest("Unknown built-in skill".into()));
    }
    Ok(format!("{USER_SKILL_PERMISSION_PREFIX}{skill_key}"))
}

async fn require_skill_access_admin(
    state: &AppState,
    context: &TrustedOperationContext,
) -> Result<(), ApiError> {
    let access = context.field_access();
    let admin_permissions = [
        ("role", "write"),
        ("user_organization", "write"),
        ("user_role_assignment", "create"),
        ("user_role_assignment", "delete"),
        ("org_permission", "create"),
        ("org_permission", "delete"),
    ];
    if !admin_permissions
        .iter()
        .all(|(resource, action)| permission_allowed(access, resource, action))
    {
        return Err(ApiError::Forbidden(
            "Organization administrator required to manage skill access".into(),
        ));
    }
    let org = context.organization_id();
    let identity = identity_sql_literal(context.actor_identity()).map_err(ApiError::Internal)?;
    let delegated = state
        .stdb
        .query_sql(&format!(
            "SELECT company_id FROM delegated_admin_scope WHERE organization_id = {org} \
             AND user_identity = {identity} AND is_active = true LIMIT 1"
        ))
        .await
        .map_err(ApiError::internal)?;
    if !delegated.is_empty() {
        return Err(ApiError::Forbidden(
            "Company-delegated administrators cannot manage organization skill access".into(),
        ));
    }
    Ok(())
}

/// Read the exact, registered namespace under the organization's permission
/// index. Reject oversized results instead of returning partial policy data.
async fn member_skill_denials(
    client: &StdbClient,
    organization_id: u64,
    skill_key: &str,
) -> Result<Vec<MemberSkillDenial>, ApiError> {
    let resource = builtin_skill_resource(skill_key)?;
    let rows = client
        .with_query_limits(MAX_SKILL_DENIAL_ROWS, MAX_SKILL_DENIAL_BYTES)
        .map_err(ApiError::internal)?
        .query_sql_sats(&format!(
            "SELECT id, subject, action, effect FROM org_permission \
             WHERE organization_id = {organization_id} AND resource = '{resource}' LIMIT {}",
            MAX_SKILL_DENIAL_ROWS + 1
        ))
        .await
        .map_err(ApiError::internal)?;
    rows.iter().map(member_skill_denial).collect()
}

fn member_skill_denial(row: &Value) -> Result<MemberSkillDenial, ApiError> {
    let invalid = || ApiError::Unavailable("Invalid built-in skill access policy".into());
    let id = row["id"]
        .as_u64()
        .or_else(|| row["id"].as_str()?.parse().ok())
        .filter(|id| *id > 0)
        .ok_or_else(invalid)?;
    if row["action"] != json!({"All": []}) || row["effect"] != json!({"Deny": []}) {
        return Err(invalid());
    }
    let user = &row["subject"]["User"];
    let identity = user["__identity__"]
        .as_str()
        .or_else(|| user.as_str())
        .and_then(parse_stdb_identity_hex)
        .ok_or_else(invalid)?;
    Ok(MemberSkillDenial {
        id,
        user_identity: identity,
    })
}

async fn list_member_skill_denials(
    State(state): State<Arc<AppState>>,
    Query(query): Query<MemberSkillDenialsQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<MemberSkillDenials>, ApiError> {
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    require_skill_access_admin(&state, &context).await?;
    let revoked_user_identities = if let Some(skill_key) = query.skill_key {
        member_skill_denials(&state.stdb, context.organization_id(), &skill_key)
            .await?
            .into_iter()
            .map(|denial| denial.user_identity)
            .collect()
    } else {
        BTreeSet::new()
    };
    Ok(Json(MemberSkillDenials {
        built_in_skill_keys: BUILTIN_SKILL_KEYS,
        revoked_user_identities,
    }))
}

async fn check_own_skill_access(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SkillAccessCheckQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    if query.company_id == 0 {
        return Err(ApiError::BadRequest("Company ID must be positive".into()));
    }
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    let organization_id = context.organization_id();
    let actor_identity = context.actor_identity();
    let company_id = resolve_membership_company_id(
        &state.stdb,
        organization_id,
        actor_identity,
        Some(query.company_id),
        "Skill access company scope mismatch",
    )
    .await?;
    if company_id != query.company_id {
        return Err(ApiError::Forbidden(
            "Skill access company scope mismatch".into(),
        ));
    }
    let allowed = if is_builtin_skill(&query.skill_key) {
        !actor_skill_revoked(
            &state.stdb,
            organization_id,
            actor_identity,
            &query.skill_key,
        )
        .await?
    } else {
        // Tenant-authored workflows have their own publishing and usage rules.
        false
    };
    Ok(Json(json!(SkillAccessCheck {
        organization_id,
        company_id,
        actor_identity,
        skill_key: &query.skill_key,
        allowed,
    })))
}

/// Grant and revoke update the member's indexed policy snapshot in the same
/// transaction. Members without a projection use the bounded source lookup.
async fn actor_skill_revoked(
    client: &StdbClient,
    organization_id: u64,
    actor_identity: &str,
    skill_key: &str,
) -> Result<bool, ApiError> {
    let resource = builtin_skill_resource(skill_key)?;
    let identity = identity_sql_literal(actor_identity).map_err(ApiError::Internal)?;
    let rows = client
        .with_query_limits(2, 512 * 1024)
        .map_err(ApiError::internal)?
        .query_sql_sats(&format!(
            "SELECT org_permission_grants FROM policy_snapshot WHERE organization_id = {organization_id} \
             AND user_identity = {identity} LIMIT 2"
        ))
        .await
        .map_err(ApiError::internal)?;
    match rows.as_slice() {
        [row] => snapshot_skill_revoked(row, &resource),
        [] => Ok(member_skill_denials(client, organization_id, skill_key)
            .await?
            .into_iter()
            .any(|denial| denial.user_identity == actor_identity)),
        _ => Err(ApiError::Unavailable(
            "Ambiguous member skill policy snapshot".into(),
        )),
    }
}

fn snapshot_skill_revoked(row: &Value, resource: &str) -> Result<bool, ApiError> {
    let grants = row["org_permission_grants"]
        .as_array()
        .ok_or_else(|| ApiError::Unavailable("Invalid member skill policy snapshot".into()))?;
    let mut revoked = false;
    for grant in grants.iter().filter(|grant| grant["resource"] == resource) {
        if grant["action"] != "*" || grant["effect"] != "deny" {
            return Err(ApiError::Unavailable(
                "Invalid built-in skill access policy".into(),
            ));
        }
        revoked = true;
    }
    Ok(revoked)
}

async fn ensure_active_human_member(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
) -> Result<(), ApiError> {
    let identity = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let memberships = format!(
        "SELECT id FROM user_organization WHERE organization_id = {organization_id} \
         AND user_identity = {identity} AND is_active = true LIMIT 2"
    );
    let profiles = format!(
        "SELECT metadata FROM user_profile WHERE organization_id = {organization_id} \
         AND identity = {identity} AND is_active = true LIMIT 2"
    );
    let (memberships, profiles) =
        tokio::try_join!(client.query_sql(&memberships), client.query_sql(&profiles))
            .map_err(ApiError::internal)?;
    if memberships.len() == 1
        && matches!(profiles.as_slice(), [profile] if stdb_auth::profile_allows_interactive_session(
            profile, chrono::Utc::now().timestamp_micros()
        ))
    {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "Skill access target must be an active organization user".into(),
        ))
    }
}

async fn set_member_skill_access(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Json(request): Json<SetMemberSkillAccess>,
) -> Result<Json<Value>, ApiError> {
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    require_skill_access_admin(&state, &context).await?;
    let org = context.organization_id();
    let resource = builtin_skill_resource(&request.skill_key)?;
    let identity = parse_stdb_identity_hex(&request.user_identity)
        .ok_or_else(|| ApiError::BadRequest("Invalid user identity".into()))?;
    ensure_active_human_member(&state.stdb, org, &identity).await?;
    if request.revoked {
        dispatch_session_reducer(
            &state,
            &session,
            "grant_permission",
            json!([org, {
                "resource": resource,
                "subject": {"user": identity_json_for_reducer_call(&identity)},
                "action": {"all": []},
                "effect": {"deny": []},
            }]),
        )
        .await?;
    } else {
        for denial in member_skill_denials(&state.stdb, org, &request.skill_key)
            .await?
            .into_iter()
            .filter(|row| row.user_identity == identity)
        {
            let result = dispatch_session_reducer(
                &state,
                &session,
                "revoke_permission",
                json!([org, denial.id]),
            )
            .await;
            if let Err(error) = result {
                if !matches!(&error, ApiError::Unprocessable(message) if message.contains("Permission not found"))
                {
                    return Err(error);
                }
                // A simultaneous restore may already have removed this entry.
                let still_present = member_skill_denials(&state.stdb, org, &request.skill_key)
                    .await?
                    .iter()
                    .any(|row| row.id == denial.id);
                if still_present {
                    return Err(error);
                }
            }
        }
    }
    let revoked = member_skill_denials(&state.stdb, org, &request.skill_key)
        .await?
        .into_iter()
        .any(|row| row.user_identity == identity);
    if revoked != request.revoked {
        return Err(ApiError::Conflict(
            "Skill access changed concurrently. Refresh and retry.".into(),
        ));
    }
    Ok(Json(json!({
        "skillKey": request.skill_key,
        "userIdentity": identity,
        "revoked": revoked,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_access_targets_only_exact_builtin_keys() {
        assert_eq!(
            builtin_skill_resource("rag_generation").unwrap(),
            "ai_skill.rag_generation"
        );
        for key in [
            "RAG_GENERATION",
            "rag_generation ",
            "' OR true",
            "embedding_query",
        ] {
            assert!(builtin_skill_resource(key).is_err());
        }
    }

    #[test]
    fn permission_parser_checks_namespaced_denial_shape() {
        let identity = "a".repeat(64);
        let element =
            |name: &str, kind: Value| json!({"name": {"some": name}, "algebraic_type": kind});
        let unit = json!({"Product":{"elements":[]}});
        let identity_type = json!({"Product":{"elements":[
            element("__identity__", json!({"U256":[]}))
        ]}});
        let body = json!([{
            "schema":{"elements":[
                element("id", json!({"U64":[]})),
                element("subject", json!({"Sum":{"variants":[
                    element("role", json!({"U64":[]})), element("user", identity_type)
                ]}})),
                element("action", json!({"Sum":{"variants":[element("all", unit.clone())]}})),
                element("effect", json!({"Sum":{"variants":[element("deny", unit)]}})),
            ]},
            "rows":[["17", [1, [format!("0x{identity}")]], [0, []], [0, []]]]
        }]);
        let mut rows = stdb_client::parse_sats_sql_response_canonical(&body.to_string()).unwrap();
        let mut row = rows.pop().unwrap();
        let denial = member_skill_denial(&row).unwrap();
        assert_eq!(denial.id, 17);
        assert_eq!(denial.user_identity, identity);
        row["effect"] = json!({"Allow": []});
        assert!(member_skill_denial(&row).is_err());
        row["effect"] = json!({"Deny": []});
        row["subject"] = json!({"Role": 17});
        assert!(member_skill_denial(&row).is_err());
    }

    #[test]
    fn exact_actor_snapshot_denial_does_not_require_a_positive_grant() {
        let no_denials = json!({"org_permission_grants": []});
        assert!(!snapshot_skill_revoked(&no_denials, "ai_skill.rag_generation").unwrap());
        let report_denied = json!({"org_permission_grants": [
            {"resource":"ai_skill.report_analysis","action":"*","effect":"deny"},
        ]});
        assert!(snapshot_skill_revoked(&report_denied, "ai_skill.report_analysis").unwrap());
        assert!(!snapshot_skill_revoked(&report_denied, "ai_skill.rag_generation").unwrap());
        assert!(snapshot_skill_revoked(&json!({}), "ai_skill.rag_generation").is_err());
    }
}
