//! Atomic completion of company AI bindings from an already approved harness profile.
//! This never creates funding, changes credentials, or activates a skill release.

use super::agents::{ai_agent, AiAgent};
use super::model_configuration::{ai_intelligence_policy, ai_model_profile};
use super::skills::{ai_skill, ai_skill_config, upsert_ai_skill_config, UpsertAiSkillConfigParams};
use super::spend::{ai_price_snapshot, ai_spend_budget};
use crate::core::organization::require_company_in_organization;
use crate::core::permissions::caller_delegated_company_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use spacetimedb::{reducer, ReducerContext, Table};

const SURFACES: [(&str, &str); 3] = [
    ("rag_generation", "chat"),
    ("form_suggestion", "form_suggest"),
    ("action_draft_generation", "action_draft"),
];

/// Complete missing bindings using an active, funded, company-compatible agent.
/// The gateway supplies these references from the company's approved harness
/// configuration. All authority and scope checks are repeated at the write boundary.
#[reducer]
pub fn provision_ai_company_defaults(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    agent_id: u64,
    intelligence_policy_ref: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent", "write")?;
    check_permission(ctx, organization_id, "ai_skill", "write")?;
    if caller_delegated_company_scope(ctx, organization_id).is_some() {
        return Err("organization administrator is required to provision AI defaults".into());
    }
    require_company_in_organization(ctx, organization_id, company_id)?;
    let mut agent = ctx
        .db
        .ai_agent()
        .id()
        .find(agent_id)
        .filter(|row| {
            row.organization_id == organization_id
                && row.is_active
                && row.company_id.is_none_or(|id| id == company_id)
        })
        .ok_or("configured AI agent is unavailable for this company")?;
    let policies: Vec<_> = ctx
        .db
        .ai_intelligence_policy()
        .ai_intelligence_policy_by_org()
        .filter(&organization_id)
        .filter(|row| {
            format!("{}@{}", row.policy_key, row.policy_version) == intelligence_policy_ref
        })
        .collect();
    let [policy] = policies.as_slice() else {
        return Err("configured intelligence policy must resolve exactly once".into());
    };
    if !policy.is_active {
        return Err("configured intelligence policy is inactive".into());
    }
    let profiles: Vec<_> = ctx
        .db
        .ai_model_profile()
        .ai_model_profile_by_org()
        .filter(&organization_id)
        .filter(|row| {
            format!("{}@{}", row.profile_key, row.profile_version)
                == policy.default_generation_profile
        })
        .collect();
    let [profile] = profiles.as_slice() else {
        return Err("generation model profile must resolve exactly once".into());
    };
    if !profile.is_active
        || !profile
            .allowed_roles
            .iter()
            .any(|role| role == "generation")
        || profile.provider != agent.provider
        || profile.model != agent.model
    {
        return Err("configured agent does not match the active generation profile".into());
    }
    super::owner_configuration::require_single_pool(ctx, organization_id, agent_id)?;
    let period = super::owner_configuration::current_period(ctx.timestamp)?;
    let budgets: Vec<_> = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&agent_id, &period))
        .filter(|row| row.organization_id == organization_id)
        .collect();
    let [budget] = budgets.as_slice() else {
        return Err("configured AI agent needs an existing current-period allowance".into());
    };
    if !ctx
        .db
        .ai_price_snapshot()
        .ai_price_snapshot_by_agent()
        .filter(&agent_id)
        .any(|row| {
            row.organization_id == organization_id
                && row.provider == agent.provider
                && row.model == agent.model
                && row.currency == budget.currency
        })
    {
        return Err("configured AI agent needs reviewed generation pricing".into());
    }

    let original_actions = agent.allowed_actions.clone();
    for (key, action) in SURFACES {
        let local: Vec<_> = ctx
            .db
            .ai_skill()
            .ai_skill_by_org()
            .filter(&organization_id)
            .filter(|row| row.skill_key == key)
            .collect();
        let catalog = if local.is_empty() {
            ctx.db
                .ai_skill()
                .ai_skill_by_org()
                .filter(&0u64)
                .filter(|row| row.skill_key == key)
                .collect::<Vec<_>>()
        } else {
            local
        };
        let [skill] = catalog.as_slice() else {
            return Err(format!(
                "AI surface '{key}' must be provisioned exactly once"
            ));
        };
        if !skill.is_active {
            continue;
        }
        let configs: Vec<_> = ctx
            .db
            .ai_skill_config()
            .ai_skill_config_by_org()
            .filter(&organization_id)
            .filter(|row| {
                row.skill_id == skill.id
                    && (row.company_id.is_none() || row.company_id == Some(company_id))
            })
            .collect();
        let local: Vec<_> = configs
            .iter()
            .filter(|row| row.company_id == Some(company_id))
            .collect();
        let inherited: Vec<_> = configs
            .iter()
            .filter(|row| row.company_id.is_none())
            .collect();
        if local.len() > 1 || inherited.len() > 1 {
            return Err(format!("AI surface '{key}' configuration is ambiguous"));
        }
        let previous = local.first().or(inherited.first()).copied();
        if previous.is_some_and(|row| !row.is_enabled) {
            continue;
        }
        let input = previous.map_or("{}", |row| row.config_json.as_str());
        let Some(config_json) = complete_binding(input, agent_id, &intelligence_policy_ref)? else {
            continue;
        };
        upsert_ai_skill_config(
            ctx,
            organization_id,
            UpsertAiSkillConfigParams {
                company_id: Some(company_id),
                skill_id: skill.id,
                is_enabled: true,
                config_json,
                custom_instructions: previous.and_then(|row| row.custom_instructions.clone()),
                tool_overrides: previous.map_or_else(Vec::new, |row| row.tool_overrides.clone()),
                metadata: previous.and_then(|row| row.metadata.clone()),
            },
        )?;
        // Only the first missing binding enables its action. A later operator
        // action disablement is authoritative and setup retries do not undo it.
        if !agent
            .allowed_actions
            .iter()
            .any(|existing| existing == action)
        {
            agent.allowed_actions.push(action.into());
        }
    }
    if agent.allowed_actions != original_actions {
        let next_actions = agent.allowed_actions.clone();
        ctx.db.ai_agent().id().update(AiAgent {
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..agent
        });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "ai_agent",
                record_id: agent_id,
                action: "UPDATE",
                old_values: Some(
                    serde_json::json!({"allowed_actions": original_actions}).to_string(),
                ),
                new_values: Some(serde_json::json!({"allowed_actions": next_actions}).to_string()),
                changed_fields: vec!["allowed_actions".into()],
                metadata: None,
            },
        );
    }
    Ok(())
}

