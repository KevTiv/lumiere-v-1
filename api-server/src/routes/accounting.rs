//! `/v1/accounting/*` — parity with `frontend/web/app/api/accounting/*/route.ts`.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post, put},
    Json, Router,
};
use serde::{de::Error as _, Deserialize, Deserializer};
use serde_json::{json, Value};
use stdb_auth::has_resource_read_permission;
use tower_cookies::Cookies;

use crate::commands::{
    dispatch_historical_payment_allocations, dispatch_session_reducer,
    historical_payment_allocations_contract,
};
use crate::error::ApiError;
use crate::query_exec::{
    execute_authorized_resource_record, execute_resource_query, resolve_membership_company_id,
};
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::{require_org, resolve_session, OrgSession};

const MANUAL_INVOICE_ACTION: &str = "create_manual_account_invoice";
const MAX_HISTORICAL_PAYMENT_ALLOCATIONS: usize = 500;
const MAX_HISTORICAL_PAYMENT_IDEMPOTENCY_KEY_BYTES: usize = 256;
const MAX_HISTORICAL_PAYMENT_METADATA_BYTES: usize = 16_384;
// Version of this dedicated endpoint's admitted reducer signature. Unrelated
// generated-contract releases do not change this protocol version.
const HISTORICAL_PAYMENT_CONTRACT_VERSION: &str = "0.3.108";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct HistoricalPaymentAllocationsBody {
    params: HistoricalPaymentAllocationsParams,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct HistoricalPaymentAllocationsParams {
    #[serde(alias = "idempotencyKey")]
    idempotency_key: String,
    #[serde(alias = "companyId")]
    company_id: u64,
    #[serde(alias = "paymentTransactionId")]
    payment_transaction_id: u64,
    #[serde(alias = "currencyId")]
    currency_id: u64,
    allocations: Vec<HistoricalPaymentAllocationInput>,
    #[serde(default, deserialize_with = "deserialize_optional_sats_string")]
    metadata: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct HistoricalPaymentAllocationInput {
    #[serde(alias = "documentMoveId")]
    document_move_id: u64,
    #[serde(alias = "allocatedAmount")]
    allocated_amount: f64,
    #[serde(alias = "expectedResidualAfter")]
    expected_residual_after: f64,
    #[serde(alias = "completesDocumentHistory")]
    completes_document_history: bool,
}

fn deserialize_optional_sats_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::Null => Ok(None),
        Value::String(value) => Ok(Some(value)),
        Value::Object(fields) if fields.len() == 1 => {
            if let Some(value) = fields.get("some").and_then(Value::as_str) {
                return Ok(Some(value.to_owned()));
            }
            if fields
                .get("none")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
            {
                return Ok(None);
            }
            Err(D::Error::custom(
                "metadata must be a string, null, or a valid SATS option",
            ))
        }
        _ => Err(D::Error::custom(
            "metadata must be a string, null, or a valid SATS option",
        )),
    }
}

