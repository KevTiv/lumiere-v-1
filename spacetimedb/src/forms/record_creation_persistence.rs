//! Exact complete-row durable capture for the admitted create owners.
use super::record_creation::record_creation_receipt;
use crate::core::audit::audit_log;
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::core::reference::document_sequence;
use crate::crm::contacts::contact;
use crate::crm::leads::lead;
use crate::crm::opportunities::opportunity;
use crate::forms::record_custom_field_value;
use crate::sales::sales_core::{sale_order, sale_order_line};
use spacetimedb::{ReducerContext, Table};

fn append_custom_values_and_audits(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    model: &str,
    record_id: u64,
    changes: &mut Vec<RowChange>,
) -> Result<(), String> {
    let mut values: Vec<_> = ctx
        .db
        .record_custom_field_value()
        .record_custom_field_by_org_company_record()
        .filter((&organization_id, &company_id, &record_id))
        .filter(|row| row.model == model)
        .collect();
    values.sort_by_key(|row| row.id);
    for row in values {
        changes.push(RowChange::upsert_stdb_row(
            "record_custom_field_value",
            serde_json::json!({"id":row.id}),
            &row,
        )?);
    }
    let audit_model = if model == "crm_lead" { "lead" } else { model };
    let mut audits: Vec<_> = ctx
        .db
        .audit_log()
        .iter()
        .filter(|row| {
            row.organization_id == organization_id
                && row.record_id == record_id
                && row.user_identity == ctx.sender()
                && row.timestamp == ctx.timestamp
                && (row.table_name == audit_model
                    || (row.table_name == "record_custom_field_value"
                        && row.company_id == Some(company_id)
                        && row
                            .new_values
                            .as_deref()
                            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
                            .is_some_and(|value| {
                                value.get("model").and_then(|model| model.as_str()) == Some(model)
                            })))
        })
        .collect();
    audits.sort_by_key(|row| row.id);
    for row in audits {
        changes.push(RowChange::upsert_stdb_row(
            "audit_log",
            serde_json::json!({"id":row.id}),
            &row,
        )?);
    }
    Ok(())
}

fn append_creation_receipt(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    model: &str,
    record_id: u64,
    receipt_id: &str,
    changes: &mut Vec<RowChange>,
) -> Result<(), String> {
    let row = ctx
        .db
        .record_creation_receipt()
        .id()
        .find(receipt_id)
        .ok_or("creation receipt disappeared before durable capture")?;
    if row.organization_id != organization_id
        || row.company_id != company_id
        || row.model != model
        || row.record_id != record_id
        || row.created_by != ctx.sender()
    {
        return Err("creation receipt does not match durable capture scope".into());
    }
    changes.push(RowChange::upsert_stdb_row(
        "record_creation_receipt",
        serde_json::json!({"id":row.id}),
        &row,
    )?);
    Ok(())
}

fn append_sequence(
    ctx: &ReducerContext,
    organization_id: u64,
    kind: &str,
    changes: &mut Vec<RowChange>,
) -> Result<(), String> {
    let key = format!("{organization_id}:{kind}");
    let row = ctx
        .db
        .document_sequence()
        .sequence_key()
        .find(&key)
        .ok_or("creation document sequence missing")?;
    changes.push(RowChange::upsert_stdb_row(
        "document_sequence",
        serde_json::json!({"sequence_key":row.sequence_key}),
        &row,
    )?);
    Ok(())
}

pub(crate) fn record_lead_creation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    record_id: u64,
    receipt_id: &str,
) -> Result<(), String> {
    let row = ctx
        .db
        .lead()
        .id()
        .find(&record_id)
        .ok_or("created lead missing")?;
    if row.organization_id != organization_id {
        return Err("created lead scope mismatch".into());
    }
    let mut changes = vec![RowChange::upsert_stdb_row(
        "lead",
        serde_json::json!({"id":record_id}),
        &row,
    )?];
    append_custom_values_and_audits(
        ctx,
        organization_id,
        company_id,
        "crm_lead",
        record_id,
        &mut changes,
    )?;
    append_creation_receipt(
        ctx,
        organization_id,
        company_id,
        "crm_lead",
        record_id,
        receipt_id,
        &mut changes,
    )?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.create_lead".into(),
            correlation_id: receipt_id.into(),
            changes,
        },
    )?;
    Ok(())
}

pub(crate) fn record_contact_creation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    record_id: u64,
    receipt_id: &str,
) -> Result<(), String> {
    let row = ctx
        .db
        .contact()
        .id()
        .find(&record_id)
        .ok_or("created contact missing")?;
    if row.organization_id != organization_id || row.company_id != Some(company_id) {
        return Err("created contact scope mismatch".into());
    }
    let mut changes = vec![RowChange::upsert_stdb_row(
        "contact",
        serde_json::json!({"id":record_id}),
        &row,
    )?];
    append_custom_values_and_audits(
        ctx,
        organization_id,
        company_id,
        "contact",
        record_id,
        &mut changes,
    )?;
    append_creation_receipt(
        ctx,
        organization_id,
        company_id,
        "contact",
        record_id,
        receipt_id,
        &mut changes,
    )?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.create_contact".into(),
            correlation_id: receipt_id.into(),
            changes,
        },
    )?;
    Ok(())
}

