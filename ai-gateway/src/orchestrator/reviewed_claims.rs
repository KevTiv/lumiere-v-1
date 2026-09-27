//! Exact reuse of a human-reviewed claim by the answer gate.
//!
//! A person's review of a claim (`review_ai_evidence_claim`) is a durable,
//! attributable judgement about *that* statement resting on *that* evidence.
//! This module lets a later answer rely on it — and only on it — in place of
//! the model-assisted semantic-support check.
//!
//! # What must match
//!
//! The server looks the claim up; the model never nominates a claim id. A
//! stored claim is reusable only when every one of these holds:
//!
//! - the same organization and company;
//! - the same statement after whitespace normalization (any other change in
//!   wording is a different claim and needs its own review);
//! - exactly the same current supporting passage ids (a corrected, replaced or
//!   added source is a different tuple);
//! - the same assumption identity, which carries the answer's required
//!   applicability and the calculations its figures rest on, and no
//!   calculation reference of its own;
//! - `verification_method == human_reviewed`, with the reviewer and review time
//!   persisted;
//! - the claim row is the current revision, not superseded or flagged, and its
//!   outcome is `supported` or an explicitly `qualified` one;
//! - the shared inspector finds nothing blocking: every required dependency is
//!   valid, and every passage is present, current and in scope.
//!
//! Human review replaces *only* the semantic-support check. The gate still
//! runs its deterministic checks (passage hash and status, applicability,
//! effective dates, arithmetic and figure grounding) for the same answer, so a
//! reused review can never launder a failed deterministic check.
//!
//! An `unsupported` review of the exact tuple is not silently overridden by a
//! model: it blocks the answer. A `qualified` review carries its qualification
//! into the answer and can never be admitted in full.

use std::collections::BTreeSet;

use anyhow::Result;
use async_trait::async_trait;
use serde_json::Value;

use super::evidence_inspector::{
    identity, ids, inspect, micros, number, strings, text, ActorIdentity, EvidenceRows,
    InspectTarget, Severity, Viewer,
};

/// Longest statement the claim table stores; matches the recorder's cap.
pub(crate) const MAX_STATEMENT_CHARS: usize = 4_000;

