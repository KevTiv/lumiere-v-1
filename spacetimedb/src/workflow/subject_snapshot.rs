//! Requester-scoped workflow subject snapshots for browser workflow commands.
//!
//! The browser cannot read arbitrary SpacetimeDB rows or compute an accepted
//! workflow revision hash. This module keeps both operations server-owned: a
//! closed adapter reads one supported ERP row, converts only version-pinned
//! fields, and hashes the typed snapshot with the canonical evaluator helper.

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::{account_move, AccountMove};
use crate::accounting::payments::{account_payment, AccountPayment};
use crate::core::organization::require_company_in_organization;
use crate::core::reference::{require_currency_by_id, Currency};
use crate::helpers::check_permission;
use crate::inventory::stock::{stock_picking, StockPicking};
use crate::purchasing::purchase_orders::{purchase_order, PurchaseOrder};
use crate::sales::sales_core::{sale_order, SaleOrder};
use crate::workflow::definitions::{
    workflow, workflow_version, ConditionFieldDefinition, ConditionValue, FixedPointDecimal,
    MoneyValue, WorkflowVersionStatus,
};
use crate::workflow::evaluator::{
    canonical_condition_snapshot_hash, validate_condition_snapshot, ConditionSnapshot,
    ConditionSnapshotField,
};

const DECIMAL_SCALE: u32 = 6;
const MICROS_PER_DAY: i64 = 86_400_000_000;

/// Input for one requester-scoped workflow subject snapshot refresh.
#[derive(SpacetimeType, Clone, Debug)]
pub struct RequestWorkflowSubjectSnapshotParams {
    pub subject_model: String,
    pub subject_id: u64,
    pub workflow_version_id: u64,
}

/// Latest canonical snapshot for one requester and workflow subject/version.
#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = workflow_subject_snapshot,
    index(
        accessor = workflow_subject_snapshot_by_organization,
        btree(columns = [organization_id])
    ),
    index(
        accessor = workflow_subject_snapshot_by_company,
        btree(columns = [company_id])
    ),
    index(
        accessor = workflow_subject_snapshot_by_requester,
        btree(columns = [requested_by])
    )
)]
pub struct WorkflowSubjectSnapshot {
    #[primary_key]
    pub id: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub subject_model: String,
    pub subject_id: u64,
    pub workflow_version_id: u64,
    pub subject_revision_hash: String,
    pub fields: Vec<ConditionSnapshotField>,
    pub requested_by: Identity,
    pub requested_at: Timestamp,
}

#[derive(Clone, Debug)]
pub(crate) struct SnapshotCurrency {
    pub(crate) code: String,
    pub(crate) decimal_places: u8,
}

/// Typed input to the pure snapshot builder.
#[derive(Clone, Debug)]
pub(crate) enum WorkflowSubjectSnapshotRow {
    SaleOrder {
        id: u64,
        organization_id: u64,
        company_id: u64,
        state: String,
        reference: Option<String>,
        amount_total: f64,
        currency: SnapshotCurrency,
        date_order_micros: i64,
        validity_date_micros: Option<i64>,
        is_locked: bool,
        currency_rate: f64,
    },
    PurchaseOrder {
        id: u64,
        organization_id: u64,
        company_id: u64,
        state: String,
        name: Option<String>,
        amount_total: f64,
        currency: SnapshotCurrency,
        date_order_micros: i64,
        date_planned_micros: Option<i64>,
        is_locked: bool,
        receipt_status: String,
        currency_rate: f64,
    },
    AccountMove {
        id: u64,
        organization_id: u64,
        company_id: u64,
        state: String,
        name: String,
        move_type: String,
        amount_total: f64,
        currency: SnapshotCurrency,
        date_micros: i64,
        invoice_date_micros: Option<i64>,
        to_check: bool,
        posted_before: bool,
    },
    AccountPayment {
        id: u64,
        organization_id: u64,
        company_id: u64,
        state: String,
        name: Option<String>,
        payment_type: String,
        partner_type: String,
        amount: f64,
        currency: SnapshotCurrency,
        date_micros: i64,
        reference: Option<String>,
    },
    StockPicking {
        id: u64,
        organization_id: u64,
        company_id: u64,
        state: String,
        name: String,
        origin: Option<String>,
        priority: String,
        scheduled_date_micros: Option<i64>,
        date_done_micros: Option<i64>,
        is_locked: bool,
        is_return: bool,
        move_type: String,
        picking_code: Option<String>,
        created_at_micros: i64,
        updated_at_micros: i64,
    },
}

