//! SpacetimeDB-backed active-release gate for built-in harness skills.
//!
//! The gateway keeps only the executable adapter for a skill in code. The
//! organization-specific active release remains authoritative for whether that
//! adapter may run and for its risk, resources, output types, and limits.

use serde_json::Value;
use stdb_client::StdbClient;

use super::{
    certification, daily_briefing, distributor_controls, governed_llm_skills, import_mapping,
    insights_scan, low_stock,
    manifest::{ExecutionLimits, RiskClass, SkillManifest},
    report_composer,
};

/// Immutable candidate metadata supplied to the certification executor.
#[derive(Clone, Debug, PartialEq)]
pub struct CandidateSkillVersion {
    pub id: u64,
    pub organization_id: u64,
    pub skill_id: u64,
    pub skill_key: String,
    pub version: String,
    pub manifest_json: Value,
    pub source_hash: String,
    pub risk: RiskClass,
    pub max_steps: u32,
    pub max_tool_calls: u32,
    pub permissions: Vec<String>,
    pub resources: Vec<String>,
    pub output_types: Vec<String>,
}

/// Immutable fixture data loaded by the trusted certification worker.
#[derive(Clone, Debug, PartialEq)]
pub struct CandidateFixture {
    pub id: u64,
    pub organization_id: u64,
    pub skill_id: u64,
    pub fixture_key: String,
    pub input: Value,
    pub expected_output: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CandidateCertificationInputs {
    pub version: CandidateSkillVersion,
    pub fixture: CandidateFixture,
}

/// Exact immutable environment pinned when the certification request is claimed.
#[derive(Clone, Debug, PartialEq)]
pub struct CandidateCertificationEnvironment {
    pub id: u64,
    pub organization_id: u64,
    pub skill_id: u64,
    pub fixture_id: u64,
    pub dataset: Value,
    pub virtual_files: Value,
    pub environment_fingerprint: String,
}

/// Load an exact immutable candidate version and fixture.
///
/// This deliberately does not consult the active release: certification runs
/// before promotion. The caller must provide IDs from a claimed certification
/// request, and every ownership relationship is revalidated here.
pub async fn load_candidate_certification_inputs(
    stdb: &StdbClient,
    organization_id: u64,
    skill_version_id: u64,
    fixture_id: u64,
) -> Result<CandidateCertificationInputs, String> {
    if organization_id == 0 || skill_version_id == 0 || fixture_id == 0 {
        return Err("organization_id, skill_version_id, and fixture_id are required".to_string());
    }

    let version_rows = stdb
        .query_sql(&format!(
            "SELECT id, organization_id, skill_id, skill_key, version, manifest_json, source_hash, risk, max_steps, max_tool_calls, permissions, resources, output_types \
             FROM ai_skill_version WHERE id = {skill_version_id} AND organization_id = {organization_id} LIMIT 2"
        ))
        .await
        .map_err(|error| format!("load candidate AI skill version: {error}"))?;
    if version_rows.len() != 1 {
        return Err("candidate skill version was not found exactly once".to_string());
    }
    let version = parse_candidate_version(&version_rows[0])?;

    let fixture_rows = stdb
        .query_sql(&format!(
            "SELECT id, organization_id, skill_id, fixture_key, input_json, expected_output_json \
             FROM ai_skill_fixture WHERE id = {fixture_id} AND organization_id = {organization_id} LIMIT 2"
        ))
        .await
        .map_err(|error| format!("load candidate AI skill fixture: {error}"))?;
    if fixture_rows.len() != 1 {
        return Err("candidate skill fixture was not found exactly once".to_string());
    }
    let fixture = parse_candidate_fixture(&fixture_rows[0])?;

    if version.organization_id != organization_id || fixture.organization_id != organization_id {
        return Err("candidate version or fixture organization mismatch".to_string());
    }
    if version.skill_id != fixture.skill_id {
        return Err("candidate fixture does not belong to the version skill".to_string());
    }

    Ok(CandidateCertificationInputs { version, fixture })
}

/// Load the exact certification environment pinned to a claimed request.
///
/// The environment ID is authoritative. This function never substitutes the
/// newest environment for a fixture, so an in-flight request cannot silently
/// change underneath the executor.
pub async fn load_candidate_certification_environment(
    stdb: &StdbClient,
    organization_id: u64,
    fixture_id: u64,
    environment_id: u64,
) -> Result<CandidateCertificationEnvironment, String> {
    if organization_id == 0 || fixture_id == 0 || environment_id == 0 {
        return Err(
            "organization_id, fixture_id, and certification_environment_id are required"
                .to_string(),
        );
    }
    let rows = stdb
        .query_sql(&format!(
            "SELECT id, organization_id, skill_id, fixture_id, dataset_json, virtual_files_json, environment_fingerprint \
             FROM ai_skill_certification_environment \
             WHERE id = {environment_id} AND organization_id = {organization_id} AND fixture_id = {fixture_id} LIMIT 2"
        ))
        .await
        .map_err(|error| format!("load pinned certification environment: {error}"))?;
    if rows.len() != 1 {
        return Err("pinned certification environment was not found exactly once".to_string());
    }
    parse_candidate_environment(&rows[0])
}

pub async fn load_active_manifest(
    stdb: &StdbClient,
    organization_id: u64,
    skill_key: &str,
    expected_version: u32,
) -> Result<SkillManifest, String> {
    let skill_key = sql_literal(skill_key)?;
    let skills = stdb
        .query_sql(&format!(
            "SELECT id, organization_id FROM ai_skill WHERE skill_key = '{skill_key}' AND (organization_id = {organization_id} OR organization_id = 0) AND is_active = true LIMIT 2"
        ))
        .await
        .map_err(|error| format!("load AI skill: {error}"))?;
    let skill_id = skills
        .iter()
        .find(|row| row_u64(row, "organizationId", "organization_id") == Some(organization_id))
        .or_else(|| skills.first())
        .and_then(|row| row_u64(row, "id", "id"))
        .ok_or_else(|| "skill has no active catalog entry".to_string())?;

    let releases = stdb
        .query_sql(&format!(
            "SELECT skill_version_id FROM ai_skill_release WHERE organization_id = {organization_id} AND skill_id = {skill_id} AND is_active = true LIMIT 2"
        ))
        .await
        .map_err(|error| format!("load active AI skill release: {error}"))?;
    if releases.len() != 1 {
        return Err("skill must have exactly one active organization release".to_string());
    }
    let version_id = row_u64(&releases[0], "skillVersionId", "skill_version_id")
        .ok_or_else(|| "active skill release has no version".to_string())?;
    let versions = stdb
        .query_sql(&format!(
            "SELECT version, risk, max_steps, max_tool_calls, resources, output_types, source_hash FROM ai_skill_version WHERE id = {version_id} AND organization_id = {organization_id} LIMIT 1"
        ))
        .await
        .map_err(|error| format!("load active AI skill version: {error}"))?;
    let version = versions
        .first()
        .ok_or_else(|| "active skill version does not belong to this organization".to_string())?;
    let release_version = row_string(version, "version", "version")
        .ok_or_else(|| "active skill version is missing a semantic version".to_string())?;
    let source_hash = row_string(version, "sourceHash", "source_hash")
        .ok_or_else(|| "active skill version is missing its source hash".to_string())?;
    if !valid_source_hash(&source_hash) {
        return Err("active skill version has an invalid source hash".to_string());
    }
    validate_active_adapter_binding(&skill_key, &release_version, expected_version, &source_hash)?;

    let manifest = match skill_key.as_str() {
        distributor_controls::CREDIT_HOLD_SKILL_KEY => distributor_controls::credit_hold_manifest(),
        distributor_controls::DELIVERY_RUN_SKILL_KEY => {
            distributor_controls::delivery_run_manifest()
        }
        report_composer::REPORT_COMPOSER_SKILL_KEY => report_composer::manifest(),
        low_stock::LOW_STOCK_SKILL_KEY => low_stock::manifest(),
        import_mapping::IMPORT_MAPPING_SKILL_KEY => import_mapping::manifest(),
        insights_scan::INSIGHTS_SCAN_SKILL_KEY => insights_scan::manifest(),
        daily_briefing::DAILY_BRIEFING_SKILL_KEY => daily_briefing::manifest(),
        governed_llm_skills::REPORT_ANALYSIS_SKILL_KEY => {
            governed_llm_skills::report_analysis_manifest()
        }
        governed_llm_skills::PROCESS_RESEARCH_SKILL_KEY => {
            governed_llm_skills::process_research_manifest()
        }
        governed_llm_skills::PRICE_SEARCH_SKILL_KEY => governed_llm_skills::price_search_manifest(),
        governed_llm_skills::SUPPLIER_DISCOVERY_SKILL_KEY => {
            governed_llm_skills::supplier_discovery_manifest()
        }
        _ => return Err("gateway has no executable adapter for this released skill".to_string()),
    };
    overlay_release_policy(
        manifest,
        parse_risk(&row_string(version, "risk", "risk").unwrap_or_default())?,
        row_u64(version, "maxSteps", "max_steps").unwrap_or_default() as u32,
        row_u64(version, "maxToolCalls", "max_tool_calls").unwrap_or_default() as u32,
        string_array(version, "resources")
            .ok_or_else(|| "active skill version is missing resources".to_string())?,
        string_array(version, "outputTypes")
            .ok_or_else(|| "active skill version is missing output types".to_string())?,
    )
}

pub(crate) fn candidate_policy_manifest(
    version: &CandidateSkillVersion,
) -> Result<SkillManifest, String> {
    let manifest = match version.skill_key.as_str() {
        low_stock::LOW_STOCK_SKILL_KEY => low_stock::manifest(),
        report_composer::REPORT_COMPOSER_SKILL_KEY => report_composer::manifest(),
        import_mapping::IMPORT_MAPPING_SKILL_KEY => import_mapping::manifest(),
        insights_scan::INSIGHTS_SCAN_SKILL_KEY => insights_scan::manifest(),
        daily_briefing::DAILY_BRIEFING_SKILL_KEY => daily_briefing::manifest(),
        governed_llm_skills::REPORT_ANALYSIS_SKILL_KEY => {
            governed_llm_skills::report_analysis_manifest()
        }
        governed_llm_skills::PROCESS_RESEARCH_SKILL_KEY => {
            governed_llm_skills::process_research_manifest()
        }
        governed_llm_skills::PRICE_SEARCH_SKILL_KEY => governed_llm_skills::price_search_manifest(),
        governed_llm_skills::SUPPLIER_DISCOVERY_SKILL_KEY => {
            governed_llm_skills::supplier_discovery_manifest()
        }
        _ => return Err("candidate has no canonical built-in policy manifest".to_string()),
    };
    overlay_release_policy(
        manifest,
        version.risk,
        version.max_steps,
        version.max_tool_calls,
        version.resources.clone(),
        version.output_types.clone(),
    )
}

fn overlay_release_policy(
    mut manifest: SkillManifest,
    risk: RiskClass,
    max_steps: u32,
    max_tool_calls: u32,
    resources: Vec<String>,
    output_types: Vec<String>,
) -> Result<SkillManifest, String> {
    manifest.risk = risk;
    manifest.limits = ExecutionLimits {
        max_rows: manifest.limits.max_rows,
        max_steps,
        max_tool_calls,
    };
    manifest.named_resources = resources;
    if !output_types
        .iter()
        .any(|output| output == &manifest.output_type)
    {
        return Err("skill version does not permit the adapter output type".to_string());
    }
    if manifest.limits.max_steps == 0 || manifest.limits.max_tool_calls == 0 {
        return Err("skill version has invalid execution limits".to_string());
    }
    Ok(manifest)
}

fn validate_active_adapter_binding(
    skill_key: &str,
    release_version: &str,
    expected_version: u32,
    source_hash: &str,
) -> Result<(), String> {
    let expected_source_hash = match skill_key {
        low_stock::LOW_STOCK_SKILL_KEY => {
            if release_version != "1.0.0" {
                return Err(format!(
                    "active skill version '{release_version}' must exactly match gateway adapter 1.0.0"
                ));
            }
            Some(certification::low_stock_certification_bundle_hash())
        }
        report_composer::REPORT_COMPOSER_SKILL_KEY => {
            if release_version != "1.0.0" {
                return Err(format!(
                    "active skill version '{release_version}' must exactly match gateway adapter 1.0.0"
                ));
            }
            Some(certification::report_composer_certification_bundle_hash())
        }
        _ => {
            if semver_major(&release_version) != Some(expected_version) {
                return Err(format!(
                    "active skill version '{release_version}' is incompatible with gateway adapter v{expected_version}"
                ));
            }
            None
        }
    };
    if expected_source_hash
        .as_deref()
        .is_some_and(|expected| source_hash != expected)
    {
        return Err(
            "active built-in skill source hash does not match the dispatched gateway adapter"
                .to_string(),
        );
    }
    Ok(())
}

fn parse_candidate_version(row: &Value) -> Result<CandidateSkillVersion, String> {
    let id = required_row_u64(row, "id", "id", "candidate version id")?;
    let organization_id = required_row_u64(
        row,
        "organizationId",
        "organization_id",
        "candidate version organization",
    )?;
    let skill_id = required_row_u64(row, "skillId", "skill_id", "candidate version skill id")?;
    let skill_key =
        required_row_string(row, "skillKey", "skill_key", "candidate version skill key")?;
    let version = required_row_string(row, "version", "version", "candidate semantic version")?;
    if semver_major(&version).is_none() {
        return Err("candidate skill version has an invalid semantic version".to_string());
    }
    let manifest_raw =
        required_row_string(row, "manifestJson", "manifest_json", "candidate manifest")?;
    let manifest_json = serde_json::from_str(&manifest_raw)
        .map_err(|error| format!("candidate manifest is invalid JSON: {error}"))?;
    let source_hash =
        required_row_string(row, "sourceHash", "source_hash", "candidate source hash")?;
    if !valid_source_hash(&source_hash) {
        return Err("candidate skill version has an invalid source hash".to_string());
    }
    let risk = parse_risk(&required_row_string(row, "risk", "risk", "candidate risk")?)?;
    let max_steps = u32::try_from(required_row_u64(
        row,
        "maxSteps",
        "max_steps",
        "candidate max steps",
    )?)
    .map_err(|_| "candidate max steps exceeds u32".to_string())?;
    let max_tool_calls = u32::try_from(required_row_u64(
        row,
        "maxToolCalls",
        "max_tool_calls",
        "candidate max tool calls",
    )?)
    .map_err(|_| "candidate max tool calls exceeds u32".to_string())?;
    if max_steps == 0 || max_tool_calls == 0 {
        return Err("candidate skill version has invalid execution limits".to_string());
    }

    Ok(CandidateSkillVersion {
        id,
        organization_id,
        skill_id,
        skill_key,
        version,
        manifest_json,
        source_hash,
        risk,
        max_steps,
        max_tool_calls,
        permissions: required_string_array(row, "permissions", "candidate permissions")?,
        resources: required_string_array(row, "resources", "candidate resources")?,
        output_types: required_string_array(row, "output_types", "candidate output types")?,
    })
}

fn parse_candidate_fixture(row: &Value) -> Result<CandidateFixture, String> {
    let input_raw = required_row_string(row, "inputJson", "input_json", "candidate fixture input")?;
    let expected_raw = required_row_string(
        row,
        "expectedOutputJson",
        "expected_output_json",
        "candidate fixture expected output",
    )?;

    Ok(CandidateFixture {
        id: required_row_u64(row, "id", "id", "candidate fixture id")?,
        organization_id: required_row_u64(
            row,
            "organizationId",
            "organization_id",
            "candidate fixture organization",
        )?,
        skill_id: required_row_u64(row, "skillId", "skill_id", "candidate fixture skill id")?,
        fixture_key: required_row_string(
            row,
            "fixtureKey",
            "fixture_key",
            "candidate fixture key",
        )?,
        input: serde_json::from_str(&input_raw)
            .map_err(|error| format!("candidate fixture input is invalid JSON: {error}"))?,
        expected_output: serde_json::from_str(&expected_raw)
            .map_err(|error| format!("candidate expected output is invalid JSON: {error}"))?,
    })
}

fn parse_candidate_environment(row: &Value) -> Result<CandidateCertificationEnvironment, String> {
    let dataset_raw = required_row_string(
        row,
        "datasetJson",
        "dataset_json",
        "certification environment dataset",
    )?;
    let virtual_files_raw = required_row_string(
        row,
        "virtualFilesJson",
        "virtual_files_json",
        "certification environment virtual files",
    )?;
    let environment_fingerprint = required_row_string(
        row,
        "environmentFingerprint",
        "environment_fingerprint",
        "certification environment fingerprint",
    )?;
    if !valid_source_hash(&environment_fingerprint)
        || !environment_fingerprint.starts_with("sha256:")
    {
        return Err("certification environment fingerprint is invalid".to_string());
    }

    let dataset: Value = serde_json::from_str(&dataset_raw)
        .map_err(|error| format!("certification environment dataset is invalid JSON: {error}"))?;
    if !dataset.is_object() {
        return Err("certification environment dataset must be an object".to_string());
    }
    let virtual_files: Value = serde_json::from_str(&virtual_files_raw).map_err(|error| {
        format!("certification environment virtual files are invalid JSON: {error}")
    })?;
    if !virtual_files.is_object() {
        return Err("certification environment virtual files must be an object".to_string());
    }

    Ok(CandidateCertificationEnvironment {
        id: required_row_u64(row, "id", "id", "certification environment id")?,
        organization_id: required_row_u64(
            row,
            "organizationId",
            "organization_id",
            "certification environment organization",
        )?,
        skill_id: required_row_u64(
            row,
            "skillId",
            "skill_id",
            "certification environment skill id",
        )?,
        fixture_id: required_row_u64(
            row,
            "fixtureId",
            "fixture_id",
            "certification environment fixture id",
        )?,
        dataset,
        virtual_files,
        environment_fingerprint,
    })
}

fn required_row_u64(row: &Value, camel: &str, snake: &str, field: &str) -> Result<u64, String> {
    row_u64(row, camel, snake)
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("{field} is missing or invalid"))
}

