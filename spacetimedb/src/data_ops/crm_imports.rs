/// CRM CSV Imports — Contact, Lead, Opportunity
use spacetimedb::{ReducerContext, Table};

use crate::crm::contacts::{contact, Contact};
use crate::crm::leads::{lead, Lead};
use crate::crm::opportunities::{opportunity, Opportunity};
use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;

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

        let type_ = {
            let t = col(&headers, row, "type_");
            if t == "company" {
                "company".to_string()
            } else {
                "contact".to_string()
            }
        };

        ctx.db.contact().insert(Contact {
            id: 0,
            organization_id,
            company_id: opt_u64(col(&headers, row, "company_id")),
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
            parent_id: opt_u64(col(&headers, row, "parent_id")),
            user_id: None,
            color: opt_str(col(&headers, row, "color")),
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
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
            source_id: opt_u64(col(&headers, row, "source_id")),
            campaign_id: opt_u64(col(&headers, row, "campaign_id")),
            medium_id: opt_u64(col(&headers, row, "medium_id")),
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
            team_id: opt_u64(col(&headers, row, "team_id")),
            partner_id: opt_u64(col(&headers, row, "partner_id")),
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

        ctx.db.opportunity().insert(Opportunity {
            id: 0,
            organization_id,
            lead_id: opt_u64(col(&headers, row, "lead_id")),
            name,
            expected_revenue: parse_f64(col(&headers, row, "planned_revenue")),
            probability: parse_f64(col(&headers, row, "probability")),
            stage_id: parse_u64(col(&headers, row, "stage_id")),
            priority: {
                let p = col(&headers, row, "priority");
                if p.is_empty() {
                    "0".to_string()
                } else {
                    p.to_string()
                }
            },
            color: opt_str(col(&headers, row, "color")),
            partner_id: opt_u64(col(&headers, row, "partner_id")),
            contact_id: opt_u64(col(&headers, row, "contact_id")),
            campaign_id: None,
            medium_id: None,
            source_id: opt_u64(col(&headers, row, "source_id")),
            user_id: None,
            team_id: None,
            company_currency_id: opt_u64(col(&headers, row, "currency_id")),
            company_id: None,
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