/// What the gate is asking about, resolved entirely server-side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewedClaimQuery {
    pub organization_id: u64,
    pub company_id: u64,
    /// The claim text as the answer states it.
    pub statement: String,
    /// The current passages the answer's claim cites, by durable id.
    pub passage_ids: Vec<u64>,
    /// Applicability and calculation identity, as the recorder writes them.
    pub assumptions: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReviewedOutcome {
    Supported,
    Qualified,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewedClaim {
    pub claim_id: u64,
    pub outcome: ReviewedOutcome,
    /// The reviewer's stated qualification (required for `qualified`).
    pub note: Option<String>,
    /// Lowercase hex of the reviewer's identity, as persisted on the claim.
    pub reviewer_hex: String,
    pub reviewed_at_micros: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ReviewedClaimMatch {
    /// An exact, current, human-reviewed claim that may replace the semantic check.
    Reusable(ReviewedClaim),
    /// A person judged this exact claim and evidence unsupported. Reuse is
    /// refused and a model verdict must not override it.
    Rejected { claim_id: u64 },
    /// Nothing reusable: no exact review, or the one that exists is stale.
    NoMatch,
}

/// Finds a reusable human review for one claim. Implementations must fail
/// closed: an error or an ambiguous state is `NoMatch`, never `Reusable`.
#[async_trait]
pub(crate) trait ReviewedClaimResolver: Send + Sync {
    async fn resolve(&self, query: &ReviewedClaimQuery) -> Result<ReviewedClaimMatch>;
}

/// Collapse whitespace so trivial reflow is not treated as changed wording.
/// Case, punctuation and every other character still have to match.
pub(crate) fn normalize_statement(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate(text: &str) -> String {
    text.trim().chars().take(MAX_STATEMENT_CHARS).collect()
}

fn sorted_set<T: Ord + Clone>(values: &[T]) -> Vec<T> {
    values
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// What one stored claim row says about the tuple the gate is asking for.
struct Candidate {
    id: u64,
    outcome: String,
    status: String,
    note: Option<String>,
    reviewer_hex: String,
    reviewed_at: Option<i64>,
}

/// Whether `row` is a human review of exactly `query`. Pure, so every axis of
/// the tuple can be tested on its own.
fn matches_tuple(row: &Value, query: &ReviewedClaimQuery) -> Option<Candidate> {
    if number(row, "organizationId") != Some(query.organization_id)
        || number(row, "companyId") != Some(query.company_id)
        || text(row, "verificationMethod").as_deref() != Some("human_reviewed")
        || text(row, "kind").as_deref() != Some("sourced_fact")
    {
        return None;
    }
    // A superseded row is a replaced revision; its verdict was about wording
    // or evidence that has since been replaced.
    let status = text(row, "status")?;
    if status == "superseded" {
        return None;
    }
    if normalize_statement(&text(row, "statement")?)
        != normalize_statement(&truncate(&query.statement))
    {
        return None;
    }
    if sorted_set(&ids(row, "supportingPassageIds")) != sorted_set(&query.passage_ids)
        || !ids(row, "contradictingPassageIds").is_empty()
        || text(row, "calculationRef").is_some()
        || sorted_set(&strings(row, "assumptions")) != sorted_set(&query.assumptions)
    {
        return None;
    }
    // A review whose reviewer was never recorded is not attributable, so it
    // cannot stand in for a semantic check.
    let reviewer = identity(row, "reviewerUid")?;
    Some(Candidate {
        id: number(row, "id")?,
        outcome: text(row, "verificationOutcome")?,
        status,
        note: text(row, "verificationNote"),
        reviewer_hex: ActorIdentity::to_hex(reviewer),
        reviewed_at: micros(row, "reviewedAt"),
    })
}

/// Choose between the exact-tuple reviews found. The newest verdict wins, and
/// an `unsupported` newest verdict blocks even if an older review passed.
fn select(rows: &[Value], query: &ReviewedClaimQuery) -> Selection {
    let mut candidates: Vec<Candidate> = rows
        .iter()
        .filter_map(|row| matches_tuple(row, query))
        .collect();
    candidates.sort_by_key(|candidate| (candidate.reviewed_at.unwrap_or(i64::MIN), candidate.id));
    let Some(newest) = candidates.last() else {
        return Selection::None;
    };
    if newest.outcome == "unsupported" {
        return Selection::Rejected(newest.id);
    }
    candidates
        .into_iter()
        .rev()
        .find(|candidate| {
            candidate.status == "current"
                && matches!(candidate.outcome.as_str(), "supported" | "qualified")
        })
        .map_or(Selection::None, |candidate| Selection::Candidate(candidate))
}

enum Selection {
    None,
    Rejected(u64),
    Candidate(Candidate),
}

pub(crate) struct StdbReviewedClaimResolver<'a> {
    pub rows: &'a dyn EvidenceRows,
}

#[async_trait]
impl ReviewedClaimResolver for StdbReviewedClaimResolver<'_> {
    async fn resolve(&self, query: &ReviewedClaimQuery) -> Result<ReviewedClaimMatch> {
        if query.organization_id == 0
            || query.company_id == 0
            || query.passage_ids.is_empty()
            || query.statement.trim().is_empty()
        {
            return Ok(ReviewedClaimMatch::NoMatch);
        }
        // The stored statement is the recorder's trimmed form; also try the
        // whitespace-normalized form so reflowed text still finds its review.
        let recorded = truncate(&query.statement);
        let normalized = normalize_statement(&recorded);
        let mut statements = vec![recorded];
        if !statements.contains(&normalized) {
            statements.push(normalized);
        }
        let mut rows = Vec::new();
        for statement in &statements {
            rows.extend(
                self.rows
                    .human_reviewed_claims(query.organization_id, query.company_id, statement)
                    .await?,
            );
        }
        let candidate = match select(&rows, query) {
            Selection::None => return Ok(ReviewedClaimMatch::NoMatch),
            Selection::Rejected(claim_id) => return Ok(ReviewedClaimMatch::Rejected { claim_id }),
            Selection::Candidate(candidate) => candidate,
        };

        // The same current-state rules that gate knowledge reuse and workflow
        // publication: nothing blocking in the chain, and no evidence the
        // viewer cannot see.
        let viewer = Viewer {
            organization_id: query.organization_id,
            company_id: query.company_id,
            actor_identity: None,
        };
        let inspection = inspect(self.rows, viewer, InspectTarget::Claim(candidate.id)).await?;
        let blocked = inspection.findings.iter().any(|finding| {
            finding.severity == Severity::Blocking || finding.code == "passage_out_of_scope"
        });
        let stale_claim = inspection.claims.iter().any(|claim| {
            claim.id == candidate.id
                && (claim.status != "current"
                    || claim.verification_method != "human_reviewed"
                    || sorted_set(&claim.supporting_passage_ids) != sorted_set(&query.passage_ids))
        });
        if blocked
            || stale_claim
            || !inspection
                .claims
                .iter()
                .any(|claim| claim.id == candidate.id)
        {
            return Ok(ReviewedClaimMatch::NoMatch);
        }
        let outcome = if candidate.outcome == "qualified" {
            ReviewedOutcome::Qualified
        } else {
            ReviewedOutcome::Supported
        };
        Ok(ReviewedClaimMatch::Reusable(ReviewedClaim {
            claim_id: candidate.id,
            outcome,
            note: candidate.note,
            reviewer_hex: candidate.reviewer_hex,
            reviewed_at_micros: candidate.reviewed_at,
        }))
    }
}

#[cfg(test)]
pub(crate) mod testkit {
    //! In-memory evidence rows for the resolver and the gate tests.
    use std::collections::HashMap;

    use serde_json::json;

    use super::*;

    pub(crate) const REVIEWER: &str =
        "0101010101010101010101010101010101010101010101010101010101010101";

    /// A `human_reviewed` claim row (id 40, organization 7, company 3).
    pub(crate) fn claim_row(statement: &str, passage_ids: &[u64], assumptions: &[&str]) -> Value {
        json!({
            "id": 40, "organizationId": 7, "companyId": 3, "kind": "sourced_fact",
            "statement": statement,
            "supportingPassageIds": passage_ids, "contradictingPassageIds": [],
            "calculationRef": null, "assumptions": assumptions,
            "verificationMethod": "human_reviewed", "verificationOutcome": "supported",
            "verificationNote": "checked", "status": "current",
            "reviewerUid": REVIEWER, "reviewedAt": 1_700_000_000_000_000_i64,
        })
    }

    #[derive(Default)]
    pub(crate) struct Rows {
        pub tables: HashMap<(&'static str, u64), Value>,
        pub claims: Vec<Value>,
        pub dependencies: Vec<Value>,
        pub fail_lookup: bool,
    }

    #[async_trait]
    impl EvidenceRows for Rows {
        async fn row(&self, table: &'static str, id: u64) -> Result<Option<Value>> {
            Ok(self.tables.get(&(table, id)).cloned())
        }
        async fn dependencies_of(&self, _: u64, kind: &'static str, id: u64) -> Result<Vec<Value>> {
            Ok(self
                .dependencies
                .iter()
                .filter(|edge| {
                    text(edge, "dependentKind").as_deref() == Some(kind)
                        && number(edge, "dependentId") == Some(id)
                })
                .cloned()
                .collect())
        }
        async fn knowledge_entry_by_key(&self, _: u64, _: u64, _: &str) -> Result<Option<Value>> {
            Ok(None)
        }
        async fn knowledge_versions_of(&self, _: u64) -> Result<Vec<Value>> {
            Ok(Vec::new())
        }
        async fn knowledge_reviews_of(&self, _: u64) -> Result<Vec<Value>> {
            Ok(Vec::new())
        }
        async fn human_reviewed_claims(
            &self,
            _: u64,
            _: u64,
            statement: &str,
        ) -> Result<Vec<Value>> {
            if self.fail_lookup {
                anyhow::bail!("evidence store unavailable");
            }
            Ok(self
                .claims
                .iter()
                .filter(|row| text(row, "statement").as_deref() == Some(statement))
                .cloned()
                .collect())
        }
    }

    /// A store holding one claim with its passage, source version and source.
    pub(crate) fn store(claim: Value) -> Rows {
        let passage_id = ids(&claim, "supportingPassageIds")
            .first()
            .copied()
            .unwrap_or(11);
        let mut rows = Rows::default();
        rows.tables.insert(("ai_evidence_claim", 40), claim.clone());
        rows.claims.push(claim);
        rows.tables.insert(
            ("ai_evidence_passage", passage_id),
            json!({
                "id": passage_id, "organizationId": 7, "companyId": 3, "sourceVersionId": 5,
                "status": "current", "textState": "present", "passageText": "Policy text.",
                "coordinates": [], "textOrigin": "original", "sourceKey": "policy",
            }),
        );
        rows.tables.insert(
            ("ai_evidence_source_version", 5),
            json!({
                "id": 5, "sourceId": 2, "version": "1", "verification": "inspected",
                "origin": "book_paper", "status": "current", "snapshotState": "present",
            }),
        );
        rows.tables.insert(
            ("ai_evidence_source", 2),
            json!({
                "id": 2, "organizationId": 7, "companyId": 3, "scope": "company",
                "title": "Policy", "sourceKind": "policy", "sourceKey": "policy",
                "authorAttribution": "known", "authors": ["Board"],
            }),
        );
        rows.dependencies.push(json!({
            "dependentKind": "claim", "dependentId": 40, "upstreamKind": "passage",
            "upstreamId": passage_id, "requirement": "required", "state": "valid",
        }));
        rows
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::testkit::{claim_row as row_for, store, Rows, REVIEWER};
    use super::*;

    fn query() -> ReviewedClaimQuery {
        ReviewedClaimQuery {
            organization_id: 7,
            company_id: 3,
            statement: "Refunds above 731 EUR need board sign-off.".into(),
            passage_ids: vec![11],
            assumptions: vec!["applicability:jurisdiction:US".into()],
        }
    }

    fn claim_row() -> Value {
        row_for(
            "Refunds above 731 EUR need board sign-off.",
            &[11],
            &["applicability:jurisdiction:US"],
        )
    }

    async fn resolve(rows: &Rows, query: &ReviewedClaimQuery) -> ReviewedClaimMatch {
        StdbReviewedClaimResolver { rows }
            .resolve(query)
            .await
            .expect("resolves")
    }

    fn reusable(found: &ReviewedClaimMatch) -> &ReviewedClaim {
        match found {
            ReviewedClaimMatch::Reusable(claim) => claim,
            other => panic!("expected a reusable review, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn exact_current_human_review_is_reusable_with_the_reviewer_preserved() {
        let found = resolve(&store(claim_row()), &query()).await;
        let claim = reusable(&found);
        assert_eq!(claim.claim_id, 40);
        assert_eq!(claim.outcome, ReviewedOutcome::Supported);
        assert_eq!(claim.reviewer_hex, REVIEWER);
        assert_eq!(claim.reviewed_at_micros, Some(1_700_000_000_000_000));
    }

    #[tokio::test]
    async fn whitespace_reflow_matches_but_any_wording_change_does_not() {
        let rows = store(claim_row());
        let mut reflowed = query();
        reflowed.statement = "  Refunds above 731 EUR\n need   board sign-off. ".into();
        assert!(matches!(
            resolve(&rows, &reflowed).await,
            ReviewedClaimMatch::Reusable(_)
        ));
        for changed in [
            "Refunds above 731 EUR need board approval.",
            "Refunds above 732 EUR need board sign-off.",
            "refunds above 731 EUR need board sign-off.",
        ] {
            let mut query = query();
            query.statement = changed.into();
            assert_eq!(
                resolve(&rows, &query).await,
                ReviewedClaimMatch::NoMatch,
                "{changed}"
            );
        }
    }

    #[tokio::test]
    async fn a_changed_support_set_or_source_version_needs_a_new_review() {
        let rows = store(claim_row());
        for passages in [vec![12], vec![11, 12], vec![]] {
            let mut query = query();
            query.passage_ids = passages.clone();
            assert_eq!(
                resolve(&rows, &query).await,
                ReviewedClaimMatch::NoMatch,
                "{passages:?}"
            );
        }
        // Duplicated citations are the same set.
        let mut duplicated = query();
        duplicated.passage_ids = vec![11, 11];
        assert!(matches!(
            resolve(&rows, &duplicated).await,
            ReviewedClaimMatch::Reusable(_)
        ));
    }

    #[tokio::test]
    async fn changed_applicability_or_calculation_identity_needs_a_new_review() {
        let rows = store(claim_row());
        for assumptions in [
            vec!["applicability:jurisdiction:FR".to_string()],
            vec![],
            vec![
                "applicability:jurisdiction:US".to_string(),
                "calculation:sha256:abc".to_string(),
            ],
        ] {
            let mut query = query();
            query.assumptions = assumptions.clone();
            assert_eq!(
                resolve(&rows, &query).await,
                ReviewedClaimMatch::NoMatch,
                "{assumptions:?}"
            );
        }
        // A claim carrying a calculation reference of its own is another kind of claim.
        let mut with_calculation = claim_row();
        with_calculation["calculationRef"] = json!("run:1:calc:1");
        assert_eq!(
            resolve(&store(with_calculation), &query()).await,
            ReviewedClaimMatch::NoMatch
        );
    }

    #[tokio::test]
    async fn only_a_human_review_of_a_current_attributed_claim_counts() {
        for (field, value) in [
            ("verificationMethod", json!("model_assisted")),
            ("verificationMethod", json!("deterministic")),
            ("status", json!("superseded")),
            ("status", json!("needs_review")),
            ("verificationOutcome", json!("unverified")),
            ("kind", json!("inference")),
            ("organizationId", json!(8)),
            ("companyId", json!(4)),
            ("reviewerUid", Value::Null),
        ] {
            let mut claim = claim_row();
            claim[field] = value.clone();
            assert_eq!(
                resolve(&store(claim), &query()).await,
                ReviewedClaimMatch::NoMatch,
                "{field} = {value}"
            );
        }
    }

    #[tokio::test]
    async fn qualified_review_is_reusable_only_as_qualified() {
        let mut claim = claim_row();
        claim["verificationOutcome"] = json!("qualified");
        claim["verificationNote"] = json!("only for EU customers");
        let found = resolve(&store(claim), &query()).await;
        let reviewed = reusable(&found);
        assert_eq!(reviewed.outcome, ReviewedOutcome::Qualified);
        assert_eq!(reviewed.note.as_deref(), Some("only for EU customers"));
    }

    #[tokio::test]
    async fn an_unsupported_review_is_rejected_not_reused_or_overridden() {
        let mut claim = claim_row();
        claim["verificationOutcome"] = json!("unsupported");
        claim["status"] = json!("needs_review");
        assert_eq!(
            resolve(&store(claim), &query()).await,
            ReviewedClaimMatch::Rejected { claim_id: 40 }
        );
        // A newer unsupported verdict outranks an older supported one.
        let mut older = claim_row();
        older["id"] = json!(39);
        older["reviewedAt"] = json!(1_600_000_000_000_000_i64);
        let mut newer = claim_row();
        newer["verificationOutcome"] = json!("unsupported");
        newer["status"] = json!("needs_review");
        let mut rows = store(newer.clone());
        rows.claims = vec![older, newer];
        assert_eq!(
            resolve(&rows, &query()).await,
            ReviewedClaimMatch::Rejected { claim_id: 40 }
        );
    }

    #[tokio::test]
    async fn revoked_or_invalid_foundations_invalidate_prior_review() {
        // A required dependency that is no longer valid.
        for state in ["needs_review", "invalid"] {
            let mut rows = store(claim_row());
            rows.dependencies[0]["state"] = json!(state);
            assert_eq!(
                resolve(&rows, &query()).await,
                ReviewedClaimMatch::NoMatch,
                "{state}"
            );
        }
        // Withdrawn, restricted or deleted passages and non-current sources.
        for (table, id, field, value) in [
            ("ai_evidence_passage", 11, "status", "withdrawn"),
            ("ai_evidence_passage", 11, "textState", "restricted"),
            ("ai_evidence_passage", 11, "textState", "tombstoned"),
            ("ai_evidence_source_version", 5, "status", "retracted"),
            ("ai_evidence_source_version", 5, "status", "access_revoked"),
            ("ai_evidence_source_version", 5, "status", "deleted"),
        ] {
            let mut rows = store(claim_row());
            rows.tables.get_mut(&(table, id)).expect("row")[field] = json!(value);
            assert_eq!(
                resolve(&rows, &query()).await,
                ReviewedClaimMatch::NoMatch,
                "{table}.{field}={value}"
            );
        }
    }

    #[tokio::test]
    async fn another_company_or_organization_never_matches() {
        let rows = store(claim_row());
        let mut sibling = query();
        sibling.company_id = 4;
        assert_eq!(resolve(&rows, &sibling).await, ReviewedClaimMatch::NoMatch);
        let mut foreign = query();
        foreign.organization_id = 8;
        assert_eq!(resolve(&rows, &foreign).await, ReviewedClaimMatch::NoMatch);
        // A passage that sits in another company's source reads as out of scope.
        let mut other_source = store(claim_row());
        other_source
            .tables
            .get_mut(&("ai_evidence_source", 2))
            .expect("source")["companyId"] = json!(4);
        assert_eq!(
            resolve(&other_source, &query()).await,
            ReviewedClaimMatch::NoMatch
        );
    }

    #[tokio::test]
    async fn an_empty_or_ungrounded_query_never_resolves() {
        let rows = store(claim_row());
        let mut ungrounded = query();
        ungrounded.passage_ids.clear();
        assert_eq!(
            resolve(&rows, &ungrounded).await,
            ReviewedClaimMatch::NoMatch
        );
        let mut blank = query();
        blank.statement = "  ".into();
        assert_eq!(resolve(&rows, &blank).await, ReviewedClaimMatch::NoMatch);
    }

    /// Against a live module populated by `run_workflow_provenance_tests`:
    ///
    /// ```text
    /// STDB_URL=http://127.0.0.1:3000 STDB_MODULE=<db> STDB_TOKEN=<owner token> \
    ///   cargo test --bin gateway live_review -- --ignored
    /// ```
    #[tokio::test]
    #[ignore = "needs a live SpacetimeDB module populated by run_workflow_provenance_tests"]
    async fn live_review_is_reused_only_for_the_exact_tuple() {
        let env = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} is required"));
        let client =
            stdb_client::StdbClient::new(env("STDB_URL"), env("STDB_MODULE"), env("STDB_TOKEN"));
        let reviewed = client
            .query_sql(
                "SELECT * FROM ai_evidence_claim WHERE verification_method = 'human_reviewed' \
                 AND status = 'current' AND kind = 'sourced_fact'",
            )
            .await
            .expect("claims");
        let resolver = StdbReviewedClaimResolver { rows: &client };
        let mut reused = 0;
        for row in &reviewed {
            let query = ReviewedClaimQuery {
                organization_id: number(row, "organizationId").unwrap(),
                company_id: number(row, "companyId").unwrap(),
                statement: text(row, "statement").unwrap(),
                passage_ids: ids(row, "supportingPassageIds"),
                assumptions: strings(row, "assumptions"),
            };
            let ReviewedClaimMatch::Reusable(found) = resolver.resolve(&query).await.unwrap()
            else {
                // A claim whose evidence was later retracted by another
                // scenario must not be reusable; nothing to assert here.
                continue;
            };
            reused += 1;
            assert!(found.reviewer_hex.len() == 64, "the reviewer is preserved");
            assert!(found.reviewed_at_micros.is_some());

            // Every near miss falls out of the tuple against the real rows.
            let mut reworded = query.clone();
            reworded.statement.push_str(" Also always.");
            let mut other_evidence = query.clone();
            other_evidence.passage_ids.push(u64::MAX / 2);
            let mut other_assumptions = query.clone();
            other_assumptions
                .assumptions
                .push("applicability:jurisdiction:XX".into());
            let mut sibling = query.clone();
            sibling.company_id += 1_000_000;
            let mut foreign = query.clone();
            foreign.organization_id += 1_000_000;
            for near_miss in [
                reworded,
                other_evidence,
                other_assumptions,
                sibling,
                foreign,
            ] {
                assert_eq!(
                    resolver.resolve(&near_miss).await.unwrap(),
                    ReviewedClaimMatch::NoMatch,
                    "{near_miss:?}"
                );
            }
        }
        assert!(reused > 0, "at least one live claim is exactly reusable");
    }
}