fn required_row_string(
    row: &Value,
    camel: &str,
    snake: &str,
    field: &str,
) -> Result<String, String> {
    row_string(row, camel, snake)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{field} is missing"))
}

fn required_string_array(row: &Value, field: &str, label: &str) -> Result<Vec<String>, String> {
    string_array(row, field).ok_or_else(|| format!("{label} is missing"))
}

fn sql_literal(value: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 120 || value.chars().any(char::is_control) {
        return Err("invalid skill key".to_string());
    }
    Ok(value.replace('\'', "''"))
}

use crate::wire_decode::{row_u64, snake_to_camel};

fn row_string(row: &Value, camel: &str, snake: &str) -> Option<String> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn string_array(row: &Value, field: &str) -> Option<Vec<String>> {
    let camel = snake_to_camel(field);
    row.get(&camel)
        .or_else(|| row.get(field))
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
}



fn semver_major(value: &str) -> Option<u32> {
    value.split('.').next()?.parse().ok()
}

fn parse_risk(value: &str) -> Result<RiskClass, String> {
    match value.to_ascii_lowercase().as_str() {
        "green" => Ok(RiskClass::Green),
        "amber" => Ok(RiskClass::Amber),
        "red" => Ok(RiskClass::Red),
        _ => Err("active skill version has an invalid risk class".to_string()),
    }
}

