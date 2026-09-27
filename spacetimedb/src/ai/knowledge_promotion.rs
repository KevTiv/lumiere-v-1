//! Reviewed bridge from non-executable knowledge to an unreleased skill candidate.
//!
//! Promotion is deliberately two-step. A proposer snapshots an approved knowledge
//! version and its lineage; an independent reviewer accepts that candidate and only
//! then creates an immutable skill version. Certification and release remain the
//! responsibility of the existing skill registry gates.

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::evidence_common::{require_len, require_opt_len};
use crate::ai::evidence_dependency::{require_dependencies_usable, DependentKind};
use crate::ai::knowledge_entry::{
    ai_knowledge_entry_version, ai_knowledge_review, load_entry, load_version,
    require_entry_scope_access, require_team_membership, required_review_kinds,
    AiKnowledgeEntryVersion, STATE_APPROVED,
};
use crate::ai::skill_registry::{
    ai_skill_release, ai_skill_version, validate_manifest, AiSkillRelease, AiSkillVersion,
};
use crate::ai::skills::{ai_skill, AiSkill};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_KEY_LEN: usize = 160;
const MAX_NAME_LEN: usize = 256;
const MAX_NOTE_LEN: usize = 2_000;

pub const PROMOTION_PROPOSED: &str = "proposed";
pub const PROMOTION_ACCEPTED: &str = "accepted";
pub const PROMOTION_REJECTED: &str = "rejected";
pub const PROMOTION_INVALIDATED: &str = "invalidated";

pub const CERTIFICATION_NOT_REQUESTED: &str = "not_requested";
pub const CERTIFICATION_QUEUED: &str = "queued";
pub const CERTIFICATION_RUNNING: &str = "running";
pub const CERTIFICATION_EVIDENCE_RECORDED: &str = "evidence_recorded";
pub const CERTIFICATION_FAILED: &str = "failed";
pub const CERTIFICATION_CERTIFIED: &str = "certified";
pub const CERTIFICATION_INVALIDATED: &str = "invalidated";

fn promotion_status_allows_runtime(status: &str) -> bool {
    status == PROMOTION_ACCEPTED
}

