//! Sender-scoped read views for private H5b spend and draft-request state.
//!
//! The caller sees rows only for organizations where its identity is the
//! active `ai_spend_reader` service binding. The views expose only the fields
//! required by the gateway's deterministic admission and replay logic.

use spacetimedb::{SpacetimeType, ViewContext};

use crate::ai::action_drafts::{
    ai_action_draft_request__view, AiActionDraftRequest,
};
use crate::ai::spend::{
    ai_price_snapshot__view, ai_provider_attempt__view, ai_spend_budget__view,
    ai_spend_reservation__view, AiPriceSnapshot, AiProviderAttempt, AiSpendBudget,
    AiSpendReservation,
};
use crate::core::cold_tier_identity::{
    cold_tier_service_identity__view, AI_SPEND_READER_SERVICE,
};

#[derive(Clone, SpacetimeType)]
pub struct AiSpendPriceSnapshotRead {
    pub id: u64,
    pub organization_id: u64,
    pub agent_id: u64,
    pub provider: String,
    pub model: String,
    pub currency: String,
    pub input_units_per_1k: u64,
    pub output_units_per_1k: u64,
    pub version: u64,
}

#[derive(Clone, SpacetimeType)]
pub struct AiSpendBudgetRead {
    pub id: u64,
    pub organization_id: u64,
    pub agent_id: u64,
    pub billing_period: String,
    pub currency: String,
    pub limit_units: u64,
    pub settled_units: u64,
    pub outstanding_units: u64,
}

#[derive(Clone, SpacetimeType)]
pub struct AiSpendReservationRead {
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub run_id: u64,
    pub request_key: String,
    pub provider: String,
    pub model: String,
    pub billing_period: String,
    pub currency: String,
    pub price_snapshot_id: u64,
    pub reserved_units: u64,
    pub settled_units: u64,
    pub input_token_allowance: u32,
    pub output_token_allowance: u32,
    pub status: String,
    pub settled_input_tokens: u32,
    pub settled_output_tokens: u32,
}

#[derive(Clone, SpacetimeType)]
pub struct AiActionDraftRequestRead {
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub request_key: String,
    pub draft_id: u64,
    pub creation_payload_hash: String,
}

#[derive(Clone, SpacetimeType)]
pub struct AiProviderAttemptRead {
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub run_id: u64,
    pub reservation_id: u64,
    pub request_key: String,
    pub provider: String,
    pub model: String,
    pub status: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub failure_reason: Option<String>,
}

fn authorized_organization_ids(ctx: &ViewContext) -> Vec<u64> {
    ctx.db
        .cold_tier_service_identity()
        .cold_tier_service_identity_by_identity()
        .filter(ctx.sender())
        .filter(|binding| binding.is_active && binding.service_name == AI_SPEND_READER_SERVICE)
        .map(|binding| binding.organization_id)
        .collect()
}

#[spacetimedb::view(
    accessor = ai_spend_price_snapshot_read,
    public,
    primary_key = id
)]
pub fn ai_spend_price_snapshot_read(ctx: &ViewContext) -> Vec<AiSpendPriceSnapshotRead> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_price_snapshot()
                .ai_price_snapshot_by_org()
                .filter(&organization_id)
                .map(AiSpendPriceSnapshotRead::from)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_spend_budget_read, public, primary_key = id)]
pub fn ai_spend_budget_read(ctx: &ViewContext) -> Vec<AiSpendBudgetRead> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_spend_budget()
                .ai_spend_budget_by_org()
                .filter(&organization_id)
                .map(AiSpendBudgetRead::from)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_spend_reservation_read, public, primary_key = id)]
pub fn ai_spend_reservation_read(ctx: &ViewContext) -> Vec<AiSpendReservationRead> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_spend_reservation()
                .ai_spend_reservation_by_org()
                .filter(&organization_id)
                .map(AiSpendReservationRead::from)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_action_draft_request_read, public, primary_key = id)]
pub fn ai_action_draft_request_read(ctx: &ViewContext) -> Vec<AiActionDraftRequestRead> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_action_draft_request()
                .ai_action_draft_request_by_org()
                .filter(&organization_id)
                .map(AiActionDraftRequestRead::from)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_provider_attempt_read, public, primary_key = id)]
pub fn ai_provider_attempt_read(ctx: &ViewContext) -> Vec<AiProviderAttemptRead> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_provider_attempt()
                .ai_provider_attempt_by_org()
                .filter(&organization_id)
                .map(AiProviderAttemptRead::from)
                .collect::<Vec<_>>()
        })
        .collect()
}

impl From<AiPriceSnapshot> for AiSpendPriceSnapshotRead {
    fn from(row: AiPriceSnapshot) -> Self {
        Self {
            id: row.id,
            organization_id: row.organization_id,
            agent_id: row.agent_id,
            provider: row.provider,
            model: row.model,
            currency: row.currency,
            input_units_per_1k: row.input_units_per_1k,
            output_units_per_1k: row.output_units_per_1k,
            version: row.version,
        }
    }
}

impl From<AiSpendBudget> for AiSpendBudgetRead {
    fn from(row: AiSpendBudget) -> Self {
        Self {
            id: row.id,
            organization_id: row.organization_id,
            agent_id: row.agent_id,
            billing_period: row.billing_period,
            currency: row.currency,
            limit_units: row.limit_units,
            settled_units: row.settled_units,
            outstanding_units: row.outstanding_units,
        }
    }
}

impl From<AiSpendReservation> for AiSpendReservationRead {
    fn from(row: AiSpendReservation) -> Self {
        Self {
            id: row.id,
            organization_id: row.organization_id,
            company_id: row.company_id,
            agent_id: row.agent_id,
            run_id: row.run_id,
            request_key: row.request_key,
            provider: row.provider,
            model: row.model,
            billing_period: row.billing_period,
            currency: row.currency,
            price_snapshot_id: row.price_snapshot_id,
            reserved_units: row.reserved_units,
            settled_units: row.settled_units,
            input_token_allowance: row.input_token_allowance,
            output_token_allowance: row.output_token_allowance,
            status: row.status,
            settled_input_tokens: row.settled_input_tokens,
            settled_output_tokens: row.settled_output_tokens,
        }
    }
}

impl From<AiActionDraftRequest> for AiActionDraftRequestRead {
    fn from(row: AiActionDraftRequest) -> Self {
        Self {
            id: row.id,
            organization_id: row.organization_id,
            company_id: row.company_id,
            run_id: row.run_id,
            request_key: row.request_key,
            draft_id: row.draft_id,
            creation_payload_hash: row.creation_payload_hash,
        }
    }
}

impl From<AiProviderAttempt> for AiProviderAttemptRead {
    fn from(row: AiProviderAttempt) -> Self {
        Self {
            id: row.id,
            organization_id: row.organization_id,
            company_id: row.company_id,
            agent_id: row.agent_id,
            run_id: row.run_id,
            reservation_id: row.reservation_id,
            request_key: row.request_key,
            provider: row.provider,
            model: row.model,
            status: row.status,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            failure_reason: row.failure_reason,
        }
    }
}
