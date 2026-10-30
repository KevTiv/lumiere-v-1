//! Persisted proof for the first trusted Accounting change-history producer.

use spacetimedb::ReducerContext;

use crate::accounting::journal_entries::{
    account_move, account_move_line, update_account_move_line, UpdateAccountMoveLineParams,
};
use crate::core::audit::{audit_log, log_audit_event, LogAuditEventParams};
use crate::core::business_changes::business_change;
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::AccountMoveState;

use super::helpers::create_balanced_customer_invoice;

fn rename(company_id: u64, name: &str) -> UpdateAccountMoveLineParams {
    UpdateAccountMoveLineParams {
        quantity: None,
        price_unit: None,
        expected_quantity: None,
        expected_price_unit: None,
        company_id: Some(company_id),
        name: Some(name.into()),
        debit: None,
        credit: None,
        partner_id: None,
        analytic_account_id: None,
        metadata: None,
    }
}

pub fn test_accounting_line_history_is_native_exact_and_replay_safe(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    let move_id = create_balanced_customer_invoice(ctx, &fixture, 100.0, false)?;
    let original = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .min_by_key(|line| line.id)
        .ok_or("history fixture line missing")?;
    let change_count = || {
        ctx.db
            .business_change()
            .business_change_by_organization()
            .filter(&org)
            .count()
    };
    let initial_count = change_count();
    let params = rename(company, "Reviewed service description");
    update_account_move_line(ctx, org, original.id, params.clone())?;
    if change_count() != initial_count + 1 {
        return Err("ordinary line edit did not create exactly one trusted change".into());
    }
    let evidence = ctx
        .db
        .business_change()
        .business_change_by_organization()
        .filter(&org)
        .find(|row| {
            row.subject_record_id == original.id && row.operation == "update_account_move_line"
        })
        .ok_or("trusted line change missing")?;
    if evidence.company_id != company
        || evidence.resource != "account_move"
        || evidence.record_id != move_id
        || evidence.subject_resource != "account_move_line"
        || evidence.operation != "update_account_move_line"
        || evidence.actor_identity != ctx.sender()
        || evidence.schema_version != 1
        || evidence.before_fingerprint == evidence.after_fingerprint
    {
        return Err(
            "trusted history lost exact source ownership, actor or material identity".into(),
        );
    }
    let deltas: serde_json::Value = serde_json::from_str(&evidence.changes_json)
        .map_err(|error| format!("decode trusted changes: {error}"))?;
    if deltas
        != serde_json::json!([{
            "field":"name",
            "before":original.name,
            "after":"Reviewed service description",
        }])
    {
        return Err(format!(
            "trusted history did not preserve the exact before/after delta: {deltas}"
        ));
    }
    let audit = ctx
        .db
        .audit_log()
        .id()
        .find(&evidence.audit_log_id)
        .ok_or("trusted change audit reference missing")?;
    if audit.old_values.is_some()
        || audit.new_values.is_some()
        || audit.record_id != original.id
        || audit.user_identity != ctx.sender()
    {
        return Err("public audit duplicated private values or lost native attribution".into());
    }
    let commit = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&org)
        .find(|row| row.correlation_id == format!("business-change:{}", evidence.id))
        .ok_or("trusted change has no exact durable organization commit")?;
    let committed: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter(&org)
        .filter(|row| row.commit_sequence == commit.sequence)
        .collect();
    for table in [
        "account_move",
        "account_move_line",
        "audit_log",
        "business_change",
    ] {
        if committed
            .iter()
            .filter(|row| row.table_name == table)
            .count()
            != 1
        {
            return Err(format!(
                "trusted change durable commit lacks exact {table} row"
            ));
        }
    }
    let commits_before_replay = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&org)
        .count();
    update_account_move_line(ctx, org, original.id, params)?;
    if change_count() != initial_count + 1
        || ctx
            .db
            .organization_commit()
            .organization_commit_by_organization()
            .filter(&org)
            .count()
            != commits_before_replay
    {
        return Err("same-value replay created duplicate history or a durable commit".into());
    }

    // Caller-authored audit text must never become canonical business evidence.
    log_audit_event(
        ctx,
        org,
        LogAuditEventParams {
            company_id: Some(company),
            table_name: "account_move_line".into(),
            record_id: original.id,
            action: "UPDATE".into(),
            old_values: Some("forged before".into()),
            new_values: Some("forged after".into()),
            changed_fields: vec!["name".into()],
            session_id: None,
            ip_address: None,
            user_agent: None,
            metadata: Some("{\"business_change_schema_version\":1}".into()),
        },
    )?;
    if change_count() != initial_count + 1 {
        return Err("raw audit logging minted trusted business evidence".into());
    }

    // Failed owner validations leave both the source and trusted history alone.
    let other = OrgFixture::seed_minimal(ctx)?;
    if update_account_move_line(ctx, org, original.id, rename(other.company_id, "foreign")).is_ok()
    {
        return Err("cross-company history mutation was accepted".into());
    }
    let mut invalid = rename(company, "non-finite");
    invalid.debit = Some(f64::INFINITY);
    if update_account_move_line(ctx, org, original.id, invalid).is_ok() {
        return Err("non-finite value was accepted into history".into());
    }
    // Metadata is deliberately outside initial material-history coverage, and
    // large existing metadata must not make unrelated ordinary edits fail.
    let metadata = "x".repeat(70_000);
    let mut metadata_only = rename(company, "Reviewed service description");
    metadata_only.metadata = Some(Some(metadata.clone()));
    update_account_move_line(ctx, org, original.id, metadata_only)?;
    if change_count() != initial_count + 1
        || ctx
            .db
            .account_move_line()
            .id()
            .find(&original.id)
            .and_then(|line| line.metadata)
            != Some(metadata)
    {
        return Err(
            "metadata-only save was dropped or fabricated into captured value history".into(),
        );
    }
    update_account_move_line(
        ctx,
        org,
        original.id,
        rename(company, "Name after large metadata"),
    )?;
    if change_count() != initial_count + 2 {
        return Err("large legacy metadata blocked a captured ordinary edit".into());
    }
    let mut posted = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("history move missing")?;
    posted.state = AccountMoveState::Posted;
    ctx.db.account_move().id().update(posted);
    if update_account_move_line(ctx, org, original.id, rename(company, "posted edit")).is_ok() {
        return Err("posted record history mutation was accepted".into());
    }
    let current = ctx
        .db
        .account_move_line()
        .id()
        .find(&original.id)
        .ok_or("history source missing")?;
    if change_count() != initial_count + 2
        || current.name != "Name after large metadata"
        || !current.debit.is_finite()
    {
        return Err("rejected history mutation changed source or evidence".into());
    }
    Ok(())
}