fn validate_historical_payment_allocations(
    params: &HistoricalPaymentAllocationsParams,
) -> Result<(), ApiError> {
    if params.company_id == 0 || params.payment_transaction_id == 0 || params.currency_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId, paymentTransactionId, and currencyId must be positive integers".into(),
        ));
    }
    let key = params.idempotency_key.as_str();
    if key.is_empty()
        || key.trim() != key
        || key.len() > MAX_HISTORICAL_PAYMENT_IDEMPOTENCY_KEY_BYTES
        || key.chars().any(char::is_control)
    {
        return Err(ApiError::BadRequest(
            "idempotencyKey must be trimmed, non-empty, control-free, and at most 256 bytes".into(),
        ));
    }
    if params.allocations.is_empty()
        || params.allocations.len() > MAX_HISTORICAL_PAYMENT_ALLOCATIONS
    {
        return Err(ApiError::BadRequest(format!(
            "allocations must contain 1..={MAX_HISTORICAL_PAYMENT_ALLOCATIONS} entries"
        )));
    }
    if params
        .metadata
        .as_ref()
        .is_some_and(|metadata| metadata.len() > MAX_HISTORICAL_PAYMENT_METADATA_BYTES)
    {
        return Err(ApiError::BadRequest(format!(
            "metadata must be at most {MAX_HISTORICAL_PAYMENT_METADATA_BYTES} bytes"
        )));
    }

    let mut document_ids = std::collections::BTreeSet::new();
    for allocation in &params.allocations {
        if allocation.document_move_id == 0 {
            return Err(ApiError::BadRequest(
                "documentMoveId must be a positive integer".into(),
            ));
        }
        if !allocation.allocated_amount.is_finite() || allocation.allocated_amount <= 0.0 {
            return Err(ApiError::BadRequest(
                "allocatedAmount must be a finite positive number".into(),
            ));
        }
        if !allocation.expected_residual_after.is_finite()
            || allocation.expected_residual_after < 0.0
        {
            return Err(ApiError::BadRequest(
                "expectedResidualAfter must be a finite non-negative number".into(),
            ));
        }
        if !document_ids.insert(allocation.document_move_id) {
            return Err(ApiError::BadRequest(
                "each documentMoveId may appear only once per payment".into(),
            ));
        }
    }
    Ok(())
}

fn historical_payment_reducer_params(params: &HistoricalPaymentAllocationsParams) -> Value {
    let metadata = params
        .metadata
        .as_ref()
        .map_or_else(|| json!({ "none": [] }), |value| json!({ "some": value }));
    json!({
        "idempotency_key": params.idempotency_key,
        "company_id": params.company_id,
        "payment_transaction_id": params.payment_transaction_id,
        "currency_id": params.currency_id,
        "allocations": params.allocations.iter().map(|allocation| json!({
            "document_move_id": allocation.document_move_id,
            "allocated_amount": allocation.allocated_amount,
            "expected_residual_after": allocation.expected_residual_after,
            "completes_document_history": allocation.completes_document_history,
        })).collect::<Vec<_>>(),
        "metadata": metadata,
    })
}

async fn historical_payment_allocations_post(
    State(state): State<Arc<AppState>>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Json(body): Json<HistoricalPaymentAllocationsBody>,
) -> Result<Json<Value>, ApiError> {
    validate_historical_payment_allocations(&body.params)?;
    let payment_transaction_id = body.params.payment_transaction_id;
    let params = historical_payment_reducer_params(&body.params);
    dispatch_historical_payment_allocations(&state, &session, json!([organization_id, params]))
        .await?;
    Ok(Json(json!({
        "data": {
            "message": "Historical payment allocations applied successfully",
            "paymentTransactionId": payment_transaction_id,
        }
    })))
}

fn historical_payment_allocations_capability() -> Value {
    json!({
        "data": {
            "reducerName": "apply_historical_payment_allocations",
            "operationId": "erp.apply_historical_payment_allocations",
            "contractVersion": HISTORICAL_PAYMENT_CONTRACT_VERSION,
            "signatureReady": historical_payment_allocations_contract().is_ok(),
        }
    })
}

async fn historical_payment_allocations_capability_get(
    _: OrgSession,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(historical_payment_allocations_capability()))
}

fn validate_manual_invoice_idempotency_key(value: &str) -> Result<(), ApiError> {
    if value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "manual invoice idempotency key must be 32 lowercase hexadecimal characters".into(),
        ))
    }
}

