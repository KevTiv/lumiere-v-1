/// HR Payroll — HrPayrollStructure, HrSalaryRule, HrPayslip, HrPayrollExportIntent
///
/// Payroll structures and salary rules are **configuration hints only** — they are not
/// executed as a universal gross-to-net engine. Country packs + export intents (or GL post)
/// provide the finance boundary; `PayslipState::Done` requires an export artifact or
/// `account_move_id`.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::{account_journal};
use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::line_params::{journal_line_params, validate_company_account};
use crate::accounting::journal_entries::{
    account_move, account_move_line, insert_draft_account_move_line, AccountMove,
};
use crate::core::country_pack::company_enabled_pack_keys;
use crate::core::organization::{company, company_id_from_scope};
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::hr::contracts::hr_contract;
use crate::types::{AccountMoveState, MoveType, PaymentState, PayslipState};

// ── Tables ────────────────────────────────────────────────────────────────────

/// HR Payroll Structure — A named set of salary rules (e.g. "Monthly Staff").
#[spacetimedb::table(
    accessor = hr_payroll_structure,
    public,
    index(accessor = payroll_structure_by_org, btree(columns = [organization_id]))
)]
pub struct HrPayrollStructure {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,  // e.g. "Monthly", "Hourly"
    pub type_: String, // "employee" | "worker"
    pub is_active: bool,
    pub created_at: Timestamp,
}

/// HR Salary Rule — One computation rule within a payroll structure (stored, not executed).
#[spacetimedb::table(
    accessor = hr_salary_rule,
    public,
    index(accessor = salary_rule_by_structure, btree(columns = [structure_id])),
    index(accessor = salary_rule_by_org, btree(columns = [organization_id]))
)]
pub struct HrSalaryRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub code: String,           // e.g. "BASIC", "NET", "TAX"
    pub structure_id: u64,      // FK → HrPayrollStructure
    pub category: String,       // "BASIC" | "ALW" | "DED" | "NET"
    pub condition_type: String, // "none" | "range" | "python" (not interpreted)
    pub amount_type: String,    // "fix" | "percentage" | "code" (not interpreted)
    pub amount_fix: f64,
    pub amount_percentage: f64, // 0–100
    pub sequence: u32,
    pub is_active: bool,
}

/// Durable payroll export intent for country-pack workers (no HTTP in reducers).
#[spacetimedb::table(
    accessor = hr_payroll_export_intent,
    public,
    index(accessor = payroll_export_intent_by_org, btree(columns = [organization_id])),
    index(accessor = payroll_export_intent_by_company, btree(columns = [company_id])),
    index(accessor = payroll_export_intent_by_payslip, btree(columns = [payslip_id])),
    index(accessor = payroll_export_intent_by_status, btree(columns = [status])),
    index(accessor = payroll_export_intent_by_key, btree(columns = [idempotency_key]))
)]
pub struct HrPayrollExportIntent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub payslip_id: u64,
    /// Country pack key (e.g. "au", "za") — metadata hook only, no statutory math here.
    pub pack_key: String,
    /// pending | sent | failed | applied
    pub status: String,
    pub idempotency_key: String,
    pub payload: String,
    pub payload_hash: Option<String>,
    pub external_ref: Option<String>,
    pub last_error: Option<String>,
    pub attempt_count: u32,
    pub applied_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// HR Payslip — A computed payslip for one employee in one pay period.
