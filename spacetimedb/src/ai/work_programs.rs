//! Private, revisioned reusable-work drafts and exact source-output nominations.
//!
//! Saving a manifest or nominating an existing output grants no execution,
//! publication, storage or evidence authority. Runtime admission and independent
//! certification remain separate. All rows participate in canonical commits.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use super::skills::{ai_agent_run, ai_skill};
use crate::core::audit::{audit_log, AuditLog};
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::helpers::check_permission;
use crate::workflow::authorization::require_workflow_company_access;

const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_PROGRAMS: usize = 100;
const MAX_VERSIONS: usize = 256;
const MAX_OUTPUTS: usize = 128;

/// The mutable head identifies one personal draft within a company.
#[derive(Clone)]
#[spacetimedb::table(accessor = ai_work_program,
    index(accessor = ai_work_program_by_org, btree(columns = [organization_id])),
    index(accessor = ai_work_program_by_owner, btree(columns = [organization_id, owner_identity])))]
pub struct AiWorkProgram {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub scope_key: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub owner_identity: Identity,
    pub program_key: String,
    pub current_revision: u64,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// Immutable manifest and actor-bound save receipt. There is no published state.
#[derive(Clone)]
#[spacetimedb::table(accessor = ai_work_program_version,
    index(accessor = ai_work_program_version_by_org, btree(columns = [organization_id])),
    index(accessor = ai_work_program_version_by_program, btree(columns = [program_id])))]
pub struct AiWorkProgramVersion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub request_key: String,
    pub request_hash: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub owner_identity: Identity,
    pub program_id: u64,
    pub revision: u64,
    pub manifest_json: String,
    pub manifest_hash: String,
    pub graph_hash: String,
    pub application_contract: String,
    pub reviewed_skill_key: String,
    pub created_at: Timestamp,
}

/// Exact nomination of an existing run artifact; never a verified output claim.
/// The artifact stays with the original run, so this row copies no private body.
#[derive(Clone)]
#[spacetimedb::table(accessor = ai_work_program_output_nomination,
    index(accessor = ai_work_program_output_nomination_by_org, btree(columns = [organization_id])),
    index(accessor = ai_work_program_output_nomination_by_version, btree(columns = [program_version_id])))]
pub struct AiWorkProgramOutputNomination {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub request_key: String,
    pub request_hash: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub owner_identity: Identity,
    pub program_version_id: u64,
    pub source_run_id: u64,
    pub source_artifact_index: u32,
    pub source_artifact_hash: String,
    pub source_artifact_bytes: u32,
    pub created_at: Timestamp,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ManifestPin {
    key: String,
    version: u64,
    sha256: String,
}

/// Storage validates author intent, not generated capability or runtime admission.
/// Kept wire-compatible with the gateway's strict WorkProgram manifest.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DraftManifest {
    schema_version: u32,
    program_key: String,
    version: u64,
    module: String,
    reviewed_skill_key: String,
    application_contract: String,
    graph_hash: String,
    input_schema_ref: String,
    output_schema_ref: String,
    code_artifacts: Vec<ManifestPin>,
    runtime_profiles: Vec<ManifestPin>,
}

#[derive(Clone, Debug, SpacetimeType)]
pub struct SaveAiWorkProgramDraftParams {
    pub company_id: u64,
    pub expected_revision: Option<u64>,
    pub idempotency_key: String,
    pub manifest_json: String,
}

#[derive(Clone, Debug, SpacetimeType)]
pub struct NominateAiWorkProgramOutputParams {
    pub company_id: u64,
    pub program_version_id: u64,
    pub source_run_id: u64,
    pub source_artifact_index: u32,
    pub expected_artifact_hash: String,
    pub idempotency_key: String,
}

