/// Subscription CSV Imports — SubscriptionPlan, Subscription
use spacetimedb::{ReducerContext, Table};

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;
use crate::subscriptions::tables::{
    subscription, subscription_plan, Subscription, SubscriptionPlan,
};

// ── SubscriptionPlan ──────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_subscription_plan_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription_plan", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "subscription_plan",
        None,
        rows.len() as u32,
    );
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

        let currency_id = parse_u64(col(&headers, row, "currency_id"));
        let journal_id = parse_u64(col(&headers, row, "journal_id"));
        let product_id = parse_u64(col(&headers, row, "product_id"));

        let code = {
            let v = col(&headers, row, "code");
            if v.is_empty() {
                name.to_uppercase().replace(' ', "_")
            } else {
                v.to_string()
            }
        };

        ctx.db.subscription_plan().insert(SubscriptionPlan {
            id: 0,
            organization_id,
            name,
            description: col(&headers, row, "description").to_string(),
            code,
            active: true,
            company_id,
            currency_id,
            journal_id,
            product_id,
            billing_period: {
                let v = col(&headers, row, "billing_period");
                if v.is_empty() {
                    "month".to_string()
                } else {
                    v.to_string()
                }
            },
            billing_period_unit: {
                let v = parse_u32(col(&headers, row, "billing_period_unit"));
                if v == 0 {
                    1
                } else {
                    v
                }
            },
            recurring_invoice_day: {
                let v = parse_u8(col(&headers, row, "recurring_invoice_day"));
                if v == 0 {
                    1
                } else {
                    v
                }
            },
            trial_period: parse_bool(col(&headers, row, "trial_period")),
            trial_duration: parse_u32(col(&headers, row, "trial_duration")),
            trial_unit: {
                let v = col(&headers, row, "trial_unit");
                if v.is_empty() {
                    "day".to_string()
                } else {
                    v.to_string()
                }
            },
            auto_close_limit: {
                let v = parse_u32(col(&headers, row, "auto_close_limit"));
                if v == 0 {
                    3
                } else {
                    v
                }
            },
            template_id: None,
            invoice_mail_template_id: None,
            user_id: None,
            website_url: None,
            is_published: false,
            is_default: false,
            color: 0,
            image_1920_url: None,
            recurring_rule_count: 0,
            recurring_rule_min_unit: "month".to_string(),
            recurring_rule_max_unit: "year".to_string(),
            recurring_rule_min_count: 1,
            recurring_rule_max_count: 12,
            close_reason_id: None,
            payment_mode: {
                let v = col(&headers, row, "payment_mode");
                if v.is_empty() {
                    "draft_invoice".to_string()
                } else {
                    v.to_string()
                }
            },
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: col(&headers, row, "metadata").to_string(),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import subscription_plan: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── Subscription ──────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_subscription_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "subscription",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let plan_id = parse_u64(col(&headers, row, "plan_id"));
        let partner_id = parse_u64(col(&headers, row, "partner_id"));

        if plan_id == 0 || partner_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("plan_id"),
                None,
                "plan_id and partner_id are required",
            );
            errors += 1;
            continue;
        }

        let currency_id = parse_u64(col(&headers, row, "currency_id"));
        let pricelist_id = parse_u64(col(&headers, row, "pricelist_id"));
        let date_start = opt_timestamp(col(&headers, row, "date_start")).unwrap_or(ctx.timestamp);
        let recurring_next_date =
            opt_timestamp(col(&headers, row, "recurring_next_date")).unwrap_or(ctx.timestamp);

        let code = {
            let v = col(&headers, row, "code");
            if v.is_empty() {
                format!("SUB-{}", imported + 1)
            } else {
                v.to_string()
            }
        };

        ctx.db.subscription().insert(Subscription {
            id: 0,
            organization_id,
            code,
            description: col(&headers, row, "description").to_string(),
            plan_id,
            partner_id,
            partner_invoice_id: {
                let v = parse_u64(col(&headers, row, "partner_invoice_id"));
                if v == 0 {
                    partner_id
                } else {
                    v
                }
            },
            partner_shipping_id: {
                let v = parse_u64(col(&headers, row, "partner_shipping_id"));
                if v == 0 {
                    partner_id
                } else {
                    v
                }
            },
            company_id,
            currency_id,
            pricelist_id,
            analytic_account_id: opt_u64(col(&headers, row, "analytic_account_id")),
            date_start,
            date: ctx.timestamp,
            recurring_next_date,
            recurring_invoice_day: {
                let v = parse_u8(col(&headers, row, "recurring_invoice_day"));
                if v == 0 {
                    1
                } else {
                    v
                }
            },
            recurring_rule_type: {
                let v = col(&headers, row, "recurring_rule_type");
                if v.is_empty() {
                    "monthly".to_string()
                } else {
                    v.to_string()
                }
            },
            recurring_interval: {
                let v = parse_u32(col(&headers, row, "recurring_interval"));
                if v == 0 {
                    1
                } else {
                    v
                }
            },
            close_reason_id: None,
            close_date: None,
            payment_token_id: None,
            payment_mode: "draft_invoice".to_string(),
            user_id: None,
            team_id: None,
            health: "healthy".to_string(),
            stage_id: opt_u64(col(&headers, row, "stage_id")),
            state: "draft".to_string(),
            is_active: true,
            is_trial: false,
            invoice_count: 0,
            vendor_id: None,
            recurring_total: 0.0,
            recurring_monthly: 0.0,
            recurring_mrr: 0.0,
            recurring_mrr_local: 0.0,
            percentage_mrr: 0.0,
            kpi_1month_mrr: 0.0,
            kpi_3months_mrr: 0.0,
            kpi_12months_mrr: 0.0,
            rating_last_value: 0,
            invoice_ids: vec![],
            sale_order_ids: vec![],
            subscription_line_ids: vec![],
            activity_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: col(&headers, row, "metadata").to_string(),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import subscription: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}
