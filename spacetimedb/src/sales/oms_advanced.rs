//! Differentiating OMS capabilities (MVP depth):
//! commission plans/splits, sales contracts, CPQ constraints,
//! SLA escalation schedule, omnichannel allocation hints,
//! and external integration intent/result tracking.
use spacetimedb::{reducer, Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::sales::sales_core::{sale_order, SaleOrder};
use crate::types::SaleState;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = sale_commission_plan,
    public,
    index(accessor = commission_plan_by_org, btree(columns = [organization_id]))
)]
pub struct SaleCommissionPlan {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub is_active: bool,
    pub default_rate_percent: f64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = sale_commission_plan_split,
    public,
    index(accessor = commission_split_by_plan, btree(columns = [plan_id]))
)]
pub struct SaleCommissionPlanSplit {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub plan_id: u64,
    pub partner_id: u64,
    pub share_percent: f64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = sale_contract,
    public,
    index(accessor = sale_contract_by_org, btree(columns = [organization_id])),
    index(accessor = sale_contract_by_partner, btree(columns = [partner_id]))
)]
pub struct SaleContract {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub partner_id: u64,
    pub state: String,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub pricelist_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = sale_cpq_constraint,
    public,
    index(accessor = cpq_constraint_by_org, btree(columns = [organization_id]))
)]
pub struct SaleCpqConstraint {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    /// JSON rule payload (compatibility / BOM constraints).
    pub rule_json: String,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = sales_integration_intent,
    public,
    index(accessor = integration_intent_by_org, btree(columns = [organization_id])),
    index(accessor = integration_intent_by_status, btree(columns = [status]))
)]
pub struct SalesIntegrationIntent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub provider: String,
    pub intent_type: String,
    pub sale_order_id: Option<u64>,
    pub status: String,
    pub idempotency_key: String,
    pub request_payload: Option<String>,
    pub last_error: Option<String>,
    pub external_reference: Option<String>,
    pub attempt_count: u32,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(accessor = sales_sla_escalation_job, scheduled(run_sales_sla_escalation))]
