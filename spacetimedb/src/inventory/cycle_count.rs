use crate::core::business_changes::write_business_audit;
/// Cycle Counting — Tables and Reducers
///
/// Tables:
///   - StockCycleCount
///   - StockCountSheet
use crate::core::business_changes::{capture_business_audit, merge_business_audit_changes};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::helpers::{check_permission, AuditLogParams};
use crate::inventory::inventory_close::assert_inventory_writable;
use crate::inventory::stock::stock_quant;
use crate::inventory::stock_correction::{
    apply_correction, correction_quant, prepare_correction, validate_correction_target,
    CorrectionIdentity,
};
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Stock Cycle Count Plan / Session
#[spacetimedb::table(
    accessor = stock_cycle_count,
    public,
    index(accessor = cycle_count_by_org, btree(columns = [organization_id])),
    index(accessor = cycle_count_by_state, btree(columns = [state])),
    index(accessor = cycle_count_by_location, btree(columns = [location_id]))
)]
pub struct StockCycleCount {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    /// draft | in_progress | validated | posted | cancelled
    pub state: String,
    pub location_id: u64,
    pub product_ids: Vec<u64>,
    pub product_category_ids: Vec<u64>,
    pub count_by: String,
    pub frequency: String,
    pub last_count_date: Option<Timestamp>,
    pub next_count_date: Option<Timestamp>,
    pub tolerance_percentage: f64,
    pub tolerance_value: f64,
    pub user_id: Option<Identity>,
    pub team_id: Option<u64>,
    pub company_id: u64,
    pub inventory_id: Option<u64>,
    pub line_ids: Vec<u64>,
    pub reason: Option<String>,
    pub notes: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

/// Stock Count Sheet Line
#[spacetimedb::table(
    accessor = stock_count_sheet,
    public,
    index(accessor = count_sheet_by_org, btree(columns = [organization_id])),
    index(accessor = count_sheet_by_cycle, btree(columns = [cycle_count_id])),
    index(accessor = count_sheet_by_product, btree(columns = [product_id]))
)]
pub struct StockCountSheet {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub cycle_count_id: u64,
    pub product_id: u64,
    pub location_id: u64,
    pub lot_id: Option<u64>,
    pub expected_qty: f64,
    pub counted_qty: f64,
    pub uom_id: u64,
    pub variance: f64,
    pub variance_value: f64,
    pub counted_by: Option<Identity>,
    pub counted_at: Option<Timestamp>,
    pub notes: Option<String>,
    pub is_processed: bool,
    pub processed_at: Option<Timestamp>,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCycleCountPlanParams {
    /// If None, defaults to "Cycle Count @ {location_id}"
    pub name: Option<String>,
    pub count_by: String,
    pub frequency: String,
    pub tolerance_percentage: f64,
    pub tolerance_value: f64,
    pub next_count_date: Option<Timestamp>,
    pub user_id: Option<Identity>,
    pub team_id: Option<u64>,
    pub product_ids: Vec<u64>,
    pub product_category_ids: Vec<u64>,
    pub reason: Option<String>,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordCycleCountLineParams {
    pub product_id: u64,
    pub location_id: u64,
    pub lot_id: Option<u64>,
    pub qty_counted: f64,
    pub uom_id: u64,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

fn sheet_identity(sheet: &StockCountSheet, company_id: u64) -> CorrectionIdentity {
    CorrectionIdentity {
        organization_id: sheet.organization_id,
        company_id,
        product_id: sheet.product_id,
        location_id: sheet.location_id,
        lot_id: sheet.lot_id,
        package_id: None,
    }
}

/// Count DTOs cannot select package, ownership or variant dimensions. Refuse an
/// ambiguous physical count rather than create a second, unpackaged balance.
fn require_plain_count_target(
    ctx: &ReducerContext,
    target: CorrectionIdentity,
) -> Result<(), String> {
    if ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(target.product_id)
        .any(|q| {
            q.organization_id == target.organization_id
                && q.company_id == target.company_id
                && q.location_id == target.location_id
                && q.lot_id == target.lot_id
                && (q.package_id.is_some()
                    || q.owner_id.is_some()
                    || q.product_variant_id.is_some())
        })
    {
        return Err("cycle count cannot select packaged, owned or variant stock; use an explicit stock workflow".to_string());
    }
    Ok(())
}

fn compute_sheet_variance_value(
    expected_qty: f64,
    counted_qty: f64,
    quant_cost: Option<f64>,
) -> f64 {
    let variance = counted_qty - expected_qty;
    variance * quant_cost.unwrap_or(0.0)
}

/// Phase-3 alias: create cycle count plan
#[spacetimedb::reducer]
pub fn create_cycle_count_plan(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    location_id: u64,
    params: CreateCycleCountPlanParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "create")?;

    let plan_name = params
        .name
        .unwrap_or_else(|| format!("Cycle Count @ {}", location_id));
    if plan_name.trim().is_empty() {
        return Err("Cycle count plan name cannot be empty".to_string());
    }

    let product_count = params.product_ids.len();
    let category_count = params.product_category_ids.len();

    // state starts as "draft"; line_ids and inventory_id are system-managed
    let cycle = ctx.db.stock_cycle_count().insert(StockCycleCount {
        id: 0,
        organization_id,
        name: plan_name.clone(),
        state: "draft".to_string(),
        location_id,
        product_ids: params.product_ids,
        product_category_ids: params.product_category_ids,
        count_by: params.count_by,
        frequency: params.frequency,
        last_count_date: None,
        next_count_date: params.next_count_date,
        tolerance_percentage: params.tolerance_percentage,
        tolerance_value: params.tolerance_value,
        user_id: params.user_id,
        team_id: params.team_id,
        company_id,
        inventory_id: None,
        line_ids: vec![],
        reason: params.reason,
        notes: params.notes,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_business_audit(
        ctx,
        organization_id,
        "create_cycle_count_plan",
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_cycle_count",
            record_id: cycle.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "state": "draft",
                    "location_id": location_id,
                    "product_count": product_count,
                    "category_count": category_count,
                })
                .to_string(),
            ),
            changed_fields: vec!["state".to_string(), "location_id".to_string()],
            metadata: None,
        },
    )?;

