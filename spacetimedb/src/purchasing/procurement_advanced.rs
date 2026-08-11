//! Differentiating purchasing capabilities (MVP depth):
//! blanket orders / contracts, vendor scorecards + risk,
//! consignment agreements, approval delegates, commodity index hooks,
//! and customs / e-invoice integration intent/result tracking.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::relations::{require_active_currency_id, require_contact_in_scope};
use crate::core::organization::require_company_in_organization;
use crate::core::users::{user_organization, user_profile};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::product;
use crate::inventory::stock::{require_product_in_org, require_warehouse_in_org_and_company};
use crate::manufacturing::relations::{require_uom_compatible, require_uom_in_org};
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, create_purchase_order, purchase_order, AddPurchaseOrderLineParams,
    CreatePurchaseOrderParams,
};
use crate::purchasing::require_purchasing_ri_phase0_unsafe_actions_enabled;
use crate::types::PoState;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = purchase_blanket_order,
    public,
    index(accessor = purchase_blanket_order_by_org, btree(columns = [organization_id])),
    index(accessor = purchase_blanket_order_by_partner, btree(columns = [partner_id]))
)]
pub struct PurchaseBlanketOrder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub partner_id: u64,
    pub currency_id: u64,
    pub state: String,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub release_count: u32,
    pub last_release_po_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = purchase_blanket_order_line,
    public,
    index(accessor = purchase_blanket_line_by_blanket, btree(columns = [blanket_order_id])),
    index(accessor = purchase_blanket_line_by_org, btree(columns = [organization_id]))
)]
pub struct PurchaseBlanketOrderLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub blanket_order_id: u64,
    pub product_id: u64,
    pub product_uom: u64,
    pub committed_quantity: f64,
    pub released_quantity: f64,
    pub price_unit: f64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = purchase_blanket_release,
    public,
    index(accessor = purchase_blanket_release_by_blanket, btree(columns = [blanket_order_id])),
    index(accessor = purchase_blanket_release_by_org, btree(columns = [organization_id]))
)]
pub struct PurchaseBlanketRelease {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub blanket_order_id: u64,
    pub purchase_order_id: u64,
    pub idempotency_key: String,
    pub request_fingerprint: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

#[spacetimedb::table(
    accessor = purchase_contract,
    public,
    index(accessor = purchase_contract_by_org, btree(columns = [organization_id])),
    index(accessor = purchase_contract_by_partner, btree(columns = [partner_id]))
)]
pub struct PurchaseContract {
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
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = vendor_scorecard,
    public,
    index(accessor = vendor_scorecard_by_org, btree(columns = [organization_id])),
    index(accessor = vendor_scorecard_by_partner, btree(columns = [partner_id]))
)]
pub struct VendorScorecard {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub partner_id: u64,
    /// On-time in-full score (0–100).
    pub otif_score: f64,
    /// Quality score (0–100).
    pub quality_score: f64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = vendor_risk_flag,
    public,
    index(accessor = vendor_risk_flag_by_org, btree(columns = [organization_id])),
    index(accessor = vendor_risk_flag_by_partner, btree(columns = [partner_id]))
)]
pub struct VendorRiskFlag {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub partner_id: u64,
    pub is_flagged: bool,
    pub risk_level: String,
    pub reason: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = consignment_agreement,
    public,
    index(accessor = consignment_agreement_by_org, btree(columns = [organization_id])),
    index(accessor = consignment_agreement_by_partner, btree(columns = [partner_id]))
)]
pub struct ConsignmentAgreement {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub partner_id: u64,
    pub product_id: u64,
    pub warehouse_id: u64,
    pub state: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = purchase_approval_delegate,
    public,
    index(accessor = purchase_approval_delegate_by_org, btree(columns = [organization_id])),
    index(accessor = purchase_approval_delegate_by_company, btree(columns = [company_id]))
)]
pub struct PurchaseApprovalDelegate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// Approver being covered (principal).
    pub principal_identity: Identity,
    /// Substitute approver.
    pub delegate_identity: Identity,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = commodity_price_index,
    public,
    index(accessor = commodity_price_index_by_org, btree(columns = [organization_id])),
    index(accessor = commodity_price_index_by_code, btree(columns = [code]))
)]
pub struct CommodityPriceIndex {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub code: String,
    pub rate: f64,
    pub as_of: Timestamp,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = purchasing_integration_intent,
    public,
    index(accessor = purchasing_integration_intent_by_org, btree(columns = [organization_id])),
    index(accessor = purchasing_integration_intent_by_status, btree(columns = [status]))
)]
pub struct PurchasingIntegrationIntent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub provider: String,
    pub intent_type: String,
    pub purchase_order_id: Option<u64>,
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

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseBlanketOrderParams {
    pub name: String,
    pub partner_id: u64,
    pub currency_id: u64,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub lines: Vec<CreatePurchaseBlanketOrderLineParams>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseBlanketOrderLineParams {
    pub product_id: u64,
    pub product_uom: u64,
    pub committed_quantity: f64,
    pub price_unit: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReleaseBlanketToPoParams {
    pub idempotency_key: String,
    pub lines: Vec<ReleaseBlanketLineParams>,
    pub notes: Option<String>,
    pub date_planned: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReleaseBlanketLineParams {
    pub blanket_line_id: u64,
    pub quantity: f64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseContractParams {
    pub name: String,
    pub partner_id: u64,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertVendorScorecardParams {
    pub partner_id: u64,
    pub otif_score: f64,
    pub quality_score: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetVendorRiskFlagParams {
    pub partner_id: u64,
    pub is_flagged: bool,
    pub risk_level: String,
    pub reason: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateConsignmentAgreementParams {
    pub name: String,
    pub partner_id: u64,
    pub product_id: u64,
    pub warehouse_id: u64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetPurchaseApprovalDelegateParams {
    pub principal_identity: Identity,
    pub delegate_identity: Identity,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetCommodityPriceIndexParams {
    pub code: String,
    pub rate: f64,
    pub as_of: Timestamp,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchasingIntegrationIntentParams {
    pub provider: String,
    pub intent_type: String,
    pub purchase_order_id: Option<u64>,
    pub idempotency_key: String,
    pub request_payload: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordPurchasingIntegrationResultParams {
    pub status: String,
    pub external_reference: Option<String>,
    pub last_error: Option<String>,
    pub metadata: Option<String>,
}

fn require_advanced_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    require_company_in_organization(ctx, organization_id, company_id)
}

fn require_advanced_vendor(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    partner_id: u64,
) -> Result<(), String> {
    let vendor = require_contact_in_scope(
        ctx,
        organization_id,
        company_id,
        partner_id,
        "advanced procurement vendor",
    )?;
    if !vendor.is_vendor || vendor.deleted_at.is_some() || vendor.merge_target_id.is_some() {
        return Err("Advanced procurement partner is not an active vendor".to_string());
    }
    Ok(())
}

fn require_organization_identity(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    identity: Identity,
    role: &str,
) -> Result<(), String> {
    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(&identity)
        .ok_or_else(|| format!("{role} user profile not found"))?;
    if !profile.is_active {
        return Err(format!("{role} user is inactive"));
    }
    let is_member = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&identity)
        .any(|membership| {
            membership.organization_id == organization_id
                && membership.is_active
                && membership
                    .company_id
                    .is_none_or(|member_company| member_company == company_id)
        });
    if !is_member {
        return Err(format!(
            "{role} user is not active in this organization/company"
        ));
    }
    Ok(())
}

fn require_valid_date_range(
    date_start: Option<Timestamp>,
    date_end: Option<Timestamp>,
) -> Result<(), String> {
    if date_start
        .zip(date_end)
        .is_some_and(|(start, end)| end < start)
    {
        return Err("date_end cannot precede date_start".to_string());
    }
    Ok(())
}

fn require_scoped_purchase_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    purchase_order_id: u64,
) -> Result<(), String> {
    let order = ctx
        .db
        .purchase_order()
        .id()
        .find(&purchase_order_id)
        .ok_or("Purchase order not found")?;
    if order.organization_id != organization_id || order.company_id != company_id {
        return Err("Purchase order does not belong to this organization/company".to_string());
    }
    if order.state == PoState::Cancelled {
        return Err("Cancelled purchase orders cannot be used for integration intents".to_string());
    }
    Ok(())
}

fn validate_blanket_product_uom(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    uom_id: u64,
) -> Result<(), String> {
    require_product_in_org(ctx, organization_id, product_id)?;
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Blanket product not found")?;
    if !product.purchase_ok {
        return Err("Blanket product is not purchasable".to_string());
    }
    let supplied_uom = require_uom_in_org(ctx, organization_id, uom_id, "blanket line")?;
    let purchase_uom = require_uom_in_org(
        ctx,
        organization_id,
        product.uom_po_id,
        "blanket product purchase",
    )?;
    require_uom_compatible(&purchase_uom, &supplied_uom, "blanket line")
}

fn blanket_release_fingerprint(lines: &[ReleaseBlanketLineParams]) -> String {
    let mut normalized: Vec<(u64, u64)> = lines
        .iter()
        .map(|line| (line.blanket_line_id, line.quantity.to_bits()))
        .collect();
    normalized.sort_unstable();
    normalized
        .into_iter()
        .map(|(line_id, quantity_bits)| format!("{line_id}:{quantity_bits}"))
        .collect::<Vec<_>>()
        .join("|")
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_purchase_blanket_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePurchaseBlanketOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_advanced_company(ctx, organization_id, company_id)?;
    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    require_advanced_vendor(ctx, organization_id, company_id, params.partner_id)?;
    require_active_currency_id(ctx, params.currency_id, "blanket order")?;
    require_valid_date_range(params.date_start, params.date_end)?;
    if params.lines.is_empty() {
        return Err("Blanket order requires at least one committed line".to_string());
    }
    for line in &params.lines {
        if !line.committed_quantity.is_finite() || line.committed_quantity <= 0.0 {
            return Err("Blanket committed quantity must be positive and finite".to_string());
        }
        if !line.price_unit.is_finite() || line.price_unit < 0.0 {
            return Err("Blanket price must be non-negative and finite".to_string());
        }
        validate_blanket_product_uom(ctx, organization_id, line.product_id, line.product_uom)?;
    }
    let row = ctx
        .db
        .purchase_blanket_order()
        .insert(PurchaseBlanketOrder {
            id: 0,
            organization_id,
            company_id,
            name: params.name.trim().to_string(),
            partner_id: params.partner_id,
            currency_id: params.currency_id,
            state: "draft".to_string(),
            date_start: params.date_start,
            date_end: params.date_end,
            release_count: 0,
            last_release_po_id: None,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata,
        });
    for line in params.lines {
        ctx.db
            .purchase_blanket_order_line()
            .insert(PurchaseBlanketOrderLine {
                id: 0,
                organization_id,
                company_id,
                blanket_order_id: row.id,
                product_id: line.product_id,
                product_uom: line.product_uom,
                committed_quantity: line.committed_quantity,
                released_quantity: 0.0,
                price_unit: line.price_unit,
                create_uid: ctx.sender(),
                create_date: ctx.timestamp,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                metadata: line.metadata,
            });
    }
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_blanket_order",
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

/// Release against a blanket agreement — creates a draft purchase order.
#[reducer]
pub fn release_blanket_to_po(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    blanket_order_id: u64,
    params: ReleaseBlanketToPoParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_advanced_company(ctx, organization_id, company_id)?;
    let blanket = ctx
        .db
        .purchase_blanket_order()
        .id()
        .find(&blanket_order_id)
        .ok_or("Blanket order not found")?;
    if blanket.organization_id != organization_id || blanket.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if blanket.state != "draft" {
        return Err("Only draft blanket orders can be released".to_string());
    }
    require_advanced_vendor(ctx, organization_id, company_id, blanket.partner_id)?;
    require_active_currency_id(ctx, blanket.currency_id, "blanket release")?;

    let idempotency_key = params.idempotency_key.trim();
    if idempotency_key.is_empty() {
        return Err("Blanket release idempotency_key is required".to_string());
    }
    if params.lines.is_empty() {
        return Err("Blanket release requires at least one line".to_string());
    }
    let fingerprint = blanket_release_fingerprint(&params.lines);
    if let Some(existing) = ctx.db.purchase_blanket_release().iter().find(|release| {
        release.organization_id == organization_id
            && release.company_id == company_id
            && release.blanket_order_id == blanket_order_id
            && release.idempotency_key == idempotency_key
    }) {
        if existing.request_fingerprint != fingerprint {
            return Err("Blanket release key was already used with different lines".to_string());
        }
        return Ok(());
    }

    let mut seen_line_ids = std::collections::HashSet::new();
    let mut release_lines = Vec::with_capacity(params.lines.len());
    for requested in &params.lines {
        if !seen_line_ids.insert(requested.blanket_line_id) {
            return Err("Blanket release contains a duplicate line".to_string());
        }
        if !requested.quantity.is_finite() || requested.quantity <= 0.0 {
            return Err("Blanket release quantity must be positive and finite".to_string());
        }
        let line = ctx
            .db
            .purchase_blanket_order_line()
            .id()
            .find(&requested.blanket_line_id)
            .ok_or("Blanket line not found")?;
        if line.organization_id != organization_id
            || line.company_id != company_id
            || line.blanket_order_id != blanket_order_id
        {
            return Err("Blanket line does not belong to this agreement scope".to_string());
        }
        let remaining = line.committed_quantity - line.released_quantity;
        if requested.quantity > remaining + 0.000_001 {
            return Err("Blanket release exceeds the remaining commitment".to_string());
        }
        validate_blanket_product_uom(ctx, organization_id, line.product_id, line.product_uom)?;
        release_lines.push((line, requested.quantity));
    }

    let origin = format!("blanket:{blanket_order_id}");
    create_purchase_order(
        ctx,
        organization_id,
        CreatePurchaseOrderParams {
            company_id: Some(company_id),
            partner_id: blanket.partner_id,
            currency_id: blanket.currency_id,
            origin: Some(origin.clone()),
            partner_ref: None,
            notes: params.notes.clone(),
            date_planned: params.date_planned,
            payment_term_id: None,
            fiscal_position_id: None,
            incoterm_id: None,
            incoterm_location: None,
            user_id: None,
            invoice_ids: vec![],
            picking_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            activity_ids: vec![],
            is_quantity_copy: None,
            metadata: Some(params.metadata.clone().unwrap_or_else(|| {
                format!(r#"{{"blanket_order_id":{blanket_order_id},"released_from_blanket":true}}"#)
            })),
        },
    )?;

    let po = ctx
        .db
        .purchase_order()
        .iter()
        .filter(|p| {
            p.organization_id == organization_id
                && p.company_id == company_id
                && p.partner_id == blanket.partner_id
                && p.origin.as_deref() == Some(origin.as_str())
        })
        .max_by_key(|p| p.id)
        .ok_or("Purchase order not found after blanket release")?;

    for (line, quantity) in &release_lines {
        add_purchase_order_line(
            ctx,
            organization_id,
            po.id,
            AddPurchaseOrderLineParams {
                product_id: line.product_id,
                quantity: *quantity,
                uom_id: line.product_uom,
                price_unit: line.price_unit,
                discount: 0.0,
                tax_ids: vec![],
                name: None,
                sequence: None,
                display_type: None,
                product_variant_id: None,
                account_analytic_id: None,
                date_planned: params.date_planned,
                propagate_cancel: Some(true),
                lot_id: None,
                metadata: line.metadata.clone(),
            },
        )?;
    }

    for (line, quantity) in release_lines {
        ctx.db
            .purchase_blanket_order_line()
            .id()
            .update(PurchaseBlanketOrderLine {
                released_quantity: line.released_quantity + quantity,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..line
            });
    }

    ctx.db
        .purchase_blanket_release()
        .insert(PurchaseBlanketRelease {
            id: 0,
            organization_id,
            company_id,
            blanket_order_id,
            purchase_order_id: po.id,
            idempotency_key: idempotency_key.to_string(),
            request_fingerprint: fingerprint,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
        });

    let release_count = blanket.release_count.saturating_add(1);
    let po_id = po.id;
    ctx.db
        .purchase_blanket_order()
        .id()
        .update(PurchaseBlanketOrder {
            release_count,
            last_release_po_id: Some(po_id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..blanket
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_blanket_order",
            record_id: blanket_order_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "last_release_po_id": po_id,
                    "release_count": release_count,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "release_count".to_string(),
                "last_release_po_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_purchase_contract(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePurchaseContractParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_advanced_company(ctx, organization_id, company_id)?;
    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    require_advanced_vendor(ctx, organization_id, company_id, params.partner_id)?;
    require_valid_date_range(params.date_start, params.date_end)?;
    let row = ctx.db.purchase_contract().insert(PurchaseContract {
        id: 0,
        organization_id,
        company_id,
        name: params.name.trim().to_string(),
        partner_id: params.partner_id,
        state: "draft".to_string(),
        date_start: params.date_start,
        date_end: params.date_end,
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
            table_name: "purchase_contract",
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
pub fn upsert_vendor_scorecard(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: UpsertVendorScorecardParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_advanced_company(ctx, organization_id, company_id)?;
    require_advanced_vendor(ctx, organization_id, company_id, params.partner_id)?;
    if !(0.0..=100.0).contains(&params.otif_score) {
        return Err("otif_score must be between 0 and 100".to_string());
    }
    if !(0.0..=100.0).contains(&params.quality_score) {
        return Err("quality_score must be between 0 and 100".to_string());
    }

    let existing = ctx.db.vendor_scorecard().iter().find(|row| {
        row.organization_id == organization_id
            && row.company_id == company_id
            && row.partner_id == params.partner_id
    });

    if let Some(row) = existing {
        let record_id = row.id;
        ctx.db.vendor_scorecard().id().update(VendorScorecard {
            otif_score: params.otif_score,
            quality_score: params.quality_score,
            metadata: params.metadata.or(row.metadata.clone()),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..row
        });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "vendor_scorecard",
                record_id,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "partner_id": params.partner_id,
                        "otif_score": params.otif_score,
                        "quality_score": params.quality_score,
                    })
                    .to_string(),
                ),
                changed_fields: vec!["otif_score".to_string(), "quality_score".to_string()],
                metadata: None,
            },
        );
    } else {
        let row = ctx.db.vendor_scorecard().insert(VendorScorecard {
            id: 0,
            organization_id,
            company_id,
            partner_id: params.partner_id,
            otif_score: params.otif_score,
            quality_score: params.quality_score,
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
                table_name: "vendor_scorecard",
                record_id: row.id,
                action: "CREATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "partner_id": params.partner_id,
                        "otif_score": params.otif_score,
                        "quality_score": params.quality_score,
                    })
                    .to_string(),
                ),
                changed_fields: vec![
                    "partner_id".to_string(),
                    "otif_score".to_string(),
                    "quality_score".to_string(),
                ],
                metadata: None,
            },
        );
    }
    Ok(())
}

#[reducer]
pub fn set_vendor_risk_flag(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SetVendorRiskFlagParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_advanced_company(ctx, organization_id, company_id)?;
    require_advanced_vendor(ctx, organization_id, company_id, params.partner_id)?;
    if params.risk_level.trim().is_empty() {
        return Err("risk_level is required".to_string());
    }
    let risk_level = params.risk_level.trim().to_ascii_lowercase();
    if !["low", "medium", "high", "critical"].contains(&risk_level.as_str()) {
        return Err("risk_level must be low, medium, high, or critical".to_string());
    }

    let existing = ctx.db.vendor_risk_flag().iter().find(|row| {
        row.organization_id == organization_id
            && row.company_id == company_id
            && row.partner_id == params.partner_id
    });

    if let Some(row) = existing {
        let record_id = row.id;
        ctx.db.vendor_risk_flag().id().update(VendorRiskFlag {
            is_flagged: params.is_flagged,
            risk_level: risk_level.clone(),
            reason: params.reason.clone().or(row.reason.clone()),
            metadata: params.metadata.or(row.metadata.clone()),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..row
        });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "vendor_risk_flag",
                record_id,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "partner_id": params.partner_id,
                        "is_flagged": params.is_flagged,
                        "risk_level": risk_level,
                    })
                    .to_string(),
                ),
                changed_fields: vec![
                    "is_flagged".to_string(),
                    "risk_level".to_string(),
                    "reason".to_string(),
                ],
                metadata: None,
            },
        );
    } else {
        let row = ctx.db.vendor_risk_flag().insert(VendorRiskFlag {
            id: 0,
            organization_id,
            company_id,
            partner_id: params.partner_id,
            is_flagged: params.is_flagged,
            risk_level: risk_level.clone(),
            reason: params.reason,
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
                table_name: "vendor_risk_flag",
                record_id: row.id,
                action: "CREATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "partner_id": params.partner_id,
                        "is_flagged": params.is_flagged,
                        "risk_level": risk_level,
                    })
                    .to_string(),
                ),
                changed_fields: vec![
                    "partner_id".to_string(),
                    "is_flagged".to_string(),
                    "risk_level".to_string(),
                ],
                metadata: None,
            },
        );
    }
    Ok(())
}

