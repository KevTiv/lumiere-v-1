/// HR country-pack overlays — leave category defaults, public-holiday seeds, statutory ID vault.
///
/// Not a payroll calculator: pack tables + metadata only. Gross-to-net stays in export intents /
/// external engines (Wave C workers).
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::country_pack::{
    company_enabled_pack_keys, country_pack_definition, CountryPackDefinition,
};
use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_employee;
use crate::hr::leaves::{hr_leave_type, HrLeaveType};
use crate::projects::capacity::{public_holiday, PublicHoliday};

// ── Tables ────────────────────────────────────────────────────────────────────

/// Global catalog of default leave categories per country pack (not org-scoped).
#[spacetimedb::table(
    accessor = hr_country_pack_leave_default,
    public,
    index(accessor = hr_leave_default_by_pack, btree(columns = [pack_key]))
)]
pub struct HrCountryPackLeaveDefault {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pack_key: String,
    pub name: String,
    pub code: String,
    pub max_leaves: f64,
    pub allocation_type: String,
    pub sort_order: u32,
    pub metadata: Option<String>,
}

/// Purpose-restricted statutory identifier vault (TFN, CPF, NRIC, …).
#[spacetimedb::table(
    accessor = hr_statutory_id,
    public,
    index(accessor = statutory_id_by_org, btree(columns = [organization_id])),
    index(accessor = statutory_id_by_employee, btree(columns = [employee_id])),
    index(accessor = statutory_id_by_company, btree(columns = [company_id]))
)]
pub struct HrStatutoryId {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    /// Pack-declared kind (e.g. TFN, CPF, NRIC).
    pub id_kind: String,
    pub value: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct SeedHrCountryPackOverlaysParams {
    pub pack_keys: Vec<String>,
    pub seed_holidays: bool,
    pub materialize_leave_types: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStatutoryIdParams {
    pub employee_id: u64,
    pub id_kind: String,
    pub value: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateStatutoryIdParams {
    pub id_kind: Option<String>,
    pub value: Option<String>,
    pub metadata: Option<String>,
}

// ── Seed specs ────────────────────────────────────────────────────────────────

fn leave_default_catalog_rows() -> Vec<(&'static str, &'static str, &'static str, f64, u32)> {
    vec![
        ("au", "Annual Leave", "AL", 20.0, 10),
        ("au", "Personal/Carer's Leave", "PCL", 10.0, 20),
        ("au", "Compassionate Leave", "COMP", 2.0, 30),
        ("nz", "Annual Holidays", "AH", 20.0, 10),
        ("nz", "Sick Leave", "SL", 10.0, 20),
        ("nz", "Bereavement Leave", "BL", 3.0, 30),
        ("za", "Annual Leave", "AL", 21.0, 10),
        ("za", "Sick Leave", "SL", 30.0, 20),
        ("za", "Family Responsibility", "FR", 3.0, 30),
        ("br", "Férias", "FER", 30.0, 10),
        ("br", "Licença Maternidade", "MAT", 120.0, 20),
        ("br", "Licença Paternidade", "PAT", 5.0, 30),
        ("sg", "Annual Leave", "AL", 14.0, 10),
        ("sg", "Outpatient Sick Leave", "OSL", 14.0, 20),
        ("sg", "Hospitalisation Leave", "HL", 60.0, 30),
    ]
}

fn micros_ymd(year: i32, month: u32, day: u32) -> i64 {
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = (era as i64) * 146097 + doe as i64 - 719468;
    days * 86_400_000_000
}

fn hr_holiday_seed_rows() -> Vec<(&'static str, &'static str, i64)> {
    vec![
        ("au", "Australia Day", micros_ymd(2026, 1, 26)),
        ("au", "ANZAC Day", micros_ymd(2026, 4, 25)),
        ("au", "Christmas Day", micros_ymd(2026, 12, 25)),
        ("nz", "Waitangi Day", micros_ymd(2026, 2, 6)),
        ("nz", "ANZAC Day", micros_ymd(2026, 4, 25)),
        ("nz", "Christmas Day", micros_ymd(2026, 12, 25)),
        ("za", "Human Rights Day", micros_ymd(2026, 3, 21)),
        ("za", "Freedom Day", micros_ymd(2026, 4, 27)),
        ("za", "Day of Reconciliation", micros_ymd(2026, 12, 16)),
        ("br", "Tiradentes Day", micros_ymd(2026, 4, 21)),
        ("br", "Independence Day", micros_ymd(2026, 9, 7)),
        ("br", "Christmas Day", micros_ymd(2026, 12, 25)),
        ("sg", "Chinese New Year", micros_ymd(2026, 2, 17)),
        ("sg", "National Day", micros_ymd(2026, 8, 9)),
        ("sg", "Deepavali", micros_ymd(2026, 11, 8)),
    ]
}

pub(crate) fn seed_hr_country_pack_leave_catalog(ctx: &ReducerContext) {
    for (pack_key, name, code, max_leaves, sort_order) in leave_default_catalog_rows() {
        let exists = ctx
            .db
            .hr_country_pack_leave_default()
            .hr_leave_default_by_pack()
            .filter(&pack_key.to_string())
            .any(|row| row.code == code);
        if exists {
            continue;
        }
        ctx.db
            .hr_country_pack_leave_default()
            .insert(HrCountryPackLeaveDefault {
                id: 0,
                pack_key: pack_key.to_string(),
                name: name.to_string(),
                code: code.to_string(),
                max_leaves,
                allocation_type: "fixed".to_string(),
                sort_order,
                metadata: Some(format!(r#"{{"pack":"{pack_key}","seed":"hr_overlay"}}"#)),
            });
    }
}

fn pack_keys_for_seed(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    requested: &[String],
) -> Vec<String> {
    if requested.is_empty() {
        return company_enabled_pack_keys(ctx, organization_id, company_id);
    }
    requested
        .iter()
        .map(|k| k.trim().to_lowercase())
        .filter(|k| !k.is_empty())
        .collect()
}

fn materialize_leave_types_for_pack(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    pack_key: &str,
) -> u32 {
    let mut created = 0u32;
    for default in ctx
        .db
        .hr_country_pack_leave_default()
        .hr_leave_default_by_pack()
        .filter(&pack_key.to_string())
    {
        let exists = ctx
            .db
            .hr_leave_type()
            .leave_type_by_org()
            .filter(&organization_id)
            .any(|lt| {
                lt.company_id == company_id
                    && lt
                        .code
                        .as_ref()
                        .is_some_and(|c| c.eq_ignore_ascii_case(&default.code))
            });
        if exists {
            continue;
        }
        ctx.db.hr_leave_type().insert(HrLeaveType {
            id: 0,
            organization_id,
            company_id,
            name: default.name.clone(),
            code: Some(default.code.clone()),
            color: None,
            allocation_type: default.allocation_type.clone(),
            validity_start: None,
            validity_stop: None,
            max_leaves: default.max_leaves,
            is_active: true,
            created_at: ctx.timestamp,
        });
        created += 1;
    }
    created
}

fn seed_holidays_for_pack(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    pack_key: &str,
) -> u32 {
    let mut created = 0u32;
    for (pack, name, micros) in hr_holiday_seed_rows() {
        if !pack.eq_ignore_ascii_case(pack_key) {
            continue;
        }
        let already = ctx
            .db
            .public_holiday()
            .holiday_by_org()
            .filter(&organization_id)
            .any(|h| {
                h.company_id == company_id
                    && h.pack_key.eq_ignore_ascii_case(pack)
                    && h.name == name
            });
        if already {
            continue;
        }
        ctx.db.public_holiday().insert(PublicHoliday {
            id: 0,
            organization_id,
            company_id,
            calendar_id: None,
            pack_key: pack.to_string(),
            name: name.to_string(),
            holiday_date: Timestamp::from_micros_since_unix_epoch(micros),
            is_recurring: false,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: Some(
                serde_json::json!({
                    "seed": "hr_country_pack_overlay",
                    "pack": pack,
                })
                .to_string(),
            ),
        });
        created += 1;
    }
    created
}

fn validate_statutory_id_kind(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    id_kind: &str,
) -> Result<(), String> {
    let kind = id_kind.trim();
    if kind.is_empty() {
        return Err("id_kind cannot be empty".to_string());
    }
    let enabled = company_enabled_pack_keys(ctx, organization_id, company_id);
    if enabled.is_empty() {
        return Ok(());
    }
    let mut allowed: Vec<String> = Vec::new();
    for pack_key in enabled {
        if let Some(def) = ctx.db.country_pack_definition().pack_key().find(&pack_key) {
            allowed.extend(pack_statutory_id_kinds(&def));
        }
    }
    if allowed.is_empty() {
        return Ok(());
    }
    if allowed.iter().any(|k| k.eq_ignore_ascii_case(kind)) {
        Ok(())
    } else {
        Err(format!(
            "id_kind '{kind}' is not declared by enabled country packs"
        ))
    }
}

fn pack_statutory_id_kinds(definition: &CountryPackDefinition) -> Vec<String> {
    let Some(meta) = definition.metadata.as_ref() else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(meta) else {
        return Vec::new();
    };
    value
        .get("hr_statutory_id_kinds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

pub fn mask_statutory_id_value(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() <= 4 {
        return "*".repeat(trimmed.len().max(1));
    }
    format!("{}***", &trimmed[trimmed.len() - 4..])
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Seed HR pack overlays for enabled (or requested) packs: leave types + public holidays.
#[reducer]
pub fn seed_hr_country_pack_overlays(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SeedHrCountryPackOverlaysParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_leave_type", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let pack_keys = pack_keys_for_seed(ctx, organization_id, company_id, &params.pack_keys);
    if pack_keys.is_empty() {
        return Err("No pack keys to seed — enable a country pack or pass pack_keys".to_string());
    }

    let mut leave_created = 0u32;
    let mut holidays_created = 0u32;
    for pack_key in &pack_keys {
        if params.materialize_leave_types {
            leave_created +=
                materialize_leave_types_for_pack(ctx, organization_id, company_id, pack_key);
        }
        if params.seed_holidays {
            holidays_created += seed_holidays_for_pack(ctx, organization_id, company_id, pack_key);
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_country_pack_leave_default",
            record_id: 0,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "pack_keys": pack_keys,
                    "leave_types_created": leave_created,
                    "holidays_created": holidays_created,
                })
                .to_string(),
            ),
            changed_fields: vec!["pack_overlays".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_statutory_id(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateStatutoryIdParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "view_statutory_id")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let employee = ctx
        .db
        .hr_employee()
        .id()
        .find(&params.employee_id)
        .ok_or("Employee not found")?;
    if employee.organization_id != organization_id {
        return Err("Employee does not belong to this organization".to_string());
    }
    if employee.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let id_kind = params.id_kind.trim().to_string();
    if id_kind.is_empty() {
        return Err("id_kind cannot be empty".to_string());
    }
    let value = params.value.trim().to_string();
    if value.is_empty() {
        return Err("value cannot be empty".to_string());
    }
    validate_statutory_id_kind(ctx, organization_id, company_id, &id_kind)?;

    let duplicate = ctx
        .db
        .hr_statutory_id()
        .statutory_id_by_employee()
        .filter(&params.employee_id)
        .any(|row| row.id_kind.eq_ignore_ascii_case(&id_kind));
    if duplicate {
        return Err(format!(
            "Statutory id kind '{id_kind}' already exists for employee"
        ));
    }

    let row = ctx.db.hr_statutory_id().insert(HrStatutoryId {
        id: 0,
        organization_id,
        company_id,
        employee_id: params.employee_id,
        id_kind: id_kind.clone(),
        value: value.clone(),
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
            table_name: "hr_statutory_id",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_id": params.employee_id,
                    "id_kind": id_kind,
                    "value_masked": mask_statutory_id_value(&value),
                })
                .to_string(),
            ),
            changed_fields: vec!["id_kind".to_string(), "value".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_statutory_id(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    statutory_id: u64,
    params: UpdateStatutoryIdParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "view_statutory_id")?;
    let existing = ctx
        .db
        .hr_statutory_id()
        .id()
        .find(&statutory_id)
        .ok_or("Statutory id not found")?;
    if existing.organization_id != organization_id {
        return Err("Statutory id does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let id_kind = params
        .id_kind
        .as_ref()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .unwrap_or(existing.id_kind.clone());
    if params.id_kind.is_some() {
        validate_statutory_id_kind(ctx, organization_id, company_id, &id_kind)?;
    }
    let value = params
        .value
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or(existing.value.clone());

    let updated = HrStatutoryId {
        id_kind: id_kind.clone(),
        value: value.clone(),
        metadata: params.metadata.or(existing.metadata.clone()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..existing
    };
    ctx.db.hr_statutory_id().id().update(updated);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_statutory_id",
            record_id: statutory_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "id_kind": existing.id_kind,
                    "value_masked": mask_statutory_id_value(&existing.value),
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "id_kind": id_kind,
                    "value_masked": mask_statutory_id_value(&value),
                })
                .to_string(),
            ),
            changed_fields: vec!["id_kind".to_string(), "value".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn delete_statutory_id(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    statutory_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "view_statutory_id")?;
    let existing = ctx
        .db
        .hr_statutory_id()
        .id()
        .find(&statutory_id)
        .ok_or("Statutory id not found")?;
    if existing.organization_id != organization_id {
        return Err("Statutory id does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    ctx.db.hr_statutory_id().id().delete(&statutory_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_statutory_id",
            record_id: statutory_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "employee_id": existing.employee_id,
                    "id_kind": existing.id_kind,
                    "value_masked": mask_statutory_id_value(&existing.value),
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec!["id_kind".to_string(), "value".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
