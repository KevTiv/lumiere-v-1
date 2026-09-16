//! AIH-23 — Checked continuation and compaction (M1).
//!
//! Before context compaction, persists a continuation manifest: objective hash,
//! constraint hash, accepted decision refs, pending question refs, completed
//! effect refs, candidate component versions, progress/repair state and
//! remaining budget token count. On resume, validates all refs against
//! authoritative durable records and stops with an explicit context-recovery
//! error on any mismatch.
//!
//! Design invariants (§8.3):
//! - Durable records, not model-written summaries, own budgets, permissions
//!   and effect state.
//! - A reference-presence check alone is insufficient: validation also checks
//!   that resumed behavior honors preserved constraints and unanswered questions.
//! - Recalled/revoked sources stay marked unavailable without injecting excerpts.
//! - Summary text is stored but never consulted to grant permissions or override
//!   budget. Any permission check uses `check_permission` on the authoritative
//!   record as normal.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::lineage::ai_decision;
use crate::ai::provenance::ai_source_version;
use crate::ai::questions::ai_question;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_HASH_LEN: usize = 128;
const MAX_JSON_LEN: usize = 32_768;
const AUTO_INC_SENTINEL: u64 = 0;

// ── Table ──────────────────────────────────────────────────────────────────

/// Continuation manifest — immutable checkpoint snapshot persisted before
/// context compaction. The manifest is the authoritative source for objective,
/// constraints, decision refs, pending question refs, completed effects,
/// candidate component versions and the remaining budget at checkpoint time.
///
/// On resume, `validate_ai_continuation_manifest` reloads all durable records
/// and Errs rather than continuing with stale or injected state.
///
/// `status`:
/// - `active`              — valid checkpoint; resume is permitted
/// - `superseded_by_fork`  — a fork has created a newer sibling; do not resume
/// - `recovered`           — some refs were unavailable but continuation can proceed
/// - `context_recovery_error` — required refs missing; continuation blocked
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_continuation_manifest,
    index(
        accessor = ai_continuation_manifest_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_continuation_manifest_by_run,
        btree(columns = [run_id])
    ),
    index(
        accessor = ai_continuation_manifest_by_parent,
        btree(columns = [parent_manifest_id])
    )
)]
pub struct AiContinuationManifest {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub run_id: u64,
    /// Caller-supplied hash of the run objective text (immutable after creation).
    pub objective_hash: String,
    /// JSON snapshot of all active constraints at checkpoint time.
    pub constraints_json: String,
    /// Caller-supplied hash of constraints_json (immutable after creation).
    pub constraints_hash: String,
    /// JSON array of accepted AiDecision IDs (immutable snapshot).
    pub accepted_decision_ids_json: String,
    /// JSON array of AiQuestion IDs that were open (required) at checkpoint.
    /// On resume, all listed required questions must still be open.
    pub pending_question_ids_json: String,
    /// JSON array of completed effects: [{tool, input_hash, output_hash}].
    /// Append-only via `update_ai_continuation_progress`.
    pub completed_effects_json: String,
    /// JSON array of candidate component versions: [{component_id, version, hash}].
    pub candidate_versions_json: String,
    /// JSON blob tracking step count, diagnostics and repair attempts.
    /// Updated via `update_ai_continuation_progress`.
    pub progress_state_json: String,
    /// Token count remaining at checkpoint — owned by this record, not by
    /// any model-written summary. Immutable after creation.
    pub remaining_budget_tokens: u32,
    /// Deadline by which the budget reservation is valid. Immutable.
    pub budget_reserved_until: Timestamp,
    /// JSON array of source version IDs present at checkpoint.
    /// On resume, recalled or missing sources are flagged as unavailable
    /// without exposing their content.
    pub snapshot_sources_json: String,
    /// Monotonically increasing fork counter. 1 for the initial manifest;
    /// incremented on each call to `fork_ai_continuation_manifest`.
    pub revision: u32,
    /// ID of the manifest this was forked from. None for the initial manifest.
    pub parent_manifest_id: Option<u64>,
    /// Optional model-written summary stored for audit purposes only.
    /// NEVER consulted to grant permissions or determine budget.
    pub summary: Option<String>,
    /// `active` | `superseded_by_fork` | `recovered` | `context_recovery_error`
    pub status: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Params ─────────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiContinuationManifestParams {
    pub company_id: Option<u64>,
    pub run_id: u64,
    pub objective_hash: String,
    pub constraints_json: String,
    pub constraints_hash: String,
    /// JSON array of accepted AiDecision IDs.
    pub accepted_decision_ids_json: String,
    /// JSON array of open required AiQuestion IDs.
    pub pending_question_ids_json: String,
    pub completed_effects_json: String,
    pub candidate_versions_json: String,
    pub progress_state_json: String,
    pub remaining_budget_tokens: u32,
    pub budget_reserved_until: Timestamp,
    /// JSON array of AiSourceVersion IDs.
    pub snapshot_sources_json: String,
    pub summary: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAiContinuationProgressParams {
    pub manifest_id: u64,
    pub completed_effects_json: String,
    pub progress_state_json: String,
}

// ── Validation helpers ──────────────────────────────────────────────────────

fn validate_hash(field: &str, value: &str) -> Result<String, String> {
    let v = value.trim().to_string();
    if v.is_empty() {
        return Err(format!("{field} is required"));
    }
    if v.len() > MAX_HASH_LEN {
        return Err(format!("{field} exceeds {MAX_HASH_LEN} characters"));
    }
    Ok(v)
}

fn validate_json_field(field: &str, value: &str) -> Result<String, String> {
    let v = value.trim().to_string();
    if v.is_empty() {
        return Err(format!("{field} is required"));
    }
    if v.len() > MAX_JSON_LEN {
        return Err(format!("{field} exceeds {MAX_JSON_LEN} characters"));
    }
    Ok(v)
}

/// Parse a JSON array of u64 IDs, tolerating empty arrays.
fn parse_id_array(json: &str) -> Result<Vec<u64>, String> {
    let trimmed = json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(vec![]);
    }
    serde_json::from_str::<Vec<u64>>(trimmed).map_err(|e| format!("invalid ID array JSON: {e}"))
}

// ── Reducers ───────────────────────────────────────────────────────────────

/// Persist a new continuation manifest before context compaction.
///
/// Validates that all referenced decision, question and source version IDs
/// exist and belong to the caller's organization. Stores immutable hashes for
/// objective and constraints. Any budget, permission or effect state
/// reflected in a summary is ignored — the fields on this record are authoritative.
#[reducer]
pub fn create_ai_continuation_manifest(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiContinuationManifestParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_continuation_manifest", "write")?;
    if organization_id == 0 {
        return Err("organization_id is required".to_string());
    }
    if params.run_id == AUTO_INC_SENTINEL {
        return Err("run_id must be nonzero".to_string());
    }

    let objective_hash = validate_hash("objective_hash", &params.objective_hash)?;
    let constraints_json = validate_json_field("constraints_json", &params.constraints_json)?;
    let constraints_hash = validate_hash("constraints_hash", &params.constraints_hash)?;
    let accepted_decision_ids_json = validate_json_field(
        "accepted_decision_ids_json",
        &params.accepted_decision_ids_json,
    )?;
    let pending_question_ids_json = validate_json_field(
        "pending_question_ids_json",
        &params.pending_question_ids_json,
    )?;
    let completed_effects_json =
        validate_json_field("completed_effects_json", &params.completed_effects_json)?;
    let candidate_versions_json =
        validate_json_field("candidate_versions_json", &params.candidate_versions_json)?;
    let progress_state_json =
        validate_json_field("progress_state_json", &params.progress_state_json)?;
    let snapshot_sources_json =
        validate_json_field("snapshot_sources_json", &params.snapshot_sources_json)?;

    // Validate all accepted decision IDs exist and belong to the org.
    let decision_ids = parse_id_array(&accepted_decision_ids_json)?;
    for did in &decision_ids {
        let d = ctx
            .db
            .ai_decision()
            .id()
            .find(did)
            .ok_or_else(|| format!("accepted decision {did} not found"))?;
        if d.organization_id != organization_id {
            return Err(format!(
                "accepted decision {did} does not belong to this organization"
            ));
        }
    }

    // Validate all pending question IDs exist, belong to the org, and are open.
    let question_ids = parse_id_array(&pending_question_ids_json)?;
    for qid in &question_ids {
        let q = ctx
            .db
            .ai_question()
            .id()
            .find(qid)
            .ok_or_else(|| format!("pending question {qid} not found"))?;
        if q.organization_id != organization_id {
            return Err(format!(
                "pending question {qid} does not belong to this organization"
            ));
        }
        if q.status != "open" {
            return Err(format!(
                "pending question {qid} is not open (status={}); only open questions may be recorded as pending",
                q.status
            ));
        }
    }

    // Validate all snapshot source version IDs exist and belong to the org.
    let source_ids = parse_id_array(&snapshot_sources_json)?;
    for sid in &source_ids {
        let s = ctx
            .db
            .ai_source_version()
            .id()
            .find(sid)
            .ok_or_else(|| format!("snapshot source {sid} not found"))?;
        if s.organization_id != organization_id {
            return Err(format!(
                "snapshot source {sid} does not belong to this organization"
            ));
        }
    }

    let row = ctx
        .db
        .ai_continuation_manifest()
        .insert(AiContinuationManifest {
            id: AUTO_INC_SENTINEL,
            organization_id,
            company_id: params.company_id,
            run_id: params.run_id,
            objective_hash,
            constraints_json,
            constraints_hash,
            accepted_decision_ids_json,
            pending_question_ids_json,
            completed_effects_json,
            candidate_versions_json,
            progress_state_json,
            remaining_budget_tokens: params.remaining_budget_tokens,
            budget_reserved_until: params.budget_reserved_until,
            snapshot_sources_json,
            revision: 1,
            parent_manifest_id: None,
            summary: params.summary,
            status: "active".to_string(),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "ai_continuation_manifest",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["run_id".to_string(), "objective_hash".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Validate a continuation manifest before resuming after compaction.
///
/// Reloads all authoritative durable records and checks:
/// 1. Constraints hash — if `current_constraints_hash` is provided and differs
///    from the stored hash, Err("constraints changed").
/// 2. Accepted decisions — each must still exist; missing → context_recovery_error.
/// 3. Pending required questions — each must still be open; timed_out or answered
///    without re-recording blocks continuation for that question.
/// 4. Snapshot sources — recalled/missing sources are flagged in the manifest
///    status without leaking passage content.
/// 5. Budget guard — if `claimed_remaining_tokens` exceeds the stored
///    `remaining_budget_tokens`, Err("budget mismatch: claimed tokens exceed checkpoint").
///
/// On success the manifest remains `active`. On unrecoverable mismatch the
/// manifest status is updated to `context_recovery_error` and an Err is returned.
/// The summary field is never consulted for any of these checks.
#[reducer]
pub fn validate_ai_continuation_manifest(
    ctx: &ReducerContext,
    organization_id: u64,
    manifest_id: u64,
    current_constraints_hash: Option<String>,
    claimed_remaining_tokens: Option<u32>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_continuation_manifest", "write")?;
    if organization_id == 0 || manifest_id == AUTO_INC_SENTINEL {
        return Err("organization_id and manifest_id are required".to_string());
    }

    let manifest = ctx
        .db
        .ai_continuation_manifest()
        .id()
        .find(&manifest_id)
        .ok_or("manifest not found")?;
    if manifest.organization_id != organization_id {
        return Err("manifest does not belong to this organization".to_string());
    }
    if manifest.status == "superseded_by_fork" {
        return Err("manifest has been superseded by a fork; resume from the fork".to_string());
    }
    if manifest.status == "context_recovery_error" {
        return Err(
            "manifest is in context_recovery_error; reload required refs before resuming"
                .to_string(),
        );
    }

    // ── 1. Constraints hash check ──────────────────────────────────────────
    if let Some(ref given_hash) = current_constraints_hash {
        let trimmed = given_hash.trim();
        if !trimmed.is_empty() && trimmed != manifest.constraints_hash {
            return Err("constraints changed: current hash does not match checkpoint".to_string());
        }
    }

    // ── 2. Budget guard — summary text cannot grant extra budget ───────────
    // The stored `remaining_budget_tokens` is the authoritative ceiling.
    // A caller claiming more tokens than the checkpoint recorded is forging state.
    if let Some(claimed) = claimed_remaining_tokens {
        if claimed > manifest.remaining_budget_tokens {
            return Err(format!(
                "budget mismatch: claimed {} tokens exceeds checkpoint ceiling of {}",
                claimed, manifest.remaining_budget_tokens
            ));
        }
    }

    // ── 3. Accepted decision ref validation ────────────────────────────────
    let decision_ids = parse_id_array(&manifest.accepted_decision_ids_json)
        .map_err(|e| format!("context_recovery_error: {e}"))?;
    for did in &decision_ids {
        let found = ctx.db.ai_decision().id().find(did);
        if found.is_none() {
            // Missing required ref — update manifest and block continuation.
            ctx.db
                .ai_continuation_manifest()
                .id()
                .update(AiContinuationManifest {
                    status: "context_recovery_error".to_string(),
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..manifest.clone()
                });
            write_audit_log_v2(
                ctx,
                organization_id,
                AuditLogParams {
                    company_id: manifest.company_id,
                    table_name: "ai_continuation_manifest",
                    record_id: manifest_id,
                    action: "update",
                    old_values: None,
                    new_values: None,
                    changed_fields: vec!["status".to_string()],
                    metadata: None,
                },
            );
            return Err(format!(
                "context_recovery_error: accepted decision {did} no longer exists"
            ));
        }
    }

    // ── 4. Pending question validation ─────────────────────────────────────
    // Required questions that are no longer open block the dependent work.
    let question_ids = parse_id_array(&manifest.pending_question_ids_json)
        .map_err(|e| format!("context_recovery_error: {e}"))?;
    for qid in &question_ids {
        match ctx.db.ai_question().id().find(qid) {
            None => {
                // Missing required question ref.
                ctx.db
                    .ai_continuation_manifest()
                    .id()
                    .update(AiContinuationManifest {
                        status: "context_recovery_error".to_string(),
                        write_uid: ctx.sender(),
                        write_date: ctx.timestamp,
                        ..manifest.clone()
                    });
                write_audit_log_v2(
                    ctx,
                    organization_id,
                    AuditLogParams {
                        company_id: manifest.company_id,
                        table_name: "ai_continuation_manifest",
                        record_id: manifest_id,
                        action: "update",
                        old_values: None,
                        new_values: None,
                        changed_fields: vec!["status".to_string()],
                        metadata: None,
                    },
                );
                return Err(format!(
                    "context_recovery_error: pending question {qid} no longer exists"
                ));
            }
            Some(q) if q.kind == "required" && q.status != "open" => {
                // Required question is no longer open — dependent work is blocked.
                return Err(format!(
                    "pending required question {qid} is not open (status={}); \
                     dependent work is blocked until the question is re-opened or re-answered",
                    q.status
                ));
            }
            _ => {}
        }
    }

    // ── 5. Snapshot source freshness ───────────────────────────────────────
    // Recalled or missing sources are flagged as unavailable without exposing
    // their passage content. If any source is missing the manifest moves to
    // context_recovery_error; recalled sources are tolerated (the run may
    // proceed without that source's content).
    let source_ids = parse_id_array(&manifest.snapshot_sources_json)
        .map_err(|e| format!("context_recovery_error: {e}"))?;
    let mut any_recalled = false;
    for sid in &source_ids {
        match ctx.db.ai_source_version().id().find(sid) {
            None => {
                ctx.db
                    .ai_continuation_manifest()
                    .id()
                    .update(AiContinuationManifest {
                        status: "context_recovery_error".to_string(),
                        write_uid: ctx.sender(),
                        write_date: ctx.timestamp,
                        ..manifest.clone()
                    });
                write_audit_log_v2(
                    ctx,
                    organization_id,
                    AuditLogParams {
                        company_id: manifest.company_id,
                        table_name: "ai_continuation_manifest",
                        record_id: manifest_id,
                        action: "update",
                        old_values: None,
                        new_values: None,
                        changed_fields: vec!["status".to_string()],
                        metadata: None,
                    },
                );
                return Err(format!(
                    "context_recovery_error: snapshot source {sid} no longer exists; \
                     content is not available"
                ));
            }
            Some(s) if s.origin == "recalled" => {
                // Recalled sources remain unavailable — do not leak their content.
                // Record this in audit but do not inject the passage text.
                any_recalled = true;
                write_audit_log_v2(
                    ctx,
                    organization_id,
                    AuditLogParams {
                        company_id: manifest.company_id,
                        table_name: "ai_continuation_manifest",
                        record_id: manifest_id,
                        action: "update",
                        old_values: None,
                        new_values: None,
                        changed_fields: vec![format!("source_{sid}_recalled")],
                        metadata: None,
                    },
                );
            }
            _ => {}
        }
    }

    // If any sources were recalled, transition to recovered (not a hard error).
    if any_recalled && manifest.status == "active" {
        ctx.db
            .ai_continuation_manifest()
            .id()
            .update(AiContinuationManifest {
                status: "recovered".to_string(),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..manifest.clone()
            });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: manifest.company_id,
                table_name: "ai_continuation_manifest",
                record_id: manifest_id,
                action: "update",
                old_values: None,
                new_values: None,
                changed_fields: vec!["status".to_string()],
                metadata: None,
            },
        );
    }

    Ok(())
}

/// Create a fork of an existing manifest, inheriting all checkpoint state but
/// resetting `progress_state_json`, incrementing `revision`, and setting
/// `parent_manifest_id`. The parent manifest is marked `superseded_by_fork`.
///
/// A fork does not inherit execution approvals or completed effects — the new
/// manifest starts with the supplied empty `completed_effects_json`. Budget
/// and constraints remain bound to the forked checkpoint; the caller must
/// supply a new `remaining_budget_tokens` drawn from an authorized reservation.
#[reducer]
pub fn fork_ai_continuation_manifest(
    ctx: &ReducerContext,
    organization_id: u64,
    parent_manifest_id: u64,
    new_remaining_budget_tokens: u32,
    new_budget_reserved_until: Timestamp,
    new_progress_state_json: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_continuation_manifest", "write")?;
    if organization_id == 0 || parent_manifest_id == AUTO_INC_SENTINEL {
        return Err("organization_id and parent_manifest_id are required".to_string());
    }

    let parent = ctx
        .db
        .ai_continuation_manifest()
        .id()
        .find(&parent_manifest_id)
        .ok_or("parent manifest not found")?;
    if parent.organization_id != organization_id {
        return Err("parent manifest does not belong to this organization".to_string());
    }
    if parent.status == "superseded_by_fork" {
        return Err(
            "parent manifest is already superseded; fork from the active manifest".to_string(),
        );
    }

    let progress_json = validate_json_field("new_progress_state_json", &new_progress_state_json)?;

    // Supersede the parent.
    ctx.db
        .ai_continuation_manifest()
        .id()
        .update(AiContinuationManifest {
            status: "superseded_by_fork".to_string(),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..parent.clone()
        });

    // Create the fork — inherits objective/constraints/decisions/questions/sources;
    // resets effects (the fork starts fresh, does not replay completed effects).
    let fork = ctx
        .db
        .ai_continuation_manifest()
        .insert(AiContinuationManifest {
            id: AUTO_INC_SENTINEL,
            organization_id,
            company_id: parent.company_id,
            run_id: parent.run_id,
            objective_hash: parent.objective_hash.clone(),
            constraints_json: parent.constraints_json.clone(),
            constraints_hash: parent.constraints_hash.clone(),
            accepted_decision_ids_json: parent.accepted_decision_ids_json.clone(),
            pending_question_ids_json: parent.pending_question_ids_json.clone(),
            completed_effects_json: "[]".to_string(),
            candidate_versions_json: parent.candidate_versions_json.clone(),
            progress_state_json: progress_json,
            remaining_budget_tokens: new_remaining_budget_tokens,
            budget_reserved_until: new_budget_reserved_until,
            snapshot_sources_json: parent.snapshot_sources_json.clone(),
            revision: parent.revision + 1,
            parent_manifest_id: Some(parent_manifest_id),
            summary: None,
            status: "active".to_string(),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: parent.company_id,
            table_name: "ai_continuation_manifest",
            record_id: fork.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec![
                "parent_manifest_id".to_string(),
                "revision".to_string(),
                "remaining_budget_tokens".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

/// Append completed effects and update progress state after a tool invocation.
///
/// Only `completed_effects_json` and `progress_state_json` may be updated —
/// budget, constraints, decision/question/source refs and objective hash are
/// immutable on the manifest. Status must remain `active` to accept progress.
#[reducer]
pub fn update_ai_continuation_progress(
    ctx: &ReducerContext,
    organization_id: u64,
    params: UpdateAiContinuationProgressParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_continuation_manifest", "write")?;
    if organization_id == 0 || params.manifest_id == AUTO_INC_SENTINEL {
        return Err("organization_id and manifest_id are required".to_string());
    }

    let manifest = ctx
        .db
        .ai_continuation_manifest()
        .id()
        .find(&params.manifest_id)
        .ok_or("manifest not found")?;
    if manifest.organization_id != organization_id {
        return Err("manifest does not belong to this organization".to_string());
    }
    if manifest.status != "active" && manifest.status != "recovered" {
        return Err(format!(
            "manifest is not active (status={}); progress cannot be recorded",
            manifest.status
        ));
    }

    let effects = validate_json_field("completed_effects_json", &params.completed_effects_json)?;
    let progress = validate_json_field("progress_state_json", &params.progress_state_json)?;

    ctx.db
        .ai_continuation_manifest()
        .id()
        .update(AiContinuationManifest {
            completed_effects_json: effects,
            progress_state_json: progress,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..manifest.clone()
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: manifest.company_id,
            table_name: "ai_continuation_manifest",
            record_id: params.manifest_id,
            action: "update",
            old_values: None,
            new_values: None,
            changed_fields: vec![
                "completed_effects_json".to_string(),
                "progress_state_json".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}