impl WorkflowSubjectSnapshotRow {
    fn model(&self) -> &'static str {
        match self {
            Self::SaleOrder { .. } => "sale_order",
            Self::PurchaseOrder { .. } => "purchase_order",
            Self::AccountMove { .. } => "account_move",
            Self::AccountPayment { .. } => "account_payment",
            Self::StockPicking { .. } => "stock_picking",
        }
    }

    fn id(&self) -> u64 {
        match self {
            Self::SaleOrder { id, .. }
            | Self::PurchaseOrder { id, .. }
            | Self::AccountMove { id, .. }
            | Self::AccountPayment { id, .. }
            | Self::StockPicking { id, .. } => *id,
        }
    }
}

/// Refresh the caller's canonical snapshot for one supported subject.
#[reducer]
pub fn request_workflow_subject_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RequestWorkflowSubjectSnapshotParams,
) -> Result<(), String> {
    ensure_supported_model(&params.subject_model)?;
    require_snapshot_command_permission(ctx, organization_id)?;
    check_permission(ctx, organization_id, &params.subject_model, "read")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    let version = ctx
        .db
        .workflow_version()
        .id()
        .find(&params.workflow_version_id)
        .ok_or("workflow version not found")?;
    if version.organization_id != organization_id
        || version.company_id.is_some_and(|id| id != company_id)
    {
        return Err("workflow version does not belong to this organization/company".to_string());
    }
    if version.status == WorkflowVersionStatus::Draft {
        return Err(
            "workflow subject snapshots require a published or retired version".to_string(),
        );
    }
    let definition = ctx
        .db
        .workflow()
        .id()
        .find(&version.workflow_id)
        .ok_or("workflow not found")?;
    if definition.organization_id != organization_id
        || definition.company_id.is_some_and(|id| id != company_id)
    {
        return Err("workflow does not belong to this organization/company".to_string());
    }
    if definition.model != params.subject_model {
        return Err("workflow model does not match subject model".to_string());
    }

    let row = load_subject_row(
        ctx,
        organization_id,
        company_id,
        &params.subject_model,
        params.subject_id,
    )?;
    let snapshot = build_condition_snapshot(
        &params.subject_model,
        params.subject_id,
        &row,
        &version.snapshot_fields,
    )?;
    let requested_by = ctx.sender();
    let id = snapshot_scope_id(
        requested_by,
        organization_id,
        company_id,
        &params.subject_model,
        params.subject_id,
        params.workflow_version_id,
    );
    let next = WorkflowSubjectSnapshot {
        id: id.clone(),
        organization_id,
        company_id,
        subject_model: snapshot.subject_model,
        subject_id: snapshot.subject_id,
        workflow_version_id: params.workflow_version_id,
        subject_revision_hash: snapshot.subject_revision_hash,
        fields: snapshot.fields,
        requested_by,
        requested_at: ctx.timestamp,
    };

    if let Some(existing) = ctx.db.workflow_subject_snapshot().id().find(&id) {
        if existing.organization_id != organization_id
            || existing.company_id != company_id
            || existing.subject_model != next.subject_model
            || existing.subject_id != next.subject_id
            || existing.workflow_version_id != next.workflow_version_id
            || existing.requested_by != next.requested_by
        {
            return Err("workflow subject snapshot scope-key collision".to_string());
        }
        if existing.subject_revision_hash == next.subject_revision_hash
            && existing.fields == next.fields
        {
            return Ok(());
        }
        ctx.db.workflow_subject_snapshot().id().update(next);
    } else {
        ctx.db.workflow_subject_snapshot().insert(next);
    }
    Ok(())
}

/// Build and hash one allowlisted snapshot without database access.
pub(crate) fn build_condition_snapshot(
    model: &str,
    subject_id: u64,
    row: &WorkflowSubjectSnapshotRow,
    allowlist: &[ConditionFieldDefinition],
) -> Result<ConditionSnapshot, String> {
    ensure_supported_model(model)?;
    if row.model() != model {
        return Err(format!(
            "snapshot row model '{}' does not match model '{model}'",
            row.model()
        ));
    }
    if row.id() != subject_id {
        return Err("snapshot row does not match subject id".to_string());
    }

    let available = mapped_fields(row)?;
    let mut fields = Vec::with_capacity(allowlist.len());
    for definition in allowlist {
        let value = available
            .get(definition.field_key.as_str())
            .ok_or_else(|| {
                format!(
                    "field_key '{}' not available for model {model}",
                    definition.field_key
                )
            })?;
        fields.push(ConditionSnapshotField {
            field_key: definition.field_key.clone(),
            value: value.clone(),
        });
    }

    let mut snapshot = ConditionSnapshot {
        subject_model: model.to_string(),
        subject_id,
        subject_revision_hash: String::new(),
        fields,
    };
    validate_condition_snapshot(allowlist, &snapshot)
        .map_err(|error| format!("condition snapshot is invalid: {error}"))?;
    snapshot.subject_revision_hash = canonical_condition_snapshot_hash(&snapshot)
        .map_err(|error| format!("condition snapshot is invalid: {error}"))?;
    Ok(snapshot)
}

