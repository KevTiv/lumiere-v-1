//! AIH-15: durable, versioned source passages for the §7.3 answer gate.
//!
//! The answer gate (`ai-gateway/src/orchestrator/answer_gate.rs`) must check
//! that a citation names a real passage of a real source version, that the
//! version is in force on the answer date, and that it applies to the
//! answer's scope. It can only do that against a server-side record the
//! drafter cannot influence, so passages live here rather than in anything
//! a model produced.
//!
//! One row is one passage of one source version. Passage text is immutable
//! once recorded: `content_hash` is computed here from the text (never
//! supplied by the caller), and replaying a passage with identical content
//! is a no-op while replaying it with different content is rejected — a
//! correction is a new `source_version`, not an edit. The only mutable
//! field is `status`, which moves one way: `current` -> `superseded` ->
//! `withdrawn` (or `current` -> `withdrawn`). It never returns to `current`,
//! so a withdrawn or superseded passage cannot quietly become citable again.
//!
//! The table is private: the gateway reads it as a trusted principal, and
//! passage text is not something any subscribed client should receive.
//!
//! # AIH-13: versioned source, passage and contribution contracts
//!
//! A passage is now optionally bound to a `ai_evidence_source_version`,
//! which belongs to an `ai_evidence_source`. The records keep four things
//! separate that are easy to conflate:
//!
//! - **Original attribution** (`ai_evidence_source`): who wrote the material.
//!   Unknown attribution is recorded as `unknown`, never guessed.
//! - **Origin and verification** (`ai_evidence_source_version`): how the
//!   version reached the system and whether anyone actually inspected it. A
//!   model's recollection is `unverified_recollection` and cannot be
//!   promoted by a passage, a claim or repetition — only by
//!   `inspect_ai_evidence_source_version` with the inspected content hash.
//! - **Discussion contribution** (`ai_evidence_contribution`): who introduced
//!   the material into a conversation. This is a different identity from
//!   the author and carries its own inspection state, which may never be
//!   stronger than the version it points at.
//! - **Applicability** (`ai_evidence_passage.applicability`): where the
//!   passage may be relied on. Domain approval lives on claims, decisions and
//!   knowledge entries, not here.
//!
//! Semantic indexes over passage text remain derived and disposable; nothing
//! in this file writes to one.

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::evidence_common::{
    inspection_rank, is_sha256_hex, reference_in_scope, require_len, require_one_of,
    require_opt_len, validate_coordinates, validate_tags,
};
use crate::ai::skills::ai_agent_run;
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_KIND_LEN: usize = 64;
const MAX_KEY_LEN: usize = 256;
const MAX_VERSION_LEN: usize = 64;
const MAX_TEXT_LEN: usize = 32_768;
const MAX_TITLE_LEN: usize = 512;
const MAX_URI_LEN: usize = 2_048;
const MAX_NOTE_LEN: usize = 2_000;
const MAX_AUTHORS: usize = 32;
const MAX_AUTHOR_LEN: usize = 256;

const STATUS_CURRENT: &str = "current";
const STATUS_SUPERSEDED: &str = "superseded";
const STATUS_WITHDRAWN: &str = "withdrawn";

pub const ATTRIBUTIONS: [&str; 2] = ["known", "unknown"];
pub const SOURCE_ORIGINS: [&str; 6] = [
    "book_paper",
    "company_publication",
    "erp_policy",
    "erp_record",
    "user_provided",
    "model_recollection",
];
pub const SOURCE_SCOPES: [&str; 2] = ["company", "organization"];
pub const RETENTION_POLICIES: [&str; 3] = ["retain_snapshot", "hash_only", "delete_on_request"];
pub const TEXT_ORIGINS: [&str; 4] = ["original", "ocr", "extraction", "erp_record"];
pub const CONTRIBUTOR_KINDS: [&str; 2] = ["user", "agent"];
pub const INTRODUCED_KINDS: [&str; 2] = ["source_version", "concept"];

/// Lifecycle of a source version, ordered by severity. It only moves to a
/// strictly later state, so a retracted or deleted version can never be
/// quietly restored, and a superseded one can still be retracted later.
pub const VERSION_STATUSES: [&str; 5] = [
    "current",
    "superseded",
    "retracted",
    "access_revoked",
    "deleted",
];

pub fn version_status_rank(status: &str) -> Option<u8> {
    VERSION_STATUSES
        .iter()
        .position(|candidate| *candidate == status)
        .map(|idx| idx as u8)
}

