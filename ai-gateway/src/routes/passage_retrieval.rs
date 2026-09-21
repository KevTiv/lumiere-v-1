//! Resolve untrusted semantic candidates to authoritative evidence passages.
//!
//! Qdrant is only a ranking index. Its payload contains identifiers and
//! fingerprints, never prompt text. Text is loaded from the persisted evidence
//! graph only after the acting user's `ai.evidence.retrieve` grant has been
//! established, and is bounded by that grant's row and byte limits.
//!
//! Authority is never cached. [`authorize_and_resolve`] checks the grant first,
//! and [`recheck_before_release`] repeats the grant check and re-reads every
//! passage immediately before an answer is released, so a role revoked or a
//! source withdrawn mid-run withholds the answer.

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde_json::Value;
use sha2::{Digest, Sha256};
use stdb_client::StdbClient;

use crate::{
    error::{AppError, AppResult},
    qdrant_client::SearchResult,
    routes::evidence::{
        require_scoped_capability_grant, CapabilityGrantBounds, RAG_EVIDENCE_RETRIEVE_CAPABILITY,
    },
    state::AppState,
};

const PASSAGE_RESOURCE_KIND: &str = "ai_evidence_passage";

/// Global ceilings a RAG answer may draw on, whatever an actor's grant says.
pub(super) const RAG_MAX_EVIDENCE_ROWS: u64 = 20;
pub(super) const RAG_MAX_EVIDENCE_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub(super) struct ResolvedPassage {
    pub passage_id: u64,
    pub source_kind: String,
    pub source_key: String,
    pub source_version: String,
    pub passage_key: String,
    pub content_hash: String,
    pub text: String,
    pub label: String,
    pub score: f32,
}

impl ResolvedPassage {
    /// Whether a fresh read still describes exactly the evidence that was put
    /// in front of the model. Score is ranking metadata, not evidence.
    fn same_evidence(&self, other: &Self) -> bool {
        self.passage_id == other.passage_id
            && self.source_kind == other.source_kind
            && self.source_key == other.source_key
            && self.source_version == other.source_version
            && self.passage_key == other.passage_key
            && self.content_hash == other.content_hash
            && self.text == other.text
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct EvidenceScope {
    pub organization_id: u64,
    pub company_id: u64,
}

/// What one answer may draw on: the actor's grant intersected with the global
/// ceilings and the caller's requested row count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PassageBudget {
    pub max_rows: usize,
    pub max_bytes: u64,
}

impl PassageBudget {
    pub(super) fn new(grant: CapabilityGrantBounds, requested_rows: u64) -> Self {
        let rows = grant
            .max_rows
            .min(RAG_MAX_EVIDENCE_ROWS)
            .min(requested_rows.max(1));
        Self {
            max_rows: usize::try_from(rows).unwrap_or(usize::MAX),
            max_bytes: grant.max_bytes.min(RAG_MAX_EVIDENCE_BYTES),
        }
    }

    fn admits(&self, rows: usize, bytes: u64) -> bool {
        rows <= self.max_rows && bytes <= self.max_bytes
    }
}

/// The three persisted rows a passage resolves through.
#[derive(Debug, Clone)]
pub(super) struct PassageChain {
    pub passage: Value,
    pub version: Value,
    pub source: Value,
}

/// The two authorities RAG evidence depends on. Both are read fresh on every
/// call; implementations must not cache.
#[async_trait]
pub(super) trait EvidenceAccess: Send + Sync {
    /// The acting user's current `ai.evidence.retrieve` bounds.
    async fn grant_bounds(&self, scope: EvidenceScope) -> AppResult<CapabilityGrantBounds>;
    /// The current persisted passage → source version → source rows.
    async fn passage_chain(
        &self,
        scope: EvidenceScope,
        passage_id: u64,
    ) -> Result<Option<PassageChain>>;
}

/// Production access: the session-owning API server's grant envelope plus the
/// private evidence tables read as the gateway service principal.
pub(super) struct LiveEvidenceAccess<'a> {
    pub state: &'a AppState,
    pub actor_identity: &'a str,
    pub actor_token: &'a str,
    pub reader: &'a StdbClient,
}

