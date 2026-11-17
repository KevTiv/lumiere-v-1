//! Farm attributions to already committed native stock and journal records.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use stdb_auth::{has_resource_field_read_permission, registry_get};

use super::{authorize, storage::lock_batch, FarmAccess, FarmScope};
use crate::{
    cold_tier::pg_pool, error::ApiError, query_exec::row_u64, session::ApiSession, state::AppState,
    trusted_context::TrustedOperationContext, web_session::OrgSession,
};

const PAGE_SIZE: usize = 25;
mod processing;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
enum NativeId {
    Text(String),
    Number(u64),
}

impl NativeId {
    fn positive(&self) -> Result<u64, ApiError> {
        match self {
            Self::Text(value) if value.bytes().all(|byte| byte.is_ascii_digit()) => {
                value.parse().ok()
            }
            Self::Number(value) => Some(*value),
            _ => None,
        }
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::BadRequest("IDs must be positive decimal values".into()))
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CostKind {
    VendorBill,
    ExpenseReport,
    Journal,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CostInput {
    company_id: NativeId,
    journal_line_id: NativeId,
    kind: CostKind,
    expense_report_id: Option<NativeId>,
    allocation_basis: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CostSource {
    kind: CostKind,
    expense_report_id: Option<String>,
    allocation_basis: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LinkQuery {
    company_id: u64,
    before_processing_event_id: Option<i64>,
    before_cost_journal_line_id: Option<u64>,
}

#[derive(Clone, Copy)]
struct NativeResource {
    key: &'static str,
    fields: &'static [&'static str],
    company_scoped: bool,
}

const JOURNAL_LINE: NativeResource = NativeResource {
    key: "account-move-lines",
    fields: &[
        "move_id",
        "parent_state",
        "company_currency_id",
        "balance",
        "account_id",
        "group_tax_id",
        "tax_line_id",
    ],
    company_scoped: true,
};
const JOURNAL: NativeResource = NativeResource {
    key: "account-moves",
    fields: &["state", "move_type", "date", "company_currency_id"],
    company_scoped: true,
};
const ACCOUNT: NativeResource = NativeResource {
    key: "account-accounts",
    fields: &["internal_group"],
    company_scoped: true,
};
const EXPENSE: NativeResource = NativeResource {
    key: "expense-sheets",
    fields: &["account_move_id", "state"],
    company_scoped: true,
};

pub(super) struct NativeReader<'a> {
    pub(super) context: &'a TrustedOperationContext,
    pub(super) scope: &'a FarmScope,
}

impl NativeReader<'_> {
    pub(super) fn allows_cost_lines(&self) -> bool {
        [JOURNAL_LINE, JOURNAL, ACCOUNT]
            .into_iter()
            .all(|source| self.allows(source))
    }

    pub(super) fn allows_expense_reports(&self) -> bool {
        self.allows(EXPENSE)
    }

    fn allows(&self, source: NativeResource) -> bool {
        source.fields.iter().all(|field| {
            has_resource_field_read_permission(Some(self.context.field_access()), source.key, field)
        })
    }

    async fn read(&self, source: NativeResource, record: u64) -> Result<Value, ApiError> {
        if !self.allows(source) {
            return Err(ApiError::Forbidden(
                "Access to the original native record is required".into(),
            ));
        }
        let table = &registry_get(source.key)
            .ok_or_else(|| ApiError::Internal("Unknown farm native resource".into()))?
            .table;
        let (company_column, company_filter) = if source.company_scoped {
            (
                ", company_id",
                format!(" AND company_id = {}", self.scope.company),
            )
        } else {
            ("", String::new())
        };
        let sql = format!(
            "SELECT id, organization_id{company_column}, {} FROM {table} WHERE organization_id = {}{company_filter} AND id = {record} LIMIT 2",
            source.fields.join(", "),
            self.scope.organization,
        );
        let rows = self
            .context
            .client()
            .query_sql(&sql)
            .await
            .map_err(ApiError::internal)?;
        let [row] = rows.as_slice() else {
            return Err(ApiError::NotFound(
                "Native record was not found in this scope".into(),
            ));
        };
        if id(row, "id", "id")? != record
            || id(row, "organizationId", "organization_id")? != self.scope.organization
            || (source.company_scoped && id(row, "companyId", "company_id")? != self.scope.company)
        {
            return Err(ApiError::NotFound(
                "Native record was not found in this scope".into(),
            ));
        }
        Ok(row.clone())
    }
}

fn native_data_unavailable() -> ApiError {
    ApiError::Unavailable("Required native record fields could not be verified".into())
}

fn field<'a>(row: &'a Value, camel: &str, snake: &str) -> Result<&'a Value, ApiError> {
    match (row.get(camel), row.get(snake)) {
        (Some(left), Some(right)) if left != right => Err(native_data_unavailable()),
        (Some(value), _) | (_, Some(value)) => Ok(value),
        _ => Err(native_data_unavailable()),
    }
}