/// Whether passage text may be shown: `present`, `restricted` (access
/// revoked — content retained for authorized history, never served) or
/// `tombstoned` (content deleted; only the hash remains).
pub const TEXT_PRESENT: &str = "present";
pub const TEXT_RESTRICTED: &str = "restricted";
pub const TEXT_TOMBSTONED: &str = "tombstoned";

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_evidence_passage,
    index(accessor = ai_evidence_passage_by_org, btree(columns = [organization_id])),
    index(
        accessor = ai_evidence_passage_by_source,
        btree(columns = [organization_id, company_id, source_kind, source_key])
    )
)]
pub struct AiEvidencePassage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// What sort of source this is (e.g. "policy", "tax_guidance"). Matches
    /// the `kind` of the `EvidenceRef` a citation uses.
    pub source_kind: String,
    /// Stable identity of the source across versions; matches the `id` of
    /// the citing `EvidenceRef`.
    pub source_key: String,
    pub source_version: String,
    pub passage_key: String,
    /// Lowercase hex SHA-256 of `passage_text`, computed by the reducer.
    pub content_hash: String,
    pub passage_text: String,
    /// Inclusive start / exclusive end of the period the passage is in
    /// force, in microseconds since the Unix epoch. `None` is unbounded.
    pub effective_from_micros: Option<i64>,
    pub effective_to_micros: Option<i64>,
    /// `key:value` scope tags the passage applies to (e.g. `jurisdiction:US`).
    pub applicability: Vec<String>,
    /// current | superseded | withdrawn
    pub status: String,
    /// The `ai_evidence_source_version` this passage was read from, when the
    /// source has been registered. `None` for passages recorded before
    /// AIH-13 or for sources not yet registered.
    pub source_version_id: Option<u64>,
    /// Locators inside the source version: `page:12`, `section:3.2`,
    /// `chars:100-250`, `table:t1`, `line:40`, `record:<table>:<id>@<rev>`.
    /// Empty means the location is unknown — it is never guessed.
    pub coordinates: Vec<String>,
    /// original | ocr | extraction | erp_record
    pub text_origin: String,
    /// The OCR / extraction processor (and its version) that produced the
    /// text; required unless the text is the original.
    pub processor_ref: Option<String>,
    /// present | restricted | tombstoned — see `TEXT_*`.
    pub text_state: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// A registered source: the stable identity of a book, paper, company
/// publication or ERP policy across all of its versions.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_evidence_source,
    index(accessor = ai_evidence_source_by_org, btree(columns = [organization_id])),
    index(
        accessor = ai_evidence_source_by_key,
        btree(columns = [organization_id, company_id, source_kind, source_key])
    )
)]
pub struct AiEvidenceSource {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub source_kind: String,
    pub source_key: String,
    pub title: String,
    /// known | unknown. `unknown` is an explicit statement that nobody has
    /// established who wrote the material; `authors` is then empty.
    pub author_attribution: String,
    pub authors: Vec<String>,
    pub author_organization: Option<String>,
    pub owner_uid: Identity,
    /// company | organization — how far references to this source may reach.
    pub scope: String,
    /// retain_snapshot | hash_only | delete_on_request
    pub retention_policy: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// One edition/version of a source. Immutable except for `verification`
/// (forward only), the snapshot fields set at inspection, and `status`.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_evidence_source_version,
    index(accessor = ai_evidence_source_version_by_org, btree(columns = [organization_id])),
    index(accessor = ai_evidence_source_version_by_source, btree(columns = [source_id]))
)]
pub struct AiEvidenceSourceVersion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub source_id: u64,
    pub version: String,
    pub edition: Option<String>,
    pub publication_date_micros: Option<i64>,
    pub uri: Option<String>,
    pub retrieved_at_micros: Option<i64>,
    /// SHA-256 of the whole inspected content. `None` until inspected.
    pub content_hash: Option<String>,
    /// Reference into the authorized file store; only where the source's
    /// retention policy permits keeping a snapshot.
    pub snapshot_ref: Option<String>,
    /// retained | hash_only | unavailable — derived from the two fields above.
    pub snapshot_state: String,
    /// How the version reached the system: see `SOURCE_ORIGINS`.
    pub origin: String,
    /// unverified_recollection | user_reported | inspected
    pub verification: String,
    /// current | superseded | retracted | access_revoked | deleted
    pub status: String,
    pub supersedes_version_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// Who introduced material into a discussion. Deliberately separate from the
