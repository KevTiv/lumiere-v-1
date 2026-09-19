//! AIH-16: the source and decision inspector, plus the read side of AIH-17
//! (scoped knowledge reuse) and AIH-18 (honest historical state).
//!
//! Given a component, decision, claim or knowledge version, this assembles the
//! persisted chain a reviewer needs — exact passage and version, original
//! author, introducing contribution, adaptations, validation outcome and
//! dependency state — and lists every reason the chain needs review.
//!
//! # Access
//!
//! Every read is re-authorized against the viewer's organization/company at
//! request time; nothing relies on the access that existed when a record was
//! written. A source outside the viewer's scope is reduced to an id and an
//! `out_of_scope` marker: no excerpt, title, author, hash or coordinates are
//! returned, so the inspector, and anything cached from it, cannot leak them.
//! `restricted` (access revoked) and `tombstoned` (deleted) passages likewise
//! return no excerpt. Whether the *acting user* may see a source is not
//! modelled yet: scope is organization/company, matching the AIH-15 catalog.
//!
//! # Honesty about history
//!
//! A retained hash without content is reported as `hash_only`, never as full
//! replay, and unavailable originals are explicit. Today's document is never
//! substituted for a version that was superseded or deleted.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use stdb_client::StdbClient;

/// Longest excerpt returned for a passage.
const MAX_EXCERPT_CHARS: usize = 1_000;
/// Longest revision chain followed for an edited/forked component.
const MAX_REVISION_DEPTH: usize = 64;

// ── Row access ───────────────────────────────────────────────────────────────

/// Read access to the evidence tables. Implemented for the STDB client; tests
/// use an in-memory fake.
#[async_trait]
pub trait EvidenceRows: Send + Sync {
    async fn row(&self, table: &'static str, id: u64) -> Result<Option<Value>>;
    /// Edges whose dependent is `(dependent_kind, id)`.
    async fn dependencies_of(
        &self,
        organization_id: u64,
        dependent_kind: &'static str,
        id: u64,
    ) -> Result<Vec<Value>>;
    async fn knowledge_entry_by_key(
        &self,
        organization_id: u64,
        company_id: u64,
        entry_key: &str,
    ) -> Result<Option<Value>>;
    async fn knowledge_versions_of(&self, entry_id: u64) -> Result<Vec<Value>>;
    async fn knowledge_reviews_of(&self, version_id: u64) -> Result<Vec<Value>>;
    async fn knowledge_membership(
        &self,
        organization_id: u64,
        company_id: u64,
        actor: ActorIdentity,
    ) -> Result<Option<KnowledgeMembership>> {
        let _ = (organization_id, company_id, actor);
        Ok(None)
    }
}

#[async_trait]
impl EvidenceRows for StdbClient {
    async fn row(&self, table: &'static str, id: u64) -> Result<Option<Value>> {
        let rows = self
            .query_sql(&format!("SELECT * FROM {table} WHERE id = {id} LIMIT 1"))
            .await
            .with_context(|| format!("load {table} {id}"))?;
        Ok(rows.into_iter().next())
    }

    async fn dependencies_of(
        &self,
        organization_id: u64,
        dependent_kind: &'static str,
        id: u64,
    ) -> Result<Vec<Value>> {
        self.query_sql(&format!(
            "SELECT * FROM ai_evidence_dependency WHERE organization_id = {organization_id} \
             AND dependent_kind = '{dependent_kind}' AND dependent_id = {id}"
        ))
        .await
        .context("load evidence dependencies")
    }

    async fn knowledge_entry_by_key(
        &self,
        organization_id: u64,
        company_id: u64,
        entry_key: &str,
    ) -> Result<Option<Value>> {
        // The key comes from a caller; anything that could not be a stored
        // key resolves to no entry rather than reaching the query.
        if entry_key.trim().is_empty()
            || entry_key.len() > 128
            || entry_key.chars().any(char::is_control)
        {
            return Ok(None);
        }
        let key = entry_key.replace('\'', "''");
        let rows = self
            .query_sql(&format!(
                "SELECT * FROM ai_knowledge_entry WHERE organization_id = {organization_id} \
                 AND company_id = {company_id} AND entry_key = '{key}' LIMIT 1"
            ))
            .await
            .context("load knowledge entry")?;
        Ok(rows.into_iter().next())
    }

    async fn knowledge_versions_of(&self, entry_id: u64) -> Result<Vec<Value>> {
        self.query_sql(&format!(
            "SELECT * FROM ai_knowledge_entry_version WHERE entry_id = {entry_id}"
        ))
        .await
        .context("load knowledge versions")
    }

    async fn knowledge_reviews_of(&self, version_id: u64) -> Result<Vec<Value>> {
        self.query_sql(&format!(
            "SELECT * FROM ai_knowledge_review WHERE version_id = {version_id}"
        ))
        .await
        .context("load knowledge reviews")
    }

    async fn knowledge_membership(
        &self,
        organization_id: u64,
        company_id: u64,
        actor: ActorIdentity,
    ) -> Result<Option<KnowledgeMembership>> {
        let rows = self
            .query_sql(&format!(
                "SELECT company_id, department_id FROM user_organization \
                 WHERE organization_id = {organization_id} AND user_identity = {} \
                 AND is_active = true",
                actor.sql_literal()
            ))
            .await
            .context("load knowledge team membership")?;
        let [membership] = rows.as_slice() else {
            return Ok(None);
        };
        if number(membership, "companyId").is_some_and(|id| id != company_id) {
            return Ok(None);
        }
        Ok(Some(KnowledgeMembership {
            department_id: number(membership, "departmentId").filter(|id| *id > 0),
        }))
    }
}

/// Who is looking. Resolved server-side by the caller; never model input.
#[derive(Debug, Clone, Copy)]
pub struct Viewer {
    pub organization_id: u64,
    pub company_id: u64,
    /// Present only when a trusted session boundary supplied a valid STDB
    /// identity. Missing identity denies personal and team reuse.
    pub actor_identity: Option<ActorIdentity>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActorIdentity([u8; 32]);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KnowledgeMembership {
    pub department_id: Option<u64>,
}

impl ActorIdentity {
    pub fn parse(value: &str) -> Option<Self> {
        let hex = value
            .trim()
            .strip_prefix("0x")
            .or_else(|| value.trim().strip_prefix("0X"))
            .unwrap_or(value.trim());
        if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        let mut bytes = [0_u8; 32];
        for (index, pair) in hex.as_bytes().chunks_exact(2).enumerate() {
            let text = std::str::from_utf8(pair).ok()?;
            bytes[index] = u8::from_str_radix(text, 16).ok()?;
        }
        Some(Self(bytes))
    }