fn receipt_result_id(rows: &[Value]) -> Result<Option<u64>, ApiError> {
    if rows.len() > 1 {
        return Err(ApiError::Internal(
            "multiple manual invoice receipts matched one exact request key".into(),
        ));
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let table = row
        .get("result_table")
        .or_else(|| row.get("resultTable"))
        .and_then(Value::as_str);
    if table != Some("account_move") {
        return Err(ApiError::Internal(
            "manual invoice receipt has an unexpected result resource".into(),
        ));
    }
    let value = row
        .get("result_id")
        .or_else(|| row.get("resultId"))
        .ok_or_else(|| ApiError::Internal("manual invoice receipt has no result id".into()))?;
    let id = value
        .as_u64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiError::Internal("manual invoice receipt result id is invalid".into()))?;
    Ok(Some(id))
}

async fn manual_invoice_result_get(
    State(state): State<Arc<AppState>>,
    Path((company_id, idempotency_key)): Path<(u64, String)>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    validate_manual_invoice_idempotency_key(&idempotency_key)?;
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    if !has_resource_read_permission(Some(context.field_access()), "account-moves") {
        return Err(ApiError::Forbidden(
            "Read permission denied for resource 'account-moves'".into(),
        ));
    }
    let company_id = resolve_membership_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(company_id),
        "manual invoice result company scope mismatch",
    )
    .await?;
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT result_table, result_id FROM accounting_operation_receipt WHERE organization_id = {organization_id} AND company_id = {company_id} AND action_kind = '{MANUAL_INVOICE_ACTION}' AND idempotency_key = '{idempotency_key}'"
        ))
        .await
        .map_err(ApiError::internal)?;
    let Some(move_id) = receipt_result_id(&rows)? else {
        return Ok(Json(json!({ "data": null })));
    };
    let move_row = execute_authorized_resource_record(
        context.client(),
        "account-moves",
        organization_id,
        company_id,
        move_id,
        Some(context.field_access()),
    )
    .await?;
    if move_row.is_none() {
        return Ok(Json(json!({ "data": null })));
    }
    Ok(Json(json!({
        "data": {
            "resource": "account-moves",
            "id": move_id.to_string(),
            "href": format!("/accounting/invoices/{move_id}"),
        }
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountsListQuery {
    code: Option<String>,
    search: Option<String>,
    #[serde(default)]
    limit: Option<u64>,
    #[serde(default)]
    offset: Option<u64>,
}

fn paginate_limit_offset(limit: Option<u64>, offset: Option<u64>) -> (usize, usize) {
    let limit = limit.unwrap_or(50).min(100).max(1) as usize;
    let offset = offset.unwrap_or(0) as usize;
    (limit, offset)
}

fn list_meta(total: usize, offset: usize, limit: usize) -> Value {
    json!({
        "total": total,
        "page": (offset / limit).saturating_add(1),
        "limit": limit,
    })
}

async fn accounts_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<AccountsListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    let client = trusted.client();
    let mut rows = execute_resource_query(
        &client,
        "account-accounts",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    rows.sort_by(|a, b| {
        let ca = a
            .get("code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        let cb = b
            .get("code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        ca.cmp(&cb)
    });

    if let Some(ref prefix) = q.code {
        rows.retain(|r| {
            r.get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .starts_with(prefix)
        });
    }
    if let Some(ref term) = q.search {
        let t = term.to_lowercase();
        rows.retain(|r| {
            let code = r
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let name = r
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            code.contains(&t) || name.contains(&t)
        });
    }

    let total = rows.len();
    let page_rows: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": page_rows, "meta": list_meta(total, offset, limit) }),
    ))
}

async fn accounts_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;

    body.get("name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::BadRequest("Name is required".into()))?;

    dispatch_session_reducer(
        &state,
        &session,
        "create_account_account",
        json!([org_id, body]),
    )
    .await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Account created successfully" } })),
    ))
}

fn to_unit_enum(value: &Value) -> Result<Value, ApiError> {
    match value {
        Value::String(s) => Ok(json!({ s: [] })),
        _ => Err(ApiError::BadRequest("expected enum variant string".into())),
    }
}

#[derive(Debug, Deserialize)]
struct PaymentListQuery {
    #[serde(default)]
    limit: Option<u64>,
    #[serde(default)]
    offset: Option<u64>,
}

fn payment_account_create_params(body: &Value) -> Result<Value, ApiError> {
    let company_id = body
        .get("company_id")
        .ok_or_else(|| ApiError::BadRequest("missing company_id".into()))?
        .clone();
    let provider_code = body
        .get("provider_code")
        .ok_or_else(|| ApiError::BadRequest("missing provider_code".into()))?;
    let name = body
        .get("name")
        .ok_or_else(|| ApiError::BadRequest("missing name".into()))?
        .clone();
    let reference_raw = body.get("reference_raw").cloned().unwrap_or(Value::Null);
    let currency_id = body
        .get("currency_id")
        .ok_or_else(|| ApiError::BadRequest("missing currency_id".into()))?
        .clone();
    let account_journal_id = body
        .get("account_journal_id")
        .ok_or_else(|| ApiError::BadRequest("missing account_journal_id".into()))?
        .clone();
    Ok(json!({
        "company_id": company_id,
        "provider_code": to_unit_enum(provider_code)?,
        "name": name,
        "provider_label": body.get("provider_label").cloned().unwrap_or(Value::Null),
        "reference_raw": reference_raw,
        "currency_id": currency_id,
        "account_journal_id": account_journal_id,
        "fee_account_id": body.get("fee_account_id").cloned().unwrap_or(Value::Null),
        "clearing_account_id": body.get("clearing_account_id").cloned().unwrap_or(Value::Null),
        "is_primary": body.get("is_primary").cloned().unwrap_or(json!(false)),
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    }))
}

async fn payment_accounts_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<PaymentListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    let client = trusted.client();
    let rows = execute_resource_query(
        &client,
        "payment-accounts",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let total = rows.len();
    let data: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": data, "meta": list_meta(total, offset, limit) }),
    ))
}