    Ok(())
}

/// Phase-3 alias: start cycle count session
#[spacetimedb::reducer]
pub fn start_cycle_count_session(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    cycle_count_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "write")?;

    let cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }
    if cycle.company_id != company_id {
        return Err("Cycle count does not belong to this company".to_string());
    }
    if cycle.state != "draft" && cycle.state != "validated" {
        return Err("Only draft/validated cycle counts can be started".to_string());
    }

    ctx.db.stock_cycle_count().id().update(StockCycleCount {
        state: "in_progress".to_string(),
        updated_at: ctx.timestamp,
        ..cycle
    });

    write_business_audit(
        ctx,
        organization_id,
        "start_cycle_count_session",
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_cycle_count",
            record_id: cycle_count_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "draft" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "in_progress" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    )?;

    Ok(())
}

/// Phase-3 alias: record cycle count line
#[spacetimedb::reducer]
pub fn record_cycle_count_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    cycle_count_id: u64,
    params: RecordCycleCountLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_count_sheet", "create")?;

    let cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }
    if cycle.company_id != company_id {
        return Err("Cycle count does not belong to this company".to_string());
    }
    if cycle.state != "in_progress" {
        return Err("Cycle count must be in_progress to record lines".to_string());
    }

    // Non-negative finite counted quantity
    if !params.qty_counted.is_finite() || params.qty_counted < 0.0 {
        return Err("qty_counted must be a non-negative finite number".to_string());
    }

    if params.location_id != cycle.location_id {
        return Err("count location must match the cycle count location".to_string());
    }
    let target = CorrectionIdentity {
        organization_id,
        company_id,
        product_id: params.product_id,
        location_id: params.location_id,
        lot_id: params.lot_id,
        package_id: None,
    };
    validate_correction_target(ctx, target, params.uom_id)?;
    require_plain_count_target(ctx, target)?;
    let existing_quant = correction_quant(ctx, target)?;
    for id in &cycle.line_ids {
        let line = ctx
            .db
            .stock_count_sheet()
            .id()
            .find(id)
            .ok_or("stock count sheet not found")?;
        if line.product_id == params.product_id
            && line.location_id == params.location_id
            && line.lot_id == params.lot_id
        {
            return Err("a count line already exists for this stock identity".to_string());
        }
    }

    let expected_qty = existing_quant.as_ref().map(|q| q.quantity).unwrap_or(0.0);
    let quant_cost = existing_quant.map(|q| q.cost);

    let variance = params.qty_counted - expected_qty;
    let variance_value = compute_sheet_variance_value(expected_qty, params.qty_counted, quant_cost);

    // is_processed and processed_at are system-managed; set by post_cycle_count_adjustments
    let sheet = ctx.db.stock_count_sheet().insert(StockCountSheet {
        id: 0,
        organization_id,
        cycle_count_id,
        product_id: params.product_id,
        location_id: params.location_id,
        lot_id: params.lot_id,
        expected_qty,
        counted_qty: params.qty_counted,
        uom_id: params.uom_id,
        variance,
        variance_value,
        counted_by: Some(ctx.sender()),
        counted_at: Some(ctx.timestamp),
        notes: params.notes,
        is_processed: false,
        processed_at: None,
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    let mut ids = cycle.line_ids.clone();
    ids.push(sheet.id);
    ctx.db.stock_cycle_count().id().update(StockCycleCount {
        line_ids: ids,
        updated_at: ctx.timestamp,
        ..cycle
    });

    write_business_audit(
        ctx,
        organization_id,
        "record_cycle_count_line",
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_count_sheet",
            record_id: sheet.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "product_id": params.product_id,
                    "counted_qty": params.qty_counted,
                    "variance": variance,
                })
                .to_string(),
            ),
            changed_fields: vec!["counted_qty".to_string(), "variance".to_string()],
            metadata: None,
        },
    )?;

    Ok(())
}

