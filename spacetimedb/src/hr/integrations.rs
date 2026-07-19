//! HR integration intents — statutory file exchange (STP/eSocial/CPF/SARS/bank) and partner payroll.
//!
//! No HTTP in reducers; api-server workers poll `apply_pending_hr_integration_intents`.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::{company_id_from_scope};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use super::payroll::{
    apply_partner_payslip_artifact, apply_payroll_export_result_internal,
    hr_payroll_export_intent, hr_payslip, RecordPayrollExportResultParams,
};

// ── Tables ────────────────────────────────────────────────────────────────────

/// Durable HR payroll integration intent for workers (no HTTP in reducers).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = hr_integration_intent,
    public,
    index(accessor = hr_intent_by_org, btree(columns = [organization_id])),
    index(accessor = hr_intent_by_company, btree(columns = [company_id])),
    index(accessor = hr_intent_by_status, btree(columns = [status])),
    index(accessor = hr_intent_by_key, btree(columns = [idempotency_key])),
    index(accessor = hr_intent_by_payslip, btree(columns = [payslip_id]))
)]
pub struct HrIntegrationIntent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// stp | esocial | cpf | sars | bank | partner_payroll
    pub intent_kind: String,
    /// pending | sent | failed | applied
    pub status: String,
    pub idempotency_key: String,
    pub payslip_id: Option<u64>,
    pub export_intent_id: Option<u64>,
    pub payload: String,
    pub result_ref: Option<String>,
    pub external_ref: Option<String>,
    pub payload_hash: Option<String>,
    pub last_error: Option<String>,
    pub attempt_count: u32,
    pub applied_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateHrIntegrationIntentParams {
    pub company_id: Option<u64>,
    pub intent_kind: String,
    pub idempotency_key: String,
    pub payslip_id: Option<u64>,
    pub export_intent_id: Option<u64>,
    pub payload: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordHrIntegrationResultParams {
    pub status: String,
    pub external_ref: Option<String>,
    pub payload_hash: Option<String>,
    pub result_ref: Option<String>,
    pub last_error: Option<String>,
    pub metadata: Option<String>,
    /// Partner engine artifact — optional gross/net override before export close.
    pub gross_wage: Option<f64>,
    pub net_wage: Option<f64>,
    pub calculation_metadata: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_KINDS: &[&str] = &["stp", "esocial", "cpf", "sars", "bank", "partner_payroll"];

fn normalize_kind(raw: &str) -> Result<String, String> {
    let kind = raw.trim().to_ascii_lowercase();
    if VALID_KINDS.contains(&kind.as_str()) {
        Ok(kind)
    } else {
        Err(format!(
            "intent_kind must be one of: {}",
            VALID_KINDS.join("|")
        ))
    }
}

fn normalize_status(raw: &str) -> Result<&'static str, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "pending" => Ok("pending"),
        "sent" => Ok("sent"),
        "failed" => Ok("failed"),
        "applied" => Ok("applied"),
        _ => Err("status must be pending, sent, failed, or applied".to_string()),
    }
}

fn validate_payslip_link(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payslip_id: u64,
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
    Ok(())
}

fn validate_export_intent_link(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    export_intent_id: u64,
) -> Result<(), String> {
    let intent = ctx
        .db
        .hr_payroll_export_intent()
        .id()
        .find(&export_intent_id)
        .ok_or("Export intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Export intent does not belong to this company".to_string());
    }
    Ok(())
}

fn partner_result_from_payload(payload: &str) -> serde_json::Value {
    serde_json::from_str(payload).unwrap_or_else(|_| serde_json::json!({}))
}

fn partner_close_export(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    export_intent_id: u64,
    external_ref: Option<String>,
    payload_hash: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    apply_payroll_export_result_internal(
        ctx,
        organization_id,
        company_id,
        export_intent_id,
        RecordPayrollExportResultParams {
            status: "applied".to_string(),
            external_ref,
            payload_hash,
            last_error: None,
            metadata,
        },
    )
}