async fn payment_accounts_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = payment_account_create_params(&body)?;
    dispatch_session_reducer(
        &state,
        &session,
        "create_payment_account",
        json!([org_id, params]),
    )
    .await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Payment account created successfully" } })),
    ))
}

async fn payment_account_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<u64>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    dispatch_session_reducer(
        &state,
        &session,
        "update_payment_account",
        json!([org_id, id, body]),
    )
    .await?;
    Ok(Json(
        json!({ "data": { "message": "Payment account updated successfully" } }),
    ))
}

async fn payment_account_archive(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    dispatch_session_reducer(
        &state,
        &session,
        "archive_payment_account",
        json!([org_id, id]),
    )
    .await?;
    Ok(Json(
        json!({ "data": { "message": "Payment account archived successfully" } }),
    ))
}

fn payment_transaction_create_params(body: &Value) -> Result<Value, ApiError> {
    let company_id = body
        .get("company_id")
        .ok_or_else(|| ApiError::BadRequest("missing company_id".into()))?
        .clone();
    let payment_account_id = body
        .get("payment_account_id")
        .ok_or_else(|| ApiError::BadRequest("missing payment_account_id".into()))?
        .clone();
    let direction = body
        .get("direction")
        .ok_or_else(|| ApiError::BadRequest("missing direction".into()))?;
    let partner_type = body
        .get("partner_type")
        .ok_or_else(|| ApiError::BadRequest("missing partner_type".into()))?;
    let partner_id = body
        .get("partner_id")
        .ok_or_else(|| ApiError::BadRequest("missing partner_id".into()))?
        .clone();
    Ok(json!({
        "company_id": company_id,
        "payment_account_id": payment_account_id,
        "direction": to_unit_enum(direction)?,
        "partner_type": to_unit_enum(partner_type)?,
        "partner_id": partner_id,
        "external_reference": body.get("external_reference").cloned().unwrap_or(Value::Null),
        "gross_external_amount": body.get("gross_external_amount").cloned().unwrap_or(json!(0.0)),
        "settlement_amount": body.get("settlement_amount").cloned().unwrap_or(json!(0.0)),
        "net_account_amount": body.get("net_account_amount").cloned().unwrap_or(json!(0.0)),
        "currency_id": body.get("currency_id").cloned().unwrap_or(json!(0)),
        "occurred_at": body.get("occurred_at").cloned().unwrap_or(Value::Null),
        "source_entity": body.get("source_entity").cloned().unwrap_or(Value::Null),
        "source_entity_id": body.get("source_entity_id").cloned().unwrap_or(Value::Null),
        "evidence_document_ids": body.get("evidence_document_ids").cloned().unwrap_or(json!([])),
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    }))
}

