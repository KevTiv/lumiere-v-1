/// Import Job Tracker — ImportJob, ImportJobError, ImportJobRecord tables
///
/// Every import reducer creates an ImportJob at the start, logs row-level
/// errors into ImportJobError, records created row IDs into ImportJobRecord,
/// and calls finish_import_job at the end.
use std::collections::HashSet;

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::require_company_in_organization;
use crate::core::users::user_organization;
use crate::crm::contacts::{contact, Contact};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::{product, Product};

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = import_job,
    public,
    index(accessor = import_job_by_org, btree(columns = [organization_id]))
)]
pub struct ImportJob {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub table_name: String,
    pub file_name: Option<String>,
    pub total_rows: u32,
    pub imported_rows: u32,
    pub error_rows: u32,
    /// "pending" | "success" | "partial" | "failed" | "rolled_back"
    pub status: String,
    pub started_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = import_job_error,
    public,
    index(accessor = import_error_by_job, btree(columns = [job_id])),
    index(accessor = import_error_by_organization, btree(columns = [organization_id]))
)]
pub struct ImportJobError {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub job_id: u64,
    pub row_number: u32,
    pub field_name: Option<String>,
    pub raw_value: Option<String>,
    pub error_message: String,
    pub create_date: Timestamp,
}

#[spacetimedb::table(
    accessor = import_job_record,
    public,
    index(accessor = import_record_by_job, btree(columns = [job_id])),
    index(accessor = import_record_by_organization, btree(columns = [organization_id]))
)]
pub struct ImportJobRecord {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub job_id: u64,
    pub table_name: String,
    pub record_id: u64,
    pub row_number: u32,
    pub create_date: Timestamp,
}

// ── Helpers (called by import reducers, not exposed as reducers) ──────────────

/// Create an ImportJob record at the start of an import.
pub fn begin_import_job(
    ctx: &ReducerContext,
    organization_id: u64,
    table_name: &str,
    file_name: Option<String>,
    total_rows: u32,
) -> ImportJob {
    ctx.db.import_job().insert(ImportJob {
        id: 0,
        organization_id,
        table_name: table_name.to_string(),
        file_name,
        total_rows,
        imported_rows: 0,
        error_rows: 0,
        status: "pending".to_string(),
        started_at: ctx.timestamp,
        completed_at: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        metadata: None,
    })
}

/// SHA-256 identity of an import file (lowercase hex of the exact bytes received).
pub fn import_content_sha256(csv_data: &str) -> String {
    hex::encode(Sha256::digest(csv_data.as_bytes()))
}

fn metadata_has_sha256(metadata: Option<&str>, sha256: &str) -> bool {
    metadata
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .and_then(|value| {
            value
                .get("sha256")
                .and_then(|hash| hash.as_str())
                .map(str::to_owned)
        })
        .is_some_and(|hash| hash == sha256)
}

fn merge_import_sha256(metadata: Option<&str>, sha256: &str) -> String {
    let mut value = metadata
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    value["sha256"] = serde_json::json!(sha256);
    value.to_string()
}

/// Reject a replay of a file already committed for this organization and entity.
/// Jobs that imported nothing (status `failed`) do not block a corrected retry.
pub fn reject_committed_import_replay(
    ctx: &ReducerContext,
    organization_id: u64,
    table_name: &str,
    sha256: &str,
) -> Result<(), String> {
    let replayed = ctx
        .db
        .import_job()
        .import_job_by_org()
        .filter(&organization_id)
        .find(|job| {
            job.table_name == table_name
                && matches!(job.status.as_str(), "success" | "partial")
                && metadata_has_sha256(job.metadata.as_deref(), sha256)
        });
    match replayed {
        Some(job) => Err(format!(
            "this {table_name} file was already imported (import job {}, sha256 {sha256})",
            job.id
        )),
        None => Ok(()),
    }
}

/// Stamp a freshly begun job with its file identity so later replays are detected.
pub fn stamp_import_sha256(ctx: &ReducerContext, job: ImportJob, sha256: &str) -> ImportJob {
    ctx.db.import_job().id().update(ImportJob {
        metadata: Some(merge_import_sha256(job.metadata.as_deref(), sha256)),
        ..job
    })
}