fn id(row: &Value, camel: &str, snake: &str) -> Result<u64, ApiError> {
    optional_id(row, camel, snake)?.ok_or_else(native_data_unavailable)
}

fn optional_id(row: &Value, camel: &str, snake: &str) -> Result<Option<u64>, ApiError> {
    field(row, camel, snake)?;
    row_u64(row, camel, snake).map_err(|_| native_data_unavailable())
}

fn tagged(value: &Value) -> Option<&str> {
    if let Some(text) = value.as_str() {
        return Some(text);
    }
    let object = value.as_object()?;
    if object.len() != 1 {
        return None;
    }
    let (key, nested) = object.iter().next()?;
    match key.as_str() {
        "tag" => nested.as_str(),
        "some" | "Some" => {
            if let Some([value]) = nested.as_array().map(Vec::as_slice) {
                tagged(value)
            } else {
                nested.as_str()
            }
        }
        tag if nested.as_array().is_some_and(Vec::is_empty)
            || nested.as_object().is_some_and(serde_json::Map::is_empty) =>
        {
            Some(tag)
        }
        _ => None,
    }
}

fn enum_is(row: &Value, camel: &str, snake: &str, variant: &str) -> Result<bool, ApiError> {
    Ok(tagged(field(row, camel, snake)?)
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case(variant)))
}

fn number(row: &Value, camel: &str, snake: &str) -> Result<f64, ApiError> {
    let value = field(row, camel, snake)?;
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|number| number.is_finite())
        .ok_or_else(native_data_unavailable)
}

fn native_date(value: &Value) -> Option<String> {
    let micros = value.as_i64().or_else(|| value.as_str()?.parse().ok());
    if let Some(micros) = micros {
        return DateTime::from_timestamp_micros(micros).map(|date| date.date_naive().to_string());
    }
    if let Some(timestamp) = value.as_str() {
        return DateTime::parse_from_rfc3339(timestamp)
            .ok()
            .map(|date| date.date_naive().to_string());
    }
    let object = value.as_object()?;
    if object.len() != 1 {
        return None;
    }
    object
        .get("__timestamp_micros_since_unix_epoch__")
        .or_else(|| object.get("microsSinceUnixEpoch"))
        .and_then(|nested| native_date(nested))
}