/// Durable, reviewable bridge. The knowledge lineage fields are immutable
/// snapshots; only review/certification lifecycle fields are updated.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_knowledge_skill_promotion,
    public,
    index(accessor = ai_knowledge_skill_promotion_by_org, btree(columns = [organization_id])),
    index(accessor = ai_knowledge_skill_promotion_by_knowledge, btree(columns = [knowledge_version_id])),
    index(accessor = ai_knowledge_skill_promotion_by_skill_version, btree(columns = [skill_version_id]))
)]
pub struct AiKnowledgeSkillPromotion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub promotion_key: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub knowledge_entry_id: u64,
    pub knowledge_version_id: u64,
    pub knowledge_review_epoch: u32,
    pub source_passage_ids: Vec<u64>,
    pub claim_ids: Vec<u64>,
    pub decision_ids: Vec<u64>,
    pub knowledge_reviewer_uids: Vec<Identity>,
    pub requested_skill_id: Option<u64>,
    pub skill_key: String,
    pub skill_name: String,
    pub manifest_json: String,
    pub lineage_hash: String,
    pub payload_hash: String,
    /// proposed | accepted | rejected | invalidated
    pub status: String,
    /// not_requested | queued | running | evidence_recorded | failed |
    /// certified | invalidated
    pub certification_state: String,
    pub skill_id: Option<u64>,
    pub skill_version_id: Option<u64>,
    pub proposed_by: Identity,
    pub proposed_at: Timestamp,
    pub reviewed_by: Option<Identity>,
    pub reviewed_at: Option<Timestamp>,
    pub review_note: Option<String>,
    pub invalidated_at: Option<Timestamp>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ProposeAiKnowledgeSkillPromotionParams {
    pub idempotency_key: String,
    pub knowledge_version_id: u64,
    /// Existing organization skill, or `None` to create a new catalog entry
    /// only after independent acceptance.
    pub skill_id: Option<u64>,
    pub skill_key: String,
    pub skill_name: String,
    pub manifest_json: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReviewAiKnowledgeSkillPromotionParams {
    pub outcome: String,
    pub note: Option<String>,
}

#[reducer]
pub fn propose_ai_knowledge_skill_promotion(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: ProposeAiKnowledgeSkillPromotionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "create")?;
    check_permission(ctx, organization_id, "ai_knowledge_entry", "retrieve")?;
    require_len("idempotency_key", &params.idempotency_key, MAX_KEY_LEN)?;
    require_len("skill_key", &params.skill_key, MAX_KEY_LEN)?;
    require_len("skill_name", &params.skill_name, MAX_NAME_LEN)?;

    let version = load_version(
        ctx,
        organization_id,
        company_id,
        params.knowledge_version_id,
    )?;
    let entry = load_entry(ctx, organization_id, company_id, version.entry_id)?;
    require_entry_scope_access(ctx, &entry, ctx.sender())?;
    require_promotable_knowledge(ctx, &version)?;

    let manifest = validate_manifest(&params.manifest_json, params.skill_key.trim())?;
    let lineage_hash = knowledge_lineage_hash(&version);
    if manifest.source_hash.trim_start_matches("sha256:") != lineage_hash {
        return Err(
            "manifest source_hash does not match the knowledge lineage snapshot".to_string(),
        );
    }
    if let Some(skill_id) = params.skill_id {
        let skill = load_org_skill(ctx, organization_id, skill_id)?;
        if skill.skill_key != params.skill_key.trim() {
            return Err("existing skill key does not match the promotion skill_key".to_string());
        }
    }

    let promotion_key = format!("{organization_id}:{}", params.idempotency_key.trim());
    let payload_hash = promotion_payload_hash(
        version.id,
        params.skill_id,
        params.skill_key.trim(),
        params.skill_name.trim(),
        &params.manifest_json,
        &lineage_hash,
    );
    if let Some(existing) = ctx
        .db
        .ai_knowledge_skill_promotion()
        .promotion_key()
        .find(&promotion_key)
    {
        return if existing.payload_hash == payload_hash {
            Ok(())
        } else {
            Err("idempotency key is already bound to another promotion payload".to_string())
        };
    }

    let reviewers = require_current_independent_reviews(ctx, &entry, &version)?;
    let row = ctx
        .db
        .ai_knowledge_skill_promotion()
        .insert(AiKnowledgeSkillPromotion {
            id: 0,
            promotion_key,
            organization_id,
            company_id,
            knowledge_entry_id: entry.id,
            knowledge_version_id: version.id,
            knowledge_review_epoch: version.review_epoch,
            source_passage_ids: version.source_passage_ids.clone(),
            claim_ids: version.claim_ids.clone(),
            decision_ids: version.decision_ids.clone(),
            knowledge_reviewer_uids: reviewers,
            requested_skill_id: params.skill_id,
            skill_key: params.skill_key.trim().to_string(),
            skill_name: params.skill_name.trim().to_string(),
            manifest_json: params.manifest_json,
            lineage_hash,
            payload_hash,
            status: PROMOTION_PROPOSED.to_string(),
            certification_state: CERTIFICATION_NOT_REQUESTED.to_string(),
            skill_id: None,
            skill_version_id: None,
            proposed_by: ctx.sender(),
            proposed_at: ctx.timestamp,
            reviewed_by: None,
            reviewed_at: None,
            review_note: None,
            invalidated_at: None,
        });
    audit(ctx, &row, "CREATE");
    Ok(())
}

