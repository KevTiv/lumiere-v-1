//! Fleet service and inspection lifecycle regression coverage.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::fiscal_periods::{
    account_period, close_account_period,
};
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::fleet::fleet::{
    create_fleet_vehicle, create_fleet_vehicle_service_type, fleet_vehicle,
    fleet_vehicle_service_type, CreateFleetVehicleParams, CreateFleetVehicleServiceTypeParams,
};
use crate::fleet::lifecycle::{
    fleet_inspection, fleet_service_record, record_fleet_inspection, record_fleet_service,
    FleetInspectionOutcome, RecordFleetInspectionParams, RecordFleetServiceParams,
};
use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::test_harness::OrgFixture;
use crate::types::{
    AccountInternalGroup, AccountMoveState, AccountTypeInternal, EmploymentType, JournalType,
    PeriodState,
};

fn vehicle(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_fleet_vehicle(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateFleetVehicleParams {
            name: name.into(),
            vehicle_type: "van".into(),
            license_plate: None,
            driver_name: None,
            driver_id: None,
            service_type_id: None,
            metadata: None,
        },
    )?;
    ctx.db
        .fleet_vehicle()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.name == name)
        .map(|row| row.id)
        .ok_or_else(|| format!("vehicle {name} missing after create"))
}

fn service_type(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_fleet_vehicle_service_type(
        ctx,
        fixture.organization_id,
        CreateFleetVehicleServiceTypeParams {
            name: name.into(),
            company_id: Some(fixture.company_id),
        },
    )?;
    ctx.db
        .fleet_vehicle_service_type()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.name == name)
        .map(|row| row.id)
        .ok_or_else(|| format!("service type {name} missing after create"))
}

struct FleetCostAccounts {
    journal_id: u64,
    expense_account_id: u64,
    offset_account_id: u64,
}

fn fleet_cost_accounts(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
) -> Result<FleetCostAccounts, String> {
    create_account_account_type(
        ctx,
        fixture.organization_id,
        CreateAccountAccountTypeParams {
            name: "Fleet Service Expense".into(),
            type_: "expense".into(),
            internal_group: AccountInternalGroup::Expense,
            include_initial_balance: false,
            company_id: Some(fixture.company_id),
            metadata: None,
        },
    )?;
    let type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|row| {
            row.organization_id == fixture.organization_id
                && row.company_id == Some(fixture.company_id)
                && row.name == "Fleet Service Expense"
        })
        .map(|row| row.id)
        .ok_or("fleet expense account type missing")?;

    let code = format!("65{}", fixture.company_id);
    create_account_account(
        ctx,
        fixture.organization_id,
        CreateAccountAccountParams {
            company_id: Some(fixture.company_id),
            code: code.clone(),
            name: "Fleet Service Expense".into(),
            user_type_id: type_id,
            currency_id: Some(fixture.currency_id),
            internal_type: Some(AccountTypeInternal::Expense),
            internal_group: Some(AccountInternalGroup::Expense),
            group_id: None,
            reconcile: false,
            tax_ids: vec![],
            note: None,
            opening_debit: 0.0,
            opening_credit: 0.0,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_off_balance: false,
            metadata: None,
        },
    )?;
    let expense_account_id = ctx
        .db
        .account_account()
        .iter()
        .find(|row| {
            row.organization_id == fixture.organization_id
                && row.company_id == fixture.company_id
                && row.code == code
        })
        .map(|row| row.id)
        .ok_or("fleet expense account missing")?;

    let journal_code = format!("FS{}", fixture.company_id);
    create_account_journal(
        ctx,
        fixture.organization_id,
        CreateAccountJournalParams {
            company_id: Some(fixture.company_id),
            name: "Fleet Service Journal".into(),
            code: journal_code.clone(),
            type_: JournalType::General,
            currency_id: Some(fixture.currency_id),
            default_account_id: Some(expense_account_id),
            suspense_account_id: None,
            loss_account_id: None,
            profit_account_id: None,
            bank_account_id: None,
            payment_credit_account_id: None,
            payment_debit_account_id: None,
            invoice_reference_type: None,
            invoice_reference_model: None,
            sequence_id: None,
            refund_sequence_id: None,
            sequence_override_regex: None,
            secure_sequence_id: None,
            alias_name: None,
            alias_domain: None,
            sale_activity_type_id: None,
            sale_activity_user_id: None,
            sale_activity_note: None,
            sale_activity_date_deadline: None,
            restrict_mode_hash_table: false,
            active: true,
            at_least_one_inbound: false,
            at_least_one_outbound: false,
            dedicated_payment_method_ids: vec![],
            sale_activity_done: false,
            metadata: None,
        },
    )?;
    let journal_id = ctx
        .db
        .account_journal()
        .iter()
        .find(|row| {
            row.organization_id == fixture.organization_id
                && row.company_id == fixture.company_id
                && row.code == journal_code
        })
        .map(|row| row.id)
        .ok_or("fleet service journal missing")?;

    Ok(FleetCostAccounts {
        journal_id,
        expense_account_id,
        offset_account_id: fixture.chart_account_ids["ap"],
    })
}