/// Record a single row-level error into ImportJobError.
pub fn record_import_error(
    ctx: &ReducerContext,
    job_id: u64,
    row_number: u32,
    field_name: Option<&str>,
    raw_value: Option<&str>,
    error_message: &str,
) {
    let Some(job) = ctx.db.import_job().id().find(&job_id) else {
        log::error!("Cannot record import error for unknown job_id={}", job_id);
        return;
    };
    let entity = job.table_name.clone();
    log::warn!(
        "Import row rejected: entity={} job_id={} row={} field={:?} error={}",
        entity,
        job_id,
        row_number,
        field_name,
        error_message
    );
    ctx.db.import_job_error().insert(ImportJobError {
        id: 0,
        organization_id: job.organization_id,
        job_id,
        row_number,
        field_name: field_name.map(|s| s.to_string()),
        raw_value: raw_value.map(|s| s.to_string()),
        error_message: error_message.to_string(),
        create_date: ctx.timestamp,
    });
}

/// Record a successfully inserted row ID for later rollback.
pub fn record_import_created_id(
    ctx: &ReducerContext,
    job_id: u64,
    table_name: &str,
    record_id: u64,
    row_number: u32,
) {
    let Some(job) = ctx.db.import_job().id().find(&job_id) else {
        log::error!("Cannot record import row for unknown job_id={}", job_id);
        return;
    };
    ctx.db.import_job_record().insert(ImportJobRecord {
        id: 0,
        organization_id: job.organization_id,
        job_id,
        table_name: table_name.to_string(),
        record_id,
        row_number,
        create_date: ctx.timestamp,
    });
}

/// Update the ImportJob with final counts after processing all rows.
pub fn finish_import_job(
    ctx: &ReducerContext,
    job: ImportJob,
    imported_rows: u32,
    error_rows: u32,
) {
    let status = if error_rows == 0 {
        "success"
    } else if imported_rows == 0 {
        "failed"
    } else {
        "partial"
    };

    ctx.db.import_job().id().update(ImportJob {
        imported_rows,
        error_rows,
        status: status.to_string(),
        completed_at: Some(ctx.timestamp),
        ..job
    });
}

fn rollback_delete_record(
    ctx: &ReducerContext,
    organization_id: u64,
    table_name: &str,
    record_id: u64,
) -> Result<(), String> {
    match table_name {
        "contact" => {
            let contact = ctx
                .db
                .contact()
                .id()
                .find(&record_id)
                .ok_or_else(|| format!("Contact {record_id} not found"))?;
            if contact.organization_id != organization_id {
                return Err(format!(
                    "Contact {record_id} does not belong to this organization"
                ));
            }
            if contact.deleted_at.is_some() {
                return Ok(());
            }
            ctx.db.contact().id().update(Contact {
                deleted_at: Some(ctx.timestamp),
                updated_at: ctx.timestamp,
                ..contact
            });
            Ok(())
        }
        "product" => {
            let product_row = ctx
                .db
                .product()
                .id()
                .find(&record_id)
                .ok_or_else(|| format!("Product {record_id} not found"))?;
            if product_row.organization_id != organization_id {
                return Err(format!(
                    "Product {record_id} does not belong to this organization"
                ));
            }
            if !product_row.active {
                return Ok(());
            }
            ctx.db.product().id().update(Product {
                active: false,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..product_row
            });
            Ok(())
        }
        other => Err(format!("Rollback not supported for table: {other}")),
    }
}

// ── Tracked CSV submission protocol ───────────────────────────────────────────

/// User data for an exactly correlated CSV submission. Reuse `request_id` only
/// when retrying the exact same payload; a corrected upload needs a new ID.
#[derive(SpacetimeType, Clone, Debug)]
pub struct ImportCsvTrackedParams {
    pub request_id: String,
    /// Canonical ImportJob table name, not a UI route alias.
    pub entity: String,
    pub csv_data: String,
    pub file_name: Option<String>,
    pub currency_id: Option<u64>,
}

