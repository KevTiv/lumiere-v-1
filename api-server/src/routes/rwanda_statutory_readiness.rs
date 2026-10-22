//! Read-only canonical invoice checks. This route never prepares a wire payload,
//! reserves a fiscal number, changes accounting state, or contacts VSDC.

use std::{collections::BTreeMap, collections::BTreeSet, sync::Arc};

use axum::{extract::Path, extract::State, routing::get, Json, Router};
use serde::Serialize;
use serde_json::{json, Value};
use stdb_auth::{
    has_resource_read_permission, registry_get, select_org_and_company_scoped_sql,
    FieldAccessContext,
};

use crate::{
    document_render::invoice::document_snapshot,
    error::ApiError,
    query_exec::{execute_authorized_resource_record, resolve_accounting_company_id},
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};

const MAX_LINES: usize = 500;
const INVOICE_RESOURCE: &str = "account-moves";
const LINE_RESOURCE: &str = "account-move-lines";
const EXECUTION_BLOCKERS: [&str; 5] = [
    "sandbox_enrollment",
    "reviewed_mapping",
    "country_pack_acceptance",
    "certification",
    "durable_dispatch_not_implemented",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadinessReport {
    organization_id: String,
    company_id: String,
    invoice_id: String,
    // Projection/shape checks only; this is never a fiscal or ledger proof.
    canonical_data_available: bool,
    data_readiness: &'static str,
    data_blockers: Vec<Blocker>,
    execution_blockers: [&'static str; 5],
    ready_to_submit: bool,
}

#[derive(Debug, Serialize)]
struct Blocker {
    code: &'static str,
    fields: Vec<&'static str>,
}

#[derive(Default)]
struct Blockers(BTreeMap<&'static str, BTreeSet<&'static str>>);

impl Blockers {
    fn add(&mut self, code: &'static str, field: &'static str) {
        self.0.entry(code).or_default().insert(field);
    }

    fn finish(self) -> Vec<Blocker> {
        self.0
            .into_iter()
            .map(|(code, fields)| Blocker {
                code,
                fields: fields.into_iter().collect(),
            })
            .collect()
    }
}

// Conflicting serialized aliases are unavailable, never an invitation to choose
// whichever representation would pass a check.
fn cell<'a>(row: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    match (row.get(camel), row.get(snake)) {
        (Some(left), Some(right)) if left != right => None,
        (Some(value), _) | (_, Some(value)) => Some(value),
        _ => None,
    }
}

fn optional(value: &Value) -> Option<&Value> {
    match value {
        Value::Null => None,
        Value::Object(object) if object.len() == 1 => {
            let (tag, payload) = object.iter().next()?;
            match tag.as_str() {
                "some" | "Some" => match payload {
                    Value::Array(values) if values.len() == 1 => values.first(),
                    Value::Array(_) => None,
                    value => Some(value),
                },
                _ => None,
            }
        }
        Value::Object(_) => None,
        value => Some(value),
    }
}

fn id(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    let value = optional(cell(row, camel, snake)?)?;
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|value| *value > 0)
}

fn tag(value: Option<&Value>) -> Option<&str> {
    match value? {
        Value::String(value) => Some(value),
        Value::Object(object) if object.len() == 1 => {
            let (tag, payload) = object.iter().next()?;
            if tag == "tag" {
                return payload.as_str();
            }
            (payload.as_array().is_some_and(Vec::is_empty)
                || payload.as_object().is_some_and(serde_json::Map::is_empty))
            .then_some(tag.as_str())
        }
        _ => None,
    }
}

fn nullable_id(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Null) => true,
        Some(Value::Object(object))
            if object.len() == 1
                && object.iter().any(|(tag, value)| {
                    matches!(tag.as_str(), "none" | "None")
                        && value.as_array().is_some_and(Vec::is_empty)
                }) =>
        {
            true
        }
        Some(value) => optional(value).is_some_and(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str()?.parse().ok())
                .is_some_and(|id| id > 0)
        }),
        None => false,
    }
}