fn employee(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_employee(
        ctx,
        fixture.organization_id,
        CreateEmployeeParams {
            company_id: Some(fixture.company_id),
            name: name.into(),
            job_id: None,
            department_id: None,
            employment_type: EmploymentType::FullTime,
            work_email: None,
            employee_number: None,
            job_title: None,
            parent_id: None,
            coach_id: None,
            work_phone: None,
            mobile_phone: None,
            work_location: None,
            work_contact_partner_id: None,
            date_hired: None,
            gender: None,
            birthday: None,
            marital: None,
            emergency_contact: None,
            emergency_phone: None,
            barcode: None,
            pin: None,
            image_url: None,
            color: None,
            is_active: true,
            metadata: None,
        },
    )?;
    ctx.db
        .hr_employee()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.name == name)
        .map(|row| row.id)
        .ok_or_else(|| format!("employee {name} missing after create"))
}

fn sibling_company(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: "Fleet Lifecycle Company B".into(),
            code: format!("FLC-{}", fixture.company_id),
            currency_id: fixture.currency_id,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: None,
        },
    )?;
    ctx.db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .map(|row| row.id)
        .filter(|id| *id != fixture.company_id)
        .max()
        .ok_or("sibling company missing".into())
}

fn history_effect_snapshot(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<String, String> {
    let mut services: Vec<_> = ctx
        .db
        .fleet_service_record()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .collect();
    let mut inspections: Vec<_> = ctx
        .db
        .fleet_inspection()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .collect();
    let mut vehicles: Vec<_> = ctx
        .db
        .fleet_vehicle()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .collect();
    let mut moves: Vec<_> = ctx
        .db
        .account_move()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .collect();
    let mut lines: Vec<_> = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|row| moves.iter().any(|entry| entry.id == row.move_id))
        .collect();
    services.sort_by_key(|row| row.id);
    inspections.sort_by_key(|row| row.id);
    vehicles.sort_by_key(|row| row.id);
    moves.sort_by_key(|row| row.id);
    lines.sort_by_key(|row| row.id);
    serde_json::to_string(spacetimedb_sats::serde::SerdeWrapper::from_ref(
        &(services, inspections, vehicles, moves, lines),
    ))
    .map_err(|error| format!("fleet effect snapshot: {error}"))
}