/// source's author: a user quoting a paper is the contributor, not the author.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_evidence_contribution,
    index(accessor = ai_evidence_contribution_by_org, btree(columns = [organization_id]))
)]
pub struct AiEvidenceContribution {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// user | agent
    pub contributor_kind: String,
    /// The authenticated caller; never taken from a parameter.
    pub contributor_uid: Identity,
    pub agent_run_id: Option<u64>,
    pub session_ref: String,
    pub turn_ref: Option<String>,
    pub event_ref: Option<String>,
    /// source_version | concept
    pub introduced_kind: String,
    pub source_version_id: Option<u64>,
    /// What the contributor had actually checked when they introduced it.
    pub inspection_state: String,
    /// True when the contributor supplied a quotation of another source
    /// rather than the original passage; it stays attributed to the
    /// contribution until the original is inspected.
    pub is_secondary_quotation: bool,
    pub note: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiEvidencePassageParams {
    pub source_kind: String,
    pub source_key: String,
    pub source_version: String,
    pub passage_key: String,
    pub passage_text: String,
    pub effective_from_micros: Option<i64>,
    pub effective_to_micros: Option<i64>,
    pub applicability: Vec<String>,
    pub source_version_id: Option<u64>,
    pub coordinates: Vec<String>,
    pub text_origin: String,
    pub processor_ref: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiEvidenceSourceParams {
    pub source_kind: String,
    pub source_key: String,
    pub title: String,
    pub author_attribution: String,
    pub authors: Vec<String>,
    pub author_organization: Option<String>,
    pub scope: String,
    pub retention_policy: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiEvidenceSourceVersionParams {
    pub version: String,
    pub edition: Option<String>,
    pub publication_date_micros: Option<i64>,
    pub uri: Option<String>,
    pub retrieved_at_micros: Option<i64>,
    pub content_hash: Option<String>,
    pub snapshot_ref: Option<String>,
    pub origin: String,
    pub verification: String,
    pub supersedes_version_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct InspectAiEvidenceSourceVersionParams {
    pub content_hash: String,
    pub snapshot_ref: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiEvidenceContributionParams {
    pub contributor_kind: String,
    pub agent_run_id: Option<u64>,
    pub session_ref: String,
    pub turn_ref: Option<String>,
    pub event_ref: Option<String>,
    pub introduced_kind: String,
    pub source_version_id: Option<u64>,
    pub inspection_state: String,
    pub is_secondary_quotation: bool,
    pub note: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Register a source. Idempotent on an identical replay; a differing replay
/// is rejected because attribution is a recorded fact, not a draft — a
/// corrected attribution is a new source record with its own history.
#[reducer]
pub fn record_ai_evidence_source(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RecordAiEvidenceSourceParams,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization_id must be nonzero".to_string());
    }
    check_permission(ctx, organization_id, "ai_evidence_source", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    validate_source_params(&params)?;

    if let Some(existing) = find_source(
        ctx,
        organization_id,
        company_id,
        &params.source_kind,
        &params.source_key,
    ) {
        if existing.title == params.title
            && existing.author_attribution == params.author_attribution
            && existing.authors == params.authors
            && existing.author_organization == params.author_organization
            && existing.scope == params.scope
            && existing.retention_policy == params.retention_policy
        {
            return Ok(());
        }
        return Err("source already registered with different attribution or policy".to_string());
    }

    let row = ctx.db.ai_evidence_source().insert(AiEvidenceSource {
        id: 0,
        organization_id,
        company_id,
        source_kind: params.source_kind,
        source_key: params.source_key,
        title: params.title,
        author_attribution: params.author_attribution,
        authors: params.authors,
        author_organization: params.author_organization,
        owner_uid: ctx.sender(),
        scope: params.scope,
        retention_policy: params.retention_policy,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_source",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "source_kind": row.source_kind,
                    "source_key": row.source_key,
                    "author_attribution": row.author_attribution,
                    "scope": row.scope,
                })
                .to_string(),
            ),
            changed_fields: vec!["source_kind".to_string(), "source_key".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Register one version of a source. A model's recollection is recorded as
/// `unverified_recollection` and carries no hash or snapshot, so it can be
/// discussed and proposed for inspection but never cited.
#[reducer]
pub fn record_ai_evidence_source_version(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    source_id: u64,
    params: RecordAiEvidenceSourceVersionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_evidence_source", "create")?;
    let source = load_source(ctx, organization_id, company_id, source_id)?;
    validate_version_params(&params, &source.retention_policy)?;

    if let Some(predecessor_id) = params.supersedes_version_id {
        let predecessor = ctx
            .db
            .ai_evidence_source_version()
            .id()
            .find(&predecessor_id)
            .ok_or("Superseded version not found")?;
        if predecessor.source_id != source_id {
            return Err("Superseded version belongs to a different source".to_string());
        }
    }

    if let Some(existing) = ctx
        .db
        .ai_evidence_source_version()
        .ai_evidence_source_version_by_source()
        .filter(&source_id)
        .find(|row| row.version == params.version)
    {
        if existing.edition == params.edition
            && existing.publication_date_micros == params.publication_date_micros
            && existing.uri == params.uri
            && existing.content_hash == params.content_hash
            && existing.snapshot_ref == params.snapshot_ref
            && existing.origin == params.origin
            && existing.supersedes_version_id == params.supersedes_version_id
        {
            return Ok(());
        }
        return Err(
            "version already registered with different details; record a new version".to_string(),
        );
    }

    let snapshot_state = derive_snapshot_state(&params.content_hash, &params.snapshot_ref);
    let row = ctx
        .db
        .ai_evidence_source_version()
        .insert(AiEvidenceSourceVersion {
            id: 0,
            organization_id,
            company_id,
            source_id,
            version: params.version,
            edition: params.edition,
            publication_date_micros: params.publication_date_micros,
            uri: params.uri,
            retrieved_at_micros: params.retrieved_at_micros,
            content_hash: params.content_hash,
            snapshot_ref: params.snapshot_ref,
            snapshot_state,
            origin: params.origin,
            verification: params.verification,
            status: VERSION_STATUSES[0].to_string(),
            supersedes_version_id: params.supersedes_version_id,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_source_version",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "source_id": row.source_id,
                    "version": row.version,
                    "origin": row.origin,
                    "verification": row.verification,
                })
                .to_string(),
            ),
            changed_fields: vec!["source_id".to_string(), "version".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Promote a version to `inspected`. The caller supplies the hash of the
/// content they actually inspected; nothing else can move a version out of
/// `unverified_recollection` or `user_reported`, and it never moves back.
#[reducer]
pub fn inspect_ai_evidence_source_version(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    version_id: u64,
    params: InspectAiEvidenceSourceVersionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_evidence_source", "update")?;
    let version = load_source_version(ctx, organization_id, company_id, version_id)?;
    let source = load_source(ctx, organization_id, company_id, version.source_id)?;

    if version.status != VERSION_STATUSES[0] {
        return Err(format!(
            "a {} version cannot be inspected into current use",
            version.status
        ));
    }
    if version.verification == "inspected" {
        return Err("version is already inspected".to_string());
    }
    if !is_sha256_hex(&params.content_hash) {
        return Err("content_hash must be a lowercase hex SHA-256".to_string());
    }
    if version.content_hash.is_some() && version.content_hash.as_ref() != Some(&params.content_hash)
    {
        return Err("inspected content does not match the recorded content hash".to_string());
    }
    if params.snapshot_ref.is_some() && source.retention_policy != "retain_snapshot" {
        return Err("retention policy does not permit keeping a snapshot".to_string());
    }
    require_opt_len("snapshot_ref", &params.snapshot_ref, MAX_URI_LEN)?;

    let content_hash = Some(params.content_hash);
    let snapshot_ref = params.snapshot_ref.or_else(|| version.snapshot_ref.clone());
    let snapshot_state = derive_snapshot_state(&content_hash, &snapshot_ref);
    let old_verification = version.verification.clone();
    ctx.db
        .ai_evidence_source_version()
        .id()
        .update(AiEvidenceSourceVersion {
            content_hash,
            snapshot_ref,
            snapshot_state,
            verification: "inspected".to_string(),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..version
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_source_version",
            record_id: version_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "verification": old_verification }).to_string()),
            new_values: Some(serde_json::json!({ "verification": "inspected" }).to_string()),
            changed_fields: vec!["verification".to_string(), "content_hash".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Record one passage of one source version. Idempotent on identical
/// content; a differing replay of the same (source, version, passage) is
/// rejected because recorded text is immutable.
#[reducer]
pub fn record_ai_evidence_passage(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RecordAiEvidencePassageParams,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization_id must be nonzero".to_string());
    }
    check_permission(ctx, organization_id, "ai_evidence_passage", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    validate_params(&params)?;

    if let Some(version_id) = params.source_version_id {
        let version = load_source_version(ctx, organization_id, company_id, version_id)?;
        let source = load_source(ctx, organization_id, company_id, version.source_id)?;
        if source.source_kind != params.source_kind
            || source.source_key != params.source_key
            || version.version != params.source_version
        {
            return Err("passage does not match the source version it names".to_string());
        }
        if version.status != VERSION_STATUSES[0] {
            return Err(format!(
                "cannot add a passage to a {} version",
                version.status
            ));
        }
        if version.verification == "unverified_recollection" {
            return Err(
                "an unverified recollection has no passages; inspect the source first".to_string(),
            );
        }
    }

    let content_hash = format!("{:x}", Sha256::digest(params.passage_text.as_bytes()));

    if let Some(existing) = ctx
        .db
        .ai_evidence_passage()
        .ai_evidence_passage_by_source()
        .filter((
            &organization_id,
            &company_id,
            &params.source_kind,
            &params.source_key,
        ))
        .find(|row| {
            row.source_version == params.source_version && row.passage_key == params.passage_key
        })
    {
        if existing.content_hash == content_hash
            && existing.effective_from_micros == params.effective_from_micros
            && existing.effective_to_micros == params.effective_to_micros
            && existing.applicability == params.applicability
            && existing.source_version_id == params.source_version_id
            && existing.coordinates == params.coordinates
            && existing.text_origin == params.text_origin
            && existing.processor_ref == params.processor_ref
        {
            return Ok(());
        }
        return Err(
            "passage already recorded with different content; record a new source_version"
                .to_string(),
        );
    }

    let row = ctx.db.ai_evidence_passage().insert(AiEvidencePassage {
        id: 0,
        organization_id,
        company_id,
        source_kind: params.source_kind,
        source_key: params.source_key,
        source_version: params.source_version,
        passage_key: params.passage_key,
        content_hash,
        passage_text: params.passage_text,
        effective_from_micros: params.effective_from_micros,
        effective_to_micros: params.effective_to_micros,
        applicability: params.applicability,
        status: STATUS_CURRENT.to_string(),
        source_version_id: params.source_version_id,
        coordinates: params.coordinates,
        text_origin: params.text_origin,
        processor_ref: params.processor_ref,
        text_state: TEXT_PRESENT.to_string(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_passage",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "source_kind": row.source_kind,
                    "source_key": row.source_key,
                    "source_version": row.source_version,
                    "passage_key": row.passage_key,
                    "content_hash": row.content_hash,
                })
                .to_string(),
            ),
            changed_fields: vec!["source_key".to_string(), "source_version".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Record who introduced a source or concept into a discussion. The
/// contributor is always the authenticated caller, and the recorded
/// inspection state can never be stronger than the source version's own.
#[reducer]
pub fn record_ai_evidence_contribution(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RecordAiEvidenceContributionParams,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization_id must be nonzero".to_string());
    }
    check_permission(ctx, organization_id, "ai_evidence_contribution", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    validate_contribution_params(&params)?;

    if let Some(run_id) = params.agent_run_id {
        let run = ctx
            .db
            .ai_agent_run()
            .id()
            .find(&run_id)
            .ok_or("Agent run not found")?;
        if run.organization_id != organization_id || run.company_id != company_id {
            return Err("Agent run does not belong to this organization/company".to_string());
        }
    }

    if let Some(version_id) = params.source_version_id {
        let version = ctx
            .db
            .ai_evidence_source_version()
            .id()
            .find(&version_id)
            .ok_or("Source version not found")?;
        let source = load_source(ctx, organization_id, company_id, version.source_id)?;
        if !reference_in_scope(
            source.organization_id,
            source.company_id,
            &source.scope,
            organization_id,
            company_id,
        ) {
            return Err("Source version is outside this scope".to_string());
        }
        let claimed = inspection_rank(&params.inspection_state).unwrap_or(0);
        let established = inspection_rank(&version.verification).unwrap_or(0);
        if claimed > established {
            return Err(format!(
                "contribution cannot be '{}' when the source version is only '{}'",
                params.inspection_state, version.verification
            ));
        }
    }

    let row = ctx
        .db
        .ai_evidence_contribution()
        .insert(AiEvidenceContribution {
            id: 0,
            organization_id,
            company_id,
            contributor_kind: params.contributor_kind,
            contributor_uid: ctx.sender(),
            agent_run_id: params.agent_run_id,
            session_ref: params.session_ref,
            turn_ref: params.turn_ref,
            event_ref: params.event_ref,
            introduced_kind: params.introduced_kind,
            source_version_id: params.source_version_id,
            inspection_state: params.inspection_state,
            is_secondary_quotation: params.is_secondary_quotation,
            note: params.note,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_contribution",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "contributor_kind": row.contributor_kind,
                    "introduced_kind": row.introduced_kind,
                    "inspection_state": row.inspection_state,
                })
                .to_string(),
            ),
            changed_fields: vec!["introduced_kind".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Retire a passage. Status only moves forward (current -> superseded ->
/// withdrawn), so a retired passage can never become citable again.
#[reducer]
pub fn set_ai_evidence_passage_status(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    passage_id: u64,
    status: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_evidence_passage", "update")?;
    let passage = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&passage_id)
        .ok_or("Passage not found")?;
    if passage.organization_id != organization_id || passage.company_id != company_id {
        return Err("Passage does not belong to this organization/company".to_string());
    }
    if !valid_status_transition(&passage.status, &status) {
        return Err(format!(
            "passage status cannot move from '{}' to '{status}'",
            passage.status
        ));
    }

    let old_status = passage.status.clone();
    ctx.db.ai_evidence_passage().id().update(AiEvidencePassage {
        status: status.clone(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..passage
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_passage",
            record_id: passage_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "status": old_status }).to_string()),
            new_values: Some(serde_json::json!({ "status": status }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

pub(crate) fn find_source(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    source_kind: &str,
    source_key: &str,
) -> Option<AiEvidenceSource> {
    ctx.db
        .ai_evidence_source()
        .ai_evidence_source_by_key()
        .filter((
            &organization_id,
            &company_id,
            &source_kind.to_string(),
            &source_key.to_string(),
        ))
        .next()
}

pub(crate) fn load_source(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    source_id: u64,
) -> Result<AiEvidenceSource, String> {
    let source = ctx
        .db
        .ai_evidence_source()
        .id()
        .find(&source_id)
        .ok_or("Source not found")?;
    if source.organization_id != organization_id || source.company_id != company_id {
        return Err("Source does not belong to this organization/company".to_string());
    }
    Ok(source)
}

pub(crate) fn load_source_version(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    version_id: u64,
) -> Result<AiEvidenceSourceVersion, String> {
    let version = ctx
        .db
        .ai_evidence_source_version()
        .id()
        .find(&version_id)
        .ok_or("Source version not found")?;
    if version.organization_id != organization_id || version.company_id != company_id {
        return Err("Source version does not belong to this organization/company".to_string());
    }
    Ok(version)
}

/// Resolve a passage a claim, decision or knowledge entry wants to depend on.
/// Cross-organization references and references outside the source's scope
/// are denied; for a *new* dependency the passage must still be citable
/// (current status, content not restricted or tombstoned).
pub(crate) fn require_passage_referencable(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    passage_id: u64,
    for_new_dependency: bool,
) -> Result<AiEvidencePassage, String> {
    let passage = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&passage_id)
        .ok_or_else(|| format!("Passage {passage_id} not found"))?;
    let in_scope = if let Some(version_id) = passage.source_version_id {
        let version = ctx
            .db
            .ai_evidence_source_version()
            .id()
            .find(&version_id)
            .ok_or("Passage names a missing source version")?;
        let source = ctx
            .db
            .ai_evidence_source()
            .id()
            .find(&version.source_id)
            .ok_or("Passage names a missing source")?;
        reference_in_scope(
            source.organization_id,
            source.company_id,
            &source.scope,
            organization_id,
            company_id,
        )
    } else {
        passage.organization_id == organization_id && passage.company_id == company_id
    };
    if !in_scope {
        return Err(format!("Passage {passage_id} is outside this scope"));
    }
    if for_new_dependency
        && (passage.status != STATUS_CURRENT || passage.text_state != TEXT_PRESENT)
    {
        return Err(format!(
            "Passage {passage_id} is {} / {} and cannot support new work",
            passage.status, passage.text_state
        ));
    }
    Ok(passage)
}

fn valid_status_transition(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        (STATUS_CURRENT, STATUS_SUPERSEDED)
            | (STATUS_CURRENT, STATUS_WITHDRAWN)
            | (STATUS_SUPERSEDED, STATUS_WITHDRAWN)
    )
}

/// `retained` only when a snapshot reference exists, `hash_only` when only
/// the inspected hash survives, `unavailable` when neither does. A hash alone
/// proves what the content was; it does not let anyone replay it.
pub(crate) fn derive_snapshot_state(
    content_hash: &Option<String>,
    snapshot_ref: &Option<String>,
) -> String {
    if snapshot_ref.is_some() {
        "retained"
    } else if content_hash.is_some() {
        "hash_only"
    } else {
        "unavailable"
    }
    .to_string()
}

fn validate_source_params(params: &RecordAiEvidenceSourceParams) -> Result<(), String> {
    require_len("source_kind", &params.source_kind, MAX_KIND_LEN)?;
    require_len("source_key", &params.source_key, MAX_KEY_LEN)?;
    require_len("title", &params.title, MAX_TITLE_LEN)?;
    require_one_of(
        "author_attribution",
        &params.author_attribution,
        &ATTRIBUTIONS,
    )?;
    require_one_of("scope", &params.scope, &SOURCE_SCOPES)?;
    require_one_of(
        "retention_policy",
        &params.retention_policy,
        &RETENTION_POLICIES,
    )?;
    require_opt_len(
        "author_organization",
        &params.author_organization,
        MAX_AUTHOR_LEN,
    )?;
    if params.authors.len() > MAX_AUTHORS {
        return Err(format!("at most {MAX_AUTHORS} authors"));
    }
    for author in &params.authors {
        require_len("author", author, MAX_AUTHOR_LEN)?;
    }
    let names_someone = !params.authors.is_empty() || params.author_organization.is_some();
    match (params.author_attribution.as_str(), names_someone) {
        ("known", false) => {
            Err("known attribution must name an author or an organization".to_string())
        }
        ("unknown", true) => Err(
            "unknown attribution must not carry authors; attribution is never invented".to_string(),
        ),
        _ => Ok(()),
    }
}

fn validate_version_params(
    params: &RecordAiEvidenceSourceVersionParams,
    retention_policy: &str,
) -> Result<(), String> {
    require_len("version", &params.version, MAX_VERSION_LEN)?;
    require_opt_len("edition", &params.edition, MAX_VERSION_LEN)?;
    require_opt_len("uri", &params.uri, MAX_URI_LEN)?;
    require_opt_len("snapshot_ref", &params.snapshot_ref, MAX_URI_LEN)?;
    require_one_of("origin", &params.origin, &SOURCE_ORIGINS)?;
    if inspection_rank(&params.verification).is_none() {
        return Err(
            "verification must be unverified_recollection, user_reported or inspected".to_string(),
        );
    }
    if let Some(hash) = &params.content_hash {
        if !is_sha256_hex(hash) {
            return Err("content_hash must be a lowercase hex SHA-256".to_string());
        }
    }
    if params.snapshot_ref.is_some() && retention_policy != "retain_snapshot" {
        return Err("retention policy does not permit keeping a snapshot".to_string());
    }
    if params.snapshot_ref.is_some() && params.content_hash.is_none() {
        return Err("a snapshot reference needs the content hash it was taken at".to_string());
    }
    if params.origin == "model_recollection"
        && (params.verification != "unverified_recollection"
            || params.content_hash.is_some()
            || params.snapshot_ref.is_some())
    {
        return Err(
            "a model recollection stays unverified and carries no hash or snapshot until inspected"
                .to_string(),
        );
    }
    if params.verification == "inspected" && params.content_hash.is_none() {
        return Err("an inspected version must record the hash of what was inspected".to_string());
    }
    Ok(())
}

fn validate_contribution_params(params: &RecordAiEvidenceContributionParams) -> Result<(), String> {
    require_one_of(
        "contributor_kind",
        &params.contributor_kind,
        &CONTRIBUTOR_KINDS,
    )?;
    require_one_of(
        "introduced_kind",
        &params.introduced_kind,
        &INTRODUCED_KINDS,
    )?;
    require_len("session_ref", &params.session_ref, MAX_KEY_LEN)?;
    require_opt_len("turn_ref", &params.turn_ref, MAX_KEY_LEN)?;
    require_opt_len("event_ref", &params.event_ref, MAX_KEY_LEN)?;
    require_opt_len("note", &params.note, MAX_NOTE_LEN)?;
    if inspection_rank(&params.inspection_state).is_none() {
        return Err(
            "inspection_state must be unverified_recollection, user_reported or inspected"
                .to_string(),
        );
    }
    match (params.contributor_kind.as_str(), params.agent_run_id) {
        ("agent", None) => return Err("an agent contribution must name its run".to_string()),
        ("user", Some(_)) => {
            return Err("a user contribution must not name an agent run".to_string())
        }
        _ => {}
    }
    match (params.introduced_kind.as_str(), params.source_version_id) {
        ("source_version", None) => {
            return Err("introducing a source must name its source version".to_string())
        }
        ("concept", Some(_)) => {
            return Err("a concept contribution must not name a source version".to_string())
        }
        _ => {}
    }
    if params.is_secondary_quotation && params.introduced_kind != "source_version" {
        return Err("only a source contribution can be a secondary quotation".to_string());
    }
    Ok(())
}

fn validate_params(params: &RecordAiEvidencePassageParams) -> Result<(), String> {
    for (name, value, max) in [
        ("source_kind", &params.source_kind, MAX_KIND_LEN),
        ("source_key", &params.source_key, MAX_KEY_LEN),
        ("source_version", &params.source_version, MAX_VERSION_LEN),
        ("passage_key", &params.passage_key, MAX_KEY_LEN),
    ] {
        if value.trim().is_empty() || value.len() > max {
            return Err(format!("{name} must be 1..{max} bytes"));
        }
    }
    if params.passage_text.trim().is_empty() || params.passage_text.len() > MAX_TEXT_LEN {
        return Err(format!("passage_text must be 1..{MAX_TEXT_LEN} bytes"));
    }
    if let (Some(from), Some(to)) = (params.effective_from_micros, params.effective_to_micros) {
        if from >= to {
            return Err("effective_from must be before effective_to".to_string());
        }
    }
    validate_tags("applicability", &params.applicability)?;
    validate_coordinates(&params.coordinates)?;
    require_one_of("text_origin", &params.text_origin, &TEXT_ORIGINS)?;
    require_opt_len("processor_ref", &params.processor_ref, MAX_KEY_LEN)?;
    match (params.text_origin.as_str(), &params.processor_ref) {
        ("ocr" | "extraction", None) => {
            return Err("OCR/extracted text must name its processor".to_string())
        }
        ("original" | "erp_record", Some(_)) => {
            return Err("only OCR/extracted text names a processor".to_string())
        }
        _ => {}
    }
    if params.text_origin == "erp_record"
        && !params
            .coordinates
            .iter()
            .any(|coordinate| coordinate.starts_with("record:"))
    {
        return Err(
            "an ERP record passage needs a record:<table>:<id>@<revision> coordinate".to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> RecordAiEvidencePassageParams {
        RecordAiEvidencePassageParams {
            source_kind: "policy".into(),
            source_key: "vat-guide".into(),
            source_version: "2".into(),
            passage_key: "s1".into(),
            passage_text: "text".into(),
            effective_from_micros: Some(1),
            effective_to_micros: Some(2),
            applicability: vec!["jurisdiction:US".into()],
            source_version_id: None,
            coordinates: vec!["page:3".into()],
            text_origin: "original".into(),
            processor_ref: None,
        }
    }

    fn source_params() -> RecordAiEvidenceSourceParams {
        RecordAiEvidenceSourceParams {
            source_kind: "book".into(),
            source_key: "isbn-1".into(),
            title: "A Book".into(),
            author_attribution: "known".into(),
            authors: vec!["A. Author".into()],
            author_organization: None,
            scope: "company".into(),
            retention_policy: "retain_snapshot".into(),
        }
    }

    fn version_params() -> RecordAiEvidenceSourceVersionParams {
        RecordAiEvidenceSourceVersionParams {
            version: "2e".into(),
            edition: Some("2nd".into()),
            publication_date_micros: None,
            uri: None,
            retrieved_at_micros: None,
            content_hash: Some("a".repeat(64)),
            snapshot_ref: None,
            origin: "book_paper".into(),
            verification: "inspected".into(),
            supersedes_version_id: None,
        }
    }

    fn contribution_params() -> RecordAiEvidenceContributionParams {
        RecordAiEvidenceContributionParams {
            contributor_kind: "user".into(),
            agent_run_id: None,
            session_ref: "session-1".into(),
            turn_ref: Some("turn-4".into()),
            event_ref: None,
            introduced_kind: "source_version".into(),
            source_version_id: Some(1),
            inspection_state: "user_reported".into(),
            is_secondary_quotation: false,
            note: None,
        }
    }

    #[test]
    fn status_only_moves_forward() {
        assert!(valid_status_transition("current", "superseded"));
        assert!(valid_status_transition("current", "withdrawn"));
        assert!(valid_status_transition("superseded", "withdrawn"));
        assert!(!valid_status_transition("withdrawn", "current"));
        assert!(!valid_status_transition("superseded", "current"));
        assert!(!valid_status_transition("current", "current"));
        assert!(!valid_status_transition("current", "bogus"));
    }

    #[test]
    fn version_status_ranks_are_strictly_ordered() {
        let ranks: Vec<_> = VERSION_STATUSES
            .iter()
            .map(|status| version_status_rank(status).unwrap())
            .collect();
        assert!(ranks.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(version_status_rank("bogus"), None);
    }

    #[test]
    fn params_validation_rejects_bad_shapes() {
        assert!(validate_params(&params()).is_ok());

        let mut bad = params();
        bad.effective_from_micros = Some(5);
        bad.effective_to_micros = Some(5);
        assert!(validate_params(&bad).is_err());

        let mut bad = params();
        bad.applicability = vec!["no-colon".into()];
        assert!(validate_params(&bad).is_err());

        let mut bad = params();
        bad.passage_text = "  ".into();
        assert!(validate_params(&bad).is_err());

        let mut bad = params();
        bad.source_key = "x".repeat(MAX_KEY_LEN + 1);
        assert!(validate_params(&bad).is_err());
    }

    #[test]
    fn unknown_pages_stay_unknown_and_extraction_names_its_processor() {
        let mut unknown_page = params();
        unknown_page.coordinates = vec![];
        assert!(validate_params(&unknown_page).is_ok());

        let mut ocr = params();
        ocr.text_origin = "ocr".into();
        assert!(validate_params(&ocr).is_err());
        ocr.processor_ref = Some("tesseract@5.3".into());
        assert!(validate_params(&ocr).is_ok());

        let mut original = params();
        original.processor_ref = Some("tesseract@5.3".into());
        assert!(validate_params(&original).is_err());

        let mut erp = params();
        erp.text_origin = "erp_record".into();
        assert!(validate_params(&erp).is_err());
        erp.coordinates = vec!["record:sale_order:42@7".into()];
        assert!(validate_params(&erp).is_ok());
    }

    #[test]
    fn unknown_attribution_is_never_invented() {
        assert!(validate_source_params(&source_params()).is_ok());

        let mut unknown = source_params();
        unknown.author_attribution = "unknown".into();
        assert!(validate_source_params(&unknown).is_err()); // still lists an author
        unknown.authors.clear();
        assert!(validate_source_params(&unknown).is_ok());

        let mut known_without_name = source_params();
        known_without_name.authors.clear();
        assert!(validate_source_params(&known_without_name).is_err());

        let mut company = source_params();
        company.authors.clear();
        company.author_organization = Some("Acme Corp".into());
        assert!(validate_source_params(&company).is_ok());
    }

    #[test]
    fn recollected_sources_stay_unverified() {
        assert!(validate_version_params(&version_params(), "retain_snapshot").is_ok());

        let mut recalled = version_params();
        recalled.origin = "model_recollection".into();
        // Cannot arrive already inspected or hashed.
        assert!(validate_version_params(&recalled, "retain_snapshot").is_err());
        recalled.verification = "unverified_recollection".into();
        assert!(validate_version_params(&recalled, "retain_snapshot").is_err());
        recalled.content_hash = None;
        assert!(validate_version_params(&recalled, "retain_snapshot").is_ok());

        let mut inspected_without_hash = version_params();
        inspected_without_hash.content_hash = None;
        assert!(validate_version_params(&inspected_without_hash, "retain_snapshot").is_err());
    }

    #[test]
    fn snapshots_follow_the_retention_policy() {
        let mut with_snapshot = version_params();
        with_snapshot.snapshot_ref = Some("files/abc".into());
        assert!(validate_version_params(&with_snapshot, "retain_snapshot").is_ok());
        assert!(validate_version_params(&with_snapshot, "hash_only").is_err());

        assert_eq!(
            derive_snapshot_state(&Some("h".into()), &Some("f".into())),
            "retained"
        );
        assert_eq!(derive_snapshot_state(&Some("h".into()), &None), "hash_only");
        assert_eq!(derive_snapshot_state(&None, &None), "unavailable");
    }

    #[test]
    fn contribution_shapes_are_consistent() {
        assert!(validate_contribution_params(&contribution_params()).is_ok());

        let mut agent_without_run = contribution_params();
        agent_without_run.contributor_kind = "agent".into();
        assert!(validate_contribution_params(&agent_without_run).is_err());
        agent_without_run.agent_run_id = Some(9);
        assert!(validate_contribution_params(&agent_without_run).is_ok());

        let mut user_with_run = contribution_params();
        user_with_run.agent_run_id = Some(9);
        assert!(validate_contribution_params(&user_with_run).is_err());

        let mut concept_with_source = contribution_params();
        concept_with_source.introduced_kind = "concept".into();
        assert!(validate_contribution_params(&concept_with_source).is_err());
        concept_with_source.source_version_id = None;
        assert!(validate_contribution_params(&concept_with_source).is_ok());
        concept_with_source.is_secondary_quotation = true;
        assert!(validate_contribution_params(&concept_with_source).is_err());
    }
}
