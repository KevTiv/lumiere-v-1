/// AI CSV Imports — AiAgent
use spacetimedb::{ReducerContext, Table};

use crate::ai::agents::{ai_agent, AiAgent};
use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;

// ── AiAgent ───────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_ai_agent_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "ai_agent", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();
        let model = col(&headers, row, "model").to_string();

        if name.is_empty() || model.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name and model are required");
            errors += 1;
            continue;
        }

        let provider = {
            let v = col(&headers, row, "provider");
            if v.is_empty() { "anthropic".to_string() } else { v.to_string() }
        };

        let temperature = {
            let v = parse_f64(col(&headers, row, "temperature"));
            if v == 0.0 { 0.7 } else { v }
        };

        ctx.db.ai_agent().insert(AiAgent {
            id: 0,
            organization_id,
            name,
            description: opt_str(col(&headers, row, "description")),
            model,
            provider,
            api_key_reference: opt_str(col(&headers, row, "api_key_reference")),
            temperature,
            max_tokens: {
                let v = parse_u32(col(&headers, row, "max_tokens"));
                if v == 0 { 4096 } else { v }
            },
            top_p: {
                let v = parse_f64(col(&headers, row, "top_p"));
                if v == 0.0 { 1.0 } else { v }
            },
            frequency_penalty: parse_f64(col(&headers, row, "frequency_penalty")),
            presence_penalty: parse_f64(col(&headers, row, "presence_penalty")),
            system_prompt: opt_str(col(&headers, row, "system_prompt")),
            context_window: {
                let v = parse_u32(col(&headers, row, "context_window"));
                if v == 0 { 200000 } else { v }
            },
            is_active: true,
            is_default: parse_bool(col(&headers, row, "is_default")),
            allowed_models: vec_str(col(&headers, row, "allowed_models")),
            allowed_actions: vec_str(col(&headers, row, "allowed_actions")),
            rate_limit_per_minute: {
                let v = parse_u32(col(&headers, row, "rate_limit_per_minute"));
                if v == 0 { 60 } else { v }
            },
            cost_per_1k_tokens: parse_f64(col(&headers, row, "cost_per_1k_tokens")),
            monthly_budget: opt_f64(col(&headers, row, "monthly_budget")),
            monthly_spend: 0.0,
            company_id: opt_u64(col(&headers, row, "company_id")),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import ai_agent: imported={}, errors={}", imported, errors);
    Ok(())
}
