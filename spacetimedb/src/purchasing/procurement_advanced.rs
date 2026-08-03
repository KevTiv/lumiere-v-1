//! Differentiating purchasing capabilities (MVP depth):
//! blanket orders / contracts, vendor scorecards + risk,
//! consignment agreements, approval delegates, commodity index hooks,
//! and customs / e-invoice integration intent/result tracking.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::purchasing::purchase_orders::{
    create_purchase_order, purchase_order, CreatePurchaseOrderParams,
};

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
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReleaseBlanketToPoParams {
    pub notes: Option<String>,
    pub date_planned: Option<Timestamp>,
    pub metadata: Option<String>,
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

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_purchase_blanket_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePurchaseBlanketOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;
    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    let _company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;
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
    let blanket = ctx
        .db
        .purchase_blanket_order()
        .id()
        .find(&blanket_order_id)
        .ok_or("Blanket order not found")?;
    if blanket.organization_id != organization_id || blanket.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
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
            notes: params.notes,
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
            metadata: Some(params.metadata.unwrap_or_else(|| {
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
    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
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
    if params.risk_level.trim().is_empty() {
        return Err("risk_level is required".to_string());
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
            risk_level: params.risk_level.clone(),
            reason: params.reason.clone(),
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
                        "risk_level": params.risk_level,
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
            risk_level: params.risk_level.clone(),
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
                        "risk_level": params.risk_level,
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

#[reducer]
pub fn create_consignment_agreement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateConsignmentAgreementParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;
    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    if params.product_id == 0 || params.warehouse_id == 0 {
        return Err("product_id and warehouse_id are required".to_string());
    }
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
    if params.idempotency_key.trim().is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    let existing = ctx.db.purchasing_integration_intent().iter().find(|i| {
        i.organization_id == organization_id && i.idempotency_key == params.idempotency_key
    });
    if existing.is_some() {
        return Ok(());
    }
    let row = ctx
        .db
        .purchasing_integration_intent()
        .insert(PurchasingIntegrationIntent {
            id: 0,
            organization_id,
            company_id,
            provider: params.provider,
            intent_type: params.intent_type,
            purchase_order_id: params.purchase_order_id,
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
    check_permission(ctx, organization_id, "purchase_order", "write")?;
    let intent = ctx
        .db
        .purchasing_integration_intent()
        .id()
        .find(&intent_id)
        .ok_or("Integration intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    ctx.db
        .purchasing_integration_intent()
        .id()
        .update(PurchasingIntegrationIntent {
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
            table_name: "purchasing_integration_intent",
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