fn validate_import_request_id(request_id: &str) -> Result<(), String> {
    if request_id.len() != 32
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("request_id must be 32 lowercase hexadecimal characters".to_string());
    }
    Ok(())
}

/// Compare identity membership, never ID magnitude or timestamps. The snapshot
/// and dispatch run in one reducer transaction, so concurrent submissions cannot
/// contribute jobs to this difference. An invariant failure rolls everything back.
fn exact_new_import_job_id(
    previous: &HashSet<u64>,
    current: impl IntoIterator<Item = u64>,
) -> Result<u64, String> {
    let mut created = current.into_iter().filter(|id| !previous.contains(id));
    let id = created.next().ok_or("import did not create a job")?;
    if created.next().is_some() {
        return Err("import created more than one job".to_string());
    }
    Ok(id)
}

fn authorize_tracked_import_company(
    membership_company_id: Option<u64>,
    selected_company_id: Option<u64>,
) -> Result<(), String> {
    if selected_company_id == Some(0) {
        return Err("company_id must be non-zero".to_string());
    }
    if membership_company_id.is_some() && membership_company_id != selected_company_id {
        return Err("company_id is outside the caller membership scope".to_string());
    }
    Ok(())
}

fn tracked_import_metadata(
    request_id: &str,
    sha256: &str,
    company_id: Option<u64>,
    currency_id: Option<u64>,
) -> serde_json::Value {
    serde_json::json!({
        "correlation_version": 1,
        "request_id": request_id,
        "sha256": sha256,
        "company_id": company_id,
        "currency_id": currency_id,
    })
}

fn metadata_request_id(metadata: Option<&str>) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(metadata?).ok()?;
    value.get("request_id")?.as_str().map(str::to_owned)
}

fn matches_tracked_import_metadata(metadata: Option<&str>, expected: &serde_json::Value) -> bool {
    let Some(value) = metadata.and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
    else {
        return false;
    };
    let Some(expected) = expected.as_object() else {
        return false;
    };
    expected
        .iter()
        .all(|(key, expected_value)| value.get(key) == Some(expected_value))
}

// Keep the permission resource distinct from the tracked table: payroll import
// reducers authorize against hr_payroll while writing three different tables.
fn tracked_import_permission(entity: &str) -> Result<&str, String> {
    match entity {
        "account_account" => Ok("account_account"),
        "account_tax" => Ok("account_tax"),
        "account_move" => Ok("account_move"),
        "account_move_line" => Ok("account_move_line"),
        "crossovered_budget" => Ok("crossovered_budget"),
        "crossovered_budget_lines" => Ok("crossovered_budget_lines"),
        "account_analytic_account" => Ok("account_analytic_account"),
        "ai_agent" => Ok("ai_agent"),
        "report_template" => Ok("report_template"),
        "analytics_metric" => Ok("analytics_metric"),
        "country" => Ok("country"),
        "currency" => Ok("currency"),
        "currency_rate" => Ok("currency_rate"),
        "uom_category" => Ok("uom_category"),
        "uom" => Ok("uom"),
        "company" => Ok("company"),
        "role" => Ok("role"),
        "contact" => Ok("contact"),
        "lead" => Ok("lead"),
        "opportunity" => Ok("opportunity"),
        "knowledge_article_category" => Ok("knowledge_article_category"),
        "knowledge_article" => Ok("knowledge_article"),
        "hr_expense" => Ok("hr_expense"),
        "hr_expense_sheet" => Ok("hr_expense_sheet"),
        "helpdesk_team" => Ok("helpdesk_team"),
        "helpdesk_stage" => Ok("helpdesk_stage"),
        "helpdesk_sla" => Ok("helpdesk_sla"),
        "helpdesk_ticket" => Ok("helpdesk_ticket"),
        "hr_resource" => Ok("hr_resource"),
        "hr_department" => Ok("hr_department"),
        "hr_job_position" => Ok("hr_job_position"),
        "hr_employee" => Ok("hr_employee"),
        "hr_contract" => Ok("hr_contract"),
        "hr_leave_type" => Ok("hr_leave_type"),
        "hr_leave" => Ok("hr_leave"),
        "hr_payroll_structure" => Ok("hr_payroll"),
        "hr_salary_rule" => Ok("hr_payroll"),
        "hr_payslip" => Ok("hr_payroll"),
        "product_category" => Ok("product_category"),
        "product" => Ok("product"),
        "product_variant" => Ok("product_variant"),
        "warehouse" => Ok("warehouse"),
        "stock_location" => Ok("stock_location"),
        "stock_quant" => Ok("stock_quant"),
        "stock_production_lot" => Ok("stock_production_lot"),
        "mrp_workcenter" => Ok("mrp_workcenter"),
        "mrp_bom" => Ok("mrp_bom"),
        "mrp_bom_line" => Ok("mrp_bom_line"),
        "mrp_production" => Ok("mrp_production"),
        "project_project" => Ok("project_project"),
        "project_task" => Ok("project_task"),
        "project_timesheet" => Ok("project_timesheet"),
        "purchase_order" => Ok("purchase_order"),
        "purchase_order_line" => Ok("purchase_order_line"),
        "product_supplier_info" => Ok("product_supplier_info"),
        "sale_order" => Ok("sale_order"),
        "sale_order_line" => Ok("sale_order_line"),
        "subscription_plan" => Ok("subscription_plan"),
        "subscription" => Ok("subscription"),
        "workflow" => Ok("workflow"),
        _ => Err("unsupported CSV import entity".to_string()),
    }
}

