//! Durable execution reuses the approved proposal and its native request IDs.

use serde::{de::Error as _, Deserialize, Deserializer};
use serde_json::json;

use super::super::durable_runs::{ChunkReceipt, RunAuthority, RunChunk, RunGroup, SourceRevision};
use super::{
    model::{ActionBody, KIND, MAX_ROWS},
    storage, SavedProposal, StorageScope,
};
use crate::{cold_tier::pg_pool, error::ApiError, state::AppState};

const ADAPTER: &str = "historical_journal";

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProposalBinding {
    #[serde(deserialize_with = "proposal_id")]
    proposal_id: i64,
    expected_revision: i32,
    expected_digest: String,
}

fn proposal_id<'de, D: Deserializer<'de>>(input: D) -> Result<i64, D::Error> {
    let value = String::deserialize(input)?;
    value
        .parse::<i64>()
        .ok()
        .filter(|id| *id > 0 && id.to_string() == value)
        .ok_or_else(|| D::Error::custom("invalid journal proposal identity"))
}

impl ProposalBinding {
    fn action(&self, company_id: u64) -> ActionBody {
        ActionBody {
            company_id,
            expected_revision: self.expected_revision,
            expected_digest: self.expected_digest.clone(),
        }
    }
}

fn binding(group: &RunGroup) -> Result<ProposalBinding, ApiError> {
    if group.adapter != ADAPTER {
        return Err(ApiError::BadRequest(
            "invalid historical journal adapter".into(),
        ));
    }
    serde_json::from_value(group.config.clone())
        .map_err(|_| ApiError::BadRequest("invalid journal proposal binding".into()))
}

/// Held rows remain part of the review snapshot, without an approved journal effect.
pub(super) fn validate_sources(
    proposal: &SavedProposal,
    rows: &[SourceRevision],
) -> Result<(), ApiError> {
    let entries = &proposal.definition.entries;
    if proposal.definition.kind != KIND
        || proposal.approved_at.is_none()
        || entries.is_empty()
        || entries.len() > MAX_ROWS
    {
        return Err(ApiError::Conflict(
            "approve the historical journal proposal before starting its run".into(),
        ));
    }
    if entries.len() != rows.len()
        || !entries.iter().zip(rows).all(|(entry, row)| {
            entry.batch_id.parse::<i64>().ok() == Some(row.batch_id)
                && entry.item_id.parse::<i64>().ok() == Some(row.item_id)
                && entry.source_revision == row.revision
        })
    {
        return Err(ApiError::Conflict(
            "the run must use the approved journal proposal's exact ordered source revisions"
                .into(),
        ));
    }
    Ok(())
}

fn scope(authority: &RunAuthority) -> Result<StorageScope<'_>, ApiError> {
    if authority.context.organization_id() != authority.organization_id
        || authority.context.actor_identity() != authority.actor
        || !super::super::full_administrator(authority.context.field_access())
    {
        return Err(ApiError::Forbidden("invalid journal run authority".into()));
    }
    authority
        .context
        .require_company_scope(&[authority.company_id])?;
    Ok(StorageScope {
        organization: authority.organization_id,
        company: authority.company_id,
        actor: &authority.creator,
    })
}

async fn read_approved(
    authority: &RunAuthority,
    group: &RunGroup,
    binding: &ProposalBinding,
) -> Result<SavedProposal, ApiError> {
    let scoped = scope(authority)?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    super::super::tasks::handoff::lock_grant(&tx, scoped, &authority.actor, &group.task_id).await?;
    let proposal =
        storage::read_proposal(&tx, scoped, &group.task_id, binding.proposal_id, false).await?;
    proposal.require_approval(&binding.action(scoped.company), scoped.company)?;
    validate_sources(&proposal, &group.rows)?;
    storage::require_claims(&tx, scoped, &proposal).await?;
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(proposal)
}

pub(in crate::routes::import_reviews) async fn validate_durable_group(
    _state: &AppState,
    authority: &RunAuthority,
    group: &RunGroup,
) -> Result<(), ApiError> {
    read_approved(authority, group, &binding(group)?)
        .await
        .map(|_| ())
}

pub(in crate::routes::import_reviews) async fn execute_chunk(
    state: &AppState,
    authority: &RunAuthority,
    group: &RunGroup,
    chunk: &RunChunk,
) -> Result<ChunkReceipt, ApiError> {
    if chunk.ordinal != 0 || group.rows != chunk.rows {
        return Err(ApiError::Conflict(
            "a historical journal proposal must execute as one complete chunk".into(),
        ));
    }
    let binding = binding(group)?;
    let scoped = scope(authority)?;
    let proposal = read_approved(authority, group, &binding).await?;
    // The executor can finish before the shared worker commits its lease receipt.
    // Keep the immutable verified draft proof even if a clerk later posts it.
    let proposal = if proposal.state == "verified" && proposal.result.is_some() {
        proposal
    } else {
        let (proposal, failure) = super::run_approved(
            state,
            &authority.session,
            &authority.context,
            scoped,
            &group.task_id,
            binding.proposal_id,
            &binding.action(scoped.company),
            true,
        )
        .await?;
        if let Some(error) = failure {
            return Err(error);
        }
        proposal
    };
    let result = proposal
        .result
        .filter(|result| {
            proposal.state == "verified"
                && result.record_count == group.rows.len()
                && result.line_count == group.rows.len() * 2
                && result.posted_count == 0
        })
        .ok_or_else(|| ApiError::Conflict("journal drafts have not been verified".into()))?;
    Ok(ChunkReceipt {
        result: json!({
            "proposalId": proposal.id.to_string(),
            "proposalRevision": proposal.revision,
            "proposalDigest": proposal.digest,
            "verifiedItemIds": group.rows.iter().map(|row| row.item_id.to_string()).collect::<Vec<_>>(),
            "failedRows": 0,
            "heldRows": 0,
            "nativeExecution": proposal.execution,
            "verified": result,
        }),
    })
}