pub fn test_history_is_immutable_and_idempotent(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let vehicle_id = vehicle(ctx, &fixture, "Fleet Lifecycle Van")?;
    let service_type_id = service_type(ctx, &fixture, "Fleet Lifecycle Service")?;
    let inspector_id = employee(ctx, &fixture, "Fleet Lifecycle Inspector")?;
    let cost_accounts = fleet_cost_accounts(ctx, &fixture)?;

    let service = RecordFleetServiceParams {
        vehicle_id,
        service_type_id,
        serviced_at: None,
        odometer_km: Some(1250.5),
        provider: Some("  Local Garage  ".into()),
        notes: Some("  oil and filter  ".into()),
        cost_amount: Some(275.50),
        journal_id: Some(cost_accounts.journal_id),
        expense_account_id: Some(cost_accounts.expense_account_id),
        offset_account_id: Some(cost_accounts.offset_account_id),
        client_request_id: Some("fleet-service-idempotency".into()),
    };
    record_fleet_service(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        service.clone(),
    )?;
    record_fleet_service(ctx, fixture.organization_id, fixture.company_id, service.clone())?;
    let services = ctx
        .db
        .fleet_service_record()
        .iter()
        .filter(|row| row.vehicle_id == vehicle_id)
        .collect::<Vec<_>>();
    if services.len() != 1
        || services[0].organization_id != fixture.organization_id
        || services[0].company_id != fixture.company_id
        || services[0].vehicle_id != vehicle_id
        || services[0].service_type_id != service_type_id
        || services[0].client_request_id.as_deref() != Some("fleet-service-idempotency")
        || services[0].provider.as_deref() != Some("Local Garage")
        || services[0].cost_amount != Some(275.50)
        || services[0].currency_id != Some(fixture.currency_id)
        || services[0].account_move_id.is_none()
    {
        return Err("service history did not preserve the exact cost/accounting effect".into());
    }
    let move_id = services[0]
        .account_move_id
        .ok_or("fleet service row missing account_move_id")?;
    let move_row = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("fleet service move missing")?;
    if move_row.organization_id != fixture.organization_id
        || move_row.company_id != fixture.company_id
        || move_row.currency_id != fixture.currency_id
        || move_row.state != AccountMoveState::Posted
    {
        return Err("fleet service move scope/currency/state mismatch".into());
    }
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();
    let debit: f64 = lines.iter().map(|line| line.debit).sum();
    let credit: f64 = lines.iter().map(|line| line.credit).sum();
    if lines.len() != 2
        || (debit - 275.50).abs() > 0.001
        || (credit - 275.50).abs() > 0.001
        || !lines.iter().any(|line| {
            line.account_id == cost_accounts.expense_account_id
                && (line.debit - 275.50).abs() < 0.001
        })
        || !lines.iter().any(|line| {
            line.account_id == cost_accounts.offset_account_id
                && (line.credit - 275.50).abs() < 0.001
        })
    {
        return Err("fleet service accounting move is not the expected balanced cost entry".into());
    }
    let move_count = ctx
        .db
        .account_move()
        .iter()
        .filter(|row| {
            row.organization_id == fixture.organization_id
                && row.company_id == fixture.company_id
                && row.ref_.as_deref() == Some("FLEET-SERVICE:fleet-service-idempotency")
        })
        .count();
    if move_count != 1 {
        return Err(format!("fleet service retry created {move_count} accounting moves"));
    }

    let mismatched = record_fleet_service(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        RecordFleetServiceParams {
            vehicle_id,
            service_type_id,
            serviced_at: None,
            odometer_km: Some(1250.5),
            provider: Some("Local Garage".into()),
            notes: Some("changed cost".into()),
            cost_amount: Some(300.0),
            journal_id: Some(cost_accounts.journal_id),
            expense_account_id: Some(cost_accounts.expense_account_id),
            offset_account_id: Some(cost_accounts.offset_account_id),
            client_request_id: Some("fleet-service-idempotency".into()),
        },
    )
    .expect_err("mismatched service retry must be rejected");
    if !mismatched.contains("different fleet service payload") {
        return Err(format!("unexpected mismatched service retry error: {mismatched}"));
    }
    let move_count_after_mismatch = ctx
        .db
        .account_move()
        .iter()
        .filter(|row| {
            row.organization_id == fixture.organization_id
                && row.company_id == fixture.company_id
                && row.ref_.as_deref() == Some("FLEET-SERVICE:fleet-service-idempotency")
        })
        .count();
    if move_count_after_mismatch != 1 {
        return Err("mismatched retry changed fleet accounting move count".into());
    }

    let before = history_effect_snapshot(ctx, &fixture)?;
    let mut canonical_retry = service.clone();
    canonical_retry.serviced_at = Some(services[0].create_date);
    canonical_retry.provider = Some("Local Garage".into());
    canonical_retry.notes = Some("oil and filter".into());
    record_fleet_service(ctx, fixture.organization_id, fixture.company_id, canonical_retry)?;
    if history_effect_snapshot(ctx, &fixture)? != before {
        return Err("canonical service replay changed an effect".into());
    }
    for field in [
        "serviced_at", "odometer_km", "odometer_none", "provider", "provider_none",
        "notes", "notes_none", "cost_amount", "cost_none", "journal_id",
        "expense_account_id", "offset_account_id",
    ] {
        let mut changed = service.clone();
        match field {
            "serviced_at" => changed.serviced_at = Some(ctx.timestamp + std::time::Duration::from_secs(1)),
            "odometer_km" => changed.odometer_km = Some(1251.5),
            "odometer_none" => changed.odometer_km = None,
            "provider" => changed.provider = Some("Other Garage".into()),
            "provider_none" => changed.provider = None,
            "notes" => changed.notes = Some("different work".into()),
            "notes_none" => changed.notes = None,
            // This difference used to fall inside the replay tolerance.
            "cost_amount" => changed.cost_amount = Some(275.50001),
            "cost_none" => changed.cost_amount = None,
            "journal_id" => changed.journal_id = None,
            "expense_account_id" => changed.expense_account_id = Some(cost_accounts.offset_account_id),
            "offset_account_id" => changed.offset_account_id = Some(cost_accounts.expense_account_id),
            _ => unreachable!(),
        }
        let error = record_fleet_service(ctx, fixture.organization_id, fixture.company_id, changed)
            .expect_err("changed service payload must not replay");
        if !error.contains("different fleet service payload") {
            return Err(format!("{field}: unexpected service replay error: {error}"));
        }
        if history_effect_snapshot(ctx, &fixture)? != before {
            return Err(format!("{field}: rejected replay changed fleet/accounting effects"));
        }
    }
    let mut duplicate = services[0].clone();
    duplicate.id = 0;
    let duplicate = ctx.db.fleet_service_record().insert(duplicate);
    let ambiguous_before = history_effect_snapshot(ctx, &fixture)?;
    let error = record_fleet_service(ctx, fixture.organization_id, fixture.company_id, service.clone())
        .expect_err("ambiguous service identity must not replay");
    if !error.contains("Multiple fleet service records")
        || history_effect_snapshot(ctx, &fixture)? != ambiguous_before
    {
        return Err("ambiguous service replay did not fail closed".into());
    }
    let error = record_fleet_service(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        RecordFleetServiceParams { vehicle_id: 0, ..service.clone() },
    ).expect_err("ambiguous service key must not be masked by invalid vehicle");
    if !error.contains("Multiple fleet service records")
        || history_effect_snapshot(ctx, &fixture)? != ambiguous_before
    {
        return Err("service ambiguity was masked by reference validation".into());
    }
    ctx.db.fleet_service_record().id().delete(&duplicate.id);

    // An explicitly future-dated service must not match an omitted/default date.
    let free_service = RecordFleetServiceParams {
        serviced_at: Some(ctx.timestamp + std::time::Duration::from_secs(60)),
        provider: Some("  ".into()),
        notes: None,
        cost_amount: None,
        journal_id: None,
        expense_account_id: None,
        offset_account_id: None,
        client_request_id: Some("fleet-free-service".into()),
        ..service.clone()
    };
    record_fleet_service(ctx, fixture.organization_id, fixture.company_id, free_service.clone())?;
    let before = history_effect_snapshot(ctx, &fixture)?;
    record_fleet_service(ctx, fixture.organization_id, fixture.company_id,
        RecordFleetServiceParams { provider: None, notes: Some(" ".into()), ..free_service.clone() })?;
    let error = record_fleet_service(ctx, fixture.organization_id, fixture.company_id,
        RecordFleetServiceParams { serviced_at: None, ..free_service.clone() })
        .expect_err("omitted date must not replay an explicit non-default date");
    if !error.contains("different fleet service payload")
        || history_effect_snapshot(ctx, &fixture)? != before
    {
        return Err("default date/empty-text replay semantics are incorrect".into());
    }
    let original_free = ctx.db.fleet_service_record().iter()
        .find(|row| row.organization_id == fixture.organization_id
            && row.client_request_id.as_deref() == Some("fleet-free-service"))
        .ok_or("free fleet service missing")?;
    for currency_only in [true, false] {
        let mut inconsistent = original_free.clone();
        if currency_only {
            inconsistent.currency_id = Some(fixture.currency_id);
        } else {
            inconsistent.account_move_id = Some(move_id);
        }
        ctx.db.fleet_service_record().id().update(inconsistent);
        let inconsistent_before = history_effect_snapshot(ctx, &fixture)?;
        let error = record_fleet_service(
            ctx, fixture.organization_id, fixture.company_id, free_service.clone(),
        ).expect_err("costless replay must reject persisted accounting linkage");
        if !error.contains("different fleet service payload")
            || history_effect_snapshot(ctx, &fixture)? != inconsistent_before
        {
            return Err("inconsistent costless service was acknowledged or mutated".into());
        }
        ctx.db.fleet_service_record().id().update(original_free.clone());
    }

    let inspection = RecordFleetInspectionParams {
        vehicle_id,
        inspector_id: Some(inspector_id),
        inspected_at: None,
        outcome: "attention_required".into(),
        odometer_km: Some(1240.0),
        notes: Some("  tyre pressure  ".into()),
        client_request_id: Some("fleet-inspection-idempotency".into()),
    };
    record_fleet_inspection(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        inspection.clone(),
    )?;
    record_fleet_inspection(ctx, fixture.organization_id, fixture.company_id, inspection.clone())?;
    let inspections = ctx
        .db
        .fleet_inspection()
        .iter()
        .filter(|row| row.vehicle_id == vehicle_id)
        .collect::<Vec<_>>();
    if inspections.len() != 1
        || inspections[0].organization_id != fixture.organization_id
        || inspections[0].company_id != fixture.company_id
        || inspections[0].vehicle_id != vehicle_id
        || inspections[0].inspector_id != Some(inspector_id)
        || inspections[0].client_request_id.as_deref()
            != Some("fleet-inspection-idempotency")
        || inspections[0].outcome != FleetInspectionOutcome::AttentionRequired
    {
        return Err("inspection history did not preserve the exact idempotent effect".into());
    }

    let before = history_effect_snapshot(ctx, &fixture)?;
    let canonical_retry = RecordFleetInspectionParams {
        inspected_at: Some(inspections[0].create_date),
        outcome: " ATTENTION_REQUIRED ".into(),
        notes: Some("tyre pressure".into()),
        ..inspection.clone()
    };
    record_fleet_inspection(ctx, fixture.organization_id, fixture.company_id, canonical_retry)?;
    if history_effect_snapshot(ctx, &fixture)? != before {
        return Err("canonical inspection replay changed an effect".into());
    }
    let mut archived_inspector = ctx.db.hr_employee().id().find(&inspector_id)
        .ok_or("fleet inspector missing")?;
    let original_active = archived_inspector.is_active;
    archived_inspector.is_active = false;
    ctx.db.hr_employee().id().update(archived_inspector);
    record_fleet_inspection(ctx, fixture.organization_id, fixture.company_id, inspection.clone())?;
    if history_effect_snapshot(ctx, &fixture)? != before {
        return Err("inspection replay after inspector archival changed effects".into());
    }
    let mut restored_inspector = ctx.db.hr_employee().id().find(&inspector_id)
        .ok_or("archived fleet inspector missing")?;
    restored_inspector.is_active = original_active;
    ctx.db.hr_employee().id().update(restored_inspector);
    for field in ["inspected_at", "odometer_km", "odometer_none", "notes", "notes_none", "inspector_id", "outcome"] {
        let mut changed = inspection.clone();
        match field {
            "inspected_at" => changed.inspected_at = Some(ctx.timestamp + std::time::Duration::from_secs(1)),
            "odometer_km" => changed.odometer_km = Some(1241.0),
            "odometer_none" => changed.odometer_km = None,
            "notes" => changed.notes = Some("different inspection".into()),
            "notes_none" => changed.notes = None,
            "inspector_id" => changed.inspector_id = None,
            "outcome" => changed.outcome = "passed".into(),
            _ => unreachable!(),
        }
        let error = record_fleet_inspection(ctx, fixture.organization_id, fixture.company_id, changed)
            .expect_err("changed inspection payload must not replay");
        if !error.contains("different fleet inspection payload")
            || history_effect_snapshot(ctx, &fixture)? != before
        {
            return Err(format!("{field}: rejected inspection replay changed effects: {error}"));
        }
    }
    let mut duplicate = inspections[0].clone();
    duplicate.id = 0;
    let duplicate = ctx.db.fleet_inspection().insert(duplicate);
    let ambiguous_before = history_effect_snapshot(ctx, &fixture)?;
    let error = record_fleet_inspection(ctx, fixture.organization_id, fixture.company_id, inspection.clone())
        .expect_err("ambiguous inspection identity must not replay");
    if !error.contains("Multiple fleet inspections")
        || history_effect_snapshot(ctx, &fixture)? != ambiguous_before
    {
        return Err("ambiguous inspection replay did not fail closed".into());
    }
    let error = record_fleet_inspection(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        RecordFleetInspectionParams {
            vehicle_id: 0,
            inspector_id: Some(0),
            ..inspection
        },
    ).expect_err("ambiguous inspection key must not be masked by invalid references");
    if !error.contains("Multiple fleet inspections")
        || history_effect_snapshot(ctx, &fixture)? != ambiguous_before
    {
        return Err("inspection ambiguity was masked by reference validation".into());
    }
    ctx.db.fleet_inspection().id().delete(&duplicate.id);

    let updated = ctx
        .db
        .fleet_vehicle()
        .id()
        .find(&vehicle_id)
        .ok_or("vehicle missing after history writes")?;
    if updated.odometer_km != Some(1250.5) {
        return Err("older inspection odometer regressed the vehicle projection".into());
    }
    Ok(())
}

