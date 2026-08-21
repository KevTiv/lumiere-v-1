//! `/v1/import/{entity}` — CSV import via dedicated `import_*_csv` reducers (bypasses `/call` allowlist).

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::Cookies;
use tracing::warn;

use crate::error::ApiError;
use crate::query_exec::default_company_id;
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::web_session::stdb_identity_hex_hint;

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
    /// `import_job.table_name` / path segment (snake_case).
    table_name: &'static str,
    reducer: &'static str,
    shape: ImportArgShape,
}

/// Path `{entity}` → SpacetimeDB `import_*_csv` reducer (snake_case, hyphens normalized).
static IMPORT_ENTITIES: &[ImportEntity] = &[
    ImportEntity {
        table_name: "account",
        reducer: "import_account_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "account_move",
        reducer: "import_account_move_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "account_move_line",
        reducer: "import_account_move_line_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "ai_agent",
        reducer: "import_ai_agent_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "analytic_account",
        reducer: "import_analytic_account_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "analytics_metric",
        reducer: "import_analytics_metric_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "bom",
        reducer: "import_bom_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "bom_line",
        reducer: "import_bom_line_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "budget",
        reducer: "import_budget_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "budget_line",
        reducer: "import_budget_line_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "company",
        reducer: "import_company_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "contact",
        reducer: "import_contact_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "country",
        reducer: "import_country_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "currency",
        reducer: "import_currency_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "currency_rate",
        reducer: "import_currency_rate_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "expense",
        reducer: "import_expense_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "expense_sheet",
        reducer: "import_expense_sheet_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "helpdesk_sla",
        reducer: "import_helpdesk_sla_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "helpdesk_stage",
        reducer: "import_helpdesk_stage_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "helpdesk_team",
        reducer: "import_helpdesk_team_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "helpdesk_ticket",
        reducer: "import_helpdesk_ticket_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_contract",
        reducer: "import_hr_contract_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_department",
        reducer: "import_hr_department_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_employee",
        reducer: "import_hr_employee_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_job_position",
        reducer: "import_hr_job_position_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_leave",
        reducer: "import_hr_leave_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_leave_type",
        reducer: "import_hr_leave_type_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_payroll_structure",
        reducer: "import_hr_payroll_structure_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_payslip",
        reducer: "import_hr_payslip_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_resource",
        reducer: "import_hr_resource_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "hr_salary_rule",
        reducer: "import_hr_salary_rule_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "knowledge_article",
        reducer: "import_knowledge_article_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "knowledge_category",
        reducer: "import_knowledge_category_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "lead",
        reducer: "import_lead_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "lot",
        reducer: "import_lot_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "manufacturing_order",
        reducer: "import_manufacturing_order_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "opportunity",
        reducer: "import_opportunity_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "product",
        reducer: "import_product_csv",
        shape: ImportArgShape::OrgCurrency,
    },
    ImportEntity {
        table_name: "product_category",
        reducer: "import_product_category_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "product_variant",
        reducer: "import_product_variant_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "project",
        reducer: "import_project_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "purchase_order",
        reducer: "import_purchase_order_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "purchase_order_line",
        reducer: "import_purchase_order_line_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "report_template",
        reducer: "import_report_template_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "role",
        reducer: "import_role_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "sale_order",
        reducer: "import_sale_order_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "sale_order_line",
        reducer: "import_sale_order_line_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "stock_location",
        reducer: "import_stock_location_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "stock_quant",
        reducer: "import_stock_quant_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "subscription",
        reducer: "import_subscription_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "subscription_plan",
        reducer: "import_subscription_plan_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "supplier_info",
        reducer: "import_supplier_info_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "task",
        reducer: "import_task_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "tax_rate",
        reducer: "import_tax_rate_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "timesheet",
        reducer: "import_timesheet_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "uom",
        reducer: "import_uom_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "uom_category",
        reducer: "import_uom_category_csv",
        shape: ImportArgShape::OrgOnly,
    },
    ImportEntity {
        table_name: "warehouse",
        reducer: "import_warehouse_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "workcenter",
        reducer: "import_workcenter_csv",
        shape: ImportArgShape::OrgCompany,
    },
    ImportEntity {
        table_name: "workflow",
        reducer: "import_workflow_csv",
        shape: ImportArgShape::OrgOnly,
    },
];

fn normalize_entity_key(raw: &str) -> String {
    raw.trim().to_ascii_lowercase().replace('-', "_")
}

fn resolve_import_entity(entity: &str) -> Option<&'static ImportEntity> {
    let key = normalize_entity_key(entity);
    IMPORT_ENTITIES.iter().find(|e| e.table_name == key)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportParams {
    company_id: Option<u64>,
    currency_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportBody {
    #[serde(alias = "csvContent")]
    csv: String,
    #[serde(default)]
    params: Option<ImportParams>,
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

fn reducer_error_message(err: &str) -> ApiError {
    // SpacetimeDB HTTP errors often embed the reducer `Err(String)` in the body.
    if err.contains("permission") || err.contains("Permission") {
        ApiError::Forbidden(err.to_string())
    } else {
        ApiError::Unprocessable(err.to_string())
    }
}

struct LatestImportJob {
    job_id: u64,
    imported_rows: u32,
}

async fn latest_import_job(
    client: &stdb_client::StdbClient,
    org_id: u64,
    table_name: &str,
) -> Option<LatestImportJob> {
    let sql = format!(
        "SELECT id, imported_rows FROM import_job WHERE organization_id = {org_id} AND table_name = '{table_name}' ORDER BY id DESC LIMIT 1"
    );
    let rows = client.query_sql(&sql).await.ok()?;
    let row = rows.first()?;
    let job_id = row
        .get("id")
        .and_then(|v| v.as_u64())
        .or_else(|| row.get("id").and_then(|v| v.as_str()?.parse().ok()))?;
    let imported_rows = row
        .get("importedRows")
        .or_else(|| row.get("imported_rows"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)?;
    Some(LatestImportJob {
        job_id,
        imported_rows,
    })
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

    let client = state.client_with_token(&session.stdb_token);
    let params = body.params.unwrap_or(ImportParams {
        company_id: None,
        currency_id: None,
    });

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

    client
        .call_reducer(stdb_client::ReducerCall::from_name(spec.reducer, args))
        .await
        .map_err(|e| reducer_error_message(&e.to_string()))?;

    let latest_job = latest_import_job(&client, org_id, spec.table_name).await;

    let mut resp = json!({
        "ok": true,
        "entity": spec.table_name,
    });
    if let Some(job) = latest_job {
        resp["jobId"] = json!(job.job_id);
        resp["rowsImported"] = json!(job.imported_rows);
    }

    Ok(Json(resp))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/import/{entity}", post(import_entity_post))
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
}