fn apply_partner_engine_side_effects(
    ctx: &ReducerContext,
    intent: &HrIntegrationIntent,
    params: &RecordHrIntegrationResultParams,
) -> Result<(), String> {
    if intent.intent_kind != "partner_payroll" {
        return Ok(());
    }
    if let Some(payslip_id) = intent.payslip_id {
        if params.gross_wage.is_some() || params.net_wage.is_some() || params.calculation_metadata.is_some()
        {
            apply_partner_payslip_artifact(
                ctx,
                intent.organization_id,
                intent.company_id,
                payslip_id,
                params.gross_wage,
                params.net_wage,
                params.calculation_metadata.clone(),
            )?;
        }
    }
    if let Some(export_intent_id) = intent.export_intent_id {
        partner_close_export(
            ctx,
            intent.organization_id,
            intent.company_id,
            export_intent_id,
            params.external_ref.clone(),
            params.payload_hash.clone(),
            params.metadata.clone(),
        )?;
    }
    Ok(())
}

fn apply_intent_from_payload(
    ctx: &ReducerContext,
    intent: HrIntegrationIntent,
) -> Result<(Option<String>, Option<String>, Option<String>), String> {
    let payload = partner_result_from_payload(&intent.payload);
    match intent.intent_kind.as_str() {
        "partner_payroll" => {
            let export_intent_id = intent
                .export_intent_id
                .or_else(|| payload.get("export_intent_id").and_then(|v| v.as_u64()));
            let external_ref = payload
                .get("external_ref")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let payload_hash = payload
                .get("payload_hash")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let gross = payload.get("gross_wage").and_then(|v| v.as_f64());
            let net = payload.get("net_wage").and_then(|v| v.as_f64());
            let calc_meta = payload
                .get("calculation_metadata")
                .map(|v| v.to_string());
            if let Some(payslip_id) = intent.payslip_id {
                apply_partner_payslip_artifact(
                    ctx,
                    intent.organization_id,
                    intent.company_id,
                    payslip_id,
                    gross,
                    net,
                    calc_meta,
                )?;
            }
            if let Some(export_id) = export_intent_id {
                let ext = external_ref.clone().or_else(|| {
                    Some(format!(
                        "partner:{}:{}",
                        intent.id, intent.idempotency_key
                    ))
                });
                partner_close_export(
                    ctx,
                    intent.organization_id,
                    intent.company_id,
                    export_id,
                    ext,
                    payload_hash.clone(),
                    intent.metadata.clone(),
                )?;
            }
            Ok((external_ref, payload_hash, None))
        }
        "stp" | "esocial" | "cpf" | "sars" | "bank" => {
            let result_ref = payload
                .get("result_ref")
                .or_else(|| payload.get("file_ref"))
                .or_else(|| payload.get("submission_id"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .or_else(|| Some(format!("stub:{}:{}", intent.intent_kind, intent.id)));
            let external_ref = payload
                .get("external_ref")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            if let Some(export_id) = intent.export_intent_id {
                let export_status = payload
                    .get("export_status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("sent");
                apply_payroll_export_result_internal(
                    ctx,
                    intent.organization_id,
                    intent.company_id,
                    export_id,
                    RecordPayrollExportResultParams {
                        status: export_status.to_string(),
                        external_ref: external_ref.clone(),
                        payload_hash: payload
                            .get("payload_hash")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        last_error: None,
                        metadata: intent.metadata.clone(),
                    },
                )?;
            }
            Ok((external_ref, None, result_ref))
        }
        other => Err(format!("Unsupported intent_kind '{other}'")),
    }
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_hr_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateHrIntegrationIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "confirm")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    let intent_kind = normalize_kind(&params.intent_kind)?;
    if params.idempotency_key.trim().is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    if params.payload.trim().is_empty() {
        return Err("payload is required".to_string());
    }
    if let Some(existing) = ctx
        .db
        .hr_integration_intent()
        .hr_intent_by_key()
        .filter(&params.idempotency_key)
        .find(|i| i.organization_id == organization_id)
    {
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "hr_integration_intent",
                record_id: existing.id,
                action: "CREATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({ "idempotent": true, "status": existing.status }).to_string(),
                ),
                changed_fields: vec![],
                metadata: params.metadata,
            },
        );
        return Ok(());
    }
    if let Some(payslip_id) = params.payslip_id {
        validate_payslip_link(ctx, organization_id, company_id, payslip_id)?;
    }
    if let Some(export_intent_id) = params.export_intent_id {
        validate_export_intent_link(ctx, organization_id, company_id, export_intent_id)?;
    }
    let row = ctx.db.hr_integration_intent().insert(HrIntegrationIntent {
        id: 0,
        organization_id,
        company_id,
        intent_kind,
        status: "pending".to_string(),
        idempotency_key: params.idempotency_key,
        payslip_id: params.payslip_id,
        export_intent_id: params.export_intent_id,
        payload: params.payload,
        result_ref: None,
        external_ref: None,
        payload_hash: None,
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
            table_name: "hr_integration_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "intent_kind": row.intent_kind,
                    "status": row.status,
                    "payslip_id": row.payslip_id,
                    "export_intent_id": row.export_intent_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["intent_kind".to_string(), "status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn record_hr_integration_result(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
    params: RecordHrIntegrationResultParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "confirm")?;
    let status = normalize_status(&params.status)?;
    let intent = ctx
        .db
        .hr_integration_intent()
        .id()
        .find(&intent_id)
        .ok_or("Integration intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if status == "applied" {
        apply_partner_engine_side_effects(ctx, &intent, &params)?;
    }
    let applied_at = if status == "applied" {
        Some(ctx.timestamp)
    } else {
        intent.applied_at
    };
    ctx.db
        .hr_integration_intent()
        .id()
        .update(HrIntegrationIntent {
            status: status.to_string(),
            external_ref: params.external_ref.clone().or(intent.external_ref.clone()),
            payload_hash: params.payload_hash.clone().or(intent.payload_hash.clone()),
            result_ref: params.result_ref.clone().or(intent.result_ref.clone()),
            last_error: params.last_error.clone(),
            attempt_count: intent.attempt_count.saturating_add(1),
            applied_at,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata.clone().or(intent.metadata.clone()),
            ..intent
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_integration_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "status": status }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn apply_hr_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    intent_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "confirm")?;
    let intent = ctx
        .db
        .hr_integration_intent()
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
    match apply_intent_from_payload(ctx, intent.clone()) {
        Ok((external_ref, payload_hash, result_ref)) => {
            ctx.db
                .hr_integration_intent()
                .id()
                .update(HrIntegrationIntent {
                    status: "applied".to_string(),
                    external_ref: external_ref.or(intent.external_ref.clone()),
                    payload_hash: payload_hash.or(intent.payload_hash.clone()),
                    result_ref: result_ref.or(intent.result_ref.clone()),
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
                    table_name: "hr_integration_intent",
                    record_id: intent_id,
                    action: "UPDATE",
                    old_values: None,
                    new_values: Some(r#"{"status":"applied"}"#.into()),
                    changed_fields: vec!["status".to_string()],
                    metadata: None,
                },
            );
            Ok(())
        }
        Err(e) => {
            ctx.db
                .hr_integration_intent()
                .id()
                .update(HrIntegrationIntent {
                    status: "failed".to_string(),
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
pub fn apply_pending_hr_integration_intents(
    ctx: &ReducerContext,
    organization_id: u64,
    limit: u32,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "confirm")?;
    let cap = if limit == 0 { 20 } else { limit.min(100) };
    let pending: Vec<u64> = ctx
        .db
        .hr_integration_intent()
        .hr_intent_by_org()
        .filter(&organization_id)
        .filter(|i| i.status == "pending")
        .take(cap as usize)
        .map(|i| i.id)
        .collect();
    for intent_id in pending {
        let _ = apply_hr_integration_intent(ctx, organization_id, intent_id);
    }
    Ok(())
}