pub fn test_service_cost_respects_period_lock(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let vehicle_id = vehicle(ctx, &fixture, "Fleet Locked Cost Van")?;
    let service_type_id = service_type(ctx, &fixture, "Fleet Locked Cost Service")?;
    let accounts = fleet_cost_accounts(ctx, &fixture)?;

    let period_id = ctx
        .db
        .account_period()
        .period_by_company()
        .filter(&fixture.company_id)
        .find(|period| period.state == PeriodState::Open)
        .map(|period| period.id)
        .ok_or("open fleet accounting period missing")?;
    close_account_period(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        period_id,
    )?;

    let result = record_fleet_service(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        RecordFleetServiceParams {
            vehicle_id,
            service_type_id,
            serviced_at: Some(ctx.timestamp),
            odometer_km: Some(2000.0),
            provider: Some("Locked Garage".into()),
            notes: None,
            cost_amount: Some(99.50),
            journal_id: Some(accounts.journal_id),
            expense_account_id: Some(accounts.expense_account_id),
            offset_account_id: Some(accounts.offset_account_id),
            client_request_id: Some("fleet-locked-cost".into()),
        },
    );
    match result {
        Ok(()) => return Err("fleet service cost posted into a closed period".into()),
        Err(error)
            if error.to_ascii_lowercase().contains("closed")
                || error.to_ascii_lowercase().contains("period") => {}
        Err(error) => {
            return Err(format!(
                "unexpected fleet service cost period-lock error: {error}"
            ))
        }
    }

    if ctx.db.fleet_service_record().iter().any(|row| {
        row.organization_id == fixture.organization_id
            && row.client_request_id.as_deref() == Some("fleet-locked-cost")
    }) {
        return Err("closed-period fleet service row survived transaction rollback".into());
    }
    if ctx.db.account_move().iter().any(|row| {
        row.organization_id == fixture.organization_id
            && row.ref_.as_deref() == Some("FLEET-SERVICE:fleet-locked-cost")
    }) {
        return Err("closed-period fleet accounting move survived transaction rollback".into());
    }
    Ok(())
}