fn tracked_import_requires_company(entity: &str) -> bool {
    matches!(
        entity,
        "account_account"
            | "account_tax"
            | "account_move"
            | "account_move_line"
            | "crossovered_budget"
            | "crossovered_budget_lines"
            | "account_analytic_account"
            | "warehouse"
            | "stock_location"
            | "stock_quant"
            | "stock_production_lot"
            | "mrp_workcenter"
            | "mrp_bom"
            | "mrp_bom_line"
            | "mrp_production"
            | "project_project"
            | "project_task"
            | "project_timesheet"
            | "purchase_order"
            | "purchase_order_line"
            | "sale_order"
            | "sale_order_line"
            | "subscription_plan"
            | "subscription"
    )
}

fn dispatch_tracked_import(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    currency_id: Option<u64>,
    params: ImportCsvTrackedParams,
) -> Result<(), String> {
    // Validate scope before entering a legacy reducer; retain every legacy
    // permission check, CSV parser, row isolation, and content replay policy.
    let company = || company_id.ok_or_else(|| "company_id is required for this import".to_string());
    let currency =
        || currency_id.ok_or_else(|| "currency_id is required for this import".to_string());
    match params.entity.as_str() {
        "account_account" => crate::data_ops::accounting_imports::import_account_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "account_tax" => crate::data_ops::accounting_imports::import_tax_rate_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "account_move" => crate::data_ops::accounting_imports::import_account_move_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "account_move_line" => crate::data_ops::accounting_imports::import_account_move_line_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "crossovered_budget" => crate::data_ops::accounting_imports::import_budget_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "crossovered_budget_lines" => crate::data_ops::accounting_imports::import_budget_line_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "account_analytic_account" => {
            crate::data_ops::accounting_imports::import_analytic_account_csv(
                ctx,
                organization_id,
                company()?,
                params.csv_data,
            )
        }
        "ai_agent" => {
            crate::data_ops::ai_imports::import_ai_agent_csv(ctx, organization_id, params.csv_data)
        }
        "report_template" => crate::data_ops::analytics_imports::import_report_template_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "analytics_metric" => crate::data_ops::analytics_imports::import_analytics_metric_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "country" => {
            crate::data_ops::core_imports::import_country_csv(ctx, organization_id, params.csv_data)
        }
        "currency" => crate::data_ops::core_imports::import_currency_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "currency_rate" => crate::data_ops::core_imports::import_currency_rate_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "uom_category" => crate::data_ops::core_imports::import_uom_category_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "uom" => {
            crate::data_ops::core_imports::import_uom_csv(ctx, organization_id, params.csv_data)
        }
        "company" => {
            crate::data_ops::core_imports::import_company_csv(ctx, organization_id, params.csv_data)
        }
        "role" => {
            crate::data_ops::core_imports::import_role_csv(ctx, organization_id, params.csv_data)
        }
        "contact" => {
            crate::data_ops::crm_imports::import_contact_csv(ctx, organization_id, params.csv_data)
        }
        "lead" => {
            crate::data_ops::crm_imports::import_lead_csv(ctx, organization_id, params.csv_data)
        }
        "opportunity" => crate::data_ops::crm_imports::import_opportunity_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "knowledge_article_category" => {
            crate::data_ops::document_imports::import_knowledge_category_csv(
                ctx,
                organization_id,
                params.csv_data,
            )
        }
        "knowledge_article" => crate::data_ops::document_imports::import_knowledge_article_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "hr_expense" => crate::data_ops::expenses_imports::import_expense_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "hr_expense_sheet" => crate::data_ops::expenses_imports::import_expense_sheet_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "helpdesk_team" => crate::data_ops::helpdesk_imports::import_helpdesk_team_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "helpdesk_stage" => crate::data_ops::helpdesk_imports::import_helpdesk_stage_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "helpdesk_sla" => crate::data_ops::helpdesk_imports::import_helpdesk_sla_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "helpdesk_ticket" => crate::data_ops::helpdesk_imports::import_helpdesk_ticket_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "hr_resource" => crate::data_ops::hr_imports::import_hr_resource_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "hr_department" => crate::data_ops::hr_imports::import_hr_department_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "hr_job_position" => crate::data_ops::hr_imports::import_hr_job_position_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "hr_employee" => crate::data_ops::hr_imports::import_hr_employee_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "hr_contract" => crate::data_ops::hr_imports::import_hr_contract_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "hr_leave_type" => crate::data_ops::hr_imports::import_hr_leave_type_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "hr_leave" => {
            crate::data_ops::hr_imports::import_hr_leave_csv(ctx, organization_id, params.csv_data)
        }
        "hr_payroll_structure" => crate::data_ops::hr_imports::import_hr_payroll_structure_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "hr_salary_rule" => crate::data_ops::hr_imports::import_hr_salary_rule_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "hr_payslip" => crate::data_ops::hr_imports::import_hr_payslip_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "product_category" => crate::data_ops::inventory_imports::import_product_category_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "product" => crate::data_ops::inventory_imports::import_product_csv(
            ctx,
            organization_id,
            currency()?,
            params.csv_data,
        ),
        "product_variant" => crate::data_ops::inventory_imports::import_product_variant_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "warehouse" => crate::data_ops::inventory_imports::import_warehouse_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "stock_location" => crate::data_ops::inventory_imports::import_stock_location_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "stock_quant" => crate::data_ops::inventory_imports::import_stock_quant_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "stock_production_lot" => crate::data_ops::inventory_imports::import_lot_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "mrp_workcenter" => crate::data_ops::manufacturing_imports::import_workcenter_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "mrp_bom" => crate::data_ops::manufacturing_imports::import_bom_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "mrp_bom_line" => crate::data_ops::manufacturing_imports::import_bom_line_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "mrp_production" => crate::data_ops::manufacturing_imports::import_manufacturing_order_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "project_project" => crate::data_ops::project_imports::import_project_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "project_task" => crate::data_ops::project_imports::import_task_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "project_timesheet" => crate::data_ops::project_imports::import_timesheet_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "purchase_order" => crate::data_ops::purchasing_imports::import_purchase_order_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "purchase_order_line" => {
            crate::data_ops::purchasing_imports::import_purchase_order_line_csv(
                ctx,
                organization_id,
                company()?,
                params.csv_data,
            )
        }
        "product_supplier_info" => crate::data_ops::purchasing_imports::import_supplier_info_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        "sale_order" => crate::data_ops::sales_imports::import_sale_order_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "sale_order_line" => crate::data_ops::sales_imports::import_sale_order_line_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "subscription_plan" => crate::data_ops::subscription_imports::import_subscription_plan_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "subscription" => crate::data_ops::subscription_imports::import_subscription_csv(
            ctx,
            organization_id,
            company()?,
            params.csv_data,
        ),
        "workflow" => crate::data_ops::workflow_imports::import_workflow_csv(
            ctx,
            organization_id,
            params.csv_data,
        ),
        _ => Err("unsupported CSV import entity".to_string()),
    }
}