#[reducer]
pub fn review_ai_knowledge_skill_promotion(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    promotion_id: u64,
    params: ReviewAiKnowledgeSkillPromotionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "create")?;
    check_permission(ctx, organization_id, "ai_knowledge_review", "update")?;
    if !matches!(params.outcome.as_str(), "accepted" | "rejected") {
        return Err("outcome must be accepted or rejected".to_string());
    }
    require_opt_len("note", &params.note, MAX_NOTE_LEN)?;
    let mut row = load_promotion(ctx, organization_id, company_id, promotion_id)?;
    if row.status != PROMOTION_PROPOSED {
        return Err(format!("a {} promotion cannot be reviewed", row.status));
    }
    let version = load_version(ctx, organization_id, company_id, row.knowledge_version_id)?;
    let entry = load_entry(ctx, organization_id, company_id, version.entry_id)?;
    require_promotion_review_scope(ctx, &entry)?;
    if ctx.sender() == row.proposed_by
        || ctx.sender() == entry.owner_uid
        || ctx.sender() == version.create_uid
    {
        return Err(
            "promotion review requires an actor independent of the knowledge and promotion authors"
                .to_string(),
        );
    }

    row.reviewed_by = Some(ctx.sender());
    row.reviewed_at = Some(ctx.timestamp);
    row.review_note = params.note;
    if params.outcome == "rejected" {
        row.status = PROMOTION_REJECTED.to_string();
        ctx.db
            .ai_knowledge_skill_promotion()
            .id()
            .update(row.clone());
        audit(ctx, &row, "REVIEW");
        return Ok(());
    }

    require_promotable_knowledge(ctx, &version)?;
    require_current_independent_reviews(ctx, &entry, &version)?;
    if row.knowledge_review_epoch != version.review_epoch
        || row.lineage_hash != knowledge_lineage_hash(&version)
    {
        return Err("knowledge lineage changed after promotion was proposed".to_string());
    }
    let manifest = validate_manifest(&row.manifest_json, &row.skill_key)?;
    let skill = match row.requested_skill_id {
        Some(id) => load_org_skill(ctx, organization_id, id)?,
        None => create_candidate_skill(ctx, &row, &manifest)?,
    };
    let version_key = format!("{}:{}:{}", organization_id, skill.id, manifest.version);
    if ctx
        .db
        .ai_skill_version()
        .version_key()
        .find(&version_key)
        .is_some()
    {
        return Err("skill version already exists".to_string());
    }
    let skill_version = ctx.db.ai_skill_version().insert(AiSkillVersion {
        id: 0,
        version_key,
        organization_id,
        skill_id: skill.id,
        skill_key: skill.skill_key.clone(),
        version: manifest.version,
        manifest_schema_version: manifest.schema_version,
        manifest_json: row.manifest_json.clone(),
        source_hash: manifest.source_hash,
        risk: manifest.risk,
        max_steps: manifest.max_steps,
        max_tool_calls: manifest.max_tool_calls,
        permissions: manifest.permissions,
        resources: manifest.resources,
        output_types: manifest.output_types,
        reviewed_by: ctx.sender(),
        reviewed_at: ctx.timestamp,
        review_notes: row.review_note.clone(),
        created_by: row.proposed_by,
        created_at: row.proposed_at,
        metadata: Some(promotion_metadata(&row)),
    });
    row.status = PROMOTION_ACCEPTED.to_string();
    row.skill_id = Some(skill.id);
    row.skill_version_id = Some(skill_version.id);
    ctx.db
        .ai_knowledge_skill_promotion()
        .id()
        .update(row.clone());
    audit(ctx, &row, "REVIEW");
    Ok(())
}

fn require_promotable_knowledge(
    ctx: &ReducerContext,
    version: &AiKnowledgeEntryVersion,
) -> Result<(), String> {
    if version.review_state != STATE_APPROVED {
        return Err("only approved knowledge can be promoted".to_string());
    }
    let latest = ctx
        .db
        .ai_knowledge_entry_version()
        .ai_knowledge_entry_version_by_entry()
        .filter(&version.entry_id)
        .max_by_key(|candidate| candidate.version)
        .ok_or("knowledge entry has no version")?;
    if latest.id != version.id {
        return Err("only the latest knowledge version can be promoted".to_string());
    }
    require_dependencies_usable(
        ctx,
        version.organization_id,
        DependentKind::KnowledgeVersion,
        version.id,
    )
}

