/// CRM Forecast Snapshot — point-in-time weighted pipeline snapshots.
///
/// Tables:
///   - CrmForecastSnapshot
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::require_company_in_organization;
use crate::crm::opportunities::opportunity;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = crm_forecast_snapshot,
    public,
    index(accessor = forecast_by_org, btree(columns = [organization_id])),
    index(accessor = forecast_by_company, btree(columns = [company_id]))
)]
pub struct CrmForecastSnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub period_start: Timestamp,
    pub period_end: Timestamp,
    pub owner_id: Option<Identity>,
    pub weighted_pipeline: f64,
    pub open_count: i32,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCrmForecastSnapshotParams {
    pub period_start: Timestamp,
    pub period_end: Timestamp,
    pub owner_id: Option<Identity>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Snapshot the current weighted pipeline (open, non-won/lost opportunities) for a company,
/// optionally scoped to a single owner. `expected_revenue * probability / 100` is summed
/// across matching opportunities (probability is stored on a 0–100 scale — see
/// `OpportunityStage.probability` and `seed.rs`).
#[spacetimedb::reducer]
pub fn create_forecast_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateCrmForecastSnapshotParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "opportunity", "read")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    let opportunities: Vec<_> = ctx
        .db
        .opportunity()
        .iter()
        .filter(|o| {
            o.organization_id == organization_id
                && o.company_id == Some(company_id)
                && o.deleted_at.is_none()
                && !o.is_won
                && !o.is_lost
        })
        .filter(|o| match params.owner_id {
            Some(owner) => o.user_id == Some(owner),
            None => true,
        })
        .collect();

    let weighted_pipeline: f64 = opportunities
        .iter()
        .map(|o| o.expected_revenue * (o.probability / 100.0))
        .sum();
    let open_count = opportunities.len() as i32;

    let snapshot = ctx.db.crm_forecast_snapshot().insert(CrmForecastSnapshot {
        id: 0,
        organization_id,
        company_id,
        period_start: params.period_start,
        period_end: params.period_end,
        owner_id: params.owner_id,
        weighted_pipeline,
        open_count,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        metadata: params.metadata.clone(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "crm_forecast_snapshot",
            record_id: snapshot.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "weighted_pipeline": weighted_pipeline,
                    "open_count": open_count,
                    "owner_id": params.owner_id.map(|o| o.to_hex().to_string()),
                })
                .to_string(),
            ),
            changed_fields: vec!["weighted_pipeline".to_string(), "open_count".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