fn valid_source_hash(value: &str) -> bool {
    let digest = value.strip_prefix("sha256:").unwrap_or(value);
    digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate_version_row() -> Value {
        serde_json::json!({
            "id": 3,
            "organizationId": 7,
            "skillId": 11,
            "skillKey": "report_analysis",
            "version": "1.2.3",
            "manifestJson": "{\"skill_key\":\"report_analysis\"}",
            "sourceHash": format!("sha256:{}", "a".repeat(64)),
            "risk": "green",
            "maxSteps": 2,
            "maxToolCalls": 3,
            "permissions": ["report:read"],
            "resources": ["reports.sales"],
            "outputTypes": ["application/json"]
        })
    }

    #[test]
    fn parses_version_and_risk_strictly() {
        assert_eq!(semver_major("1.2.3"), Some(1));
        assert_eq!(semver_major("v1.2.3"), None);
        assert!(matches!(parse_risk("GREEN"), Ok(RiskClass::Green)));
        assert!(parse_risk("unknown").is_err());
        assert!(valid_source_hash(&"a".repeat(64)));
        assert!(!valid_source_hash("not-a-digest"));
    }

    #[test]
    fn parses_complete_candidate_version() {
        let version =
            parse_candidate_version(&candidate_version_row()).expect("candidate should parse");

        assert_eq!(version.id, 3);
        assert_eq!(version.organization_id, 7);
        assert_eq!(version.skill_id, 11);
        assert_eq!(version.skill_key, "report_analysis");
        assert_eq!(version.max_steps, 2);
        assert_eq!(version.resources, vec!["reports.sales"]);
    }

    #[test]
    fn rejects_candidate_with_invalid_source_hash() {
        let mut row = candidate_version_row();
        row["sourceHash"] = Value::String("browser-asserted".to_string());

        assert!(parse_candidate_version(&row)
            .expect_err("invalid hash must fail")
            .contains("invalid source hash"));
    }

    #[test]
    fn parses_fixture_input_and_expected_output_separately() {
        let fixture = parse_candidate_fixture(&serde_json::json!({
            "id": 5,
            "organization_id": 7,
            "skill_id": 11,
            "fixture_key": "fixture-1",
            "input_json": "{\"value\":\"input\"}",
            "expected_output_json": "{\"value\":\"expected\"}"
        }))
        .expect("fixture should parse");

        assert_eq!(fixture.input, serde_json::json!({"value": "input"}));
        assert_eq!(
            fixture.expected_output,
            serde_json::json!({"value": "expected"})
        );
    }

    #[test]
    fn parses_pinned_certification_environment() {
        let environment = parse_candidate_environment(&serde_json::json!({
            "id": 13,
            "organizationId": 7,
            "skillId": 11,
            "fixtureId": 5,
            "datasetJson": "{\"inventory.low_stock.v1\":{\"companyId\":9,\"data\":{},\"organizationId\":7}}",
            "virtualFilesJson": "{}",
            "environmentFingerprint": format!("sha256:{}", "b".repeat(64))
        }))
        .expect("environment should parse");

        assert_eq!(environment.id, 13);
        assert_eq!(environment.fixture_id, 5);
        assert!(environment.dataset.is_object());
    }

    #[test]
    fn rejects_invalid_environment_fingerprint() {
        let error = parse_candidate_environment(&serde_json::json!({
            "id": 13,
            "organizationId": 7,
            "skillId": 11,
            "fixtureId": 5,
            "datasetJson": "{}",
            "virtualFilesJson": "{}",
            "environmentFingerprint": "browser-asserted"
        }))
        .expect_err("invalid fingerprint must fail");

        assert!(error.contains("fingerprint is invalid"));
    }

    #[test]
    fn built_in_dispatch_requires_exact_version_and_bundle_hash() {
        let low_stock_hash = certification::low_stock_certification_bundle_hash();
        assert!(validate_active_adapter_binding(
            low_stock::LOW_STOCK_SKILL_KEY,
            "1.0.0",
            1,
            &low_stock_hash,
        )
        .is_ok());
        assert!(validate_active_adapter_binding(
            low_stock::LOW_STOCK_SKILL_KEY,
            "1.0.1",
            1,
            &low_stock_hash,
        )
        .is_err());
        assert!(validate_active_adapter_binding(
            low_stock::LOW_STOCK_SKILL_KEY,
            "1.0.0",
            1,
            &format!("sha256:{}", "f".repeat(64)),
        )
        .is_err());
    }
}
