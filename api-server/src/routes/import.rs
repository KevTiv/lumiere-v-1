//! `/v1/import/{entity}` — CSV import via dedicated `import_*_csv` reducers (bypasses `/call` allowlist).

use std::{collections::HashSet, sync::Arc};

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::Cookies;
use tracing::warn;

use crate::commands::dispatch_session_reducer;
use crate::error::ApiError;
use crate::query_exec::default_company_id;
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
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
    company_id: Option<JsonU64>,
    currency_id: Option<JsonU64>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum JsonU64 {
    Number(u64),
    String(String),
}

impl JsonU64 {
    fn parse(self, field: &str) -> Result<u64, ApiError> {
        match self {
            Self::Number(value) => Ok(value),
            Self::String(value) => value
                .parse()
                .map_err(|_| ApiError::BadRequest(format!("params.{field} must be a u64"))),
        }
    }
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct ImportJobSnapshot {
    job_id: u64,
    imported_rows: u32,
}

async fn import_jobs(
    client: &stdb_client::StdbClient,
    org_id: u64,
    table_name: &str,
) -> Result<Vec<ImportJobSnapshot>, ApiError> {
    let sql = format!(
        "SELECT id, imported_rows FROM import_job WHERE organization_id = {org_id} AND table_name = '{table_name}'"
    );
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(ApiError::unavailable)?;
    rows.into_iter()
        .map(|row| {
            let job_id = row
                .get("id")
                .and_then(|value| value.as_u64())
                .or_else(|| row.get("id").and_then(|value| value.as_str()?.parse().ok()))
                .ok_or_else(|| ApiError::Internal("import job has no valid id".into()))?;
            let imported_rows = row
                .get("importedRows")
                .or_else(|| row.get("imported_rows"))
                .and_then(|value| value.as_u64())
                .and_then(|value| u32::try_from(value).ok())
                .ok_or_else(|| {
                    ApiError::Internal("import job has no valid imported row count".into())
                })?;
            Ok(ImportJobSnapshot {
                job_id,
                imported_rows,
            })
        })
        .collect()
}

fn resolve_created_import_job<'a>(
    before: &[ImportJobSnapshot],
    after: &'a [ImportJobSnapshot],
) -> Option<&'a ImportJobSnapshot> {
    let prior_ids = before.iter().map(|job| job.job_id).collect::<HashSet<_>>();
    let mut created = after.iter().filter(|job| !prior_ids.contains(&job.job_id));
    let job = created.next()?;
    created.next().is_none().then_some(job)
}

async fn import_entity_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(entity): Path<String>,
    Json(body): Json<ImportBody>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
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

    let args = match spec.shape {
        ImportArgShape::OrgOnly => json!([org_id, body.csv]),
        ImportArgShape::OrgCompany => {
            let company_id = if let Some(cid) = params.company_id {
                cid.parse("companyId")?
            } else {
                default_company_id(&client, org_id).await?.ok_or_else(|| {
                    ApiError::Unprocessable("No company found for organization".into())
                })?
            };
            json!([org_id, company_id, body.csv])
        }
        ImportArgShape::OrgCurrency => {
            let currency_id = params
                .currency_id
                .ok_or_else(|| {
                    ApiError::BadRequest("params.currencyId is required for product import".into())
                })?
                .parse("currencyId")?;
            json!([org_id, currency_id, body.csv])
        }
    };

    // Snapshot the producer-owned identity set before dispatch. A "latest job"
    // query can select another actor's concurrent import and is not canonical.
    let before = import_jobs(client, org_id, spec.table_name).await?;
    let context = dispatch_session_reducer(&state, &session, spec.reducer, args).await?;
    let after = match import_jobs(context.client(), org_id, spec.table_name).await {
        Ok(jobs) => jobs,
        Err(_) => {
            return Ok((
                StatusCode::ACCEPTED,
                Json(json!({
                    "ok": false,
                    "outcome": "unknown",
                    "reason": "readback-failed",
                    "entity": spec.table_name,
                })),
            ));
        }
    };

    let Some(job) = resolve_created_import_job(&before, &after) else {
        return Ok((
            StatusCode::ACCEPTED,
            Json(json!({
                "ok": false,
                "outcome": "unknown",
                "reason": "readback-ambiguous",
                "entity": spec.table_name,
            })),
        ));
    };

    Ok((
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "outcome": "converged",
            "entity": spec.table_name,
            "jobId": job.job_id,
            "rowsImported": job.imported_rows,
            "record": {
                "resource": "import-jobs",
                "id": job.job_id.to_string(),
                "href": format!("/settings/import-jobs/{}", job.job_id),
            },
        })),
    ))
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

    #[test]
    fn import_ids_accept_exact_decimal_strings() {
        assert_eq!(
            JsonU64::String(u64::MAX.to_string())
                .parse("companyId")
                .unwrap(),
            u64::MAX,
        );
        assert!(JsonU64::String("not-an-id".into())
            .parse("companyId")
            .is_err());
    }

    #[test]
    fn resolves_the_only_job_created_by_this_dispatch() {
        let before = vec![ImportJobSnapshot {
            job_id: 10,
            imported_rows: 2,
        }];
        let after = vec![
            before[0].clone(),
            ImportJobSnapshot {
                job_id: 11,
                imported_rows: 4,
            },
        ];

        assert_eq!(resolve_created_import_job(&before, &after), after.get(1));
    }

    #[test]
    fn refuses_to_guess_when_multiple_jobs_appear() {
        let before = vec![];
        let after = vec![
            ImportJobSnapshot {
                job_id: 11,
                imported_rows: 4,
            },
            ImportJobSnapshot {
                job_id: 12,
                imported_rows: 1,
            },
        ];

        assert_eq!(resolve_created_import_job(&before, &after), None);
    }
}