pub(super) async fn verify_cost(
    reader: &NativeReader<'_>,
    line_id: u64,
    origin: &CostSource,
) -> Result<Value, ApiError> {
    let line = reader.read(JOURNAL_LINE, line_id).await?;
    let journal_id = id(&line, "moveId", "move_id")?;
    let journal = reader.read(JOURNAL, journal_id).await?;
    let account = reader
        .read(ACCOUNT, id(&line, "accountId", "account_id")?)
        .await?;
    let currency = id(&line, "companyCurrencyId", "company_currency_id")?;
    let balance = number(&line, "balance", "balance")?;
    if !enum_is(&line, "parentState", "parent_state", "Posted")?
        || !enum_is(&journal, "state", "state", "Posted")?
        || !enum_is(&account, "internalGroup", "internal_group", "Expense")?
        || optional_id(&line, "groupTaxId", "group_tax_id")?.is_some()
        || optional_id(&line, "taxLineId", "tax_line_id")?.is_some()
        || id(&journal, "companyCurrencyId", "company_currency_id")? != currency
        || balance == 0.0
    {
        return Err(ApiError::Conflict(
            "Choose a nonzero posted expense-account line in the company's currency".into(),
        ));
    }
    let matching_origin = match origin.kind {
        CostKind::VendorBill => {
            enum_is(&journal, "moveType", "move_type", "InInvoice")?
                || enum_is(&journal, "moveType", "move_type", "InRefund")?
        }
        CostKind::ExpenseReport => {
            let expense_id = origin
                .expense_report_id
                .as_deref()
                .and_then(|value| value.parse().ok())
                .ok_or_else(native_data_unavailable)?;
            let report = reader.read(EXPENSE, expense_id).await?;
            (enum_is(&report, "state", "state", "Posted")?
                || enum_is(&report, "state", "state", "Done")?)
                && optional_id(&report, "accountMoveId", "account_move_id")? == Some(journal_id)
        }
        CostKind::Journal => enum_is(&journal, "moveType", "move_type", "Entry")?,
    };
    if !matching_origin {
        return Err(ApiError::Conflict(
            "The posted line does not belong to the selected type of cost record".into(),
        ));
    }
    let date = native_date(field(&journal, "date", "date")?).ok_or_else(native_data_unavailable)?;
    Ok(json!({
        "journalLineId": line_id.to_string(), "journalId": journal_id.to_string(),
        "currencyId": currency.to_string(), "amount": balance.to_string(),
        "kind": origin.kind, "expenseReportId": origin.expense_report_id,
        "allocationBasis": origin.allocation_basis, "businessDate": date,
    }))
}

fn checked_batch_id(id: i64) -> Result<i64, ApiError> {
    if id <= 0 {
        return Err(ApiError::BadRequest(
            "A positive farm batch ID is required".into(),
        ));
    }
    Ok(id)
}

pub(super) fn context(
    state: &AppState,
    session: &ApiSession,
    company: u64,
) -> Result<TrustedOperationContext, ApiError> {
    let context = TrustedOperationContext::for_resource_read(state, session)?
        .with_company_scope(vec![company])?;
    context.require_company_scope(&[company])?;
    Ok(context)
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/farm-batches/:id/native-links", get(read_links))
        .merge(processing::router())
        .route("/farm-batches/:id/cost-links", post(link_cost))
}

async fn link_cost(
    State(state): State<Arc<AppState>>,
    Path(batch): Path<i64>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<CostInput>,
) -> Result<Json<Value>, ApiError> {
    let batch = checked_batch_id(batch)?;
    let company = body.company_id.positive()?;
    let line = body.journal_line_id.positive()?;
    let expense_report = body
        .expense_report_id
        .map(|value| value.positive())
        .transpose()?;
    let scope = authorize(&state, &session, company, FarmAccess::Write).await?;
    let prepared = preview_cost(
        &state,
        &session,
        &scope,
        line,
        body.kind,
        expense_report,
        &body.allocation_basis,
    )
    .await?;
    let mut connection = pg_pool::required_pool()
        .map_err(ApiError::unavailable)?
        .get()
        .await
        .map_err(ApiError::unavailable)?;
    let tx = connection.transaction().await.map_err(ApiError::internal)?;
    let result = persist_cost(&tx, &scope, batch, &prepared).await?;
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(json!({ "data": result })))
}

pub(crate) struct PreparedCost {
    line_id: u64,
    source: CostSource,
    organization: u64,
    company: u64,
    pub proof: Value,
}