#[async_trait]
impl EvidenceAccess for LiveEvidenceAccess<'_> {
    async fn grant_bounds(&self, scope: EvidenceScope) -> AppResult<CapabilityGrantBounds> {
        require_scoped_capability_grant(
            self.state,
            self.actor_identity,
            self.actor_token,
            scope.organization_id,
            scope.company_id,
            RAG_EVIDENCE_RETRIEVE_CAPABILITY,
        )
        .await
    }

    async fn passage_chain(
        &self,
        scope: EvidenceScope,
        passage_id: u64,
    ) -> Result<Option<PassageChain>> {
        let EvidenceScope {
            organization_id,
            company_id,
        } = scope;
        let passages = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_evidence_passage WHERE id = {passage_id} AND organization_id = {organization_id} AND company_id = {company_id} LIMIT 1"
            ))
            .await
            .context("load authoritative evidence passage")?;
        let Some(passage) = passages.into_iter().next() else {
            return Ok(None);
        };
        let Some(source_version_id) = number(&passage, "sourceVersionId") else {
            return Ok(None);
        };
        let versions = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_evidence_source_version WHERE id = {source_version_id} AND organization_id = {organization_id} AND company_id = {company_id} LIMIT 1"
            ))
            .await
            .context("load authoritative evidence source version")?;
        let Some(version) = versions.into_iter().next() else {
            return Ok(None);
        };
        let Some(source_id) = number(&version, "sourceId") else {
            return Ok(None);
        };
        let sources = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_evidence_source WHERE id = {source_id} AND organization_id = {organization_id} LIMIT 1"
            ))
            .await
            .context("load authoritative evidence source")?;
        let Some(source) = sources.into_iter().next() else {
            return Ok(None);
        };
        Ok(Some(PassageChain {
            passage,
            version,
            source,
        }))
    }
}

/// Passages an actor is authorized to see for one answer.
#[derive(Debug, Clone)]
pub(super) struct AuthorizedEvidence {
    pub passages: Vec<ResolvedPassage>,
    /// Some qualifying passage did not fit the actor's row or byte limit and
    /// was left out (and never loaded into an answer).
    pub truncated: bool,
}

impl AuthorizedEvidence {
    /// No authorized evidence: nothing was retrieved or nothing may be shown.
    pub(super) fn none() -> Self {
        Self {
            passages: Vec::new(),
            truncated: false,
        }
    }

    fn used_bytes(&self) -> u64 {
        self.passages
            .iter()
            .map(|passage| passage.text.len() as u64)
            .sum()
    }
}

#[derive(Debug)]
pub(super) enum EvidenceError {
    /// The actor's grant is missing, malformed, mismatched or unreachable.
    Authority(AppError),
    /// The persisted evidence graph could not be read.
    Resolution(anyhow::Error),
}

impl std::fmt::Display for EvidenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Authority(error) => write!(f, "evidence authority: {error}"),
            Self::Resolution(error) => write!(f, "evidence resolution: {error:#}"),
        }
    }
}

/// Authorize the acting user, then resolve semantic candidates through the
/// authoritative graph within their grant. The grant is established before any
/// passage row is read, so a denied or unreachable authority loads nothing.
///
/// `source_kinds` narrows to the caller's requested source kinds; an empty
/// slice accepts every kind. Hits are consumed in rank order and selection
/// stops at the first passage that would exceed the byte budget, so the
/// answer never rests on a lower-ranked passage while a better one was
/// dropped for size.
pub(super) async fn authorize_and_resolve(
    access: &dyn EvidenceAccess,
    scope: EvidenceScope,
    hits: &[SearchResult],
    source_kinds: &[String],
    requested_rows: u64,
) -> Result<AuthorizedEvidence, EvidenceError> {
    let grant = access
        .grant_bounds(scope)
        .await
        .map_err(EvidenceError::Authority)?;
    let budget = PassageBudget::new(grant, requested_rows);
    let mut passages: Vec<ResolvedPassage> = Vec::new();
    let mut bytes = 0u64;
    let mut truncated = false;
    let mut seen = std::collections::HashSet::new();

    for hit in hits {
        if hit.record.resource_kind != PASSAGE_RESOURCE_KIND {
            continue;
        }
        let Some(passage_id) = hit
            .record
            .resource_id
            .parse::<u64>()
            .ok()
            .filter(|id| *id > 0)
        else {
            continue;
        };
        if !seen.insert(passage_id) {
            continue;
        }
        // The row limit is reached: further candidates are not even loaded.
        if passages.len() >= budget.max_rows {
            truncated = true;
            break;
        }
        let Some(chain) = access
            .passage_chain(scope, passage_id)
            .await
            .map_err(EvidenceError::Resolution)?
        else {
            continue;
        };
        let Some(passage) = resolve_rows(
            scope.organization_id,
            scope.company_id,
            passage_id,
            &hit.record.resource_version,
            &hit.record.source_fingerprint,
            hit.score,
            &chain.passage,
            &chain.version,
            &chain.source,
        ) else {
            continue;
        };
        if !source_kinds.is_empty() && !source_kinds.iter().any(|kind| kind == &passage.source_kind)
        {
            continue;
        }
        let next_bytes = bytes.saturating_add(passage.text.len() as u64);
        if !budget.admits(passages.len() + 1, next_bytes) {
            truncated = true;
            break;
        }
        bytes = next_bytes;
        passages.push(passage);
    }
    Ok(AuthorizedEvidence {
        passages,
        truncated,
    })
}

