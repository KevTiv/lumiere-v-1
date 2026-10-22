//! Durable identity for purchase-order creation.

use sha2::{Digest, Sha256};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::check_permission;
use crate::purchasing::purchase_orders::{
    create_purchase_order_record, purchase_order, CreatePurchaseOrderParams,
};

/// Immutable mapping from one scoped creation key to the exact purchase order.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = purchase_order_creation_operation,
    index(
        accessor = purchase_order_creation_operation_by_organization,
        btree(columns = [organization_id])
    ),
    index(
        accessor = purchase_order_creation_operation_by_scope,
        btree(columns = [organization_id, company_id])
    ),
    index(
        accessor = purchase_order_creation_operation_by_order,
        btree(columns = [purchase_order_id])
    )
)]
pub struct PurchaseOrderCreationOperation {
    #[primary_key]
    pub id: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub operation_key: String,
    pub purchase_order_id: u64,
    /// SHA-256 of the complete immutable creation request.
    pub payload_hash: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

/// Purchase-order input for the keyed create operation.
///
/// `company_id` is an explicit reducer argument. It is not duplicated here.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseOrderOnceParams {
    pub operation_key: String,
    pub partner_id: u64,
    pub currency_id: u64,
    pub origin: Option<String>,
    pub partner_ref: Option<String>,
    pub notes: Option<String>,
    pub date_planned: Option<Timestamp>,
    pub payment_term_id: Option<u64>,
    pub fiscal_position_id: Option<u64>,
    pub incoterm_id: Option<u64>,
    pub incoterm_location: Option<String>,
    pub is_quantity_copy: Option<String>,
    pub metadata: Option<String>,
}

fn scoped_creation_id(
    organization_id: u64,
    company_id: u64,
    operation_key: &str,
) -> Result<String, String> {
    if operation_key.is_empty()
        || operation_key.len() > 128
        || !operation_key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(
            "purchase order creation key must be 1–128 ASCII letters, digits, hyphens or underscores"
                .into(),
        );
    }
    Ok(format!("{organization_id}:{company_id}:{operation_key}"))
}

fn creation_payload_hash(
    organization_id: u64,
    company_id: u64,
    params: &CreatePurchaseOrderOnceParams,
) -> String {
    let payload = serde_json::json!({
        "organization_id": organization_id,
        "company_id": company_id,
        "partner_id": params.partner_id,
        "currency_id": params.currency_id,
        "origin": params.origin,
        "partner_ref": params.partner_ref,
        "notes": params.notes,
        "date_planned_micros": params
            .date_planned
            .map(|timestamp| timestamp.to_micros_since_unix_epoch()),
        "payment_term_id": params.payment_term_id,
        "fiscal_position_id": params.fiscal_position_id,
        "incoterm_id": params.incoterm_id,
        "incoterm_location": params.incoterm_location,
        "is_quantity_copy": params.is_quantity_copy.as_deref().unwrap_or("none"),
        "metadata": params.metadata,
    });
    let canonical =
        serde_json::to_vec(&payload).expect("purchase order input is JSON serializable");
    format!("sha256:{:x}", Sha256::digest(canonical))
}

fn into_order_params(
    company_id: u64,
    params: CreatePurchaseOrderOnceParams,
) -> (String, CreatePurchaseOrderParams) {
    let CreatePurchaseOrderOnceParams {
        operation_key,
        partner_id,
        currency_id,
        origin,
        partner_ref,
        notes,
        date_planned,
        payment_term_id,
        fiscal_position_id,
        incoterm_id,
        incoterm_location,
        is_quantity_copy,
        metadata,
    } = params;
    (
        operation_key,
        CreatePurchaseOrderParams {
            company_id: Some(company_id),
            partner_id,
            currency_id,
            origin,
            partner_ref,
            notes,
            date_planned,
            payment_term_id,
            fiscal_position_id,
            incoterm_id,
            incoterm_location,
            user_id: None,
            invoice_ids: Vec::new(),
            picking_ids: Vec::new(),
            message_follower_ids: Vec::new(),
            message_ids: Vec::new(),
            activity_ids: Vec::new(),
            is_quantity_copy,
            metadata,
        },
    )
}

/// Create one purchase order for a scoped operation key.
///
/// An identical replay returns the original relation without creating another
/// order. Reusing the key with a different actor or payload fails closed.
#[spacetimedb::reducer]
pub fn create_purchase_order_once(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePurchaseOrderOnceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;
    crate::workflow::authorization::require_workflow_company_access(
        ctx,
        organization_id,
        company_id,
        ctx.sender(),
    )?;

    let id = scoped_creation_id(organization_id, company_id, &params.operation_key)?;
    let payload_hash = creation_payload_hash(organization_id, company_id, &params);
    if let Some(existing) = ctx.db.purchase_order_creation_operation().id().find(&id) {
        if existing.organization_id != organization_id
            || existing.company_id != company_id
            || existing.created_by != ctx.sender()
            || existing.payload_hash != payload_hash
        {
            return Err(
                "purchase order creation key was already used by another actor or with different input"
                    .into(),
            );
        }
        let order = ctx
            .db
            .purchase_order()
            .id()
            .find(&existing.purchase_order_id)
            .ok_or("purchase order creation result is unavailable")?;
        if order.organization_id != organization_id || order.company_id != company_id {
            return Err("purchase order creation result is outside current scope".into());
        }
        return Ok(());
    }

    let (operation_key, order_params) = into_order_params(company_id, params);
    let purchase_order_id = create_purchase_order_record(ctx, organization_id, order_params)?;
    ctx.db
        .purchase_order_creation_operation()
        .insert(PurchaseOrderCreationOperation {
            id,
            organization_id,
            company_id,
            operation_key,
            purchase_order_id,
            payload_hash,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
    Ok(())
}
