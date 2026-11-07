use super::*;
use anyhow::{ensure, Result};

fn scope() -> StorageScope<'static> {
    StorageScope {
        organization: 1,
        company: 2,
        actor: "operator",
    }
}

fn entry(item: &str) -> Entry {
    Entry {
        item_id: item.into(),
        batch_id: "10".into(),
        source_revision: 3,
        source_file: "history.csv".into(),
        source_row: item.parse::<u32>().unwrap_or(1) + 1,
        source_sha256: "a".repeat(64),
        reference: format!("SOURCE-{item}"),
        date: "2026-01-01".into(),
        description: format!("Electricity {item}"),
        amount: "100".into(),
        business_identity: BusinessIdentity {
            date_from: "2024-01-05".into(),
            date_to_exclusive: "2024-01-06".into(),
            external_reference: Some(format!("bill-{item}")),
            category: Some("electricity".into()),
        },
    }
}

fn definition(entries: Vec<Entry>) -> Result<Definition> {
    let mut value = Definition {
        kind: KIND.into(),
        configuration: Configuration {
            journal_id: "7".into(),
            debit_account_id: "8".into(),
            credit_account_id: "9".into(),
            currency_id: "2".into(),
            date_field: "date".into(),
            amount_field: "amount".into(),
            description_field: None,
            posting_date: Some("2026-01-01".into()),
            reason: "Reviewed historical expenses at cutover".into(),
            distinct_expenses: Vec::new(),
        },
        summary: Summary {
            record_count: 0,
            line_count: 0,
            blocked_count: 0,
            total_debit: "0".into(),
            total_credit: "0".into(),
            currency_id: "2".into(),
            date_from: None,
            date_to: None,
        },
        sources: entries
            .iter()
            .map(|entry| SourceVersion {
                item_id: entry.item_id.clone(),
                batch_id: entry.batch_id.clone(),
                revision: entry.source_revision,
            })
            .collect(),
        entries,
        issues: Vec::new(),
    };
    refresh_summary(&mut value)?;
    Ok(value)
}

fn prior(item: usize) -> OverlapCandidate {
    OverlapCandidate {
        origin: "saved_proposal".into(),
        proposal_id: Some((item + 100).to_string()),
        proposal_digest: Some("b".repeat(64)),
        item_id: (item + 1000).to_string(),
        source_revision: 2,
        reason: "overlapping_period_amount".into(),
        date_from: "2024-01-05".into(),
        date_to_exclusive: "2024-01-06".into(),
        posting_date: "2026-01-01".into(),
        amount: "100.000000".into(),
        currency_id: "2".into(),
        external_reference: Some(format!("other-bill-{item}")),
        category: Some("electricity".into()),
    }
}

fn decisions(preview: &Definition) -> Vec<DistinctExpenseDecision> {
    preview
        .issues
        .iter()
        .filter_map(|issue| {
            Some(DistinctExpenseDecision {
                item_id: issue.item_id.clone()?,
                source_revision: 3,
                candidate_digest: issue.resolution.as_ref()?.candidate_digest.clone(),
                reason: "Different meter numbers and original invoices establish separate expenses"
                    .into(),
            })
        })
        .collect()
}

#[test]
fn distinct_same_day_expenses_require_explicit_complete_candidate_decisions() -> Result<()> {
    let original = definition(vec![entry("1"), entry("2")])?;
    let mut held = original.clone();
    apply_candidate_holds(scope(), &mut held, BTreeMap::new())?;
    ensure!(held.entries.is_empty() && held.issues.len() == 2);
    ensure!(held.issues.iter().all(|issue| issue
        .resolution
        .as_ref()
        .is_some_and(|r| r.kind == "distinct_expenses")));
    ensure!(held.issues[0].candidates[0].origin == "selected_rows");
    ensure!(held.issues[0].candidates[0].proposal_id.is_none());
    ensure!(held.issues[0].candidates[0].amount == "100");
    ensure!(held.issues[0].candidates[0].external_reference.as_deref() == Some("bill-2"));
    let mut reviewed = original.clone();
    reviewed.configuration.distinct_expenses = decisions(&held);
    apply_candidate_holds(scope(), &mut reviewed, BTreeMap::new())?;
    ensure!(reviewed.entries.len() == 2 && reviewed.issues.is_empty());
    ensure!(reviewed.summary.total_debit == "200");
    let mut rechecked = original;
    rechecked.configuration = reviewed.configuration.clone();
    apply_candidate_holds(scope(), &mut rechecked, BTreeMap::new())?;
    ensure!(serde_json::to_value(rechecked)? == serde_json::to_value(reviewed)?);
    Ok(())
}

#[test]
fn one_explicit_decision_keeps_only_its_row_and_preserves_the_other_hold() -> Result<()> {
    let original = definition(vec![entry("1"), entry("2")])?;
    let mut held = original.clone();
    apply_candidate_holds(scope(), &mut held, BTreeMap::new())?;
    let mut reviewed = original;
    reviewed.configuration.distinct_expenses = decisions(&held).into_iter().take(1).collect();
    apply_candidate_holds(scope(), &mut reviewed, BTreeMap::new())?;
    ensure!(reviewed.entries.len() == 1 && reviewed.entries[0].item_id == "1");
    ensure!(reviewed.issues.len() == 1 && reviewed.issues[0].item_id.as_deref() == Some("2"));
    Ok(())
}