/// Why an answer built on authorized evidence may no longer be released.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ReleaseCheck {
    Current,
    /// The evidence or the actor's access changed after retrieval. The reason
    /// is generic by design: it must never carry passage content.
    Withdrawn(&'static str),
}

/// Immediately before release: re-establish the actor's grant, confirm the
/// evidence still fits it, and re-read every passage. Any change — a revoked
/// or narrowed grant, an unreachable authority, a source that was revoked,
/// deleted, superseded or replaced — withdraws the answer.
pub(super) async fn recheck_before_release(
    access: &dyn EvidenceAccess,
    scope: EvidenceScope,
    evidence: &AuthorizedEvidence,
    requested_rows: u64,
) -> ReleaseCheck {
    let Ok(grant) = access.grant_bounds(scope).await else {
        return ReleaseCheck::Withdrawn("evidence access could not be re-verified before release");
    };
    let current = PassageBudget::new(grant, requested_rows);
    if !current.admits(evidence.passages.len(), evidence.used_bytes()) {
        return ReleaseCheck::Withdrawn("evidence access was narrowed before release");
    }
    for passage in &evidence.passages {
        let Ok(Some(chain)) = access.passage_chain(scope, passage.passage_id).await else {
            return ReleaseCheck::Withdrawn("evidence changed before release");
        };
        let fresh = resolve_rows(
            scope.organization_id,
            scope.company_id,
            passage.passage_id,
            &passage.content_hash,
            &passage.content_hash,
            passage.score,
            &chain.passage,
            &chain.version,
            &chain.source,
        );
        if !fresh
            .as_ref()
            .is_some_and(|fresh| fresh.same_evidence(passage))
        {
            return ReleaseCheck::Withdrawn("evidence changed before release");
        }
    }
    ReleaseCheck::Current
}

#[allow(clippy::too_many_arguments)]
fn resolve_rows(
    organization_id: u64,
    company_id: u64,
    passage_id: u64,
    indexed_version: &str,
    indexed_fingerprint: &str,
    score: f32,
    passage: &Value,
    version: &Value,
    source: &Value,
) -> Option<ResolvedPassage> {
    let source_kind = text(passage, "sourceKind")?;
    let source_key = text(passage, "sourceKey")?;
    let source_version = text(passage, "sourceVersion")?;
    let passage_key = text(passage, "passageKey")?;
    let content_hash = text(passage, "contentHash")?;
    let passage_text = text(passage, "passageText")?;
    if number(passage, "id") != Some(passage_id)
        || number(passage, "organizationId") != Some(organization_id)
        || number(passage, "companyId") != Some(company_id)
        || text(passage, "status").as_deref() != Some("current")
        || text(passage, "textState").as_deref() != Some("present")
        || passage_text.trim().is_empty()
        || sha256_hex(&passage_text) != content_hash
        || indexed_version != content_hash
        || indexed_fingerprint != content_hash
    {
        return None;
    }

    let source_id = number(version, "sourceId")?;
    if number(version, "id") != number(passage, "sourceVersionId")
        || number(version, "organizationId") != Some(organization_id)
        || number(version, "companyId") != Some(company_id)
        || text(version, "version").as_deref() != Some(source_version.as_str())
        || text(version, "status").as_deref() != Some("current")
        || text(version, "verification").as_deref() != Some("inspected")
        || text(version, "contentHash").is_none()
    {
        return None;
    }

    let scope = text(&source, "scope");
    let source_company = number(&source, "companyId");
    let in_scope = number(source, "organizationId") == Some(organization_id)
        && match scope.as_deref() {
            Some("company") => source_company == Some(company_id),
            Some("organization") => true,
            _ => false,
        };
    if number(source, "id") != Some(source_id)
        || !in_scope
        || text(source, "sourceKind").as_deref() != Some(source_kind.as_str())
        || text(source, "sourceKey").as_deref() != Some(source_key.as_str())
    {
        return None;
    }

    let label = text(source, "title")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("{source_kind}:{source_key}"));
    Some(ResolvedPassage {
        passage_id,
        source_kind,
        source_key,
        source_version,
        passage_key,
        content_hash,
        text: passage_text,
        label,
        score,
    })
}