pub struct SalesSlaEscalationJob {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub organization_id: u64,
    pub company_id: u64,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSaleCommissionPlanParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub is_active: bool,
    pub default_rate_percent: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSaleCommissionPlanSplitParams {
    pub plan_id: u64,
    pub partner_id: u64,
    pub share_percent: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSaleContractParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub partner_id: u64,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub pricelist_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSaleCpqConstraintParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub rule_json: String,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSalesIntegrationIntentParams {
    pub company_id: Option<u64>,
    pub provider: String,
    pub intent_type: String,
    pub sale_order_id: Option<u64>,
    pub idempotency_key: String,
    pub request_payload: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordSalesIntegrationResultParams {
    pub status: String,
    pub external_reference: Option<String>,
    pub last_error: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ApplyOmnichannelAllocationParams {
    pub preferred_route_id: Option<u64>,
    pub channel: Option<String>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_sale_commission_plan(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSaleCommissionPlanParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "create")?;
    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    let row = ctx.db.sale_commission_plan().insert(SaleCommissionPlan {
        id: 0,
        organization_id,
        company_id,
        name: params.name.trim().to_string(),
        is_active: params.is_active,
        default_rate_percent: params.default_rate_percent,
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
            table_name: "sale_commission_plan",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": row.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_sale_commission_plan_split(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSaleCommissionPlanSplitParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "create")?;
    let plan = ctx
        .db
        .sale_commission_plan()
        .id()
        .find(&params.plan_id)
        .ok_or("Commission plan not found")?;
    if plan.organization_id != organization_id || plan.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if !(0.0..=100.0).contains(&params.share_percent) {
        return Err("share_percent must be between 0 and 100".to_string());
    }
    let row = ctx
        .db
        .sale_commission_plan_split()
        .insert(SaleCommissionPlanSplit {
            id: 0,
            organization_id,
            plan_id: params.plan_id,
            partner_id: params.partner_id,
            share_percent: params.share_percent,
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
            table_name: "sale_commission_plan_split",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "plan_id": params.plan_id,
                    "partner_id": params.partner_id,
                    "share_percent": params.share_percent,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "plan_id".to_string(),
                "partner_id".to_string(),
                "share_percent".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_sale_contract(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSaleContractParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "create")?;
    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    let row = ctx.db.sale_contract().insert(SaleContract {
        id: 0,
        organization_id,
        company_id,
        name: params.name.trim().to_string(),
        partner_id: params.partner_id,
        state: "draft".to_string(),
        date_start: params.date_start,
        date_end: params.date_end,
        pricelist_id: params.pricelist_id,
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
            table_name: "sale_contract",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": row.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_sale_cpq_constraint(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSaleCpqConstraintParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "create")?;
    if params.rule_json.trim().is_empty() {
        return Err("rule_json is required".to_string());
    }
    let row = ctx.db.sale_cpq_constraint().insert(SaleCpqConstraint {
        id: 0,
        organization_id,
        company_id,
        name: params.name.trim().to_string(),
        rule_json: params.rule_json,
        is_active: params.is_active,
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
            table_name: "sale_cpq_constraint",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": row.name }).to_string()),
            changed_fields: vec!["name".to_string(), "rule_json".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_sales_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSalesIntegrationIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    if params.idempotency_key.trim().is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    let existing = ctx.db.sales_integration_intent().iter().find(|i| {
        i.organization_id == organization_id && i.idempotency_key == params.idempotency_key
    });
    if existing.is_some() {
        return Ok(());
    }
    let row = ctx
        .db
        .sales_integration_intent()
        .insert(SalesIntegrationIntent {
            id: 0,
            organization_id,
            company_id,
            provider: params.provider,
            intent_type: params.intent_type,
            sale_order_id: params.sale_order_id,
            status: "pending".to_string(),
            idempotency_key: params.idempotency_key,
            request_payload: params.request_payload,
            last_error: None,
            external_reference: None,
            attempt_count: 0,
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
            table_name: "sales_integration_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "provider": row.provider,
                    "intent_type": row.intent_type,
                    "status": row.status,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn record_sales_integration_result(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
    params: RecordSalesIntegrationResultParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let intent = ctx
        .db
        .sales_integration_intent()
        .id()
        .find(&intent_id)
        .ok_or("Integration intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    ctx.db
        .sales_integration_intent()
        .id()
        .update(SalesIntegrationIntent {
            status: params.status.clone(),
            external_reference: params.external_reference.clone(),
            last_error: params.last_error.clone(),
            attempt_count: intent.attempt_count.saturating_add(1),
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
            table_name: "sales_integration_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "status": params.status }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Stamp channel/route allocation hints onto a confirmed or draft SO (omnichannel MVP).
#[reducer]
pub fn apply_omnichannel_allocation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    order_id: u64,
    params: ApplyOmnichannelAllocationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;
    if order.organization_id != organization_id || order.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    let mut meta = order
        .metadata
        .as_ref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    if let Some(route) = params.preferred_route_id {
        meta.insert("preferred_route_id".into(), serde_json::json!(route));
    }
    if let Some(ch) = params.channel {
        meta.insert("channel".into(), serde_json::Value::String(ch));
    }
    if let Some(extra) = params.metadata {
        meta.insert("allocation_meta".into(), serde_json::Value::String(extra));
    }
    ctx.db.sale_order().id().update(SaleOrder {
        metadata: Some(serde_json::Value::Object(meta).to_string()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "sale_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "allocation": true }).to_string()),
            changed_fields: vec!["metadata".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn schedule_sales_sla_escalation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    delay_secs: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let when = ctx.timestamp + std::time::Duration::from_secs(delay_secs.max(60));
    let job = ctx
        .db
        .sales_sla_escalation_job()
        .insert(SalesSlaEscalationJob {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Time(when),
            organization_id,
            company_id,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "sales_sla_escalation_job",
            record_id: job.scheduled_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "delay_secs": delay_secs.max(60) }).to_string()),
            changed_fields: vec!["scheduled_at".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Scheduled scan / log-only — no domain row mutation, no `write_audit_log_v2` (intentional gap).
#[reducer]
pub fn run_sales_sla_escalation(
    ctx: &ReducerContext,
    job: SalesSlaEscalationJob,
) -> Result<(), String> {
    // MVP: mark overdue ToApprove / open pickings in audit metadata; full Ops notify later.
    let mut escalated = 0u32;
    for order in ctx
        .db
        .sale_order()
        .sale_order_by_org()
        .filter(&job.organization_id)
    {
        if order.company_id != job.company_id {
            continue;
        }
        if order.state == SaleState::ToApprove {
            escalated += 1;
        }
    }
    log::info!(
        "sales SLA escalation org={} company={} to_approve_seen={}",
        job.organization_id,
        job.company_id,
        escalated
    );
    Ok(())
}
