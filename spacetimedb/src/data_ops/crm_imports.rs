/// CRM CSV Imports — Contact, Lead, Opportunity
///
/// CRM-RI-001: every relation-ID column is parsed into a three-way result
/// (missing / malformed / valid) and resolved through an inline scoped loader
/// before any row is inserted. A row is only ever partially validated, never
/// partially persisted — all checks for a row run before any insert for that
/// row happens, and a rejected row leaves nothing behind. One bad row is
/// skipped (and reported via `record_import_error`); it does not abort the
/// rest of the batch, so valid rows in the same file still commit.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::company_id_from_scope;
use crate::core::reference::currency;
use crate::core::utm::{utm_campaign, utm_medium};
use crate::crm::contacts::{contact, Contact};
use crate::crm::leads::{lead, lead_source, Lead};
use crate::crm::opportunities::{opp_stage, opportunity, Opportunity};
use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{
    begin_import_job, finish_import_job, record_import_created_id, record_import_error,
};
use crate::helpers::check_permission;

// ── Relation ID parsing ─────────────────────────────────────────────────────────

/// Three-way parse result for a relation-ID CSV cell. Keeps "the cell was
/// empty" distinct from "the cell had a value that cannot be a real ID", so
/// callers never have to guess whether a missing value was intentional.
enum RelationId {
    /// Cell was empty (or the column is absent from this CSV).
    Missing,
    /// Cell was non-empty but did not parse as a positive `u64`. Literal
    /// `"0"` is treated as malformed too — no row in this schema has id 0,
    /// so a zero cell is data corruption, not a real reference.
    Malformed,
    Valid(u64),
}

/// Parse a relation-ID cell into a [`RelationId`]. Trims whitespace first.
fn parse_relation_id(v: &str) -> RelationId {
    let v = v.trim();
    if v.is_empty() {
        return RelationId::Missing;
    }
    match v.parse::<u64>() {
        Ok(0) | Err(_) => RelationId::Malformed,
        Ok(id) => RelationId::Valid(id),
    }
}

// ── Scoped relation loaders (inline, self-contained for this import path) ──────
//
// Each loader: looks up the row, rejects if missing, rejects cross-org, and
// rejects inactive/deleted/merged where the target table tracks that state.

fn check_contact_ref(ctx: &ReducerContext, organization_id: u64, id: u64) -> Result<(), String> {
    let c = ctx
        .db
        .contact()
        .id()
        .find(&id)
        .ok_or_else(|| format!("contact {id} not found"))?;
    if c.organization_id != organization_id {
        return Err(format!(
            "contact {id} not found or not in this organization"
        ));
    }
    if c.merge_target_id.is_some() {
        return Err(format!("contact {id} has been merged into another contact"));
    }
    if c.deleted_at.is_some() {
        return Err(format!("contact {id} is deleted"));
    }
    Ok(())
}

fn check_lead_ref(ctx: &ReducerContext, organization_id: u64, id: u64) -> Result<(), String> {
    let l = ctx
        .db
        .lead()
        .id()
        .find(&id)
        .ok_or_else(|| format!("lead {id} not found"))?;
    if l.organization_id != organization_id {
        return Err(format!("lead {id} not found or not in this organization"));
    }
    if l.deleted_at.is_some() {
        return Err(format!("lead {id} is deleted"));
    }
    Ok(())
}

fn check_lead_source_ref(
    ctx: &ReducerContext,
    organization_id: u64,
    id: u64,
) -> Result<(), String> {
    let s = ctx
        .db
        .lead_source()
        .id()
        .find(&id)
        .ok_or_else(|| format!("lead source {id} not found"))?;
    if s.organization_id != organization_id {
        return Err(format!(
            "lead source {id} not found or not in this organization"
        ));
    }
    if !s.is_active {
        return Err(format!("lead source {id} is inactive"));
    }
    Ok(())
}

fn check_utm_campaign_ref(
    ctx: &ReducerContext,
    organization_id: u64,
    id: u64,
) -> Result<(), String> {
    let c = ctx
        .db
        .utm_campaign()
        .id()
        .find(&id)
        .ok_or_else(|| format!("campaign {id} not found"))?;
    if c.organization_id != organization_id {
        return Err(format!(
            "campaign {id} not found or not in this organization"
        ));
    }
    if !c.is_active {
        return Err(format!("campaign {id} is inactive"));
    }
    Ok(())
}

fn check_utm_medium_ref(ctx: &ReducerContext, organization_id: u64, id: u64) -> Result<(), String> {
    let m = ctx
        .db
        .utm_medium()
        .id()
        .find(&id)
        .ok_or_else(|| format!("medium {id} not found"))?;
    if m.organization_id != organization_id {
        return Err(format!("medium {id} not found or not in this organization"));
    }
    if !m.is_active {
        return Err(format!("medium {id} is inactive"));
    }
    Ok(())
}