fn ensure_supported_model(model: &str) -> Result<(), String> {
    match model {
        "sale_order" | "purchase_order" | "account_move" | "account_payment" | "stock_picking" => {
            Ok(())
        }
        _ => Err(format!("no snapshot adapter for model {model}")),
    }
}

fn require_snapshot_command_permission(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    if check_permission(ctx, organization_id, "workflow_instance", "create").is_ok() {
        return Ok(());
    }
    check_permission(ctx, organization_id, "workflow_instance", "write").map_err(|_| {
        "Permission denied: create or write on workflow_instance is required".to_string()
    })
}

fn load_subject_row(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    model: &str,
    subject_id: u64,
) -> Result<WorkflowSubjectSnapshotRow, String> {
    match model {
        "sale_order" => {
            let row = ctx
                .db
                .sale_order()
                .id()
                .find(&subject_id)
                .ok_or("sale order not found")?;
            require_row_scope(
                "sale order",
                row.organization_id,
                row.company_id,
                organization_id,
                company_id,
            )?;
            sale_order_row(ctx, organization_id, row)
        }
        "purchase_order" => {
            let row = ctx
                .db
                .purchase_order()
                .id()
                .find(&subject_id)
                .ok_or("purchase order not found")?;
            require_row_scope(
                "purchase order",
                row.organization_id,
                row.company_id,
                organization_id,
                company_id,
            )?;
            purchase_order_row(ctx, organization_id, row)
        }
        "account_move" => {
            let row = ctx
                .db
                .account_move()
                .id()
                .find(&subject_id)
                .ok_or("account move not found")?;
            require_row_scope(
                "account move",
                row.organization_id,
                row.company_id,
                organization_id,
                company_id,
            )?;
            account_move_row(ctx, organization_id, row)
        }
        "account_payment" => {
            let row = ctx
                .db
                .account_payment()
                .id()
                .find(&subject_id)
                .ok_or("account payment not found")?;
            require_row_scope(
                "account payment",
                row.organization_id,
                row.company_id,
                organization_id,
                company_id,
            )?;
            account_payment_row(ctx, organization_id, row)
        }
        "stock_picking" => {
            let row = ctx
                .db
                .stock_picking()
                .id()
                .find(&subject_id)
                .ok_or("stock picking not found")?;
            require_row_scope(
                "stock picking",
                row.organization_id,
                row.company_id,
                organization_id,
                company_id,
            )?;
            Ok(stock_picking_row(row))
        }
        _ => Err(format!("no snapshot adapter for model {model}")),
    }
}

fn require_row_scope(
    label: &str,
    row_organization_id: u64,
    row_company_id: u64,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    if row_organization_id != organization_id || row_company_id != company_id {
        return Err(format!(
            "{label} does not belong to this organization/company"
        ));
    }
    Ok(())
}

fn snapshot_currency(
    ctx: &ReducerContext,
    organization_id: u64,
    currency_id: u64,
) -> Result<SnapshotCurrency, String> {
    let currency = require_currency_by_id(ctx, currency_id)?;
    if currency.organization_id != organization_id {
        return Err("subject currency does not belong to this organization".to_string());
    }
    Ok(currency_snapshot(&currency))
}

fn currency_snapshot(currency: &Currency) -> SnapshotCurrency {
    SnapshotCurrency {
        code: currency.code.clone(),
        decimal_places: currency.decimal_places,
    }
}

fn sale_order_row(
    ctx: &ReducerContext,
    organization_id: u64,
    row: SaleOrder,
) -> Result<WorkflowSubjectSnapshotRow, String> {
    Ok(WorkflowSubjectSnapshotRow::SaleOrder {
        id: row.id,
        organization_id: row.organization_id,
        company_id: row.company_id,
        state: format!("{:?}", row.state),
        reference: row.reference,
        amount_total: row.amount_total,
        currency: snapshot_currency(ctx, organization_id, row.currency_id)?,
        date_order_micros: row.date_order.to_micros_since_unix_epoch(),
        validity_date_micros: row.validity_date.map(Timestamp::to_micros_since_unix_epoch),
        is_locked: row.is_locked,
        currency_rate: row.currency_rate,
    })
}

