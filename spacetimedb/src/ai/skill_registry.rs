//! Additive AI skill versioning, release provenance, and run policy snapshots.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::skills::{
    ai_agent_run, ai_skill, ai_skill_config, AiAgentRun, AiSkill, AiSkillConfig,
};
use crate::core::organization::require_company_in_organization;
use crate::core::users::find_user_profile_for_identity;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::workflow::authorization::require_workflow_company_access;

const MANIFEST_SCHEMA_VERSION: u64 = 1;
const MAX_MANIFEST_LEN: usize = 256_000;
const MAX_REVIEW_NOTES_LEN: usize = 8_000;
const MAX_POLICY_ITEMS: usize = 128;
const MAX_POLICY_ITEM_LEN: usize = 512;
const MAX_STEPS: u32 = 32;
const MAX_TOOL_CALLS: u32 = 64;
const MAX_FIXTURE_JSON_LEN: usize = 64_000;
const MAX_FIXTURE_NAME_LEN: usize = 120;
const MAX_FIXTURE_KEY_LEN: usize = 160;
const MAX_CERTIFICATION_ENVIRONMENT_JSON_LEN: usize = 256_000;
const MAX_CERTIFICATION_DATASET_RESOURCES: usize = 128;
const MAX_CERTIFICATION_VIRTUAL_FILES: usize = 256;
const MAX_CERTIFICATION_VIRTUAL_PATH_LEN: usize = 512;
const MAX_IDEMPOTENCY_KEY_LEN: usize = 160;
const MAX_EXECUTOR_RUN_ID_LEN: usize = 240;
const MAX_ERROR_CODE_LEN: usize = 120;
const CERTIFICATION_CLAIM_LEASE_MICROS: i64 = 5 * 60 * 1_000_000;
const MAX_CERTIFICATION_ATTEMPTS: u32 = 5;

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum AiSkillRisk {
    Green,
    Amber,
    Red,
}

impl AiSkillRisk {
    fn from_manifest(value: &str) -> Result<Self, String> {
        match value {
            "green" => Ok(Self::Green),
            "amber" => Ok(Self::Amber),
            "red" => Ok(Self::Red),
            _ => Err("manifest risk must be green, amber, or red".to_string()),
        }
    }

    fn as_manifest_str(&self) -> &'static str {
        match self {
            Self::Green => "green",
            Self::Amber => "amber",
            Self::Red => "red",
        }
    }
}

/// An immutable, reviewed version of a legacy `AiSkill`.
///
/// No reducer updates or deletes rows in this table. The unique `version_key`
/// enforces one canonical version per organization and skill.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill_version,
    public,
    index(
        accessor = ai_skill_version_registry_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_skill_version_registry_by_skill,
        btree(columns = [skill_id])
    )
)]
pub struct AiSkillVersion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub version_key: String,
    pub organization_id: u64,
    pub skill_id: u64,
    pub skill_key: String,
    pub version: String,
    pub manifest_schema_version: u32,
    pub manifest_json: String,
    pub source_hash: String,
    pub risk: AiSkillRisk,
    pub max_steps: u32,
    pub max_tool_calls: u32,
    pub permissions: Vec<String>,
    pub resources: Vec<String>,
    pub output_types: Vec<String>,
    pub reviewed_by: Identity,
    pub reviewed_at: Timestamp,
    pub review_notes: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

/// Append-only promotion/rollback history for an AI skill.
///
/// A transition only updates the prior row's `is_active` flag and inserts a new
/// active row, preserving the complete release lineage.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill_release,
    public,
    index(
        accessor = ai_skill_release_registry_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_skill_release_registry_by_version,
        btree(columns = [skill_version_id])
    )
)]
pub struct AiSkillRelease {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub skill_id: u64,
    pub skill_version_id: u64,
    pub release_number: u64,
    pub is_active: bool,
    /// `promote` or `rollback`.
    pub action: String,
    pub previous_release_id: Option<u64>,
    pub rollback_target_release_id: Option<u64>,
    pub released_by: Identity,
    pub released_at: Timestamp,
    pub reason: Option<String>,
}

/// Deterministic fixture input/output contract for a skill version review gate.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill_fixture,
    public,
    index(
        accessor = ai_skill_fixture_registry_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_skill_fixture_registry_by_skill,
        btree(columns = [skill_id])
    )
)]
pub struct AiSkillFixture {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub fixture_key: String,
    pub organization_id: u64,
    pub skill_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub input_json: String,
    pub expected_output_json: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

/// Immutable synthetic dataset and virtual-files snapshot used to certify one fixture.
///
/// The newest row for a fixture is authoritative. Replacing an environment
/// inserts a new row, preserving the environment bound to historical evidence.
/// This table is public so the dedicated gateway executor can load it through
/// SQL; environments must therefore contain only bounded, non-sensitive
/// synthetic fixture data.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill_certification_environment,
    public,
    index(
        accessor = ai_skill_certification_environment_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_skill_certification_environment_by_fixture,
        btree(columns = [fixture_id])
    )
)]
pub struct AiSkillCertificationEnvironment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub environment_key: String,
    pub organization_id: u64,
    pub skill_id: u64,
    pub fixture_id: u64,
    pub dataset_json: String,
    pub virtual_files_json: String,
    pub environment_fingerprint: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

/// Active executor build accepted for organization certification.
///
/// Only a platform superuser can insert and activate profiles. Certification
/// reducers require the exact configured executor identity, preventing ordinary
/// skill administrators from recording their own fixture outcomes.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill_certification_runtime_profile,
    public,
    index(
        accessor = ai_skill_certification_runtime_profile_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_skill_certification_runtime_profile_by_executor,
        btree(columns = [executor_identity])
    )
)]
pub struct AiSkillCertificationRuntimeProfile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub profile_key: String,
    pub organization_id: u64,
    pub runtime_hash: String,
    pub executor_identity: Identity,
    pub is_active: bool,
    pub registered_by: Identity,
    pub registered_at: Timestamp,
    pub retired_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum AiSkillCertificationRequestStatus {
    Queued,
    Running,
    Completed,
    Errored,
}

impl AiSkillCertificationRequestStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Errored => "errored",
        }
    }
}

fn certification_claim_is_stale(claimed_at_micros: Option<i64>, now_micros: i64) -> bool {
    claimed_at_micros.is_some_and(|claimed_at| {
        now_micros.saturating_sub(claimed_at) >= CERTIFICATION_CLAIM_LEASE_MICROS
    })
}

fn next_certification_attempt(current: u32) -> Result<u32, String> {
    if current >= MAX_CERTIFICATION_ATTEMPTS {
        return Err("certification request has exhausted its claim attempts".to_string());
    }
    current
        .checked_add(1)
        .ok_or_else(|| "certification attempt count overflow".to_string())
}

/// User-requested certification job. It contains no asserted result.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill_certification_request,
    public,
    index(
        accessor = ai_skill_certification_request_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_skill_certification_request_by_version,
        btree(columns = [skill_version_id])
    )
)]
pub struct AiSkillCertificationRequest {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub request_key: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub skill_id: u64,
    pub skill_version_id: u64,
    pub fixture_id: u64,
    pub status: AiSkillCertificationRequestStatus,
    pub requested_by: Identity,
    pub requested_at: Timestamp,
    pub requester_superuser_bypass: bool,
    pub attempt_count: u32,
    pub certification_environment_id: Option<u64>,
    pub runtime_profile_id: Option<u64>,
    pub claimed_by: Option<Identity>,
    pub claimed_at: Option<Timestamp>,
    pub terminal_at: Option<Timestamp>,
    pub error_code: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum AiSkillTestRunStatus {
    Passed,
    Failed,
}

impl AiSkillTestRunStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Passed => "passed",
            Self::Failed => "failed",
        }
    }
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum AiSkillTestRunFailureKind {
    Assertion,
    Execution,
}

/// Legacy caller-recorded fixture result.
///
/// No reducer writes this table anymore. It remains unchanged for additive
/// schema compatibility; promotion ignores these rows.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill_test_run,
    public,
    index(
        accessor = ai_skill_test_run_registry_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_skill_test_run_registry_by_version,
        btree(columns = [skill_version_id])
    ),
    index(
        accessor = ai_skill_test_run_registry_by_fixture,
        btree(columns = [fixture_id])
    )
)]
pub struct AiSkillTestRun {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub skill_id: u64,
    pub skill_version_id: u64,
    pub fixture_id: u64,
    pub status: AiSkillTestRunStatus,
    pub actual_output_json: String,
    pub output_fingerprint: String,
    pub failure_reason: Option<String>,
    pub executed_by: Identity,
    pub executed_at: Timestamp,
    pub metadata: Option<String>,
}

