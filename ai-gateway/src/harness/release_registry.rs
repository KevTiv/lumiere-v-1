//! SpacetimeDB-backed active-release gate for built-in harness skills.
//!
//! The gateway keeps only the executable adapter for a skill in code. The
//! organization-specific active release remains authoritative for whether that
//! adapter may run and for its risk, resources, output types, and limits.

use serde_json::Value;
use stdb_client::StdbClient;

use super::{
    distributor_controls, low_stock,
    manifest::{ExecutionLimits, RiskClass, SkillManifest},
    report_composer,
};

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
    if semver_major(&release_version) != Some(expected_version) {
        return Err(format!(
            "active skill version '{release_version}' is incompatible with gateway adapter v{expected_version}"
        ));
    }
    let source_hash = row_string(version, "sourceHash", "source_hash")
        .ok_or_else(|| "active skill version is missing its source hash".to_string())?;
    if !valid_source_hash(&source_hash) {
        return Err("active skill version has an invalid source hash".to_string());
    }

    let mut manifest = match skill_key.as_str() {
        distributor_controls::CREDIT_HOLD_SKILL_KEY => distributor_controls::credit_hold_manifest(),
        distributor_controls::DELIVERY_RUN_SKILL_KEY => {
            distributor_controls::delivery_run_manifest()
        }
        report_composer::REPORT_COMPOSER_SKILL_KEY => report_composer::manifest(),
        low_stock::LOW_STOCK_SKILL_KEY => low_stock::manifest(),
        _ => return Err("gateway has no executable adapter for this released skill".to_string()),
    };
    manifest.risk = parse_risk(&row_string(version, "risk", "risk").unwrap_or_default())?;
    manifest.limits = ExecutionLimits {
        max_rows: manifest.limits.max_rows,
        max_steps: row_u64(version, "maxSteps", "max_steps").unwrap_or_default() as u32,
        max_tool_calls: row_u64(version, "maxToolCalls", "max_tool_calls").unwrap_or_default()
            as u32,
    };
    manifest.named_resources = string_array(version, "resources")
        .ok_or_else(|| "active skill version is missing resources".to_string())?;
    let output_types = string_array(version, "outputTypes")
        .ok_or_else(|| "active skill version is missing output types".to_string())?;
    if !output_types
        .iter()
        .any(|output| output == &manifest.output_type)
    {
        return Err("active skill version does not permit the adapter output type".to_string());
    }
    if manifest.limits.max_steps == 0 || manifest.limits.max_tool_calls == 0 {
        return Err("active skill version has invalid execution limits".to_string());
    }
    Ok(manifest)
}

fn sql_literal(value: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 120 || value.chars().any(char::is_control) {
        return Err("invalid skill key".to_string());
    }
    Ok(value.replace('\'', "''"))
}

fn row_u64(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

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

fn snake_to_camel(value: &str) -> String {
    let mut out = String::new();
    let mut uppercase = false;
    for character in value.chars() {
        if character == '_' {
            uppercase = true;
        } else if uppercase {
            out.extend(character.to_uppercase());
            uppercase = false;
        } else {
            out.push(character);
        }
    }
    out
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
    #[test]
    fn parses_version_and_risk_strictly() {
        assert_eq!(semver_major("1.2.3"), Some(1));
        assert_eq!(semver_major("v1.2.3"), None);
        assert!(matches!(parse_risk("GREEN"), Ok(RiskClass::Green)));
        assert!(parse_risk("unknown").is_err());
        assert!(valid_source_hash(&"a".repeat(64)));
        assert!(!valid_source_hash("not-a-digest"));
    }
}