pub(crate) async fn preview_cost(
    state: &AppState,
    session: &ApiSession,
    scope: &FarmScope,
    line: u64,
    kind: CostKind,
    expense_report: Option<u64>,
    basis: &str,
) -> Result<PreparedCost, ApiError> {
    let basis = basis.trim();
    if line == 0
        || expense_report == Some(0)
        || (kind == CostKind::ExpenseReport) != expense_report.is_some()
        || basis.is_empty()
        || basis.len() > 512
        || basis.chars().any(char::is_control)
    {
        return Err(ApiError::BadRequest(
            "Enter an exact positive journal line, allocation basis and case-appropriate report ID"
                .into(),
        ));
    }
    let source = CostSource {
        kind,
        expense_report_id: expense_report.map(|value| value.to_string()),
        allocation_basis: basis.to_string(),
    };
    let context = context(state, session, scope.company)?;
    if context.organization_id() != scope.organization || context.actor_identity() != scope.actor {
        return Err(ApiError::Forbidden("Farm account scope mismatch".into()));
    }
    let reader = NativeReader {
        context: &context,
        scope,
    };
    let proof = verify_cost(&reader, line, &source).await?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(PreparedCost {
        line_id: line,
        source,
        organization: scope.organization,
        company: scope.company,
        proof,
    })
}

pub(crate) async fn persist_cost(
    tx: &deadpool_postgres::Transaction<'_>,
    scope: &FarmScope,
    batch: i64,
    prepared: &PreparedCost,
) -> Result<Value, ApiError> {
    if scope.organization != prepared.organization || scope.company != prepared.company {
        return Err(ApiError::Forbidden("Farm account scope mismatch".into()));
    }
    lock_batch(tx, scope, batch).await?;
    let organization = scope.organization.to_string();
    let company = scope.company.to_string();
    let line = prepared.line_id.to_string();
    let source = serde_json::to_value(&prepared.source).map_err(ApiError::internal)?;
    tx.execute(
        "INSERT INTO lumiere_platform.farm_cost_link
        (organization_id, company_id, journal_line_id, batch_id, source, linked_by)
        VALUES ($1::text::numeric, $2::text::numeric, $3::text::numeric, $4, $5, $6)
        ON CONFLICT DO NOTHING",
        &[
            &organization,
            &company,
            &line,
            &batch,
            &source,
            &scope.actor,
        ],
    )
    .await
    .map_err(ApiError::internal)?;
    let stored = tx.query_one("SELECT batch_id, source, linked_at::text FROM lumiere_platform.farm_cost_link
        WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND journal_line_id=$3::text::numeric",
        &[&organization, &company, &line],
    ).await.map_err(ApiError::internal)?;
    let stored_batch: i64 = stored.get(0);
    let stored_source: Value = stored.get(1);
    if stored_batch != batch || stored_source != source {
        return Err(ApiError::Conflict(
            "This journal line already has a farm allocation".into(),
        ));
    }
    let mut proof = prepared.proof.clone();
    proof["linkedAt"] = json!(stored.get::<_, String>(2));
    proof["status"] = json!("verified");
    Ok(proof)
}

pub(super) async fn read_cost_rows<C: deadpool_postgres::GenericClient + Sync>(
    connection: &C,
    scope: &FarmScope,
    batch: i64,
    before: Option<u64>,
    report_access: bool,
    limit: i64,
) -> Result<Vec<tokio_postgres::Row>, ApiError> {
    let before = before.map(|value| value.to_string());
    connection
        .query(
            "SELECT journal_line_id::text, source, linked_at::text FROM lumiere_platform.farm_cost_link
             WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND batch_id=$3
             AND ($4::text IS NULL OR journal_line_id < $4::text::numeric)
             AND ($5 OR source->>'kind' <> 'expense_report')
             ORDER BY journal_line_id DESC LIMIT $6",
            &[
                &scope.organization.to_string(),
                &scope.company.to_string(),
                &batch,
                &before,
                &report_access,
                &limit,
            ],
        )
        .await
        .map_err(ApiError::internal)
}

