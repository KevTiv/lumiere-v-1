//! The reviewer's queue: what a person is being asked to look at, in one
//! bounded, company-scoped read.
//!
//! Reviewers used to need an id typed in by hand. This lists, for one
//! organization and company:
//!
//! - claims awaiting a person — flagged `needs_review` by a source change or a
//!   prior verdict, or passage-backed claims only a machine has checked;
//! - decisions that are proposed or flagged;
//! - workflow-step components whose links are `changed` or `unresolved`;
//!
//! and for each item the source and passage availability, the automated
//! verification result, who created or proposed it (so separation of duties is
//! visible before a verdict is attempted), and the workflow components that
//! would be affected.
//!
//! The queue is a read model, not an authority: it grants no review right.
//! Reducers still require the reviewer's permission, company membership and
//! independence, and `reviewable_by_viewer` is only a hint for the screen.
//!
//! Every list is bounded, every row must belong to the viewer's organization
//! and company, and a passage outside the viewer's scope is reduced to an id.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use stdb_client::StdbClient;

use super::evidence_inspector::{
    identity, ids, is_stable_key, number, passage_availability, source_in_scope, text,
    ActorIdentity, Availability, EvidenceRows, Viewer,
};

/// Default and maximum rows per list.
pub const DEFAULT_QUEUE_LIMIT: usize = 25;
pub const MAX_QUEUE_LIMIT: usize = 50;
/// Passages shown per claim; the inspector shows the rest.
const MAX_PASSAGES_PER_CLAIM: usize = 4;
/// Longest statement, note or title shown in the queue.
const MAX_TEXT_CHARS: usize = 400;
/// Workflow-step components scanned to find affected steps.
const MAX_COMPONENTS_SCANNED: usize = 500;

/// Statuses that put a claim in the queue on their own.
const CLAIM_FLAGGED: &str = "needs_review";
/// Automated methods whose passage-backed, current claims still await a person.
const MACHINE_METHODS: [&str; 3] = ["model_assisted", "deterministic", "none"];
/// Claim kinds a person can meaningfully validate against a passage.
const REVIEWABLE_KINDS: [&str; 3] = ["sourced_fact", "quotation", "paraphrase"];

// ── Row access ───────────────────────────────────────────────────────────────

/// The extra reads the queue needs beyond the inspector's. Implemented for the
/// STDB client; tests use an in-memory fake.
#[async_trait]
pub trait QueueRows: EvidenceRows {
    /// Newest claims in `status`, optionally of one verification `method`.
    async fn claims_with_status(
        &self,
        organization_id: u64,
        company_id: u64,
        status: &str,
        method: Option<&str>,
        limit: usize,
    ) -> Result<Vec<Value>>;
    /// Newest decisions in `status`.
    async fn decisions_with_status(
        &self,
        organization_id: u64,
        company_id: u64,
        status: &str,
        limit: usize,
    ) -> Result<Vec<Value>>;
    /// Newest current workflow-step components of the company.
    async fn workflow_step_components(
        &self,
        organization_id: u64,
        company_id: u64,
        limit: usize,
    ) -> Result<Vec<Value>>;
}

/// A fixed status or method label made of nothing that needs escaping. The
/// values are all constants of this module; the check keeps it that way.
fn label(value: &str) -> Result<&str> {
    if is_stable_key(value) {
        Ok(value)
    } else {
        anyhow::bail!("unsafe query label")
    }
}

#[async_trait]
impl QueueRows for StdbClient {
    async fn claims_with_status(
        &self,
        organization_id: u64,
        company_id: u64,
        status: &str,
        method: Option<&str>,
        limit: usize,
    ) -> Result<Vec<Value>> {
        let mut sql = format!(
            "SELECT * FROM ai_evidence_claim WHERE organization_id = {organization_id} \
             AND company_id = {company_id} AND status = '{}'",
            label(status)?
        );
        if let Some(method) = method {
            sql.push_str(&format!(" AND verification_method = '{}'", label(method)?));
        }
        sql.push_str(&format!(" ORDER BY id DESC LIMIT {limit}"));
        self.query_sql(&sql).await.context("load claims for review")
    }

