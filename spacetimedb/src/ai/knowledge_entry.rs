//! AIH-17: reviewed knowledge entries and scoped reuse.
//!
//! A knowledge entry is a reusable concept, interpretation or procedure that
//! future tasks may retrieve. It is *non-executable text* with links back to
//! its evidence: the passages, claims and decisions it rests on. It is not a
//! skill and grants no permission.
//!
//! # Review, not usage, confers authority
//!
//! Versions start as `candidate`. The only way to `approved` is through
//! `review_ai_knowledge_entry_version`, which needs a human reviewer with the
//! review permission and requires every review kind the entry type needs
//! (source fidelity and domain interpretation; plus implementation for a
//! procedure) to be accepted *in the current review epoch*. A run count, a
//! passing code test or a high retrieval score has no reducer to call:
//! `nominate_ai_knowledge_entry_version` can only move an entry *toward*
//! review, never toward approval.
//!
//! When something an entry depends on changes, `mark_version_needs_review`
//! moves it to `needs_review` and bumps its epoch, which voids every earlier
//! review — approval must be earned again against the changed evidence.
//!
//! # Derived entries do not widen access
//!
//! A version can only reference evidence in its own scope
//! (`require_passage_referencable`), and retrieval re-checks that scope and
//! the dependency edges at read time rather than trusting the authorization
//! that existed when the entry was written.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::evidence_common::{
    require_len, require_one_of, require_opt_len, validate_id_list, validate_tags,
};
use crate::ai::evidence_dependency::{
    link_dependency, require_dependencies_usable, DependentKind, Requirement, UpstreamKind,
};
use crate::ai::evidence_lineage::{load_claim, load_decision, CLAIM_CURRENT, DECISION_ACCEPTED};
use crate::ai::evidence_source::require_passage_referencable;
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_KEY_LEN: usize = 128;
const MAX_TITLE_LEN: usize = 256;
const MAX_BODY_LEN: usize = 16_000;
const MAX_NOTE_LEN: usize = 2_000;
const MAX_RELATED: usize = 32;

pub const KNOWLEDGE_KINDS: [&str; 3] = ["concept", "interpretation", "procedure"];
pub const SHARE_SCOPES: [&str; 3] = ["personal", "team", "organization"];
pub const REVIEW_KINDS: [&str; 3] = ["source_fidelity", "domain_interpretation", "implementation"];
pub const KNOWLEDGE_REVIEW_OUTCOMES: [&str; 2] = ["accepted", "rejected"];
/// Signals that may nominate an entry for review. None of them approve.
pub const NOMINATION_SIGNALS: [&str; 4] = ["manual", "repeated_use", "correction", "source_change"];