/// Compare counted vs expected and mark the session as validated.
/// This does not mutate stock yet.
#[spacetimedb::reducer]
pub fn validate_cycle_count(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    cycle_count_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "write")?;

    let cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }
    if cycle.company_id != company_id {
        return Err("Cycle count does not belong to this company".to_string());
    }
    if cycle.state != "in_progress" {
        return Err("Cycle count must be in_progress to validate".to_string());
    }

    let sheets: Vec<_> = cycle
        .line_ids
        .iter()
        .filter_map(|id| ctx.db.stock_count_sheet().id().find(id))
        .collect();

    if sheets.is_empty() {
        return Err("Cannot validate cycle count without lines".to_string());
    }

    ctx.db.stock_cycle_count().id().update(StockCycleCount {
        state: "validated".to_string(),
        updated_at: ctx.timestamp,
        ..cycle
    });

    write_business_audit(
        ctx,
        organization_id,
        "validate_cycle_count",
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_cycle_count",
            record_id: cycle_count_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "in_progress" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "validated" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    )?;

    Ok(())
}

/// Apply stock adjustments from validated count sheets.
/// - marks each sheet processed
/// - upserts quant quantities to counted values
/// - marks cycle as posted
#[spacetimedb::reducer]
pub fn post_cycle_count_adjustments(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    cycle_count_id: u64,
) -> Result<(), String> {
    let mut business_audit_changes = Vec::new();
    check_permission(ctx, organization_id, "stock_cycle_count", "write")?;

    let cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }
    if cycle.company_id != company_id {
        return Err("Cycle count does not belong to this company".to_string());
    }
    if cycle.state != "validated" {
        return Err("Cycle count must be validated before posting adjustments".to_string());
    }

    assert_inventory_writable(ctx, organization_id, cycle.company_id)?;

    // Resolve and validate every line before writing any quant or processed flag.
    let mut prepared_lines = Vec::with_capacity(cycle.line_ids.len());
    let mut identities = std::collections::HashSet::new();
    for sheet_id in &cycle.line_ids {
        let sheet = ctx
            .db
            .stock_count_sheet()
            .id()
            .find(sheet_id)
            .ok_or("stock count sheet not found")?;
        if sheet.organization_id != organization_id
            || sheet.cycle_count_id != cycle_count_id
            || sheet.location_id != cycle.location_id
            || sheet.is_processed
        {
            return Err("stock count sheet does not belong to this unposted cycle".to_string());
        }
        let target = sheet_identity(&sheet, cycle.company_id);
        require_plain_count_target(ctx, target)?;
        if !identities.insert(target) {
            return Err("duplicate stock identities in cycle count".to_string());
        }
        let prepared = prepare_correction(
            ctx,
            target,
            sheet.uom_id,
            sheet.expected_qty,
            sheet.counted_qty,
            None,
        )?;
        prepared_lines.push((sheet, prepared));
    }
    if prepared_lines.is_empty() {
        return Err("cannot post cycle count without lines".to_string());
    }
    let mut adjusted_quant_ids = Vec::with_capacity(prepared_lines.len());
    let mut processed_sheets = Vec::with_capacity(prepared_lines.len());
    for (sheet, prepared) in prepared_lines {
        adjusted_quant_ids.push(apply_correction(ctx, prepared));
        let processed = ctx.db.stock_count_sheet().id().update(StockCountSheet {
            is_processed: true,
            processed_at: Some(ctx.timestamp),
            ..sheet
        });
        processed_sheets.push(processed);
    }

    let posted_cycle = ctx.db.stock_cycle_count().id().update(StockCycleCount {
        state: "posted".to_string(),
        last_count_date: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        ..cycle
    });

    business_audit_changes.extend(capture_business_audit(
        ctx,
        organization_id,
        "post_cycle_count_adjustments",
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_cycle_count",
            record_id: cycle_count_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "validated" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "posted" }).to_string()),
            changed_fields: vec!["state".to_string(), "last_count_date".to_string()],
            metadata: None,
        },
    )?);

    // Capture the exact quant outcomes this post produced. Every id here was
    // resolved by the shared exact correction identity or is a fresh insert
    // whose id we carry directly — never rediscovered by newest/highest id.
    adjusted_quant_ids.sort_unstable();
    adjusted_quant_ids.dedup();
    let mut changed_quants: Vec<RowChange> = Vec::with_capacity(adjusted_quant_ids.len());
    for quant_id in adjusted_quant_ids {
        let quant_after = ctx
            .db
            .stock_quant()
            .id()
            .find(&quant_id)
            .ok_or("Adjusted quant disappeared before commit recording")?;
        changed_quants.push(RowChange::upsert_stdb_row(
            "stock_quant",
            serde_json::json!({"id": quant_after.id}),
            &quant_after,
        )?);
    }
    changed_quants.push(RowChange::upsert_stdb_row(
        "stock_cycle_count",
        serde_json::json!({"id": posted_cycle.id}),
        &posted_cycle,
    )?);
    processed_sheets.sort_by_key(|sheet| sheet.id);
    for sheet in &processed_sheets {
        changed_quants.push(RowChange::upsert_stdb_row(
            "stock_count_sheet",
            serde_json::json!({"id": sheet.id}),
            sheet,
        )?);
    }
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.post_cycle_count_adjustments".to_string(),
            correlation_id: format!("cycle-count:{cycle_count_id}:post"),
            changes: merge_business_audit_changes(changed_quants, business_audit_changes)?,
        },
    )?;

    Ok(())
}