fn purchase_order_row(
    ctx: &ReducerContext,
    organization_id: u64,
    row: PurchaseOrder,
) -> Result<WorkflowSubjectSnapshotRow, String> {
    Ok(WorkflowSubjectSnapshotRow::PurchaseOrder {
        id: row.id,
        organization_id: row.organization_id,
        company_id: row.company_id,
        state: format!("{:?}", row.state),
        name: row.name,
        amount_total: row.amount_total,
        currency: snapshot_currency(ctx, organization_id, row.currency_id)?,
        date_order_micros: row.date_order.to_micros_since_unix_epoch(),
        date_planned_micros: row.date_planned.map(Timestamp::to_micros_since_unix_epoch),
        is_locked: row.is_locked,
        receipt_status: row.receipt_status,
        currency_rate: row.currency_rate,
    })
}

fn account_move_row(
    ctx: &ReducerContext,
    organization_id: u64,
    row: AccountMove,
) -> Result<WorkflowSubjectSnapshotRow, String> {
    Ok(WorkflowSubjectSnapshotRow::AccountMove {
        id: row.id,
        organization_id: row.organization_id,
        company_id: row.company_id,
        state: format!("{:?}", row.state),
        name: row.name,
        move_type: format!("{:?}", row.move_type),
        amount_total: row.amount_total,
        currency: snapshot_currency(ctx, organization_id, row.currency_id)?,
        date_micros: row.date.to_micros_since_unix_epoch(),
        invoice_date_micros: row.invoice_date.map(Timestamp::to_micros_since_unix_epoch),
        to_check: row.to_check,
        posted_before: row.posted_before,
    })
}

fn account_payment_row(
    ctx: &ReducerContext,
    organization_id: u64,
    row: AccountPayment,
) -> Result<WorkflowSubjectSnapshotRow, String> {
    Ok(WorkflowSubjectSnapshotRow::AccountPayment {
        id: row.id,
        organization_id: row.organization_id,
        company_id: row.company_id,
        state: format!("{:?}", row.state),
        name: row.name,
        payment_type: format!("{:?}", row.payment_type),
        partner_type: format!("{:?}", row.partner_type),
        amount: row.amount,
        currency: snapshot_currency(ctx, organization_id, row.currency_id)?,
        date_micros: row.date.to_micros_since_unix_epoch(),
        reference: row.ref_,
    })
}

fn stock_picking_row(row: StockPicking) -> WorkflowSubjectSnapshotRow {
    WorkflowSubjectSnapshotRow::StockPicking {
        id: row.id,
        organization_id: row.organization_id,
        company_id: row.company_id,
        state: row.state,
        name: row.name,
        origin: row.origin,
        priority: row.priority,
        scheduled_date_micros: row
            .scheduled_date
            .map(Timestamp::to_micros_since_unix_epoch),
        date_done_micros: row.date_done.map(Timestamp::to_micros_since_unix_epoch),
        is_locked: row.is_locked,
        is_return: row.is_return,
        move_type: row.move_type,
        picking_code: row.picking_code,
        created_at_micros: row.created_at.to_micros_since_unix_epoch(),
        updated_at_micros: row.updated_at.to_micros_since_unix_epoch(),
    }
}

