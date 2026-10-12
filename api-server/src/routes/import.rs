//! Governed CSV imports and exact caller-scoped request outcomes.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tower_cookies::Cookies;
use tracing::warn;

use crate::commands::{
    authorize_reducer_company_scope, dispatch_session_reducer, session_reducer_contract,
};
use crate::error::ApiError;
use crate::query_exec::default_company_id;
use crate::session::normalize_identity_hex_for_sql;
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::stdb_identity_hex_hint;
use stdb_auth::{
    has_resource_read_permission, identity_sql_literal, resolve_http_sql_columns,
    FieldAccessContext,
};

const MAX_CSV_BYTES: usize = 512_000;

/// CRM entities gated by [`crm_csv_import_enabled`] pending CRM-RI-001 relational
/// integrity remediation (see docs/plans/crm-relational-integrity-remediation-plan.md).
const CRM_IMPORT_ENTITIES: &[&str] = &["contact", "lead", "opportunity"];

/// Runtime opt-in for CRM CSV imports (env `LUMIERE_ENABLE_CRM_CSV_IMPORT`).
///
/// Defaults to **disabled** (containment measure). Mirrors the env-parsing style of
/// the reducer exposure manifest enforced by the generic call endpoint.
fn crm_csv_import_enabled() -> bool {
    matches!(
        std::env::var("LUMIERE_ENABLE_CRM_CSV_IMPORT")
            .ok()
            .map(|s| s.trim().to_ascii_lowercase()),
        Some(ref s) if s == "true" || s == "1" || s == "on"
    )
}

#[derive(Debug, Clone, Copy)]
enum ImportArgShape {
    OrgOnly,
    OrgCompany,
    OrgCurrency,
}

#[derive(Debug, Clone, Copy)]
struct ImportEntity {
    /// Legacy HTTP path segment (snake_case).
    table_name: &'static str,
    reducer: &'static str,
    /// Canonical ImportJob.table_name emitted by the reducer.
    job_table: &'static str,
    read_resource: Option<&'static str>,
    shape: ImportArgShape,
}