/// Explicitly clear a vendor risk rationale without overloading omission.
#[reducer]
pub fn clear_vendor_risk_reason(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    partner_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_advanced_company(ctx, organization_id, company_id)?;
    require_advanced_vendor(ctx, organization_id, company_id, partner_id)?;
    let mut row = ctx
        .db
        .vendor_risk_flag()
        .iter()
        .find(|row| {
            row.organization_id == organization_id
                && row.company_id == company_id
                && row.partner_id == partner_id
        })
        .ok_or("Vendor risk flag not found")?;
    row.reason = None;
    row.write_uid = ctx.sender();
    row.write_date = ctx.timestamp;
    ctx.db.vendor_risk_flag().id().update(row);
    Ok(())
}

#[reducer]
pub fn create_consignment_agreement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateConsignmentAgreementParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_advanced_company(ctx, organization_id, company_id)?;
    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    if params.product_id == 0 || params.warehouse_id == 0 {
        return Err("product_id and warehouse_id are required".to_string());
    }
    require_advanced_vendor(ctx, organization_id, company_id, params.partner_id)?;
    require_product_in_org(ctx, organization_id, params.product_id)?;
    require_warehouse_in_org_and_company(ctx, organization_id, company_id, params.warehouse_id)?;
    let row = ctx.db.consignment_agreement().insert(ConsignmentAgreement {
        id: 0,
        organization_id,
        company_id,
        name: params.name.trim().to_string(),
        partner_id: params.partner_id,
        product_id: params.product_id,
        warehouse_id: params.warehouse_id,
        state: "draft".to_string(),
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
            table_name: "consignment_agreement",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": row.name,
                    "partner_id": params.partner_id,
                    "product_id": params.product_id,
                    "warehouse_id": params.warehouse_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "partner_id".to_string(),
                "product_id".to_string(),
                "warehouse_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn set_purchase_approval_delegate(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SetPurchaseApprovalDelegateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_advanced_company(ctx, organization_id, company_id)?;
    require_organization_identity(
        ctx,
        organization_id,
        company_id,
        params.principal_identity,
        "principal",
    )?;
    require_organization_identity(
        ctx,
        organization_id,
        company_id,
        params.delegate_identity,
        "delegate",
    )?;
    if params.principal_identity == params.delegate_identity {
        return Err("principal and delegate must be different users".to_string());
    }

    let existing = ctx.db.purchase_approval_delegate().iter().find(|row| {
        row.organization_id == organization_id
            && row.company_id == company_id
            && row.principal_identity == params.principal_identity
    });

    if let Some(row) = existing {
        let record_id = row.id;
        ctx.db
            .purchase_approval_delegate()
            .id()
            .update(PurchaseApprovalDelegate {
                delegate_identity: params.delegate_identity,
                is_active: params.is_active,
                metadata: params.metadata.or(row.metadata.clone()),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..row
            });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "purchase_approval_delegate",
                record_id,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "is_active": params.is_active,
                    })
                    .to_string(),
                ),
                changed_fields: vec!["delegate_identity".to_string(), "is_active".to_string()],
                metadata: None,
            },
        );
    } else {
        let row = ctx
            .db
            .purchase_approval_delegate()
            .insert(PurchaseApprovalDelegate {
                id: 0,
                organization_id,
                company_id,
                principal_identity: params.principal_identity,
                delegate_identity: params.delegate_identity,
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
                table_name: "purchase_approval_delegate",
                record_id: row.id,
                action: "CREATE",
                old_values: None,
                new_values: Some(serde_json::json!({ "is_active": params.is_active }).to_string()),
                changed_fields: vec![
                    "principal_identity".to_string(),
                    "delegate_identity".to_string(),
                    "is_active".to_string(),
                ],
                metadata: None,
            },
        );
    }
    Ok(())
}