pub fn test_history_rejects_invalid_scope_and_values(ctx: &ReducerContext) -> Result<(), String> {
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let local_vehicle_id = vehicle(ctx, &local, "Fleet Guard Vehicle")?;
    let local_type_id = service_type(ctx, &local, "Fleet Guard Service")?;
    let foreign_type_id = service_type(ctx, &foreign, "Foreign Fleet Service")?;
    let foreign_inspector_id = employee(ctx, &foreign, "Foreign Fleet Inspector")?;
    let company_b = sibling_company(ctx, &local)?;

    let invalid_services = [
        (company_b, local_type_id, Some(1.0), "does not belong"),
        (local.company_id, foreign_type_id, Some(1.0), "organization"),
        (local.company_id, local_type_id, Some(-1.0), "non-negative"),
    ];
    for (company_id, service_type_id, odometer_km, expected) in invalid_services {
        let error = record_fleet_service(
            ctx,
            local.organization_id,
            company_id,
            RecordFleetServiceParams {
                vehicle_id: local_vehicle_id,
                service_type_id,
                serviced_at: None,
                odometer_km,
                provider: None,
                notes: None,
                cost_amount: None,
                journal_id: None,
                expense_account_id: None,
                offset_account_id: None,
                client_request_id: None,
            },
        )
        .expect_err("invalid service history must be rejected");
        if !error.contains(expected) {
            return Err(format!("unexpected service validation error: {error}"));
        }
    }

    for (inspector_id, outcome, expected) in [
        (None, "unknown", "outcome"),
        (Some(foreign_inspector_id), "passed", "organization"),
    ] {
        let error = record_fleet_inspection(
            ctx,
            local.organization_id,
            local.company_id,
            RecordFleetInspectionParams {
                vehicle_id: local_vehicle_id,
                inspector_id,
                inspected_at: None,
                outcome: outcome.into(),
                odometer_km: Some(5.0),
                notes: None,
                client_request_id: None,
            },
        )
        .expect_err("invalid inspection history must be rejected");
        if !error.to_ascii_lowercase().contains(expected) {
            return Err(format!("unexpected inspection validation error: {error}"));
        }
    }

    if ctx
        .db
        .fleet_service_record()
        .iter()
        .any(|row| row.vehicle_id == local_vehicle_id)
        || ctx
            .db
            .fleet_inspection()
            .iter()
            .any(|row| row.vehicle_id == local_vehicle_id)
    {
        return Err("rejected lifecycle write persisted history".into());
    }
    Ok(())
}