fn nullable_text(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Null) => true,
        Some(Value::Object(object))
            if object.len() == 1
                && object.iter().any(|(tag, value)| {
                    matches!(tag.as_str(), "none" | "None")
                        && value.as_array().is_some_and(Vec::is_empty)
                }) =>
        {
            true
        }
        Some(value) => optional(value).is_some_and(Value::is_string),
        None => false,
    }
}

fn timestamp_micros(value: &Value, depth: u8) -> Option<i64> {
    if depth > 3 {
        return None;
    }
    if let Some(value) = value.as_i64().or_else(|| value.as_str()?.parse().ok()) {
        return Some(value);
    }
    let object = value.as_object()?;
    if object.len() != 1 {
        return None;
    }
    let (key, value) = object.iter().next()?;
    match key.as_str() {
        "some" | "Some" => match value {
            Value::Array(values) if values.len() == 1 => timestamp_micros(&values[0], depth + 1),
            Value::Array(_) => None,
            value => timestamp_micros(value, depth + 1),
        },
        "__timestamp_micros_since_unix_epoch__" | "microsSinceUnixEpoch" => {
            timestamp_micros(value, depth + 1)
        }
        _ => None,
    }
}

fn require_scope(
    row: &Value,
    organization_id: u64,
    company_id: u64,
    expected_id: Option<u64>,
) -> Result<(), ApiError> {
    let organization = id(row, "organizationId", "organization_id");
    let company = id(row, "companyId", "company_id");
    let record = id(row, "id", "id");
    if organization.is_none() || company.is_none() || record.is_none() {
        return Err(ApiError::Forbidden(
            "canonical invoice scope is unavailable".into(),
        ));
    }
    if organization != Some(organization_id)
        || company != Some(company_id)
        || expected_id.is_some_and(|expected| record != Some(expected))
    {
        return Err(ApiError::NotFound("canonical invoice not found".into()));
    }
    Ok(())
}

fn line_sql(
    access: &FieldAccessContext,
    organization_id: u64,
    company_id: u64,
    move_id: u64,
) -> Result<String, ApiError> {
    if !has_resource_read_permission(Some(access), LINE_RESOURCE) {
        return Err(ApiError::Forbidden(
            "canonical invoice line read permission is required".into(),
        ));
    }
    let registry = registry_get(LINE_RESOURCE)
        .ok_or_else(|| ApiError::Internal("invoice line read contract is unavailable".into()))?;
    // This helper uses resolve_http_sql_columns, including the caller's field
    // restrictions and global exclusions. No required business fields are added.
    select_org_and_company_scoped_sql(
        LINE_RESOURCE,
        &registry.table,
        organization_id,
        company_id,
        Some(access),
        &format!(" AND move_id = {move_id}"),
        &format!(" LIMIT {}", MAX_LINES + 1),
    )
    .map_err(ApiError::Internal)
}

fn snapshot_blockers(invoice: &Value, blockers: &mut Blockers) {
    let Some(raw) = cell(invoice, "metadata", "metadata") else {
        blockers.add("canonical_field_unavailable", "account_move.metadata");
        return;
    };
    let metadata = optional(raw)
        .and_then(Value::as_str)
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
    let Some(snapshot) = metadata
        .as_ref()
        .and_then(|value| value.get("invoiceDocument"))
    else {
        blockers.add("invoice_snapshot_unavailable", "invoiceDocument");
        return;
    };
    if snapshot.get("schemaVersion").and_then(Value::as_u64) != Some(2) {
        blockers.add(
            "invoice_snapshot_version_unsupported",
            "invoiceDocument.schemaVersion",
        );
        return;
    }
    match document_snapshot(invoice) {
        Ok(Some(snapshot)) if snapshot.buyer.is_some() => {
            let tin = &snapshot.seller.tax_id;
            if tin.len() != 9 || !tin.bytes().all(|byte| byte.is_ascii_digit()) {
                blockers.add("seller_tin_invalid", "invoiceDocument.seller.taxId");
            }
        }
        _ => blockers.add("invoice_snapshot_invalid", "invoiceDocument"),
    }
}

