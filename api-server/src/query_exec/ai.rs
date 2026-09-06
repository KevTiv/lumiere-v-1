//! AI, chat, and skill-governance resource reads.

use super::company_scope::company_ids_for_organization;
use super::row_values::sort_rows_by_id_desc;
use crate::error::ApiError;
use serde_json::Value;
use std::collections::HashSet;
use stdb_auth::resolve_http_sql_columns;
use stdb_auth::{identity_sql_literal, FieldAccessContext};
use stdb_client::StdbClient;

fn ai_skill_permission_allowed(field_access: Option<&FieldAccessContext>, action: &str) -> bool {
    field_access.is_some_and(|access| {
        access.is_superuser
            || access.role_permissions.iter().any(|permission| {
                permission == "*:*"
                    || permission == "ai_skill:*"
                    || permission == &format!("ai_skill:{action}")
            })
    })
}

pub(crate) async fn read_ai_chat_sessions(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
) -> Result<Vec<Value>, ApiError> {
    let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let sql = format!(
                "SELECT id, organization_id, company_id, session_key, title, route, module, active_tab, archived, create_uid, create_date, write_uid, write_date, metadata FROM ai_chat_session WHERE organization_id = {organization_id} AND create_uid = {id} ORDER BY write_date DESC"
            );
    return client.query_sql(&sql).await.map_err(ApiError::internal);
}

pub(crate) async fn read_ai_chat_messages(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
) -> Result<Vec<Value>, ApiError> {
    let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let sql = format!(
                "SELECT id, organization_id, company_id, session_key, role, content, sources_json, ui_context_json, model, duration_ms, status, created_by, create_date, metadata FROM ai_chat_message WHERE organization_id = {organization_id} AND created_by = {id} ORDER BY create_date ASC"
            );
    return client.query_sql(&sql).await.map_err(ApiError::internal);
}

pub(crate) async fn read_ai_action_drafts(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
) -> Result<Vec<Value>, ApiError> {
    let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let sql = format!(
                "SELECT id, organization_id, company_id, status, reducer_name, params_json, summary, confidence, elevated, warnings_json, source_query, ui_context_json, proposed_by, reviewed_by, reviewed_at, reject_reason, executed_at, execution_error, execution_record_id, expires_at, create_date, write_date, metadata FROM ai_action_draft WHERE organization_id = {organization_id} AND proposed_by = {id}"
            );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}

pub(crate) async fn read_ai_agent_runs(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
                "SELECT id, organization_id, company_id, skill_id, run_key, status, summary, step_count, error_message, started_at, completed_at, create_date, write_date FROM ai_agent_run WHERE organization_id = {organization_id}"
            );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}

pub(crate) async fn read_ai_skill_versions(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
                "SELECT id, organization_id, skill_id, skill_key, version, manifest_schema_version, source_hash, risk, max_steps, max_tool_calls, permissions, resources, output_types, reviewed_at, review_notes, created_at, metadata FROM ai_skill_version WHERE organization_id = {organization_id}"
            );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}

pub(crate) async fn read_ai_skill_releases(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
                "SELECT id, organization_id, skill_id, skill_version_id, release_number, is_active, action, previous_release_id, rollback_target_release_id, released_at, reason FROM ai_skill_release WHERE organization_id = {organization_id}"
            );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}

pub(crate) async fn read_ai_skill_fixtures(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
                "SELECT id, organization_id, skill_id, fixture_key, name, description, input_json, expected_output_json, created_at, metadata FROM ai_skill_fixture WHERE organization_id = {organization_id}"
            );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}

pub(crate) async fn read_ai_skill_test_runs(
    client: &StdbClient,
    organization_id: u64,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    if field_access.is_some() || stdb_config::runtime_is_production() {
        let allowed = ai_skill_permission_allowed(field_access, "read")
            || ai_skill_permission_allowed(field_access, "write");
        if !allowed {
            return Err(ApiError::Forbidden(
                "Permission denied: read on ai_skill".into(),
            ));
        }
    }
    let sql = format!(
                "SELECT id, organization_id, company_id, skill_id, skill_version_id, fixture_id, certification_request_id, runtime_profile_id, certification_environment_id, status, output_fingerprint, source_hash, manifest_hash, fixture_hash, runtime_hash, environment_hash, policy_snapshot_hash, execution_evidence_hash, executor_run_id, failure_kind, failure_reason, executed_at, metadata FROM ai_skill_certification_evidence WHERE organization_id = {organization_id}"
            );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}

pub(super) async fn read_ai_action_drafts_inbox(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    // `ai_action_draft` has `organization_id`; `company_id IN (...)` is redundant and
    // SpacetimeDB SQL does not support `IN` clauses. Scope by org only.
    // HTTP SQL also rejects `ORDER BY id DESC` on this table — sort in Rust.
    let sql = format!(
        "SELECT id, organization_id, company_id, status, reducer_name, params_json, summary, confidence, elevated, warnings_json, source_query, ui_context_json, proposed_by, reviewed_by, reviewed_at, reject_reason, executed_at, execution_error, execution_record_id, expires_at, create_date, write_date, metadata FROM ai_action_draft WHERE organization_id = {organization_id} AND status = 'pending'"
    );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}

pub(super) async fn read_ai_insights(
    client: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    // No `organization_id`; SpacetimeDB SQL does not support `IN (...)`. Fetch all
    // rows and keep rows with NULL/missing `company_id` (org-level insights) plus
    // those matching the org's company IDs.
    let ids = company_ids_for_organization(client, organization_id, fa).await?;
    let company_set: HashSet<u64> = ids.iter().copied().collect();
    let col = resolve_http_sql_columns("ai-insights", fa).map_err(ApiError::Internal)?;
    let sql = format!("SELECT {} FROM ai_insight", col.join(", "));
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    rows.retain(
        |r| match r.get("companyId").or_else(|| r.get("company_id")) {
            None | Some(Value::Null) => true,
            Some(v) => v.as_u64().is_some_and(|cid| company_set.contains(&cid)),
        },
    );
    return Ok(rows);
}

pub(super) async fn read_ai_document_processing_jobs(
    client: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    // No `organization_id`; SpacetimeDB SQL does not support `IN (...)`. Fetch all
    // rows and keep rows with NULL/missing `company_id` (org-level jobs) plus those
    // matching the org's company IDs.
    let ids = company_ids_for_organization(client, organization_id, fa).await?;
    let company_set: HashSet<u64> = ids.iter().copied().collect();
    let col =
        resolve_http_sql_columns("ai-document-processing-jobs", fa).map_err(ApiError::Internal)?;
    let sql = format!("SELECT {} FROM ai_document_processing_job", col.join(", "));
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    rows.retain(
        |r| match r.get("companyId").or_else(|| r.get("company_id")) {
            None | Some(Value::Null) => true,
            Some(v) => v.as_u64().is_some_and(|cid| company_set.contains(&cid)),
        },
    );
    return Ok(rows);
}