async fn payment_transactions_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<PaymentListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    let client = trusted.client();
    let rows = execute_resource_query(
        &client,
        "payment-transactions",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let total = rows.len();
    let data: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": data, "meta": list_meta(total, offset, limit) }),
    ))
}

async fn payment_transactions_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = payment_transaction_create_params(&body)?;
    dispatch_session_reducer(
        &state,
        &session,
        "create_payment_transaction",
        json!([org_id, params]),
    )
    .await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Payment transaction created successfully" } })),
    ))
}

async fn payment_transaction_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<u64>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    dispatch_session_reducer(
        &state,
        &session,
        "update_payment_transaction",
        json!([org_id, id, body]),
    )
    .await?;
    Ok(Json(
        json!({ "data": { "message": "Payment transaction updated successfully" } }),
    ))
}

async fn payment_transaction_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    dispatch_session_reducer(
        &state,
        &session,
        "post_payment_transaction",
        json!([org_id, id]),
    )
    .await?;
    Ok(Json(
        json!({ "data": { "message": "Payment transaction posted successfully" } }),
    ))
}

async fn payment_transaction_void(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    dispatch_session_reducer(
        &state,
        &session,
        "void_payment_transaction",
        json!([org_id, id]),
    )
    .await?;
    Ok(Json(
        json!({ "data": { "message": "Payment transaction voided successfully" } }),
    ))
}

fn payment_fee_create_params(body: &Value) -> Result<Value, ApiError> {
    let bearer = body
        .get("bearer")
        .ok_or_else(|| ApiError::BadRequest("missing bearer".into()))?;
    Ok(json!({
        "company_id": body.get("company_id").cloned().unwrap_or(json!(0)),
        "payment_transaction_id": body.get("payment_transaction_id").cloned().unwrap_or(json!(0)),
        "bearer": to_unit_enum(bearer)?,
        "amount": body.get("amount").cloned().unwrap_or(json!(0.0)),
        "currency_id": body.get("currency_id").cloned().unwrap_or(json!(0)),
        "fee_account_id": body.get("fee_account_id").cloned().unwrap_or(Value::Null),
        "tax_account_id": body.get("tax_account_id").cloned().unwrap_or(Value::Null),
        "tax_amount": body.get("tax_amount").cloned().unwrap_or(json!(0.0)),
        "provider_reference": body.get("provider_reference").cloned().unwrap_or(Value::Null),
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    }))
}

async fn payment_transaction_fee_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(_id): Path<u64>,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = payment_fee_create_params(&body)?;
    dispatch_session_reducer(
        &state,
        &session,
        "create_payment_fee",
        json!([org_id, params]),
    )
    .await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Payment fee added successfully" } })),
    ))
}

async fn payment_transaction_allocate_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(_id): Path<u64>,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    dispatch_session_reducer(
        &state,
        &session,
        "allocate_payment_transaction",
        json!([org_id, body]),
    )
    .await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Payment allocated successfully" } })),
    ))
}

async fn payment_transaction_reverse_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<u64>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    dispatch_session_reducer(
        &state,
        &session,
        "reverse_payment_transaction",
        json!([org_id, id, body]),
    )
    .await?;
    Ok(Json(
        json!({ "data": { "message": "Payment transaction reversed successfully" } }),
    ))
}

