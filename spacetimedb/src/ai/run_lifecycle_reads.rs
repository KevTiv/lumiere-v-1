//! Sender-scoped lifecycle recovery reads for the existing AI runtime reader.
//!
//! Source tables stay private. Active `ai_spend_reader` bindings constrain rows
//! to their organizations. The gateway separately checks the current actor's
//! company and lifecycle capability before reading or dispatching a command.
//! Queue payloads/authors and lifecycle event payloads never enter these views.

use super::budget_park::ai_run_budget_park__view;
use super::run_followup_queue::ai_run_queued_input__view;
use super::run_lifecycle::{
    ai_run_lifecycle_event__view, ai_run_lifecycle_state__view, ai_run_question__view,
};
use super::spend_reads::authorized_organization_ids;
use spacetimedb::{SpacetimeType, Timestamp, ViewContext};

#[derive(Clone, SpacetimeType)]
pub struct AiRunStateRead {
    pub run_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub state: String,
    pub checkpoint_hash: String,
    pub cursor: u32,
    pub concurrency_version: u64,
}

#[spacetimedb::view(accessor = ai_run_lifecycle_state_read, public, primary_key = run_id)]
pub fn ai_run_lifecycle_state_read(ctx: &ViewContext) -> Vec<AiRunStateRead> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_run_lifecycle_state()
                .ai_run_lifecycle_state_by_org()
                .filter(&org)
                .map(|row| AiRunStateRead {
                    run_id: row.run_id,
                    organization_id: row.organization_id,
                    company_id: row.company_id,
                    state: row.state,
                    checkpoint_hash: row.checkpoint_hash,
                    cursor: row.cursor,
                    concurrency_version: row.concurrency_version,
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

#[derive(Clone, SpacetimeType)]
pub struct AiRunEventRead {
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub event_kind: String,
    pub from_version: u64,
    pub to_version: u64,
    pub cursor: u32,
    pub created_at: Timestamp,
}

#[spacetimedb::view(accessor = ai_run_lifecycle_event_read, public, primary_key = id)]
pub fn ai_run_lifecycle_event_read(ctx: &ViewContext) -> Vec<AiRunEventRead> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_run_lifecycle_event()
                .ai_run_lifecycle_event_by_org()
                .filter(&org)
                .map(|row| AiRunEventRead {
                    id: row.id,
                    organization_id: row.organization_id,
                    company_id: row.company_id,
                    run_id: row.run_id,
                    event_kind: row.event_kind,
                    from_version: row.from_version,
                    to_version: row.to_version,
                    cursor: row.cursor,
                    created_at: row.created_at,
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

#[derive(Clone, SpacetimeType)]
pub struct AiRunQuestionRead {
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub question_key: String,
    pub revision: u64,
    pub prompt: String,
    pub required: bool,
    pub status: String,
    pub answer_json: Option<String>,
}

#[spacetimedb::view(accessor = ai_run_question_read, public, primary_key = id)]
pub fn ai_run_question_read(ctx: &ViewContext) -> Vec<AiRunQuestionRead> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_run_question()
                .ai_run_question_by_org()
                .filter(&org)
                .map(|row| AiRunQuestionRead {
                    id: row.id,
                    organization_id: row.organization_id,
                    company_id: row.company_id,
                    run_id: row.run_id,
                    question_key: row.question_key,
                    revision: row.revision,
                    prompt: row.prompt,
                    required: row.required,
                    status: row.status,
                    answer_json: row.answer_json,
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

#[derive(Clone, SpacetimeType)]
pub struct AiRunQueuedInputRead {
    pub queued_input_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub position: u32,
    pub revision: u64,
    pub status: String,
    pub promoted_run_id: Option<u64>,
}

#[spacetimedb::view(accessor = ai_run_queued_input_read, public, primary_key = queued_input_id)]
pub fn ai_run_queued_input_read(ctx: &ViewContext) -> Vec<AiRunQueuedInputRead> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_run_queued_input()
                .ai_run_queued_input_by_org()
                .filter(&org)
                .map(|row| AiRunQueuedInputRead {
                    queued_input_id: row.queued_input_id,
                    organization_id: row.organization_id,
                    company_id: row.company_id,
                    run_id: row.run_id,
                    position: row.position,
                    revision: row.revision,
                    status: row.status,
                    promoted_run_id: row.promoted_run_id,
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

#[derive(Clone, SpacetimeType)]
pub struct AiRunBudgetParkRead {
    pub run_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub park_generation: u64,
    pub reason: String,
    pub status: String,
    pub window_resets_at: Timestamp,
    pub max_park_until: Timestamp,
    pub required_units: u64,
    pub input_token_allowance: u32,
    pub output_token_allowance: u32,
    pub agent_id: u64,
    pub provider: String,
    pub model: String,
    pub resume_trigger: Option<String>,
}

#[spacetimedb::view(accessor = ai_run_budget_park_read, public, primary_key = run_id)]
pub fn ai_run_budget_park_read(ctx: &ViewContext) -> Vec<AiRunBudgetParkRead> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_run_budget_park()
                .ai_run_budget_park_by_org()
                .filter(&org)
                .map(|row| AiRunBudgetParkRead {
                    run_id: row.run_id,
                    organization_id: row.organization_id,
                    company_id: row.company_id,
                    park_generation: row.park_generation,
                    reason: row.reason,
                    status: row.status,
                    window_resets_at: row.window_resets_at,
                    max_park_until: row.max_park_until,
                    required_units: row.required_units,
                    input_token_allowance: row.input_token_allowance,
                    output_token_allowance: row.output_token_allowance,
                    agent_id: row.agent_id,
                    provider: row.provider,
                    model: row.model,
                    resume_trigger: row.resume_trigger,
                })
                .collect::<Vec<_>>()
        })
        .collect()
}