/// Save a personal, non-executable draft. An identical actor/request replay is
/// write-free even after a newer head exists; changed input is always rejected.
#[reducer]
pub fn save_ai_work_program_draft(
    ctx: &ReducerContext,
    organization_id: u64,
    params: SaveAiWorkProgramDraftParams,
) -> Result<(), String> {
    authorize(ctx, organization_id, params.company_id)?;
    identifier("idempotency key", &params.idempotency_key, 128)?;
    let (manifest, canonical) = prepare_manifest(&params.manifest_json)?;
    let request_key = request_key(organization_id, ctx.sender(), &params.idempotency_key);
    let request_hash = hash_json(&serde_json::json!([
        "save",
        params.company_id,
        params.expected_revision,
        canonical
    ]))?;
    if let Some(prior) = ctx
        .db
        .ai_work_program_version()
        .request_key()
        .find(&request_key)
    {
        return replay_matches(&prior.request_hash, &request_hash);
    }
    let scope_key = format!(
        "{organization_id}:{}:{}:{}",
        params.company_id,
        ctx.sender().to_hex(),
        manifest.program_key
    );
    let heads = ctx.db.ai_work_program();
    let prior = heads.scope_key().find(&scope_key);
    let revision = next_revision(
        prior.as_ref().map(|row| row.current_revision),
        params.expected_revision,
    )?;
    if manifest.version != revision {
        return Err("manifest version must equal the next saved revision".into());
    }
    if let Some(head) = prior.as_ref() {
        if ctx
            .db
            .ai_work_program_version()
            .ai_work_program_version_by_program()
            .filter(&head.id)
            .take(MAX_VERSIONS)
            .count()
            >= MAX_VERSIONS
        {
            return Err("work program version limit reached".into());
        }
    } else if heads
        .ai_work_program_by_owner()
        .filter((&organization_id, &ctx.sender()))
        .take(MAX_PROGRAMS)
        .count()
        >= MAX_PROGRAMS
    {
        return Err("work program owner limit reached".into());
    }
    let head = if let Some(mut head) = prior {
        head.current_revision = revision;
        head.updated_at = ctx.timestamp;
        heads.id().update(head.clone());
        head
    } else {
        heads.insert(AiWorkProgram {
            id: 0,
            scope_key,
            organization_id,
            company_id: params.company_id,
            owner_identity: ctx.sender(),
            program_key: manifest.program_key,
            current_revision: revision,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        })
    };
    let version = ctx
        .db
        .ai_work_program_version()
        .insert(AiWorkProgramVersion {
            id: 0,
            request_key: request_key.clone(),
            request_hash,
            organization_id,
            company_id: params.company_id,
            owner_identity: ctx.sender(),
            program_id: head.id,
            revision,
            manifest_hash: digest(canonical.as_bytes()),
            manifest_json: canonical,
            graph_hash: manifest.graph_hash,
            application_contract: manifest.application_contract,
            reviewed_skill_key: manifest.reviewed_skill_key,
            created_at: ctx.timestamp,
        });
    let changes = audited_changes(
        ctx,
        organization_id,
        params.company_id,
        "ai_work_program_version",
        version.id,
        vec![
            RowChange::upsert_stdb_row(
                "ai_work_program",
                serde_json::json!({"id": head.id}),
                &head,
            )?,
            RowChange::upsert_stdb_row(
                "ai_work_program_version",
                serde_json::json!({"id": version.id}),
                &version,
            )?,
        ],
    )?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.save_ai_work_program_draft".to_string(),
            correlation_id: request_key,
            changes,
        },
    )?;
    Ok(())
}