#[test]
fn exact_source_and_reference_duplicates_never_offer_a_distinct_override() -> Result<()> {
    for reason in ["same_source", "same_reference"] {
        let mut candidate = prior(0);
        candidate.reason = reason.into();
        let mut preview = definition(vec![entry("1")])?;
        apply_candidate_holds(
            scope(),
            &mut preview,
            BTreeMap::from([("1".into(), vec![candidate.clone()])]),
        )?;
        ensure!(preview.entries.is_empty() && preview.issues[0].resolution.is_none());
        let mut attempted = definition(vec![entry("1")])?;
        attempted.configuration.distinct_expenses = vec![DistinctExpenseDecision {
            item_id: "1".into(),
            source_revision: 3,
            candidate_digest: "c".repeat(64),
            reason: "Different expense asserted".into(),
        }];
        ensure!(apply_candidate_holds(
            scope(),
            &mut attempted,
            BTreeMap::from([("1".into(), vec![candidate])])
        )
        .is_err());
    }
    let first = entry("1");
    let mut second = entry("2");
    second.business_identity.external_reference =
        first.business_identity.external_reference.clone();
    let mut same_reference = definition(vec![first, second])?;
    apply_candidate_holds(scope(), &mut same_reference, BTreeMap::new())?;
    ensure!(
        same_reference.entries.is_empty()
            && same_reference
                .issues
                .iter()
                .all(|issue| issue.resolution.is_none())
    );
    Ok(())
}

#[test]
fn changed_candidates_source_revision_or_scope_invalidate_retained_decision_proofs() -> Result<()> {
    let original = definition(vec![entry("1")])?;
    let candidates = BTreeMap::from([("1".into(), vec![prior(0)])]);
    let mut preview = original.clone();
    apply_candidate_holds(scope(), &mut preview, candidates.clone())?;
    let decision = decisions(&preview);
    for change in 0..6 {
        let mut fresh = original.clone();
        fresh.configuration.distinct_expenses = decision.clone();
        let mut candidates = candidates.clone();
        let mut current_scope = scope();
        match change {
            0 => candidates.get_mut("1").unwrap().push(prior(1)),
            1 => candidates.get_mut("1").unwrap()[0].source_revision += 1,
            2 => candidates.get_mut("1").unwrap()[0].proposal_digest = Some("f".repeat(64)),
            3 => fresh.entries[0].source_revision += 1,
            4 => current_scope.company = 3,
            _ => current_scope.actor = "other-operator",
        }
        ensure!(apply_candidate_holds(current_scope, &mut fresh, candidates).is_err());
    }
    Ok(())
}

#[test]
fn truncated_candidates_stay_held_and_cannot_approve_a_visible_subset() -> Result<()> {
    let original = definition(vec![entry("1")])?;
    let first25 = (0..25).map(prior).collect::<Vec<_>>();
    let mut complete = original.clone();
    apply_candidate_holds(
        scope(),
        &mut complete,
        BTreeMap::from([("1".into(), first25.clone())]),
    )?;
    ensure!(complete.issues[0].resolution.is_some());
    let mut full = first25;
    full.push(prior(25));
    let mut truncated = original.clone();
    apply_candidate_holds(
        scope(),
        &mut truncated,
        BTreeMap::from([("1".into(), full.clone())]),
    )?;
    ensure!(truncated.entries.is_empty() && truncated.issues[0].resolution.is_none());
    ensure!(
        truncated.issues[0].candidates.len() == 25
            && truncated.issues[0].message.contains("More than 25")
    );
    let mut stale = original;
    stale.configuration.distinct_expenses = decisions(&complete);
    ensure!(
        apply_candidate_holds(scope(), &mut stale, BTreeMap::from([("1".into(), full)])).is_err()
    );
    Ok(())
}

#[test]
fn one_cutover_date_does_not_make_disjoint_historical_periods_duplicates() -> Result<()> {
    let mut second = entry("2");
    second.business_identity.date_from = "2024-02-05".into();
    second.business_identity.date_to_exclusive = "2024-02-06".into();
    let mut preview = definition(vec![entry("1"), second])?;
    apply_candidate_holds(scope(), &mut preview, BTreeMap::new())?;
    ensure!(preview.entries.len() == 2 && preview.issues.is_empty());
    Ok(())
}

#[test]
fn empty_legacy_configuration_serialization_and_unused_decisions_are_explicit() -> Result<()> {
    let original = definition(vec![entry("1")])?;
    ensure!(serde_json::to_value(&original.configuration)?
        .get("distinctExpenses")
        .is_none());
    let mut invalid = original;
    invalid
        .configuration
        .distinct_expenses
        .push(DistinctExpenseDecision {
            item_id: "1".into(),
            source_revision: 3,
            candidate_digest: "d".repeat(64),
            reason: "Different original invoice".into(),
        });
    ensure!(apply_candidate_holds(scope(), &mut invalid, BTreeMap::new()).is_err());
    invalid.configuration.distinct_expenses[0].reason = " ".into();
    ensure!(invalid.configuration.validate().is_err());
    Ok(())
}