    async fn decisions_with_status(
        &self,
        organization_id: u64,
        company_id: u64,
        status: &str,
        limit: usize,
    ) -> Result<Vec<Value>> {
        self.query_sql(&format!(
            "SELECT * FROM ai_evidence_decision WHERE organization_id = {organization_id} \
             AND company_id = {company_id} AND status = '{}' ORDER BY id DESC LIMIT {limit}",
            label(status)?
        ))
        .await
        .context("load decisions for review")
    }

    async fn workflow_step_components(
        &self,
        organization_id: u64,
        company_id: u64,
        limit: usize,
    ) -> Result<Vec<Value>> {
        self.query_sql(&format!(
            "SELECT * FROM ai_artifact_component WHERE organization_id = {organization_id} \
             AND company_id = {company_id} AND component_kind = 'workflow_step' \
             AND status = 'current' ORDER BY id DESC LIMIT {limit}"
        ))
        .await
        .context("load workflow-step components")
    }
}

// ── Views ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQueue {
    pub claims: Vec<QueueClaim>,
    pub decisions: Vec<QueueDecision>,
    /// Workflow steps whose links a reviewer must confirm before they publish.
    pub components: Vec<QueueComponent>,
    pub claims_truncated: bool,
    pub decisions_truncated: bool,
    pub components_truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueClaim {
    pub id: u64,
    pub kind: String,
    pub statement: String,
    pub status: String,
    /// `needs_review` (flagged) or `awaiting_human_review` (only a machine has
    /// looked at it).
    pub queue_reason: String,
    /// What the automated check concluded; never a human verdict unless the
    /// method says `human_reviewed`.
    pub verification_method: String,
    pub verification_outcome: String,
    pub verification_note: Option<String>,
    pub passages: Vec<QueuePassage>,
    pub passages_truncated: bool,
    pub creator_uid: Option<String>,
    /// The contributor whose contribution introduced it, when recorded.
    pub proposer_uid: Option<String>,
    pub proposer_kind: Option<String>,
    /// False when the viewer created or proposed it, or is unknown. A hint
    /// for the screen; the reducer enforces independence.
    pub reviewable_by_viewer: bool,
    pub affected_components: Vec<AffectedComponent>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueDecision {
    pub id: u64,
    pub title: String,
    pub status: String,
    pub adopted_claim_ids: Vec<u64>,
    pub creator_uid: Option<String>,
    pub proposer_uid: Option<String>,
    pub proposer_kind: Option<String>,
    pub reviewable_by_viewer: bool,
    pub affected_components: Vec<AffectedComponent>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueuePassage {
    pub id: u64,
    pub availability: Availability,
    pub status: Option<String>,
    pub source_version_id: Option<u64>,
    /// Only for a source in the viewer's scope and a passage still available.
    pub source_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AffectedComponent {
    pub id: u64,
    pub workflow_version_id: Option<u64>,
    pub node_key: Option<String>,
    pub link_state: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueComponent {
    pub id: u64,
    pub workflow_version_id: Option<u64>,
    pub node_key: Option<String>,
    pub link_state: String,
    pub version: u64,
    /// The exact content a confirmation must name.
    pub content_hash: String,
    pub decision_ids: Vec<u64>,
    pub claim_ids: Vec<u64>,
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

fn bounded(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= MAX_TEXT_CHARS {
        trimmed.to_string()
    } else {
        let mut out: String = trimmed.chars().take(MAX_TEXT_CHARS - 1).collect();
        out.push('…');
        out
    }
}

/// Split `workflow-version:<id>` / `node:<key>` as the workflow module writes
/// them. Anything else is not a workflow step.
fn workflow_step(row: &Value) -> (Option<u64>, Option<String>) {
    let version = text(row, "artifactRef")
        .and_then(|artifact| artifact.strip_prefix("workflow-version:")?.parse().ok());
    let node = text(row, "componentKey")
        .and_then(|key| key.strip_prefix("node:").map(str::to_string))
        .filter(|key| !key.is_empty());
    (version, node)
}

fn owned(row: &Value, viewer: Viewer) -> bool {
    number(row, "organizationId") == Some(viewer.organization_id)
        && number(row, "companyId") == Some(viewer.company_id)
}

/// A claim awaits a person when it was flagged, or when it is a current,
/// passage-backed claim that only a machine has checked and not found wanting.
fn claim_queue_reason(row: &Value) -> Option<&'static str> {
    let status = text(row, "status")?;
    let method = text(row, "verificationMethod")?;
    let outcome = text(row, "verificationOutcome")?;
    let kind = text(row, "kind")?;
    if status == CLAIM_FLAGGED {
        return Some("needs_review");
    }
    (status == "current"
        && MACHINE_METHODS.contains(&method.as_str())
        && REVIEWABLE_KINDS.contains(&kind.as_str())
        && outcome != "unsupported"
        && !ids(row, "supportingPassageIds").is_empty())
    .then_some("awaiting_human_review")
}

fn reviewable(
    viewer: Viewer,
    creator: Option<ActorIdentity>,
    proposer: Option<ActorIdentity>,
) -> bool {
    match viewer.actor_identity {
        Some(actor) => creator != Some(actor) && proposer != Some(actor),
        None => false,
    }
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/// Assemble the queue for `viewer`, at most `limit` items per list.
pub async fn build_queue(
    rows: &dyn QueueRows,
    viewer: Viewer,
    limit: usize,
) -> Result<ReviewQueue> {
    let limit = limit.clamp(1, MAX_QUEUE_LIMIT);
    let (org, company) = (viewer.organization_id, viewer.company_id);

    // Claims: flagged ones, plus machine-only ones. Each read fetches one more
    // than the limit so truncation is visible.
    let mut claim_rows: BTreeMap<u64, Value> = BTreeMap::new();
    let mut sources: Vec<(&str, Option<&str>)> = vec![(CLAIM_FLAGGED, None)];
    sources.extend(
        MACHINE_METHODS
            .iter()
            .map(|method| ("current", Some(*method))),
    );
    for (status, method) in sources {
        for row in rows
            .claims_with_status(org, company, status, method, limit + 1)
            .await?
        {
            if owned(&row, viewer) && claim_queue_reason(&row).is_some() {
                if let Some(id) = number(&row, "id") {
                    claim_rows.insert(id, row);
                }
            }
        }
    }
    let claims_truncated = claim_rows.len() > limit;
    // Newest first; the oldest are what is dropped when over the limit.
    let claim_rows: Vec<Value> = claim_rows.into_values().rev().take(limit).collect();

    let mut decision_rows: BTreeMap<u64, Value> = BTreeMap::new();
    for status in ["proposed", "needs_review"] {
        for row in rows
            .decisions_with_status(org, company, status, limit + 1)
            .await?
        {
            if owned(&row, viewer) {
                if let Some(id) = number(&row, "id") {
                    decision_rows.insert(id, row);
                }
            }
        }
    }
    let decisions_truncated = decision_rows.len() > limit;
    let decision_rows: Vec<Value> = decision_rows.into_values().rev().take(limit).collect();

    let components: Vec<Value> = rows
        .workflow_step_components(org, company, MAX_COMPONENTS_SCANNED)
        .await?
        .into_iter()
        .filter(|row| owned(row, viewer))
        .collect();

    let mut contributions: BTreeMap<u64, Option<(ActorIdentity, String)>> = BTreeMap::new();
    let mut passage_cache: BTreeMap<u64, QueuePassage> = BTreeMap::new();

    let mut claims = Vec::with_capacity(claim_rows.len());
    for row in &claim_rows {
        let id = number(row, "id").unwrap_or(0);
        let creator = identity(row, "createUid");
        let (proposer, proposer_kind) = proposer_of(
            rows,
            viewer,
            &mut contributions,
            number(row, "contributionId"),
        )
        .await?;
        let passage_ids = ids(row, "supportingPassageIds");
        let mut passages = Vec::new();
        for passage_id in passage_ids.iter().take(MAX_PASSAGES_PER_CLAIM) {
            passages.push(queue_passage(rows, viewer, &mut passage_cache, *passage_id).await?);
        }
        claims.push(QueueClaim {
            id,
            kind: text(row, "kind").unwrap_or_default(),
            statement: bounded(&text(row, "statement").unwrap_or_default()),
            status: text(row, "status").unwrap_or_default(),
            queue_reason: claim_queue_reason(row)
                .unwrap_or("needs_review")
                .to_string(),
            verification_method: text(row, "verificationMethod").unwrap_or_default(),
            verification_outcome: text(row, "verificationOutcome").unwrap_or_default(),
            verification_note: text(row, "verificationNote").map(|note| bounded(&note)),
            passages_truncated: passage_ids.len() > MAX_PASSAGES_PER_CLAIM,
            passages,
            creator_uid: creator.map(ActorIdentity::to_hex),
            proposer_uid: proposer.map(ActorIdentity::to_hex),
            proposer_kind,
            reviewable_by_viewer: reviewable(viewer, creator, proposer),
            affected_components: affected(&components, "claimIds", id),
        });
    }

    let mut decisions = Vec::with_capacity(decision_rows.len());
    for row in &decision_rows {
        let id = number(row, "id").unwrap_or(0);
        let creator = identity(row, "createUid");
        let (proposer, proposer_kind) = proposer_of(
            rows,
            viewer,
            &mut contributions,
            number(row, "contributionId"),
        )
        .await?;
        decisions.push(QueueDecision {
            id,
            title: bounded(&text(row, "title").unwrap_or_default()),
            status: text(row, "status").unwrap_or_default(),
            adopted_claim_ids: ids(row, "adoptedClaimIds"),
            creator_uid: creator.map(ActorIdentity::to_hex),
            proposer_uid: proposer.map(ActorIdentity::to_hex),
            proposer_kind,
            reviewable_by_viewer: reviewable(viewer, creator, proposer),
            affected_components: affected(&components, "decisionIds", id),
        });
    }

    let needing: Vec<QueueComponent> = components
        .iter()
        .filter(|row| text(row, "linkState").as_deref() != Some("linked"))
        .filter_map(|row| {
            let (workflow_version_id, node_key) = workflow_step(row);
            Some(QueueComponent {
                id: number(row, "id")?,
                workflow_version_id,
                node_key,
                link_state: text(row, "linkState")?,
                version: number(row, "version").unwrap_or(1),
                content_hash: text(row, "contentHash")?,
                decision_ids: ids(row, "decisionIds"),
                claim_ids: ids(row, "claimIds"),
            })
        })
        .collect();
    let components_truncated = needing.len() > limit || components.len() >= MAX_COMPONENTS_SCANNED;
    let components: Vec<QueueComponent> = needing.into_iter().take(limit).collect();

    Ok(ReviewQueue {
        claims,
        decisions,
        components,
        claims_truncated,
        decisions_truncated,
        components_truncated,
    })
}

fn affected(components: &[Value], links: &str, id: u64) -> Vec<AffectedComponent> {
    components
        .iter()
        .filter(|row| ids(row, links).contains(&id))
        .filter_map(|row| {
            let (workflow_version_id, node_key) = workflow_step(row);
            Some(AffectedComponent {
                id: number(row, "id")?,
                workflow_version_id,
                node_key,
                link_state: text(row, "linkState")?,
                content_hash: text(row, "contentHash")?,
            })
        })
        .take(MAX_QUEUE_LIMIT)
        .collect()
}

/// The user or agent whose contribution introduced an item, read once per
/// contribution. A contribution outside the viewer's scope reads as unknown.
async fn proposer_of(
    rows: &dyn QueueRows,
    viewer: Viewer,
    cache: &mut BTreeMap<u64, Option<(ActorIdentity, String)>>,
    contribution_id: Option<u64>,
) -> Result<(Option<ActorIdentity>, Option<String>)> {
    let Some(id) = contribution_id else {
        return Ok((None, None));
    };
    if !cache.contains_key(&id) {
        let found = rows
            .row("ai_evidence_contribution", id)
            .await?
            .filter(|row| owned(row, viewer))
            .and_then(|row| {
                Some((
                    identity(&row, "contributorUid")?,
                    text(&row, "contributorKind")?,
                ))
            });
        cache.insert(id, found);
    }
    Ok(match &cache[&id] {
        Some((uid, kind)) => (Some(*uid), Some(kind.clone())),
        None => (None, None),
    })
}

/// One passage's availability to this viewer, without ever revealing text.
async fn queue_passage(
    rows: &dyn QueueRows,
    viewer: Viewer,
    cache: &mut BTreeMap<u64, QueuePassage>,
    passage_id: u64,
) -> Result<QueuePassage> {
    if let Some(cached) = cache.get(&passage_id) {
        return Ok(cached.clone());
    }
    let redacted = |availability| QueuePassage {
        id: passage_id,
        availability,
        status: None,
        source_version_id: None,
        source_title: None,
    };
    let passage = match rows.row("ai_evidence_passage", passage_id).await? {
        None => redacted(Availability::Missing),
        Some(row) if number(&row, "organizationId") != Some(viewer.organization_id) => {
            redacted(Availability::OutOfScope)
        }
        Some(row) => {
            let version_id = number(&row, "sourceVersionId");
            let mut title = None;
            let in_scope = match version_id {
                Some(version_id) => {
                    let source = match rows.row("ai_evidence_source_version", version_id).await? {
                        Some(version) => match number(&version, "sourceId") {
                            Some(source_id) => rows.row("ai_evidence_source", source_id).await?,
                            None => None,
                        },
                        None => None,
                    };
                    match source {
                        Some(source) => {
                            let in_scope = source_in_scope(
                                number(&source, "organizationId").unwrap_or(0),
                                number(&source, "companyId").unwrap_or(0),
                                &text(&source, "scope").unwrap_or_default(),
                                viewer,
                            );
                            if in_scope {
                                title = text(&source, "title");
                            }
                            in_scope
                        }
                        None => false,
                    }
                }
                None => number(&row, "companyId") == Some(viewer.company_id),
            };
            let availability = passage_availability(
                in_scope,
                &text(&row, "textState").unwrap_or_else(|| "tombstoned".to_string()),
            );
            if availability == Availability::OutOfScope {
                redacted(availability)
            } else {
                QueuePassage {
                    id: passage_id,
                    availability,
                    status: text(&row, "status"),
                    source_version_id: version_id,
                    source_title: (availability == Availability::Available)
                        .then_some(title)
                        .flatten()
                        .map(|title| bounded(&title)),
                }
            }
        }
    };
    cache.insert(passage_id, passage.clone());
    Ok(passage)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::*;

    const ME: &str = "0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a";
    const OTHER: &str = "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b";

    fn viewer() -> Viewer {
        Viewer {
            organization_id: 7,
            company_id: 3,
            actor_identity: ActorIdentity::parse(ME),
        }
    }

    #[derive(Default)]
    struct Rows {
        tables: HashMap<(&'static str, u64), Value>,
        claims: Vec<Value>,
        decisions: Vec<Value>,
        components: Vec<Value>,
    }

    #[async_trait]
    impl EvidenceRows for Rows {
        async fn row(&self, table: &'static str, id: u64) -> Result<Option<Value>> {
            Ok(self.tables.get(&(table, id)).cloned())
        }
        async fn dependencies_of(&self, _: u64, _: &'static str, _: u64) -> Result<Vec<Value>> {
            Ok(Vec::new())
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
    }

    #[async_trait]
    impl QueueRows for Rows {
        async fn claims_with_status(
            &self,
            org: u64,
            company: u64,
            status: &str,
            method: Option<&str>,
            limit: usize,
        ) -> Result<Vec<Value>> {
            let mut matches: Vec<Value> = self
                .claims
                .iter()
                .filter(|row| {
                    number(row, "organizationId") == Some(org)
                        && number(row, "companyId") == Some(company)
                        && text(row, "status").as_deref() == Some(status)
                        && method
                            .is_none_or(|m| text(row, "verificationMethod").as_deref() == Some(m))
                })
                .cloned()
                .collect();
            matches.sort_unstable_by_key(|row| std::cmp::Reverse(number(row, "id")));
            matches.truncate(limit);
            Ok(matches)
        }
        async fn decisions_with_status(
            &self,
            org: u64,
            company: u64,
            status: &str,
            limit: usize,
        ) -> Result<Vec<Value>> {
            let mut matches: Vec<Value> = self
                .decisions
                .iter()
                .filter(|row| {
                    number(row, "organizationId") == Some(org)
                        && number(row, "companyId") == Some(company)
                        && text(row, "status").as_deref() == Some(status)
                })
                .cloned()
                .collect();
            matches.sort_unstable_by_key(|row| std::cmp::Reverse(number(row, "id")));
            matches.truncate(limit);
            Ok(matches)
        }
        async fn workflow_step_components(
            &self,
            org: u64,
            company: u64,
            limit: usize,
        ) -> Result<Vec<Value>> {
            let mut matches: Vec<Value> = self
                .components
                .iter()
                .filter(|row| {
                    number(row, "organizationId") == Some(org)
                        && number(row, "companyId") == Some(company)
                })
                .cloned()
                .collect();
            matches.sort_unstable_by_key(|row| std::cmp::Reverse(number(row, "id")));
            matches.truncate(limit);
            Ok(matches)
        }
    }

    fn claim(id: u64, status: &str, method: &str, outcome: &str, creator: &str) -> Value {
        json!({
            "id": id, "organizationId": 7, "companyId": 3, "kind": "sourced_fact",
            "statement": format!("Claim {id}."), "supportingPassageIds": [11],
            "verificationMethod": method, "verificationOutcome": outcome,
            "status": status, "createUid": creator, "contributionId": 90,
        })
    }

    fn store() -> Rows {
        let mut rows = Rows::default();
        rows.tables.insert(
            ("ai_evidence_passage", 11),
            json!({
                "id": 11, "organizationId": 7, "companyId": 3, "sourceVersionId": 5,
                "status": "current", "textState": "present", "passageText": "SECRET TEXT",
            }),
        );
        rows.tables.insert(
            ("ai_evidence_source_version", 5),
            json!({ "id": 5, "sourceId": 2 }),
        );
        rows.tables.insert(
            ("ai_evidence_source", 2),
            json!({
                "id": 2, "organizationId": 7, "companyId": 3, "scope": "company",
                "title": "Refund policy",
            }),
        );
        rows.tables.insert(
            ("ai_evidence_contribution", 90),
            json!({
                "id": 90, "organizationId": 7, "companyId": 3,
                "contributorKind": "agent", "contributorUid": OTHER,
            }),
        );
        rows
    }

    #[tokio::test]
    async fn lists_flagged_and_machine_only_claims_with_context() {
        let mut rows = store();
        rows.claims = vec![
            claim(1, "needs_review", "human_reviewed", "unsupported", OTHER),
            claim(2, "current", "model_assisted", "supported", OTHER),
            claim(3, "current", "human_reviewed", "supported", OTHER),
            claim(4, "current", "deterministic", "unsupported", OTHER),
            claim(5, "superseded", "model_assisted", "supported", OTHER),
        ];
        rows.components = vec![json!({
            "id": 70, "organizationId": 7, "companyId": 3, "artifactRef": "workflow-version:42",
            "componentKey": "node:review", "componentKind": "workflow_step", "version": 1,
            "contentHash": "a".repeat(64), "decisionIds": [8], "claimIds": [2],
            "linkState": "changed", "status": "current",
        })];
        let queue = build_queue(&rows, viewer(), 25).await.unwrap();
        let listed: Vec<u64> = queue.claims.iter().map(|c| c.id).collect();
        assert_eq!(
            listed,
            vec![2, 1],
            "newest first; reviewed/superseded/unsupported-machine claims are absent"
        );
        let awaiting = &queue.claims[0];
        assert_eq!(awaiting.queue_reason, "awaiting_human_review");
        assert_eq!(awaiting.verification_method, "model_assisted");
        assert_eq!(awaiting.creator_uid.as_deref(), Some(OTHER));
        assert_eq!(awaiting.proposer_uid.as_deref(), Some(OTHER));
        assert_eq!(awaiting.proposer_kind.as_deref(), Some("agent"));
        assert!(awaiting.reviewable_by_viewer);
        assert_eq!(awaiting.passages[0].availability, Availability::Available);
        assert_eq!(
            awaiting.passages[0].source_title.as_deref(),
            Some("Refund policy")
        );
        assert_eq!(awaiting.affected_components.len(), 1);
        assert_eq!(
            awaiting.affected_components[0].workflow_version_id,
            Some(42)
        );
        assert_eq!(
            awaiting.affected_components[0].node_key.as_deref(),
            Some("review")
        );
        assert_eq!(queue.claims[1].queue_reason, "needs_review");
        // The step whose links changed is itself queued with its exact hash.
        assert_eq!(queue.components.len(), 1);
        assert_eq!(queue.components[0].content_hash, "a".repeat(64));
        assert_eq!(queue.components[0].node_key.as_deref(), Some("review"));
    }

    #[tokio::test]
    async fn creator_and_proposer_are_not_reviewable_by_the_viewer() {
        let mut rows = store();
        rows.claims = vec![
            claim(1, "current", "model_assisted", "supported", ME),
            claim(2, "current", "model_assisted", "supported", OTHER),
        ];
        rows.decisions = vec![json!({
            "id": 8, "organizationId": 7, "companyId": 3, "title": "Adopt", "status": "proposed",
            "adoptedClaimIds": [2], "createUid": OTHER, "contributionId": 91,
        })];
        rows.tables.insert(
            ("ai_evidence_contribution", 91),
            json!({
                "id": 91, "organizationId": 7, "companyId": 3,
                "contributorKind": "user", "contributorUid": ME,
            }),
        );
        let queue = build_queue(&rows, viewer(), 25).await.unwrap();
        let by_id = |id| queue.claims.iter().find(|c| c.id == id).unwrap();
        assert!(!by_id(1).reviewable_by_viewer, "the creator cannot review");
        assert!(by_id(2).reviewable_by_viewer);
        assert!(
            !queue.decisions[0].reviewable_by_viewer,
            "the proposer of the decision's contribution cannot review it"
        );
        // An unknown viewer is never told a review is possible.
        let anonymous = Viewer {
            actor_identity: None,
            ..viewer()
        };
        let queue = build_queue(&rows, anonymous, 25).await.unwrap();
        assert!(queue.claims.iter().all(|c| !c.reviewable_by_viewer));
    }

    #[tokio::test]
    async fn the_queue_is_company_scoped_bounded_and_reveals_no_foreign_text() {
        let mut rows = store();
        let mut foreign_company = claim(9, "needs_review", "model_assisted", "supported", OTHER);
        foreign_company["companyId"] = json!(4);
        let mut foreign_org = claim(10, "needs_review", "model_assisted", "supported", OTHER);
        foreign_org["organizationId"] = json!(8);
        rows.claims = vec![foreign_company, foreign_org];
        for id in 20..40 {
            rows.claims.push(claim(
                id,
                "needs_review",
                "model_assisted",
                "supported",
                OTHER,
            ));
        }
        let queue = build_queue(&rows, viewer(), 5).await.unwrap();
        assert_eq!(queue.claims.len(), 5);
        assert!(queue.claims_truncated);
        assert_eq!(
            queue
                .claims
                .iter()
                .map(|claim| claim.id)
                .collect::<Vec<_>>(),
            vec![39, 38, 37, 36, 35],
            "the bounded read must retain the newest tenant rows"
        );

        // A passage in another company's source is reduced to an id.
        let mut rows = store();
        rows.tables.get_mut(&("ai_evidence_source", 2)).unwrap()["companyId"] = json!(4);
        rows.claims = vec![claim(
            1,
            "needs_review",
            "model_assisted",
            "supported",
            OTHER,
        )];
        let queue = build_queue(&rows, viewer(), 25).await.unwrap();
        let passage = &queue.claims[0].passages[0];
        assert_eq!(passage.availability, Availability::OutOfScope);
        assert!(passage.source_title.is_none() && passage.source_version_id.is_none());
        let serialized = serde_json::to_string(&queue).unwrap();
        assert!(!serialized.contains("SECRET TEXT") && !serialized.contains("Refund policy"));
    }

    #[tokio::test]
    async fn revoked_or_deleted_passages_show_their_availability_without_text() {
        for (state, expected) in [
            ("restricted", Availability::Restricted),
            ("tombstoned", Availability::Tombstoned),
        ] {
            let mut rows = store();
            rows.tables.get_mut(&("ai_evidence_passage", 11)).unwrap()["textState"] = json!(state);
            rows.claims = vec![claim(
                1,
                "needs_review",
                "model_assisted",
                "supported",
                OTHER,
            )];
            let queue = build_queue(&rows, viewer(), 25).await.unwrap();
            assert_eq!(queue.claims[0].passages[0].availability, expected);
            assert!(queue.claims[0].passages[0].source_title.is_none());
        }
    }

    #[tokio::test]
    async fn the_limit_is_clamped() {
        let rows = store();
        assert!(build_queue(&rows, viewer(), 0).await.is_ok());
        assert!(build_queue(&rows, viewer(), usize::MAX).await.is_ok());
        assert_eq!(label("needs_review").unwrap(), "needs_review");
        assert!(label("x' OR '1'='1").is_err());
    }

    /// Against a live module populated by `run_workflow_provenance_tests`.
    #[tokio::test]
    #[ignore = "needs a live SpacetimeDB module populated by run_workflow_provenance_tests"]
    async fn live_queue_is_scoped_bounded_and_lists_flagged_workflow_steps() {
        let env = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} is required"));
        let client = StdbClient::new(env("STDB_URL"), env("STDB_MODULE"), env("STDB_TOKEN"));
        let flagged = client
            .query_sql(
                "SELECT * FROM ai_artifact_component WHERE component_kind = 'workflow_step' \
                 AND status = 'current' AND link_state = 'unresolved'",
            )
            .await
            .expect("components");
        let row = flagged.first().expect("an unresolved workflow step");
        let viewer = Viewer {
            organization_id: number(row, "organizationId").unwrap(),
            company_id: number(row, "companyId").unwrap(),
            actor_identity: None,
        };
        let queue = build_queue(&client, viewer, 10).await.unwrap();
        assert!(
            queue.claims.len() <= 10 && queue.decisions.len() <= 10 && queue.components.len() <= 10
        );
        assert!(
            queue
                .components
                .iter()
                .any(|component| component.id == number(row, "id").unwrap()
                    && component.link_state == "unresolved"
                    && component.content_hash.len() == 64),
            "the flagged step is queued with its exact hash: {:?}",
            queue.components
        );
        assert!(queue.claims.iter().all(|claim| !claim.reviewable_by_viewer));

        // Another company sees none of it.
        let sibling = Viewer {
            company_id: viewer.company_id + 1_000_000,
            ..viewer
        };
        let empty = build_queue(&client, sibling, 10).await.unwrap();
        assert!(
            empty.claims.is_empty() && empty.decisions.is_empty() && empty.components.is_empty()
        );
    }
}