fn mapped_fields(
    row: &WorkflowSubjectSnapshotRow,
) -> Result<BTreeMap<&'static str, ConditionValue>, String> {
    match row {
        WorkflowSubjectSnapshotRow::SaleOrder {
            id,
            organization_id,
            company_id,
            state,
            reference,
            amount_total,
            currency,
            date_order_micros,
            validity_date_micros,
            is_locked,
            currency_rate,
        } => fields([
            ("id", integer(*id, "sale_order.id")?),
            (
                "organization_id",
                integer(*organization_id, "sale_order.organization_id")?,
            ),
            ("company_id", integer(*company_id, "sale_order.company_id")?),
            ("state", ConditionValue::Code(state.clone())),
            ("reference", nullable_text(reference.as_deref())),
            (
                "amount_total",
                ConditionValue::Money(money(*amount_total, currency, "sale_order.amount_total")?),
            ),
            ("date_order", ConditionValue::Timestamp(*date_order_micros)),
            ("validity_date", nullable_date(*validity_date_micros)?),
            ("is_locked", ConditionValue::Boolean(*is_locked)),
            (
                "currency_rate",
                ConditionValue::Decimal(decimal(
                    *currency_rate,
                    DECIMAL_SCALE,
                    "sale_order.currency_rate",
                )?),
            ),
        ]),
        WorkflowSubjectSnapshotRow::PurchaseOrder {
            id,
            organization_id,
            company_id,
            state,
            name,
            amount_total,
            currency,
            date_order_micros,
            date_planned_micros,
            is_locked,
            receipt_status,
            currency_rate,
        } => fields([
            ("id", integer(*id, "purchase_order.id")?),
            (
                "organization_id",
                integer(*organization_id, "purchase_order.organization_id")?,
            ),
            (
                "company_id",
                integer(*company_id, "purchase_order.company_id")?,
            ),
            ("state", ConditionValue::Code(state.clone())),
            ("name", nullable_text(name.as_deref())),
            (
                "amount_total",
                ConditionValue::Money(money(
                    *amount_total,
                    currency,
                    "purchase_order.amount_total",
                )?),
            ),
            ("date_order", ConditionValue::Timestamp(*date_order_micros)),
            ("date_planned", nullable_date(*date_planned_micros)?),
            ("is_locked", ConditionValue::Boolean(*is_locked)),
            (
                "receipt_status",
                ConditionValue::Code(receipt_status.clone()),
            ),
            (
                "currency_rate",
                ConditionValue::Decimal(decimal(
                    *currency_rate,
                    DECIMAL_SCALE,
                    "purchase_order.currency_rate",
                )?),
            ),
        ]),
        WorkflowSubjectSnapshotRow::AccountMove {
            id,
            organization_id,
            company_id,
            state,
            name,
            move_type,
            amount_total,
            currency,
            date_micros,
            invoice_date_micros,
            to_check,
            posted_before,
        } => fields([
            ("id", integer(*id, "account_move.id")?),
            (
                "organization_id",
                integer(*organization_id, "account_move.organization_id")?,
            ),
            (
                "company_id",
                integer(*company_id, "account_move.company_id")?,
            ),
            ("state", ConditionValue::Code(state.clone())),
            ("name", ConditionValue::Text(name.clone())),
            ("move_type", ConditionValue::Code(move_type.clone())),
            (
                "amount_total",
                ConditionValue::Money(money(*amount_total, currency, "account_move.amount_total")?),
            ),
            ("date", ConditionValue::Date(date(*date_micros)?)),
            ("invoice_date", nullable_date(*invoice_date_micros)?),
            ("to_check", ConditionValue::Boolean(*to_check)),
            ("posted_before", ConditionValue::Boolean(*posted_before)),
        ]),
        WorkflowSubjectSnapshotRow::AccountPayment {
            id,
            organization_id,
            company_id,
            state,
            name,
            payment_type,
            partner_type,
            amount,
            currency,
            date_micros,
            reference,
        } => fields([
            ("id", integer(*id, "account_payment.id")?),
            (
                "organization_id",
                integer(*organization_id, "account_payment.organization_id")?,
            ),
            (
                "company_id",
                integer(*company_id, "account_payment.company_id")?,
            ),
            ("state", ConditionValue::Code(state.clone())),
            ("name", nullable_text(name.as_deref())),
            ("payment_type", ConditionValue::Code(payment_type.clone())),
            ("partner_type", ConditionValue::Code(partner_type.clone())),
            (
                "amount",
                ConditionValue::Money(money(*amount, currency, "account_payment.amount")?),
            ),
            ("date", ConditionValue::Date(date(*date_micros)?)),
            ("ref", nullable_text(reference.as_deref())),
        ]),
        WorkflowSubjectSnapshotRow::StockPicking {
            id,
            organization_id,
            company_id,
            state,
            name,
            origin,
            priority,
            scheduled_date_micros,
            date_done_micros,
            is_locked,
            is_return,
            move_type,
            picking_code,
            created_at_micros,
            updated_at_micros,
        } => fields([
            ("id", integer(*id, "stock_picking.id")?),
            (
                "organization_id",
                integer(*organization_id, "stock_picking.organization_id")?,
            ),
            (
                "company_id",
                integer(*company_id, "stock_picking.company_id")?,
            ),
            ("state", ConditionValue::Code(state.clone())),
            ("name", ConditionValue::Text(name.clone())),
            ("origin", nullable_text(origin.as_deref())),
            ("priority", ConditionValue::Code(priority.clone())),
            ("scheduled_date", nullable_timestamp(*scheduled_date_micros)),
            ("date_done", nullable_timestamp(*date_done_micros)),
            ("is_locked", ConditionValue::Boolean(*is_locked)),
            ("is_return", ConditionValue::Boolean(*is_return)),
            ("move_type", ConditionValue::Code(move_type.clone())),
            ("picking_code", nullable_code(picking_code.as_deref())),
            ("created_at", ConditionValue::Timestamp(*created_at_micros)),
            ("updated_at", ConditionValue::Timestamp(*updated_at_micros)),
        ]),
    }
}