#[reducer]
pub fn set_commodity_price_index(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SetCommodityPriceIndexParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_advanced_company(ctx, organization_id, company_id)?;
    let code = params.code.trim().to_uppercase();
    if code.is_empty() {
        return Err("code is required".to_string());
    }
    if !params.rate.is_finite() || params.rate < 0.0 {
        return Err("rate must be a non-negative finite number".to_string());
    }

    let existing = ctx.db.commodity_price_index().iter().find(|row| {
        row.organization_id == organization_id && row.company_id == company_id && row.code == code
    });

    if let Some(row) = existing {
        let record_id = row.id;
        ctx.db
            .commodity_price_index()
            .id()
            .update(CommodityPriceIndex {
                rate: params.rate,
                as_of: params.as_of,
                metadata: params.metadata.or(row.metadata.clone()),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..row
            });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "commodity_price_index",
                record_id,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({ "code": code, "rate": params.rate }).to_string(),
                ),
                changed_fields: vec!["rate".to_string(), "as_of".to_string()],
                metadata: None,
            },
        );
    } else {
        let row = ctx.db.commodity_price_index().insert(CommodityPriceIndex {
            id: 0,
            organization_id,
            company_id,
            code: code.clone(),
            rate: params.rate,
            as_of: params.as_of,
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
                table_name: "commodity_price_index",
                record_id: row.id,
                action: "CREATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({ "code": code, "rate": params.rate }).to_string(),
                ),
                changed_fields: vec!["code".to_string(), "rate".to_string(), "as_of".to_string()],
                metadata: None,
            },
        );
    }
    Ok(())
}