/// Submit a CSV and commit its request ID on the exact job created in this
/// transaction. Reducers return no row data; clients resolve the receipt from
/// ImportJob by organization + authenticated create_uid + request_id.
///
/// Optional company scope records the initiating workspace for organization-wide
/// imports; it does not change those imports into company-owned row mutations.
///
/// Exact retries reuse the existing receipt without importing rows again,
/// including failed and rolled-back receipts. Changed payloads must use a new
/// request ID. Legacy direct imports remain supported.
#[reducer]
pub fn import_csv_tracked(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: ImportCsvTrackedParams,
) -> Result<(), String> {
    let currency_id = params.currency_id;
    validate_import_request_id(&params.request_id)?;
    let permission = tracked_import_permission(&params.entity)?;
    check_permission(ctx, organization_id, permission, "create")?;
    // Use the same active organization membership as check_permission, and
    // enforce its company restriction before either replay or fresh dispatch.
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == organization_id && row.is_active)
        .ok_or("not a member of this organization")?;
    authorize_tracked_import_company(membership.company_id, company_id)?;
    if let Some(company_id) = company_id {
        require_company_in_organization(ctx, organization_id, company_id)?;
    }
    if tracked_import_requires_company(&params.entity) && company_id.is_none() {
        return Err("company_id is required for this import".to_string());
    }
    if params.entity == "product" && currency_id.is_none() {
        return Err("currency_id is required for this import".to_string());
    }
    if params.entity != "product" && currency_id.is_some() {
        return Err("currency_id is not used by this import".to_string());
    }
    let sha256 = import_content_sha256(&params.csv_data);
    let expected = tracked_import_metadata(&params.request_id, &sha256, company_id, currency_id);
    let mut previous = HashSet::new();
    let mut retry = None;
    for job in ctx
        .db
        .import_job()
        .import_job_by_org()
        .filter(&organization_id)
    {
        previous.insert(job.id);
        if job.create_uid == ctx.sender()
            && metadata_request_id(job.metadata.as_deref()).as_deref()
                == Some(params.request_id.as_str())
        {
            if retry.is_some() {
                return Err("ambiguous import request receipt".to_string());
            }
            if job.table_name != params.entity
                || job.file_name != params.file_name
                || !matches_tracked_import_metadata(job.metadata.as_deref(), &expected)
                || !matches!(
                    job.status.as_str(),
                    "success" | "partial" | "failed" | "rolled_back"
                )
            {
                return Err("request_id was already used for a different import".to_string());
            }
            retry = Some(job.id);
        }
    }
    let job_id = if let Some(job_id) = retry {
        job_id
    } else {
        let entity = params.entity.clone();
        let file_name = params.file_name.clone();
        dispatch_tracked_import(ctx, organization_id, company_id, currency_id, params)?;
        let job_id = exact_new_import_job_id(
            &previous,
            ctx.db
                .import_job()
                .import_job_by_org()
                .filter(&organization_id)
                .map(|job| job.id),
        )?;
        let job = ctx
            .db
            .import_job()
            .id()
            .find(&job_id)
            .ok_or("import job not found")?;
        if job.organization_id != organization_id
            || job.create_uid != ctx.sender()
            || job.table_name != entity
            || job.completed_at.is_none()
            || !matches!(job.status.as_str(), "success" | "partial" | "failed")
        {
            return Err("import produced an unexpected job".to_string());
        }
        let mut metadata = job
            .metadata
            .as_deref()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .filter(serde_json::Value::is_object)
            .unwrap_or_else(|| serde_json::json!({}));
        let expected_fields = expected
            .as_object()
            .ok_or("invalid tracked import metadata")?;
        for (key, value) in expected_fields {
            metadata[key.as_str()] = value.clone();
        }
        ctx.db.import_job().id().update(ImportJob {
            file_name,
            metadata: Some(metadata.to_string()),
            ..job
        });
        job_id
    };
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "import_job",
            record_id: job_id,
            action: if retry.is_some() {
                "IMPORT_RETRY"
            } else {
                "IMPORT_SUBMIT"
            },
            old_values: None,
            new_values: None,
            changed_fields: if retry.is_some() {
                Vec::new()
            } else {
                vec!["metadata".to_string(), "file_name".to_string()]
            },
            metadata: Some(expected.to_string()),
        },
    );
    Ok(())
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn rollback_import_job(
    ctx: &ReducerContext,
    organization_id: u64,
    job_id: u64,
) -> Result<(), String> {
    let job = ctx
        .db
        .import_job()
        .id()
        .find(&job_id)
        .ok_or("Import job not found")?;

    if job.organization_id != organization_id {
        return Err("Import job does not belong to this organization".to_string());
    }

    if job.status == "pending" {
        return Err("Import job is still in progress".to_string());
    }

    if job.status == "rolled_back" {
        return Err("Import job has already been rolled back".to_string());
    }

    check_permission(ctx, organization_id, &job.table_name, "delete")?;

    let records: Vec<ImportJobRecord> = ctx
        .db
        .import_job_record()
        .import_record_by_job()
        .filter(&job_id)
        .collect();

    if records.is_empty() {
        return Err("No import records found for this job".to_string());
    }

    let table_name = job.table_name.clone();
    let mut deleted_count = 0u32;
    for record in &records {
        if record.organization_id != job.organization_id {
            return Err("Import record does not belong to the import job organization".to_string());
        }
        rollback_delete_record(ctx, organization_id, &record.table_name, record.record_id)?;
        ctx.db.import_job_record().id().delete(&record.id);
        deleted_count += 1;
    }

    ctx.db.import_job().id().update(ImportJob {
        status: "rolled_back".to_string(),
        ..job
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "import_job",
            record_id: job_id,
            action: "ROLLBACK",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "table_name": table_name,
                    "deleted_count": deleted_count,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: Some(
                serde_json::json!({
                    "job_id": job_id,
                    "deleted_count": deleted_count,
                })
                .to_string(),
            ),
        },
    );

    log::info!(
        "Rollback import job {}: deleted {} {} record(s)",
        job_id,
        deleted_count,
        table_name
    );

    Ok(())
}