fn complete_binding(input: &str, agent: u64, policy: &str) -> Result<Option<String>, String> {
    let mut value: serde_json::Value = serde_json::from_str(input)
        .map_err(|_| "existing AI surface configuration is invalid JSON")?;
    let object = value
        .as_object_mut()
        .ok_or("existing AI surface configuration must be an object")?;
    // Presence (including null or invalid values) is an explicit override. Do
    // not silently repair user input by choosing another execution identity.
    if [
        "defaultAgentId",
        "default_agent_id",
        "intelligencePolicyRef",
        "intelligence_policy_ref",
    ]
    .iter()
    .any(|key| object.contains_key(*key))
    {
        return Ok(None);
    }
    object.insert("defaultAgentId".into(), serde_json::json!(agent));
    object.insert("intelligencePolicyRef".into(), serde_json::json!(policy));
    Ok(Some(value.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fills_missing_binding_preserving_options_and_is_idempotent() {
        let result = complete_binding(r#"{"temperature":0,"custom":{"keep":true}}"#, 7, "pilot@1")
            .unwrap()
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(value["defaultAgentId"], 7);
        assert_eq!(value["custom"]["keep"], true);
        assert_eq!(complete_binding(&result, 9, "other@2").unwrap(), None);
    }
    #[test]
    fn preserves_explicit_overrides_including_null_and_snake_case() {
        for input in [
            r#"{"defaultAgentId":null}"#,
            r#"{"default_agent_id":2}"#,
            r#"{"intelligencePolicyRef":"custom@1"}"#,
            r#"{"intelligence_policy_ref":false}"#,
        ] {
            assert_eq!(complete_binding(input, 7, "pilot@1").unwrap(), None);
        }
    }
    #[test]
    fn rejects_malformed_configuration() {
        for input in ["", "null", "[]", "true"] {
            assert!(complete_binding(input, 7, "pilot@1").is_err());
        }
    }
}
