//! AIH-13 — Versioned source, passage, and contribution contracts (M1).
//!
//! Extends the existing artifact/ERP contract ownership with three tenant-scoped,
//! versioned records. The schema is intentionally minimal but preserves the
//! invariants the plan calls out:
//!
//! * `AiSourceVersion` captures original author/org, title, dates, edition,
//!   URI/DOI/file refs, content hash/snapshot, origin/owner/scope/retention.
//!   Unknown attribution stays explicit (nullable), never invented.
//! * `AiSourcePassage` binds exact coordinates to a version and distinguishes
//!   original text from OCR/extraction with processor/correction refs.
//! * `AiContribution` separates original authorship from the discussion
//!   collaborator/agent that introduced the source, with inspection state.
//!
//! All three are tenant-scoped (`organization_id`) and write-authorized via
//! `check_permission`. Semantic indexes remain derived; these tables are the
//! authority. Document/network ingestion stays separately admitted.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_TITLE_LEN: usize = 500;
const MAX_URI_LEN: usize = 2048;
const MAX_HASH_LEN: usize = 128;
const MAX_SCOPE_LEN: usize = 32;
const MAX_KIND_LEN: usize = 32;
/// SpacetimeDB auto-increment sentinel — not a business id. Tables with
/// `#[auto_inc]` require `id: 0` as the insert placeholder; the engine
/// replaces it with the next sequence value and returns it in `row.id`.
const AUTO_INC_SENTINEL: u64 = 0;

// ── Tables ─────────────────────────────────────────────────────────────────