/// Nominate an artifact already attached to the caller's completed run. The
/// server computes the content hash and keeps only a source pointer, never a
/// browser-provided URL, storage path, evidence verdict or artifact body.
#[reducer]
pub fn nominate_ai_work_program_output(
    ctx: &ReducerContext,
    organization_id: u64,
    params: NominateAiWorkProgramOutputParams,
) -> Result<(), String> {
    authorize(ctx, organization_id, params.company_id)?;
    check_permission(ctx, organization_id, "ai_agent_run", "read")?;
    identifier("idempotency key", &params.idempotency_key, 128)?;
    require_hash(&params.expected_artifact_hash)?;
    let version = ctx
        .db
        .ai_work_program_version()
        .id()
        .find(&params.program_version_id)
        .ok_or("work program version not found")?;
    if version.organization_id != organization_id
        || version.company_id != params.company_id
        || version.owner_identity != ctx.sender()
    {
        return Err("work program version is outside the caller scope".into());
    }
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&params.source_run_id)
        .ok_or("source run not found")?;
    if run.organization_id != organization_id
        || run.company_id != params.company_id
        || !run
            .triggered_by_hex
            .eq_ignore_ascii_case(&ctx.sender().to_hex())
        || run.status != "completed"
    {
        return Err("source run must be the caller's completed run in the selected company".into());
    }
    let skill = ctx
        .db
        .ai_skill()
        .id()
        .find(&run.skill_id)
        .ok_or("source skill not found")?;
    if skill.skill_key != version.reviewed_skill_key {
        return Err("source run does not match the program's reviewed skill".into());
    }
    let (artifact_hash, artifact_bytes) =
        source_artifact(run.artifacts_json.as_deref(), params.source_artifact_index)?;
    if artifact_hash != params.expected_artifact_hash {
        return Err("source artifact changed; reload the exact source output".into());
    }
    let key = request_key(organization_id, ctx.sender(), &params.idempotency_key);
    let hash = hash_json(&serde_json::json!([
        "nominate",
        params.company_id,
        params.program_version_id,
        params.source_run_id,
        params.source_artifact_index,
        artifact_hash
    ]))?;
    if let Some(prior) = ctx
        .db
        .ai_work_program_output_nomination()
        .request_key()
        .find(&key)
    {
        return replay_matches(&prior.request_hash, &hash);
    }
    if ctx
        .db
        .ai_work_program_output_nomination()
        .ai_work_program_output_nomination_by_version()
        .filter(&version.id)
        .take(MAX_OUTPUTS)
        .count()
        >= MAX_OUTPUTS
    {
        return Err("work program output nomination limit reached".into());
    }
    let row = ctx
        .db
        .ai_work_program_output_nomination()
        .insert(AiWorkProgramOutputNomination {
            id: 0,
            request_key: key.clone(),
            request_hash: hash,
            organization_id,
            company_id: params.company_id,
            owner_identity: ctx.sender(),
            program_version_id: version.id,
            source_run_id: run.id,
            source_artifact_index: params.source_artifact_index,
            source_artifact_hash: artifact_hash,
            source_artifact_bytes: artifact_bytes,
            created_at: ctx.timestamp,
        });
    let changes = audited_changes(
        ctx,
        organization_id,
        params.company_id,
        "ai_work_program_output_nomination",
        row.id,
        vec![RowChange::upsert_stdb_row(
            "ai_work_program_output_nomination",
            serde_json::json!({"id": row.id}),
            &row,
        )?],
    )?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.nominate_ai_work_program_output".to_string(),
            correlation_id: key,
            changes,
        },
    )?;
    Ok(())
}

fn authorize(ctx: &ReducerContext, organization_id: u64, company_id: u64) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_work_program", "write")?;
    if require_workflow_company_access(ctx, organization_id, company_id, ctx.sender())? {
        return Err("work program authoring requires actual company membership".into());
    }
    Ok(())
}

fn audited_changes(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    table: &str,
    record_id: u64,
    mut changes: Vec<RowChange>,
) -> Result<Vec<RowChange>, String> {
    let audit = ctx.db.audit_log().insert(AuditLog {
        id: 0,
        organization_id,
        company_id: Some(company_id),
        table_name: table.into(),
        record_id,
        action: "CREATE".into(),
        old_values: None,
        new_values: None,
        changed_fields: vec!["draft".into()],
        user_identity: ctx.sender(),
        session_id: ctx.connection_id().map(|id| id.to_u128() as u64),
        ip_address: None,
        user_agent: None,
        timestamp: ctx.timestamp,
        metadata: Some(
            "unverified author intent; no execution, publication or evidence authority".into(),
        ),
    });
    changes.push(RowChange::upsert_stdb_row(
        "audit_log",
        serde_json::json!({"id": audit.id}),
        &audit,
    )?);
    Ok(changes)
}