async fn read_links(
    State(state): State<Arc<AppState>>,
    Path(batch): Path<i64>,
    Query(query): Query<LinkQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let batch = checked_batch_id(batch)?;
    if query
        .before_processing_event_id
        .is_some_and(|value| value <= 0)
        || query.before_cost_journal_line_id == Some(0)
    {
        return Err(ApiError::BadRequest(
            "Farm link cursors must be positive IDs".into(),
        ));
    }
    let scope = authorize(&state, &session, query.company_id, FarmAccess::Read).await?;
    let context = context(&state, &session, query.company_id)?;
    let reader = NativeReader {
        context: &context,
        scope: &scope,
    };
    let processing_access = processing::allows(&reader);
    let cost_access = reader.allows_cost_lines();
    let report_access = reader.allows_expense_reports();
    let organization = scope.organization.to_string();
    let company = scope.company.to_string();
    let connection = pg_pool::required_pool()
        .map_err(ApiError::unavailable)?
        .get()
        .await
        .map_err(ApiError::unavailable)?;
    if connection
        .query_opt(
            "SELECT id FROM lumiere_platform.farm_batch
        WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND id=$3",
            &[&organization, &company, &batch],
        )
        .await
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::NotFound("Farm batch not found".into()));
    }
    let limit = (PAGE_SIZE + 1) as i64;
    let processing = if processing_access {
        connection.query("SELECT event_id, manufacturing_order_id::text, live_lot_id::text,
            output_lot_id::text, evidence, linked_at::text FROM lumiere_platform.farm_processing_link
            WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND batch_id=$3
            AND ($4::bigint IS NULL OR event_id < $4)
            ORDER BY event_id DESC LIMIT $5",
            &[&organization, &company, &batch, &query.before_processing_event_id, &limit],
        ).await.map_err(ApiError::internal)?
    } else {
        Vec::new()
    };
    let costs = if cost_access {
        read_cost_rows(
            &connection,
            &scope,
            batch,
            query.before_cost_journal_line_id,
            report_access,
            limit,
        )
        .await?
    } else {
        Vec::new()
    };
    drop(connection);

    let mut cost_results = Vec::new();
    for row in costs.iter().take(PAGE_SIZE) {
        let journal_line: String = row.get("journal_line_id");
        let linked_at: String = row.get("linked_at");
        let origin = serde_json::from_value(row.get("source")).map_err(ApiError::internal)?;
        let line = journal_line.parse().map_err(ApiError::internal)?;
        match verify_cost(&reader, line, &origin).await {
            Ok(mut proof) => {
                proof["linkedAt"] = json!(linked_at);
                proof["status"] = json!("verified");
                cost_results.push(proof);
            }
            Err(ApiError::NotFound(_) | ApiError::Conflict(_)) => {
                cost_results.push(json!({
                    "journalLineId": journal_line,
                    "linkedAt": linked_at,
                    "status": "source_unavailable",
                }));
            }
            Err(error) => return Err(error),
        }
    }
    context.require_current_placement(&state.organization_placements)?;
    let next_processing = (processing.len() > PAGE_SIZE).then(|| {
        processing[PAGE_SIZE - 1]
            .get::<_, i64>("event_id")
            .to_string()
    });
    let next_cost =
        (costs.len() > PAGE_SIZE).then(|| costs[PAGE_SIZE - 1].get::<_, String>("journal_line_id"));
    Ok(Json(json!({ "data": {
        "processingLinks": processing.iter().take(PAGE_SIZE).map(processing::row).collect::<Vec<_>>(),
        "costLinks": cost_results,
        "nextProcessingBeforeEventId": next_processing,
        "nextCostBeforeJournalLineId": next_cost,
        "processingAccess": if processing_access { "allowed" } else { "restricted" },
        "costAccess": if cost_access { "allowed" } else { "restricted" },
    }})))
}