#[spacetimedb::table(
    accessor = hr_payslip,
    public,
    index(accessor = payslip_by_employee, btree(columns = [employee_id])),
    index(accessor = payslip_by_state, btree(columns = [state])),
    index(accessor = payslip_by_org, btree(columns = [organization_id]))
)]
pub struct HrPayslip {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,             // "Payslip - Alice Smith - March 2026"
    pub number: Option<String>,   // "PAYSLIP-0001" (set on approve)
    pub employee_id: u64,         // FK → HrEmployee
    pub contract_id: Option<u64>, // FK → HrContract
    pub struct_id: u64,           // FK → HrPayrollStructure
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub basic_wage: f64,
    pub gross_wage: f64,
    pub net_wage: f64,
    pub state: PayslipState,
    /// manual | external — figures are proposed, not engine-calculated.
    pub calculation_source: Option<String>,
    pub calculation_metadata: Option<String>,
    pub account_move_id: Option<u64>,
    pub export_intent_id: Option<u64>,
    pub notes: Option<String>,
    pub created_at: Timestamp,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePayrollStructureParams {
    pub name: String,
    pub type_: String,
    pub is_active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSalaryRuleParams {
    pub name: String,
    pub code: String,
    pub structure_id: u64,
    pub category: String,
    pub condition_type: String,
    pub amount_type: String,
    pub amount_fix: f64,
    pub amount_percentage: f64,
    pub sequence: u32,
    pub is_active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePayslipParams {
    pub company_id: Option<u64>,
    pub employee_id: u64,
    pub struct_id: u64,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub basic_wage: f64,
    pub contract_id: Option<u64>,
    pub notes: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ConfirmPayslipParams {
    pub company_id: Option<u64>,
    pub gross_wage: f64,
    pub net_wage: f64,
    /// manual | external — caller-provided figures, not salary-rule engine output.
    pub calculation_source: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePayrollExportIntentParams {
    pub pack_key: Option<String>,
    pub idempotency_key: String,
    pub payload: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordPayrollExportResultParams {
    pub status: String,
    pub external_ref: Option<String>,
    pub payload_hash: Option<String>,
    pub last_error: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PostPayslipParams {
    pub journal_id: u64,
    pub expense_account_id: u64,
    pub payable_account_id: u64,
    pub tax_withholding_account_id: Option<u64>,
    pub accounting_date: Timestamp,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn payslip_export_intent_applied(ctx: &ReducerContext, payslip: &HrPayslip) -> bool {
    if let Some(intent_id) = payslip.export_intent_id {
        if let Some(intent) = ctx.db.hr_payroll_export_intent().id().find(&intent_id) {
            return intent.status == "applied";
        }
    }
    false
}

fn payslip_has_close_artifact(ctx: &ReducerContext, payslip: &HrPayslip) -> bool {
    payslip.account_move_id.is_some() || payslip_export_intent_applied(ctx, payslip)
}

fn resolve_pack_key(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    requested: Option<String>,
) -> Result<String, String> {
    if let Some(key) = requested {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            return Err("pack_key cannot be empty".to_string());
        }
        return Ok(trimmed.to_string());
    }
    let keys = company_enabled_pack_keys(ctx, organization_id, company_id);
    keys.into_iter()
        .next()
        .ok_or("No enabled country pack for company — set pack_key explicitly".to_string())
}

/// Apply partner engine payslip figures (Verify state only) — no salary-rule execution.
pub(crate) fn apply_partner_payslip_artifact(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payslip_id: u64,
    gross_wage: Option<f64>,
    net_wage: Option<f64>,
    calculation_metadata: Option<String>,
) -> Result<(), String> {
    let payslip = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or("Payslip not found")?;
    if payslip.organization_id != organization_id {
        return Err("Payslip belongs to a different organization".to_string());
    }
    if payslip.company_id != company_id {
        return Err("Payslip does not belong to this company".to_string());
    }
    if payslip.state != PayslipState::Verify {
        return Err(
            "Partner artifact applies only to Verify (approved-for-export) payslips".to_string(),
        );
    }
    let gross = gross_wage.unwrap_or(payslip.gross_wage);
    let net = net_wage.unwrap_or(payslip.net_wage);
    let meta = calculation_metadata.or_else(|| {
        Some(
            serde_json::json!({
                "partner_gross_wage": gross,
                "partner_net_wage": net,
                "calculation_source": "external",
                "note": "Partner engine artifact — not salary-rule engine output",
            })
            .to_string(),
        )
    });
    ctx.db.hr_payslip().id().update(HrPayslip {
        gross_wage: gross,
        net_wage: net,
        calculation_source: Some("external".to_string()),
        calculation_metadata: meta,
        ..payslip
    });
    Ok(())
}

pub(crate) fn apply_payroll_export_result_internal(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
    params: RecordPayrollExportResultParams,
) -> Result<(), String> {
    let intent = ctx
        .db
        .hr_payroll_export_intent()
        .id()
        .find(&intent_id)
        .ok_or("Export intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    let status = params.status.trim();
    if !matches!(status, "pending" | "sent" | "failed" | "applied") {
        return Err("status must be pending, sent, failed, or applied".to_string());
    }
    if status == "applied"
        && params
            .payload_hash
            .as_ref()
            .is_none_or(|h| h.trim().is_empty())
        && params
            .external_ref
            .as_ref()
            .is_none_or(|r| r.trim().is_empty())
    {
        return Err("applied status requires payload_hash or external_ref artifact".to_string());
    }
    let applied_at = if status == "applied" {
        Some(ctx.timestamp)
    } else {
        intent.applied_at
    };
    ctx.db
        .hr_payroll_export_intent()
        .id()
        .update(HrPayrollExportIntent {
            status: status.to_string(),
            external_ref: params.external_ref.clone(),
            payload_hash: params.payload_hash.clone(),
            last_error: params.last_error.clone(),
            attempt_count: intent.attempt_count.saturating_add(1),
            applied_at,
            metadata: params.metadata.or(intent.metadata.clone()),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..intent
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_payroll_export_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "status": status }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    if status == "applied" {
        let payslip = ctx
            .db
            .hr_payslip()
            .id()
            .find(&intent.payslip_id)
            .ok_or("Linked payslip not found")?;
        if payslip.company_id != company_id {
            return Err("Linked payslip does not belong to this company".to_string());
        }
        finalize_payslip_done(ctx, organization_id, company_id, payslip)?;
    }
    Ok(())
}

fn finalize_payslip_done(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payslip: HrPayslip,
) -> Result<(), String> {
    if payslip.state == PayslipState::Done {
        return Ok(());
    }
    if !payslip_has_close_artifact(ctx, &payslip) {
        return Err(
            "Payslip cannot reach Done without account_move_id or applied export intent"
                .to_string(),
        );
    }
    let payslip_id = payslip.id;
    let number = payslip
        .number
        .clone()
        .or_else(|| Some(next_doc_number(ctx, organization_id, "PAYSLIP")));
    ctx.db.hr_payslip().id().update(HrPayslip {
        state: PayslipState::Done,
        number,
        ..payslip
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_payslip",
            record_id: payslip_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "Done" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Payroll Structure ───────────────────────────────────────────────

#[reducer]
pub fn create_payroll_structure(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePayrollStructureParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "create")?;
    if params.name.is_empty() {
        return Err("Payroll structure name cannot be empty".to_string());
    }
    let structure = ctx.db.hr_payroll_structure().insert(HrPayrollStructure {
        id: 0,
        organization_id,
        name: params.name,
        type_: params.type_,
        is_active: params.is_active,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "hr_payroll_structure",
            record_id: structure.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Salary Rules ────────────────────────────────────────────────────

#[reducer]
pub fn create_salary_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateSalaryRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "create")?;
    if params.name.is_empty() || params.code.is_empty() {
        return Err("Salary rule name and code cannot be empty".to_string());
    }
    let structure = ctx
        .db
        .hr_payroll_structure()
        .id()
        .find(&params.structure_id)
        .ok_or("Payroll structure not found")?;
    if structure.organization_id != organization_id {
        return Err("Payroll structure belongs to a different organization".to_string());
    }
    let rule = ctx.db.hr_salary_rule().insert(HrSalaryRule {
        id: 0,
        organization_id,
        name: params.name,
        code: params.code,
        structure_id: params.structure_id,
        category: params.category,
        condition_type: params.condition_type,
        amount_type: params.amount_type,
        amount_fix: params.amount_fix,
        amount_percentage: params.amount_percentage,
        sequence: params.sequence,
        is_active: params.is_active,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "hr_salary_rule",
            record_id: rule.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Payslips ────────────────────────────────────────────────────────

#[reducer]
pub fn create_payslip(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePayslipParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "create")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    // HR-001: validate contract_id FK when provided
    if let Some(cid) = params.contract_id {
        let contract = ctx
            .db
            .hr_contract()
            .id()
            .find(&cid)
            .ok_or_else(|| format!("Contract {} not found", cid))?;
        if contract.organization_id != organization_id {
            return Err("Contract does not belong to this organization".to_string());
        }
        if contract.company_id != company_id {
            return Err("Contract does not belong to this company".to_string());
        }
    }

    // HR-002: validate payroll structure FK
    let payroll_struct = ctx
        .db
        .hr_payroll_structure()
        .id()
        .find(&params.struct_id)
        .ok_or_else(|| format!("Payroll structure {} not found", params.struct_id))?;
    if payroll_struct.organization_id != organization_id {
        return Err("Payroll structure does not belong to this organization".to_string());
    }

    let payslip = ctx.db.hr_payslip().insert(HrPayslip {
        id: 0,
        organization_id,
        company_id,
        name: format!("Payslip #{}", params.employee_id),
        number: None,
        employee_id: params.employee_id,
        contract_id: params.contract_id,
        struct_id: params.struct_id,
        date_from: params.date_from,
        date_to: params.date_to,
        basic_wage: params.basic_wage,
        gross_wage: params.basic_wage,
        net_wage: params.basic_wage,
        state: PayslipState::Draft,
        calculation_source: None,
        calculation_metadata: None,
        account_move_id: None,
        export_intent_id: None,
        notes: params.notes,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_payslip",
            record_id: payslip.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

/// Approve payslip for export — stores proposed gross/net and moves to `Verify` (ApprovedForExport).
/// Does **not** mark paid/closed; use `post_payslip` or `record_payroll_export_result(applied)`.
#[reducer]
pub fn confirm_payslip(
    ctx: &ReducerContext,
    organization_id: u64,
    payslip_id: u64,
    params: ConfirmPayslipParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "confirm")?;
    let payslip = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or("Payslip not found")?;
    if payslip.organization_id != organization_id {
        return Err("Payslip belongs to a different organization".to_string());
    }
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if payslip.company_id != company_id {
        return Err("Payslip does not belong to this company".to_string());
    }
    if payslip.state != PayslipState::Draft {
        return Err("Only draft payslips can be approved for export".to_string());
    }
    let source = params.calculation_source.trim();
    if source != "manual" && source != "external" {
        return Err("calculation_source must be manual or external".to_string());
    }
    let calculation_metadata = serde_json::json!({
        "proposed_gross_wage": params.gross_wage,
        "proposed_net_wage": params.net_wage,
        "calculation_source": source,
        "note": "Client-provided figures — not salary-rule engine output",
    })
    .to_string();
    ctx.db.hr_payslip().id().update(HrPayslip {
        gross_wage: params.gross_wage,
        net_wage: params.net_wage,
        state: PayslipState::Verify,
        calculation_source: Some(source.to_string()),
        calculation_metadata: Some(calculation_metadata),
        ..payslip
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_payslip",
            record_id: payslip_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "state": "Verify",
                    "calculation_source": source,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "gross_wage".to_string(),
                "net_wage".to_string(),
                "state".to_string(),
                "calculation_source".to_string(),
                "calculation_metadata".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_payroll_export_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payslip_id: u64,
    params: CreatePayrollExportIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "confirm")?;
    if params.idempotency_key.trim().is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    if params.payload.trim().is_empty() {
        return Err("payload is required".to_string());
    }
    let payslip = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or("Payslip not found")?;
    if payslip.organization_id != organization_id {
        return Err("Payslip belongs to a different organization".to_string());
    }
    if payslip.company_id != company_id {
        return Err("Payslip does not belong to this company".to_string());
    }
    if payslip.state != PayslipState::Verify {
        return Err(
            "Only Verify (approved-for-export) payslips can create export intents".to_string(),
        );
    }
    let existing = ctx
        .db
        .hr_payroll_export_intent()
        .payroll_export_intent_by_key()
        .filter(&params.idempotency_key)
        .find(|i| i.organization_id == organization_id);
    if let Some(intent) = existing {
        if payslip.export_intent_id != Some(intent.id) {
            let repaired_payslip = ctx.db.hr_payslip().id().update(HrPayslip {
                export_intent_id: Some(intent.id),
                ..payslip
            });
            record_organization_commit(
                ctx,
                OrganizationCommitInput {
                    organization_id,
                    operation_id: "erp.create_payroll_export_intent".to_string(),
                    correlation_id: format!("payslip:{payslip_id}:export-intent:{}", intent.id),
                    changes: vec![
                        RowChange::upsert_stdb_row(
                            "hr_payslip",
                            serde_json::json!({"id": repaired_payslip.id}),
                            &repaired_payslip,
                        )?,
                        RowChange::upsert_stdb_row(
                            "hr_payroll_export_intent",
                            serde_json::json!({"id": intent.id}),
                            &intent,
                        )?,
                    ],
                },
            )?;
        }
        return Ok(());
    }
    let pack_key = resolve_pack_key(ctx, organization_id, company_id, params.pack_key)?;
    let row = ctx
        .db
        .hr_payroll_export_intent()
        .insert(HrPayrollExportIntent {
            id: 0,
            organization_id,
            company_id,
            payslip_id,
            pack_key,
            status: "pending".to_string(),
            idempotency_key: params.idempotency_key,
            payload: params.payload,
            payload_hash: None,
            external_ref: None,
            last_error: None,
            attempt_count: 0,
            applied_at: None,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata,
        });
    ctx.db.hr_payslip().id().update(HrPayslip {
        export_intent_id: Some(row.id),
        ..payslip
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_payroll_export_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "payslip_id": payslip_id,
                    "pack_key": row.pack_key,
                    "status": "pending",
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    let payslip = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or("Payslip not found after export intent")?;
    let intent = ctx
        .db
        .hr_payroll_export_intent()
        .id()
        .find(&row.id)
        .ok_or("Payroll export intent not found after creation")?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.create_payroll_export_intent".to_string(),
            correlation_id: format!("payslip:{payslip_id}:export-intent:{}", intent.id),
            changes: vec![
                RowChange::upsert_stdb_row(
                    "hr_payslip",
                    serde_json::json!({"id": payslip.id}),
                    &payslip,
                )?,
                RowChange::upsert_stdb_row(
                    "hr_payroll_export_intent",
                    serde_json::json!({"id": intent.id}),
                    &intent,
                )?,
            ],
        },
    )?;
    Ok(())
}

#[reducer]
pub fn record_payroll_export_result(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
    params: RecordPayrollExportResultParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "confirm")?;
    apply_payroll_export_result_internal(ctx, organization_id, company_id, intent_id, params)
}

/// Post payroll GL entry (Dr expense / Cr payable [+ tax]) and mark payslip Done.
#[reducer]
pub fn post_payslip(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payslip_id: u64,
    params: PostPayslipParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "confirm")?;
    let payslip = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or("Payslip not found")?;
    if payslip.organization_id != organization_id {
        return Err("Payslip belongs to a different organization".to_string());
    }
    if payslip.company_id != company_id {
        return Err("Payslip does not belong to this company".to_string());
    }
    if payslip.state == PayslipState::Cancelled {
        return Err("Cancelled payslips cannot be posted".to_string());
    }
    if payslip.account_move_id.is_some() {
        if payslip.state != PayslipState::Done {
            finalize_payslip_done(ctx, organization_id, company_id, payslip)?;
        }
        return Ok(());
    }
    if payslip.state != PayslipState::Verify {
        return Err("Only Verify (approved-for-export) payslips can be posted".to_string());
    }
    if payslip.gross_wage <= 0.0 {
        return Err("Gross wage must be positive to post".to_string());
    }
    if payslip.net_wage <= 0.0 {
        return Err("Net wage must be positive to post".to_string());
    }
    if payslip.net_wage > payslip.gross_wage {
        return Err("Net wage cannot exceed gross wage".to_string());
    }
    let withholding = payslip.gross_wage - payslip.net_wage;
    if withholding.abs() > 0.01 && params.tax_withholding_account_id.is_none() {
        return Err("tax_withholding_account_id required when gross differs from net".to_string());
    }

    ensure_accounting_period_open_for_date(ctx, company_id, params.accounting_date)?;
    validate_company_account(ctx, company_id, params.expense_account_id, "Expense")?;
    validate_company_account(ctx, company_id, params.payable_account_id, "Payable")?;
    if let Some(tax_id) = params.tax_withholding_account_id {
        validate_company_account(ctx, company_id, tax_id, "Tax withholding")?;
    }
    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&params.journal_id)
        .ok_or("Journal not found")?;
    if journal.company_id != company_id {
        return Err("Journal does not belong to this company".to_string());
    }
    let company_row = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;
    let company_currency_id = company_row.currency_id;
    let gross = payslip.gross_wage;
    let net = payslip.net_wage;
    let origin = format!("PAYSLIP-{}", payslip.id);
    let move_name = next_doc_number(ctx, organization_id, "PAY");

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: move_name.clone(),
        ref_: Some(payslip.name.clone()),
        move_type: MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: params.accounting_date,
        invoice_date: Some(params.accounting_date),
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(origin.clone()),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: Some(origin.clone()),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: None,
        commercial_partner_id: None,
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: params.journal_id,
        currency_id: company_currency_id,
        company_currency_id,
        amount_untaxed: gross,
        amount_tax: withholding.max(0.0),
        amount_total: gross,
        amount_residual: gross,
        amount_untaxed_signed: gross,
        amount_tax_signed: withholding.max(0.0),
        amount_total_signed: gross,
        amount_total_in_currency_signed: gross,
        amount_residual_signed: gross,
        to_check: false,
        posted_before: false,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: false,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some(
            serde_json::json!({
                "hr_payslip_id": payslip.id,
                "employee_id": payslip.employee_id,
            })
            .to_string(),
        ),
    });

    insert_draft_account_move_line(
        ctx,
        &move_record,
        journal_line_params(
            params.expense_account_id,
            format!("Payroll expense — {}", payslip.name),
            gross,
            0.0,
            1,
        ),
    )?;
    insert_draft_account_move_line(
        ctx,
        &move_record,
        journal_line_params(
            params.payable_account_id,
            format!("Salaries payable — {}", payslip.name),
            0.0,
            net,
            2,
        ),
    )?;
    if withholding.abs() > 0.01 {
        let tax_id = params
            .tax_withholding_account_id
            .expect("tax_withholding_account_id checked above");
        insert_draft_account_move_line(
            ctx,
            &move_record,
            journal_line_params(
                tax_id,
                format!("Payroll withholding — {}", payslip.name),
                0.0,
                withholding,
                3,
            ),
        )?;
    }

    let total_debit: f64 = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.move_id == move_record.id)
        .map(|l| l.debit)
        .sum();
    let total_credit: f64 = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.move_id == move_record.id)
        .map(|l| l.credit)
        .sum();
    if (total_debit - total_credit).abs() > 0.01 {
        return Err(format!(
            "Payroll move is not balanced: debit={total_debit} credit={total_credit}"
        ));
    }

    for ml in ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.move_id == move_record.id)
    {
        ctx.db.account_move_line().id().update(
            crate::accounting::journal_entries::AccountMoveLine {
                parent_state: AccountMoveState::Posted,
                ..ml
            },
        );
    }
    ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Posted,
        posted_before: true,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record
    });

    let updated = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or("Payslip not found")?;
    ctx.db.hr_payslip().id().update(HrPayslip {
        account_move_id: Some(move_record.id),
        ..updated
    });
    let payslip_after = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or("Payslip not found")?;
    finalize_payslip_done(ctx, organization_id, company_id, payslip_after)?;
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_payslip",
            record_id: payslip_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "account_move_id": move_record.id,
                    "state": "Done",
                })
                .to_string(),
            ),
            changed_fields: vec!["account_move_id".to_string(), "state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn cancel_payslip(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payslip_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "cancel")?;
    let payslip = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or("Payslip not found")?;
    if payslip.organization_id != organization_id {
        return Err("Payslip belongs to a different organization".to_string());
    }
    if payslip.company_id != company_id {
        return Err("Payslip does not belong to this company".to_string());
    }
    if payslip.state == PayslipState::Cancelled {
        return Err("Payslip is already cancelled".to_string());
    }
    if payslip.state == PayslipState::Done {
        return Err("Done payslips cannot be cancelled — reverse GL or export first".to_string());
    }
    ctx.db.hr_payslip().id().update(HrPayslip {
        state: PayslipState::Cancelled,
        ..payslip
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_payslip",
            record_id: payslip_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
