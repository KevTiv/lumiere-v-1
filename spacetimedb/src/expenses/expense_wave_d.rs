//! Wave D — integration intents, advances, policy exceptions, fraud helpers.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_employee;
use crate::types::{
    ExpenseAdvanceState, ExpenseLineKind, ExpensePaymentMode, ExpensePolicyExceptionState,
    ExpenseState,
};
use serde_json::Value;

use super::expenses::{
    create_expense, expense_sheet, hr_expense, CreateExpenseParams, HrExpense,
};

// ── Tables ───────────────────────────────────────────────────────────────────

/// Durable worker intents: card feed / OCR / FX / delayed-sync (no HTTP in reducers).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = expense_integration_intent,
    public,
    index(accessor = expense_intent_by_org, btree(columns = [organization_id])),
    index(accessor = expense_intent_by_company, btree(columns = [company_id])),
    index(accessor = expense_intent_by_status, btree(columns = [status])),
    index(accessor = expense_intent_by_key, btree(columns = [idempotency_key]))
)]
pub struct ExpenseIntegrationIntent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// card_feed | ocr_receipt | fx_rate | delayed_sync
    pub intent_type: String,
    pub status: String,
    pub idempotency_key: String,
    pub device_id: Option<String>,
    pub payload: String,
    pub result_expense_id: Option<u64>,
    pub result_sheet_id: Option<u64>,
    pub last_error: Option<String>,
    pub attempt_count: u32,
    pub applied_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = hr_expense_advance,
    public,
    index(accessor = expense_advance_by_org, btree(columns = [organization_id])),
    index(accessor = expense_advance_by_employee, btree(columns = [employee_id])),
    index(accessor = expense_advance_by_company, btree(columns = [company_id]))
)]
pub struct HrExpenseAdvance {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    pub name: String,
    pub amount: f64,
    pub residual: f64,
    pub currency_id: u64,
    pub state: ExpenseAdvanceState,
    pub client_request_id: Option<String>,
    pub metadata: Option<String>,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = hr_expense_advance_application,
    public,
    index(accessor = advance_app_by_sheet, btree(columns = [sheet_id])),
    index(accessor = advance_app_by_advance, btree(columns = [advance_id]))
)]
pub struct HrExpenseAdvanceApplication {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub advance_id: u64,
    pub sheet_id: u64,
    pub amount: f64,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = hr_expense_policy_exception,
    public,
    index(accessor = policy_exception_by_expense, btree(columns = [expense_id])),
    index(accessor = policy_exception_by_org, btree(columns = [organization_id]))
)]
pub struct HrExpensePolicyException {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub expense_id: u64,
    pub reason: String,
    pub state: ExpensePolicyExceptionState,
    pub requested_by: Identity,
    pub approved_by: Option<Identity>,
    pub created_at: Timestamp,
    pub resolved_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateExpenseIntegrationIntentParams {
    pub company_id: Option<u64>,
    pub intent_type: String,
    pub idempotency_key: String,
    pub device_id: Option<String>,
    pub payload: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct FailExpenseIntegrationIntentParams {
    pub last_error: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateExpenseAdvanceParams {
    pub company_id: Option<u64>,
    pub employee_id: u64,
    pub name: String,
    pub amount: f64,
    pub currency_id: u64,
    pub client_request_id: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ApplyExpenseAdvanceParams {
    pub amount: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RequestExpensePolicyExceptionParams {
    pub reason: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetExpenseFraudHoldParams {
    pub fraud_hold: bool,
    pub fraud_reason: Option<String>,
    pub metadata: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub(crate) fn advance_applied_for_sheet(ctx: &ReducerContext, sheet_id: u64) -> f64 {
    ctx.db
        .hr_expense_advance_application()
        .advance_app_by_sheet()
        .filter(&sheet_id)
        .map(|a| a.amount)
        .sum()
}

pub(crate) fn has_approved_policy_exception(
    ctx: &ReducerContext,
    expense_id: u64,
) -> bool {
    ctx.db
        .hr_expense_policy_exception()
        .policy_exception_by_expense()
        .filter(&expense_id)
        .any(|e| e.state == ExpensePolicyExceptionState::Approved)
}

pub(crate) fn has_pending_policy_exception(
    ctx: &ReducerContext,
    expense_id: u64,
) -> bool {
    ctx.db
        .hr_expense_policy_exception()
        .policy_exception_by_expense()
        .filter(&expense_id)
        .any(|e| e.state == ExpensePolicyExceptionState::Pending)
}

/// Same employee + amount + calendar day (+ optional merchant) → possible duplicate.
pub(crate) fn find_duplicate_expense(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    total_amount: f64,
    date: Timestamp,
    merchant_key: Option<&str>,
    exclude_id: Option<u64>,
) -> Option<u64> {
    let day = date.to_duration_since_unix_epoch().unwrap_or_default().as_secs() / 86_400;
    ctx.db.hr_expense().iter().find_map(|e| {
        if e.organization_id != organization_id || e.company_id != company_id {
            return None;
        }
        if e.employee_id != employee_id {
            return None;
        }
        if exclude_id == Some(e.id) {
            return None;
        }
        if (e.total_amount - total_amount).abs() > 0.01 {
            return None;
        }
        let other_day = e
            .date
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_secs()
            / 86_400;
        if other_day != day {
            return None;
        }
        if let Some(mk) = merchant_key {
            let other = e.merchant_key.as_deref().unwrap_or("");
            if !other.is_empty() && other != mk {
                return None;
            }
        }
        Some(e.id)
    })
}

fn payload_u64(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(|x| x.as_u64())
}

fn payload_f64(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}

fn payload_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn apply_create_expense_payload(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_type: &str,
    payload: &str,
    idempotency_key: &str,
) -> Result<u64, String> {
    let v: Value = serde_json::from_str(payload)
        .map_err(|e| format!("Invalid intent payload JSON: {e}"))?;
    let employee_id = payload_u64(&v, "employee_id").ok_or("payload requires employee_id")?;
    let currency_id = payload_u64(&v, "currency_id").ok_or("payload requires currency_id")?;
    let name = payload_str(&v, "name").unwrap_or_else(|| format!("{intent_type} expense"));
    let unit_amount = payload_f64(&v, "unit_amount").unwrap_or(0.0);
    let quantity = payload_f64(&v, "quantity").unwrap_or(1.0);
    let payment_mode = match payload_str(&v, "payment_mode")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "corporate_card" | "corporatecard" | "card" => ExpensePaymentMode::CorporateCard,
        _ if intent_type == "card_feed" => ExpensePaymentMode::CorporateCard,
        _ => ExpensePaymentMode::OutOfPocket,
    };
    let attachment_ids = v
        .get("attachment_ids")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_u64())
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            if intent_type == "ocr_receipt" {
                vec![1]
            } else {
                vec![]
            }
        });
    let client_request_id = payload_str(&v, "client_request_id")
        .or_else(|| Some(idempotency_key.to_string()));
    let client_request_id_lookup = client_request_id.clone();

    create_expense(
        ctx,
        organization_id,
        CreateExpenseParams {
            company_id: Some(company_id),
            employee_id,
            name,
            date: ctx.timestamp,
            unit_amount,
            quantity,
            currency_id,
            product_id: payload_u64(&v, "product_id"),
            description: payload_str(&v, "description"),
            tax_ids: vec![],
            account_id: payload_u64(&v, "account_id"),
            analytic_account_id: payload_u64(&v, "analytic_account_id"),
            project_id: payload_u64(&v, "project_id"),
            line_kind: ExpenseLineKind::Standard,
            mileage_distance: None,
            mileage_rate_id: None,
            per_diem_days: None,
            per_diem_rate_id: None,
            attachment_ids,
            client_request_id,
            payment_mode,
            merchant_key: payload_str(&v, "merchant_key"),
            policy_exception_reason: None,
        },
    )?;

    let expense_id = ctx
        .db
        .hr_expense()
        .iter()
        .filter(|e| {
            e.organization_id == organization_id
                && e.client_request_id.as_deref() == client_request_id_lookup.as_deref()
        })
        .map(|e| e.id)
        .max()
        .ok_or("Applied intent but expense not found")?;
    Ok(expense_id)
}

fn apply_fx_rate_payload(
    ctx: &ReducerContext,
    organization_id: u64,
    payload: &str,
) -> Result<Option<u64>, String> {
    let v: Value = serde_json::from_str(payload)
        .map_err(|e| format!("Invalid fx_rate payload JSON: {e}"))?;
    let sheet_id = payload_u64(&v, "sheet_id").ok_or("fx_rate payload requires sheet_id")?;
    let rate = payload_f64(&v, "rate").ok_or("fx_rate payload requires rate")?;
    if rate <= 0.0 {
        return Err("fx_rate must be positive".to_string());
    }
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    if sheet.organization_id != organization_id {
        return Err("Expense sheet belongs to a different organization".to_string());
    }
    let metadata = {
        let mut map = match sheet
            .metadata
            .as_deref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
        {
            Some(Value::Object(m)) => m,
            _ => serde_json::Map::new(),
        };
        map.insert(
            "fx_worker".into(),
            serde_json::json!({
                "rate": rate,
                "source": payload_str(&v, "source").unwrap_or_else(|| "worker".into()),
            }),
        );
        Some(Value::Object(map).to_string())
    };
    ctx.db.expense_sheet().id().update(crate::expenses::expenses::HrExpenseSheet {
        currency_rate: rate,
        metadata,
        ..sheet
    });
    Ok(Some(sheet_id))
}

// ── Reducers: Integration intents ─────────────────────────────────────────────

#[reducer]
pub fn create_expense_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateExpenseIntegrationIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "create")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if params.idempotency_key.trim().is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    let intent_type = params.intent_type.trim().to_ascii_lowercase();
    if !matches!(
        intent_type.as_str(),
        "card_feed" | "ocr_receipt" | "fx_rate" | "delayed_sync"
    ) {
        return Err(
            "intent_type must be card_feed|ocr_receipt|fx_rate|delayed_sync".to_string(),
        );
    }
    if params.payload.trim().is_empty() {
        return Err("payload is required".to_string());
    }
    let existing = ctx
        .db
        .expense_integration_intent()
        .expense_intent_by_key()
        .filter(&params.idempotency_key)
        .find(|i| i.organization_id == organization_id);
    if existing.is_some() {
        return Ok(());
    }
    let row = ctx.db.expense_integration_intent().insert(ExpenseIntegrationIntent {
        id: 0,
        organization_id,
        company_id,
        intent_type,
        status: "pending".into(),
        idempotency_key: params.idempotency_key,
        device_id: params.device_id,
        payload: params.payload,
        result_expense_id: None,
        result_sheet_id: None,
        last_error: None,
        attempt_count: 0,
        applied_at: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "expense_integration_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn apply_expense_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    intent_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "create")?;
    let intent = ctx
        .db
        .expense_integration_intent()
        .id()
        .find(&intent_id)
        .ok_or("Integration intent not found")?;
    if intent.organization_id != organization_id {
        return Err("Intent belongs to a different organization".to_string());
    }
    if intent.status == "applied" {
        return Ok(());
    }
    let attempt = intent.attempt_count.saturating_add(1);
    let apply_result = match intent.intent_type.as_str() {
        "fx_rate" => apply_fx_rate_payload(ctx, organization_id, &intent.payload)
            .map(|sheet_id| (None, sheet_id)),
        "card_feed" | "ocr_receipt" | "delayed_sync" => {
            apply_create_expense_payload(
                ctx,
                organization_id,
                intent.company_id,
                &intent.intent_type,
                &intent.payload,
                &intent.idempotency_key,
            )
            .map(|expense_id| (Some(expense_id), None))
        }
        other => Err(format!("Unsupported intent_type '{other}'")),
    };

    match apply_result {
        Ok((expense_id, sheet_id)) => {
            ctx.db
                .expense_integration_intent()
                .id()
                .update(ExpenseIntegrationIntent {
                    status: "applied".into(),
                    result_expense_id: expense_id.or(intent.result_expense_id),
                    result_sheet_id: sheet_id.or(intent.result_sheet_id),
                    last_error: None,
                    attempt_count: attempt,
                    applied_at: Some(ctx.timestamp),
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..intent
                });
            write_audit_log_v2(
                ctx,
                organization_id,
                AuditLogParams {
                    company_id: Some(intent.company_id),
                    table_name: "expense_integration_intent",
                    record_id: intent_id,
                    action: "UPDATE",
                    old_values: None,
                    new_values: Some(r#"{"status":"applied"}"#.into()),
                    changed_fields: vec!["status".into()],
                    metadata: None,
                },
            );
            Ok(())
        }
        Err(e) => {
            ctx.db
                .expense_integration_intent()
                .id()
                .update(ExpenseIntegrationIntent {
                    status: "failed".into(),
                    last_error: Some(e.clone()),
                    attempt_count: attempt,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..intent
                });
            Err(e)
        }
    }
}

#[reducer]
pub fn fail_expense_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    intent_id: u64,
    params: FailExpenseIntegrationIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "update")?;
    let intent = ctx
        .db
        .expense_integration_intent()
        .id()
        .find(&intent_id)
        .ok_or("Integration intent not found")?;
    if intent.organization_id != organization_id {
        return Err("Intent belongs to a different organization".to_string());
    }
    if intent.status == "applied" {
        return Err("Cannot fail an applied intent".to_string());
    }
    ctx.db
        .expense_integration_intent()
        .id()
        .update(ExpenseIntegrationIntent {
            status: "failed".into(),
            last_error: Some(params.last_error),
            attempt_count: intent.attempt_count.saturating_add(1),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata.or(intent.metadata.clone()),
            ..intent
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(intent.company_id),
            table_name: "expense_integration_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(r#"{"status":"failed"}"#.into()),
            changed_fields: vec!["status".into(), "last_error".into()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Advances ────────────────────────────────────────────────────────

#[reducer]
pub fn create_expense_advance(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateExpenseAdvanceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "create")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if params.name.trim().is_empty() {
        return Err("Advance name cannot be empty".to_string());
    }
    if params.amount <= 0.0 {
        return Err("Advance amount must be positive".to_string());
    }
    if let Some(ref req) = params.client_request_id {
        if !req.is_empty()
            && ctx.db.hr_expense_advance().iter().any(|a| {
                a.organization_id == organization_id
                    && a.client_request_id.as_deref() == Some(req.as_str())
            })
        {
            return Ok(());
        }
    }
    let emp = ctx
        .db
        .hr_employee()
        .id()
        .find(&params.employee_id)
        .ok_or("Employee not found")?;
    if emp.organization_id != organization_id || emp.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }
    let row = ctx.db.hr_expense_advance().insert(HrExpenseAdvance {
        id: 0,
        organization_id,
        company_id,
        employee_id: params.employee_id,
        name: params.name,
        amount: params.amount,
        residual: params.amount,
        currency_id: params.currency_id,
        state: ExpenseAdvanceState::Open,
        client_request_id: params.client_request_id,
        metadata: params.metadata,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_advance",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn apply_expense_advance_to_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    advance_id: u64,
    sheet_id: u64,
    params: ApplyExpenseAdvanceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "update")?;
    if params.amount <= 0.0 {
        return Err("Apply amount must be positive".to_string());
    }
    let advance = ctx
        .db
        .hr_expense_advance()
        .id()
        .find(&advance_id)
        .ok_or("Advance not found")?;
    if advance.organization_id != organization_id {
        return Err("Advance belongs to a different organization".to_string());
    }
    if matches!(advance.state, ExpenseAdvanceState::Closed) {
        return Err("Advance is closed".to_string());
    }
    if params.amount > advance.residual + 0.0001 {
        return Err(format!(
            "Apply amount {:.2} exceeds advance residual {:.2}",
            params.amount, advance.residual
        ));
    }
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    if sheet.organization_id != organization_id {
        return Err("Expense sheet belongs to a different organization".to_string());
    }
    if sheet.company_id != advance.company_id || sheet.employee_id != advance.employee_id {
        return Err("Advance employee/company must match sheet".to_string());
    }
    if !matches!(
        sheet.state,
        crate::types::ExpenseSheetState::Draft
            | crate::types::ExpenseSheetState::Submitted
            | crate::types::ExpenseSheetState::Approved
    ) {
        return Err("Advances can only be applied before post".to_string());
    }
    if sheet.currency_id != advance.currency_id {
        return Err("Advance currency must match sheet currency".to_string());
    }

    ctx.db
        .hr_expense_advance_application()
        .insert(HrExpenseAdvanceApplication {
            id: 0,
            organization_id,
            company_id: advance.company_id,
            advance_id,
            sheet_id,
            amount: params.amount,
            created_at: ctx.timestamp,
        });
    let residual = (advance.residual - params.amount).max(0.0);
    let state = if residual <= 0.0001 {
        ExpenseAdvanceState::Closed
    } else {
        ExpenseAdvanceState::PartiallyApplied
    };
    ctx.db.hr_expense_advance().id().update(HrExpenseAdvance {
        residual,
        state,
        ..advance
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(sheet.company_id),
            table_name: "hr_expense_advance_application",
            record_id: sheet_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "advance_id": advance_id, "amount": params.amount }).to_string(),
            ),
            changed_fields: vec!["amount".into()],
            metadata: params.metadata,
        },
    );
    Ok(())
}

// ── Reducers: Policy exceptions + fraud ───────────────────────────────────────

#[reducer]
pub fn request_expense_policy_exception(
    ctx: &ReducerContext,
    organization_id: u64,
    expense_id: u64,
    params: RequestExpensePolicyExceptionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "update")?;
    if params.reason.trim().is_empty() {
        return Err("Exception reason is required".to_string());
    }
    let expense = ctx
        .db
        .hr_expense()
        .id()
        .find(&expense_id)
        .ok_or("Expense not found")?;
    if expense.organization_id != organization_id {
        return Err("Expense belongs to a different organization".to_string());
    }
    if expense.state != ExpenseState::Draft {
        return Err("Only draft expenses can request policy exceptions".to_string());
    }
    if has_pending_policy_exception(ctx, expense_id) || has_approved_policy_exception(ctx, expense_id)
    {
        return Ok(());
    }
    let row = ctx
        .db
        .hr_expense_policy_exception()
        .insert(HrExpensePolicyException {
            id: 0,
            organization_id,
            company_id: expense.company_id,
            expense_id,
            reason: params.reason,
            state: ExpensePolicyExceptionState::Pending,
            requested_by: ctx.sender(),
            approved_by: None,
            created_at: ctx.timestamp,
            resolved_at: None,
            metadata: params.metadata,
        });
    ctx.db.hr_expense().id().update(HrExpense {
        policy_hold: true,
        ..expense
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(row.company_id),
            table_name: "hr_expense_policy_exception",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn approve_expense_policy_exception(
    ctx: &ReducerContext,
    organization_id: u64,
    exception_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "approve")?;
    let exception = ctx
        .db
        .hr_expense_policy_exception()
        .id()
        .find(&exception_id)
        .ok_or("Policy exception not found")?;
    if exception.organization_id != organization_id {
        return Err("Exception belongs to a different organization".to_string());
    }
    if exception.state != ExpensePolicyExceptionState::Pending {
        return Err("Only pending exceptions can be approved".to_string());
    }
    if exception.requested_by == ctx.sender() {
        return Err("Requester cannot approve their own policy exception".to_string());
    }
    ctx.db
        .hr_expense_policy_exception()
        .id()
        .update(HrExpensePolicyException {
            state: ExpensePolicyExceptionState::Approved,
            approved_by: Some(ctx.sender()),
            resolved_at: Some(ctx.timestamp),
            ..exception
        });
    if let Some(expense) = ctx.db.hr_expense().id().find(&exception.expense_id) {
        ctx.db.hr_expense().id().update(HrExpense {
            policy_hold: false,
            ..expense
        });
    }
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(exception.company_id),
            table_name: "hr_expense_policy_exception",
            record_id: exception_id,
            action: "UPDATE",
            old_values: Some(r#"{"state":"Pending"}"#.into()),
            new_values: Some(r#"{"state":"Approved"}"#.into()),
            changed_fields: vec!["state".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn set_expense_fraud_hold(
    ctx: &ReducerContext,
    organization_id: u64,
    expense_id: u64,
    params: SetExpenseFraudHoldParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "approve")?;
    let expense = ctx
        .db
        .hr_expense()
        .id()
        .find(&expense_id)
        .ok_or("Expense not found")?;
    if expense.organization_id != organization_id {
        return Err("Expense belongs to a different organization".to_string());
    }
    if expense.state != ExpenseState::Draft && expense.state != ExpenseState::Submitted {
        return Err("Fraud hold can only change on draft/submitted expenses".to_string());
    }
    let fraud_reason = if params.fraud_hold {
        params
            .fraud_reason
            .clone()
            .or(expense.fraud_reason.clone())
    } else {
        None
    };
    let company_id = expense.company_id;
    ctx.db.hr_expense().id().update(HrExpense {
        fraud_hold: params.fraud_hold,
        fraud_reason: fraud_reason.clone(),
        ..expense
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense",
            record_id: expense_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "fraud_hold": params.fraud_hold,
                    "fraud_reason": fraud_reason,
                })
                .to_string(),
            ),
            changed_fields: vec!["fraud_hold".into(), "fraud_reason".into()],
            metadata: params.metadata,
        },
    );
    Ok(())
}