fn require_promotion_review_scope(
    ctx: &ReducerContext,
    entry: &crate::ai::knowledge_entry::AiKnowledgeEntry,
) -> Result<(), String> {
    match entry.share_scope.as_str() {
        // The owner explicitly proposed crossing the personal boundary. The
        // reviewer gains no general retrieval access to the personal entry.
        "personal" | "organization" => Ok(()),
        "team" => require_team_membership(
            ctx,
            entry.organization_id,
            entry.company_id,
            entry
                .team_ref
                .as_deref()
                .ok_or("team-scoped knowledge has no team")?,
            ctx.sender(),
        ),
        _ => Err("knowledge entry has an invalid share scope".to_string()),
    }
}

fn require_current_independent_reviews(
    ctx: &ReducerContext,
    entry: &crate::ai::knowledge_entry::AiKnowledgeEntry,
    version: &AiKnowledgeEntryVersion,
) -> Result<Vec<Identity>, String> {
    let mut reviews = ctx
        .db
        .ai_knowledge_review()
        .ai_knowledge_review_by_version()
        .filter(&version.id)
        .filter(|review| review.review_epoch == version.review_epoch)
        .collect::<Vec<_>>();
    reviews.sort_by_key(|review| review.id);
    let mut latest = Vec::new();
    for review in reviews {
        latest.retain(|prior: &crate::ai::knowledge_entry::AiKnowledgeReview| {
            prior.review_kind != review.review_kind
        });
        latest.push(review);
    }
    let mut reviewers = Vec::new();
    for required in required_review_kinds(&entry.kind) {
        let review = latest
            .iter()
            .find(|review| review.review_kind == *required)
            .ok_or_else(|| format!("knowledge is missing current {required} review"))?;
        if review.outcome != "accepted" {
            return Err(format!(
                "knowledge current {required} review is not accepted"
            ));
        }
        if review.reviewer_uid == entry.owner_uid || review.reviewer_uid == version.create_uid {
            return Err(
                "knowledge has a current review by its owner or version author".to_string(),
            );
        }
        reviewers.push(review.reviewer_uid);
    }
    reviewers.sort_by_key(|identity| identity.to_hex().to_string());
    reviewers.dedup();
    Ok(reviewers)
}

fn create_candidate_skill(
    ctx: &ReducerContext,
    row: &AiKnowledgeSkillPromotion,
    manifest: &crate::ai::skill_registry::ValidatedManifest,
) -> Result<AiSkill, String> {
    if ctx
        .db
        .ai_skill()
        .ai_skill_by_org_key()
        .filter((&row.organization_id, &row.skill_key))
        .next()
        .is_some()
    {
        return Err(
            "skill_key already exists; bind the promotion to that skill explicitly".to_string(),
        );
    }
    let knowledge = ctx
        .db
        .ai_knowledge_entry_version()
        .id()
        .find(&row.knowledge_version_id)
        .ok_or("knowledge version not found")?;
    Ok(ctx.db.ai_skill().insert(AiSkill {
        id: 0,
        organization_id: row.organization_id,
        skill_key: row.skill_key.clone(),
        name: row.skill_name.clone(),
        description: Some(knowledge.title),
        category: "knowledge_recipe".to_string(),
        prompt_template: knowledge.body,
        required_tools: Vec::new(),
        optional_tools: Vec::new(),
        default_max_steps: manifest.max_steps,
        default_max_tool_calls: manifest.max_tool_calls,
        output_schema: None,
        config_schema: None,
        dataset_specs: None,
        allowed_action_drafts: Vec::new(),
        is_active: true,
        is_system: false,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: Some(promotion_metadata(row)),
    }))
}

fn load_org_skill(ctx: &ReducerContext, organization_id: u64, id: u64) -> Result<AiSkill, String> {
    let skill = ctx.db.ai_skill().id().find(&id).ok_or("skill not found")?;
    if skill.organization_id != organization_id || skill.is_system {
        return Err("promotion target must be an organization-owned skill".to_string());
    }
    Ok(skill)
}