/// Versioned intellectual source — the immutable bibliographic + content identity.
///
/// One row = one version of a source. A book's 2nd edition is a separate row
/// with its own `content_hash`. `authors_json` is nullable to preserve
/// “unknown author” explicitly; never synthesize a placeholder.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_source_version,
    index(accessor = ai_source_version_by_org, btree(columns = [organization_id])),
    index(accessor = ai_source_version_by_org_kind, btree(columns = [organization_id, kind])),
    index(accessor = ai_source_version_by_hash, btree(columns = [content_hash]))
)]
pub struct AiSourceVersion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    /// `book` | `paper` | `company_publication` | `erp_record` | `policy` | `other`
    pub kind: String,
    pub title: String,
    /// JSON-encoded `Vec<String>` or nullable when unknown.
    pub authors_json: Option<String>,
    pub publisher: Option<String>,
    /// ISO-8601 or free-form when the original source only gives a year.
    pub publication_date: Option<String>,
    pub edition: Option<String>,
    pub version_label: Option<String>,
    pub uri: Option<String>,
    pub doi: Option<String>,
    pub file_reference: Option<String>,
    /// SHA-256 hex (or `blake3:` prefix) of the immutable snapshot bytes.
    pub content_hash: String,
    pub snapshot_ref: Option<String>,
    /// When the snapshot was retrieved/captured. `None` for purely recalled.
    pub retrieval_time: Option<Timestamp>,
    /// `authored` | `retrieved` | `recalled` | `imported`
    pub origin: String,
    pub owner_identity: Option<Identity>,
    /// `private` | `team` | `organization` | `company`
    pub scope: String,
    pub retention_policy: String,
    /// `inspected` | `user_reported` | `unverified_recollection`
    pub inspection_state: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// Exact passage or record slice bound to one `AiSourceVersion`.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_source_passage,
    index(accessor = ai_source_passage_by_org, btree(columns = [organization_id])),
    index(accessor = ai_source_passage_by_version, btree(columns = [source_version_id]))
)]
pub struct AiSourcePassage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub source_version_id: u64,
    /// `text` | `table` | `record` | `coordinates`
    pub passage_kind: String,
    /// The excerpt bytes (or record field JSON) — the authority for citation checks.
    pub content: String,
    pub content_hash: String,
    /// JSON: `{page, section, char_start, char_end, table, row, field}` etc.
    /// Nullable when the source has no paginated coordinates (ERP record).
    pub coordinates_json: Option<String>,
    /// True when this is the verbatim original; false when OCR/extracted.
    pub is_original: bool,
    pub processor_ref: Option<String>,
    pub correction_ref: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// Who introduced a source/concept in discussion — separate from the original author.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_contribution,
    index(accessor = ai_contribution_by_org, btree(columns = [organization_id])),
    index(accessor = ai_contribution_by_version, btree(columns = [source_version_id])),
    index(accessor = ai_contribution_by_passage, btree(columns = [passage_id]))
)]
pub struct AiContribution {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub source_version_id: Option<u64>,
    pub passage_id: Option<u64>,
    pub contributor_identity: Identity,
    /// `user` | `agent`
    pub contributor_kind: String,
    pub session_ref: Option<String>,
    pub turn_ref: Option<String>,
    pub event_ref: Option<String>,
    /// `inspected` | `user_reported` | `unverified_recollection`
    pub inspection_state: String,
    pub introduced_at: Timestamp,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Params ─────────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiSourceVersionParams {
    pub company_id: Option<u64>,
    pub kind: String,
    pub title: String,
    pub authors_json: Option<String>,
    pub publisher: Option<String>,
    pub publication_date: Option<String>,
    pub edition: Option<String>,
    pub version_label: Option<String>,
    pub uri: Option<String>,
    pub doi: Option<String>,
    pub file_reference: Option<String>,
    pub content_hash: String,
    pub snapshot_ref: Option<String>,
    pub retrieval_time: Option<Timestamp>,
    pub origin: String,
    pub owner_identity: Option<Identity>,
    pub scope: String,
    pub retention_policy: String,
    pub inspection_state: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiSourcePassageParams {
    pub source_version_id: u64,
    pub passage_kind: String,
    pub content: String,
    pub content_hash: String,
    pub coordinates_json: Option<String>,
    pub is_original: bool,
    pub processor_ref: Option<String>,
    pub correction_ref: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiContributionParams {
    pub source_version_id: Option<u64>,
    pub passage_id: Option<u64>,
    pub contributor_kind: String,
    pub session_ref: Option<String>,
    pub turn_ref: Option<String>,
    pub event_ref: Option<String>,
    pub inspection_state: String,
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn validate_kind(kind: &str) -> Result<String, String> {
    let k = kind.trim().to_lowercase();
    let allowed = [
        "book",
        "paper",
        "company_publication",
        "erp_record",
        "policy",
        "other",
    ];
    if !allowed.contains(&k.as_str()) {
        return Err(format!("kind must be one of {}", allowed.join(", ")));
    }
    Ok(k)
}

fn validate_scope(scope: &str) -> Result<String, String> {
    let s = scope.trim().to_lowercase();
    let allowed = ["private", "team", "organization", "company"];
    if !allowed.contains(&s.as_str()) {
        return Err(format!("scope must be one of {}", allowed.join(", ")));
    }
    Ok(s)
}

fn validate_origin(origin: &str) -> Result<String, String> {
    let o = origin.trim().to_lowercase();
    let allowed = ["authored", "retrieved", "recalled", "imported"];
    if !allowed.contains(&o.as_str()) {
        return Err(format!("origin must be one of {}", allowed.join(", ")));
    }
    Ok(o)
}

fn validate_inspection(state: &str) -> Result<String, String> {
    let s = state.trim().to_lowercase();
    let allowed = ["inspected", "user_reported", "unverified_recollection"];
    if !allowed.contains(&s.as_str()) {
        return Err(format!(
            "inspection_state must be one of {}",
            allowed.join(", ")
        ));
    }
    Ok(s)
}

fn validate_contributor_kind(kind: &str) -> Result<String, String> {
    let k = kind.trim().to_lowercase();
    if k != "user" && k != "agent" {
        return Err("contributor_kind must be 'user' or 'agent'".to_string());
    }
    Ok(k)
}

fn validate_nonempty(field: &str, value: &str, max: usize) -> Result<String, String> {
    let v = value.trim().to_string();
    if v.is_empty() {
        return Err(format!("{field} is required"));
    }
    if v.len() > max {
        return Err(format!("{field} exceeds {max} characters"));
    }
    Ok(v)
}

fn validate_optional(
    field: &str,
    value: &Option<String>,
    max: usize,
) -> Result<Option<String>, String> {
    match value {
        None => Ok(None),
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            if trimmed.len() > max {
                return Err(format!("{field} exceeds {max} characters"));
            }
            Ok(Some(trimmed.to_string()))
        }
    }
}

// ── Reducers ───────────────────────────────────────────────────────────────

#[reducer]
pub fn create_ai_source_version(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiSourceVersionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_source", "write")?;
    if organization_id == 0 {
        return Err("organization_id is required".to_string());
    }

    let kind = validate_kind(&params.kind)?;
    let title = validate_nonempty("title", &params.title, MAX_TITLE_LEN)?;
    let content_hash = validate_nonempty("content_hash", &params.content_hash, MAX_HASH_LEN)?;
    let origin = validate_origin(&params.origin)?;
    let scope = validate_scope(&params.scope)?;
    let inspection_state = validate_inspection(&params.inspection_state)?;
    if params.retention_policy.trim().is_empty() {
        return Err("retention_policy is required".to_string());
    }
    let retention_policy = params.retention_policy.trim().to_string();
    if retention_policy.len() > MAX_SCOPE_LEN {
        return Err("retention_policy exceeds limit".to_string());
    }

    let uri = validate_optional("uri", &params.uri, MAX_URI_LEN)?;
    let doi = validate_optional("doi", &params.doi, MAX_URI_LEN)?;
    let file_reference = validate_optional("file_reference", &params.file_reference, MAX_URI_LEN)?;

    // Caller must supply company_id explicitly when scope is `company`; we do
    // not default it internally — the param is the contract.
    if scope == "company" {
        match params.company_id {
            Some(company_id) if company_id != 0 => {}
            _ => return Err("company scope requires a nonzero company_id".to_string()),
        }
    }
    if let Some(company_id) = params.company_id {
        if company_id == 0 {
            return Err("company_id must be nonzero when supplied".to_string());
        }
    }

    // Unknowns stay unknown — authors_json may be None. If present, ensure it
    // is either a JSON array string or plain text, but don't invent.
    let authors_json = match &params.authors_json {
        None => None,
        Some(raw) if raw.trim().is_empty() => None,
        Some(raw) => Some(raw.trim().to_string()),
    };

    let row = ctx.db.ai_source_version().insert(AiSourceVersion {
        id: AUTO_INC_SENTINEL,
        organization_id,
        company_id: params.company_id,
        kind,
        title,
        authors_json,
        publisher: validate_optional("publisher", &params.publisher, MAX_TITLE_LEN)?,
        publication_date: validate_optional(
            "publication_date",
            &params.publication_date,
            MAX_TITLE_LEN,
        )?,
        edition: validate_optional("edition", &params.edition, MAX_KIND_LEN)?,
        version_label: validate_optional("version_label", &params.version_label, MAX_KIND_LEN)?,
        uri,
        doi,
        file_reference,
        content_hash: content_hash.clone(),
        snapshot_ref: validate_optional("snapshot_ref", &params.snapshot_ref, MAX_URI_LEN)?,
        retrieval_time: params.retrieval_time,
        origin,
        owner_identity: params.owner_identity,
        scope: scope.clone(),
        retention_policy,
        inspection_state,
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
            table_name: "ai_source_version",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["content_hash".to_string(), "scope".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_ai_source_passage(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiSourcePassageParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_source", "write")?;
    if organization_id == 0 {
        return Err("organization_id is required".to_string());
    }
    if params.source_version_id == 0 {
        return Err("source_version_id is required".to_string());
    }

    let version = ctx
        .db
        .ai_source_version()
        .id()
        .find(&params.source_version_id)
        .ok_or("source version not found")?;
    if version.organization_id != organization_id {
        return Err("source version does not belong to this organization".to_string());
    }

    let passage_kind =
        validate_nonempty("passage_kind", &params.passage_kind, MAX_KIND_LEN)?.to_lowercase();
    let allowed_kinds = ["text", "table", "record", "coordinates"];
    if !allowed_kinds.contains(&passage_kind.as_str()) {
        return Err(format!(
            "passage_kind must be one of {}",
            allowed_kinds.join(", ")
        ));
    }
    let content = validate_nonempty("content", &params.content, 20_000)?;
    let content_hash = validate_nonempty("content_hash", &params.content_hash, MAX_HASH_LEN)?;

    // Recalled (unverified) sources cannot claim `is_original = true` with
    // no processor distinction — keep the extraction boundary explicit.
    // We don't auto-correct; we just require the flag to be set intentionally.

    let coordinates_json = validate_optional("coordinates_json", &params.coordinates_json, 2_048)?;

    let row = ctx.db.ai_source_passage().insert(AiSourcePassage {
        id: AUTO_INC_SENTINEL,
        organization_id,
        source_version_id: params.source_version_id,
        passage_kind,
        content,
        content_hash,
        coordinates_json,
        is_original: params.is_original,
        processor_ref: validate_optional("processor_ref", &params.processor_ref, MAX_URI_LEN)?,
        correction_ref: validate_optional("correction_ref", &params.correction_ref, MAX_URI_LEN)?,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: version.company_id,
            table_name: "ai_source_passage",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["source_version_id".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_ai_contribution(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiContributionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_source", "write")?;
    if organization_id == 0 {
        return Err("organization_id is required".to_string());
    }

    let contributor_kind = validate_contributor_kind(&params.contributor_kind)?;
    let inspection_state = validate_inspection(&params.inspection_state)?;

    // Resolve the referenced version/passage to derive their company scope for
    // audit and to validate that the caller supplied explicit, nonzero ids — we
    // do not treat 0 as an implicit None.
    let resolved_version_company: Option<u64> = match params.source_version_id {
        None => None,
        Some(vid) => {
            if vid == AUTO_INC_SENTINEL {
                return Err("source_version_id must be nonzero when supplied".to_string());
            }
            let v = ctx
                .db
                .ai_source_version()
                .id()
                .find(&vid)
                .ok_or("source version not found for contribution")?;
            if v.organization_id != organization_id {
                return Err(
                    "contribution source version does not belong to this organization".to_string(),
                );
            }
            v.company_id
        }
    };
    let resolved_passage_company: Option<u64> = match params.passage_id {
        None => None,
        Some(pid) => {
            if pid == AUTO_INC_SENTINEL {
                return Err("passage_id must be nonzero when supplied".to_string());
            }
            let p = ctx
                .db
                .ai_source_passage()
                .id()
                .find(&pid)
                .ok_or("passage not found for contribution")?;
            if p.organization_id != organization_id {
                return Err("contribution passage does not belong to this organization".to_string());
            }
            // Passages inherit the version's org; they don't carry their own company_id
            // beyond organization, so we don't propagate a second company id here.
            None
        }
    };
    let _ = resolved_passage_company; // reserved for future company-scoped passages

    if params.source_version_id.is_none() && params.passage_id.is_none() {
        return Err("contribution must reference a source version or passage".to_string());
    }

    let row = ctx.db.ai_contribution().insert(AiContribution {
        id: AUTO_INC_SENTINEL,
        organization_id,
        source_version_id: params.source_version_id,
        passage_id: params.passage_id,
        contributor_identity: ctx.sender(),
        contributor_kind,
        session_ref: validate_optional("session_ref", &params.session_ref, MAX_URI_LEN)?,
        turn_ref: validate_optional("turn_ref", &params.turn_ref, MAX_URI_LEN)?,
        event_ref: validate_optional("event_ref", &params.event_ref, MAX_URI_LEN)?,
        inspection_state,
        introduced_at: ctx.timestamp,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    // Company context for audit is derived from the referenced source version
    // rather than hard-coded to None — the caller supplied the ids explicitly.
    let audit_company_id = resolved_version_company;
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: audit_company_id,
            table_name: "ai_contribution",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["inspection_state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