fn prepare_manifest(raw: &str) -> Result<(DraftManifest, String), String> {
    if raw.len() > MAX_MANIFEST_BYTES {
        return Err("work program manifest exceeds 64 KiB".into());
    }
    let manifest: DraftManifest = serde_json::from_str(raw)
        .map_err(|error| format!("invalid work program manifest: {error}"))?;
    if manifest.schema_version != 1 || manifest.version == 0 {
        return Err("unsupported manifest schema or version".into());
    }
    slug("program key", &manifest.program_key)?;
    if ![
        "accounting",
        "expenses",
        "reports",
        "sales",
        "crm",
        "purchasing",
        "subscriptions",
        "products",
        "warehouse",
        "fleet",
    ]
    .contains(&manifest.module.as_str())
    {
        return Err("module is outside the Alpha work program scope".into());
    }
    slug("reviewed skill key", &manifest.reviewed_skill_key)?;
    reference("application contract", &manifest.application_contract)?;
    if ["latest", "main", "master", "dev", "head"]
        .contains(&manifest.application_contract.to_ascii_lowercase().as_str())
    {
        return Err("application contract must be an immutable pin".into());
    }
    require_hash(&manifest.graph_hash)?;
    reference("input schema reference", &manifest.input_schema_ref)?;
    reference("output schema reference", &manifest.output_schema_ref)?;
    for pins in [&manifest.code_artifacts, &manifest.runtime_profiles] {
        if pins.len() > 16 {
            return Err("at most 16 dependency pins are supported".into());
        }
        let mut keys = std::collections::BTreeSet::new();
        for pin in pins {
            slug("dependency key", &pin.key)?;
            if pin.version == 0 || !keys.insert(&pin.key) {
                return Err("dependency versions must be positive and keys unique".into());
            }
            require_hash(&pin.sha256)?;
        }
    }
    let canonical = serde_json::to_string(&manifest)
        .map_err(|error| format!("cannot serialize work program manifest: {error}"))?;
    if canonical.len() > MAX_MANIFEST_BYTES {
        return Err("canonical manifest exceeds 64 KiB".into());
    }
    Ok((manifest, canonical))
}

fn source_artifact(raw: Option<&str>, index: u32) -> Result<(String, u32), String> {
    let raw = raw.ok_or("source run has no artifacts")?;
    if raw.len() > 256 * 1024 {
        return Err("source artifacts exceed inspection limit".into());
    }
    let artifacts: Vec<serde_json::Value> =
        serde_json::from_str(raw).map_err(|_| "source artifacts are malformed")?;
    let artifact = artifacts
        .get(index as usize)
        .ok_or("source artifact index not found")?;
    let object = artifact.as_object().ok_or("source artifact is malformed")?;
    if object.len() != 3
        || !object.contains_key("content")
        || !object.get("kind").is_some_and(serde_json::Value::is_string)
        || !object
            .get("title")
            .is_some_and(serde_json::Value::is_string)
    {
        return Err("source artifact is not a canonical run artifact".into());
    }
    let bytes = serde_json::to_vec(artifact).map_err(|_| "source artifact cannot be serialized")?;
    let len = u32::try_from(bytes.len()).map_err(|_| "source artifact size overflow")?;
    Ok((digest(&bytes), len))
}

fn next_revision(current: Option<u64>, expected: Option<u64>) -> Result<u64, String> {
    match (current, expected) {
        (None, None) => Ok(1),
        (Some(current), Some(expected)) if current == expected => current
            .checked_add(1)
            .ok_or_else(|| "work program revision overflow".into()),
        _ => Err("stale work program revision; reload before saving".into()),
    }
}

fn replay_matches(prior: &str, next: &str) -> Result<(), String> {
    if prior == next {
        Ok(())
    } else {
        Err("idempotency key conflicts with prior input".into())
    }
}

fn request_key(org: u64, actor: Identity, key: &str) -> String {
    digest(format!("{org}:{}:{key}", actor.to_hex()).as_bytes())
}

fn hash_json(value: &serde_json::Value) -> Result<String, String> {
    serde_json::to_vec(value)
        .map(|bytes| digest(&bytes))
        .map_err(|_| "cannot hash work program request".into())
}

fn digest(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

fn require_hash(value: &str) -> Result<(), String> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err("content hash must be lowercase SHA-256 hex".into())
    }
}

fn slug(name: &str, value: &str) -> Result<(), String> {
    identifier(name, value, 128)?;
    if value.starts_with('-')
        || value.ends_with('-')
        || !value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
        })
    {
        Err(format!("{name} must be a lowercase identifier"))
    } else {
        Ok(())
    }
}