#[cfg(test)]
mod tracked_import_tests {
    use super::*;

    const REQUEST: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn request_ids_are_exact_lowercase_hex_not_sql_fragments() {
        assert!(validate_import_request_id(REQUEST).is_ok());
        for invalid in [
            "",
            "0123456789abcdef",
            "0123456789abcdef0123456789abcdeF",
            "0123456789abcdef0123456789abcde'",
            "0123456789abcdef0123456789abcdef0",
        ] {
            assert!(validate_import_request_id(invalid).is_err());
        }
    }

    #[test]
    fn exact_new_job_is_membership_not_id_order() {
        let previous = HashSet::from([90, 400]);
        assert_eq!(exact_new_import_job_id(&previous, [400, 2, 90]), Ok(2));
    }

    #[test]
    fn missing_or_multiple_new_jobs_fail_closed() {
        let previous = HashSet::from([90]);
        assert!(exact_new_import_job_id(&previous, [90]).is_err());
        assert!(exact_new_import_job_id(&previous, [90, 2, 3]).is_err());
    }

    #[test]
    fn every_transaction_snapshot_resolves_only_its_own_submission() {
        let before_first = HashSet::from([90]);
        assert_eq!(exact_new_import_job_id(&before_first, [90, 2]), Ok(2));
        let before_second = HashSet::from([90, 2]);
        assert_eq!(exact_new_import_job_id(&before_second, [90, 2, 1]), Ok(1));
    }