/// Path `{entity}` → SpacetimeDB `import_*_csv` reducer (snake_case, hyphens normalized).
static IMPORT_ENTITIES: &[ImportEntity] = &[
    ImportEntity {
        table_name: "account",
        reducer: "import_account_csv",
        job_table: "account_account",
        read_resource: Some("account-accounts"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "account_move",
        reducer: "import_account_move_csv",
        job_table: "account_move",
        read_resource: Some("account-moves"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "account_move_line",
        reducer: "import_account_move_line_csv",
        job_table: "account_move_line",
        read_resource: Some("account-move-lines"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "ai_agent",
        reducer: "import_ai_agent_csv",
        job_table: "ai_agent",
        read_resource: Some("ai-agents"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "analytic_account",
        reducer: "import_analytic_account_csv",
        job_table: "account_analytic_account",
        read_resource: Some("analytic-accounts"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "analytics_metric",
        reducer: "import_analytics_metric_csv",
        job_table: "analytics_metric",
        read_resource: Some("analytics-metrics"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "bom",
        reducer: "import_bom_csv",
        job_table: "mrp_bom",
        read_resource: Some("mrp-boms"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "bom_line",
        reducer: "import_bom_line_csv",
        job_table: "mrp_bom_line",
        read_resource: Some("mrp-bom-lines"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "budget",
        reducer: "import_budget_csv",
        job_table: "crossovered_budget",
        read_resource: Some("budgets"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "budget_line",
        reducer: "import_budget_line_csv",
        job_table: "crossovered_budget_lines",
        read_resource: Some("budget-lines"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "company",
        reducer: "import_company_csv",
        job_table: "company",
        read_resource: Some("companies"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "contact",
        reducer: "import_contact_csv",
        job_table: "contact",
        read_resource: Some("contacts"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "country",
        reducer: "import_country_csv",
        job_table: "country",
        read_resource: Some("countries"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "currency",
        reducer: "import_currency_csv",
        job_table: "currency",
        read_resource: Some("currencies"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "currency_rate",
        reducer: "import_currency_rate_csv",
        job_table: "currency_rate",
        read_resource: Some("currency-rates"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "expense",
        reducer: "import_expense_csv",
        job_table: "hr_expense",
        read_resource: Some("expenses"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "expense_sheet",
        reducer: "import_expense_sheet_csv",
        job_table: "hr_expense_sheet",
        read_resource: Some("expense-sheets"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "helpdesk_sla",
        reducer: "import_helpdesk_sla_csv",
        job_table: "helpdesk_sla",
        read_resource: Some("helpdesk-slas"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "helpdesk_stage",
        reducer: "import_helpdesk_stage_csv",
        job_table: "helpdesk_stage",
        read_resource: Some("helpdesk-stages"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "helpdesk_team",
        reducer: "import_helpdesk_team_csv",
        job_table: "helpdesk_team",
        read_resource: Some("helpdesk-teams"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "helpdesk_ticket",
        reducer: "import_helpdesk_ticket_csv",
        job_table: "helpdesk_ticket",
        read_resource: Some("helpdesk-tickets"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_contract",
        reducer: "import_hr_contract_csv",
        job_table: "hr_contract",
        read_resource: Some("contracts"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_department",
        reducer: "import_hr_department_csv",
        job_table: "hr_department",
        read_resource: Some("departments"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_employee",
        reducer: "import_hr_employee_csv",
        job_table: "hr_employee",
        read_resource: Some("employees"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_job_position",
        reducer: "import_hr_job_position_csv",
        job_table: "hr_job_position",
        read_resource: Some("job-positions"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_leave",
        reducer: "import_hr_leave_csv",
        job_table: "hr_leave",
        read_resource: Some("leave-requests"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_leave_type",
        reducer: "import_hr_leave_type_csv",
        job_table: "hr_leave_type",
        read_resource: Some("leave-types"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_payroll_structure",
        reducer: "import_hr_payroll_structure_csv",
        job_table: "hr_payroll_structure",
        read_resource: Some("payroll-structures"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_payslip",
        reducer: "import_hr_payslip_csv",
        job_table: "hr_payslip",
        read_resource: Some("payslips"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_resource",
        reducer: "import_hr_resource_csv",
        job_table: "hr_resource",
        read_resource: Some("hr-resources"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_salary_rule",
        reducer: "import_hr_salary_rule_csv",
        job_table: "hr_salary_rule",
        read_resource: Some("salary-rules"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "knowledge_article",
        reducer: "import_knowledge_article_csv",
        job_table: "knowledge_article",
        read_resource: Some("knowledge-articles"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "knowledge_category",
        reducer: "import_knowledge_category_csv",
        job_table: "knowledge_article_category",
        read_resource: Some("knowledge-categories"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "lead",
        reducer: "import_lead_csv",
        job_table: "lead",
        read_resource: Some("leads"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "lot",
        reducer: "import_lot_csv",
        job_table: "stock_production_lot",
        read_resource: Some("stock-production-lots"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "manufacturing_order",
        reducer: "import_manufacturing_order_csv",
        job_table: "mrp_production",
        read_resource: Some("mrp-productions"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "opportunity",
        reducer: "import_opportunity_csv",
        job_table: "opportunity",
        read_resource: Some("opportunities"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "product",
        reducer: "import_product_csv",
        job_table: "product",
        read_resource: Some("products"),
        shape: ImportArgShape::OrgCurrency,
    },
    ImportEntity {
        table_name: "product_category",
        reducer: "import_product_category_csv",
        job_table: "product_category",
        read_resource: Some("product-categories"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "product_variant",
        reducer: "import_product_variant_csv",
        job_table: "product_variant",
        read_resource: Some("product-variants"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "project",
        reducer: "import_project_csv",
        job_table: "project_project",
        read_resource: Some("projects"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "purchase_order",
        reducer: "import_purchase_order_csv",
        job_table: "purchase_order",
        read_resource: Some("purchase-orders"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "purchase_order_line",
        reducer: "import_purchase_order_line_csv",
        job_table: "purchase_order_line",
        read_resource: Some("purchase-order-lines"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "report_template",
        reducer: "import_report_template_csv",
        job_table: "report_template",
        read_resource: Some("report-templates"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "role",
        reducer: "import_role_csv",
        job_table: "role",
        read_resource: Some("roles"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "sale_order",
        reducer: "import_sale_order_csv",
        job_table: "sale_order",
        read_resource: Some("sale-orders"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "sale_order_line",
        reducer: "import_sale_order_line_csv",
        job_table: "sale_order_line",
        read_resource: Some("sale-order-lines"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "stock_location",
        reducer: "import_stock_location_csv",
        job_table: "stock_location",
        read_resource: Some("stock-locations"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "stock_quant",
        reducer: "import_stock_quant_csv",
        job_table: "stock_quant",
        read_resource: Some("stock-quants"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "subscription",
        reducer: "import_subscription_csv",
        job_table: "subscription",
        read_resource: Some("subscriptions"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "subscription_plan",
        reducer: "import_subscription_plan_csv",
        job_table: "subscription_plan",
        read_resource: Some("subscription-plans"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "supplier_info",
        reducer: "import_supplier_info_csv",
        job_table: "product_supplier_info",
        read_resource: Some("product-supplier-infos"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "task",
        reducer: "import_task_csv",
        job_table: "project_task",
        read_resource: Some("tasks"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "tax_rate",
        reducer: "import_tax_rate_csv",
        job_table: "account_tax",
        read_resource: Some("account-taxes"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "timesheet",
        reducer: "import_timesheet_csv",
        job_table: "project_timesheet",
        read_resource: Some("timesheets"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "uom",
        reducer: "import_uom_csv",
        job_table: "uom",
        read_resource: Some("uoms"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "uom_category",
        reducer: "import_uom_category_csv",
        job_table: "uom_category",
        read_resource: Some("uom-categories"),
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "warehouse",
        reducer: "import_warehouse_csv",
        job_table: "warehouse",
        read_resource: Some("warehouses"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "workcenter",
        reducer: "import_workcenter_csv",
        job_table: "mrp_workcenter",
        read_resource: Some("mrp-workcenters"),
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "workflow",
        reducer: "import_workflow_csv",
        job_table: "workflow",
        read_resource: Some("workflows"),
        shape: ImportArgShape::OrgOnly,
    },
];

fn normalize_entity_key(raw: &str) -> String {
    raw.trim().to_ascii_lowercase().replace('-', "_")
}

fn resolve_import_entity(entity: &str) -> Option<&'static ImportEntity> {
    let key = normalize_entity_key(entity);
    IMPORT_ENTITIES
        .iter()
        .find(|e| e.table_name == key || e.job_table == key)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportParams {
    #[serde(default, deserialize_with = "deserialize_optional_id")]
    company_id: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_id")]
    currency_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportBody {
    #[serde(alias = "csvContent", alias = "csvData")]
    csv: String,
    request_id: Option<String>,
    file_name: Option<String>,
    #[serde(default)]
    params: Option<ImportParams>,
}

fn deserialize_optional_id<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u64>, D::Error> {
    let value = Option::<Value>::deserialize(deserializer)?;
    value
        .map(|value| {
            value
                .as_u64()
                .or_else(|| {
                    value.as_str().and_then(|raw| {
                        (!raw.is_empty() && raw.bytes().all(|byte| byte.is_ascii_digit()))
                            .then(|| raw.parse::<u64>().ok())
                            .flatten()
                    })
                })
                .ok_or_else(|| serde::de::Error::custom("ID must be an unsigned decimal integer"))
        })
        .transpose()
}

fn validate_csv(csv: &str) -> Result<(), ApiError> {
    if csv.trim().is_empty() {
        return Err(ApiError::BadRequest("CSV content is required".into()));
    }
    if csv.len() > MAX_CSV_BYTES {
        return Err(ApiError::BadRequest(format!(
            "CSV exceeds maximum size of {} bytes",
            MAX_CSV_BYTES
        )));
    }
    Ok(())
}

async fn import_entity_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(entity): Path<String>,
    Json(body): Json<ImportBody>,
) -> Result<Json<Value>, ApiError> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());

    let session = resolve_api_session(&state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;

    if session.identity_hex == "unknown" {
        return Err(ApiError::Unauthorized);
    }

    let org_id = session
        .organization_id
        .ok_or_else(|| ApiError::Forbidden("No organization assigned".into()))?;

    let spec = resolve_import_entity(&entity)
        .ok_or_else(|| ApiError::NotFound(format!("Unsupported import entity: {entity}")))?;

    if CRM_IMPORT_ENTITIES.contains(&spec.table_name) && !crm_csv_import_enabled() {
        warn!(
            organization_id = org_id,
            entity = spec.table_name,
            identity = %session.identity_hex,
            "CRM CSV import denied: disabled pending relational-integrity remediation"
        );
        return Err(ApiError::Forbidden(
            "CRM CSV import is disabled pending relational-integrity remediation \
             (see docs/plans/crm-relational-integrity-remediation-plan.md, CRM-RI-001)"
                .to_string(),
        ));
    }

    validate_csv(&body.csv)?;

    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    let client = trusted.client();
    let params = body.params.unwrap_or(ImportParams {
        company_id: None,
        currency_id: None,
    });

    if let Some(request_id) = body.request_id.as_deref() {
        validate_request_id(request_id)?;
        if body.file_name.as_ref().is_some_and(|name| name.len() > 255) {
            return Err(ApiError::BadRequest("fileName exceeds 255 bytes".into()));
        }
        let company_id = params.company_id.filter(|id| *id > 0).ok_or_else(|| {
            ApiError::BadRequest("params.companyId is required for tracked import".into())
        })?;
        authorize_reducer_company_scope(&trusted, vec![company_id]).await?;
        validate_currency(spec, params.currency_id)?;
        import_read_columns(spec, trusted.field_access())?;
        // The pinned generated reducer contract must be promoted with the module.
        // Never silently fall back to the uncorrelated legacy reducer.
        require_tracked_capability()?;
        let expected_hash = format!("{:x}", Sha256::digest(body.csv.as_bytes()));
        let args = json!([org_id, {"some": company_id},
            {"request_id": request_id, "entity": spec.job_table, "csv_data": body.csv,
             "currency_id": params.currency_id.map(|id| json!({"some": id})).unwrap_or_else(|| json!({"none": []})),
             "file_name": body.file_name.map(|name| json!({"some": name})).unwrap_or_else(|| json!({"none": []}))}]);
        let context =
            dispatch_session_reducer(&state, &session, "import_csv_tracked", args).await?;
        let response = read_exact_outcome(
            &context,
            spec,
            request_id,
            company_id,
            params.currency_id,
            Some(&expected_hash),
        )
        .await?;
        return Ok(Json(response));
    }

    let args = match spec.shape {
        ImportArgShape::OrgOnly => json!([org_id, body.csv]),
        ImportArgShape::OrgCompany => {
            let company_id = if let Some(cid) = params.company_id {
                cid
            } else {
                default_company_id(&client, org_id).await?.ok_or_else(|| {
                    ApiError::Unprocessable("No company found for organization".into())
                })?
            };
            json!([org_id, company_id, body.csv])
        }
        ImportArgShape::OrgCurrency => {
            let currency_id = params.currency_id.ok_or_else(|| {
                ApiError::BadRequest("params.currencyId is required for product import".into())
            })?;
            json!([org_id, currency_id, body.csv])
        }
    };

    dispatch_session_reducer(&state, &session, spec.reducer, args).await?;
    // A legacy import has no receipt token: returning another concurrent job's
    // ID or row counts would falsely attribute its outcome to this request.
    Ok(Json(json!({ "ok": true, "entity": spec.table_name })))
}

fn validate_request_id(request_id: &str) -> Result<(), ApiError> {
    if request_id.len() != 32
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ApiError::BadRequest(
            "requestId must be 32 lowercase hexadecimal characters".into(),
        ));
    }
    Ok(())
}

fn validate_currency(spec: &ImportEntity, currency_id: Option<u64>) -> Result<(), ApiError> {
    match (spec.shape, currency_id) {
        (ImportArgShape::OrgCurrency, Some(id)) if id > 0 => Ok(()),
        (ImportArgShape::OrgCurrency, _) => Err(ApiError::BadRequest(
            "params.currencyId is required for product import".into(),
        )),
        (_, None) => Ok(()),
        _ => Err(ApiError::BadRequest(
            "currencyId is only supported for product import".into(),
        )),
    }
}

fn require_tracked_capability() -> Result<(), ApiError> {
    session_reducer_contract("import_csv_tracked")
        .map(|_| ())
        .map_err(|_| {
            ApiError::Unavailable(
                "Tracked CSV import requires the promoted import_csv_tracked module contract"
                    .into(),
            )
        })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportRequestQuery {
    company_id: u64,
    currency_id: Option<u64>,
}

async fn import_request_get(
    State(state): State<Arc<AppState>>,
    Path((entity, request_id)): Path<(String, String)>,
    Query(query): Query<ImportRequestQuery>,
    crate::web_session::OrgSession { session, .. }: crate::web_session::OrgSession,
) -> Result<Json<Value>, ApiError> {
    validate_request_id(&request_id)?;
    if query.company_id == 0 {
        return Err(ApiError::BadRequest("companyId must be positive".into()));
    }
    let spec = resolve_import_entity(&entity)
        .ok_or_else(|| ApiError::NotFound("Import request not found".into()))?;
    validate_currency(spec, query.currency_id)?;
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    authorize_reducer_company_scope(&context, vec![query.company_id]).await?;
    Ok(Json(
        read_exact_outcome(
            &context,
            spec,
            &request_id,
            query.company_id,
            query.currency_id,
            None,
        )
        .await?,
    ))
}

fn import_read_columns(
    spec: &ImportEntity,
    access: &FieldAccessContext,
) -> Result<Vec<String>, ApiError> {
    let resource = spec.read_resource.ok_or_else(|| {
        ApiError::Forbidden("No reviewed read policy for this import entity".into())
    })?;
    if !has_resource_read_permission(Some(access), resource) {
        return Err(ApiError::Forbidden(
            "Import entity read permission denied".into(),
        ));
    }
    // Domain read authority governs this caller-owned receipt. The generic
    // import-jobs resource supplies its field grants, not a second role bypass.
    let job_columns =
        resolve_http_sql_columns("import-jobs", Some(access)).map_err(ApiError::Internal)?;
    for required in [
        "table_name",
        "total_rows",
        "imported_rows",
        "error_rows",
        "status",
    ] {
        if !job_columns.iter().any(|column| column == required) {
            return Err(ApiError::Forbidden(
                "Import outcome fields are not readable".into(),
            ));
        }
    }
    resolve_http_sql_columns(resource, Some(access)).map_err(ApiError::Internal)
}

fn receipt_sql(organization_id: u64, actor: &str, table_name: &str) -> Result<String, ApiError> {
    let identity = identity_sql_literal(actor).map_err(ApiError::Internal)?;
    // table_name is taken only from the server-owned entity registry.
    Ok(format!("SELECT id, organization_id, table_name, total_rows, imported_rows, error_rows, status, create_uid, metadata FROM import_job WHERE organization_id = {organization_id} AND create_uid = {identity} AND table_name = '{table_name}'"))
}

fn errors_sql(organization_id: u64, job_id: u64) -> String {
    // The receipt was already matched to organization, company and principal.
    // No organization-wide limit may hide errors belonging to this exact job.
    format!("SELECT id, organization_id, job_id, row_number, field_name, error_message FROM import_job_error WHERE organization_id = {organization_id} AND job_id = {job_id}")
}

fn row_value<'a>(row: &'a Value, snake: &str, camel: &str) -> Option<&'a Value> {
    row.get(snake).or_else(|| row.get(camel))
}

fn option_string(value: &Value) -> Option<&str> {
    value
        .as_str()
        .or_else(|| value.get("some").and_then(Value::as_str))
}

fn row_number(row: &Value, snake: &str, camel: &str) -> Option<u64> {
    let value = row_value(row, snake, camel)?;
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

fn actor_matches(row: &Value, actor: &str) -> bool {
    let Some(value) = row_value(row, "create_uid", "createUid") else {
        return false;
    };
    let identity = value
        .as_str()
        .or_else(|| value.get("__identity__").and_then(Value::as_str));
    identity.is_some_and(|identity| {
        normalize_identity_hex_for_sql(identity) == normalize_identity_hex_for_sql(actor)
    })
}

fn match_receipt<'a>(
    rows: &'a [Value],
    organization_id: u64,
    actor: &str,
    spec: &ImportEntity,
    request_id: &str,
    company_id: u64,
    currency_id: Option<u64>,
) -> Result<&'a Value, ApiError> {
    let mut matched = None;
    for row in rows {
        if row_number(row, "organization_id", "organizationId") != Some(organization_id)
            || !actor_matches(row, actor)
            || row_value(row, "table_name", "tableName").and_then(Value::as_str)
                != Some(spec.job_table)
        {
            continue;
        }
        let metadata = row
            .get("metadata")
            .and_then(option_string)
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
        let Some(metadata) = metadata else {
            continue;
        };
        if !row
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| {
                matches!(status, "success" | "partial" | "failed" | "rolled_back")
            })
            || !metadata
                .get("sha256")
                .and_then(Value::as_str)
                .is_some_and(|hash| {
                    hash.len() == 64
                        && hash
                            .bytes()
                            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                })
            || !metadata
                .get("currency_id")
                .is_some_and(|value| value.is_null() || value.as_u64().is_some())
            || metadata.get("correlation_version").and_then(Value::as_u64) != Some(1)
            || metadata.get("request_id").and_then(Value::as_str) != Some(request_id)
            || metadata.get("company_id").and_then(Value::as_u64) != Some(company_id)
            || metadata.get("currency_id").and_then(Value::as_u64) != currency_id
        {
            continue;
        }
        if matched.replace(row).is_some() {
            return Err(ApiError::Conflict(
                "Import request has ambiguous receipts".into(),
            ));
        }
    }
    matched.ok_or_else(|| ApiError::NotFound("Import request not found".into()))
}

fn project_errors(
    spec: &ImportEntity,
    rows: Vec<Value>,
    organization_id: u64,
    job_id: u64,
    columns: &[String],
    detailed: bool,
) -> Result<Vec<Value>, ApiError> {
    let mut errors = Vec::with_capacity(rows.len());
    for row in rows {
        // Defense in depth against an upstream query returning unrelated rows.
        if row_number(&row, "organization_id", "organizationId") != Some(organization_id)
            || row_number(&row, "job_id", "jobId") != Some(job_id)
        {
            continue;
        }
        let id = row_number(&row, "id", "id")
            .filter(|id| *id > 0)
            .ok_or_else(|| ApiError::Internal("Invalid import error ID".into()))?;
        let row_number = row_number(&row, "row_number", "rowNumber")
            .ok_or_else(|| ApiError::Internal("Invalid import error row number".into()))?;
        let field = row_value(&row, "field_name", "fieldName").and_then(option_string);
        let field = field.filter(|field| import_error_field_is_readable(spec, field, columns));
        errors.push(json!({"id":id.to_string(), "jobId":job_id.to_string(), "rowNumber":row_number,
            "fieldName":field, "errorMessage":if detailed {
                row_value(&row,"error_message","errorMessage").and_then(Value::as_str).unwrap_or("Import validation failed")
            } else { "Import validation failed" }}));
    }
    errors.sort_by_key(|row| {
        row.get("rowNumber")
            .and_then(Value::as_u64)
            .unwrap_or_default()
    });
    Ok(errors)
}

fn import_error_field_is_readable(spec: &ImportEntity, field: &str, columns: &[String]) -> bool {
    let projected_field = match (spec.job_table, field) {
        // SpacetimeDB exposes the Rust/CSV `iso3` field as SQL `iso_3`.
        ("country", "iso3") => "iso_3",
        // Import headers use business references; governed reads expose their IDs.
        ("country", "currency_code") => "currency_id",
        ("currency_rate", "from_currency") => "from_currency_id",
        ("currency_rate", "to_currency") => "to_currency_id",
        ("product_variant", "product_id") => "product_tmpl_id",
        _ => field,
    };
    columns.iter().any(|column| column == projected_field)
}

async fn read_exact_outcome(
    context: &TrustedOperationContext,
    spec: &ImportEntity,
    request_id: &str,
    company_id: u64,
    currency_id: Option<u64>,
    expected_hash: Option<&str>,
) -> Result<Value, ApiError> {
    let access = context.field_access();
    let columns = import_read_columns(spec, access)?;
    let rows = context
        .client()
        .query_sql(&receipt_sql(
            context.organization_id(),
            context.actor_identity(),
            spec.job_table,
        )?)
        .await
        .map_err(ApiError::internal)?;
    let receipt = match_receipt(
        &rows,
        context.organization_id(),
        context.actor_identity(),
        spec,
        request_id,
        company_id,
        currency_id,
    )?;
    if let Some(expected_hash) = expected_hash {
        let metadata = receipt
            .get("metadata")
            .and_then(option_string)
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .ok_or_else(|| ApiError::Conflict("Import receipt metadata is invalid".into()))?;
        if metadata.get("sha256").and_then(Value::as_str) != Some(expected_hash) {
            return Err(ApiError::Conflict(
                "Import receipt content does not match the submission".into(),
            ));
        }
    }
    let job_id = row_number(receipt, "id", "id")
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiError::Internal("Invalid import receipt ID".into()))?;
    let error_rows = context
        .client()
        .query_sql(&errors_sql(context.organization_id(), job_id))
        .await
        .map_err(ApiError::internal)?;
    // Validation messages can embed other fields/related records. Give detailed
    // messages only to unrestricted actors; raw CSV values are never returned.
    let detailed = access.is_superuser
        || access
            .role_permissions
            .iter()
            .any(|permission| permission == "*:*");
    let errors = project_errors(
        spec,
        error_rows,
        context.organization_id(),
        job_id,
        &columns,
        detailed,
    )?;
    let total_rows = row_number(receipt, "total_rows", "totalRows")
        .ok_or_else(|| ApiError::Internal("Invalid import total".into()))?;
    let imported_rows = row_number(receipt, "imported_rows", "importedRows")
        .ok_or_else(|| ApiError::Internal("Invalid import count".into()))?;
    let error_rows = row_number(receipt, "error_rows", "errorRows")
        .ok_or_else(|| ApiError::Internal("Invalid import error count".into()))?;
    let status = receipt
        .get("status")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::Internal("Invalid import status".into()))?;
    Ok(
        json!({"ok":true,"entity":spec.job_table,"requestId":request_id,"jobId":job_id.to_string(),
        "status":status,"totalRows":total_rows,"rowsImported":imported_rows,"errorRows":error_rows,
        "errors":errors,"errorsRedacted":!detailed}),
    )
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/import/{entity}", post(import_entity_post))
        .route(
            "/import/{entity}/requests/{request_id}",
            get(import_request_get),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_map_includes_core_entities() {
        assert!(resolve_import_entity("contact").is_some());
        assert!(resolve_import_entity("sale-order").is_some());
        assert!(resolve_import_entity("product").is_some());
    }

    #[test]
    fn unknown_entity_returns_none() {
        assert!(resolve_import_entity("not_a_table").is_none());
    }
    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    const ACTOR: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn receipt(id: u64, company_id: u64) -> Value {
        json!({"id":id,"organizationId":7,"tableName":"product","status":"success","createUid":{"__identity__":format!("0x{ACTOR}")},
            "metadata":json!({"correlation_version":1,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","request_id":TOKEN,"company_id":company_id,"currency_id":3}).to_string()})
    }

    #[test]
    fn canonical_aliases_match_emitted_import_job_tables() {
        for (alias, canonical) in [
            ("account", "account_account"),
            ("tax_rate", "account_tax"),
            ("manufacturing_order", "mrp_production"),
            ("expense_sheet", "hr_expense_sheet"),
            ("project", "project_project"),
        ] {
            assert_eq!(resolve_import_entity(alias).unwrap().job_table, canonical);
            assert_eq!(resolve_import_entity(canonical).unwrap().table_name, alias);
        }
    }

    #[test]
    fn request_tokens_reject_injection_and_noncanonical_encodings() {
        assert!(validate_request_id(TOKEN).is_ok());
        for token in [
            "",
            "' OR 1=1",
            "0123456789ABCDEF0123456789ABCDEF",
            "0123456789abcdef0123456789abcdef00",
        ] {
            assert!(validate_request_id(token).is_err());
        }
    }

    #[test]
    fn json_scope_ids_preserve_u64_decimal_strings_and_reject_invalid_numbers() {
        let body: ImportBody =
            serde_json::from_value(json!({"csvData":"name\na","requestId":TOKEN,
            "params":{"companyId":"18446744073709551615","currencyId":"3"}}))
            .unwrap();
        assert_eq!(body.params.unwrap().company_id, Some(u64::MAX));
        for invalid in [
            json!("-1"),
            json!("1.5"),
            json!(1.5),
            json!("18446744073709551616"),
        ] {
            assert!(serde_json::from_value::<ImportBody>(
                json!({"csv":"name\na","params":{"companyId":invalid}})
            )
            .is_err());
        }
    }

    #[test]
    fn exact_receipt_does_not_choose_newest_job_and_enforces_all_scopes() {
        let spec = resolve_import_entity("product").unwrap();
        let mut newer = receipt(999, 42);
        newer["metadata"]=json!(json!({"correlation_version":1,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","request_id":"ffffffffffffffffffffffffffffffff","company_id":42,"currency_id":3}).to_string());
        let rows = vec![newer, receipt(1, 42), receipt(500, 43)];
        assert_eq!(
            match_receipt(&rows, 7, ACTOR, spec, TOKEN, 42, Some(3)).unwrap()["id"],
            json!(1)
        );
        assert!(match_receipt(&rows, 8, ACTOR, spec, TOKEN, 42, Some(3)).is_err());
        assert!(match_receipt(
            &rows,
            7,
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            spec,
            TOKEN,
            42,
            Some(3)
        )
        .is_err());
        assert!(match_receipt(&rows, 7, ACTOR, spec, TOKEN, 42, Some(4)).is_err());
        assert!(match_receipt(
            &rows,
            7,
            ACTOR,
            resolve_import_entity("account").unwrap(),
            TOKEN,
            42,
            Some(3)
        )
        .is_err());
    }

    #[test]
    fn duplicate_receipts_fail_closed_and_malformed_metadata_is_ignored() {
        let spec = resolve_import_entity("product").unwrap();
        assert!(matches!(
            match_receipt(
                &[receipt(1, 42), receipt(2, 42)],
                7,
                ACTOR,
                spec,
                TOKEN,
                42,
                Some(3)
            ),
            Err(ApiError::Conflict(_))
        ));
        let mut invalid = receipt(1, 42);
        invalid["metadata"] = json!("not json");
        assert!(match_receipt(&[invalid], 7, ACTOR, spec, TOKEN, 42, Some(3)).is_err());
    }

    #[test]
    fn exact_error_queries_have_job_and_tenant_predicates_and_no_feed_limit() {
        let sql = errors_sql(7, 123);
        assert!(sql.contains("organization_id = 7 AND job_id = 123"));
        assert!(!sql.contains("LIMIT"));
        let sql = receipt_sql(7, ACTOR, "product").unwrap();
        assert!(sql.contains("organization_id = 7 AND create_uid ="));
        assert!(sql.contains("table_name = 'product'"));
        assert!(!sql.contains("ORDER BY"));
        assert!(!sql.contains("LIMIT"));
    }

    #[test]
    fn exact_errors_exceed_global_feed_cap_and_redact_fields_and_messages() {
        let mut rows:Vec<Value>=(1..=650).map(|id| json!({"id":id,"organization_id":7,"job_id":123,
            "row_number":id,"field_name":"wage","raw_value":"90000","error_message":"90000 is invalid for secret employee"})).collect();
        rows.push(json!({"id":900,"organization_id":8,"job_id":123,"row_number":1}));
        rows.push(json!({"id":901,"organization_id":7,"job_id":124,"row_number":1}));
        let errors = project_errors(
            resolve_import_entity("product").unwrap(),
            rows,
            7,
            123,
            &["name".into()],
            false,
        )
        .unwrap();
        assert_eq!(errors.len(), 650);
        assert_eq!(errors[0]["fieldName"], Value::Null);
        assert_eq!(errors[0]["errorMessage"], json!("Import validation failed"));
        assert!(errors
            .iter()
            .all(|row| row.get("rawValue").is_none() && row["jobId"] == "123"));
    }

    #[test]
    fn product_currency_is_required_and_other_entities_reject_currency() {
        let product = resolve_import_entity("product").unwrap();
        assert!(validate_currency(product, None).is_err());
        assert!(validate_currency(product, Some(0)).is_err());
        assert!(validate_currency(product, Some(3)).is_ok());
        assert!(validate_currency(resolve_import_entity("account").unwrap(), Some(3)).is_err());
    }

    #[test]
    fn import_headers_map_to_governed_projection_columns() {
        for (entity, header, projected) in [
            ("country", "iso3", "iso_3"),
            ("country", "currency_code", "currency_id"),
            ("currency_rate", "from_currency", "from_currency_id"),
            ("currency_rate", "to_currency", "to_currency_id"),
            ("product_variant", "product_id", "product_tmpl_id"),
        ] {
            let spec = resolve_import_entity(entity).unwrap();
            assert!(
                import_error_field_is_readable(spec, header, &[projected.into()]),
                "{entity}.{header}"
            );
            assert!(!import_error_field_is_readable(
                spec,
                header,
                &["name".into()]
            ));
        }
        assert!(!import_error_field_is_readable(
            resolve_import_entity("country").unwrap(),
            "future_private_field",
            &["iso_3".into(), "currency_id".into()]
        ));
    }

    #[test]
    fn receipt_read_authorization_requires_domain_role_and_outcome_field_grants() {
        let mut access = FieldAccessContext {
            organization_id: 7,
            role_id: 2,
            role_name: "Employee reader".into(),
            is_superuser: false,
            role_permissions: vec!["hr_employee:read".into()],
            identity_hex: ACTOR.into(),
            field_permissions: vec![],
        };
        assert!(
            import_read_columns(resolve_import_entity("hr_employee").unwrap(), &access).is_ok()
        );
        assert!(
            import_read_columns(resolve_import_entity("hr_contract").unwrap(), &access).is_err()
        );
        access
            .field_permissions
            .push(stdb_auth::FieldPermissionLike {
                id: Some(1),
                organization_id: Some(7),
                role_id: Some(2),
                resource: "import-jobs".into(),
                action: "read".into(),
                allowed_fields: vec!["status".into()],
                subject_user_hex: None,
                subject_role_id: Some(2),
            });
        assert!(
            import_read_columns(resolve_import_entity("hr_employee").unwrap(), &access).is_err()
        );
        access.role_permissions = vec!["import_job:read".into()];
        access.field_permissions.clear();
        assert!(
            import_read_columns(resolve_import_entity("hr_employee").unwrap(), &access).is_err()
        );
    }

    #[test]
    fn every_tracked_import_entity_has_a_reviewed_read_policy() {
        for (entity, permission, expected_resource) in [
            ("country", "country:read", "countries"),
            ("currency", "currency:read", "currencies"),
            ("currency_rate", "currency_rate:read", "currency-rates"),
            ("uom_category", "uom_category:read", "uom-categories"),
            (
                "knowledge_article_category",
                "knowledge_article_category:read",
                "knowledge-categories",
            ),
            (
                "product_variant",
                "product_variant:read",
                "product-variants",
            ),
            (
                "hr_expense_sheet",
                "hr_expense_sheet:read",
                "expense-sheets",
            ),
        ] {
            let spec = resolve_import_entity(entity).expect("tracked import entity");
            assert_eq!(spec.read_resource, Some(expected_resource), "{entity}");
            let access = FieldAccessContext {
                organization_id: 7,
                role_id: 2,
                role_name: "Import reader".into(),
                is_superuser: false,
                role_permissions: vec![permission.into()],
                identity_hex: ACTOR.into(),
                field_permissions: vec![],
            };
            assert!(
                import_read_columns(spec, &access).is_ok(),
                "{entity} must resolve its governed projection"
            );
        }
    }
}