pub const STATE_CANDIDATE: &str = "candidate";
pub const STATE_REVIEWED: &str = "reviewed";
pub const STATE_APPROVED: &str = "approved";
pub const STATE_SUPERSEDED: &str = "superseded";
pub const STATE_DISPUTED: &str = "disputed";
pub const STATE_WITHDRAWN: &str = "withdrawn";
pub const STATE_NEEDS_REVIEW: &str = "needs_review";

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_knowledge_entry,
    index(accessor = ai_knowledge_entry_by_org, btree(columns = [organization_id])),
    index(
        accessor = ai_knowledge_entry_by_key,
        btree(columns = [organization_id, company_id, entry_key])
    )
)]
pub struct AiKnowledgeEntry {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub entry_key: String,
    /// concept | interpretation | procedure
    pub kind: String,
    /// Domains the entry belongs to (`accounting`, `inventory`, ...), as
    /// `key:value` tags.
    pub domain_tags: Vec<String>,
    pub owner_uid: Identity,
    /// personal | team | organization
    pub share_scope: String,
    pub team_ref: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_knowledge_entry_version,
    index(accessor = ai_knowledge_entry_version_by_org, btree(columns = [organization_id])),
    index(accessor = ai_knowledge_entry_version_by_entry, btree(columns = [entry_id]))
)]
pub struct AiKnowledgeEntryVersion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub entry_id: u64,
    pub version: u32,
    pub title: String,
    /// Descriptive text. Never code or a tool call.
    pub body: String,
    pub applicability: Vec<String>,
    pub source_passage_ids: Vec<u64>,
    pub claim_ids: Vec<u64>,
    pub decision_ids: Vec<u64>,
    /// Entries this one relates to, including across domains. Following a
    /// link at retrieval time still requires current access to the target.
    pub related_entry_ids: Vec<u64>,
    /// What prompted review, if anything. Informational only.
    pub nomination_signal: Option<String>,
    /// candidate | reviewed | approved | superseded | disputed | withdrawn |
    /// needs_review
    pub review_state: String,
    /// Bumped whenever earlier reviews stop counting.
    pub review_epoch: u32,
    pub supersedes_version_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// Append-only: what a named reviewer reviewed, and their verdict.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_knowledge_review,
    index(accessor = ai_knowledge_review_by_org, btree(columns = [organization_id])),
    index(accessor = ai_knowledge_review_by_version, btree(columns = [version_id]))
)]
pub struct AiKnowledgeReview {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub version_id: u64,
    /// source_fidelity | domain_interpretation | implementation
    pub review_kind: String,
    /// accepted | rejected
    pub outcome: String,
    pub review_epoch: u32,
    pub note: Option<String>,
    pub reviewer_uid: Identity,
    pub create_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct AiKnowledgeVersionContent {
    pub title: String,
    pub body: String,
    pub applicability: Vec<String>,
    pub source_passage_ids: Vec<u64>,
    pub claim_ids: Vec<u64>,
    pub decision_ids: Vec<u64>,
    pub related_entry_ids: Vec<u64>,
    pub nomination_signal: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiKnowledgeEntryParams {
    pub entry_key: String,
    pub kind: String,
    pub domain_tags: Vec<String>,
    pub share_scope: String,
    pub team_ref: Option<String>,
    pub content: AiKnowledgeVersionContent,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReviewAiKnowledgeEntryVersionParams {
    pub review_kind: String,
    pub outcome: String,
    pub note: Option<String>,
}

// ── Pure rules ───────────────────────────────────────────────────────────────

/// Review kinds that must each be accepted before approval.
pub fn required_review_kinds(kind: &str) -> &'static [&'static str] {
    match kind {
        "procedure" => &REVIEW_KINDS,
        _ => &["source_fidelity", "domain_interpretation"],
    }
}

/// The state after a review, given the latest verdict per review kind in the
/// current epoch. A rejection disputes the entry; approval needs every
/// required kind accepted; one accepted kind is `reviewed`. Otherwise the
/// current state stands.
pub fn derive_review_state(
    kind: &str,
    current: &str,
    latest_by_kind: &[(String, String)],
) -> String {
    if latest_by_kind
        .iter()
        .any(|(_, outcome)| outcome == "rejected")
    {
        return STATE_DISPUTED.to_string();
    }
    let accepted = |review_kind: &str| {
        latest_by_kind
            .iter()
            .any(|(kind, outcome)| kind == review_kind && outcome == "accepted")
    };
    if required_review_kinds(kind)
        .iter()
        .all(|required| accepted(required))
    {
        return STATE_APPROVED.to_string();
    }
    if latest_by_kind
        .iter()
        .any(|(_, outcome)| outcome == "accepted")
    {
        return STATE_REVIEWED.to_string();
    }
    current.to_string()
}

/// States a reviewer can act on.
pub fn is_reviewable_state(state: &str) -> bool {
    matches!(state, STATE_CANDIDATE | STATE_REVIEWED | STATE_NEEDS_REVIEW)
}

/// Manual state moves. Nothing here reaches `approved`, and `withdrawn` is
/// terminal.
pub fn valid_state_move(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        (STATE_APPROVED, STATE_NEEDS_REVIEW)
            | (STATE_APPROVED, STATE_DISPUTED)
            | (STATE_APPROVED, STATE_WITHDRAWN)
            | (STATE_REVIEWED, STATE_NEEDS_REVIEW)
            | (STATE_REVIEWED, STATE_DISPUTED)
            | (STATE_REVIEWED, STATE_WITHDRAWN)
            | (STATE_CANDIDATE, STATE_DISPUTED)
            | (STATE_CANDIDATE, STATE_WITHDRAWN)
            | (STATE_NEEDS_REVIEW, STATE_DISPUTED)
            | (STATE_NEEDS_REVIEW, STATE_WITHDRAWN)
            | (STATE_DISPUTED, STATE_NEEDS_REVIEW)
            | (STATE_DISPUTED, STATE_WITHDRAWN)
            | (STATE_SUPERSEDED, STATE_WITHDRAWN)
    )
}

/// Whether a version may be served for reuse right now. Only approved
/// versions are reusable; the caller must additionally re-check scope and
/// dependencies at read time.
pub fn is_reusable_state(state: &str) -> bool {
    state == STATE_APPROVED
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create an entry and its first version, as a `candidate`.
#[reducer]
pub fn create_ai_knowledge_entry(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateAiKnowledgeEntryParams,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization_id must be nonzero".to_string());
    }
    check_permission(ctx, organization_id, "ai_knowledge_entry", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    require_len("entry_key", &params.entry_key, MAX_KEY_LEN)?;
    require_one_of("kind", &params.kind, &KNOWLEDGE_KINDS)?;
    require_one_of("share_scope", &params.share_scope, &SHARE_SCOPES)?;
    validate_tags("domain_tags", &params.domain_tags)?;
    require_opt_len("team_ref", &params.team_ref, MAX_KEY_LEN)?;
    match (params.share_scope.as_str(), &params.team_ref) {
        ("team", None) => return Err("a team-scoped entry must name its team".to_string()),
        ("personal" | "organization", Some(_)) => {
            return Err("only a team-scoped entry names a team".to_string())
        }
        _ => {}
    }
    if ctx
        .db
        .ai_knowledge_entry()
        .ai_knowledge_entry_by_key()
        .filter((&organization_id, &company_id, &params.entry_key))
        .next()
        .is_some()
    {
        return Err("an entry with that key already exists; propose a new version".to_string());
    }
    validate_content(&params.kind, &params.content)?;
    check_content_references(ctx, organization_id, company_id, &params.content)?;

    let entry = ctx.db.ai_knowledge_entry().insert(AiKnowledgeEntry {
        id: 0,
        organization_id,
        company_id,
        entry_key: params.entry_key,
        kind: params.kind,
        domain_tags: params.domain_tags,
        owner_uid: ctx.sender(),
        share_scope: params.share_scope,
        team_ref: params.team_ref,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    let version = insert_version(ctx, &entry, 1, params.content, None);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_knowledge_entry",
            record_id: entry.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "entry_key": entry.entry_key,
                    "kind": entry.kind,
                    "version_id": version.id,
                })
                .to_string(),
            ),
            changed_fields: vec!["entry_key".to_string(), "kind".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Add a new version to an entry. The previous approved version stays
/// approved until this one earns approval and replaces it.
#[reducer]
pub fn propose_ai_knowledge_entry_version(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    entry_id: u64,
    params: AiKnowledgeVersionContent,
) -> Result<(), String> {
    let entry = load_entry(ctx, organization_id, company_id, entry_id)?;
    if entry.owner_uid != ctx.sender() {
        check_permission(ctx, organization_id, "ai_knowledge_entry", "update")?;
    }
    validate_content(&entry.kind, &params)?;
    check_content_references(ctx, organization_id, company_id, &params)?;

    let previous = ctx
        .db
        .ai_knowledge_entry_version()
        .ai_knowledge_entry_version_by_entry()
        .filter(&entry_id)
        .max_by_key(|row| row.version);
    let next_version = previous.as_ref().map_or(1, |row| row.version + 1);
    let version = insert_version(
        ctx,
        &entry,
        next_version,
        params,
        previous.as_ref().map(|row| row.id),
    );

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_knowledge_entry_version",
            record_id: version.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "entry_id": entry_id, "version": version.version }).to_string(),
            ),
            changed_fields: vec!["version".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Record one review of one kind and recompute the version's state from the
/// current epoch's verdicts. Approving supersedes the entry's earlier
/// approved version.
#[reducer]
pub fn review_ai_knowledge_entry_version(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    version_id: u64,
    params: ReviewAiKnowledgeEntryVersionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_knowledge_review", "update")?;
    require_one_of("review_kind", &params.review_kind, &REVIEW_KINDS)?;
    require_one_of("outcome", &params.outcome, &KNOWLEDGE_REVIEW_OUTCOMES)?;
    require_opt_len("note", &params.note, MAX_NOTE_LEN)?;
    let version = load_version(ctx, organization_id, company_id, version_id)?;
    let entry = load_entry(ctx, organization_id, company_id, version.entry_id)?;
    if !is_reviewable_state(&version.review_state) {
        return Err(format!(
            "a {} version cannot be reviewed",
            version.review_state
        ));
    }
    if params.review_kind == "implementation" && entry.kind != "procedure" {
        return Err("only a procedure has an implementation review".to_string());
    }
    if params.outcome == "accepted" {
        // Accepting against evidence that has since been withdrawn or
        // superseded would approve knowledge that cannot be defended.
        require_dependencies_usable(
            ctx,
            organization_id,
            DependentKind::KnowledgeVersion,
            version_id,
        )?;
    }

    ctx.db.ai_knowledge_review().insert(AiKnowledgeReview {
        id: 0,
        organization_id,
        company_id,
        version_id,
        review_kind: params.review_kind.clone(),
        outcome: params.outcome.clone(),
        review_epoch: version.review_epoch,
        note: params.note,
        reviewer_uid: ctx.sender(),
        create_date: ctx.timestamp,
    });

    let latest = latest_verdicts(ctx, version_id, version.review_epoch);
    let new_state = derive_review_state(&entry.kind, &version.review_state, &latest);
    let old_state = version.review_state.clone();
    let entry_id = version.entry_id;
    ctx.db
        .ai_knowledge_entry_version()
        .id()
        .update(AiKnowledgeEntryVersion {
            review_state: new_state.clone(),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..version
        });

    if new_state == STATE_APPROVED {
        supersede_other_approved(ctx, entry_id, version_id);
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_knowledge_entry_version",
            record_id: version_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "review_state": old_state }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "review_state": new_state,
                    "review_kind": params.review_kind,
                    "outcome": params.outcome,
                })
                .to_string(),
            ),
            changed_fields: vec!["review_state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Move a version to `needs_review`, `disputed` or `withdrawn` by hand.
/// Cannot approve, and a withdrawn version stays withdrawn.
#[reducer]
pub fn set_ai_knowledge_entry_version_state(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    version_id: u64,
    state: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_knowledge_review", "update")?;
    require_one_of(
        "state",
        &state,
        &[STATE_NEEDS_REVIEW, STATE_DISPUTED, STATE_WITHDRAWN],
    )?;
    let version = load_version(ctx, organization_id, company_id, version_id)?;
    if !valid_state_move(&version.review_state, &state) {
        return Err(format!(
            "a {} version cannot move to {state}",
            version.review_state
        ));
    }
    apply_state(ctx, version, &state);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_knowledge_entry_version",
            record_id: version_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "review_state": state }).to_string()),
            changed_fields: vec!["review_state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Nominate an entry for review because of a usage, correction or source
/// signal. The signal is recorded, and an approved or reviewed version is
/// sent back to `needs_review`; there is no path from a signal to approval.
#[reducer]
pub fn nominate_ai_knowledge_entry_version(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    version_id: u64,
    signal: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_knowledge_entry", "update")?;
    require_one_of("signal", &signal, &NOMINATION_SIGNALS)?;
    let mut version = load_version(ctx, organization_id, company_id, version_id)?;
    version.nomination_signal = Some(signal.clone());
    if matches!(
        version.review_state.as_str(),
        STATE_APPROVED | STATE_REVIEWED
    ) {
        apply_state(ctx, version, STATE_NEEDS_REVIEW);
    } else {
        ctx.db
            .ai_knowledge_entry_version()
            .id()
            .update(AiKnowledgeEntryVersion {
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..version
            });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_knowledge_entry_version",
            record_id: version_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "nomination_signal": signal }).to_string()),
            changed_fields: vec!["nomination_signal".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Crate-internal API ───────────────────────────────────────────────────────

/// Called when something a version depends on changed. Voids earlier reviews
/// by bumping the epoch; a version that is already withdrawn, superseded or
/// disputed is left as it is.
pub(crate) fn mark_version_needs_review(ctx: &ReducerContext, version_id: u64) {
    if let Some(version) = ctx.db.ai_knowledge_entry_version().id().find(&version_id) {
        if matches!(
            version.review_state.as_str(),
            STATE_CANDIDATE | STATE_REVIEWED | STATE_APPROVED
        ) {
            apply_state(ctx, version, STATE_NEEDS_REVIEW);
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Write `state`, bumping the review epoch when the move discards reviews.
fn apply_state(ctx: &ReducerContext, version: AiKnowledgeEntryVersion, state: &str) {
    let epoch = if state == STATE_NEEDS_REVIEW {
        version.review_epoch + 1
    } else {
        version.review_epoch
    };
    ctx.db
        .ai_knowledge_entry_version()
        .id()
        .update(AiKnowledgeEntryVersion {
            review_state: state.to_string(),
            review_epoch: epoch,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..version
        });
}

fn insert_version(
    ctx: &ReducerContext,
    entry: &AiKnowledgeEntry,
    version: u32,
    content: AiKnowledgeVersionContent,
    supersedes_version_id: Option<u64>,
) -> AiKnowledgeEntryVersion {
    let row = ctx
        .db
        .ai_knowledge_entry_version()
        .insert(AiKnowledgeEntryVersion {
            id: 0,
            organization_id: entry.organization_id,
            company_id: entry.company_id,
            entry_id: entry.id,
            version,
            title: content.title,
            body: content.body,
            applicability: content.applicability,
            source_passage_ids: content.source_passage_ids,
            claim_ids: content.claim_ids,
            decision_ids: content.decision_ids,
            related_entry_ids: content.related_entry_ids,
            nomination_signal: content.nomination_signal,
            review_state: STATE_CANDIDATE.to_string(),
            review_epoch: 0,
            supersedes_version_id,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });

    let decision_requirement = if entry.kind == "procedure" {
        Requirement::Required
    } else {
        Requirement::Discretionary
    };
    for passage_id in &row.source_passage_ids {
        link_dependency(
            ctx,
            row.organization_id,
            row.company_id,
            UpstreamKind::Passage,
            *passage_id,
            DependentKind::KnowledgeVersion,
            row.id,
            Requirement::Required,
        );
    }
    for claim_id in &row.claim_ids {
        link_dependency(
            ctx,
            row.organization_id,
            row.company_id,
            UpstreamKind::Claim,
            *claim_id,
            DependentKind::KnowledgeVersion,
            row.id,
            Requirement::Required,
        );
    }
    for decision_id in &row.decision_ids {
        link_dependency(
            ctx,
            row.organization_id,
            row.company_id,
            UpstreamKind::Decision,
            *decision_id,
            DependentKind::KnowledgeVersion,
            row.id,
            decision_requirement,
        );
    }
    row
}

fn latest_verdicts(ctx: &ReducerContext, version_id: u64, epoch: u32) -> Vec<(String, String)> {
    let mut reviews: Vec<AiKnowledgeReview> = ctx
        .db
        .ai_knowledge_review()
        .ai_knowledge_review_by_version()
        .filter(&version_id)
        .filter(|row| row.review_epoch == epoch)
        .collect();
    reviews.sort_by_key(|row| row.id);
    let mut latest: Vec<(String, String)> = Vec::new();
    for review in reviews {
        latest.retain(|(kind, _)| *kind != review.review_kind);
        latest.push((review.review_kind, review.outcome));
    }
    latest
}

fn supersede_other_approved(ctx: &ReducerContext, entry_id: u64, keep_version_id: u64) {
    let others: Vec<AiKnowledgeEntryVersion> = ctx
        .db
        .ai_knowledge_entry_version()
        .ai_knowledge_entry_version_by_entry()
        .filter(&entry_id)
        .filter(|row| row.id != keep_version_id && row.review_state == STATE_APPROVED)
        .collect();
    for other in others {
        ctx.db
            .ai_knowledge_entry_version()
            .id()
            .update(AiKnowledgeEntryVersion {
                review_state: STATE_SUPERSEDED.to_string(),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..other
            });
    }
}

pub(crate) fn load_entry(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    entry_id: u64,
) -> Result<AiKnowledgeEntry, String> {
    let entry = ctx
        .db
        .ai_knowledge_entry()
        .id()
        .find(&entry_id)
        .ok_or("Knowledge entry not found")?;
    if entry.organization_id != organization_id || entry.company_id != company_id {
        return Err("Knowledge entry does not belong to this organization/company".to_string());
    }
    Ok(entry)
}

pub(crate) fn load_version(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    version_id: u64,
) -> Result<AiKnowledgeEntryVersion, String> {
    let version = ctx
        .db
        .ai_knowledge_entry_version()
        .id()
        .find(&version_id)
        .ok_or("Knowledge entry version not found")?;
    if version.organization_id != organization_id || version.company_id != company_id {
        return Err(
            "Knowledge entry version does not belong to this organization/company".to_string(),
        );
    }
    Ok(version)
}

fn check_content_references(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    content: &AiKnowledgeVersionContent,
) -> Result<(), String> {
    for passage_id in &content.source_passage_ids {
        require_passage_referencable(ctx, organization_id, company_id, *passage_id, true)?;
    }
    for claim_id in &content.claim_ids {
        let claim = load_claim(ctx, organization_id, company_id, *claim_id)?;
        if claim.status != CLAIM_CURRENT {
            return Err(format!("Claim {claim_id} is {}", claim.status));
        }
    }
    for decision_id in &content.decision_ids {
        let decision = load_decision(ctx, organization_id, company_id, *decision_id)?;
        if decision.status != DECISION_ACCEPTED {
            return Err(format!("Decision {decision_id} is {}", decision.status));
        }
    }
    for entry_id in &content.related_entry_ids {
        load_entry(ctx, organization_id, company_id, *entry_id)?;
    }
    Ok(())
}

fn validate_content(kind: &str, content: &AiKnowledgeVersionContent) -> Result<(), String> {
    require_len("title", &content.title, MAX_TITLE_LEN)?;
    require_len("body", &content.body, MAX_BODY_LEN)?;
    validate_tags("applicability", &content.applicability)?;
    validate_id_list("source_passage_ids", &content.source_passage_ids)?;
    validate_id_list("claim_ids", &content.claim_ids)?;
    validate_id_list("decision_ids", &content.decision_ids)?;
    validate_id_list("related_entry_ids", &content.related_entry_ids)?;
    if content.related_entry_ids.len() > MAX_RELATED {
        return Err(format!("at most {MAX_RELATED} related entries"));
    }
    if let Some(signal) = &content.nomination_signal {
        require_one_of("nomination_signal", signal, &NOMINATION_SIGNALS)?;
    }
    if content.source_passage_ids.is_empty() && content.claim_ids.is_empty() {
        return Err(
            "a knowledge entry must rest on at least one source passage or claim".to_string(),
        );
    }
    if kind == "procedure" && content.decision_ids.is_empty() {
        return Err("a procedure must link the decisions that justify it".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verdicts(items: &[(&str, &str)]) -> Vec<(String, String)> {
        items
            .iter()
            .map(|(kind, outcome)| (kind.to_string(), outcome.to_string()))
            .collect()
    }

    fn content() -> AiKnowledgeVersionContent {
        AiKnowledgeVersionContent {
            title: "Straight-line depreciation".into(),
            body: "Spread cost evenly over useful life.".into(),
            applicability: vec![],
            source_passage_ids: vec![1],
            claim_ids: vec![],
            decision_ids: vec![],
            related_entry_ids: vec![],
            nomination_signal: None,
        }
    }

    #[test]
    fn approval_needs_every_required_review_kind() {
        let one = verdicts(&[("source_fidelity", "accepted")]);
        assert_eq!(
            derive_review_state("concept", "candidate", &one),
            "reviewed"
        );

        let both = verdicts(&[
            ("source_fidelity", "accepted"),
            ("domain_interpretation", "accepted"),
        ]);
        assert_eq!(
            derive_review_state("concept", "candidate", &both),
            "approved"
        );
        // A procedure additionally needs an implementation review.
        assert_eq!(
            derive_review_state("procedure", "candidate", &both),
            "reviewed"
        );
        let all = verdicts(&[
            ("source_fidelity", "accepted"),
            ("domain_interpretation", "accepted"),
            ("implementation", "accepted"),
        ]);
        assert_eq!(
            derive_review_state("procedure", "candidate", &all),
            "approved"
        );
    }

    #[test]
    fn a_rejection_disputes_regardless_of_other_acceptances() {
        let mixed = verdicts(&[
            ("source_fidelity", "accepted"),
            ("domain_interpretation", "rejected"),
        ]);
        assert_eq!(
            derive_review_state("concept", "candidate", &mixed),
            "disputed"
        );
    }

    #[test]
    fn no_verdicts_leave_the_state_alone() {
        assert_eq!(
            derive_review_state("concept", "needs_review", &[]),
            "needs_review"
        );
    }

    #[test]
    fn no_manual_move_reaches_approval() {
        let states = [
            STATE_CANDIDATE,
            STATE_REVIEWED,
            STATE_APPROVED,
            STATE_SUPERSEDED,
            STATE_DISPUTED,
            STATE_WITHDRAWN,
            STATE_NEEDS_REVIEW,
        ];
        for from in states {
            assert!(
                !valid_state_move(from, STATE_APPROVED),
                "{from} -> approved"
            );
            assert!(
                !valid_state_move(STATE_WITHDRAWN, from),
                "withdrawn -> {from}"
            );
        }
    }

    #[test]
    fn only_approved_versions_are_reusable() {
        assert!(is_reusable_state("approved"));
        for state in [
            "candidate",
            "reviewed",
            "needs_review",
            "disputed",
            "superseded",
            "withdrawn",
        ] {
            assert!(!is_reusable_state(state), "{state}");
        }
    }

    #[test]
    fn approved_versions_cannot_be_reviewed_again_without_a_reset() {
        assert!(is_reviewable_state("candidate"));
        assert!(is_reviewable_state("needs_review"));
        assert!(!is_reviewable_state("approved"));
        assert!(!is_reviewable_state("withdrawn"));
        assert!(!is_reviewable_state("disputed"));
    }

    #[test]
    fn content_needs_evidence_and_procedures_need_decisions() {
        assert!(validate_content("concept", &content()).is_ok());

        let mut no_evidence = content();
        no_evidence.source_passage_ids.clear();
        assert!(validate_content("concept", &no_evidence).is_err());
        no_evidence.claim_ids = vec![4];
        assert!(validate_content("concept", &no_evidence).is_ok());

        assert!(validate_content("procedure", &content()).is_err());
        let mut procedure = content();
        procedure.decision_ids = vec![7];
        assert!(validate_content("procedure", &procedure).is_ok());
    }

    #[test]
    fn nomination_signals_are_a_closed_set() {
        let mut bad = content();
        bad.nomination_signal = Some("high_score".into());
        assert!(validate_content("concept", &bad).is_err());
        bad.nomination_signal = Some("repeated_use".into());
        assert!(validate_content("concept", &bad).is_ok());
    }
}