fn load_promotion(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    id: u64,
) -> Result<AiKnowledgeSkillPromotion, String> {
    let row = ctx
        .db
        .ai_knowledge_skill_promotion()
        .id()
        .find(&id)
        .ok_or("knowledge skill promotion not found")?;
    if row.organization_id != organization_id || row.company_id != company_id {
        return Err("knowledge skill promotion is outside this organization/company".to_string());
    }
    Ok(row)
}

pub(crate) fn invalidate_promotions_for_knowledge(ctx: &ReducerContext, knowledge_version_id: u64) {
    let rows = ctx
        .db
        .ai_knowledge_skill_promotion()
        .ai_knowledge_skill_promotion_by_knowledge()
        .filter(&knowledge_version_id)
        .filter(|row| row.status == PROMOTION_PROPOSED || row.status == PROMOTION_ACCEPTED)
        .collect::<Vec<_>>();
    for row in rows {
        if let Some(skill_version_id) = row.skill_version_id {
            let releases = ctx
                .db
                .ai_skill_release()
                .ai_skill_release_registry_by_version()
                .filter(&skill_version_id)
                .filter(|release| release.is_active)
                .collect::<Vec<AiSkillRelease>>();
            for release in releases {
                ctx.db.ai_skill_release().id().update(AiSkillRelease {
                    is_active: false,
                    ..release
                });
            }
        }
        ctx.db
            .ai_knowledge_skill_promotion()
            .id()
            .update(AiKnowledgeSkillPromotion {
                status: PROMOTION_INVALIDATED.to_string(),
                certification_state: CERTIFICATION_INVALIDATED.to_string(),
                invalidated_at: Some(ctx.timestamp),
                ..row
            });
    }
}

pub(crate) fn set_promotion_certification_state(
    ctx: &ReducerContext,
    skill_version_id: u64,
    state: &str,
) {
    let rows = ctx
        .db
        .ai_knowledge_skill_promotion()
        .iter()
        .filter(|row| row.skill_version_id == Some(skill_version_id))
        .filter(|row| row.status == PROMOTION_ACCEPTED)
        .collect::<Vec<_>>();
    for row in rows {
        ctx.db
            .ai_knowledge_skill_promotion()
            .id()
            .update(AiKnowledgeSkillPromotion {
                certification_state: state.to_string(),
                ..row
            });
    }
}

pub(crate) fn require_skill_version_promotion_valid(
    ctx: &ReducerContext,
    skill_version_id: u64,
) -> Result<(), String> {
    for row in ctx
        .db
        .ai_knowledge_skill_promotion()
        .iter()
        .filter(|row| row.skill_version_id == Some(skill_version_id))
    {
        if !promotion_status_allows_runtime(&row.status) {
            return Err("knowledge-backed skill promotion is no longer valid".to_string());
        }
        let version = load_version(
            ctx,
            row.organization_id,
            row.company_id,
            row.knowledge_version_id,
        )?;
        let entry = load_entry(ctx, row.organization_id, row.company_id, version.entry_id)?;
        require_promotable_knowledge(ctx, &version)?;
        require_current_independent_reviews(ctx, &entry, &version)?;
        if version.review_epoch != row.knowledge_review_epoch
            || knowledge_lineage_hash(&version) != row.lineage_hash
        {
            return Err("knowledge-backed skill lineage has changed".to_string());
        }
    }
    Ok(())
}

fn knowledge_lineage_hash(version: &AiKnowledgeEntryVersion) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"lumiere.ai.knowledge-promotion.v1");
    for part in [
        version.organization_id.to_string(),
        version.company_id.to_string(),
        version.entry_id.to_string(),
        version.id.to_string(),
        version.review_epoch.to_string(),
        version.title.clone(),
        version.body.clone(),
    ] {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part.as_bytes());
    }
    for ids in [
        &version.source_passage_ids,
        &version.claim_ids,
        &version.decision_ids,
    ] {
        hasher.update((ids.len() as u64).to_be_bytes());
        for id in ids {
            hasher.update(id.to_be_bytes());
        }
    }
    format!("{:x}", hasher.finalize())
}