fn reference(name: &str, value: &str) -> Result<(), String> {
    identifier(name, value, 160)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"._-:@/".contains(&byte))
    {
        return Err(format!("{name} must be an ASCII versioned reference"));
    }
    Ok(())
}

fn identifier(name: &str, value: &str, max: usize) -> Result<(), String> {
    if value.is_empty()
        || value.len() > max
        || value
            .chars()
            .any(|ch| ch.is_whitespace() || ch.is_control())
    {
        Err(format!("{name} must be a bounded non-whitespace reference"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> serde_json::Value {
        serde_json::json!({"schemaVersion":1,"programKey":"expense-review","version":1,
            "module":"expenses","reviewedSkillKey":"expense_evidence_review","applicationContract":"v0.3.163",
            "graphHash":"a".repeat(64),"inputSchemaRef":"expense-input:v1","outputSchemaRef":"review-output:v1",
            "codeArtifacts":[],"runtimeProfiles":[]})
    }

    #[test]
    fn manifest_is_canonical_and_rejects_authority_or_admission_fields() {
        let valid = manifest();
        let (_, canonical) = prepare_manifest(&valid.to_string()).expect("valid draft");
        assert_eq!(
            canonical,
            prepare_manifest(&canonical).expect("canonical draft").1
        );
        for key in [
            "organizationId",
            "companyId",
            "actorIdentity",
            "certified",
            "published",
            "sql",
            "credential",
        ] {
            let mut forged = valid.clone();
            forged[key] = serde_json::json!("forged");
            assert!(
                prepare_manifest(&forged.to_string()).is_err(),
                "accepted {key}"
            );
        }
    }

    #[test]
    fn manifest_rejects_invalid_versions_modules_and_pins() {
        for (field, value) in [
            ("version", serde_json::json!(0)),
            ("module", serde_json::json!("manufacturing")),
            ("applicationContract", serde_json::json!("latest")),
            ("graphHash", serde_json::json!("A".repeat(64))),
        ] {
            let mut invalid = manifest();
            invalid[field] = value;
            assert!(prepare_manifest(&invalid.to_string()).is_err());
        }
        let mut invalid = manifest();
        invalid["codeArtifacts"] = serde_json::json!([{"key":"analysis","version":1,"sha256":"b".repeat(64)},
            {"key":"analysis","version":2,"sha256":"c".repeat(64)}]);
        assert!(prepare_manifest(&invalid.to_string()).is_err());
    }

    #[test]
    fn native_draft_references_match_gateway_manifest_grammar() {
        for (field, bad) in [
            ("reviewedSkillKey", "Expense.review"),
            ("applicationContract", "v0.3.163?active=true"),
            ("inputSchemaRef", "schema:révision"),
            ("outputSchemaRef", "schema&output"),
        ] {
            let mut invalid = manifest();
            invalid[field] = serde_json::json!(bad);
            assert!(
                prepare_manifest(&invalid.to_string()).is_err(),
                "accepted {field}"
            );
        }
    }

    #[test]
    fn stale_revision_and_changed_replay_cannot_overwrite_history() {
        assert_eq!(next_revision(None, None).expect("new"), 1);
        assert_eq!(next_revision(Some(1), Some(1)).expect("next"), 2);
        assert!(next_revision(None, Some(1)).is_err());
        assert!(next_revision(Some(2), Some(1)).is_err());
        assert!(next_revision(Some(1), None).is_err());
        assert!(next_revision(Some(u64::MAX), Some(u64::MAX)).is_err());
        assert!(replay_matches("same", "same").is_ok());
        assert!(replay_matches("old", "new").is_err());
    }

    #[test]
    fn output_nomination_binds_exact_server_artifact_content() {
        let source = r#"[{"kind":"report","title":"Review","content":{"total":5}}]"#;
        let (original, bytes) = source_artifact(Some(source), 0).expect("original");
        assert!(bytes > 0);
        assert_ne!(
            original,
            source_artifact(Some(&source.replace('5', "6")), 0)
                .expect("changed")
                .0
        );
        assert!(source_artifact(Some(source), 1).is_err());
        assert!(source_artifact(None, 0).is_err());
        assert!(source_artifact(Some(r#"[{"url":"https://example.org"}]"#), 0).is_err());
        assert!(source_artifact(Some("[null]"), 0).is_err());
    }
}
