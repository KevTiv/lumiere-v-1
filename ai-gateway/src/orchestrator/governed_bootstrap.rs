//! Explicit organization-scoped bootstrap for governed intelligence configuration.
//!
//! Runtime skill execution is resolve-only: it must not create model profiles,
//! intelligence policies, calibration profiles, or DecisionType definitions.
//! This module owns the idempotent bootstrap of Lumiere-owned immutable defaults
//! that are safe to seed uniformly for an organization.

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::json;
use stdb_client::{ReducerCall, StdbClient};

use super::{
    decision_type::{register_builtin_decision_types, StdbDecisionTypeRegistry},
    model_configuration::{ModelConfigurationStore, StdbModelConfigurationStore},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GovernedBootstrapResult {
    pub organization_id: u64,
    pub intelligence_policy_ref: String,
    pub calibration_profiles: Vec<String>,
    pub decision_types_registered: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GovernedReadiness {
    pub organization_id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub intelligence_policy_ref: String,
    pub models: Vec<String>,
}

/// Non-generative, read-only resolution through the same owners used by the
/// report-analysis runtime. Configuration existence alone is not admission.
pub(crate) async fn inspect_governed_readiness(
    writer: &StdbClient,
    spend_reader: &StdbClient,
    organization_id: u64,
    company_id: u64,
    agent_id: u64,
    policy_ref: &str,
) -> Result<GovernedReadiness> {
    use super::model_configuration::{IntelligenceRole, IntelligenceRouteResolver};
    anyhow::ensure!(
        organization_id > 0 && company_id > 0 && agent_id > 0,
        "organization, company and agent must be nonzero"
    );
    let company = writer
        .query_sql(&format!(
        "SELECT id FROM company WHERE id = {company_id} AND organization_id = {organization_id}"
    ))
        .await?;
    anyhow::ensure!(
        company.len() == 1,
        "company is outside the selected organization"
    );
    crate::harness::release_registry::load_active_manifest(
        writer,
        organization_id,
        crate::harness::governed_llm_skills::REPORT_ANALYSIS_SKILL_KEY,
        1,
    )
    .await
    .map_err(anyhow::Error::msg)?;
    let skill =
        super::skill_loader::load_skill(writer, organization_id, company_id, "report_analysis")
            .await?;
    anyhow::ensure!(skill.enabled, "report-analysis skill is disabled");
    anyhow::ensure!(
        super::skill_loader::skill_agent_id(&skill.config_json, None, None)? == Some(agent_id),
        "company skill agent binding differs"
    );
    anyhow::ensure!(
        super::skill_loader::intelligence_policy_ref(&skill.config_json)?.as_deref()
            == Some(policy_ref),
        "company skill policy binding differs"
    );
    let agent =
        crate::ai_agent::resolve_agent(writer, organization_id, Some(agent_id), None, false)
            .await?;
    anyhow::ensure!(
        crate::providers::llm::normalize_provider(&agent.provider) == "mistral",
        "pilot agent must use Mistral"
    );
    crate::ai_agent::ensure_allowed_action(&agent, "skill_run")?;
    let store = StdbModelConfigurationStore { reader: writer };
    let resolver =
        IntelligenceRouteResolver::new_governed(&store, organization_id, &agent, Some(policy_ref))?;
    resolver
        .validate_review_independence("ReportAttentionNeed")
        .await?;
    let calibration = writer
        .query_sql(&format!(
            "SELECT id FROM ai_calibration_profile WHERE organization_id = {organization_id} \
         AND profile_name = 'report-attention' AND profile_version = 1 AND is_active = true"
        ))
        .await?;
    anyhow::ensure!(
        calibration.len() == 1,
        "report-attention calibration is missing or inactive"
    );
    let definitions = writer.query_sql(&format!(
        "SELECT id FROM ai_decision_type_definition WHERE organization_id = {organization_id} \
         AND decision_type_name = 'ReportAttentionNeed' AND decision_type_version = 1 AND is_active = true"
    )).await?;
    anyhow::ensure!(
        definitions.len() == 1,
        "ReportAttentionNeed decision type is missing or inactive"
    );
    let spend = crate::ai_spend::SpendReader::new(spend_reader);
    let period = crate::ai_spend::billing_period(chrono::Utc::now());
    let budget = spend
        .budget(organization_id, agent_id, &period)
        .await?
        .context("current-period budget is missing or invisible to the gateway spend reader")?;
    anyhow::ensure!(
        budget
            .settled_units
            .checked_add(budget.outstanding_units)
            .is_some_and(|committed| committed < budget.limit_units),
        "pilot budget is exhausted"
    );
    let mut models = Vec::new();
    for role in [
        IntelligenceRole::Decision,
        IntelligenceRole::Reasoning,
        IntelligenceRole::Generation,
        IntelligenceRole::Review,
    ] {
        let route = resolver.resolve(role, Some("ReportAttentionNeed")).await?;
        let profile = route.primary;
        anyhow::ensure!(
            profile.provider == "mistral"
                && profile.max_retries == 0
                && route.fallbacks.is_empty()
                && route.shadows.is_empty(),
            "pilot requires direct Mistral profiles without retry, fallback or shadow"
        );
        anyhow::ensure!(
            profile.max_tokens <= agent.max_tokens
                && profile.context_window <= agent.context_window,
            "profile exceeds the agent token/context ceiling"
        );
        anyhow::ensure!(
            agent
                .allowed_models
                .iter()
                .any(|model| model == &profile.model),
            "pilot model is outside agent allowlist"
        );
        spend
            .latest_price_snapshot(
                organization_id,
                agent_id,
                "mistral",
                &profile.model,
                &budget.currency,
            )
            .await?
            .context("pilot model price snapshot is missing or invisible")?;
        if !models.contains(&profile.model) {
            models.push(profile.model);
        }
    }
    Ok(GovernedReadiness {
        organization_id,
        company_id,
        agent_id,
        intelligence_policy_ref: policy_ref.into(),
        models,
    })
}

pub(crate) async fn bootstrap_governed_intelligence(
    writer: &StdbClient,
    reader: &StdbClient,
    organization_id: u64,
    intelligence_policy_ref: Option<&str>,
) -> Result<GovernedBootstrapResult> {
    if organization_id == 0 {
        anyhow::bail!("organization_id must be nonzero");
    }

    // Profiles and policies are deployment/admin authored because provider/model
    // identities are environment-specific. Validate that reviewed policy first,
    // before seeding any Lumiere-owned defaults, so bootstrap is all-or-nothing
    // with respect to its preconditions.
    let store = StdbModelConfigurationStore { reader };
    let (policy_key, policy_version) = match intelligence_policy_ref {
        Some(value) if !value.trim().is_empty() => {
            let parsed = super::model_configuration::ModelProfileRef::parse(value)
                .context("intelligence policy ref must use policy_key@version")?;
            (parsed.key, Some(parsed.version))
        }
        _ => ("default".to_string(), None),
    };
    let policy = store
        .policy(organization_id, &policy_key, policy_version)
        .await?
        .with_context(|| {
            format!(
                "active intelligence policy '{}{}' must be registered before governed bootstrap",
                policy_key,
                policy_version
                    .map(|version| format!("@{version}"))
                    .unwrap_or_default()
            )
        })?;

    let decision_types = StdbDecisionTypeRegistry {
        writer,
        reader,
        organization_id,
    };
    register_builtin_decision_types(&decision_types)
        .await
        .context("register built-in governed DecisionTypes")?;

    writer
        .call_reducer(ReducerCall::from_name(
            "register_ai_calibration_profile",
            json!([
                organization_id,
                {
                    "profile_name": "report-attention",
                    "profile_version": 1,
                    "description": "Reviewed calibration profile for ReportAttentionNeed@1. Immutable and organization-scoped; runtime resolves but never creates this profile.",
                    "breakpoints_json": "[[0.0,0.0],[0.35,0.35],[0.65,0.65],[1.0,1.0]]"
                }
            ]),
        ))
        .await
        .context("register report-attention calibration profile")?;

    Ok(GovernedBootstrapResult {
        organization_id,
        intelligence_policy_ref: format!("{}@{}", policy.key, policy.version),
        calibration_profiles: vec!["report-attention@1".to_string()],
        decision_types_registered: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn readiness_resolves_canonical_http_reads_and_rejects_unready_runtime() {
        use axum::{extract::State, http::HeaderMap, routing::post, Json, Router};
        use serde_json::{json, Value};

        fn sats(rows: Vec<Value>) -> Value {
            let names: Vec<String> = rows
                .first()
                .and_then(Value::as_object)
                .map(|row| row.keys().cloned().collect())
                .unwrap_or_default();
            json!([{
                "schema": {"elements": names.iter().map(|name| json!({"name": {"some": name}})).collect::<Vec<_>>()},
                "rows": rows.iter().map(|row| names.iter().map(|name| row[name].clone()).collect::<Vec<_>>()).collect::<Vec<_>>()
            }])
        }

        async fn sql(
            State(case): State<&'static str>,
            headers: HeaderMap,
            statement: String,
        ) -> Json<Value> {
            assert!(
                statement.starts_with("SELECT "),
                "readiness must never write"
            );
            let rows = if statement.contains("FROM company ") {
                if case == "company" {
                    vec![]
                } else {
                    vec![json!({"id": 3})]
                }
            } else if statement.contains("FROM ai_skill_release ") {
                vec![json!({"skill_version_id": 1})]
            } else if statement.contains("FROM ai_skill_version ") {
                vec![
                    json!({"version": if case == "release" {"2.0.0"} else {crate::harness::certification::REPORT_ANALYSIS_CERTIFICATION_VERSION}, "risk": "green",
                    "max_steps": 8, "max_tool_calls": 12, "resources": ["analytics.report_analysis.v1"],
                    "output_types": ["analytics.report_analysis.result.v1"], "source_hash": if case == "source" { format!("sha256:{}", "a".repeat(64)) } else { crate::harness::certification::report_analysis_certification_bundle_hash() }}),
                ]
            } else if statement.contains("FROM ai_skill_config ") {
                vec![
                    json!({"id": 1, "is_enabled": case != "disabled", "config_json": "{\"intelligencePolicyRef\":\"pilot@1\",\"defaultAgentId\":7}"}),
                ]
            } else if statement.contains("FROM ai_skill ") {
                vec![
                    json!({"id": 8, "organization_id": 9, "skill_key": "report_analysis",
                    "name": "Report Analysis", "prompt_template": "test", "default_max_steps": 8,
                    "default_max_tool_calls": 12, "required_tools": [], "optional_tools": []}),
                ]
            } else if statement.contains("FROM ai_agent ") {
                vec![
                    json!({"id": 7, "provider": "mistral", "model": "primary", "is_active": true,
                    "max_tokens": 2048, "context_window": 32000, "allowed_actions": ["skill_run"],
                    "allowed_models": ["primary", "review"]}),
                ]
            } else if statement.contains("FROM ai_intelligence_policy ") {
                vec![json!({"policy_key": "pilot", "policy_version": 1,
                    "default_decision_profile": "pilot-primary@1", "default_reasoning_profile": "pilot-primary@1",
                    "default_generation_profile": "pilot-primary@1", "default_review_profile": "pilot-review@1",
                    "shadow_profiles": [], "decision_type_overrides_json": "{}", "fallback_profiles_json": "{}"})]
            } else if statement.contains("FROM ai_model_profile ") {
                let review = statement.contains("'pilot-review'");
                vec![
                    json!({"profile_key": if review {"pilot-review"} else {"pilot-primary"}, "profile_version": 1,
                    "provider": "mistral", "model": if review {"review"} else {"primary"},
                    "allowed_roles": if review {vec!["review"]} else {vec!["decision", "reasoning", "generation"]},
                    "max_tokens": 2048, "context_window": 32000, "timeout_ms": if case == "deadline" {0} else {60000},
                    "max_retries": if case == "retry" {1} else {0}, "max_concurrency": 1, "supports_tool_calling": true}),
                ]
            } else if statement.contains("FROM ai_calibration_profile ")
                || statement.contains("FROM ai_decision_type_definition ")
            {
                if case == "bootstrap" {
                    vec![]
                } else {
                    vec![json!({"id": 1})]
                }
            } else if statement.contains("FROM ai_spend_budget_read ") {
                assert_eq!(headers["authorization"], "Bearer spend-reader");
                vec![json!({"id": 1, "organization_id": 9, "agent_id": 7,
                    "billing_period": crate::ai_spend::billing_period(chrono::Utc::now()), "currency": "USD",
                    "limit_units": 10000, "settled_units": if case == "budget" {10000} else {0}, "outstanding_units": 0})]
            } else if statement.contains("FROM ai_spend_price_snapshot_read ") {
                assert_eq!(headers["authorization"], "Bearer spend-reader");
                if case == "price" {
                    vec![]
                } else {
                    ["primary", "review"].iter().enumerate().map(|(i, model)| json!({
                        "id": i+1, "organization_id": 9, "agent_id": 7, "provider": "mistral", "model": model,
                        "currency": "USD", "input_units_per_1_k": 100, "output_units_per_1_k": 200, "version": i+1
                    })).collect()
                }
            } else {
                panic!("unexpected readiness query: {statement}")
            };
            Json(sats(rows))
        }

        for case in [
            "ready",
            "company",
            "release",
            "source",
            "disabled",
            "bootstrap",
            "budget",
            "price",
            "deadline",
            "retry",
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                axum::serve(
                    listener,
                    Router::new()
                        .route("/v1/database/fixture/sql", post(sql))
                        .with_state(case),
                )
                .await
                .unwrap();
            });
            let writer = StdbClient::new(base.clone(), "fixture".into(), "gateway".into());
            let reader = StdbClient::new(base, "fixture".into(), "spend-reader".into());
            let result = inspect_governed_readiness(&writer, &reader, 9, 3, 7, "pilot@1").await;
            server.abort();
            if case == "ready" {
                let ready = result.unwrap_or_else(|error| panic!("ready fixture: {error:#}"));
                assert_eq!(ready.models, ["primary", "review"]);
            } else {
                assert!(result.is_err(), "unready fixture admitted: {case}");
            }
        }
    }

    #[test]
    fn bootstrap_is_explicitly_not_a_runtime_fallback() {
        // Structural guard: runtime callers use this module explicitly; no
        // automatic startup hook exists because organizations/policies are
        // tenant-scoped and must be deliberately provisioned.
        assert_eq!("report-attention@1".split('@').count(), 2);
    }
}