    #[test]
    fn exact_metadata_retry_preserves_scope_and_content() {
        let expected = tracked_import_metadata(REQUEST, "hash", Some(7), Some(8));
        assert!(matches_tracked_import_metadata(
            Some(&expected.to_string()),
            &expected
        ));
        for different in [
            tracked_import_metadata("11111111111111111111111111111111", "hash", Some(7), Some(8)),
            tracked_import_metadata(REQUEST, "different", Some(7), Some(8)),
            tracked_import_metadata(REQUEST, "hash", Some(9), Some(8)),
            tracked_import_metadata(REQUEST, "hash", Some(7), Some(9)),
            tracked_import_metadata(REQUEST, "hash", None, Some(8)),
        ] {
            assert!(!matches_tracked_import_metadata(
                Some(&different.to_string()),
                &expected
            ));
        }
    }

    #[test]
    fn malformed_or_unversioned_receipts_are_not_exact_retries() {
        let expected = tracked_import_metadata(REQUEST, "hash", None, None);
        for invalid in [None, Some("{}"), Some("null"), Some("not json")] {
            assert!(!matches_tracked_import_metadata(invalid, &expected));
            assert_eq!(metadata_request_id(invalid), None);
        }
        let mut unversioned = expected.clone();
        unversioned
            .as_object_mut()
            .unwrap()
            .remove("correlation_version");
        assert!(!matches_tracked_import_metadata(
            Some(&unversioned.to_string()),
            &expected
        ));
    }