fn assess(
    invoice: &Value,
    lines: &[Value],
    organization_id: u64,
    company_id: u64,
    move_id: u64,
) -> Result<ReadinessReport, ApiError> {
    require_scope(invoice, organization_id, company_id, Some(move_id))?;
    let mut blockers = Blockers::default();
    for (camel, snake, field) in [
        ("state", "state", "account_move.state"),
        ("moveType", "move_type", "account_move.move_type"),
        ("partnerId", "partner_id", "account_move.partner_id"),
        ("currencyId", "currency_id", "account_move.currency_id"),
        (
            "companyCurrencyId",
            "company_currency_id",
            "account_move.company_currency_id",
        ),
        ("invoiceDate", "invoice_date", "account_move.invoice_date"),
        (
            "amountUntaxed",
            "amount_untaxed",
            "account_move.amount_untaxed",
        ),
        ("amountTax", "amount_tax", "account_move.amount_tax"),
        ("amountTotal", "amount_total", "account_move.amount_total"),
    ] {
        if cell(invoice, camel, snake).is_none_or(Value::is_null) {
            blockers.add("canonical_field_unavailable", field);
        }
    }
    if cell(invoice, "invoiceDate", "invoice_date")
        .and_then(|value| timestamp_micros(value, 0))
        .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_micros)
        .is_none()
    {
        blockers.add("canonical_field_unavailable", "account_move.invoice_date");
    }
    if id(invoice, "currencyId", "currency_id")
        != id(invoice, "companyCurrencyId", "company_currency_id")
    {
        blockers.add("canonical_currency_unsupported", "account_move.currency_id");
    }
    for (camel, snake, field) in [
        ("partnerId", "partner_id", "account_move.partner_id"),
        ("currencyId", "currency_id", "account_move.currency_id"),
        (
            "companyCurrencyId",
            "company_currency_id",
            "account_move.company_currency_id",
        ),
    ] {
        if id(invoice, camel, snake).is_none() {
            blockers.add("canonical_field_unavailable", field);
        }
    }
    if tag(cell(invoice, "state", "state")) != Some("Posted") {
        blockers.add("invoice_not_posted", "account_move.state");
    }
    if tag(cell(invoice, "moveType", "move_type")) != Some("OutInvoice") {
        blockers.add("invoice_type_unsupported", "account_move.move_type");
    }
    for (camel, snake, field) in [
        (
            "amountUntaxed",
            "amount_untaxed",
            "account_move.amount_untaxed",
        ),
        ("amountTax", "amount_tax", "account_move.amount_tax"),
        ("amountTotal", "amount_total", "account_move.amount_total"),
    ] {
        if cell(invoice, camel, snake)
            .and_then(Value::as_f64)
            .is_none_or(|amount| !amount.is_finite() || amount < 0.0)
        {
            blockers.add("canonical_amount_unavailable", field);
        }
    }
    snapshot_blockers(invoice, &mut blockers);

    if lines.len() > MAX_LINES {
        blockers.add("canonical_line_set_too_large", "account_move_line");
    }
    let mut seen = BTreeSet::new();
    let mut commercial_lines = 0;
    for line in lines.iter().take(MAX_LINES + 1) {
        require_scope(line, organization_id, company_id, None)?;
        if id(line, "moveId", "move_id") != Some(move_id) {
            return Err(ApiError::Forbidden(
                "canonical invoice line scope is unavailable".into(),
            ));
        }
        if !seen.insert(id(line, "id", "id")) {
            blockers.add("canonical_line_set_ambiguous", "account_move_line.id");
        }
        for (camel, snake, field) in [
            ("sequence", "sequence", "account_move_line.sequence"),
            (
                "parentState",
                "parent_state",
                "account_move_line.parent_state",
            ),
            (
                "displayType",
                "display_type",
                "account_move_line.display_type",
            ),
            (
                "excludeFromInvoiceTab",
                "exclude_from_invoice_tab",
                "account_move_line.exclude_from_invoice_tab",
            ),
            (
                "accountInternalType",
                "account_internal_type",
                "account_move_line.account_internal_type",
            ),
            ("taxIds", "tax_ids", "account_move_line.tax_ids"),
            ("taxLineId", "tax_line_id", "account_move_line.tax_line_id"),
            (
                "taxBaseAmount",
                "tax_base_amount",
                "account_move_line.tax_base_amount",
            ),
            ("productId", "product_id", "account_move_line.product_id"),
            (
                "productUomId",
                "product_uom_id",
                "account_move_line.product_uom_id",
            ),
            ("quantity", "quantity", "account_move_line.quantity"),
            ("priceUnit", "price_unit", "account_move_line.price_unit"),
            (
                "priceSubtotal",
                "price_subtotal",
                "account_move_line.price_subtotal",
            ),
            ("priceTotal", "price_total", "account_move_line.price_total"),
            ("discount", "discount", "account_move_line.discount"),
            ("currencyId", "currency_id", "account_move_line.currency_id"),
            (
                "companyCurrencyId",
                "company_currency_id",
                "account_move_line.company_currency_id",
            ),
            ("accountId", "account_id", "account_move_line.account_id"),
            ("name", "name", "account_move_line.name"),
        ] {
            // Nullable discriminators must still be projected: absent is not None.
            if cell(line, camel, snake).is_none() {
                blockers.add("canonical_field_unavailable", field);
            }
        }
        if tag(cell(line, "parentState", "parent_state")) != Some("Posted") {
            blockers.add(
                "canonical_line_not_posted",
                "account_move_line.parent_state",
            );
        }
        for (camel, snake, field) in [
            ("quantity", "quantity", "account_move_line.quantity"),
            ("priceUnit", "price_unit", "account_move_line.price_unit"),
            (
                "priceSubtotal",
                "price_subtotal",
                "account_move_line.price_subtotal",
            ),
            ("priceTotal", "price_total", "account_move_line.price_total"),
            ("discount", "discount", "account_move_line.discount"),
            (
                "taxBaseAmount",
                "tax_base_amount",
                "account_move_line.tax_base_amount",
            ),
        ] {
            if cell(line, camel, snake)
                .and_then(Value::as_f64)
                .is_none_or(|number| !number.is_finite() || number < 0.0)
            {
                blockers.add("canonical_line_field_invalid", field);
            }
        }
        for (camel, snake, field) in [
            ("taxLineId", "tax_line_id", "account_move_line.tax_line_id"),
            ("productId", "product_id", "account_move_line.product_id"),
            (
                "productUomId",
                "product_uom_id",
                "account_move_line.product_uom_id",
            ),
        ] {
            if !nullable_id(cell(line, camel, snake)) {
                blockers.add("canonical_line_field_invalid", field);
            }
        }
        for (camel, snake, field) in [
            (
                "displayType",
                "display_type",
                "account_move_line.display_type",
            ),
            (
                "accountInternalType",
                "account_internal_type",
                "account_move_line.account_internal_type",
            ),
        ] {
            if !nullable_text(cell(line, camel, snake)) {
                blockers.add("canonical_line_field_invalid", field);
            }
        }
        let tax_ids = cell(line, "taxIds", "tax_ids").and_then(Value::as_array);
        if tax_ids.is_none_or(|ids| {
            let mut seen = BTreeSet::new();
            ids.iter()
                .any(|value| value.as_u64().is_none_or(|id| id == 0 || !seen.insert(id)))
        }) {
            blockers.add("canonical_line_field_invalid", "account_move_line.tax_ids");
        }
        if cell(line, "sequence", "sequence")
            .and_then(Value::as_u64)
            .is_none()
        {
            blockers.add("canonical_line_field_invalid", "account_move_line.sequence");
        }
        if id(line, "accountId", "account_id").is_none() {
            blockers.add(
                "canonical_line_field_invalid",
                "account_move_line.account_id",
            );
        }
        if cell(line, "name", "name")
            .and_then(Value::as_str)
            .is_none_or(|name| name.trim().is_empty())
        {
            blockers.add("canonical_line_field_invalid", "account_move_line.name");
        }
        for (camel, snake, field) in [
            ("currencyId", "currency_id", "account_move_line.currency_id"),
            (
                "companyCurrencyId",
                "company_currency_id",
                "account_move_line.company_currency_id",
            ),
        ] {
            if id(line, camel, snake).is_none()
                || id(line, camel, snake) != id(invoice, camel, snake)
            {
                blockers.add("canonical_line_currency_unsupported", field);
            }
        }
        match cell(line, "excludeFromInvoiceTab", "exclude_from_invoice_tab")
            .and_then(Value::as_bool)
        {
            Some(false)
                if cell(line, "displayType", "display_type")
                    .is_some_and(|value| optional(value).is_none())
                    && nullable_text(cell(line, "displayType", "display_type"))
                    && cell(line, "taxLineId", "tax_line_id")
                        .is_some_and(|value| optional(value).is_none())
                    && nullable_id(cell(line, "taxLineId", "tax_line_id")) =>
            {
                commercial_lines += 1;
                if cell(line, "quantity", "quantity")
                    .and_then(Value::as_f64)
                    .is_none_or(|quantity| quantity <= 0.0)
                {
                    blockers.add("canonical_line_field_invalid", "account_move_line.quantity");
                }
                if cell(line, "discount", "discount")
                    .and_then(Value::as_f64)
                    .is_some_and(|discount| discount > 100.0)
                {
                    blockers.add("canonical_line_field_invalid", "account_move_line.discount");
                }
                for (camel, snake, field) in [
                    ("productId", "product_id", "account_move_line.product_id"),
                    (
                        "productUomId",
                        "product_uom_id",
                        "account_move_line.product_uom_id",
                    ),
                ] {
                    if id(line, camel, snake).is_none() {
                        blockers.add("canonical_item_identity_unavailable", field);
                    }
                }
            }
            None => blockers.add(
                "canonical_line_field_invalid",
                "account_move_line.exclude_from_invoice_tab",
            ),
            _ => {}
        }
    }
    if lines.is_empty() {
        blockers.add("canonical_line_set_unavailable", "account_move_line");
    }
    if commercial_lines == 0 {
        blockers.add(
            "canonical_commercial_lines_unavailable",
            "account_move_line",
        );
    }
    let canonical_data_available = blockers.0.is_empty();
    // No authoritative fiscal item/tax snapshot exists yet. Arbitrary metadata,
    // mutable product codes and current tax rates cannot satisfy these blockers.
    for field in ["itemCd", "itemClsCd", "pkgUnitCd", "pkg", "qtyUnitCd"] {
        blockers.add("fiscal_item_metadata_unavailable", field);
    }
    for field in ["taxTyCd", "taxRtA", "taxRtB", "taxRtC", "taxRtD"] {
        blockers.add("fiscal_tax_metadata_unavailable", field);
    }
    Ok(ReadinessReport {
        organization_id: organization_id.to_string(),
        company_id: company_id.to_string(),
        invoice_id: move_id.to_string(),
        canonical_data_available,
        data_readiness: "blocked",
        data_blockers: blockers.finish(),
        execution_blockers: EXECUTION_BLOCKERS,
        ready_to_submit: false,
    })
}