/// Immutable, redacted server-executed certification evidence.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill_certification_evidence,
    public,
    index(
        accessor = ai_skill_certification_evidence_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_skill_certification_evidence_by_version,
        btree(columns = [skill_version_id])
    ),
    index(
        accessor = ai_skill_certification_evidence_by_fixture,
        btree(columns = [fixture_id])
    )
)]
pub struct AiSkillCertificationEvidence {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub skill_id: u64,
    pub skill_version_id: u64,
    pub fixture_id: u64,
    #[unique]
    pub certification_request_id: u64,
    pub certification_environment_id: u64,
    pub runtime_profile_id: u64,
    pub status: AiSkillTestRunStatus,
    pub output_fingerprint: String,
    pub source_hash: String,
    pub manifest_hash: String,
    pub fixture_hash: String,
    pub runtime_hash: String,
    pub environment_hash: String,
    pub policy_snapshot_hash: String,
    pub execution_evidence_hash: String,
    pub executor_run_id: String,
    pub failure_kind: Option<AiSkillTestRunFailureKind>,
    pub failure_reason: Option<String>,
    pub executed_by: Identity,
    pub executed_at: Timestamp,
    pub metadata: Option<String>,
}

/// Immutable effective policy recorded for one legacy `AiAgentRun`.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_agent_run_policy_snapshot,
    public,
    index(
        accessor = ai_agent_run_policy_snapshot_registry_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_agent_run_policy_snapshot_registry_by_release,
        btree(columns = [release_id])
    )
)]
pub struct AiAgentRunPolicySnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub run_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub skill_id: u64,
    pub skill_config_id: Option<u64>,
    pub release_id: u64,
    pub skill_version_id: u64,
    pub version: String,
    pub source_hash: String,
    pub risk: AiSkillRisk,
    pub manifest_json: String,
    pub max_steps: u32,
    pub max_tool_calls: u32,
    pub permissions: Vec<String>,
    pub resources: Vec<String>,
    pub output_types: Vec<String>,
    pub config_json: String,
    pub custom_instructions: Option<String>,
    pub tool_overrides: Vec<String>,
    pub recorded_by: Identity,
    pub recorded_at: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiSkillVersionParams {
    pub skill_id: u64,
    /// Canonical JSON: compact, lexicographically ordered object keys, and no
    /// insignificant whitespace. Policy arrays must be sorted and unique.
    pub manifest_json: String,
    pub review_notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiSkillFixtureParams {
    pub skill_id: u64,
    pub fixture_key: String,
    pub name: String,
    pub description: Option<String>,
    pub input_json: String,
    pub expected_output_json: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiSkillCertificationEnvironmentParams {
    pub fixture_id: u64,
    pub environment_key: String,
    pub dataset_json: String,
    pub virtual_files_json: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RegisterAiSkillCertificationRuntimeProfileParams {
    pub profile_key: String,
    pub runtime_hash: String,
    pub executor_identity: Identity,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RequestAiSkillCertificationParams {
    pub company_id: u64,
    pub skill_version_id: u64,
    pub fixture_id: u64,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CompleteAiSkillCertificationParams {
    pub request_id: u64,
    pub actual_output_json: String,
    pub environment_hash: String,
    pub policy_snapshot_hash: String,
    pub execution_evidence_hash: String,
    pub executor_run_id: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct FailAiSkillCertificationParams {
    pub request_id: u64,
    pub error_code: String,
    pub failure_reason: String,
    pub environment_hash: String,
    pub policy_snapshot_hash: String,
    pub execution_evidence_hash: String,
    pub executor_run_id: String,
    pub metadata: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct ValidatedManifest {
    schema_version: u32,
    skill_key: String,
    version: String,
    source_hash: String,
    risk: AiSkillRisk,
    max_steps: u32,
    max_tool_calls: u32,
    permissions: Vec<String>,
    resources: Vec<String>,
    output_types: Vec<String>,
}

#[reducer]
pub fn create_ai_skill_version(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiSkillVersionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "create")?;

    let skill = load_available_skill(ctx, organization_id, params.skill_id)?;
    validate_optional_text(
        "review_notes",
        params.review_notes.as_deref(),
        MAX_REVIEW_NOTES_LEN,
    )?;

    let manifest = validate_manifest(&params.manifest_json, &skill.skill_key)?;
    let version_key = format!(
        "{}:{}:{}",
        organization_id, params.skill_id, manifest.version
    );
    if ctx
        .db
        .ai_skill_version()
        .version_key()
        .find(&version_key)
        .is_some()
    {
        return Err("skill version already exists".to_string());
    }

    let row = ctx.db.ai_skill_version().insert(AiSkillVersion {
        id: 0,
        version_key,
        organization_id,
        skill_id: params.skill_id,
        skill_key: manifest.skill_key,
        version: manifest.version.clone(),
        manifest_schema_version: manifest.schema_version,
        manifest_json: params.manifest_json,
        source_hash: manifest.source_hash.clone(),
        risk: manifest.risk.clone(),
        max_steps: manifest.max_steps,
        max_tool_calls: manifest.max_tool_calls,
        permissions: manifest.permissions,
        resources: manifest.resources,
        output_types: manifest.output_types,
        reviewed_by: ctx.sender(),
        reviewed_at: ctx.timestamp,
        review_notes: params.review_notes,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_skill_version",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "skill_id": row.skill_id,
                    "version": row.version,
                    "source_hash": row.source_hash,
                    "risk": row.risk.as_manifest_str(),
                    "reviewed_by": row.reviewed_by.to_hex().to_string(),
                })
                .to_string(),
            ),
            changed_fields: vec![
                "version".to_string(),
                "manifest_json".to_string(),
                "reviewed_by".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn promote_ai_skill_version(
    ctx: &ReducerContext,
    organization_id: u64,
    skill_version_id: u64,
    reason: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "write")?;
    validate_optional_text("reason", reason.as_deref(), MAX_REVIEW_NOTES_LEN)?;

    let version = load_org_version(ctx, organization_id, skill_version_id)?;
    let skill = load_available_skill(ctx, organization_id, version.skill_id)?;
    if !skill.is_active {
        return Err("skill is not active".to_string());
    }

    require_independent_release_actor(ctx, &version)?;
    ensure_fixtures_passed_for_version(ctx, organization_id, version.skill_id, version.id)?;
    transition_release(ctx, organization_id, &version, "promote", None, reason)?;
    Ok(())
}

#[reducer]
pub fn create_ai_skill_fixture(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiSkillFixtureParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "create")?;
    let skill = load_available_skill(ctx, organization_id, params.skill_id)?;
    validate_canonical_text("fixture_key", &params.fixture_key, MAX_FIXTURE_KEY_LEN)?;
    validate_canonical_text("name", &params.name, MAX_FIXTURE_NAME_LEN)?;
    validate_optional_text(
        "description",
        params.description.as_deref(),
        MAX_REVIEW_NOTES_LEN,
    )?;
    validate_fixture_json("input_json", &params.input_json)?;
    validate_fixture_json("expected_output_json", &params.expected_output_json)?;

    let fixture_key = format!(
        "{}:{}:{}",
        organization_id, params.skill_id, params.fixture_key
    );
    if ctx
        .db
        .ai_skill_fixture()
        .fixture_key()
        .find(&fixture_key)
        .is_some()
    {
        return Err("fixture key already exists".to_string());
    }

    let row = ctx.db.ai_skill_fixture().insert(AiSkillFixture {
        id: 0,
        fixture_key,
        organization_id,
        skill_id: params.skill_id,
        name: params.name,
        description: params.description,
        input_json: params.input_json,
        expected_output_json: params.expected_output_json,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_skill_fixture",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "skill_id": row.skill_id,
                    "skill_key": skill.skill_key,
                    "name": row.name,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "fixture_key".to_string(),
                "input_json".to_string(),
                "expected_output_json".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn create_ai_skill_certification_environment(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiSkillCertificationEnvironmentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "create")?;
    validate_canonical_text(
        "environment_key",
        &params.environment_key,
        MAX_FIXTURE_KEY_LEN,
    )?;
    validate_certification_environment_json("dataset_json", &params.dataset_json, false)?;
    validate_certification_environment_json(
        "virtual_files_json",
        &params.virtual_files_json,
        true,
    )?;
    validate_optional_text("metadata", params.metadata.as_deref(), MAX_REVIEW_NOTES_LEN)?;

    let fixture = load_org_fixture(ctx, organization_id, params.fixture_id)?;
    let environment_key = format!(
        "{}:{}:{}",
        organization_id, fixture.id, params.environment_key
    );
    if ctx
        .db
        .ai_skill_certification_environment()
        .environment_key()
        .find(&environment_key)
        .is_some()
    {
        return Err("certification environment key already exists".to_string());
    }

    let environment_fingerprint = certification_environment_fingerprint(
        organization_id,
        fixture.skill_id,
        fixture.id,
        &params.dataset_json,
        &params.virtual_files_json,
    );
    let row = ctx
        .db
        .ai_skill_certification_environment()
        .insert(AiSkillCertificationEnvironment {
            id: 0,
            environment_key,
            organization_id,
            skill_id: fixture.skill_id,
            fixture_id: fixture.id,
            dataset_json: params.dataset_json,
            virtual_files_json: params.virtual_files_json,
            environment_fingerprint,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            metadata: params.metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_skill_certification_environment",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "skill_id": row.skill_id,
                    "fixture_id": row.fixture_id,
                    "environment_fingerprint": row.environment_fingerprint,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "dataset_json".to_string(),
                "virtual_files_json".to_string(),
                "environment_fingerprint".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn register_ai_skill_certification_runtime_profile(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RegisterAiSkillCertificationRuntimeProfileParams,
) -> Result<(), String> {
    require_superuser(ctx)?;
    ensure_dedicated_executor_identity(ctx.sender(), params.executor_identity)?;
    validate_canonical_text("profile_key", &params.profile_key, MAX_FIXTURE_KEY_LEN)?;
    validate_sha256("runtime_hash", &params.runtime_hash)?;
    validate_optional_text("metadata", params.metadata.as_deref(), MAX_REVIEW_NOTES_LEN)?;

    let profile_key = format!("{organization_id}:{}", params.profile_key);
    if ctx
        .db
        .ai_skill_certification_runtime_profile()
        .profile_key()
        .find(&profile_key)
        .is_some()
    {
        return Err("certification runtime profile already exists".to_string());
    }

    let active_profiles = ctx
        .db
        .ai_skill_certification_runtime_profile()
        .ai_skill_certification_runtime_profile_by_org()
        .filter(&organization_id)
        .filter(|profile| profile.is_active)
        .collect::<Vec<_>>();
    for profile in active_profiles {
        ctx.db.ai_skill_certification_runtime_profile().id().update(
            AiSkillCertificationRuntimeProfile {
                is_active: false,
                retired_at: Some(ctx.timestamp),
                ..profile
            },
        );
    }

    let row = ctx.db.ai_skill_certification_runtime_profile().insert(
        AiSkillCertificationRuntimeProfile {
            id: 0,
            profile_key,
            organization_id,
            runtime_hash: params.runtime_hash,
            executor_identity: params.executor_identity,
            is_active: true,
            registered_by: ctx.sender(),
            registered_at: ctx.timestamp,
            retired_at: None,
            metadata: params.metadata,
        },
    );

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_skill_certification_runtime_profile",
            record_id: row.id,
            action: "ACTIVATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "runtime_hash": row.runtime_hash,
                    "executor_identity": row.executor_identity.to_hex().to_string(),
                })
                .to_string(),
            ),
            changed_fields: vec![
                "runtime_hash".to_string(),
                "executor_identity".to_string(),
                "is_active".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

fn ensure_dedicated_executor_identity(
    registrant: Identity,
    executor_identity: Identity,
) -> Result<(), String> {
    if registrant == executor_identity {
        return Err(
            "certification executor identity must be distinct from the registering administrator"
                .to_string(),
        );
    }
    Ok(())
}

#[reducer]
pub fn request_ai_skill_certification(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RequestAiSkillCertificationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "write")?;
    let superuser_bypass =
        require_workflow_company_access(ctx, organization_id, params.company_id, ctx.sender())?;
    validate_canonical_text(
        "idempotency_key",
        &params.idempotency_key,
        MAX_IDEMPOTENCY_KEY_LEN,
    )?;

    let version = load_org_version(ctx, organization_id, params.skill_version_id)?;
    let fixture = load_org_fixture(ctx, organization_id, params.fixture_id)?;
    if fixture.skill_id != version.skill_id {
        return Err("fixture does not belong to the version skill".to_string());
    }

    let request_key = format!(
        "{}:{}:{}",
        organization_id,
        ctx.sender().to_hex(),
        sha256_fingerprint(params.idempotency_key.as_bytes())
    );
    if let Some(existing) = ctx
        .db
        .ai_skill_certification_request()
        .request_key()
        .find(&request_key)
    {
        if existing.company_id == params.company_id
            && existing.skill_version_id == version.id
            && existing.fixture_id == fixture.id
        {
            return Ok(());
        }
        return Err(
            "idempotency key is already bound to another certification request".to_string(),
        );
    }

    let row = ctx
        .db
        .ai_skill_certification_request()
        .insert(AiSkillCertificationRequest {
            id: 0,
            request_key,
            organization_id,
            company_id: params.company_id,
            skill_id: version.skill_id,
            skill_version_id: version.id,
            fixture_id: fixture.id,
            status: AiSkillCertificationRequestStatus::Queued,
            requested_by: ctx.sender(),
            requested_at: ctx.timestamp,
            requester_superuser_bypass: superuser_bypass,
            attempt_count: 0,
            certification_environment_id: None,
            runtime_profile_id: None,
            claimed_by: None,
            claimed_at: None,
            terminal_at: None,
            error_code: None,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "ai_skill_certification_request",
            record_id: row.id,
            action: "REQUEST",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "skill_version_id": version.id,
                    "fixture_id": row.fixture_id,
                    "status": row.status.as_str(),
                    "requester_superuser_bypass": superuser_bypass,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn claim_ai_skill_certification(
    ctx: &ReducerContext,
    organization_id: u64,
    request_id: u64,
) -> Result<(), String> {
    let request = load_org_certification_request(ctx, organization_id, request_id)?;
    let profile = load_active_runtime_for_executor(ctx, organization_id, ctx.sender())?;
    let action = match request.status {
        AiSkillCertificationRequestStatus::Queued => "CLAIM",
        AiSkillCertificationRequestStatus::Running => {
            ensure_no_certification_evidence(ctx, request.id)?;
            if !certification_claim_is_stale(
                request
                    .claimed_at
                    .map(|timestamp| timestamp.to_micros_since_unix_epoch()),
                ctx.timestamp.to_micros_since_unix_epoch(),
            ) {
                return Err("certification request claim lease is still active".to_string());
            }
            if request.attempt_count >= MAX_CERTIFICATION_ATTEMPTS {
                terminalize_exhausted_certification_request(ctx, &request);
                return Ok(());
            }
            "RECLAIM"
        }
        AiSkillCertificationRequestStatus::Completed
        | AiSkillCertificationRequestStatus::Errored => {
            return Err("certification request is already terminal".to_string());
        }
    };
    let attempt_count = next_certification_attempt(request.attempt_count)?;
    let environment =
        load_current_certification_environment(ctx, organization_id, request.fixture_id)?;

    ctx.db
        .ai_skill_certification_request()
        .id()
        .update(AiSkillCertificationRequest {
            status: AiSkillCertificationRequestStatus::Running,
            runtime_profile_id: Some(profile.id),
            claimed_by: Some(ctx.sender()),
            claimed_at: Some(ctx.timestamp),
            attempt_count,
            certification_environment_id: Some(environment.id),
            ..request.clone()
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(request.company_id),
            table_name: "ai_skill_certification_request",
            record_id: request.id,
            action,
            old_values: Some(
                serde_json::json!({
                    "status": request.status.as_str(),
                    "attempt_count": request.attempt_count,
                    "claimed_by": request.claimed_by.map(|identity| identity.to_hex().to_string()),
                    "runtime_profile_id": request.runtime_profile_id,
                    "certification_environment_id": request.certification_environment_id,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "status": "running",
                    "attempt_count": attempt_count,
                    "certification_environment_id": environment.id,
                    "environment_hash": environment.environment_fingerprint,
                    "runtime_profile_id": profile.id,
                    "runtime_hash": profile.runtime_hash,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "status".to_string(),
                "attempt_count".to_string(),
                "certification_environment_id".to_string(),
                "runtime_profile_id".to_string(),
                "claimed_by".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn complete_ai_skill_certification(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CompleteAiSkillCertificationParams,
) -> Result<(), String> {
    validate_fixture_json("actual_output_json", &params.actual_output_json)?;
    validate_certification_evidence_params(
        &params.environment_hash,
        &params.policy_snapshot_hash,
        &params.execution_evidence_hash,
        &params.executor_run_id,
        params.metadata.as_deref(),
    )?;

    let (request, profile) = load_claimed_certification(ctx, organization_id, params.request_id)?;
    ensure_no_certification_evidence(ctx, request.id)?;
    let version = load_org_version(ctx, organization_id, request.skill_version_id)?;
    let fixture = load_org_fixture(ctx, organization_id, request.fixture_id)?;
    validate_request_version_fixture(&request, &version, &fixture)?;
    let environment = load_pinned_certification_environment(ctx, &request)?;
    validate_submitted_environment(&environment, &params.environment_hash)?;

    let passed = json_values_equal(&params.actual_output_json, &fixture.expected_output_json);
    let status = if passed {
        AiSkillTestRunStatus::Passed
    } else {
        AiSkillTestRunStatus::Failed
    };
    let failure_kind = if passed {
        None
    } else {
        Some(AiSkillTestRunFailureKind::Assertion)
    };
    let failure_reason = if passed {
        None
    } else {
        Some("actual output did not match fixture expectation".to_string())
    };
    let output_fingerprint = sha256_fingerprint(params.actual_output_json.as_bytes());

    let evidence = insert_certification_evidence(
        ctx,
        &request,
        &profile,
        &version,
        &fixture,
        &environment,
        status.clone(),
        output_fingerprint,
        params.policy_snapshot_hash,
        params.execution_evidence_hash,
        params.executor_run_id,
        failure_kind,
        failure_reason,
        params.metadata,
    );

    ctx.db
        .ai_skill_certification_request()
        .id()
        .update(AiSkillCertificationRequest {
            status: AiSkillCertificationRequestStatus::Completed,
            terminal_at: Some(ctx.timestamp),
            ..request.clone()
        });
    write_certification_terminal_audit(ctx, &request, &evidence, "COMPLETE", status.as_str());
    Ok(())
}

#[reducer]
pub fn fail_ai_skill_certification(
    ctx: &ReducerContext,
    organization_id: u64,
    params: FailAiSkillCertificationParams,
) -> Result<(), String> {
    validate_canonical_text("error_code", &params.error_code, MAX_ERROR_CODE_LEN)?;
    validate_required_text(
        "failure_reason",
        &params.failure_reason,
        MAX_REVIEW_NOTES_LEN,
    )?;
    validate_certification_evidence_params(
        &params.environment_hash,
        &params.policy_snapshot_hash,
        &params.execution_evidence_hash,
        &params.executor_run_id,
        params.metadata.as_deref(),
    )?;

    let (request, profile) = load_claimed_certification(ctx, organization_id, params.request_id)?;
    ensure_no_certification_evidence(ctx, request.id)?;
    let version = load_org_version(ctx, organization_id, request.skill_version_id)?;
    let fixture = load_org_fixture(ctx, organization_id, request.fixture_id)?;
    validate_request_version_fixture(&request, &version, &fixture)?;
    let environment = load_pinned_certification_environment(ctx, &request)?;
    validate_submitted_environment(&environment, &params.environment_hash)?;

    let evidence = insert_certification_evidence(
        ctx,
        &request,
        &profile,
        &version,
        &fixture,
        &environment,
        AiSkillTestRunStatus::Failed,
        sha256_fingerprint(&[]),
        params.policy_snapshot_hash,
        params.execution_evidence_hash,
        params.executor_run_id,
        Some(AiSkillTestRunFailureKind::Execution),
        Some(params.failure_reason),
        params.metadata,
    );
    ctx.db
        .ai_skill_certification_request()
        .id()
        .update(AiSkillCertificationRequest {
            status: AiSkillCertificationRequestStatus::Errored,
            terminal_at: Some(ctx.timestamp),
            error_code: Some(params.error_code),
            ..request.clone()
        });
    write_certification_terminal_audit(ctx, &request, &evidence, "FAIL", "failed");
    Ok(())
}

#[reducer]
pub fn rollback_ai_skill_release(
    ctx: &ReducerContext,
    organization_id: u64,
    skill_id: u64,
    target_release_id: u64,
    reason: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "write")?;
    validate_required_text("reason", &reason, MAX_REVIEW_NOTES_LEN)?;

    let skill = load_available_skill(ctx, organization_id, skill_id)?;
    if !skill.is_active {
        return Err("skill is not active".to_string());
    }

    let target = ctx
        .db
        .ai_skill_release()
        .id()
        .find(&target_release_id)
        .ok_or("target release not found")?;
    if target.organization_id != organization_id || target.skill_id != skill_id {
        return Err("target release does not belong to this organization and skill".to_string());
    }
    if target.is_active {
        return Err("target release is already active".to_string());
    }

    let version = load_org_version(ctx, organization_id, target.skill_version_id)?;
    require_independent_release_actor(ctx, &version)?;
    ensure_fixtures_passed_for_version(ctx, organization_id, skill_id, version.id)?;
    let current = load_active_release(ctx, organization_id, skill_id)?
        .ok_or("skill has no active release to roll back")?;
    if current.released_by == ctx.sender() || target.released_by == ctx.sender() {
        return Err(
            "rollback requires an approver independent of both release transitions".to_string(),
        );
    }
    transition_release(
        ctx,
        organization_id,
        &version,
        "rollback",
        Some(target_release_id),
        Some(reason),
    )?;
    Ok(())
}

/// Capture the currently active release and effective legacy skill config in the
/// same transaction. `expected_release_id` lets a caller reject a stale policy
/// decision rather than silently snapshotting a newer release.
#[reducer]
pub fn record_ai_agent_run_policy_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    expected_release_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent_run", "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    let run = load_company_run(ctx, organization_id, company_id, run_id)?;
    let skill = load_available_skill(ctx, organization_id, run.skill_id)?;
    if !skill.is_active {
        return Err("skill is not active".to_string());
    }
    if !matches!(run.status.as_str(), "pending" | "running") {
        return Err("run is not active".to_string());
    }
    if ctx
        .db
        .ai_agent_run_policy_snapshot()
        .run_id()
        .find(&run_id)
        .is_some()
    {
        return Err("run policy snapshot already exists".to_string());
    }

    let release = load_active_release(ctx, organization_id, run.skill_id)?
        .ok_or("skill has no active release")?;
    if let Some(expected) = expected_release_id {
        if release.id != expected {
            return Err("active release does not match expected_release_id".to_string());
        }
    }
    let version = load_org_version(ctx, organization_id, release.skill_version_id)?;
    if version.skill_id != run.skill_id {
        return Err("active release version does not match run skill".to_string());
    }

    let config = load_effective_config(ctx, &run)?;
    let (config_json, custom_instructions, tool_overrides) = match config {
        Some(config) => (
            config.config_json,
            config.custom_instructions,
            config.tool_overrides,
        ),
        None => ("{}".to_string(), None, Vec::new()),
    };

    let row = ctx
        .db
        .ai_agent_run_policy_snapshot()
        .insert(AiAgentRunPolicySnapshot {
            id: 0,
            run_id,
            organization_id,
            company_id,
            skill_id: run.skill_id,
            skill_config_id: run.skill_config_id,
            release_id: release.id,
            skill_version_id: version.id,
            version: version.version.clone(),
            source_hash: version.source_hash.clone(),
            risk: version.risk.clone(),
            manifest_json: version.manifest_json,
            max_steps: version.max_steps,
            max_tool_calls: version.max_tool_calls,
            permissions: version.permissions,
            resources: version.resources,
            output_types: version.output_types,
            config_json,
            custom_instructions,
            tool_overrides,
            recorded_by: ctx.sender(),
            recorded_at: ctx.timestamp,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_agent_run_policy_snapshot",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "run_id": run_id,
                    "release_id": row.release_id,
                    "skill_version_id": row.skill_version_id,
                    "version": row.version,
                    "source_hash": row.source_hash,
                    "risk": row.risk.as_manifest_str(),
                })
                .to_string(),
            ),
            changed_fields: vec![
                "release_id".to_string(),
                "skill_version_id".to_string(),
                "manifest_json".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

fn transition_release(
    ctx: &ReducerContext,
    organization_id: u64,
    version: &AiSkillVersion,
    action: &'static str,
    rollback_target_release_id: Option<u64>,
    reason: Option<String>,
) -> Result<AiSkillRelease, String> {
    let current = load_active_release(ctx, organization_id, version.skill_id)?;
    if current
        .as_ref()
        .is_some_and(|release| release.skill_version_id == version.id)
    {
        return Err("skill version is already active".to_string());
    }

    let release_number = next_release_number(ctx, organization_id, version.skill_id)?;
    let previous_release_id = current.as_ref().map(|release| release.id);
    if let Some(current) = current {
        ctx.db.ai_skill_release().id().update(AiSkillRelease {
            is_active: false,
            ..current
        });
    }

    let row = ctx.db.ai_skill_release().insert(AiSkillRelease {
        id: 0,
        organization_id,
        skill_id: version.skill_id,
        skill_version_id: version.id,
        release_number,
        is_active: true,
        action: action.to_string(),
        previous_release_id,
        rollback_target_release_id,
        released_by: ctx.sender(),
        released_at: ctx.timestamp,
        reason,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_skill_release",
            record_id: row.id,
            action: if action == "rollback" {
                "ROLLBACK"
            } else {
                "PROMOTE"
            },
            old_values: previous_release_id
                .map(|id| serde_json::json!({ "active_release_id": id }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "active_release_id": row.id,
                    "skill_id": row.skill_id,
                    "skill_version_id": row.skill_version_id,
                    "release_number": row.release_number,
                    "version": version.version,
                })
                .to_string(),
            ),
            changed_fields: vec!["active_release_id".to_string()],
            metadata: None,
        },
    );

    Ok(row)
}

fn load_available_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    skill_id: u64,
) -> Result<AiSkill, String> {
    let skill = ctx
        .db
        .ai_skill()
        .id()
        .find(&skill_id)
        .ok_or("skill not found")?;
    if skill.organization_id != organization_id && skill.organization_id != 0 {
        return Err("skill is not available for this organization".to_string());
    }
    Ok(skill)
}

fn load_org_version(
    ctx: &ReducerContext,
    organization_id: u64,
    skill_version_id: u64,
) -> Result<AiSkillVersion, String> {
    let version = ctx
        .db
        .ai_skill_version()
        .id()
        .find(&skill_version_id)
        .ok_or("skill version not found")?;
    if version.organization_id != organization_id {
        return Err("skill version does not belong to this organization".to_string());
    }
    Ok(version)
}

fn load_org_fixture(
    ctx: &ReducerContext,
    organization_id: u64,
    fixture_id: u64,
) -> Result<AiSkillFixture, String> {
    let fixture = ctx
        .db
        .ai_skill_fixture()
        .id()
        .find(&fixture_id)
        .ok_or("fixture not found")?;
    if fixture.organization_id != organization_id {
        return Err("fixture does not belong to this organization".to_string());
    }
    Ok(fixture)
}

fn load_current_certification_environment(
    ctx: &ReducerContext,
    organization_id: u64,
    fixture_id: u64,
) -> Result<AiSkillCertificationEnvironment, String> {
    ctx.db
        .ai_skill_certification_environment()
        .ai_skill_certification_environment_by_fixture()
        .filter(&fixture_id)
        .filter(|environment| environment.organization_id == organization_id)
        .max_by_key(|environment| environment.id)
        .ok_or("fixture has no certification environment".to_string())
}

fn load_pinned_certification_environment(
    ctx: &ReducerContext,
    request: &AiSkillCertificationRequest,
) -> Result<AiSkillCertificationEnvironment, String> {
    let environment_id = request
        .certification_environment_id
        .ok_or("certification request has no pinned environment")?;
    let environment = ctx
        .db
        .ai_skill_certification_environment()
        .id()
        .find(&environment_id)
        .ok_or("pinned certification environment not found")?;
    if environment.organization_id != request.organization_id
        || environment.skill_id != request.skill_id
        || environment.fixture_id != request.fixture_id
    {
        return Err("pinned certification environment does not match the request".to_string());
    }
    Ok(environment)
}

fn validate_submitted_environment(
    environment: &AiSkillCertificationEnvironment,
    submitted_hash: &str,
) -> Result<(), String> {
    validate_submitted_environment_hash(&environment.environment_fingerprint, submitted_hash)
}

fn validate_submitted_environment_hash(
    stored_hash: &str,
    submitted_hash: &str,
) -> Result<(), String> {
    validate_sha256("environment_hash", submitted_hash)?;
    if submitted_hash != stored_hash {
        return Err(
            "environment_hash does not match the current fixture certification environment"
                .to_string(),
        );
    }
    Ok(())
}

fn load_org_certification_request(
    ctx: &ReducerContext,
    organization_id: u64,
    request_id: u64,
) -> Result<AiSkillCertificationRequest, String> {
    let request = ctx
        .db
        .ai_skill_certification_request()
        .id()
        .find(&request_id)
        .ok_or("certification request not found")?;
    if request.organization_id != organization_id {
        return Err("certification request does not belong to this organization".to_string());
    }
    Ok(request)
}

fn load_active_runtime_for_executor(
    ctx: &ReducerContext,
    organization_id: u64,
    executor_identity: Identity,
) -> Result<AiSkillCertificationRuntimeProfile, String> {
    let mut profiles = ctx
        .db
        .ai_skill_certification_runtime_profile()
        .ai_skill_certification_runtime_profile_by_executor()
        .filter(&executor_identity)
        .filter(|profile| profile.organization_id == organization_id && profile.is_active);
    let profile = profiles
        .next()
        .ok_or("caller is not the active certification executor")?;
    if profiles.next().is_some() {
        return Err("multiple active certification runtime profiles exist".to_string());
    }
    Ok(profile)
}

fn load_active_runtime_profile(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<AiSkillCertificationRuntimeProfile, String> {
    let mut profiles = ctx
        .db
        .ai_skill_certification_runtime_profile()
        .ai_skill_certification_runtime_profile_by_org()
        .filter(&organization_id)
        .filter(|profile| profile.is_active);
    let profile = profiles
        .next()
        .ok_or("organization has no active certification runtime profile")?;
    if profiles.next().is_some() {
        return Err("organization has multiple active certification runtime profiles".to_string());
    }
    Ok(profile)
}

fn load_claimed_certification(
    ctx: &ReducerContext,
    organization_id: u64,
    request_id: u64,
) -> Result<
    (
        AiSkillCertificationRequest,
        AiSkillCertificationRuntimeProfile,
    ),
    String,
> {
    let request = load_org_certification_request(ctx, organization_id, request_id)?;
    if request.status != AiSkillCertificationRequestStatus::Running {
        return Err("certification request is not running".to_string());
    }
    if request.claimed_by != Some(ctx.sender()) {
        return Err("certification request is claimed by another executor".to_string());
    }
    let profile_id = request
        .runtime_profile_id
        .ok_or("certification request has no runtime profile")?;
    let profile = ctx
        .db
        .ai_skill_certification_runtime_profile()
        .id()
        .find(&profile_id)
        .ok_or("certification runtime profile not found")?;
    // A request pins its runtime profile when claimed. Permit that exact
    // executor/profile pair to finish after profile rotation so requests are not
    // stranded in Running. Promotion still rejects evidence from a retired
    // profile through `ensure_fixtures_passed_for_version`.
    if profile.organization_id != organization_id || profile.executor_identity != ctx.sender() {
        return Err(
            "certification runtime profile does not match the claimed executor".to_string(),
        );
    }
    Ok((request, profile))
}

fn ensure_no_certification_evidence(
    ctx: &ReducerContext,
    certification_request_id: u64,
) -> Result<(), String> {
    if ctx
        .db
        .ai_skill_certification_evidence()
        .certification_request_id()
        .find(&certification_request_id)
        .is_some()
    {
        return Err("certification request already has terminal evidence".to_string());
    }
    Ok(())
}

fn validate_request_version_fixture(
    request: &AiSkillCertificationRequest,
    version: &AiSkillVersion,
    fixture: &AiSkillFixture,
) -> Result<(), String> {
    if request.skill_id != version.skill_id
        || request.skill_version_id != version.id
        || request.fixture_id != fixture.id
        || fixture.skill_id != version.skill_id
    {
        return Err("certification request version and fixture no longer match".to_string());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_certification_evidence(
    ctx: &ReducerContext,
    request: &AiSkillCertificationRequest,
    profile: &AiSkillCertificationRuntimeProfile,
    version: &AiSkillVersion,
    fixture: &AiSkillFixture,
    environment: &AiSkillCertificationEnvironment,
    status: AiSkillTestRunStatus,
    output_fingerprint: String,
    policy_snapshot_hash: String,
    execution_evidence_hash: String,
    executor_run_id: String,
    failure_kind: Option<AiSkillTestRunFailureKind>,
    failure_reason: Option<String>,
    metadata: Option<String>,
) -> AiSkillCertificationEvidence {
    ctx.db
        .ai_skill_certification_evidence()
        .insert(AiSkillCertificationEvidence {
            id: 0,
            organization_id: request.organization_id,
            company_id: request.company_id,
            skill_id: request.skill_id,
            skill_version_id: request.skill_version_id,
            fixture_id: request.fixture_id,
            certification_request_id: request.id,
            certification_environment_id: environment.id,
            runtime_profile_id: profile.id,
            status,
            output_fingerprint,
            source_hash: version.source_hash.clone(),
            manifest_hash: sha256_fingerprint(version.manifest_json.as_bytes()),
            fixture_hash: fixture_fingerprint(fixture),
            runtime_hash: profile.runtime_hash.clone(),
            environment_hash: environment.environment_fingerprint.clone(),
            policy_snapshot_hash,
            execution_evidence_hash,
            executor_run_id,
            failure_kind,
            failure_reason,
            executed_by: ctx.sender(),
            executed_at: ctx.timestamp,
            metadata,
        })
}

fn write_certification_terminal_audit(
    ctx: &ReducerContext,
    request: &AiSkillCertificationRequest,
    evidence: &AiSkillCertificationEvidence,
    action: &'static str,
    status: &'static str,
) {
    write_audit_log_v2(
        ctx,
        request.organization_id,
        AuditLogParams {
            company_id: Some(request.company_id),
            table_name: "ai_skill_certification_evidence",
            record_id: evidence.id,
            action,
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "certification_request_id": request.id,
                    "skill_version_id": request.skill_version_id,
                    "fixture_id": request.fixture_id,
                    "runtime_profile_id": evidence.runtime_profile_id,
                    "status": status,
                    "output_fingerprint": evidence.output_fingerprint,
                    "execution_evidence_hash": evidence.execution_evidence_hash,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string(), "output_fingerprint".to_string()],
            metadata: None,
        },
    );
}

fn terminalize_exhausted_certification_request(
    ctx: &ReducerContext,
    request: &AiSkillCertificationRequest,
) {
    const ERROR_CODE: &str = "max_attempts_exceeded";
    ctx.db
        .ai_skill_certification_request()
        .id()
        .update(AiSkillCertificationRequest {
            status: AiSkillCertificationRequestStatus::Errored,
            terminal_at: Some(ctx.timestamp),
            error_code: Some(ERROR_CODE.to_string()),
            ..request.clone()
        });
    write_audit_log_v2(
        ctx,
        request.organization_id,
        AuditLogParams {
            company_id: Some(request.company_id),
            table_name: "ai_skill_certification_request",
            record_id: request.id,
            action: "EXHAUST",
            old_values: Some(
                serde_json::json!({
                    "status": "running",
                    "attempt_count": request.attempt_count,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "status": "errored",
                    "error_code": ERROR_CODE,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "status".to_string(),
                "terminal_at".to_string(),
                "error_code".to_string(),
            ],
            metadata: None,
        },
    );
}

fn ensure_fixtures_passed_for_version(
    ctx: &ReducerContext,
    organization_id: u64,
    skill_id: u64,
    skill_version_id: u64,
) -> Result<(), String> {
    let active_profile = load_active_runtime_profile(ctx, organization_id)?;
    let version = load_org_version(ctx, organization_id, skill_version_id)?;
    if version.skill_id != skill_id {
        return Err("skill version does not match promotion skill".to_string());
    }
    let expected_manifest_hash = sha256_fingerprint(version.manifest_json.as_bytes());
    let fixtures = ctx
        .db
        .ai_skill_fixture()
        .ai_skill_fixture_registry_by_org()
        .filter(&organization_id)
        .filter(|row| row.skill_id == skill_id)
        .collect::<Vec<_>>();
    if fixtures.is_empty() {
        return Err("skill version requires at least one certification fixture".to_string());
    }

    for fixture in fixtures {
        let expected_fixture_hash = fixture_fingerprint(&fixture);
        let environment = load_current_certification_environment(ctx, organization_id, fixture.id)?;
        let expected_environment_hash = certification_environment_fingerprint(
            organization_id,
            skill_id,
            fixture.id,
            &environment.dataset_json,
            &environment.virtual_files_json,
        );
        if environment.skill_id != skill_id
            || environment.environment_fingerprint != expected_environment_hash
        {
            return Err(format!(
                "fixture '{}' has invalid certification environment provenance",
                fixture.name
            ));
        }
        let latest = ctx
            .db
            .ai_skill_certification_evidence()
            .ai_skill_certification_evidence_by_version()
            .filter(&skill_version_id)
            .filter(|run| run.fixture_id == fixture.id)
            .max_by_key(|run| run.id);
        let Some(run) = latest else {
            return Err(format!(
                "fixture '{}' is not currently passing for this version",
                fixture.name
            ));
        };
        let request =
            load_org_certification_request(ctx, organization_id, run.certification_request_id)?;
        let valid = run.status == AiSkillTestRunStatus::Passed
            && run.failure_kind.is_none()
            && run.skill_id == skill_id
            && run.company_id == request.company_id
            && run.certification_environment_id == environment.id
            && run.environment_hash == expected_environment_hash
            && run.runtime_profile_id == active_profile.id
            && run.runtime_hash == active_profile.runtime_hash
            && run.source_hash == version.source_hash
            && run.manifest_hash == expected_manifest_hash
            && run.fixture_hash == expected_fixture_hash
            && request.status == AiSkillCertificationRequestStatus::Completed
            && request.skill_version_id == skill_version_id
            && request.fixture_id == fixture.id
            && request.certification_environment_id == Some(environment.id)
            && request.runtime_profile_id == Some(active_profile.id)
            && request.claimed_by == Some(run.executed_by)
            && is_valid_sha256(&run.output_fingerprint)
            && is_valid_sha256(&run.policy_snapshot_hash)
            && is_valid_sha256(&run.execution_evidence_hash);
        if !valid {
            return Err(format!(
                "fixture '{}' has stale or invalid certification evidence",
                fixture.name
            ));
        }
    }
    Ok(())
}

/// The person who authored or reviewed a version cannot promote it. This keeps
/// the immutable review record and release decision independently attributable.
fn require_independent_release_actor(
    ctx: &ReducerContext,
    version: &AiSkillVersion,
) -> Result<(), String> {
    if version.created_by == ctx.sender() || version.reviewed_by == ctx.sender() {
        return Err(
            "skill release requires an approver independent of the version author and reviewer"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_fixture_json(field: &str, raw: &str) -> Result<(), String> {
    if raw.is_empty() {
        return Err(format!("{field} is required"));
    }
    if raw.len() > MAX_FIXTURE_JSON_LEN {
        return Err(format!("{field} is too long"));
    }
    let value: Value =
        serde_json::from_str(raw).map_err(|error| format!("invalid {field}: {error}"))?;
    if value.to_string() != raw {
        return Err(format!("{field} must use canonical compact JSON"));
    }
    Ok(())
}

fn json_values_equal(left: &str, right: &str) -> bool {
    let Ok(left_value) = serde_json::from_str::<Value>(left) else {
        return false;
    };
    let Ok(right_value) = serde_json::from_str::<Value>(right) else {
        return false;
    };
    left_value == right_value
}

fn sha256_fingerprint(raw: &[u8]) -> String {
    let digest = Sha256::digest(raw);
    format!("sha256:{digest:x}")
}

fn fixture_fingerprint(fixture: &AiSkillFixture) -> String {
    fixture_fingerprint_parts(
        &fixture.fixture_key,
        &fixture.input_json,
        &fixture.expected_output_json,
    )
}

fn fixture_fingerprint_parts(
    fixture_key: &str,
    input_json: &str,
    expected_output_json: &str,
) -> String {
    let mut hasher = Sha256::new();
    for value in [
        fixture_key.as_bytes(),
        input_json.as_bytes(),
        expected_output_json.as_bytes(),
    ] {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value);
    }
    format!("sha256:{:x}", hasher.finalize())
}

pub(crate) fn certification_environment_fingerprint(
    organization_id: u64,
    skill_id: u64,
    fixture_id: u64,
    dataset_json: &str,
    virtual_files_json: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"lumiere.ai.certification.environment.v1");
    for value in [organization_id, skill_id, fixture_id] {
        hasher.update(value.to_be_bytes());
    }
    for value in [dataset_json.as_bytes(), virtual_files_json.as_bytes()] {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value);
    }
    format!("sha256:{:x}", hasher.finalize())
}

fn validate_certification_environment_json(
    field: &str,
    raw: &str,
    virtual_files: bool,
) -> Result<(), String> {
    if raw.is_empty() {
        return Err(format!("{field} is required"));
    }
    if raw.len() > MAX_CERTIFICATION_ENVIRONMENT_JSON_LEN {
        return Err(format!("{field} is too long"));
    }
    let value: Value =
        serde_json::from_str(raw).map_err(|error| format!("invalid {field}: {error}"))?;
    if value.to_string() != raw {
        return Err(format!("{field} must use canonical compact JSON"));
    }
    let entries = value.as_object().ok_or_else(|| {
        format!("{field} must be an object mapping resource or file names to fixture data")
    })?;
    if !virtual_files {
        if entries.len() > MAX_CERTIFICATION_DATASET_RESOURCES {
            return Err("dataset_json has too many resource entries".to_string());
        }
        for resource in entries.keys() {
            validate_canonical_text("dataset_resource", resource, MAX_POLICY_ITEM_LEN)?;
        }
        return Ok(());
    }

    if entries.len() > MAX_CERTIFICATION_VIRTUAL_FILES {
        return Err("virtual_files_json has too many files".to_string());
    }
    for (path, contents) in entries {
        validate_virtual_file_path(path)?;
        if !contents.is_string() {
            return Err(format!(
                "virtual file '{path}' content must be represented as a string"
            ));
        }
    }
    Ok(())
}

fn validate_virtual_file_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > MAX_CERTIFICATION_VIRTUAL_PATH_LEN
        || path != path.trim()
        || path.starts_with(['/', '\\', '~'])
        || path.contains(['\\', ':'])
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err(format!(
            "virtual file path '{path}' must be a safe normalized relative path"
        ));
    }
    Ok(())
}

fn is_valid_sha256(value: &str) -> bool {
    let Some(digest) = value.strip_prefix("sha256:") else {
        return false;
    };
    digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_sha256(field: &str, value: &str) -> Result<(), String> {
    if !is_valid_sha256(value) {
        return Err(format!(
            "{field} must be a lowercase SHA-256 digest prefixed by sha256:"
        ));
    }
    Ok(())
}

fn validate_certification_evidence_params(
    environment_hash: &str,
    policy_snapshot_hash: &str,
    execution_evidence_hash: &str,
    executor_run_id: &str,
    metadata: Option<&str>,
) -> Result<(), String> {
    validate_sha256("environment_hash", environment_hash)?;
    validate_sha256("policy_snapshot_hash", policy_snapshot_hash)?;
    validate_sha256("execution_evidence_hash", execution_evidence_hash)?;
    validate_canonical_text("executor_run_id", executor_run_id, MAX_EXECUTOR_RUN_ID_LEN)?;
    validate_optional_text("metadata", metadata, MAX_REVIEW_NOTES_LEN)
}

fn require_superuser(ctx: &ReducerContext) -> Result<(), String> {
    let user = find_user_profile_for_identity(ctx, ctx.sender()).ok_or("User not found")?;
    if !user.is_active || !user.is_superuser {
        return Err(
            "only an active platform superuser may register certification runtimes".to_string(),
        );
    }
    Ok(())
}

fn load_active_release(
    ctx: &ReducerContext,
    organization_id: u64,
    skill_id: u64,
) -> Result<Option<AiSkillRelease>, String> {
    let mut rows = ctx
        .db
        .ai_skill_release()
        .ai_skill_release_registry_by_org()
        .filter(&organization_id)
        .filter(|row| row.skill_id == skill_id && row.is_active);
    let active = rows.next();
    if rows.next().is_some() {
        return Err("skill has multiple active releases".to_string());
    }
    Ok(active)
}

fn next_release_number(
    ctx: &ReducerContext,
    organization_id: u64,
    skill_id: u64,
) -> Result<u64, String> {
    let latest = ctx
        .db
        .ai_skill_release()
        .ai_skill_release_registry_by_org()
        .filter(&organization_id)
        .filter(|row| row.skill_id == skill_id)
        .map(|row| row.release_number)
        .max()
        .unwrap_or(0);
    latest
        .checked_add(1)
        .ok_or_else(|| "release number overflow".to_string())
}

fn load_company_run(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
) -> Result<AiAgentRun, String> {
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&run_id)
        .ok_or("run not found")?;
    if run.organization_id != organization_id {
        return Err("run does not belong to this organization".to_string());
    }
    if run.company_id != company_id {
        return Err("run does not belong to this company".to_string());
    }
    Ok(run)
}

fn load_effective_config(
    ctx: &ReducerContext,
    run: &AiAgentRun,
) -> Result<Option<AiSkillConfig>, String> {
    let Some(config_id) = run.skill_config_id else {
        return Ok(None);
    };
    let config = ctx
        .db
        .ai_skill_config()
        .id()
        .find(&config_id)
        .ok_or("skill config not found")?;
    if config.organization_id != run.organization_id || config.skill_id != run.skill_id {
        return Err("skill config does not match run organization and skill".to_string());
    }
    if config.company_id.is_some_and(|id| id != run.company_id) {
        return Err("skill config does not apply to run company".to_string());
    }
    if !config.is_enabled {
        return Err("skill config is disabled".to_string());
    }
    Ok(Some(config))
}

fn validate_manifest(raw: &str, expected_skill_key: &str) -> Result<ValidatedManifest, String> {
    if raw.is_empty() {
        return Err("manifest_json is required".to_string());
    }
    if raw.len() > MAX_MANIFEST_LEN {
        return Err("manifest_json is too long".to_string());
    }

    let value: Value =
        serde_json::from_str(raw).map_err(|error| format!("invalid manifest_json: {error}"))?;
    if value.to_string() != raw {
        return Err("manifest_json must use canonical compact JSON".to_string());
    }
    let object = value
        .as_object()
        .ok_or("manifest_json must be a JSON object")?;

    let schema_version = required_u32(object, "schema_version")?;
    if u64::from(schema_version) != MANIFEST_SCHEMA_VERSION {
        return Err(format!(
            "manifest schema_version must be {MANIFEST_SCHEMA_VERSION}"
        ));
    }

    let skill_key = required_string(object, "skill_key")?;
    if skill_key != expected_skill_key {
        return Err("manifest skill_key does not match skill".to_string());
    }
    validate_canonical_text("skill_key", &skill_key, MAX_POLICY_ITEM_LEN)?;

    let version = required_string(object, "version")?;
    if !is_valid_semver(&version) {
        return Err(
            "manifest version must be canonical semantic version MAJOR.MINOR.PATCH".to_string(),
        );
    }

    let source_hash = required_string(object, "source_hash")?;
    if !is_valid_source_hash(&source_hash) {
        return Err(
            "manifest source_hash must be a lowercase SHA-256 hex digest, optionally prefixed by sha256:"
                .to_string(),
        );
    }

    let risk = AiSkillRisk::from_manifest(&required_string(object, "risk")?)?;
    let limits = object
        .get("limits")
        .and_then(Value::as_object)
        .ok_or("manifest limits must be an object")?;
    let max_steps = required_u32(limits, "max_steps")?;
    let max_tool_calls = required_u32(limits, "max_tool_calls")?;
    if max_steps == 0 || max_steps > MAX_STEPS {
        return Err(format!(
            "manifest limits.max_steps must be between 1 and {MAX_STEPS}"
        ));
    }
    if max_tool_calls == 0 || max_tool_calls > MAX_TOOL_CALLS {
        return Err(format!(
            "manifest limits.max_tool_calls must be between 1 and {MAX_TOOL_CALLS}"
        ));
    }

    let permissions = required_policy_array(object, "permissions", false)?;
    let resources = required_policy_array(object, "resources", false)?;
    let output_types = required_policy_array(object, "output_types", true)?;
    for output_type in &output_types {
        if output_type.chars().any(char::is_whitespace) {
            return Err("manifest output_types entries cannot contain whitespace".to_string());
        }
    }

    Ok(ValidatedManifest {
        schema_version,
        skill_key,
        version,
        source_hash,
        risk,
        max_steps,
        max_tool_calls,
        permissions,
        resources,
        output_types,
    })
}

fn required_string(object: &Map<String, Value>, field: &str) -> Result<String, String> {
    object
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("manifest {field} must be a string"))
}

fn required_u32(object: &Map<String, Value>, field: &str) -> Result<u32, String> {
    let value = object
        .get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("manifest {field} must be an unsigned integer"))?;
    u32::try_from(value).map_err(|_| format!("manifest {field} is too large"))
}

fn required_policy_array(
    object: &Map<String, Value>,
    field: &str,
    require_nonempty: bool,
) -> Result<Vec<String>, String> {
    let values = object
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("manifest {field} must be an array"))?;
    if values.len() > MAX_POLICY_ITEMS {
        return Err(format!("manifest {field} has too many entries"));
    }
    if require_nonempty && values.is_empty() {
        return Err(format!("manifest {field} must not be empty"));
    }

    let mut result = Vec::with_capacity(values.len());
    for value in values {
        let item = value
            .as_str()
            .ok_or_else(|| format!("manifest {field} entries must be strings"))?;
        validate_canonical_text(field, item, MAX_POLICY_ITEM_LEN)?;
        result.push(item.to_string());
    }
    if !result.windows(2).all(|items| items[0] < items[1]) {
        return Err(format!(
            "manifest {field} entries must be sorted and unique"
        ));
    }
    Ok(result)
}

fn validate_canonical_text(field: &str, value: &str, max_len: usize) -> Result<(), String> {
    if value.is_empty() || value != value.trim() {
        return Err(format!(
            "manifest {field} entries must be non-empty and trimmed"
        ));
    }
    if value.len() > max_len {
        return Err(format!("manifest {field} entry is too long"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!(
            "manifest {field} entries cannot contain control characters"
        ));
    }
    Ok(())
}

fn validate_optional_text(field: &str, value: Option<&str>, max_len: usize) -> Result<(), String> {
    if let Some(value) = value {
        validate_required_text(field, value, max_len)?;
    }
    Ok(())
}

fn validate_required_text(field: &str, value: &str, max_len: usize) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field} is required"));
    }
    if value.len() > max_len {
        return Err(format!("{field} is too long"));
    }
    Ok(())
}

fn is_valid_source_hash(value: &str) -> bool {
    let digest = value.strip_prefix("sha256:").unwrap_or(value);
    digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_valid_semver(value: &str) -> bool {
    let (without_build, build) = match value.split_once('+') {
        Some((base, build)) if !build.is_empty() && !build.contains('+') => (base, Some(build)),
        Some(_) => return false,
        None => (value, None),
    };
    let (core, prerelease) = match without_build.split_once('-') {
        Some((core, prerelease)) if !prerelease.is_empty() => (core, Some(prerelease)),
        Some(_) => return false,
        None => (without_build, None),
    };

    let mut core_parts = core.split('.');
    let valid_core = (0..3).all(|_| core_parts.next().is_some_and(is_canonical_number))
        && core_parts.next().is_none();
    valid_core
        && prerelease.is_none_or(|part| valid_semver_identifiers(part, true))
        && build.is_none_or(|part| valid_semver_identifiers(part, false))
}

fn is_canonical_number(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
}

fn valid_semver_identifiers(value: &str, reject_numeric_leading_zero: bool) -> bool {
    value.split('.').all(|identifier| {
        !identifier.is_empty()
            && identifier
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            && (!reject_numeric_leading_zero
                || !identifier.bytes().all(|byte| byte.is_ascii_digit())
                || is_canonical_number(identifier))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_manifest() -> String {
        serde_json::json!({
            "limits": { "max_steps": 8, "max_tool_calls": 16 },
            "output_types": ["application/json"],
            "permissions": ["crm.lead.read", "crm.lead.write"],
            "resources": ["crm.lead"],
            "risk": "amber",
            "schema_version": 1,
            "skill_key": "lead-enrichment",
            "source_hash": format!("sha256:{}", "a".repeat(64)),
            "version": "1.2.3-rc.1+build.7"
        })
        .to_string()
    }

    #[test]
    fn validates_canonical_manifest_policy() {
        let manifest = validate_manifest(&valid_manifest(), "lead-enrichment").unwrap();
        assert_eq!(manifest.version, "1.2.3-rc.1+build.7");
        assert_eq!(manifest.risk, AiSkillRisk::Amber);
        assert_eq!(manifest.max_steps, 8);
        assert_eq!(manifest.output_types, vec!["application/json"]);
    }

    #[test]
    fn rejects_noncanonical_json_and_unsorted_policy() {
        let noncanonical = format!(" {}", valid_manifest());
        assert!(validate_manifest(&noncanonical, "lead-enrichment")
            .unwrap_err()
            .contains("canonical"));

        let unsorted = serde_json::json!({
            "limits": { "max_steps": 8, "max_tool_calls": 16 },
            "output_types": ["application/json"],
            "permissions": ["write", "read"],
            "resources": [],
            "risk": "green",
            "schema_version": 1,
            "skill_key": "lead-enrichment",
            "source_hash": "b".repeat(64),
            "version": "1.0.0"
        })
        .to_string();
        assert!(validate_manifest(&unsorted, "lead-enrichment")
            .unwrap_err()
            .contains("sorted and unique"));
    }

    #[test]
    fn json_values_equal_compares_canonical_structures() {
        assert!(json_values_equal(
            r#"{"a":1,"b":[2]}"#,
            r#"{"a":1,"b":[2]}"#
        ));
        assert!(!json_values_equal(r#"{"a":1}"#, r#"{"a":2}"#));
    }

    #[test]
    fn validates_semver_and_source_hash_formats() {
        assert!(is_valid_semver("0.1.0"));
        assert!(is_valid_semver("1.0.0-alpha.1+linux-x86"));
        assert!(!is_valid_semver("01.0.0"));
        assert!(!is_valid_semver("1.0"));

        assert!(is_valid_source_hash(&"c".repeat(64)));
        assert!(is_valid_source_hash(&format!("sha256:{}", "0".repeat(64))));
        assert!(!is_valid_source_hash(&"C".repeat(64)));
        assert!(!is_valid_source_hash("sha256:abc"));
    }

    #[test]
    fn certification_executor_must_be_distinct_from_registrant() {
        let administrator = Identity::from_byte_array([1; 32]);
        let executor = Identity::from_byte_array([2; 32]);

        assert!(ensure_dedicated_executor_identity(administrator, executor).is_ok());
        assert!(ensure_dedicated_executor_identity(administrator, administrator).is_err());
    }

    #[test]
    fn certification_hashes_use_sha256_with_framed_fixture_parts() {
        assert_eq!(
            sha256_fingerprint(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_ne!(
            fixture_fingerprint_parts("ab", "c", "{}"),
            fixture_fingerprint_parts("a", "bc", "{}")
        );
        assert!(is_valid_sha256(&sha256_fingerprint(b"evidence")));
        assert!(!is_valid_sha256(&"a".repeat(64)));
    }

    #[test]
    fn certification_evidence_requires_bounded_prefixed_hashes() {
        let digest = format!("sha256:{}", "a".repeat(64));
        assert!(validate_certification_evidence_params(
            &digest,
            &digest,
            &digest,
            "executor-run-1",
            Some("{\"provider\":\"test\"}")
        )
        .is_ok());
        assert!(validate_certification_evidence_params(
            &"a".repeat(64),
            &digest,
            &digest,
            "executor-run-1",
            None
        )
        .is_err());
        assert!(
            validate_certification_evidence_params(&digest, &digest, &digest, " ", None).is_err()
        );
    }

    #[test]
    fn certification_environment_is_canonical_scoped_and_path_safe() {
        let dataset = r#"{"inventory.low_stock.v1":{"rows":[]}}"#;
        let files = r#"{"input/request.json":"{}"}"#;
        assert!(validate_certification_environment_json("dataset_json", dataset, false).is_ok());
        assert!(validate_certification_environment_json("virtual_files_json", files, true).is_ok());
        assert!(validate_certification_environment_json("dataset_json", "[]", false).is_err());
        assert!(validate_certification_environment_json(
            "virtual_files_json",
            r#"{"../secret":"x"}"#,
            true
        )
        .is_err());
        assert!(validate_certification_environment_json(
            "virtual_files_json",
            r#"{"safe.txt":{"content":"x"}}"#,
            true
        )
        .is_err());

        let first = certification_environment_fingerprint(1, 2, 3, dataset, files);
        let changed_scope = certification_environment_fingerprint(1, 2, 4, dataset, files);
        let changed_files =
            certification_environment_fingerprint(1, 2, 3, dataset, r#"{"input/other":"x"}"#);
        assert!(is_valid_sha256(&first));
        assert_ne!(first, changed_scope);
        assert_ne!(first, changed_files);
        assert!(validate_submitted_environment_hash(&first, &first).is_ok());
        assert!(validate_submitted_environment_hash(&first, &changed_files).is_err());
    }

    #[test]
    fn stale_claims_are_bounded_and_retryable() {
        let claimed_at = 1_000_000_i64;
        assert!(!certification_claim_is_stale(
            Some(claimed_at),
            claimed_at + CERTIFICATION_CLAIM_LEASE_MICROS - 1
        ));
        assert!(certification_claim_is_stale(
            Some(claimed_at),
            claimed_at + CERTIFICATION_CLAIM_LEASE_MICROS
        ));
        assert!(!certification_claim_is_stale(None, i64::MAX));

        assert_eq!(next_certification_attempt(0), Ok(1));
        assert_eq!(
            next_certification_attempt(MAX_CERTIFICATION_ATTEMPTS - 1),
            Ok(MAX_CERTIFICATION_ATTEMPTS)
        );
        assert!(next_certification_attempt(MAX_CERTIFICATION_ATTEMPTS).is_err());
    }
}