    #[test]
    fn receipt_metadata_can_keep_unrelated_job_metadata() {
        let expected = tracked_import_metadata(REQUEST, "hash", Some(7), None);
        let mut extended = expected.clone();
        extended["other"] = serde_json::json!({"retained": true});
        assert!(matches_tracked_import_metadata(
            Some(&extended.to_string()),
            &expected
        ));
        assert_eq!(
            metadata_request_id(Some(&extended.to_string())),
            Some(REQUEST.to_string())
        );
    }

    #[test]
    fn committed_content_replay_survives_correlation_metadata() {
        let tracked = tracked_import_metadata(REQUEST, "hash", Some(7), None).to_string();
        assert!(metadata_has_sha256(Some(&tracked), "hash"));
        assert!(metadata_has_sha256(Some(r#"{"sha256":"hash"}"#), "hash"));
        assert!(!metadata_has_sha256(Some(&tracked), "other"));
        assert!(!metadata_has_sha256(Some(r#"{"sha256":123}"#), "hash"));
    }

    #[test]
    fn stamp_hash_keeps_existing_correlation_fields() {
        let original = tracked_import_metadata(REQUEST, "old", Some(7), None).to_string();
        let stamped = merge_import_sha256(Some(&original), "new");
        assert!(metadata_has_sha256(Some(&stamped), "new"));
        assert_eq!(
            metadata_request_id(Some(&stamped)),
            Some(REQUEST.to_string())
        );
    }

    #[test]
    fn sha256_is_exact_csv_bytes() {
        assert_eq!(
            import_content_sha256(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_ne!(
            import_content_sha256("name\nAlice\n"),
            import_content_sha256("name\r\nAlice\r\n")
        );
    }

    #[test]
    fn payroll_permission_names_are_not_guessed_from_receipt_tables() {
        for entity in ["hr_payroll_structure", "hr_salary_rule", "hr_payslip"] {
            assert_eq!(tracked_import_permission(entity), Ok("hr_payroll"));
        }
        assert_eq!(
            tracked_import_permission("account_account"),
            Ok("account_account")
        );
        assert!(tracked_import_permission("account").is_err());
        assert!(tracked_import_permission("unsupported").is_err());
    }

    #[test]
    fn restricted_company_membership_cannot_be_bypassed_with_missing_context() {
        assert!(authorize_tracked_import_company(Some(7), Some(7)).is_ok());
        assert!(authorize_tracked_import_company(Some(7), Some(8)).is_err());
        assert!(authorize_tracked_import_company(Some(7), None).is_err());
        assert!(authorize_tracked_import_company(None, Some(7)).is_ok());
        assert!(authorize_tracked_import_company(None, None).is_ok());
        assert!(authorize_tracked_import_company(None, Some(0)).is_err());
    }

    #[test]
    fn company_requirements_match_legacy_import_signatures() {
        assert!(tracked_import_requires_company("mrp_bom"));
        assert!(tracked_import_requires_company("account_account"));
        assert!(!tracked_import_requires_company("contact"));
        assert!(!tracked_import_requires_company("hr_payslip"));
    }
}