pub fn test_accounting_line_addition_history_is_native_and_scoped(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let move_id = create_balanced_customer_invoice(ctx, &fixture, 12.5, false)?;
    let evidence: Vec<_> = ctx
        .db
        .business_change()
        .business_change_by_organization()
        .filter(&org)
        .filter(|row| row.record_id == move_id && row.operation == "add_account_move_line")
        .collect();
    if evidence.len() != 2 {
        return Err(
            "explicit draft-line additions did not produce two exact native histories".into(),
        );
    }
    for change in evidence {
        let line = ctx
            .db
            .account_move_line()
            .id()
            .find(&change.subject_record_id)
            .ok_or("addition history has no current exact source line")?;
        if change.company_id != fixture.company_id
            || change.resource != "account_move"
            || change.subject_resource != "account_move_line"
            || change.actor_identity != ctx.sender()
            || line.organization_id != org
            || line.company_id != fixture.company_id
            || line.move_id != move_id
        {
            return Err("addition history lost canonical ownership or actor".into());
        }
        let deltas: Vec<serde_json::Value> =
            serde_json::from_str(&change.changes_json).map_err(|error| error.to_string())?;
        if deltas.iter().any(|delta| !delta["before"].is_null()) {
            return Err("addition history invented a previous line value".into());
        }
        for (field, value) in [
            ("account_id", line.account_id.to_string()),
            ("currency_id", line.currency_id.to_string()),
            ("debit", line.debit.to_string()),
            ("credit", line.credit.to_string()),
            ("name", line.name.clone()),
        ] {
            if !deltas
                .iter()
                .any(|delta| delta["field"] == field && delta["after"] == value)
            {
                return Err(format!("addition history lost exact {field}"));
            }
        }
        let audit = ctx
            .db
            .audit_log()
            .id()
            .find(&change.audit_log_id)
            .ok_or("addition audit missing")?;
        if audit.action != "CREATE"
            || audit.record_id != line.id
            || audit.old_values.is_some()
            || audit.new_values.is_some()
        {
            return Err(
                "addition audit lost lifecycle semantics or duplicated private values".into(),
            );
        }
        let commit = ctx
            .db
            .organization_commit()
            .organization_commit_by_organization()
            .filter(&org)
            .find(|row| row.correlation_id == format!("business-change:{}", change.id))
            .ok_or("addition evidence has no durable exact commit")?;
        let rows: Vec<_> = ctx
            .db
            .organization_row_change()
            .organization_row_change_by_commit()
            .filter(&org)
            .filter(|row| row.commit_sequence == commit.sequence)
            .collect();
        for table in [
            "account_move",
            "account_move_line",
            "audit_log",
            "business_change",
        ] {
            if rows.iter().filter(|row| row.table_name == table).count() != 1 {
                return Err(format!("addition durable commit lacks exact {table} row"));
            }
        }
    }
    Ok(())
}
