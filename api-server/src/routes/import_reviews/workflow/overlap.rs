//! Candidate holds and explicit, source-bound distinct-expense decisions.
//! Exact source/reference duplicates cannot be waived by a similarity decision.
use std::collections::{BTreeMap, BTreeSet};

use serde_json::json;
use tokio_postgres::Transaction;

use super::super::StorageScope;
use super::model::*;
use crate::error::ApiError;

#[cfg(test)]
mod tests;

const MAX_REVIEWABLE_CANDIDATES: usize = 25;

/// Serialize approval admission across actors, tasks and API processes. Hash
/// collisions only serialize unrelated companies; they cannot widen scope.
pub(super) async fn lock_company(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
) -> Result<(), ApiError> {
    let key = format!(
        "lumiere-import-expense-claims/v1:{}:{}",
        scope.organization, scope.company
    );
    tx.query_one(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        &[&key],
    )
    .await
    .map_err(ApiError::internal)?;
    Ok(())
}

pub(super) async fn hold_candidates(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    definition: &mut Definition,
    own_proposal: Option<i64>,
) -> Result<(), ApiError> {
    if definition.entries.is_empty() {
        return apply_candidate_holds(scope, definition, BTreeMap::new());
    }
    let entries = json!(definition.entries.iter().map(|entry| json!({
        "itemId":entry.item_id,"sourceKey":claim_key(entry),"amount":entry.amount,
        "currencyId":definition.configuration.currency_id,"dateFrom":entry.business_identity.date_from,
        "dateTo":entry.business_identity.date_to_exclusive,"externalReference":entry.business_identity.external_reference,
    })).collect::<Vec<_>>());
    // The 26th candidate is a sentinel. A truncated set has no resolvable
    // fingerprint; operators can never approve only the displayed subset.
    let rows = tx.query(
        "SELECT selected.value->>'itemId' AS current_item,candidate.*
         FROM jsonb_array_elements($3::jsonb) selected(value)
         JOIN LATERAL (
             SELECT claim.proposal_id::text,proposal.proposal_sha256,claim.item_id::text,claim.source_revision,
                    claim.business_date_from::text AS date_from,claim.business_date_to::text AS date_to,
                    claim.posting_date::text,claim.amount::text,claim.currency_id::text,claim.external_reference,
                    (SELECT entry.value->'businessIdentity'->>'category'
                     FROM jsonb_array_elements(proposal.definition_json->'entries') entry(value)
                     WHERE entry.value->>'itemId'=claim.item_id::text LIMIT 1) AS category,
                    CASE WHEN claim.source_key=selected.value->>'sourceKey' THEN 'same_source'
                         WHEN claim.external_reference=selected.value->>'externalReference' THEN 'same_reference'
                         ELSE 'overlapping_period_amount' END AS reason
             FROM lumiere_platform.import_workflow_source_claim claim
             JOIN lumiere_platform.import_workflow_proposal proposal
               ON proposal.organization_id=claim.organization_id AND proposal.company_id=claim.company_id AND proposal.id=claim.proposal_id
             WHERE claim.organization_id=$1::text::numeric AND claim.company_id=$2::text::numeric
               AND claim.effect_kind=$4 AND claim.released_at IS NULL AND ($5::bigint IS NULL OR claim.proposal_id<>$5)
               AND (claim.source_key=selected.value->>'sourceKey'
                    OR (claim.currency_id=(selected.value->>'currencyId')::numeric
                        AND ((claim.external_reference IS NOT NULL AND claim.external_reference=selected.value->>'externalReference')
                             OR (claim.amount=(selected.value->>'amount')::numeric
                                 AND claim.business_date_from<(selected.value->>'dateTo')::date
                                 AND claim.business_date_to>(selected.value->>'dateFrom')::date))))
             ORDER BY claim.proposal_id,claim.item_id LIMIT 26
         ) candidate ON true ORDER BY current_item,candidate.proposal_id,candidate.item_id",
        &[&scope.organization.to_string(),&scope.company.to_string(),&entries,&KIND,&own_proposal]
    ).await.map_err(ApiError::internal)?;
    let mut candidates: BTreeMap<String, Vec<OverlapCandidate>> = BTreeMap::new();
    for row in rows {
        candidates
            .entry(row.get("current_item"))
            .or_default()
            .push(OverlapCandidate {
                origin: "saved_proposal".into(),
                proposal_id: Some(row.get("proposal_id")),
                proposal_digest: Some(row.get("proposal_sha256")),
                item_id: row.get("item_id"),
                source_revision: row.get("source_revision"),
                reason: row.get("reason"),
                date_from: row.get("date_from"),
                date_to_exclusive: row.get("date_to"),
                posting_date: row.get("posting_date"),
                amount: row.get("amount"),
                currency_id: row.get("currency_id"),
                external_reference: row.get("external_reference"),
                category: row.get("category"),
            });
    }
    apply_candidate_holds(scope, definition, candidates)
}