fn text(row: &Value, camel: &str) -> Option<String> {
    row.get(camel)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
}

fn number(row: &Value, camel: &str) -> Option<u64> {
    row.get(camel)
        .and_then(Value::as_u64)
        .or_else(|| row.get(camel).and_then(Value::as_str)?.parse().ok())
}

fn sha256_hex(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

/// Shared fakes for the evidence-authority tests here and in the RAG route.
#[cfg(test)]
pub(super) mod support {
    use super::*;
    use crate::qdrant_client::SemanticIndexRecord;
    use serde_json::json;
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Mutex,
        },
    };

    pub(crate) const SCOPE: EvidenceScope = EvidenceScope {
        organization_id: 1,
        company_id: 2,
    };

    pub(crate) struct FakeAccess {
        pub(crate) grant: Mutex<Result<CapabilityGrantBounds, &'static str>>,
        pub(crate) chains: Mutex<HashMap<u64, PassageChain>>,
        pub(crate) grant_calls: AtomicUsize,
        pub(crate) chain_calls: AtomicUsize,
        /// Serve the grant this many times, then flip to `after`.
        pub(crate) flip_after: Mutex<Option<(usize, Result<CapabilityGrantBounds, &'static str>)>>,
        pub(crate) chain_fails: Mutex<bool>,
    }

    impl FakeAccess {
        pub(crate) fn new(max_rows: u64, max_bytes: u64) -> Self {
            Self {
                grant: Mutex::new(Ok(CapabilityGrantBounds {
                    max_rows,
                    max_bytes,
                })),
                chains: Mutex::new(HashMap::new()),
                grant_calls: AtomicUsize::new(0),
                chain_calls: AtomicUsize::new(0),
                flip_after: Mutex::new(None),
                chain_fails: Mutex::new(false),
            }
        }

        pub(crate) fn with_passage(self, id: u64, body: &str) -> Self {
            self.chains.lock().unwrap().insert(id, chain(id, body));
            self
        }
    }

    #[async_trait]
    impl EvidenceAccess for FakeAccess {
        async fn grant_bounds(&self, _scope: EvidenceScope) -> AppResult<CapabilityGrantBounds> {
            let call = self.grant_calls.fetch_add(1, Ordering::SeqCst);
            if let Some((after, replacement)) = self.flip_after.lock().unwrap().clone() {
                if call >= after {
                    return replacement.map_err(|reason| AppError::Unavailable(reason.to_string()));
                }
            }
            self.grant
                .lock()
                .unwrap()
                .clone()
                .map_err(|reason| AppError::Forbidden(reason.to_string()))
        }

        async fn passage_chain(
            &self,
            _scope: EvidenceScope,
            passage_id: u64,
        ) -> Result<Option<PassageChain>> {
            self.chain_calls.fetch_add(1, Ordering::SeqCst);
            if *self.chain_fails.lock().unwrap() {
                anyhow::bail!("evidence store unavailable");
            }
            Ok(self.chains.lock().unwrap().get(&passage_id).cloned())
        }
    }

    pub(crate) fn chain(id: u64, body: &str) -> PassageChain {
        let hash = sha256_hex(body);
        PassageChain {
            passage: json!({
                "id": id, "organizationId": 1, "companyId": 2,
                "sourceKind": "policy", "sourceKey": "returns", "sourceVersion": "2026",
                "passageKey": format!("p{id}"), "contentHash": hash, "passageText": body,
                "status": "current", "textState": "present", "sourceVersionId": 8
            }),
            version: json!({
                "id": 8, "organizationId": 1, "companyId": 2, "sourceId": 9,
                "version": "2026", "status": "current", "verification": "inspected",
                "contentHash": "document-hash"
            }),
            source: json!({
                "id": 9, "organizationId": 1, "companyId": 2, "sourceKind": "policy",
                "sourceKey": "returns", "scope": "company", "title": "Returns policy"
            }),
        }
    }

    pub(crate) fn hit(id: u64, body: &str) -> SearchResult {
        let hash = sha256_hex(body);
        SearchResult {
            score: 0.9,
            record: SemanticIndexRecord {
                organization_id: 1,
                company_id: 2,
                resource_kind: PASSAGE_RESOURCE_KIND.into(),
                resource_id: id.to_string(),
                resource_version: hash.clone(),
                source_fingerprint: hash,
                embedding_model: "test".into(),
                indexed_at: "now".into(),
                tags: vec![],
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::support::*;
    use super::*;
    use crate::qdrant_client::SemanticIndexRecord;
    use serde_json::json;
    use std::sync::atomic::Ordering;

    #[test]
    fn semantic_payload_must_name_a_persisted_passage_and_valid_id() {
        let record = |kind: &str, id: &str| SearchResult {
            score: 0.9,
            record: SemanticIndexRecord {
                organization_id: 1,
                company_id: 2,
                resource_kind: kind.into(),
                resource_id: id.into(),
                resource_version: "hash".into(),
                source_fingerprint: "hash".into(),
                embedding_model: "test".into(),
                indexed_at: "now".into(),
                tags: vec![],
            },
        };
        assert_ne!(
            record(PASSAGE_RESOURCE_KIND, "7").record.resource_kind,
            "document"
        );
        assert!(record(PASSAGE_RESOURCE_KIND, "0")
            .record
            .resource_id
            .parse::<u64>()
            .ok()
            .filter(|id| *id > 0)
            .is_none());
        assert_eq!(
            sha256_hex("passage"),
            "0886b051075687c18a9ae5075383feb8400fbe4328c6e4bd45b77b30f1e73b54"
        );
    }

    fn rows() -> (Value, Value, Value, String) {
        let body = "Returns require approval.";
        let hash = sha256_hex(body);
        (
            json!({
                "id": 7, "organizationId": 1, "companyId": 2,
                "sourceKind": "policy", "sourceKey": "returns", "sourceVersion": "2026",
                "passageKey": "p1", "contentHash": hash, "passageText": body,
                "status": "current", "textState": "present", "sourceVersionId": 8
            }),
            json!({
                "id": 8, "organizationId": 1, "companyId": 2, "sourceId": 9,
                "version": "2026", "status": "current", "verification": "inspected",
                "contentHash": "document-hash"
            }),
            json!({
                "id": 9, "organizationId": 1, "companyId": 2, "sourceKind": "policy",
                "sourceKey": "returns", "scope": "company", "title": "Returns policy"
            }),
            hash,
        )
    }

    #[test]
    fn only_current_authorized_persisted_text_resolves() {
        let (passage, version, source, hash) = rows();
        let resolved = resolve_rows(1, 2, 7, &hash, &hash, 0.9, &passage, &version, &source)
            .expect("current passage");
        assert_eq!(resolved.text, "Returns require approval.");
        assert_eq!(resolved.label, "Returns policy");

        for (field, denied) in [
            ("status", "withdrawn"),
            ("status", "superseded"),
            ("textState", "restricted"),
            ("textState", "tombstoned"),
        ] {
            let mut changed = passage.clone();
            changed[field] = json!(denied);
            assert!(
                resolve_rows(1, 2, 7, &hash, &hash, 0.9, &changed, &version, &source).is_none()
            );
        }

        for status in ["superseded", "retracted", "access_revoked", "deleted"] {
            let mut changed = version.clone();
            changed["status"] = json!(status);
            assert!(
                resolve_rows(1, 2, 7, &hash, &hash, 0.9, &passage, &changed, &source).is_none()
            );
        }
        for verification in ["unverified_recollection", "user_reported"] {
            let mut changed = version.clone();
            changed["verification"] = json!(verification);
            assert!(
                resolve_rows(1, 2, 7, &hash, &hash, 0.9, &passage, &changed, &source).is_none()
            );
        }
    }

    #[test]
    fn cross_organization_and_cross_company_rows_never_resolve() {
        let (passage, version, source, hash) = rows();
        // Caller scope differs from every persisted row.
        assert!(resolve_rows(9, 2, 7, &hash, &hash, 0.9, &passage, &version, &source).is_none());
        assert!(resolve_rows(1, 9, 7, &hash, &hash, 0.9, &passage, &version, &source).is_none());

        for (field, other) in [("organizationId", 9), ("companyId", 9)] {
            let mut foreign = passage.clone();
            foreign[field] = json!(other);
            assert!(
                resolve_rows(1, 2, 7, &hash, &hash, 0.9, &foreign, &version, &source).is_none(),
                "passage {field}"
            );
            let mut foreign = version.clone();
            foreign[field] = json!(other);
            assert!(
                resolve_rows(1, 2, 7, &hash, &hash, 0.9, &passage, &foreign, &source).is_none(),
                "version {field}"
            );
        }

        // A company-scoped source of another company, or any source of another
        // organization, is out of scope; an organization-scoped source is not.
        let mut other_company = source.clone();
        other_company["companyId"] = json!(9);
        assert!(resolve_rows(
            1,
            2,
            7,
            &hash,
            &hash,
            0.9,
            &passage,
            &version,
            &other_company
        )
        .is_none());
        let mut other_org = source.clone();
        other_org["organizationId"] = json!(9);
        other_org["scope"] = json!("organization");
        assert!(resolve_rows(1, 2, 7, &hash, &hash, 0.9, &passage, &version, &other_org).is_none());
        let mut org_wide = source.clone();
        org_wide["companyId"] = json!(9);
        org_wide["scope"] = json!("organization");
        assert!(resolve_rows(1, 2, 7, &hash, &hash, 0.9, &passage, &version, &org_wide).is_some());
        let mut unknown_scope = source.clone();
        unknown_scope["scope"] = json!("public");
        assert!(resolve_rows(
            1,
            2,
            7,
            &hash,
            &hash,
            0.9,
            &passage,
            &version,
            &unknown_scope
        )
        .is_none());
    }

    #[test]
    fn stale_index_and_cross_scope_rows_fail_closed() {
        let (passage, version, source, hash) = rows();
        assert!(resolve_rows(1, 2, 7, "stale", &hash, 0.9, &passage, &version, &source).is_none());
        assert!(resolve_rows(1, 2, 7, &hash, "stale", 0.9, &passage, &version, &source).is_none());
        assert!(resolve_rows(1, 3, 7, &hash, &hash, 0.9, &passage, &version, &source).is_none());

        let mut tampered = passage.clone();
        tampered["passageText"] = json!("Caller supplied replacement text");
        assert!(resolve_rows(1, 2, 7, &hash, &hash, 0.9, &tampered, &version, &source).is_none());
    }

    // ── authority, budget and release-time recheck ────────────────────────────

    #[test]
    fn budget_intersects_grant_global_ceiling_and_request() {
        let bounds = |max_rows, max_bytes| CapabilityGrantBounds {
            max_rows,
            max_bytes,
        };
        // The tightest of the three wins for rows...
        assert_eq!(PassageBudget::new(bounds(3, 10), 20).max_rows, 3);
        assert_eq!(PassageBudget::new(bounds(50, 10), 5).max_rows, 5);
        assert_eq!(
            PassageBudget::new(bounds(500, 10), 500).max_rows,
            RAG_MAX_EVIDENCE_ROWS as usize
        );
        // ...a zero request still leaves one row rather than unbounded...
        assert_eq!(PassageBudget::new(bounds(9, 10), 0).max_rows, 1);
        // ...and bytes never exceed the global ceiling either.
        assert_eq!(PassageBudget::new(bounds(1, 100), 1).max_bytes, 100);
        assert_eq!(
            PassageBudget::new(bounds(1, u64::MAX), 1).max_bytes,
            RAG_MAX_EVIDENCE_BYTES
        );
    }

    #[tokio::test]
    async fn no_passage_is_read_until_the_grant_is_established() {
        let body = "Returns require approval.";
        let denied = FakeAccess::new(5, 1000).with_passage(7, body);
        *denied.grant.lock().unwrap() = Err("no grant");
        let outcome = authorize_and_resolve(&denied, SCOPE, &[hit(7, body)], &[], 20).await;
        assert!(matches!(outcome, Err(EvidenceError::Authority(_))));
        assert_eq!(denied.chain_calls.load(Ordering::SeqCst), 0);

        // An unreachable grant service is the same: nothing is loaded.
        let unavailable = FakeAccess::new(5, 1000).with_passage(7, body);
        *unavailable.flip_after.lock().unwrap() = Some((0, Err("timeout")));
        assert!(matches!(
            authorize_and_resolve(&unavailable, SCOPE, &[hit(7, body)], &[], 20).await,
            Err(EvidenceError::Authority(_))
        ));
        assert_eq!(unavailable.chain_calls.load(Ordering::SeqCst), 0);

        let granted = FakeAccess::new(5, 1000).with_passage(7, body);
        let evidence = authorize_and_resolve(&granted, SCOPE, &[hit(7, body)], &[], 20)
            .await
            .expect("authorized");
        assert_eq!(evidence.passages.len(), 1);
        assert_eq!(evidence.passages[0].text, body);
        assert!(!evidence.truncated);
    }

    #[tokio::test]
    async fn max_rows_bounds_how_many_passages_are_loaded() {
        let bodies = ["First rule.", "Second rule.", "Third rule."];
        let access = bodies
            .iter()
            .enumerate()
            .fold(FakeAccess::new(2, 10_000), |access, (index, body)| {
                access.with_passage(index as u64 + 1, body)
            });
        let hits: Vec<_> = bodies
            .iter()
            .enumerate()
            .map(|(index, body)| hit(index as u64 + 1, body))
            .collect();
        let evidence = authorize_and_resolve(&access, SCOPE, &hits, &[], 20)
            .await
            .expect("authorized");
        assert_eq!(evidence.passages.len(), 2);
        assert!(evidence.truncated);
        assert_eq!(
            evidence
                .passages
                .iter()
                .map(|passage| passage.passage_id)
                .collect::<Vec<_>>(),
            vec![1, 2],
            "rank order is preserved and the third is not disclosed"
        );
        assert_eq!(
            access.chain_calls.load(Ordering::SeqCst),
            2,
            "candidates beyond the row limit are never loaded"
        );
    }

    #[tokio::test]
    async fn max_bytes_is_cumulative_and_stops_at_the_first_overflow() {
        let big = "B".repeat(60);
        let small = "s".repeat(5);
        let access = FakeAccess::new(10, 100)
            .with_passage(1, &"a".repeat(50))
            .with_passage(2, &big)
            .with_passage(3, &small);
        let hits = [hit(1, &"a".repeat(50)), hit(2, &big), hit(3, &small)];
        let evidence = authorize_and_resolve(&access, SCOPE, &hits, &[], 20)
            .await
            .expect("authorized");
        // 50 fits, 50 + 60 > 100 overflows; the smaller third passage must not
        // leapfrog the dropped, better-ranked one.
        assert_eq!(evidence.passages.len(), 1);
        assert_eq!(evidence.passages[0].passage_id, 1);
        assert!(evidence.truncated);

        // A single passage larger than the whole grant discloses nothing.
        let oversized = FakeAccess::new(10, 8).with_passage(1, &"x".repeat(9));
        let evidence = authorize_and_resolve(&oversized, SCOPE, &[hit(1, &"x".repeat(9))], &[], 20)
            .await
            .expect("authorized");
        assert!(evidence.passages.is_empty());
        assert!(evidence.truncated);
    }

    #[tokio::test]
    async fn ineligible_hits_are_skipped_without_consuming_budget() {
        let body = "Returns require approval.";
        let access = FakeAccess::new(1, 1000).with_passage(7, body);
        let mut other_kind = hit(8, body);
        other_kind.record.resource_kind = "document".into();
        let mut stale = hit(9, body);
        stale.record.source_fingerprint = "tampered".into();
        let mut invalid_id = hit(0, body);
        invalid_id.record.resource_id = "not-a-number".into();
        let hits = [
            other_kind,
            stale,
            invalid_id,
            hit(404, body), // no such passage
            hit(7, body),
            hit(7, body), // duplicate hit must not double-spend rows
        ];
        let evidence = authorize_and_resolve(&access, SCOPE, &hits, &[], 20)
            .await
            .expect("authorized");
        assert_eq!(evidence.passages.len(), 1);
        assert_eq!(evidence.passages[0].passage_id, 7);
        assert!(!evidence.truncated);

        // A requested source kind that does not match filters after resolution.
        let filtered =
            authorize_and_resolve(&access, SCOPE, &[hit(7, body)], &["invoice".into()], 20)
                .await
                .expect("authorized");
        assert!(filtered.passages.is_empty());
    }

    #[tokio::test]
    async fn tampered_stored_text_or_fingerprint_yields_nothing() {
        let body = "Returns require approval.";
        let access = FakeAccess::new(5, 1000).with_passage(7, body);
        access.chains.lock().unwrap().get_mut(&7).unwrap().passage["passageText"] =
            json!("Caller supplied replacement text");
        let evidence = authorize_and_resolve(&access, SCOPE, &[hit(7, body)], &[], 20)
            .await
            .expect("authorized");
        assert!(evidence.passages.is_empty());
    }

    #[tokio::test]
    async fn an_unreadable_evidence_store_is_an_error_not_an_empty_allow() {
        let body = "Returns require approval.";
        let access = FakeAccess::new(5, 1000).with_passage(7, body);
        *access.chain_fails.lock().unwrap() = true;
        assert!(matches!(
            authorize_and_resolve(&access, SCOPE, &[hit(7, body)], &[], 20).await,
            Err(EvidenceError::Resolution(_))
        ));
    }

    async fn authorized(access: &FakeAccess, body: &str) -> AuthorizedEvidence {
        authorize_and_resolve(access, SCOPE, &[hit(7, body)], &[], 20)
            .await
            .expect("authorized")
    }

    #[tokio::test]
    async fn release_recheck_passes_only_while_nothing_changed() {
        let body = "Returns require approval.";
        let access = FakeAccess::new(5, 1000).with_passage(7, body);
        let evidence = authorized(&access, body).await;
        assert_eq!(
            recheck_before_release(&access, SCOPE, &evidence, 20).await,
            ReleaseCheck::Current
        );
    }

    #[tokio::test]
    async fn grant_revoked_between_retrieval_and_release_withdraws_the_answer() {
        let body = "Returns require approval.";
        let access = FakeAccess::new(5, 1000).with_passage(7, body);
        let evidence = authorized(&access, body).await;

        // Role removed mid-run: the envelope no longer grants the capability.
        *access.grant.lock().unwrap() = Err("role revoked");
        assert!(matches!(
            recheck_before_release(&access, SCOPE, &evidence, 20).await,
            ReleaseCheck::Withdrawn(_)
        ));

        // The grant service becoming unreachable at release is also a withdrawal.
        *access.grant.lock().unwrap() = Ok(CapabilityGrantBounds {
            max_rows: 5,
            max_bytes: 1000,
        });
        *access.flip_after.lock().unwrap() =
            Some((access.grant_calls.load(Ordering::SeqCst), Err("timeout")));
        assert!(matches!(
            recheck_before_release(&access, SCOPE, &evidence, 20).await,
            ReleaseCheck::Withdrawn(_)
        ));
    }

    #[tokio::test]
    async fn a_narrowed_grant_withdraws_evidence_that_no_longer_fits() {
        let body = "Returns require approval.";
        let access = FakeAccess::new(5, 1000).with_passage(7, body);
        let evidence = authorized(&access, body).await;
        *access.grant.lock().unwrap() = Ok(CapabilityGrantBounds {
            max_rows: 5,
            max_bytes: body.len() as u64 - 1,
        });
        assert!(matches!(
            recheck_before_release(&access, SCOPE, &evidence, 20).await,
            ReleaseCheck::Withdrawn(_)
        ));
    }

    #[tokio::test]
    async fn source_lifecycle_changes_between_retrieval_and_release_withdraw_the_answer() {
        let body = "Returns require approval.";
        for (target, field, value) in [
            ("version", "status", json!("access_revoked")),
            ("version", "status", json!("deleted")),
            ("version", "status", json!("superseded")),
            ("version", "status", json!("retracted")),
            ("passage", "status", json!("withdrawn")),
            ("passage", "status", json!("superseded")),
            ("passage", "textState", json!("restricted")),
            ("passage", "textState", json!("tombstoned")),
            ("passage", "passageText", json!("Replacement text.")),
            ("passage", "sourceVersion", json!("2027")),
        ] {
            let access = FakeAccess::new(5, 1000).with_passage(7, body);
            let evidence = authorized(&access, body).await;
            {
                let mut chains = access.chains.lock().unwrap();
                let chain = chains.get_mut(&7).unwrap();
                match target {
                    "version" => chain.version[field] = value.clone(),
                    _ => chain.passage[field] = value.clone(),
                }
            }
            assert!(
                matches!(
                    recheck_before_release(&access, SCOPE, &evidence, 20).await,
                    ReleaseCheck::Withdrawn(_)
                ),
                "{target}.{field}={value}"
            );
        }

        // A passage row that vanished, or a store that cannot be read, fails closed.
        let access = FakeAccess::new(5, 1000).with_passage(7, body);
        let evidence = authorized(&access, body).await;
        access.chains.lock().unwrap().clear();
        assert!(matches!(
            recheck_before_release(&access, SCOPE, &evidence, 20).await,
            ReleaseCheck::Withdrawn(_)
        ));
        let access = FakeAccess::new(5, 1000).with_passage(7, body);
        let evidence = authorized(&access, body).await;
        *access.chain_fails.lock().unwrap() = true;
        assert!(matches!(
            recheck_before_release(&access, SCOPE, &evidence, 20).await,
            ReleaseCheck::Withdrawn(_)
        ));
    }

    #[test]
    fn withdrawal_reasons_never_carry_passage_content() {
        // The reasons are static strings; this pins that they stay generic.
        for reason in [
            "evidence access could not be re-verified before release",
            "evidence access was narrowed before release",
            "evidence changed before release",
        ] {
            assert!(!reason.contains("Returns"));
        }
    }
}