    fn sql_literal(self) -> String {
        let mut hex = String::with_capacity(66);
        hex.push_str("0x");
        for byte in self.0 {
            use std::fmt::Write as _;
            let _ = write!(hex, "{byte:02x}");
        }
        hex
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InspectTarget {
    Component(u64),
    Decision(u64),
    Claim(u64),
    KnowledgeVersion(u64),
}

impl InspectTarget {
    pub fn parse(kind: &str, id: u64) -> Option<Self> {
        match kind {
            "component" => Some(Self::Component(id)),
            "decision" => Some(Self::Decision(id)),
            "claim" => Some(Self::Claim(id)),
            "knowledge_version" => Some(Self::KnowledgeVersion(id)),
            _ => None,
        }
    }

    fn dependent_kind(self) -> &'static str {
        match self {
            Self::Component(_) => "component",
            Self::Decision(_) => "decision",
            Self::Claim(_) => "claim",
            Self::KnowledgeVersion(_) => "knowledge_version",
        }
    }

    fn id(self) -> u64 {
        match self {
            Self::Component(id)
            | Self::Decision(id)
            | Self::Claim(id)
            | Self::KnowledgeVersion(id) => id,
        }
    }
}

// ── Views ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub target_kind: String,
    pub target_id: u64,
    /// Newest first: the target and the versions it was edited/forked from.
    pub revisions: Vec<ComponentView>,
    pub decisions: Vec<DecisionView>,
    pub claims: Vec<ClaimView>,
    pub passages: Vec<PassageView>,
    pub source_versions: Vec<SourceVersionView>,
    pub sources: Vec<SourceView>,
    pub contributions: Vec<ContributionView>,
    pub dependencies: Vec<DependencyView>,
    pub findings: Vec<Finding>,
    /// False while any blocking finding exists. A bibliography with no
    /// component-to-decision links can never pass.
    pub lineage_passes: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComponentView {
    pub id: u64,
    pub artifact_ref: String,
    pub component_key: String,
    pub component_kind: String,
    pub version: u64,
    pub content_hash: String,
    pub parent_component_id: Option<u64>,
    pub forked_from_artifact_ref: Option<String>,
    pub decision_ids: Vec<u64>,
    pub claim_ids: Vec<u64>,
    pub link_state: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DecisionView {
    pub id: u64,
    pub title: String,
    pub adopted_claim_ids: Vec<u64>,
    pub supporting_claim_ids: Vec<u64>,
    pub applicability: Vec<String>,
    pub alternatives: Vec<String>,
    pub adaptations: Vec<String>,
    pub assumptions: Vec<String>,
    pub rationale: String,
    pub contribution_id: Option<u64>,
    pub supersedes_decision_id: Option<u64>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaimView {
    pub id: u64,
    pub kind: String,
    pub statement: String,
    pub supporting_passage_ids: Vec<u64>,
    pub contradicting_passage_ids: Vec<u64>,
    pub calculation_ref: Option<String>,
    pub assumptions: Vec<String>,
    pub contribution_id: Option<u64>,
    /// none | deterministic | model_assisted | human_reviewed
    pub verification_method: String,
    pub verification_outcome: String,
    pub supersedes_claim_id: Option<u64>,
    pub status: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Availability {
    Available,
    /// Access was revoked; content is kept for authorized history only.
    Restricted,
    /// The content was deleted; only its hash remains.
    Tombstoned,
    /// Outside the viewer's scope. Nothing about it is revealed.
    OutOfScope,
    /// The referenced row does not exist.
    Missing,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PassageView {
    pub id: u64,
    pub availability: Availability,
    // Everything below is `None` unless the viewer may see the passage.
    pub source_version_id: Option<u64>,
    pub status: Option<String>,
    pub excerpt: Option<String>,
    pub excerpt_truncated: bool,
    /// Empty means the location is unknown; it is never guessed.
    pub coordinates: Vec<String>,
    pub text_origin: Option<String>,
    pub processor_ref: Option<String>,
    pub content_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceVersionView {
    pub id: u64,
    pub source_id: u64,
    pub version: String,
    pub edition: Option<String>,
    pub publication_date_micros: Option<i64>,
    pub uri: Option<String>,
    pub origin: String,
    /// unverified_recollection | user_reported | inspected
    pub verification: String,
    pub status: String,
    pub snapshot_state: String,
    /// full_replay | hash_only | restricted | unavailable — see `replay_state`.
    pub replay: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceView {
    pub id: u64,
    pub out_of_scope: bool,
    pub source_kind: Option<String>,
    pub source_key: Option<String>,
    pub title: Option<String>,
    /// known | unknown. `unknown` is stated, not inferred.
    pub author_attribution: Option<String>,
    pub authors: Vec<String>,
    pub author_organization: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContributionView {
    pub id: u64,
    pub contributor_kind: String,
    pub agent_run_id: Option<u64>,
    pub session_ref: String,
    pub turn_ref: Option<String>,
    pub introduced_kind: String,
    pub source_version_id: Option<u64>,
    pub inspection_state: String,
    pub is_secondary_quotation: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DependencyView {
    pub dependent_kind: String,
    pub dependent_id: u64,
    pub upstream_kind: String,
    pub upstream_id: u64,
    pub requirement: String,
    pub state: String,
    pub acknowledged: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// The chain must not be published, reused or executed as it stands.
    Blocking,
    /// A reviewer should look; nothing forbids proceeding.
    Review,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub severity: Severity,
    pub code: String,
    pub message: String,
}

// ── Pure rules ───────────────────────────────────────────────────────────────

/// Mirrors `reference_in_scope` in the STDB module: a company-scoped source is
/// visible to its own company, an organization-scoped one to the organization,
/// and nothing crosses an organization.
pub fn source_in_scope(
    source_org: u64,
    source_company: u64,
    source_scope: &str,
    viewer: Viewer,
) -> bool {
    if source_org != viewer.organization_id {
        return false;
    }
    match source_scope {
        "organization" => true,
        "company" => source_company == viewer.company_id,
        _ => false,
    }
}

pub fn passage_availability(in_scope: bool, text_state: &str) -> Availability {
    if !in_scope {
        return Availability::OutOfScope;
    }
    match text_state {
        "present" => Availability::Available,
        "restricted" => Availability::Restricted,
        // Unknown reads as the most restrictive state, never as available.
        _ => Availability::Tombstoned,
    }
}

/// What can truthfully be said about replaying a source version. A retained
/// hash proves what the content was; it does not reconstruct it.
pub fn replay_state(status: &str, snapshot_state: &str) -> &'static str {
    match (status, snapshot_state) {
        ("access_revoked", _) => "restricted",
        ("deleted", "hash_only") => "hash_only",
        ("deleted", _) => "unavailable",
        (_, "retained") => "full_replay",
        (_, "hash_only") => "hash_only",
        _ => "unavailable",
    }
}

fn truncate_excerpt(text: &str) -> (String, bool) {
    if text.chars().count() <= MAX_EXCERPT_CHARS {
        (text.to_string(), false)
    } else {
        (text.chars().take(MAX_EXCERPT_CHARS).collect(), true)
    }
}

// ── Row parsing ──────────────────────────────────────────────────────────────

fn text(row: &Value, field: &str) -> Option<String> {
    row.get(field).and_then(Value::as_str).map(str::to_string)
}

fn number(row: &Value, field: &str) -> Option<u64> {
    row.get(field).and_then(Value::as_u64)
}

fn identity(row: &Value, field: &str) -> Option<ActorIdentity> {
    let value = row.get(field)?;
    value
        .as_str()
        .or_else(|| value.get("__identity__").and_then(Value::as_str))
        .and_then(ActorIdentity::parse)
}

fn strings(row: &Value, field: &str) -> Vec<String> {
    row.get(field)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn ids(row: &Value, field: &str) -> Vec<u64> {
    row.get(field)
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_u64).collect())
        .unwrap_or_default()
}

fn required_text(row: &Value, field: &str) -> Result<String> {
    text(row, field).with_context(|| format!("row is missing '{field}'"))
}

fn required_id(row: &Value) -> Result<u64> {
    number(row, "id").context("row is missing 'id'")
}

/// Rows must be in the viewer's organization; company-owned records must be in
/// its company. A row that fails is reported as absent, not as forbidden, so
/// the inspector does not confirm that an id exists elsewhere.
fn owned_by(row: &Value, viewer: Viewer) -> bool {
    number(row, "organizationId") == Some(viewer.organization_id)
        && number(row, "companyId") == Some(viewer.company_id)
}

fn component_view(row: &Value) -> Result<ComponentView> {
    Ok(ComponentView {
        id: required_id(row)?,
        artifact_ref: required_text(row, "artifactRef")?,
        component_key: required_text(row, "componentKey")?,
        component_kind: required_text(row, "componentKind")?,
        version: number(row, "version").unwrap_or(1),
        content_hash: required_text(row, "contentHash")?,
        parent_component_id: number(row, "parentComponentId"),
        forked_from_artifact_ref: text(row, "forkedFromArtifactRef"),
        decision_ids: ids(row, "decisionIds"),
        claim_ids: ids(row, "claimIds"),
        link_state: required_text(row, "linkState")?,
        status: required_text(row, "status")?,
    })
}

fn decision_view(row: &Value) -> Result<DecisionView> {
    Ok(DecisionView {
        id: required_id(row)?,
        title: required_text(row, "title")?,
        adopted_claim_ids: ids(row, "adoptedClaimIds"),
        supporting_claim_ids: ids(row, "supportingClaimIds"),
        applicability: strings(row, "applicability"),
        alternatives: strings(row, "alternatives"),
        adaptations: strings(row, "adaptations"),
        assumptions: strings(row, "assumptions"),
        rationale: required_text(row, "rationale")?,
        contribution_id: number(row, "contributionId"),
        supersedes_decision_id: number(row, "supersedesDecisionId"),
        status: required_text(row, "status")?,
    })
}

fn claim_view(row: &Value) -> Result<ClaimView> {
    Ok(ClaimView {
        id: required_id(row)?,
        kind: required_text(row, "kind")?,
        statement: required_text(row, "statement")?,
        supporting_passage_ids: ids(row, "supportingPassageIds"),
        contradicting_passage_ids: ids(row, "contradictingPassageIds"),
        calculation_ref: text(row, "calculationRef"),
        assumptions: strings(row, "assumptions"),
        contribution_id: number(row, "contributionId"),
        verification_method: required_text(row, "verificationMethod")?,
        verification_outcome: required_text(row, "verificationOutcome")?,
        supersedes_claim_id: number(row, "supersedesClaimId"),
        status: required_text(row, "status")?,
    })
}

fn contribution_view(row: &Value) -> Result<ContributionView> {
    Ok(ContributionView {
        id: required_id(row)?,
        contributor_kind: required_text(row, "contributorKind")?,
        agent_run_id: number(row, "agentRunId"),
        session_ref: required_text(row, "sessionRef")?,
        turn_ref: text(row, "turnRef"),
        introduced_kind: required_text(row, "introducedKind")?,
        source_version_id: number(row, "sourceVersionId"),
        inspection_state: required_text(row, "inspectionState")?,
        is_secondary_quotation: row
            .get("isSecondaryQuotation")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn dependency_view(row: &Value) -> Result<DependencyView> {
    Ok(DependencyView {
        dependent_kind: required_text(row, "dependentKind")?,
        dependent_id: number(row, "dependentId").context("dependency missing dependentId")?,
        upstream_kind: required_text(row, "upstreamKind")?,
        upstream_id: number(row, "upstreamId").context("dependency missing upstreamId")?,
        requirement: required_text(row, "requirement")?,
        state: required_text(row, "state")?,
        acknowledged: row
            .get("acknowledgedBy")
            .is_some_and(|value| !value.is_null()),
    })
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/// Assemble the chain behind `target`, re-authorized for `viewer`.
pub async fn inspect(
    rows: &dyn EvidenceRows,
    viewer: Viewer,
    target: InspectTarget,
) -> Result<Inspection> {
    let mut revisions: Vec<ComponentView> = Vec::new();
    let mut decision_ids: Vec<u64> = Vec::new();
    let mut claim_ids: BTreeSet<u64> = BTreeSet::new();
    let mut passage_ids: BTreeSet<u64> = BTreeSet::new();

    // Roots.
    match target {
        InspectTarget::Component(id) => {
            let mut cursor = Some(id);
            while let Some(current) = cursor {
                if revisions.len() >= MAX_REVISION_DEPTH {
                    bail!("component revision chain exceeds {MAX_REVISION_DEPTH} versions");
                }
                let row = rows
                    .row("ai_artifact_component", current)
                    .await?
                    .filter(|row| owned_by(row, viewer))
                    .with_context(|| format!("component {current} not found"))?;
                let view = component_view(&row)?;
                cursor = view.parent_component_id;
                revisions.push(view);
            }
            let head = &revisions[0];
            decision_ids = head.decision_ids.clone();
            claim_ids.extend(head.claim_ids.iter().copied());
        }
        InspectTarget::Decision(id) => decision_ids.push(id),
        InspectTarget::Claim(id) => {
            claim_ids.insert(id);
        }
        InspectTarget::KnowledgeVersion(id) => {
            let row = rows
                .row("ai_knowledge_entry_version", id)
                .await?
                .filter(|row| owned_by(row, viewer))
                .with_context(|| format!("knowledge version {id} not found"))?;
            let entry_id = number(&row, "entryId").context("knowledge version has no entry")?;
            let entry = rows
                .row("ai_knowledge_entry", entry_id)
                .await?
                .filter(|entry| owned_by(entry, viewer))
                .with_context(|| format!("knowledge version {id} not found"))?;
            if !knowledge_scope_allowed(rows, viewer, &entry).await? {
                bail!("knowledge version {id} not found");
            }
            decision_ids = ids(&row, "decisionIds");
            claim_ids.extend(ids(&row, "claimIds"));
            passage_ids.extend(ids(&row, "sourcePassageIds"));
        }
    }

    // Decisions -> claims.
    let mut decisions: Vec<DecisionView> = Vec::new();
    for id in &decision_ids {
        let row = rows
            .row("ai_evidence_decision", *id)
            .await?
            .filter(|row| owned_by(row, viewer))
            .with_context(|| format!("decision {id} not found"))?;
        let view = decision_view(&row)?;
        claim_ids.extend(view.adopted_claim_ids.iter().copied());
        claim_ids.extend(view.supporting_claim_ids.iter().copied());
        decisions.push(view);
    }

    // Claims -> passages.
    let mut claims: Vec<ClaimView> = Vec::new();
    for id in &claim_ids {
        let row = rows
            .row("ai_evidence_claim", *id)
            .await?
            .filter(|row| owned_by(row, viewer))
            .with_context(|| format!("claim {id} not found"))?;
        let view = claim_view(&row)?;
        passage_ids.extend(view.supporting_passage_ids.iter().copied());
        passage_ids.extend(view.contradicting_passage_ids.iter().copied());
        claims.push(view);
    }

    // Passages -> versions -> sources, with per-source scope decisions.
    let mut passages: Vec<PassageView> = Vec::new();
    let mut version_ids: BTreeSet<u64> = BTreeSet::new();
    let mut passage_versions: BTreeMap<u64, u64> = BTreeMap::new();
    for id in &passage_ids {
        let Some(row) = rows.row("ai_evidence_passage", *id).await? else {
            passages.push(redacted_passage(*id, Availability::Missing));
            continue;
        };
        if number(&row, "organizationId") != Some(viewer.organization_id) {
            passages.push(redacted_passage(*id, Availability::OutOfScope));
            continue;
        }
        let version_id = number(&row, "sourceVersionId");
        let in_scope = match version_id {
            Some(version_id) => source_of_version(rows, version_id)
                .await?
                .is_some_and(|source| {
                    source_in_scope(
                        number(&source, "organizationId").unwrap_or(0),
                        number(&source, "companyId").unwrap_or(0),
                        &text(&source, "scope").unwrap_or_default(),
                        viewer,
                    )
                }),
            // Passages recorded before source registration are company-owned.
            None => number(&row, "companyId") == Some(viewer.company_id),
        };
        let availability = passage_availability(
            in_scope,
            &text(&row, "textState").unwrap_or_else(|| "tombstoned".to_string()),
        );
        if let (true, Some(version_id)) = (in_scope, version_id) {
            version_ids.insert(version_id);
            passage_versions.insert(*id, version_id);
        }
        passages.push(passage_view(&row, *id, availability));
    }

    let mut source_versions: Vec<SourceVersionView> = Vec::new();
    let mut source_ids: BTreeSet<u64> = BTreeSet::new();
    for id in &version_ids {
        if let Some(row) = rows.row("ai_evidence_source_version", *id).await? {
            let view = source_version_view(&row)?;
            source_ids.insert(view.source_id);
            source_versions.push(view);
        }
    }
    let mut sources: Vec<SourceView> = Vec::new();
    for id in &source_ids {
        if let Some(row) = rows.row("ai_evidence_source", *id).await? {
            sources.push(source_view(&row, viewer)?);
        }
    }

    // Contributions introduced by claims and decisions.
    let contribution_ids: BTreeSet<u64> = claims
        .iter()
        .filter_map(|claim| claim.contribution_id)
        .chain(
            decisions
                .iter()
                .filter_map(|decision| decision.contribution_id),
        )
        .collect();
    let mut contributions: Vec<ContributionView> = Vec::new();
    for id in contribution_ids {
        if let Some(row) = rows
            .row("ai_evidence_contribution", id)
            .await?
            .filter(|row| owned_by(row, viewer))
        {
            contributions.push(contribution_view(&row)?);
        }
    }

    // Dependency edges for the target and every node above it.
    let mut dependencies: Vec<DependencyView> = Vec::new();
    let mut edge_targets: Vec<(&'static str, u64)> = vec![(target.dependent_kind(), target.id())];
    edge_targets.extend(decisions.iter().map(|d| ("decision", d.id)));
    edge_targets.extend(claims.iter().map(|c| ("claim", c.id)));
    edge_targets.sort_unstable();
    edge_targets.dedup();
    for (kind, id) in edge_targets {
        for row in rows
            .dependencies_of(viewer.organization_id, kind, id)
            .await?
        {
            dependencies.push(dependency_view(&row)?);
        }
    }

    let findings = findings_for(
        target,
        &revisions,
        &decisions,
        &claims,
        &passages,
        &source_versions,
        &dependencies,
    );
    let lineage_passes = !findings
        .iter()
        .any(|finding| finding.severity == Severity::Blocking);

    Ok(Inspection {
        target_kind: target.dependent_kind().to_string(),
        target_id: target.id(),
        revisions,
        decisions,
        claims,
        passages,
        source_versions,
        sources,
        contributions,
        dependencies,
        findings,
        lineage_passes,
    })
}

async fn source_of_version(rows: &dyn EvidenceRows, version_id: u64) -> Result<Option<Value>> {
    let Some(version) = rows.row("ai_evidence_source_version", version_id).await? else {
        return Ok(None);
    };
    let Some(source_id) = number(&version, "sourceId") else {
        return Ok(None);
    };
    rows.row("ai_evidence_source", source_id).await
}

fn redacted_passage(id: u64, availability: Availability) -> PassageView {
    PassageView {
        id,
        availability,
        source_version_id: None,
        status: None,
        excerpt: None,
        excerpt_truncated: false,
        coordinates: Vec::new(),
        text_origin: None,
        processor_ref: None,
        content_hash: None,
    }
}

fn passage_view(row: &Value, id: u64, availability: Availability) -> PassageView {
    if availability == Availability::OutOfScope {
        return redacted_passage(id, availability);
    }
    let (excerpt, excerpt_truncated) = if availability == Availability::Available {
        text(row, "passageText")
            .map(|body| {
                let (excerpt, truncated) = truncate_excerpt(&body);
                (Some(excerpt), truncated)
            })
            .unwrap_or((None, false))
    } else {
        // Restricted or tombstoned: no excerpt, only the fact and the hash.
        (None, false)
    };
    PassageView {
        id,
        availability,
        source_version_id: number(row, "sourceVersionId"),
        status: text(row, "status"),
        excerpt,
        excerpt_truncated,
        coordinates: strings(row, "coordinates"),
        text_origin: text(row, "textOrigin"),
        processor_ref: text(row, "processorRef"),
        content_hash: text(row, "contentHash"),
    }
}

fn source_version_view(row: &Value) -> Result<SourceVersionView> {
    let status = required_text(row, "status")?;
    let snapshot_state = required_text(row, "snapshotState")?;
    Ok(SourceVersionView {
        id: required_id(row)?,
        source_id: number(row, "sourceId").context("version missing sourceId")?,
        version: required_text(row, "version")?,
        edition: text(row, "edition"),
        publication_date_micros: row.get("publicationDateMicros").and_then(Value::as_i64),
        uri: text(row, "uri"),
        origin: required_text(row, "origin")?,
        verification: required_text(row, "verification")?,
        replay: replay_state(&status, &snapshot_state).to_string(),
        status,
        snapshot_state,
    })
}

fn source_view(row: &Value, viewer: Viewer) -> Result<SourceView> {
    let id = required_id(row)?;
    let in_scope = source_in_scope(
        number(row, "organizationId").unwrap_or(0),
        number(row, "companyId").unwrap_or(0),
        &text(row, "scope").unwrap_or_default(),
        viewer,
    );
    if !in_scope {
        return Ok(SourceView {
            id,
            out_of_scope: true,
            source_kind: None,
            source_key: None,
            title: None,
            author_attribution: None,
            authors: Vec::new(),
            author_organization: None,
            scope: None,
        });
    }
    Ok(SourceView {
        id,
        out_of_scope: false,
        source_kind: text(row, "sourceKind"),
        source_key: text(row, "sourceKey"),
        title: text(row, "title"),
        author_attribution: text(row, "authorAttribution"),
        authors: strings(row, "authors"),
        author_organization: text(row, "authorOrganization"),
        scope: text(row, "scope"),
    })
}

fn finding(severity: Severity, code: &str, message: String) -> Finding {
    Finding {
        severity,
        code: code.to_string(),
        message,
    }
}

/// Every reason the chain needs review. Pure, so the same rules can be
/// applied at publication and reuse gates.
fn findings_for(
    target: InspectTarget,
    revisions: &[ComponentView],
    decisions: &[DecisionView],
    claims: &[ClaimView],
    passages: &[PassageView],
    source_versions: &[SourceVersionView],
    dependencies: &[DependencyView],
) -> Vec<Finding> {
    let mut findings = Vec::new();

    if let Some(head) = revisions.first() {
        if head.status != "current" {
            findings.push(finding(
                Severity::Blocking,
                "component_superseded",
                format!("component {} is {}, not current", head.id, head.status),
            ));
        }
        if head.link_state != "linked" {
            findings.push(finding(
                Severity::Blocking,
                "component_links_unconfirmed",
                format!(
                    "component links are '{}'; a reviewer must confirm they still support this version",
                    head.link_state
                ),
            ));
        }
        if head.decision_ids.is_empty() {
            findings.push(finding(
                Severity::Blocking,
                "component_without_decision",
                "the component links no decision; sources and claims alone are only a bibliography"
                    .to_string(),
            ));
        }
    }
    if matches!(target, InspectTarget::Component(_)) && decisions.is_empty() {
        findings.push(finding(
            Severity::Blocking,
            "no_decision_chain",
            "no decision could be resolved from the component".to_string(),
        ));
    }
    for decision in decisions {
        if decision.status != "accepted" {
            findings.push(finding(
                Severity::Blocking,
                "decision_not_accepted",
                format!("decision {} is {}", decision.id, decision.status),
            ));
        }
    }
    for claim in claims {
        if claim.status != "current" {
            findings.push(finding(
                Severity::Blocking,
                "claim_not_current",
                format!("claim {} is {}", claim.id, claim.status),
            ));
        }
        if claim.verification_outcome == "unsupported" {
            findings.push(finding(
                Severity::Blocking,
                "claim_unsupported",
                format!("claim {} was judged unsupported", claim.id),
            ));
        } else if claim.verification_outcome == "unverified" {
            findings.push(finding(
                Severity::Review,
                "claim_unverified",
                format!("claim {} has not been verified", claim.id),
            ));
        }
        if claim.verification_method == "model_assisted" {
            findings.push(finding(
                Severity::Review,
                "claim_model_assisted_only",
                format!(
                    "claim {} was checked by a model; that is not human or domain approval",
                    claim.id
                ),
            ));
        }
    }
    for passage in passages {
        match passage.availability {
            Availability::Available => {}
            Availability::Restricted | Availability::Tombstoned | Availability::Missing => {
                findings.push(finding(
                    Severity::Blocking,
                    "passage_unavailable",
                    format!("passage {} is {:?}", passage.id, passage.availability),
                ));
            }
            Availability::OutOfScope => findings.push(finding(
                Severity::Review,
                "passage_out_of_scope",
                format!(
                    "passage {} is outside your access and is not shown",
                    passage.id
                ),
            )),
        }
        // A superseded passage is history a reviewer may have reaffirmed
        // (the dependency edges carry that judgement), so it is shown for
        // review. A withdrawn one, or an unrecognised status, blocks.
        if let Some(status) = passage
            .status
            .as_deref()
            .filter(|status| *status != "current")
        {
            if passage.availability == Availability::Available {
                findings.push(finding(
                    if status == "superseded" {
                        Severity::Review
                    } else {
                        Severity::Blocking
                    },
                    "passage_not_current",
                    format!("passage {} is {status}", passage.id),
                ));
            }
        }
    }
    for version in source_versions {
        if version.verification != "inspected" {
            findings.push(finding(
                Severity::Review,
                "source_unverified",
                format!(
                    "source version {} is {}, not inspected",
                    version.id, version.verification
                ),
            ));
        }
        if version.status != "current" {
            findings.push(finding(
                // Superseded is history to review; retracted, revoked or
                // deleted evidence blocks.
                if version.status == "superseded" {
                    Severity::Review
                } else {
                    Severity::Blocking
                },
                "source_version_not_current",
                format!(
                    "source version {} is {} (replay: {})",
                    version.id, version.status, version.replay
                ),
            ));
        }
    }
    for edge in dependencies {
        if edge.state == "valid" {
            continue;
        }
        let required = edge.requirement == "required";
        if !required && edge.acknowledged {
            continue;
        }
        findings.push(finding(
            if required {
                Severity::Blocking
            } else {
                Severity::Review
            },
            "dependency_not_valid",
            format!(
                "{} {} depends on {} {} ({}), which is {}",
                edge.dependent_kind,
                edge.dependent_id,
                edge.upstream_kind,
                edge.upstream_id,
                edge.requirement,
                edge.state
            ),
        ));
    }
    findings
}

// ── Knowledge reuse (AIH-17) ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeReuse {
    pub entry_id: u64,
    pub entry_key: String,
    pub kind: String,
    pub version_id: u64,
    pub version: u64,
    pub title: String,
    pub body: String,
    pub applicability: Vec<String>,
    pub domain_tags: Vec<String>,
    /// The source/decision lineage behind this version, re-authorized now.
    pub lineage: Inspection,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum KnowledgeRetrieval {
    Reusable(Box<KnowledgeReuse>),
    /// Nothing approved is reusable, with the reasons why.
    Denied {
        reasons: Vec<String>,
    },
}

/// Retrieve the approved version of an entry for a fresh task. Reuse is
/// re-decided from current state — approval, scope, and dependencies — and
/// never from what was true when the entry was written.
pub async fn retrieve_reusable_knowledge(
    rows: &dyn EvidenceRows,
    viewer: Viewer,
    entry_key: &str,
) -> Result<KnowledgeRetrieval> {
    let Some(entry) = rows
        .knowledge_entry_by_key(viewer.organization_id, viewer.company_id, entry_key)
        .await?
    else {
        return Ok(KnowledgeRetrieval::Denied {
            reasons: vec!["no such knowledge entry in this scope".to_string()],
        });
    };
    let scope_allowed = knowledge_scope_allowed(rows, viewer, &entry).await?;
    if !scope_allowed {
        return Ok(KnowledgeRetrieval::Denied {
            // Do not confirm which private/team entry exists.
            reasons: vec!["no such knowledge entry in this scope".to_string()],
        });
    }
    let entry_id = required_id(&entry)?;
    let versions = rows.knowledge_versions_of(entry_id).await?;
    let Some(approved) = versions
        .iter()
        .filter(|row| text(row, "reviewState").as_deref() == Some("approved"))
        .max_by_key(|row| number(row, "version").unwrap_or(0))
    else {
        let states: Vec<String> = versions
            .iter()
            .filter_map(|row| text(row, "reviewState"))
            .collect();
        return Ok(KnowledgeRetrieval::Denied {
            reasons: vec![format!(
                "no approved version (versions: {})",
                if states.is_empty() {
                    "none".to_string()
                } else {
                    states.join(", ")
                }
            )],
        });
    };
    if !owned_by(approved, viewer) {
        return Ok(KnowledgeRetrieval::Denied {
            reasons: vec!["no such knowledge entry in this scope".to_string()],
        });
    }
    let version_id = required_id(approved)?;
    let review_epoch = number(approved, "reviewEpoch");
    let owner = identity(&entry, "ownerUid");
    let proposer = identity(approved, "createUid");
    let reviews = rows.knowledge_reviews_of(version_id).await?;
    if !reviews_establish_independent_approval(
        required_text(&entry, "kind")?.as_str(),
        review_epoch,
        owner,
        proposer,
        &reviews,
    ) {
        return Ok(KnowledgeRetrieval::Denied {
            reasons: vec![
                "approved state lacks complete independent reviews in its current epoch"
                    .to_string(),
            ],
        });
    }
    let lineage = inspect(rows, viewer, InspectTarget::KnowledgeVersion(version_id)).await?;

    // Reuse needs a chain with nothing blocking. A knowledge version rests
    // directly on passages and claims, so an unresolved or invalid required
    // edge denies it even though the version still says "approved".
    // Evidence the viewer cannot see also denies reuse: text derived from a
    // source must not reach someone who could not read the source.
    let blocking: Vec<String> = lineage
        .findings
        .iter()
        .filter(|finding| {
            finding.severity == Severity::Blocking || finding.code == "passage_out_of_scope"
        })
        .map(|finding| finding.message.clone())
        .collect();
    if !blocking.is_empty() {
        return Ok(KnowledgeRetrieval::Denied { reasons: blocking });
    }
    Ok(KnowledgeRetrieval::Reusable(Box::new(KnowledgeReuse {
        entry_id,
        entry_key: required_text(&entry, "entryKey")?,
        kind: required_text(&entry, "kind")?,
        version_id,
        version: number(approved, "version").unwrap_or(1),
        title: required_text(approved, "title")?,
        body: required_text(approved, "body")?,
        applicability: strings(approved, "applicability"),
        domain_tags: strings(&entry, "domainTags"),
        lineage,
    })))
}

async fn knowledge_scope_allowed(
    rows: &dyn EvidenceRows,
    viewer: Viewer,
    entry: &Value,
) -> Result<bool> {
    let share_scope = text(entry, "shareScope").unwrap_or_default();
    let membership = match viewer.actor_identity {
        Some(actor) => {
            rows.knowledge_membership(viewer.organization_id, viewer.company_id, actor)
                .await?
        }
        None => None,
    };
    Ok(match share_scope.as_str() {
        "organization" => true,
        "personal" => membership.is_some() && identity(&entry, "ownerUid") == viewer.actor_identity,
        "team" => {
            membership.is_some()
                && text(&entry, "teamRef")
                    .and_then(|team_ref| {
                        team_ref
                            .strip_prefix("department:")
                            .and_then(|value| value.parse::<u64>().ok())
                    })
                    .filter(|department_id| *department_id > 0)
                    == membership.and_then(|membership| membership.department_id)
        }
        _ => false,
    })
}

fn reviews_establish_independent_approval(
    kind: &str,
    review_epoch: Option<u64>,
    owner: Option<ActorIdentity>,
    proposer: Option<ActorIdentity>,
    reviews: &[Value],
) -> bool {
    let (Some(epoch), Some(owner), Some(proposer)) = (review_epoch, owner, proposer) else {
        return false;
    };
    let mut latest = BTreeMap::<String, (u64, String)>::new();
    for review in reviews {
        if number(review, "reviewEpoch") != Some(epoch) {
            continue;
        }
        let Some(reviewer) = identity(review, "reviewerUid") else {
            return false;
        };
        if reviewer == owner || reviewer == proposer {
            return false;
        }
        let (Some(review_kind), Some(outcome), Some(id)) = (
            text(review, "reviewKind"),
            text(review, "outcome"),
            number(review, "id"),
        ) else {
            return false;
        };
        let replace = latest
            .get(&review_kind)
            .is_none_or(|(current_id, _)| id > *current_id);
        if replace {
            latest.insert(review_kind, (id, outcome));
        }
    }
    if latest.values().any(|(_, outcome)| outcome == "rejected") {
        return false;
    }
    let required = if kind == "procedure" {
        &["source_fidelity", "domain_interpretation", "implementation"][..]
    } else {
        &["source_fidelity", "domain_interpretation"][..]
    };
    required.iter().all(|required_kind| {
        latest
            .get(*required_kind)
            .is_some_and(|(_, outcome)| outcome == "accepted")
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::*;

    const VIEWER: Viewer = Viewer {
        organization_id: 1,
        company_id: 10,
        actor_identity: None,
    };

    #[derive(Default)]
    struct FakeRows {
        tables: HashMap<(&'static str, u64), Value>,
        dependencies: Vec<Value>,
        entries: Vec<Value>,
        versions: Vec<Value>,
        reviews: Vec<Value>,
        team_department_id: Option<u64>,
        has_active_membership: bool,
    }

    #[async_trait]
    impl EvidenceRows for FakeRows {
        async fn row(&self, table: &'static str, id: u64) -> Result<Option<Value>> {
            Ok(self.tables.get(&(table, id)).cloned())
        }
        async fn dependencies_of(
            &self,
            organization_id: u64,
            dependent_kind: &'static str,
            id: u64,
        ) -> Result<Vec<Value>> {
            Ok(self
                .dependencies
                .iter()
                .filter(|edge| {
                    number(edge, "organizationId") == Some(organization_id)
                        && text(edge, "dependentKind").as_deref() == Some(dependent_kind)
                        && number(edge, "dependentId") == Some(id)
                })
                .cloned()
                .collect())
        }
        async fn knowledge_entry_by_key(
            &self,
            organization_id: u64,
            company_id: u64,
            entry_key: &str,
        ) -> Result<Option<Value>> {
            Ok(self
                .entries
                .iter()
                .find(|entry| {
                    number(entry, "organizationId") == Some(organization_id)
                        && number(entry, "companyId") == Some(company_id)
                        && text(entry, "entryKey").as_deref() == Some(entry_key)
                })
                .cloned())
        }
        async fn knowledge_versions_of(&self, entry_id: u64) -> Result<Vec<Value>> {
            Ok(self
                .versions
                .iter()
                .filter(|row| number(row, "entryId") == Some(entry_id))
                .cloned()
                .collect())
        }
        async fn knowledge_reviews_of(&self, version_id: u64) -> Result<Vec<Value>> {
            Ok(self
                .reviews
                .iter()
                .filter(|row| number(row, "versionId") == Some(version_id))
                .cloned()
                .collect())
        }
        async fn knowledge_membership(
            &self,
            _organization_id: u64,
            _company_id: u64,
            _actor: ActorIdentity,
        ) -> Result<Option<KnowledgeMembership>> {
            Ok(self.has_active_membership.then_some(KnowledgeMembership {
                department_id: self.team_department_id,
            }))
        }
    }

    /// passage 5 -> claim 3 -> decision 2 -> component 1 (v2, parent v1 = 0).
    fn healthy() -> FakeRows {
        let mut rows = FakeRows::default();
        let put = |rows: &mut FakeRows, table: &'static str, id: u64, value: Value| {
            rows.tables.insert((table, id), value);
        };
        put(
            &mut rows,
            "ai_artifact_component",
            1,
            json!({
                "id": 1, "organizationId": 1, "companyId": 10, "artifactRef": "wf:1",
                "componentKey": "step-a", "componentKind": "formula", "version": 2,
                "contentHash": "b".repeat(64), "parentComponentId": 9,
                "decisionIds": [2], "claimIds": [], "linkState": "linked", "status": "current"
            }),
        );
        put(
            &mut rows,
            "ai_artifact_component",
            9,
            json!({
                "id": 9, "organizationId": 1, "companyId": 10, "artifactRef": "wf:1",
                "componentKey": "step-a", "componentKind": "formula", "version": 1,
                "contentHash": "a".repeat(64),
                "decisionIds": [2], "claimIds": [], "linkState": "linked", "status": "superseded"
            }),
        );
        put(
            &mut rows,
            "ai_evidence_decision",
            2,
            json!({
                "id": 2, "organizationId": 1, "companyId": 10, "title": "Adopt method",
                "adoptedClaimIds": [3], "supportingClaimIds": [], "applicability": [],
                "alternatives": ["declining balance"], "adaptations": ["5 year life"],
                "assumptions": [], "rationale": "Matches policy", "contributionId": 7,
                "status": "accepted"
            }),
        );
        put(
            &mut rows,
            "ai_evidence_claim",
            3,
            json!({
                "id": 3, "organizationId": 1, "companyId": 10, "kind": "sourced_fact",
                "statement": "Straight line.", "supportingPassageIds": [5],
                "contradictingPassageIds": [], "assumptions": [], "contributionId": 7,
                "verificationMethod": "human_reviewed", "verificationOutcome": "supported",
                "status": "current"
            }),
        );
        put(
            &mut rows,
            "ai_evidence_passage",
            5,
            json!({
                "id": 5, "organizationId": 1, "companyId": 10, "sourceVersionId": 6,
                "passageText": "The full text of the passage.", "contentHash": "c".repeat(64),
                "coordinates": ["page:12"], "textOrigin": "original", "status": "current",
                "textState": "present"
            }),
        );
        put(
            &mut rows,
            "ai_evidence_source_version",
            6,
            json!({
                "id": 6, "organizationId": 1, "companyId": 10, "sourceId": 4, "version": "2e",
                "edition": "2nd", "origin": "book_paper", "verification": "inspected",
                "status": "current", "snapshotState": "retained"
            }),
        );
        put(
            &mut rows,
            "ai_evidence_source",
            4,
            json!({
                "id": 4, "organizationId": 1, "companyId": 10, "sourceKind": "book",
                "sourceKey": "isbn-1", "title": "A Book", "authorAttribution": "known",
                "authors": ["Ada Author"], "scope": "company"
            }),
        );
        put(
            &mut rows,
            "ai_evidence_contribution",
            7,
            json!({
                "id": 7, "organizationId": 1, "companyId": 10, "contributorKind": "user",
                "sessionRef": "s1", "turnRef": "turn-2", "introducedKind": "source_version",
                "sourceVersionId": 6, "inspectionState": "inspected", "isSecondaryQuotation": false
            }),
        );
        rows
    }

    fn edge(
        dependent_kind: &str,
        dependent_id: u64,
        upstream_kind: &str,
        upstream_id: u64,
        requirement: &str,
        state: &str,
    ) -> Value {
        json!({
            "organizationId": 1, "dependentKind": dependent_kind, "dependentId": dependent_id,
            "upstreamKind": upstream_kind, "upstreamId": upstream_id,
            "requirement": requirement, "state": state
        })
    }

    #[tokio::test]
    async fn a_healthy_component_reconstructs_source_to_component() {
        let mut rows = healthy();
        rows.dependencies = vec![
            edge("component", 1, "decision", 2, "required", "valid"),
            edge("decision", 2, "claim", 3, "required", "valid"),
            edge("claim", 3, "passage", 5, "required", "valid"),
        ];
        let inspection = inspect(&rows, VIEWER, InspectTarget::Component(1))
            .await
            .unwrap();

        assert!(inspection.lineage_passes, "{:?}", inspection.findings);
        assert_eq!(
            inspection
                .revisions
                .iter()
                .map(|r| r.version)
                .collect::<Vec<_>>(),
            vec![2, 1]
        );
        assert_eq!(inspection.decisions[0].adaptations, vec!["5 year life"]);
        assert_eq!(inspection.claims[0].supporting_passage_ids, vec![5]);
        let passage = &inspection.passages[0];
        assert_eq!(passage.availability, Availability::Available);
        assert_eq!(
            passage.excerpt.as_deref(),
            Some("The full text of the passage.")
        );
        assert_eq!(passage.coordinates, vec!["page:12"]);
        assert_eq!(inspection.source_versions[0].replay, "full_replay");
        assert_eq!(inspection.sources[0].authors, vec!["Ada Author"]);
        // The introducing contribution is distinct from the author.
        assert_eq!(
            inspection.contributions[0].turn_ref.as_deref(),
            Some("turn-2")
        );
        assert_eq!(inspection.dependencies.len(), 3);
    }

    #[tokio::test]
    async fn a_bibliography_without_component_links_does_not_pass() {
        let mut rows = healthy();
        rows.tables.insert(
            ("ai_artifact_component", 1),
            json!({
                "id": 1, "organizationId": 1, "companyId": 10, "artifactRef": "wf:1",
                "componentKey": "step-a", "componentKind": "formula", "version": 1,
                "contentHash": "b".repeat(64), "decisionIds": [], "claimIds": [3],
                "linkState": "linked", "status": "current"
            }),
        );
        let inspection = inspect(&rows, VIEWER, InspectTarget::Component(1))
            .await
            .unwrap();
        assert!(!inspection.lineage_passes);
        let codes: Vec<_> = inspection
            .findings
            .iter()
            .map(|f| f.code.as_str())
            .collect();
        assert!(codes.contains(&"component_without_decision"), "{codes:?}");
        assert!(codes.contains(&"no_decision_chain"), "{codes:?}");
    }

    #[tokio::test]
    async fn changed_or_unresolved_links_require_review() {
        for state in ["changed", "unresolved"] {
            let mut rows = healthy();
            let mut head = rows.tables[&("ai_artifact_component", 1)].clone();
            head["linkState"] = json!(state);
            rows.tables.insert(("ai_artifact_component", 1), head);
            let inspection = inspect(&rows, VIEWER, InspectTarget::Component(1))
                .await
                .unwrap();
            assert!(!inspection.lineage_passes, "{state}");
            assert!(inspection
                .findings
                .iter()
                .any(|f| f.code == "component_links_unconfirmed"));
        }
    }

    #[tokio::test]
    async fn out_of_scope_sources_reveal_nothing() {
        let mut rows = healthy();
        // Same organization, but a company-scoped source of another company.
        let mut source = rows.tables[&("ai_evidence_source", 4)].clone();
        source["companyId"] = json!(11);
        rows.tables.insert(("ai_evidence_source", 4), source);
        let inspection = inspect(&rows, VIEWER, InspectTarget::Component(1))
            .await
            .unwrap();

        let passage = &inspection.passages[0];
        assert_eq!(passage.availability, Availability::OutOfScope);
        assert!(passage.excerpt.is_none() && passage.content_hash.is_none());
        assert!(passage.coordinates.is_empty() && passage.source_version_id.is_none());
        assert!(
            inspection.sources.is_empty(),
            "denied source must not be described"
        );
        assert!(inspection.source_versions.is_empty());
        let serialized = serde_json::to_string(&inspection).unwrap();
        for leaked in ["The full text", "Ada Author", "A Book", "isbn-1"] {
            assert!(!serialized.contains(leaked), "leaked {leaked}");
        }
        assert!(inspection
            .findings
            .iter()
            .any(|f| f.code == "passage_out_of_scope"));
    }

    #[tokio::test]
    async fn restricted_and_tombstoned_passages_return_no_excerpt() {
        for (text_state, availability) in [
            ("restricted", Availability::Restricted),
            ("tombstoned", Availability::Tombstoned),
        ] {
            let mut rows = healthy();
            let mut passage = rows.tables[&("ai_evidence_passage", 5)].clone();
            passage["textState"] = json!(text_state);
            passage["status"] = json!("withdrawn");
            rows.tables.insert(("ai_evidence_passage", 5), passage);
            let inspection = inspect(&rows, VIEWER, InspectTarget::Component(1))
                .await
                .unwrap();
            let view = &inspection.passages[0];
            assert_eq!(view.availability, availability);
            assert!(view.excerpt.is_none());
            // The hash is retained, and the chain is reported unavailable.
            assert!(view.content_hash.is_some());
            assert!(!inspection.lineage_passes);
            assert!(inspection
                .findings
                .iter()
                .any(|f| f.code == "passage_unavailable"));
        }
    }

    #[tokio::test]
    async fn foreign_organization_rows_are_reported_absent() {
        let rows = healthy();
        let foreign = Viewer {
            organization_id: 2,
            company_id: 10,
            actor_identity: None,
        };
        let error = inspect(&rows, foreign, InspectTarget::Component(1))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("not found"), "{error}");
        let sibling = Viewer {
            organization_id: 1,
            company_id: 11,
            actor_identity: None,
        };
        assert!(inspect(&rows, sibling, InspectTarget::Component(1))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn unverified_recollections_stay_visibly_unverified() {
        let mut rows = healthy();
        let mut version = rows.tables[&("ai_evidence_source_version", 6)].clone();
        version["verification"] = json!("unverified_recollection");
        rows.tables
            .insert(("ai_evidence_source_version", 6), version);
        let inspection = inspect(&rows, VIEWER, InspectTarget::Component(1))
            .await
            .unwrap();
        assert!(inspection
            .findings
            .iter()
            .any(|f| f.code == "source_unverified"));
        assert_eq!(
            inspection.source_versions[0].verification,
            "unverified_recollection"
        );
    }

    #[tokio::test]
    async fn invalid_required_dependencies_block_and_acknowledged_discretionary_ones_do_not() {
        let mut rows = healthy();
        rows.dependencies = vec![
            edge("claim", 3, "passage", 5, "required", "invalid"),
            edge("decision", 2, "claim", 3, "discretionary", "needs_review"),
        ];
        let inspection = inspect(&rows, VIEWER, InspectTarget::Component(1))
            .await
            .unwrap();
        assert!(!inspection.lineage_passes);
        assert_eq!(
            inspection
                .findings
                .iter()
                .filter(|f| f.code == "dependency_not_valid")
                .count(),
            2
        );

        let mut acknowledged = edge("decision", 2, "claim", 3, "discretionary", "needs_review");
        acknowledged["acknowledgedBy"] = json!("abc");
        rows.dependencies = vec![acknowledged];
        let inspection = inspect(&rows, VIEWER, InspectTarget::Component(1))
            .await
            .unwrap();
        assert!(inspection.lineage_passes, "{:?}", inspection.findings);
    }

    #[tokio::test]
    async fn superseded_evidence_is_reviewed_history_but_withdrawn_evidence_blocks() {
        // A correction supersedes the source; a reviewer reaffirmed the edges.
        let mut rows = healthy();
        let mut passage = rows.tables[&("ai_evidence_passage", 5)].clone();
        passage["status"] = json!("superseded");
        rows.tables.insert(("ai_evidence_passage", 5), passage);
        let mut version = rows.tables[&("ai_evidence_source_version", 6)].clone();
        version["status"] = json!("superseded");
        rows.tables
            .insert(("ai_evidence_source_version", 6), version);
        rows.dependencies = vec![edge("claim", 3, "passage", 5, "required", "valid")];
        let inspection = inspect(&rows, VIEWER, InspectTarget::Component(1))
            .await
            .unwrap();
        assert!(inspection.lineage_passes, "{:?}", inspection.findings);
        let history: Vec<_> = inspection
            .findings
            .iter()
            .filter(|f| f.severity == Severity::Review)
            .map(|f| f.code.as_str())
            .collect();
        assert!(history.contains(&"passage_not_current"), "{history:?}");
        assert!(
            history.contains(&"source_version_not_current"),
            "{history:?}"
        );

        // The same evidence, once retracted, blocks whatever the edges say.
        let mut retracted = rows;
        let mut passage = retracted.tables[&("ai_evidence_passage", 5)].clone();
        passage["status"] = json!("withdrawn");
        retracted.tables.insert(("ai_evidence_passage", 5), passage);
        let mut version = retracted.tables[&("ai_evidence_source_version", 6)].clone();
        version["status"] = json!("retracted");
        retracted
            .tables
            .insert(("ai_evidence_source_version", 6), version);
        let inspection = inspect(&retracted, VIEWER, InspectTarget::Component(1))
            .await
            .unwrap();
        assert!(!inspection.lineage_passes);
        let codes: Vec<_> = inspection
            .findings
            .iter()
            .map(|f| f.code.as_str())
            .collect();
        assert!(codes.contains(&"passage_not_current"), "{codes:?}");
        assert!(codes.contains(&"source_version_not_current"), "{codes:?}");
    }

    #[test]
    fn replay_state_never_claims_replay_from_a_hash() {
        assert_eq!(replay_state("current", "retained"), "full_replay");
        assert_eq!(replay_state("current", "hash_only"), "hash_only");
        assert_eq!(replay_state("current", "unavailable"), "unavailable");
        assert_eq!(replay_state("deleted", "hash_only"), "hash_only");
        assert_eq!(replay_state("deleted", "retained"), "unavailable");
        assert_eq!(replay_state("access_revoked", "retained"), "restricted");
    }

    #[test]
    fn unknown_text_state_reads_as_the_most_restrictive() {
        assert_eq!(
            passage_availability(true, "present"),
            Availability::Available
        );
        assert_eq!(passage_availability(true, "???"), Availability::Tombstoned);
        assert_eq!(
            passage_availability(false, "present"),
            Availability::OutOfScope
        );
    }

    #[test]
    fn excerpts_are_bounded() {
        let long = "x".repeat(MAX_EXCERPT_CHARS + 50);
        let (excerpt, truncated) = truncate_excerpt(&long);
        assert!(truncated);
        assert_eq!(excerpt.chars().count(), MAX_EXCERPT_CHARS);
        assert!(!truncate_excerpt("short").1);
    }

    fn knowledge_fixture(review_state: &str, share_scope: &str) -> FakeRows {
        let mut rows = healthy();
        rows.has_active_membership = true;
        rows.entries = vec![json!({
            "id": 20, "organizationId": 1, "companyId": 10, "entryKey": "sl", "kind": "procedure",
            "domainTags": ["domain:accounting"], "shareScope": share_scope,
            "teamRef": if share_scope == "team" { Some("department:42") } else { None },
            "ownerUid": "a".repeat(64)
        })];
        rows.tables
            .insert(("ai_knowledge_entry", 20), rows.entries[0].clone());
        rows.versions = vec![json!({
            "id": 21, "organizationId": 1, "companyId": 10, "entryId": 20, "version": 1,
            "title": "Straight line", "body": "Spread cost evenly.", "applicability": [],
            "sourcePassageIds": [5], "claimIds": [], "decisionIds": [2],
            "reviewState": review_state, "reviewEpoch": 0, "createUid": "b".repeat(64)
        })];
        rows.reviews = ["source_fidelity", "domain_interpretation", "implementation"]
            .into_iter()
            .enumerate()
            .map(|(index, kind)| {
                json!({
                    "id": index + 1, "versionId": 21, "reviewKind": kind,
                    "outcome": "accepted", "reviewEpoch": 0, "reviewerUid": "c".repeat(64)
                })
            })
            .collect();
        rows.tables
            .insert(("ai_knowledge_entry_version", 21), rows.versions[0].clone());
        rows.dependencies = vec![
            edge("knowledge_version", 21, "passage", 5, "required", "valid"),
            edge("knowledge_version", 21, "decision", 2, "required", "valid"),
        ];
        rows
    }

    #[tokio::test]
    async fn approved_knowledge_is_retrieved_with_its_lineage() {
        let rows = knowledge_fixture("approved", "organization");
        let result = retrieve_reusable_knowledge(&rows, VIEWER, "sl")
            .await
            .unwrap();
        let KnowledgeRetrieval::Reusable(reuse) = result else {
            panic!("expected reusable, got {result:?}");
        };
        assert_eq!(reuse.title, "Straight line");
        assert_eq!(reuse.lineage.decisions[0].id, 2);
        assert_eq!(reuse.lineage.sources[0].authors, vec!["Ada Author"]);
    }

    #[tokio::test]
    async fn only_approved_knowledge_is_reusable() {
        for state in [
            "candidate",
            "reviewed",
            "needs_review",
            "disputed",
            "superseded",
            "withdrawn",
        ] {
            let rows = knowledge_fixture(state, "organization");
            let result = retrieve_reusable_knowledge(&rows, VIEWER, "sl")
                .await
                .unwrap();
            assert!(
                matches!(result, KnowledgeRetrieval::Denied { .. }),
                "{state}"
            );
        }
    }

    #[tokio::test]
    async fn approved_knowledge_with_an_invalid_dependency_is_denied() {
        let mut rows = knowledge_fixture("approved", "organization");
        rows.dependencies[0] = edge("knowledge_version", 21, "passage", 5, "required", "invalid");
        let result = retrieve_reusable_knowledge(&rows, VIEWER, "sl")
            .await
            .unwrap();
        let KnowledgeRetrieval::Denied { reasons } = result else {
            panic!("expected denial");
        };
        assert!(reasons.iter().any(|r| r.contains("invalid")), "{reasons:?}");
    }

    #[tokio::test]
    async fn personal_and_team_entries_are_denied_without_an_actor() {
        for scope in ["personal", "team"] {
            let rows = knowledge_fixture("approved", scope);
            let result = retrieve_reusable_knowledge(&rows, VIEWER, "sl")
                .await
                .unwrap();
            assert!(
                matches!(result, KnowledgeRetrieval::Denied { .. }),
                "{scope}"
            );
        }
    }

    #[tokio::test]
    async fn personal_owner_and_current_team_member_can_reuse() {
        let personal = knowledge_fixture("approved", "personal");
        let owner = Viewer {
            actor_identity: ActorIdentity::parse(&"a".repeat(64)),
            ..VIEWER
        };
        let personal_result = retrieve_reusable_knowledge(&personal, owner, "sl")
            .await
            .unwrap();
        assert!(
            matches!(personal_result, KnowledgeRetrieval::Reusable(_)),
            "{personal_result:?}"
        );

        let mut team = knowledge_fixture("approved", "team");
        team.team_department_id = Some(42);
        assert!(matches!(
            retrieve_reusable_knowledge(&team, owner, "sl")
                .await
                .unwrap(),
            KnowledgeRetrieval::Reusable(_)
        ));
        team.team_department_id = Some(43);
        assert!(matches!(
            retrieve_reusable_knowledge(&team, owner, "sl")
                .await
                .unwrap(),
            KnowledgeRetrieval::Denied { .. }
        ));
    }

    #[tokio::test]
    async fn self_review_cannot_qualify_an_approved_row_for_reuse() {
        let mut rows = knowledge_fixture("approved", "organization");
        rows.reviews[0]["reviewerUid"] = json!("a".repeat(64));
        let result = retrieve_reusable_knowledge(&rows, VIEWER, "sl")
            .await
            .unwrap();
        let KnowledgeRetrieval::Denied { reasons } = result else {
            panic!("self-reviewed knowledge must be denied");
        };
        assert!(reasons.iter().any(|reason| reason.contains("independent")));
    }

    #[tokio::test]
    async fn knowledge_does_not_widen_access_to_out_of_scope_sources() {
        let mut rows = knowledge_fixture("approved", "organization");
        let mut source = rows.tables[&("ai_evidence_source", 4)].clone();
        source["companyId"] = json!(11);
        rows.tables.insert(("ai_evidence_source", 4), source);
        let result = retrieve_reusable_knowledge(&rows, VIEWER, "sl")
            .await
            .unwrap();
        // The entry is approved and in scope, but its source is not: text
        // derived from it must not be served, and nothing about it leaks.
        let KnowledgeRetrieval::Denied { reasons } = result else {
            panic!("derived knowledge over an out-of-scope source must be denied");
        };
        let serialized = serde_json::to_string(&reasons).unwrap();
        assert!(!serialized.contains("Ada Author") && !serialized.contains("The full text"));
        assert!(
            reasons.iter().any(|r| r.contains("outside your access")),
            "{reasons:?}"
        );
    }

    /// Runs the inspector over real `query_sql` output rather than
    /// hand-written rows. Needs a SpacetimeDB module populated by the
    /// `run_ai_evidence_provenance_tests` reducer:
    ///
    /// ```text
    /// STDB_URL=http://127.0.0.1:3000 STDB_MODULE=<db> STDB_TOKEN=<owner token> \
    ///   cargo test --bin gateway live_rows -- --ignored
    /// ```
    #[tokio::test]
    #[ignore = "needs a live SpacetimeDB module populated by run_ai_evidence_provenance_tests"]
    async fn live_rows_parse_and_reconstruct_the_chain() {
        let env = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} is required"));
        let client = StdbClient::new(env("STDB_URL"), env("STDB_MODULE"), env("STDB_TOKEN"));

        // wf:1/step-a v2 was edited from v1 and its links re-confirmed.
        let components = client
            .query_sql("SELECT * FROM ai_artifact_component WHERE artifact_ref = 'wf:1'")
            .await
            .unwrap();
        let head = components
            .iter()
            .find(|row| {
                number(row, "version") == Some(2)
                    && text(row, "status").as_deref() == Some("current")
            })
            .expect("fixture component wf:1 v2");
        let viewer = Viewer {
            organization_id: number(head, "organizationId").unwrap(),
            company_id: number(head, "companyId").unwrap(),
            actor_identity: None,
        };
        let inspection = inspect(
            &client,
            viewer,
            InspectTarget::Component(number(head, "id").unwrap()),
        )
        .await
        .unwrap();
        assert_eq!(
            inspection.revisions.len(),
            2,
            "edited component keeps its parent lineage"
        );
        assert!(inspection.lineage_passes, "{:?}", inspection.findings);
        assert_eq!(inspection.decisions[0].status, "accepted");
        assert_eq!(inspection.claims[0].verification_method, "human_reviewed");
        let passage = &inspection.passages[0];
        assert_eq!(passage.availability, Availability::Available);
        assert_eq!(passage.coordinates, vec!["page:12"]);
        assert!(passage.excerpt.as_deref().unwrap().contains("lineage-src"));
        assert_eq!(inspection.sources[0].authors, vec!["Ada Author"]);
        assert_eq!(inspection.source_versions[0].replay, "full_replay");
        assert_eq!(
            inspection.contributions[0].turn_ref.as_deref(),
            Some("turn-2")
        );

        // A denied viewer (same org, sibling company) sees nothing.
        let sibling = Viewer {
            company_id: viewer.company_id + 1,
            ..viewer
        };
        assert!(inspect(
            &client,
            sibling,
            InspectTarget::Component(inspection.target_id)
        )
        .await
        .is_err());

        // Retracted evidence: the approved procedure is now flagged and denied.
        for (key, reusable) in [
            ("sl-procedure", true),
            ("proc-correct", true),
            ("proc-retract", false),
        ] {
            let entries = client
                .query_sql(&format!(
                    "SELECT * FROM ai_knowledge_entry WHERE entry_key = '{key}'"
                ))
                .await
                .unwrap();
            let entry = entries
                .first()
                .unwrap_or_else(|| panic!("fixture entry {key}"));
            let viewer = Viewer {
                organization_id: number(entry, "organizationId").unwrap(),
                company_id: number(entry, "companyId").unwrap(),
                actor_identity: None,
            };
            let result = retrieve_reusable_knowledge(&client, viewer, key)
                .await
                .unwrap();
            match (&result, reusable) {
                (KnowledgeRetrieval::Reusable(reuse), true) => {
                    assert!(
                        !reuse.lineage.sources.is_empty(),
                        "{key} lost its source lineage"
                    );
                }
                (KnowledgeRetrieval::Denied { .. }, false) => {}
                other => panic!("{key}: unexpected retrieval {other:?}"),
            }
        }
    }

    #[test]
    fn inspect_targets_parse_a_closed_set() {
        assert_eq!(
            InspectTarget::parse("component", 1),
            Some(InspectTarget::Component(1))
        );
        assert_eq!(
            InspectTarget::parse("claim", 2),
            Some(InspectTarget::Claim(2))
        );
        assert_eq!(InspectTarget::parse("answer", 3), None);
    }
}