fn selected_candidate(left: &Entry, right: &Entry, currency: &str) -> Option<OverlapCandidate> {
    let a = &left.business_identity;
    let b = &right.business_identity;
    let reason = if claim_key(left) == claim_key(right) {
        "same_source"
    } else if a.external_reference.is_some() && a.external_reference == b.external_reference {
        "same_reference"
    } else if left.amount == right.amount
        && a.date_from < b.date_to_exclusive
        && b.date_from < a.date_to_exclusive
    {
        "overlapping_period_amount"
    } else {
        return None;
    };
    Some(OverlapCandidate {
        origin: "selected_rows".into(),
        proposal_id: None,
        proposal_digest: None,
        item_id: right.item_id.clone(),
        source_revision: right.source_revision,
        reason: reason.into(),
        date_from: b.date_from.clone(),
        date_to_exclusive: b.date_to_exclusive.clone(),
        posting_date: right.date.clone(),
        amount: right.amount.clone(),
        currency_id: currency.into(),
        external_reference: b.external_reference.clone(),
        category: b.category.clone(),
    })
}

fn candidate_digest(
    scope: StorageScope<'_>,
    entry: &Entry,
    candidates: &[OverlapCandidate],
) -> Result<String, ApiError> {
    Ok(hash(&serde_json::to_vec(&json!({
        "version":1,"effectKind":KIND,"organizationId":scope.organization.to_string(),
        "companyId":scope.company.to_string(),"actor":scope.actor,"source":entry,"candidates":candidates,
    })).map_err(ApiError::internal)?))
}

/// Applies the complete currently observed candidate set. Approved reasons are
/// accepted only for uncertain period/amount matches, then retained in the
/// immutable configuration for approval and execution to revalidate.
pub(super) fn apply_candidate_holds(
    scope: StorageScope<'_>,
    definition: &mut Definition,
    mut prior: BTreeMap<String, Vec<OverlapCandidate>>,
) -> Result<(), ApiError> {
    definition.configuration.validate()?;
    let decisions = definition
        .configuration
        .distinct_expenses
        .iter()
        .map(|decision| (decision.item_id.as_str(), decision))
        .collect::<BTreeMap<_, _>>();
    let mut accepted = BTreeSet::new();
    let mut ready = Vec::with_capacity(definition.entries.len());
    let mut issues = Vec::new();
    for entry in &definition.entries {
        let mut candidates = prior.remove(&entry.item_id).unwrap_or_default();
        candidates.extend(
            definition
                .entries
                .iter()
                .filter(|other| other.item_id != entry.item_id)
                .filter_map(|other| {
                    selected_candidate(entry, other, &definition.configuration.currency_id)
                }),
        );
        candidates.sort();
        let decision = decisions.get(entry.item_id.as_str());
        if candidates.is_empty() {
            if decision.is_some() {
                return Err(ApiError::Conflict("a distinct-expense decision no longer matches a current candidate; prepare a fresh preview without that decision".into()));
            }
            ready.push(entry.clone());
            continue;
        }
        let complete = candidates.len() <= MAX_REVIEWABLE_CANDIDATES;
        let uncertain_only = candidates
            .iter()
            .all(|candidate| candidate.reason == "overlapping_period_amount");
        let resolution = if complete && uncertain_only {
            Some(DistinctExpenseResolution {
                kind: "distinct_expenses".into(),
                candidate_digest: candidate_digest(scope, entry, &candidates)?,
            })
        } else {
            None
        };
        if let Some(decision) = decision {
            if decision.source_revision != entry.source_revision
                || !resolution.as_ref().is_some_and(|resolution| {
                    resolution.candidate_digest == decision.candidate_digest
                })
            {
                return Err(ApiError::Conflict("the distinct-expense candidate set changed or includes an exact source/reference duplicate; inspect a fresh preview before deciding again".into()));
            }
            accepted.insert(entry.item_id.as_str());
            ready.push(entry.clone());
            continue;
        }
        let prior_match = candidates
            .iter()
            .any(|candidate| candidate.origin == "saved_proposal");
        let message = if !complete {
            "More than 25 candidate records overlap this expense. The row remains held; narrow the source group or resolve earlier imports before making a distinct-record decision."
        } else if !uncertain_only {
            "This expense shares its original source row or confirmed external reference with another record. Exclude the duplicate or correct its supported identity; a distinct-record assertion cannot waive this hold."
        } else {
            "Compare the listed source records. If they describe different expenses, record the supporting reason and prepare a new preview before separately approving any ERP creation."
        };
        candidates.truncate(MAX_REVIEWABLE_CANDIDATES);
        issues.push(Issue {
            item_id: Some(entry.item_id.clone()),
            code: if prior_match {
                "possible_prior_expense"
            } else {
                "possible_source_overlap"
            }
            .into(),
            message: message.into(),
            candidates,
            resolution,
        });
    }
    if decisions.keys().any(|item| !accepted.contains(item)) {
        return Err(ApiError::Conflict("a distinct-expense decision refers to an excluded, changed or unselected source; prepare a fresh preview with its current facts".into()));
    }
    definition.entries = ready;
    definition.issues.extend(issues);
    refresh_summary(definition)
}