async fn payment_reconciliations_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<PaymentListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    let client = trusted.client();
    let rows = execute_resource_query(
        &client,
        "payment-reconciliations",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let total = rows.len();
    let data: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": data, "meta": list_meta(total, offset, limit) }),
    ))
}

async fn payment_reversals_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<PaymentListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    let client = trusted.client();
    let rows = execute_resource_query(
        &client,
        "payment-reversals",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let total = rows.len();
    let data: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": data, "meta": list_meta(total, offset, limit) }),
    ))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/accounting/accounts",
            get(accounts_get).post(accounts_post),
        )
        .route(
            "/accounting/payment-accounts",
            get(payment_accounts_get).post(payment_accounts_post),
        )
        .route("/accounting/payment-accounts/:id", put(payment_account_put))
        .route(
            "/accounting/payment-accounts/:id/archive",
            post(payment_account_archive),
        )
        .route(
            "/accounting/payment-transactions",
            get(payment_transactions_get).post(payment_transactions_post),
        )
        .route(
            "/accounting/payment-transactions/:id",
            put(payment_transaction_put),
        )
        .route(
            "/accounting/payment-transactions/:id/post",
            post(payment_transaction_post),
        )
        .route(
            "/accounting/payment-transactions/:id/void",
            post(payment_transaction_void),
        )
        .route(
            "/accounting/payment-transactions/:id/fees",
            post(payment_transaction_fee_post),
        )
        .route(
            "/accounting/payment-transactions/:id/allocate",
            post(payment_transaction_allocate_post),
        )
        .route(
            "/accounting/payment-transactions/:id/reverse",
            post(payment_transaction_reverse_post),
        )
        .route(
            "/accounting/payment-reconciliations",
            get(payment_reconciliations_get),
        )
        .route("/accounting/payment-reversals", get(payment_reversals_get))
        .route(
            "/accounting/historical-payment-allocations",
            post(historical_payment_allocations_post),
        )
        .route(
            "/accounting/historical-payment-allocations/capability",
            get(historical_payment_allocations_capability_get),
        )
        .route(
            "/accounting/manual-invoice-results/:company_id/:idempotency_key",
            get(manual_invoice_result_get),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_invoice_result_key_is_exact_lowercase_hex() {
        assert!(
            validate_manual_invoice_idempotency_key("0123456789abcdef0123456789abcdef").is_ok()
        );
        for invalid in [
            "0123456789abcdef",
            "0123456789ABCDEF0123456789ABCDEF",
            "g123456789abcdef0123456789abcdef",
            "0123456789abcdef0123456789abcdef0",
        ] {
            assert!(validate_manual_invoice_idempotency_key(invalid).is_err());
        }
    }

    #[test]
    fn manual_invoice_receipt_result_requires_zero_or_one_account_move() {
        assert_eq!(receipt_result_id(&[]).unwrap(), None);
        assert_eq!(
            receipt_result_id(&[json!({ "result_table": "account_move", "result_id": "42" })])
                .unwrap(),
            Some(42),
        );
        assert!(receipt_result_id(&[
            json!({ "result_table": "account_move", "result_id": 42 }),
            json!({ "result_table": "account_move", "result_id": 42 }),
        ])
        .is_err());
        assert!(
            receipt_result_id(&[json!({ "result_table": "contact", "result_id": 42 })]).is_err()
        );
    }

    fn valid_historical_payment_body() -> HistoricalPaymentAllocationsBody {
        serde_json::from_value(json!({
            "params": {
                "idempotency_key": "rw-alpha-history-22-44",
                "company_id": 11,
                "payment_transaction_id": 22,
                "currency_id": 33,
                "allocations": [{
                    "document_move_id": 44,
                    "allocated_amount": 200000.0,
                    "expected_residual_after": 300000.0,
                    "completes_document_history": true
                }],
                "metadata": { "some": "{\"source\":\"rwanda-alpha\"}" }
            }
        }))
        .expect("valid historical payment body")
    }

    #[test]
    fn historical_payment_body_accepts_generated_and_api_field_shapes() {
        let generated = valid_historical_payment_body();
        assert!(validate_historical_payment_allocations(&generated.params).is_ok());
        assert_eq!(
            historical_payment_reducer_params(&generated.params)["metadata"],
            json!({ "some": "{\"source\":\"rwanda-alpha\"}" })
        );

        let camel: HistoricalPaymentAllocationsBody = serde_json::from_value(json!({
            "params": {
                "idempotencyKey": "history-1",
                "companyId": 11,
                "paymentTransactionId": 22,
                "currencyId": 33,
                "allocations": [{
                    "documentMoveId": 44,
                    "allocatedAmount": 20.0,
                    "expectedResidualAfter": 30.0,
                    "completesDocumentHistory": false
                }],
                "metadata": null
            }
        }))
        .expect("camel-case API body");
        assert_eq!(camel.params.company_id, 11);
        assert_eq!(
            historical_payment_reducer_params(&camel.params)["metadata"],
            json!({ "none": [] })
        );
    }

    #[test]
    fn historical_payment_body_rejects_authority_and_contract_spoofing() {
        for extra in [
            json!({ "organizationId": 99 }),
            json!({ "reducer": "apply_global_migrations" }),
            json!({ "actorIdentity": "forged" }),
        ] {
            let mut request = json!({
                "params": {
                    "idempotencyKey": "history-1",
                    "companyId": 11,
                    "paymentTransactionId": 22,
                    "currencyId": 33,
                    "allocations": [{
                        "documentMoveId": 44,
                        "allocatedAmount": 20.0,
                        "expectedResidualAfter": 30.0,
                        "completesDocumentHistory": true
                    }]
                }
            });
            request
                .as_object_mut()
                .expect("request object")
                .extend(extra.as_object().expect("extra object").clone());
            assert!(serde_json::from_value::<HistoricalPaymentAllocationsBody>(request).is_err());
        }
    }

    #[test]
    fn historical_payment_validation_rejects_unsafe_batches() {
        let mut body = valid_historical_payment_body();
        body.params.idempotency_key = " padded ".into();
        assert!(matches!(
            validate_historical_payment_allocations(&body.params),
            Err(ApiError::BadRequest(_))
        ));

        let mut body = valid_historical_payment_body();
        body.params
            .allocations
            .push(HistoricalPaymentAllocationInput {
                document_move_id: 44,
                allocated_amount: 1.0,
                expected_residual_after: 299999.0,
                completes_document_history: true,
            });
        assert!(matches!(
            validate_historical_payment_allocations(&body.params),
            Err(ApiError::BadRequest(_))
        ));

        let mut body = valid_historical_payment_body();
        body.params.allocations[0].allocated_amount = 0.0;
        assert!(matches!(
            validate_historical_payment_allocations(&body.params),
            Err(ApiError::BadRequest(_))
        ));

        let mut body = valid_historical_payment_body();
        body.params.company_id = 0;
        assert!(matches!(
            validate_historical_payment_allocations(&body.params),
            Err(ApiError::BadRequest(_))
        ));
    }

    #[test]
    fn historical_payment_capability_is_pinned_to_the_admitted_signature() {
        assert!(historical_payment_allocations_contract().is_ok());
        assert_eq!(HISTORICAL_PAYMENT_CONTRACT_VERSION, "0.3.108");
        assert_eq!(
            historical_payment_allocations_capability(),
            json!({
                "data": {
                    "reducerName": "apply_historical_payment_allocations",
                    "operationId": "erp.apply_historical_payment_allocations",
                    "contractVersion": "0.3.108",
                    "signatureReady": true,
                }
            })
        );
    }
}