fn fields<const N: usize>(
    entries: [(&'static str, ConditionValue); N],
) -> Result<BTreeMap<&'static str, ConditionValue>, String> {
    let fields: BTreeMap<_, _> = entries.into_iter().collect();
    if fields.len() != N {
        return Err("snapshot adapter contains duplicate field keys".to_string());
    }
    Ok(fields)
}

fn integer(value: u64, label: &str) -> Result<ConditionValue, String> {
    i64::try_from(value)
        .map(ConditionValue::Integer)
        .map_err(|_| format!("{label} is outside workflow integer range"))
}

fn nullable_text(value: Option<&str>) -> ConditionValue {
    value.map_or(ConditionValue::Null, |value| {
        ConditionValue::Text(value.to_string())
    })
}

fn nullable_code(value: Option<&str>) -> ConditionValue {
    value.map_or(ConditionValue::Null, |value| {
        ConditionValue::Code(value.to_string())
    })
}

fn nullable_timestamp(value: Option<i64>) -> ConditionValue {
    value.map_or(ConditionValue::Null, ConditionValue::Timestamp)
}

fn nullable_date(value: Option<i64>) -> Result<ConditionValue, String> {
    value
        .map(date)
        .transpose()
        .map(|value| value.map_or(ConditionValue::Null, ConditionValue::Date))
}

fn date(timestamp_micros: i64) -> Result<i32, String> {
    let days = timestamp_micros.div_euclid(MICROS_PER_DAY);
    i32::try_from(days).map_err(|_| "workflow date is outside supported range".to_string())
}

fn money(value: f64, currency: &SnapshotCurrency, label: &str) -> Result<MoneyValue, String> {
    if currency.code.len() != 3
        || !currency
            .code
            .chars()
            .all(|character| character.is_ascii_uppercase())
    {
        return Err(format!(
            "{label} currency must be a three-letter uppercase code"
        ));
    }
    Ok(MoneyValue {
        minor_units: exact_scaled_integer(value, u32::from(currency.decimal_places), label)?,
        currency: currency.code.clone(),
    })
}

fn decimal(value: f64, scale: u32, label: &str) -> Result<FixedPointDecimal, String> {
    Ok(FixedPointDecimal {
        coefficient: exact_scaled_integer(value, scale, label)?,
        scale,
    })
}

fn exact_scaled_integer(value: f64, scale: u32, label: &str) -> Result<i64, String> {
    if !value.is_finite() {
        return Err(format!("{label} must be finite"));
    }
    let multiplier = 10_u64
        .checked_pow(scale)
        .ok_or_else(|| format!("{label} scale is outside fixed-point range"))?;
    let scaled = value * multiplier as f64;
    if scaled < i64::MIN as f64 || scaled > i64::MAX as f64 {
        return Err(format!("{label} is outside fixed-point range"));
    }
    let rounded = scaled.round();
    let tolerance = f64::EPSILON * scaled.abs().max(1.0) * 4.0;
    if (scaled - rounded).abs() > tolerance {
        return Err(format!("{label} is not exact at scale {scale}"));
    }
    Ok(rounded as i64)
}

fn snapshot_scope_id(
    requester: Identity,
    organization_id: u64,
    company_id: u64,
    subject_model: &str,
    subject_id: u64,
    workflow_version_id: u64,
) -> String {
    let mut hasher = Sha256::new();
    hash_key_string(&mut hasher, &requester.to_hex().to_string());
    hasher.update(organization_id.to_be_bytes());
    hasher.update(company_id.to_be_bytes());
    hash_key_string(&mut hasher, subject_model);
    hasher.update(subject_id.to_be_bytes());
    hasher.update(workflow_version_id.to_be_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

fn hash_key_string(hasher: &mut Sha256, value: &str) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value.as_bytes());
}