pub(crate) fn record_opportunity_creation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    record_id: u64,
    receipt_id: &str,
) -> Result<(), String> {
    let row = ctx
        .db
        .opportunity()
        .id()
        .find(&record_id)
        .ok_or("created opportunity missing")?;
    if row.organization_id != organization_id || row.company_id != Some(company_id) {
        return Err("created opportunity scope mismatch".into());
    }
    let mut changes = vec![RowChange::upsert_stdb_row(
        "opportunity",
        serde_json::json!({"id":record_id}),
        &row,
    )?];
    append_custom_values_and_audits(
        ctx,
        organization_id,
        company_id,
        "opportunity",
        record_id,
        &mut changes,
    )?;
    append_creation_receipt(
        ctx,
        organization_id,
        company_id,
        "opportunity",
        record_id,
        receipt_id,
        &mut changes,
    )?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.create_opportunity".into(),
            correlation_id: receipt_id.into(),
            changes,
        },
    )?;
    Ok(())
}

pub(crate) fn record_quotation_creation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    record_id: u64,
    receipt_id: &str,
) -> Result<(), String> {
    let row = ctx
        .db
        .sale_order()
        .id()
        .find(&record_id)
        .ok_or("created quotation missing")?;
    if row.organization_id != organization_id || row.company_id != company_id {
        return Err("created quotation scope mismatch".into());
    }
    let mut changes = vec![];
    append_sequence(ctx, organization_id, "SO", &mut changes)?;
    changes.push(RowChange::upsert_stdb_row(
        "sale_order",
        serde_json::json!({"id":record_id}),
        &row,
    )?);
    let mut lines: Vec<_> = ctx
        .db
        .sale_order_line()
        .iter()
        .filter(|line| {
            line.organization_id == organization_id
                && line.company_id == company_id
                && line.order_id == record_id
        })
        .collect();
    lines.sort_by_key(|line| line.id);
    for line in lines {
        changes.push(RowChange::upsert_stdb_row(
            "sale_order_line",
            serde_json::json!({"id":line.id}),
            &line,
        )?);
    }
    append_custom_values_and_audits(
        ctx,
        organization_id,
        company_id,
        "sale_order",
        record_id,
        &mut changes,
    )?;
    append_creation_receipt(
        ctx,
        organization_id,
        company_id,
        "sale_order",
        record_id,
        receipt_id,
        &mut changes,
    )?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.create_sale_order".into(),
            correlation_id: receipt_id.into(),
            changes,
        },
    )?;
    Ok(())
}

pub(crate) fn record_purchase_order_creation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    record_id: u64,
    receipt_id: &str,
) -> Result<(), String> {
    use crate::purchasing::order_creation_operations::purchase_order_creation_operation;
    use crate::purchasing::purchase_orders::purchase_order;
    let row = ctx
        .db
        .purchase_order()
        .id()
        .find(&record_id)
        .ok_or("created purchase order missing")?;
    if row.organization_id != organization_id || row.company_id != company_id {
        return Err("created purchase order scope mismatch".into());
    }
    let receipt = ctx
        .db
        .purchase_order_creation_operation()
        .id()
        .find(receipt_id)
        .ok_or("purchase creation receipt missing")?;
    if receipt.organization_id != organization_id
        || receipt.company_id != company_id
        || receipt.purchase_order_id != record_id
        || receipt.created_by != ctx.sender()
    {
        return Err("purchase receipt scope mismatch".into());
    }
    let mut changes = vec![];
    append_sequence(ctx, organization_id, "PO", &mut changes)?;
    changes.push(RowChange::upsert_stdb_row(
        "purchase_order",
        serde_json::json!({"id":record_id}),
        &row,
    )?);
    append_custom_values_and_audits(
        ctx,
        organization_id,
        company_id,
        "purchase_order",
        record_id,
        &mut changes,
    )?;
    changes.push(RowChange::upsert_stdb_row(
        "purchase_order_creation_operation",
        serde_json::json!({"id":receipt.id}),
        &receipt,
    )?);
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.create_purchase_order_once".into(),
            correlation_id: receipt_id.into(),
            changes,
        },
    )?;
    Ok(())
}

pub(crate) fn record_manual_invoice_creation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    record_id: u64,
    request_key: &str,
) -> Result<(), String> {
    use crate::accounting::idempotency::accounting_operation_receipt;
    use crate::accounting::journal_entries::{account_move, account_move_line};
    let row = ctx
        .db
        .account_move()
        .id()
        .find(&record_id)
        .ok_or("created manual invoice missing")?;
    if row.organization_id != organization_id || row.company_id != company_id {
        return Err("created manual invoice scope mismatch".into());
    }
    let receipts: Vec<_> = ctx
        .db
        .accounting_operation_receipt()
        .accounting_operation_receipt_by_scope()
        .filter((
            &organization_id,
            &company_id,
            &"create_manual_account_invoice".to_string(),
        ))
        .filter(|receipt| {
            receipt.idempotency_key == request_key
                && receipt.result_table == "account_move"
                && receipt.result_id == record_id
                && receipt.created_by == ctx.sender()
        })
        .collect();
    if receipts.len() != 1 {
        return Err("exact manual invoice receipt missing".into());
    }
    let receipt = &receipts[0];
    let mut changes = vec![RowChange::upsert_stdb_row(
        "account_move",
        serde_json::json!({"id":record_id}),
        &row,
    )?];
    let mut lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&record_id)
        .collect();
    lines.sort_by_key(|line| line.id);
    for line in lines {
        changes.push(RowChange::upsert_stdb_row(
            "account_move_line",
            serde_json::json!({"id":line.id}),
            &line,
        )?);
    }
    append_custom_values_and_audits(
        ctx,
        organization_id,
        company_id,
        "account_move",
        record_id,
        &mut changes,
    )?;
    changes.push(RowChange::upsert_stdb_row(
        "accounting_operation_receipt",
        serde_json::json!({"id":receipt.id}),
        receipt,
    )?);
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.create_manual_account_invoice".into(),
            correlation_id: receipt.id.clone(),
            changes,
        },
    )?;
    Ok(())
}