fn check_opp_stage_ref(ctx: &ReducerContext, organization_id: u64, id: u64) -> Result<(), String> {
    let s = ctx
        .db
        .opp_stage()
        .id()
        .find(&id)
        .ok_or_else(|| format!("stage {id} not found"))?;
    if s.organization_id != organization_id {
        return Err(format!("stage {id} not found or not in this organization"));
    }
    if !s.is_active {
        return Err(format!("stage {id} is inactive"));
    }
    Ok(())
}

/// Currency is a global reference table (not organization-scoped), so only
/// existence and active state are checked.
fn check_currency_ref(ctx: &ReducerContext, id: u64) -> Result<(), String> {
    let c = ctx
        .db
        .currency()
        .id()
        .find(&id)
        .ok_or_else(|| format!("currency {id} not found"))?;
    if !c.active {
        return Err(format!("currency {id} is inactive"));
    }
    Ok(())
}

// ── Contact ───────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_contact_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "contact", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        // company_id: optional in the CSV — if provided it must resolve to a
        // real, non-deleted company in this organization; if absent, fall
        // back to the organization's default company (never `None`/zero).
        let company_id_cell = col(&headers, row, "company_id");
        let requested_company_id = match parse_relation_id(company_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("company_id"),
                    Some(company_id_cell),
                    "company_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => Some(id),
        };
        let company_id = match company_id_from_scope(ctx, organization_id, requested_company_id) {
            Ok(id) => id,
            Err(reason) => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("company_id"),
                    Some(company_id_cell),
                    &format!("company_id: {reason}"),
                );
                errors += 1;
                continue;
            }
        };

        // parent_id: optional. If provided, must reference an active,
        // non-merged contact in this organization.
        let parent_id_cell = col(&headers, row, "parent_id");
        let parent_id = match parse_relation_id(parent_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("parent_id"),
                    Some(parent_id_cell),
                    "parent_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => {
                if let Err(reason) = check_contact_ref(ctx, organization_id, id) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("parent_id"),
                        Some(parent_id_cell),
                        &format!("parent_id: {reason}"),
                    );
                    errors += 1;
                    continue;
                }
                Some(id)
            }
        };

        let type_ = {
            let t = col(&headers, row, "type_");
            if t == "company" {
                "company".to_string()
            } else {
                "contact".to_string()
            }
        };

        let created = ctx.db.contact().insert(Contact {
            id: 0,
            organization_id,
            company_id: Some(company_id),
            type_,
            name: name.clone(),
            display_name: name.clone(),
            first_name: opt_str(col(&headers, row, "first_name")),
            last_name: opt_str(col(&headers, row, "last_name")),
            title: opt_str(col(&headers, row, "title")),
            email: opt_str(col(&headers, row, "email")),
            email_secondary: opt_str(col(&headers, row, "email_secondary")),
            phone: opt_str(col(&headers, row, "phone")),
            mobile: opt_str(col(&headers, row, "mobile")),
            fax: opt_str(col(&headers, row, "fax")),
            website: opt_str(col(&headers, row, "website")),
            street: opt_str(col(&headers, row, "street")),
            street2: opt_str(col(&headers, row, "street2")),
            city: opt_str(col(&headers, row, "city")),
            state_code: opt_str(col(&headers, row, "state_code")),
            zip: opt_str(col(&headers, row, "zip")),
            country_code: opt_str(col(&headers, row, "country_code")),
            tax_id: opt_str(col(&headers, row, "tax_id")),
            company_registry: opt_str(col(&headers, row, "company_registry")),
            industry: opt_str(col(&headers, row, "industry")),
            employees_count: opt_i32(col(&headers, row, "employees_count")),
            annual_revenue: opt_f64(col(&headers, row, "annual_revenue")),
            description: opt_str(col(&headers, row, "notes")),
            is_customer: parse_bool(col(&headers, row, "is_customer")),
            is_vendor: parse_bool(col(&headers, row, "is_vendor")),
            is_employee: parse_bool(col(&headers, row, "is_employee")),
            is_prospect: parse_bool(col(&headers, row, "is_prospect")),
            is_partner: parse_bool(col(&headers, row, "is_partner")),
            customer_rank: 0,
            supplier_rank: 0,
            salesperson_id: None,
            assigned_user_id: None,
            parent_id,
            user_id: None,
            color: opt_str(col(&headers, row, "color")),
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            merge_target_id: None,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        record_import_created_id(ctx, job.id, "contact", created.id, row_num);
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import contact: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── Lead ──────────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_lead_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "lead", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "lead", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        // All relation columns below are optional on Lead — Missing → None,
        // Malformed (including literal "0") → reject the row, Valid → must
        // resolve through the scoped loader before it can be stored.
        let source_id_cell = col(&headers, row, "source_id");
        let source_id = match parse_relation_id(source_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("source_id"),
                    Some(source_id_cell),
                    "source_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => {
                if let Err(reason) = check_lead_source_ref(ctx, organization_id, id) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("source_id"),
                        Some(source_id_cell),
                        &format!("source_id: {reason}"),
                    );
                    errors += 1;
                    continue;
                }
                Some(id)
            }
        };

        let campaign_id_cell = col(&headers, row, "campaign_id");
        let campaign_id = match parse_relation_id(campaign_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("campaign_id"),
                    Some(campaign_id_cell),
                    "campaign_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => {
                if let Err(reason) = check_utm_campaign_ref(ctx, organization_id, id) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("campaign_id"),
                        Some(campaign_id_cell),
                        &format!("campaign_id: {reason}"),
                    );
                    errors += 1;
                    continue;
                }
                Some(id)
            }
        };

        let medium_id_cell = col(&headers, row, "medium_id");
        let medium_id = match parse_relation_id(medium_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("medium_id"),
                    Some(medium_id_cell),
                    "medium_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => {
                if let Err(reason) = check_utm_medium_ref(ctx, organization_id, id) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("medium_id"),
                        Some(medium_id_cell),
                        &format!("medium_id: {reason}"),
                    );
                    errors += 1;
                    continue;
                }
                Some(id)
            }
        };

        // team_id: no CRM team table exists in this schema yet to validate
        // against, so we can only reject missing/malformed/zero cells here;
        // a valid-looking id is stored as-is (see CRM-RI-002 for the broader
        // relation matrix once a team table lands).
        let team_id_cell = col(&headers, row, "team_id");
        let team_id = match parse_relation_id(team_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("team_id"),
                    Some(team_id_cell),
                    "team_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => Some(id),
        };

        let partner_id_cell = col(&headers, row, "partner_id");
        let partner_id = match parse_relation_id(partner_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("partner_id"),
                    Some(partner_id_cell),
                    "partner_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => {
                if let Err(reason) = check_contact_ref(ctx, organization_id, id) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("partner_id"),
                        Some(partner_id_cell),
                        &format!("partner_id: {reason}"),
                    );
                    errors += 1;
                    continue;
                }
                Some(id)
            }
        };

        ctx.db.lead().insert(Lead {
            id: 0,
            organization_id,
            name,
            email: opt_str(col(&headers, row, "email_from")),
            phone: opt_str(col(&headers, row, "phone")),
            mobile: opt_str(col(&headers, row, "mobile")),
            company_name: opt_str(col(&headers, row, "partner_name")),
            contact_name: opt_str(col(&headers, row, "contact_name")),
            title: opt_str(col(&headers, row, "title")),
            street: opt_str(col(&headers, row, "street")),
            city: opt_str(col(&headers, row, "city")),
            zip: opt_str(col(&headers, row, "zip")),
            country_code: opt_str(col(&headers, row, "country_code")),
            website: opt_str(col(&headers, row, "website")),
            industry: opt_str(col(&headers, row, "industry")),
            source_id,
            campaign_id,
            medium_id,
            referred_by: opt_str(col(&headers, row, "referred_by")),
            description: opt_str(col(&headers, row, "notes")),
            priority: {
                let p = col(&headers, row, "priority");
                if p.is_empty() {
                    "0".to_string()
                } else {
                    p.to_string()
                }
            },
            state: "new".to_string(),
            expected_revenue: parse_f64(col(&headers, row, "expected_revenue")),
            probability: parse_f64(col(&headers, row, "probability")),
            date_open: None,
            date_close: None,
            date_deadline: opt_timestamp(col(&headers, row, "date_deadline")),
            date_conversion: None,
            date_last_stage_update: None,
            user_id: None,
            team_id,
            partner_id,
            day_open: None,
            day_close: None,
            lost_reason_id: None,
            tag_ids: vec![],
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import lead: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── Opportunity ───────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_opportunity_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "opportunity", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "opportunity", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        // stage_id is required (Opportunity.stage_id is a plain `u64`, not
        // optional) — missing, malformed, or zero must reject the row rather
        // than silently defaulting to stage 0.
        let stage_id_cell = col(&headers, row, "stage_id");
        let stage_id = match parse_relation_id(stage_id_cell) {
            RelationId::Missing => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("stage_id"),
                    Some(stage_id_cell),
                    "stage_id is required",
                );
                errors += 1;
                continue;
            }
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("stage_id"),
                    Some(stage_id_cell),
                    "stage_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => {
                if let Err(reason) = check_opp_stage_ref(ctx, organization_id, id) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("stage_id"),
                        Some(stage_id_cell),
                        &format!("stage_id: {reason}"),
                    );
                    errors += 1;
                    continue;
                }
                id
            }
        };

        // company_id: optional in the CSV — resolve through the same
        // organization-scoped default-company helper interactive reducers
        // use, so an opportunity import never discards company ownership.
        let company_id_cell = col(&headers, row, "company_id");
        let requested_company_id = match parse_relation_id(company_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("company_id"),
                    Some(company_id_cell),
                    "company_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => Some(id),
        };
        let company_id = match company_id_from_scope(ctx, organization_id, requested_company_id) {
            Ok(id) => id,
            Err(reason) => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("company_id"),
                    Some(company_id_cell),
                    &format!("company_id: {reason}"),
                );
                errors += 1;
                continue;
            }
        };

        let lead_id_cell = col(&headers, row, "lead_id");
        let lead_id = match parse_relation_id(lead_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("lead_id"),
                    Some(lead_id_cell),
                    "lead_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => {
                if let Err(reason) = check_lead_ref(ctx, organization_id, id) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("lead_id"),
                        Some(lead_id_cell),
                        &format!("lead_id: {reason}"),
                    );
                    errors += 1;
                    continue;
                }
                Some(id)
            }
        };

        let partner_id_cell = col(&headers, row, "partner_id");
        let partner_id = match parse_relation_id(partner_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("partner_id"),
                    Some(partner_id_cell),
                    "partner_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => {
                if let Err(reason) = check_contact_ref(ctx, organization_id, id) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("partner_id"),
                        Some(partner_id_cell),
                        &format!("partner_id: {reason}"),
                    );
                    errors += 1;
                    continue;
                }
                Some(id)
            }
        };

        let contact_id_cell = col(&headers, row, "contact_id");
        let contact_id = match parse_relation_id(contact_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("contact_id"),
                    Some(contact_id_cell),
                    "contact_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => {
                if let Err(reason) = check_contact_ref(ctx, organization_id, id) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("contact_id"),
                        Some(contact_id_cell),
                        &format!("contact_id: {reason}"),
                    );
                    errors += 1;
                    continue;
                }
                Some(id)
            }
        };

        let source_id_cell = col(&headers, row, "source_id");
        let source_id = match parse_relation_id(source_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("source_id"),
                    Some(source_id_cell),
                    "source_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => {
                if let Err(reason) = check_lead_source_ref(ctx, organization_id, id) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("source_id"),
                        Some(source_id_cell),
                        &format!("source_id: {reason}"),
                    );
                    errors += 1;
                    continue;
                }
                Some(id)
            }
        };

        // company_currency_id: currency is a global (non-org-scoped)
        // reference table — only existence/active state is checked.
        let currency_id_cell = col(&headers, row, "currency_id");
        let company_currency_id = match parse_relation_id(currency_id_cell) {
            RelationId::Missing => None,
            RelationId::Malformed => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("currency_id"),
                    Some(currency_id_cell),
                    "currency_id: malformed or zero id, expected a positive integer",
                );
                errors += 1;
                continue;
            }
            RelationId::Valid(id) => {
                if let Err(reason) = check_currency_ref(ctx, id) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("currency_id"),
                        Some(currency_id_cell),
                        &format!("currency_id: {reason}"),
                    );
                    errors += 1;
                    continue;
                }
                Some(id)
            }
        };

        ctx.db.opportunity().insert(Opportunity {
            id: 0,
            organization_id,
            lead_id,
            name,
            expected_revenue: parse_f64(col(&headers, row, "planned_revenue")),
            probability: parse_f64(col(&headers, row, "probability")),
            stage_id,
            priority: {
                let p = col(&headers, row, "priority");
                if p.is_empty() {
                    "0".to_string()
                } else {
                    p.to_string()
                }
            },
            color: opt_str(col(&headers, row, "color")),
            partner_id,
            contact_id,
            campaign_id: None,
            medium_id: None,
            source_id,
            user_id: None,
            team_id: None,
            company_currency_id,
            company_id: Some(company_id),
            date_open: None,
            date_closed: opt_timestamp(col(&headers, row, "expected_closing")),
            date_deadline: None,
            date_last_stage_update: None,
            day_open: None,
            day_close: None,
            is_won: false,
            is_lost: false,
            lost_reason_id: None,
            description: opt_str(col(&headers, row, "description")),
            tag_ids: vec![],
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import opportunity: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}
