//! Additive AI skill versioning, release provenance, and run policy snapshots.

use serde_json::{Map, Value};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::skills::{
    ai_agent_run, ai_skill, ai_skill_config, AiAgentRun, AiSkill, AiSkillConfig,
};
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

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

/// Immutable recorded result of executing one fixture against one skill version.
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
pub struct RecordAiSkillTestRunParams {
    pub skill_version_id: u64,
    pub fixture_id: u64,
    pub actual_output_json: String,
    pub failure_reason: Option<String>,
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
pub fn record_ai_skill_test_run(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordAiSkillTestRunParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "write")?;
    validate_fixture_json("actual_output_json", &params.actual_output_json)?;
    validate_optional_text(
        "failure_reason",
        params.failure_reason.as_deref(),
        MAX_REVIEW_NOTES_LEN,
    )?;

    let version = load_org_version(ctx, organization_id, params.skill_version_id)?;
    let fixture = ctx
        .db
        .ai_skill_fixture()
        .id()
        .find(&params.fixture_id)
        .ok_or("fixture not found")?;
    if fixture.organization_id != organization_id {
        return Err("fixture does not belong to this organization".to_string());
    }
    if fixture.skill_id != version.skill_id {
        return Err("fixture does not belong to the version skill".to_string());
    }

    let status = if json_values_equal(&params.actual_output_json, &fixture.expected_output_json) {
        if params.failure_reason.is_some() {
            return Err("failure_reason cannot be set when output matches the fixture".to_string());
        }
        AiSkillTestRunStatus::Passed
    } else {
        AiSkillTestRunStatus::Failed
    };

    let row = ctx.db.ai_skill_test_run().insert(AiSkillTestRun {
        id: 0,
        organization_id,
        skill_id: version.skill_id,
        skill_version_id: version.id,
        fixture_id: fixture.id,
        status: status.clone(),
        actual_output_json: params.actual_output_json.clone(),
        output_fingerprint: output_fingerprint(&params.actual_output_json),
        failure_reason: params.failure_reason,
        executed_by: ctx.sender(),
        executed_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_skill_test_run",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "skill_version_id": row.skill_version_id,
                    "fixture_id": row.fixture_id,
                    "status": status.as_str(),
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string(), "actual_output_json".to_string()],
            metadata: None,
        },
    );

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

fn ensure_fixtures_passed_for_version(
    ctx: &ReducerContext,
    organization_id: u64,
    skill_id: u64,
    skill_version_id: u64,
) -> Result<(), String> {
    let fixtures = ctx
        .db
        .ai_skill_fixture()
        .ai_skill_fixture_registry_by_org()
        .filter(&organization_id)
        .filter(|row| row.skill_id == skill_id)
        .collect::<Vec<_>>();
    if fixtures.is_empty() {
        return Ok(());
    }

    for fixture in fixtures {
        let passed = ctx
            .db
            .ai_skill_test_run()
            .ai_skill_test_run_registry_by_version()
            .filter(&skill_version_id)
            .any(|run| run.fixture_id == fixture.id && run.status == AiSkillTestRunStatus::Passed);
        if !passed {
            return Err(format!(
                "fixture '{}' has no passing test run for this version",
                fixture.name
            ));
        }
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

fn output_fingerprint(raw: &str) -> String {
    let mut hash: u64 = 14695981039346656037;
    for byte in raw.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("fnv1a:{hash:016x}")
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
}