fn promotion_payload_hash(
    version_id: u64,
    skill_id: Option<u64>,
    skill_key: &str,
    skill_name: &str,
    manifest_json: &str,
    lineage_hash: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"lumiere.ai.knowledge-promotion.payload.v1");
    hasher.update(version_id.to_be_bytes());
    hasher.update(skill_id.unwrap_or(0).to_be_bytes());
    for value in [skill_key, skill_name, manifest_json, lineage_hash] {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn promotion_metadata(row: &AiKnowledgeSkillPromotion) -> String {
    serde_json::json!({
        "knowledge_promotion_id": row.id,
        "knowledge_entry_id": row.knowledge_entry_id,
        "knowledge_version_id": row.knowledge_version_id,
        "knowledge_review_epoch": row.knowledge_review_epoch,
        "lineage_hash": row.lineage_hash,
        "source_passage_ids": row.source_passage_ids,
        "claim_ids": row.claim_ids,
        "decision_ids": row.decision_ids,
    })
    .to_string()
}

fn audit(ctx: &ReducerContext, row: &AiKnowledgeSkillPromotion, action: &'static str) {
    write_audit_log_v2(
        ctx,
        row.organization_id,
        AuditLogParams {
            company_id: Some(row.company_id),
            table_name: "ai_knowledge_skill_promotion",
            record_id: row.id,
            action,
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "status": row.status,
                    "certification_state": row.certification_state,
                    "knowledge_version_id": row.knowledge_version_id,
                    "skill_version_id": row.skill_version_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string(), "certification_state".to_string()],
            metadata: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lineage_hash_changes_with_evidence_or_epoch() {
        let identity = Identity::from_byte_array([1; 32]);
        let timestamp = Timestamp::from_micros_since_unix_epoch(1);
        let base = AiKnowledgeEntryVersion {
            id: 3,
            organization_id: 1,
            company_id: 2,
            entry_id: 4,
            version: 1,
            title: "title".into(),
            body: "body".into(),
            applicability: vec![],
            source_passage_ids: vec![5],
            claim_ids: vec![6],
            decision_ids: vec![7],
            related_entry_ids: vec![],
            nomination_signal: None,
            review_state: STATE_APPROVED.into(),
            review_epoch: 0,
            supersedes_version_id: None,
            create_uid: identity,
            create_date: timestamp,
            write_uid: identity,
            write_date: timestamp,
        };
        let mut changed = base.clone();
        changed.review_epoch = 1;
        assert_ne!(
            knowledge_lineage_hash(&base),
            knowledge_lineage_hash(&changed)
        );
        changed = base.clone();
        changed.claim_ids.push(8);
        assert_ne!(
            knowledge_lineage_hash(&base),
            knowledge_lineage_hash(&changed)
        );
    }

    #[test]
    fn idempotency_hash_binds_every_candidate_input() {
        let base = promotion_payload_hash(1, None, "key", "name", "{}", "abc");
        assert_eq!(
            base,
            promotion_payload_hash(1, None, "key", "name", "{}", "abc")
        );
        assert_ne!(
            base,
            promotion_payload_hash(2, None, "key", "name", "{}", "abc")
        );
        assert_ne!(
            base,
            promotion_payload_hash(1, Some(9), "key", "name", "{}", "abc")
        );
    }

    #[test]
    fn only_accepted_non_invalidated_promotions_allow_runtime() {
        assert!(promotion_status_allows_runtime(PROMOTION_ACCEPTED));
        for blocked in [
            PROMOTION_PROPOSED,
            PROMOTION_REJECTED,
            PROMOTION_INVALIDATED,
        ] {
            assert!(!promotion_status_allows_runtime(blocked), "{blocked}");
        }
    }
}