async fn readiness_get(
    State(state): State<Arc<AppState>>,
    Path((company_id, move_id)): Path<(u64, u64)>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    if company_id == 0 || move_id == 0 {
        return Err(ApiError::BadRequest(
            "company and invoice IDs must be positive".into(),
        ));
    }
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    if !has_resource_read_permission(Some(context.field_access()), INVOICE_RESOURCE) {
        return Err(ApiError::Forbidden(
            "canonical invoice read permission is required".into(),
        ));
    }
    let company_id = resolve_accounting_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(company_id),
    )
    .await?;
    let context = context.with_company_scope(vec![company_id])?;
    let invoice = execute_authorized_resource_record(
        context.client(),
        INVOICE_RESOURCE,
        organization_id,
        company_id,
        move_id,
        Some(context.field_access()),
    )
    .await?
    .ok_or_else(|| ApiError::NotFound("canonical invoice not found".into()))?;
    require_scope(&invoice, organization_id, company_id, Some(move_id))?;
    let sql = line_sql(context.field_access(), organization_id, company_id, move_id)?;
    let lines = context
        .client()
        .query_sql(&sql)
        .await
        .map_err(ApiError::internal)?;
    let report = assess(&invoice, &lines, organization_id, company_id, move_id)?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(json!({ "data": report })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route(
        "/statutory-adapters/rw/companies/:company_id/invoices/:move_id/readiness",
        get(readiness_get),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use stdb_auth::FieldPermissionLike;

    fn invoice() -> Value {
        json!({"id":3,"organizationId":1,"companyId":2,"state":"Posted", "moveType":"OutInvoice",
            "partnerId":4,"currencyId":5,"companyCurrencyId":5,"invoiceDate":1,
            "amountUntaxed":100,"amountTax":18,"amountTotal":118,
            "metadata":json!({"invoiceDocument":{"schemaVersion":2,"profileVersionIds":{"organization":null,"company":null},
                "seller":{"name":"Private seller","address":[],"taxId":"123456789","registrationNumber":"","email":"","phone":"","website":""},
                "buyer":{"partnerId":"4","name":"Private buyer","address":[],"taxId":"","registrationNumber":"","email":"","phone":""},
                "profile":{"logoUrl":"","accent":"teal","email":"","phone":"","website":"","notice":"","terms":"","paymentInstructions":"","footer":""},"notes":"Private notes"}}).to_string()})
    }

    fn line() -> Value {
        json!({"id":6,"organizationId":1,"companyId":2,"moveId":3,"parentState":"Posted",
            "currencyId":5,"companyCurrencyId":5,"accountId":10,"name":"Private line",
            "sequence":1,"displayType":null,"excludeFromInvoiceTab":false,"accountInternalType":null,
            "taxIds":[7],"taxLineId":null,"taxBaseAmount":100,"productId":8,"productUomId":9,
            "quantity":1,"priceUnit":100,"priceSubtotal":100,"priceTotal":118,"discount":0})
    }

    fn codes(report: &ReadinessReport) -> Vec<&str> {
        report
            .data_blockers
            .iter()
            .map(|blocker| blocker.code)
            .collect()
    }

    #[test]
    fn canonical_facts_do_not_grant_fiscal_readiness_or_expose_content() {
        let invoice = invoice();
        let before = invoice.clone();
        let report = assess(&invoice, &[line()], 1, 2, 3).unwrap();
        assert!(report.canonical_data_available);
        assert!(!report.ready_to_submit);
        assert_eq!(report.execution_blockers, EXECUTION_BLOCKERS);
        assert!(codes(&report).contains(&"fiscal_item_metadata_unavailable"));
        assert!(codes(&report).contains(&"fiscal_tax_metadata_unavailable"));
        let serialized = serde_json::to_string(&report).unwrap();
        for private in ["Private", "123456789", "118", "payload"] {
            assert!(!serialized.contains(private));
        }
        assert_eq!(invoice, before);
    }

    #[test]
    fn wrong_or_missing_scope_fails_closed() {
        for field in ["organizationId", "companyId", "id"] {
            let mut row = invoice();
            row[field] = json!(99);
            assert!(matches!(
                assess(&row, &[line()], 1, 2, 3),
                Err(ApiError::NotFound(_))
            ));
            row.as_object_mut().unwrap().remove(field);
            assert!(matches!(
                assess(&row, &[line()], 1, 2, 3),
                Err(ApiError::Forbidden(_))
            ));
        }
        let mut other = line();
        other["moveId"] = json!(99);
        assert!(matches!(
            assess(&invoice(), &[other], 1, 2, 3),
            Err(ApiError::Forbidden(_))
        ));
    }

    #[test]
    fn draft_refund_and_redacted_fields_remain_blocked() {
        let mut row = invoice();
        row["state"] = json!("Draft");
        row["moveType"] = json!("OutRefund");
        row.as_object_mut().unwrap().remove("amountTax");
        row.as_object_mut().unwrap().remove("metadata");
        let mut detail = line();
        detail.as_object_mut().unwrap().remove("taxIds");
        detail.as_object_mut().unwrap().remove("productUomId");
        let report = assess(&row, &[detail], 1, 2, 3).unwrap();
        assert!(!report.canonical_data_available);
        for code in [
            "invoice_not_posted",
            "invoice_type_unsupported",
            "canonical_field_unavailable",
        ] {
            assert!(codes(&report).contains(&code));
        }
        assert!(!report.ready_to_submit);
    }

    #[test]
    fn malformed_required_ids_dates_and_commercial_numbers_are_unavailable() {
        for (field, value) in [
            ("partnerId", json!({"none":[]})),
            ("currencyId", json!({"some":[]})),
            ("invoiceDate", json!({"none":[]})),
            ("invoiceDate", json!({"some":{"none":[]}})),
            ("invoiceDate", json!({"microsSinceUnixEpoch":"not-a-date"})),
        ] {
            let mut row = invoice();
            row[field] = value;
            assert!(
                !assess(&row, &[line()], 1, 2, 3)
                    .unwrap()
                    .canonical_data_available
            );
        }
        for (field, value) in [
            ("discount", json!("0")),
            ("discount", json!(101)),
            ("quantity", json!(0)),
            ("taxIds", json!([7, 7])),
            ("priceSubtotal", json!(null)),
            ("taxLineId", json!({"some":[]})),
            ("productUomId", json!(null)),
        ] {
            let mut detail = line();
            detail[field] = value;
            let report = assess(&invoice(), &[detail], 1, 2, 3).unwrap();
            assert!(!report.canonical_data_available);
            assert!(!report.ready_to_submit);
        }
    }

    #[test]
    fn unknown_or_missing_snapshot_never_uses_live_or_claimed_fiscal_settings() {
        for metadata in [
            json!({}),
            json!({"invoiceDocument":{"schemaVersion":99},
            "certified":true,"readyToSubmit":true,"taxTyCd":"B","itemCd":"forged"}),
        ] {
            let mut row = invoice();
            row["metadata"] = json!(metadata.to_string());
            let report = assess(&row, &[line()], 1, 2, 3).unwrap();
            assert!(!report.canonical_data_available);
            assert!(!report.ready_to_submit);
            assert_eq!(report.execution_blockers, EXECUTION_BLOCKERS);
            assert!(codes(&report)
                .iter()
                .any(|code| code.starts_with("invoice_snapshot_")));
        }
    }

    #[test]
    fn incomplete_duplicate_and_oversized_line_sets_never_pass() {
        for lines in [vec![], vec![line(), line()], vec![line(); MAX_LINES + 1]] {
            let report = assess(&invoice(), &lines, 1, 2, 3).unwrap();
            assert!(!report.canonical_data_available);
            assert!(!report.ready_to_submit);
        }
    }

    #[test]
    fn bounded_query_preserves_field_masks_and_requires_line_authority() {
        let mut access = FieldAccessContext {
            organization_id: 1,
            role_id: 2,
            identity_hex: "actor".into(),
            role_permissions: vec!["account_move_line:read".into()],
            ..Default::default()
        };
        access.field_permissions.push(FieldPermissionLike {
            id: None,
            organization_id: Some(1),
            role_id: Some(2),
            resource: LINE_RESOURCE.into(),
            action: "read".into(),
            allowed_fields: vec!["move_id".into()],
            subject_user_hex: None,
            subject_role_id: Some(2),
        });
        let sql = line_sql(&access, 1, 2, 3).unwrap();
        assert!(sql.contains("organization_id = 1 AND company_id = 2 AND move_id = 3"));
        assert!(sql.ends_with("LIMIT 501"));
        let projection = sql.split(" FROM ").next().unwrap();
        for hidden in [
            "price_unit",
            "tax_ids",
            "product_id",
            "price_subtotal",
            "tax_audit",
        ] {
            assert!(!projection.contains(hidden));
        }
        access.role_permissions = vec!["account_move:read".into()];
        assert!(matches!(
            line_sql(&access, 1, 2, 3),
            Err(ApiError::Forbidden(_))
        ));
    }
}
