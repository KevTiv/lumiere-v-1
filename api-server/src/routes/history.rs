//! Source-authorized reads of private, reducer-captured business change evidence.
//!
//! The contract covers explicit Accounting draft line additions and ordinary edits. It deliberately
//! does not read caller-authored audit rows or imply complete historical coverage.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header::CACHE_CONTROL, HeaderValue, Request},
    middleware::{self, Next},
    response::Response,
    routing::get,
    Json, Router,
};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use stdb_auth::{
    has_resource_read_permission, permission_allowed, resolve_http_sql_columns, FieldAccessContext,
};
use stdb_client::StdbClient;

use crate::auth_password::identity_cell_to_hex;
use crate::error::ApiError;
use crate::query_exec::{execute_authorized_resource_record, resolve_membership_company_id};
use crate::session::{load_field_access_context, parse_stdb_identity_hex};
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::OrgSession;
use crate::workflow_reads::bounded_windows::{BoundedIdReader, ID_WINDOW};

#[cfg(test)]
mod tests;

const MAX_PAGE_SIZE: u32 = 50;
const MAX_WINDOWS: usize = 4;
const MAX_EVIDENCE_BYTES: usize = 65_536;
const OPERATION: &str = "update_account_move_line";
const ADD_OPERATION: &str = "add_account_move_line";
const OPERATIONS: [&str; 2] = [OPERATION, ADD_OPERATION];
const COLUMNS: &str = "id, organization_id, company_id, resource, record_id, subject_resource, subject_record_id, operation, actor_identity, occurred_at, schema_version, changes_json";
const VISIBLE_FIELDS: &[&str] = &[
    "name",
    "debit",
    "credit",
    "balance",
    "amount_currency",
    "amount_residual",
    "amount_residual_currency",
    "debit_currency",
    "credit_currency",
    "partner_id",
    "analytic_account_id",
    "account_id",
    "currency_id",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryQuery {
    company_id: u64,
    cursor: Option<String>,
    limit: Option<u32>,
}

impl HistoryQuery {
    fn validate(&self, record_id: u64) -> Result<usize, ApiError> {
        let limit = self.limit.unwrap_or(MAX_PAGE_SIZE);
        if self.company_id == 0 || record_id == 0 || !(1..=MAX_PAGE_SIZE).contains(&limit) {
            return Err(ApiError::BadRequest(
                "positive record/company IDs and a history limit between 1 and 50 are required"
                    .into(),
            ));
        }
        if self
            .cursor
            .as_ref()
            .is_some_and(|cursor| cursor.len() > 256)
        {
            return Err(ApiError::BadRequest("invalid change history cursor".into()));
        }
        Ok(limit as usize)
    }

    fn cursor_prefix(&self, org: u64, actor: &str, record: u64) -> String {
        format!("bh1.{org}.{}.{record}.{actor}.", self.company_id)
    }

    fn after(&self, org: u64, actor: &str, record: u64) -> Result<u64, ApiError> {
        self.cursor.as_ref().map_or(Ok(0), |cursor| {
            cursor
                .strip_prefix(&self.cursor_prefix(org, actor, record))
                .and_then(decimal_id)
                .ok_or_else(|| {
                    ApiError::BadRequest("cursor does not match this change history".into())
                })
        })
    }

    fn cursor(&self, org: u64, actor: &str, record: u64, after: u64) -> String {
        format!("{}{after}", self.cursor_prefix(org, actor, record))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryPage {
    schema_version: u32,
    record_id: String,
    company_id: String,
    data: Vec<HistoryEntry>,
    next_cursor: Option<String>,
    coverage: HistoryCoverage,
}

#[derive(Debug, Serialize)]
struct HistoryCoverage {
    status: &'static str,
    operations: [&'static str; 2],
    message: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    id: String,
    operation: String,
    actor_identity: String,
    occurred_at: String,
    changed_resource: &'static str,
    changed_record_id: String,
    changes: Vec<HistoryDelta>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct HistoryDelta {
    field: String,
    #[serde(deserialize_with = "required_nullable_string")]
    before: Option<String>,
    #[serde(deserialize_with = "required_nullable_string")]
    after: Option<String>,
}

fn required_nullable_string<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

fn decimal_id(value: &str) -> Option<u64> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return None;
    }
    value.parse().ok()
}

fn cell<'a>(row: &'a Value, snake: &str, camel: &str) -> Option<&'a Value> {
    row.get(snake).or_else(|| row.get(camel))
}

fn number(row: &Value, snake: &str, camel: &str) -> Option<u64> {
    cell(row, snake, camel).and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_str().and_then(decimal_id))
    })
}

fn malformed_evidence() -> ApiError {
    ApiError::Internal("invalid private business change evidence".into())
}