#[reducer]
pub fn create_purchasing_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePurchasingIntegrationIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_advanced_company(ctx, organization_id, company_id)?;
    let provider = params.provider.trim().to_ascii_lowercase();
    let intent_type = params.intent_type.trim().to_ascii_lowercase();
    let idempotency_key = params.idempotency_key.trim().to_string();
    if provider.is_empty() || intent_type.is_empty() {
        return Err("provider and intent_type are required".to_string());
    }
    if idempotency_key.is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    if let Some(purchase_order_id) = params.purchase_order_id {
        require_scoped_purchase_order(ctx, organization_id, company_id, purchase_order_id)?;
    }
    let existing = ctx.db.purchasing_integration_intent().iter().find(|i| {
        i.organization_id == organization_id
            && i.company_id == company_id
            && i.provider == provider
            && i.intent_type == intent_type
            && i.idempotency_key == idempotency_key
    });
    if let Some(existing) = existing {
        if existing.purchase_order_id != params.purchase_order_id
            || existing.request_payload != params.request_payload
        {
            return Err("Idempotency tuple was already used with a different request".to_string());
        }
        return Ok(());
    }
    let row = ctx
        .db
        .purchasing_integration_intent()
        .insert(PurchasingIntegrationIntent {
            id: 0,
            organization_id,
            company_id,
            provider,
            intent_type,
            purchase_order_id: params.purchase_order_id,
            status: "pending".to_string(),
            idempotency_key,
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
            table_name: "purchasing_integration_intent",
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
pub fn record_purchasing_integration_result(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
    params: RecordPurchasingIntegrationResultParams,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "purchasing_integration_intent",
        "worker",
    )?;
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_advanced_company(ctx, organization_id, company_id)?;
    let intent = ctx
        .db
        .purchasing_integration_intent()
        .id()
        .find(&intent_id)
        .ok_or("Integration intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if let Some(purchase_order_id) = intent.purchase_order_id {
        require_scoped_purchase_order(ctx, organization_id, company_id, purchase_order_id)?;
    }
    let status = params.status.trim().to_ascii_lowercase();
    let allowed = ["pending", "succeeded", "failed", "cancelled"];
    if !allowed.contains(&status.as_str()) {
        return Err("Invalid integration result status".to_string());
    }
    if status == "succeeded"
        && params
            .external_reference
            .as_deref()
            .is_none_or(str::is_empty)
    {
        return Err("Successful integration results require an external reference".to_string());
    }
    if status == "failed" && params.last_error.as_deref().is_none_or(str::is_empty) {
        return Err("Failed integration results require last_error".to_string());
    }
    let transition_allowed = match (intent.status.as_str(), status.as_str()) {
        ("pending", "pending" | "succeeded" | "failed" | "cancelled") => true,
        ("failed", "pending" | "failed" | "succeeded" | "cancelled") => true,
        ("succeeded", "succeeded") | ("cancelled", "cancelled") => true,
        _ => false,
    };
    if !transition_allowed {
        return Err(format!(
            "Illegal integration transition from {} to {}",
            intent.status, status
        ));
    }
    if intent.status == status {
        return Ok(());
    }
    ctx.db
        .purchasing_integration_intent()
        .id()
        .update(PurchasingIntegrationIntent {
            status: status.clone(),
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
            table_name: "purchasing_integration_intent",
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