fn require_access(access: &FieldAccessContext) -> Result<HashSet<String>, ApiError> {
    if !permission_allowed(access, "business_history", "read")
        || !has_resource_read_permission(Some(access), "account-moves")
        || !has_resource_read_permission(Some(access), "account-move-lines")
    {
        return Err(ApiError::Forbidden(
            "Change history read permission denied".into(),
        ));
    }
    let columns =
        resolve_http_sql_columns("account-move-lines", Some(access)).map_err(ApiError::Internal)?;
    Ok(columns
        .into_iter()
        .filter(|column| VISIBLE_FIELDS.contains(&column.as_str()))
        .collect())
}

fn occurred_at(value: &Value) -> Result<String, ApiError> {
    let value = value
        .get("__timestamp_micros_since_unix_epoch__")
        .or_else(|| value.get("microsSinceUnixEpoch"))
        .unwrap_or(value);
    let micros = value
        .as_i64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        .ok_or_else(malformed_evidence)?;
    chrono::DateTime::<Utc>::from_timestamp_micros(micros)
        .map(|date| date.to_rfc3339_opts(SecondsFormat::Micros, true))
        .ok_or_else(malformed_evidence)
}

fn project_entry(
    row: &Value,
    org: u64,
    company: u64,
    record: u64,
    allowed_fields: &HashSet<String>,
) -> Result<Option<HistoryEntry>, ApiError> {
    let operation = cell(row, "operation", "operation")
        .and_then(Value::as_str)
        .ok_or_else(malformed_evidence)?;
    if number(row, "organization_id", "organizationId") != Some(org)
        || number(row, "company_id", "companyId") != Some(company)
        || number(row, "record_id", "recordId") != Some(record)
        || number(row, "schema_version", "schemaVersion") != Some(1)
        || cell(row, "resource", "resource").and_then(Value::as_str) != Some("account_move")
        || cell(row, "subject_resource", "subjectResource").and_then(Value::as_str)
            != Some("account_move_line")
        || !OPERATIONS.contains(&operation)
    {
        return Err(malformed_evidence());
    }
    let id = number(row, "id", "id")
        .filter(|id| *id > 0)
        .ok_or_else(malformed_evidence)?;
    let subject = number(row, "subject_record_id", "subjectRecordId")
        .filter(|id| *id > 0)
        .ok_or_else(malformed_evidence)?;
    let encoded = cell(row, "changes_json", "changesJson")
        .and_then(Value::as_str)
        .filter(|value| value.len() <= MAX_EVIDENCE_BYTES)
        .ok_or_else(malformed_evidence)?;
    let mut changes: Vec<HistoryDelta> =
        serde_json::from_str(encoded).map_err(|_| malformed_evidence())?;
    if changes.is_empty() || changes.len() > VISIBLE_FIELDS.len() + 1 {
        return Err(malformed_evidence());
    }
    let mut seen = HashSet::new();
    for change in &changes {
        if !seen.insert(&change.field)
            || change.before == change.after
            || (operation == ADD_OPERATION && change.before.is_some())
            || (!VISIBLE_FIELDS.contains(&change.field.as_str()) && change.field != "metadata")
        {
            return Err(malformed_evidence());
        }
    }
    // Metadata is never a public history field. Do not expose hidden field names,
    // omitted counts, fingerprints or a placeholder revealing the hidden delta.
    changes.retain(|change| allowed_fields.contains(&change.field));
    if changes.is_empty() {
        return Ok(None);
    }
    let actor = cell(row, "actor_identity", "actorIdentity")
        .and_then(identity_cell_to_hex)
        .and_then(|identity| parse_stdb_identity_hex(&identity))
        .ok_or_else(malformed_evidence)?;
    Ok(Some(HistoryEntry {
        id: id.to_string(),
        operation: operation.into(),
        actor_identity: actor,
        occurred_at: occurred_at(
            cell(row, "occurred_at", "occurredAt").ok_or_else(malformed_evidence)?,
        )?,
        changed_resource: "account-move-lines",
        changed_record_id: subject.to_string(),
        changes,
    }))
}

async fn require_current_source(
    client: &StdbClient,
    access: &FieldAccessContext,
    org: u64,
    actor: &str,
    company: u64,
    record: u64,
) -> Result<(), ApiError> {
    resolve_membership_company_id(
        client,
        org,
        actor,
        Some(company),
        "Change history company scope denied",
    )
    .await?;
    if execute_authorized_resource_record(
        client,
        "account-moves",
        org,
        company,
        record,
        Some(access),
    )
    .await?
    .is_none()
    {
        return Err(ApiError::NotFound("Accounting record not found".into()));
    }
    Ok(())
}

async fn current_line_exists(
    client: &StdbClient,
    org: u64,
    company: u64,
    record: u64,
    line: u64,
) -> Result<bool, ApiError> {
    // Scope fields are used only to authorize this relation, never returned as a
    // substitute for the actor's field projection. Deleted-line history needs a
    // separately admitted historical-source policy and is excluded initially.
    let sql = format!("SELECT id, organization_id, company_id, move_id FROM account_move_line WHERE organization_id = {org} AND company_id = {company} AND move_id = {record} AND id = {line}");
    let rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    match rows.as_slice() {
        [] => Ok(false),
        [row]
            if number(row, "id", "id") == Some(line)
                && number(row, "organization_id", "organizationId") == Some(org)
                && number(row, "company_id", "companyId") == Some(company)
                && number(row, "move_id", "moveId") == Some(record) =>
        {
            Ok(true)
        }
        _ => Err(malformed_evidence()),
    }
}

async fn read_account_move_history(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    record: u64,
    query: &HistoryQuery,
) -> Result<HistoryPage, ApiError> {
    let limit = query.validate(record)?;
    let org = context.organization_id();
    let actor = context.actor_identity();
    let company = query.company_id;
    let fields = require_access(context.field_access())?;
    let mut after = query.after(org, actor, record)?;
    require_current_source(
        context.client(),
        context.field_access(),
        org,
        actor,
        company,
        record,
    )
    .await?;

    let predicate = format!("organization_id = {org} AND company_id = {company} AND resource = 'account_move' AND record_id = {record}");
    let reader = BoundedIdReader::new(owner, "business_change", &predicate);
    let mut data = Vec::new();
    let mut probes = 0;
    'windows: for _ in 0..MAX_WINDOWS {
        let Some(witness) = reader.witness(after, None).await? else {
            break;
        };
        reader
            .seek_window_start(&mut after, witness, &mut probes)
            .await?;
        let end = after.saturating_add(ID_WINDOW);
        let mut rows = owner
            .query_sql(&reader.window_sql(COLUMNS, after, end))
            .await
            .map_err(ApiError::internal)?;
        if rows.len() > ID_WINDOW as usize {
            return Err(malformed_evidence());
        }
        rows.sort_by_key(|row| number(row, "id", "id"));
        let mut last = after;
        for row in rows {
            let id = number(&row, "id", "id")
                .filter(|id| *id > last && *id <= end)
                .ok_or_else(malformed_evidence)?;
            last = id;
            after = id;
            if let Some(entry) = project_entry(&row, org, company, record, &fields)? {
                data.push(entry);
            }
            if data.len() == limit {
                break 'windows;
            }
        }
        after = end;
        if after == u64::MAX {
            break;
        }
    }
    let next_cursor = if reader.witness(after, None).await?.is_some() {
        Some(query.cursor(org, actor, record, after))
    } else {
        None
    };

    let mut line_access = HashMap::new();
    let mut visible = Vec::with_capacity(data.len());
    for entry in data {
        let line = decimal_id(&entry.changed_record_id).ok_or_else(malformed_evidence)?;
        let allowed = if let Some(allowed) = line_access.get(&line) {
            *allowed
        } else {
            let allowed = current_line_exists(context.client(), org, company, record, line).await?;
            line_access.insert(line, allowed);
            allowed
        };
        if allowed {
            visible.push(entry);
        }
    }
    require_current_source(
        context.client(),
        context.field_access(),
        org,
        actor,
        company,
        record,
    )
    .await?;
    // Refresh policy after the last source read, so revocation or a narrower
    // field grant during child authorization cannot return the old projection.
    // This establishes the read's final authorization snapshot; it is not a
    // transaction spanning independent native HTTP requests.
    let current_access = load_field_access_context(owner, actor, org)
        .await
        .map_err(ApiError::Internal)?
        .ok_or_else(|| {
            ApiError::Forbidden("Change history access is no longer available".into())
        })?;
    let current_fields = require_access(&current_access)?;
    visible.retain_mut(|entry| {
        entry
            .changes
            .retain(|change| current_fields.contains(&change.field));
        !entry.changes.is_empty()
    });
    Ok(HistoryPage {
        schema_version: 1, record_id: record.to_string(), company_id: company.to_string(), data: visible, next_cursor,
        coverage: HistoryCoverage {
            status: "partial", operations: OPERATIONS,
            message: "Only captured explicit draft journal-line additions and ordinary non-purchase-order draft-line edits are included. Automatically generated lines, quantity/price bill corrections, metadata, deleted-line history, and earlier or other operations are not included.",
        },
    })
}

async fn account_move_history_get(
    State(state): State<Arc<AppState>>,
    Path(record): Path<u64>,
    Query(query): Query<HistoryQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<HistoryPage>, ApiError> {
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    // This follows the existing private workflow-reader boundary. A dedicated
    // scoped reader identity is a later hardening step, not an implicit grant.
    let page = read_account_move_history(&state.stdb, &context, record, &query).await?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(page))
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/history/account-moves/:id", get(account_move_history_get))
        .route_layer(middleware::from_fn(no_store))
}

async fn no_store(request: Request<Body>, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    response
}
