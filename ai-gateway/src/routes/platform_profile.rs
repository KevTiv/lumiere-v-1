//! Platform-owned defaults. Native reads happen only after authoritative session authorization.
use crate::{
    error::{AppError, AppResult},
    orchestrator::surface_provisioning_api::{setup_error, ApiSurfaceWriter},
    state::AppState,
};
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileRequest {
    org_id: u64,
    stdb_token: String,
    profile: Option<PlatformProfile>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ModelProfile {
    provider: String,
    model: String,
    max_tokens: u32,
    context_window: u32,
    timeout_ms: u32,
    max_concurrency: u32,
    input_cost_per_1k_microunits: u64,
    output_cost_per_1k_microunits: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PlatformProfile {
    template_key: String,
    template_version: u32,
    generation_profile: ModelProfile,
    review_profile: ModelProfile,
    currency: String,
    monthly_limit_units: u64,
    rate_limit_per_minute: u32,
    max_enrolled_organizations: u32,
}

impl PlatformProfile {
    fn validate(&self) -> AppResult<()> {
        if self.template_key.is_empty()
            || self.template_key.len() > 96
            || !self
                .template_key
                .bytes()
                .next()
                .is_some_and(|b| b.is_ascii_alphanumeric())
            || !self
                .template_key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || self.template_version == 0
            || self.currency.len() != 3
            || !self.currency.bytes().all(|b| b.is_ascii_uppercase())
            || self.monthly_limit_units == 0
            || self.monthly_limit_units > 9_007_199_254_740_991
            || self.rate_limit_per_minute == 0
            || self.max_enrolled_organizations == 0
        {
            return Err(AppError::BadRequest(
                "Invalid platform profile limits or identity".into(),
            ));
        }
        for p in [&self.generation_profile, &self.review_profile] {
            if !matches!(p.provider.as_str(), "mistral" | "gemini" | "ollama")
                || p.model.is_empty()
                || p.model.len() > 128
                || p.model.ends_with("-latest")
                || !p
                    .model
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b".:/_-".contains(&b))
                || p.max_tokens == 0
                || p.context_window <= p.max_tokens
                || p.timeout_ms == 0
                || p.max_concurrency == 0
                || p.input_cost_per_1k_microunits > 1_000_000_000_000
                || p.output_cost_per_1k_microunits > 1_000_000_000_000
            {
                return Err(AppError::BadRequest(
                    "Invalid model profile or reviewed pricing".into(),
                ));
            }
        }
        if self.generation_profile.provider != self.review_profile.provider
            || self.generation_profile.model == self.review_profile.model
        {
            return Err(AppError::BadRequest(
                "Generation and review require distinct models from the same provider".into(),
            ));
        }
        Ok(())
    }

    fn model_params(&self, model: &ModelProfile, role: &str) -> Value {
        let roles = if role == "generation" {
            vec!["decision", "reasoning", "generation"]
        } else {
            vec!["review"]
        };
        json!({
            "profile_key": format!("{}-{role}", self.template_key), "profile_version": self.template_version,
            "provider": model.provider, "model": model.model, "allowed_roles": roles,
            "temperature": {"some": 0.0}, "top_p": {"none": []},
            "max_tokens": model.max_tokens, "context_window": model.context_window,
            "timeout_ms": model.timeout_ms, "max_retries": 0, "max_concurrency": model.max_concurrency,
            "supports_tool_calling": true, "supports_structured_output": true, "supports_parallel_requests": false,
            "input_cost_per_1k_microunits": {"some": model.input_cost_per_1k_microunits},
            "output_cost_per_1k_microunits": {"some": model.output_cost_per_1k_microunits},
            "per_request_cost_ceiling_microunits": {"none": []}
        })
    }
}

fn clean_template(row: &Value) -> AppResult<Value> {
    let id = row
        .get("id")
        .and_then(Value::as_u64)
        .filter(|id| *id > 0 && *id <= 9_007_199_254_740_991)
        .ok_or_else(|| AppError::Unavailable("Invalid platform template ID".into()))?;
    let mut result = json!({"id":id});
    for field in [
        "template_key",
        "template_version",
        "currency",
        "monthly_limit_units",
        "rate_limit_per_minute",
        "max_enrolled_organizations",
    ] {
        result[field] = row.get(field).cloned().unwrap_or(Value::Null);
    }
    let object = result
        .as_object_mut()
        .ok_or_else(|| AppError::Unavailable("Invalid platform template".into()))?;
    for key in [
        "created_by",
        "created_at",
        "skill_ids",
        "spend_reader_identity",
        "skill_fingerprints",
    ] {
        object.remove(key);
    }
    for role in ["generation_profile", "review_profile"] {
        let source = row
            .get(role)
            .and_then(Value::as_object)
            .ok_or_else(|| AppError::Unavailable("Invalid platform model profile".into()))?;
        let mut model = serde_json::Map::new();
        for key in [
            "provider",
            "model",
            "max_tokens",
            "context_window",
            "timeout_ms",
            "max_concurrency",
            "input_cost_per_1k_microunits",
            "output_cost_per_1k_microunits",
        ] {
            let value = source
                .get(key)
                .ok_or_else(|| AppError::Unavailable("Incomplete platform model profile".into()))?;
            model.insert(key.into(), value.get("some").unwrap_or(value).clone());
        }
        object.insert(role.into(), Value::Object(model));
    }
    Ok(result)
}

async fn read_profile(state: &AppState) -> AppResult<Value> {
    let defaults = state
        .stdb
        .query_sql("SELECT template_id FROM ai_platform_default WHERE id = 1 LIMIT 1")
        .await
        .map_err(|_| AppError::Unavailable("Platform profile is unavailable".into()))?;
    let active_id = defaults
        .first()
        .and_then(|r| r.get("templateId"))
        .and_then(Value::as_u64);
    let rows = state
        .stdb
        .query_sql_sats("SELECT * FROM ai_platform_template LIMIT 1001")
        .await
        .map_err(|_| AppError::Unavailable("Platform templates are unavailable".into()))?;
    if rows.len() > 1000 {
        return Err(AppError::Unavailable(
            "Platform template catalog requires pagination".into(),
        ));
    }
    let active = rows
        .iter()
        .find(|r| r.get("id").and_then(Value::as_u64) == active_id && active_id.is_some());
    let active = active
        .map(clean_template)
        .transpose()?
        .unwrap_or(Value::Null);
    let templates: Vec<_> = rows.iter().map(|r| json!({"id":r["id"],"template_key":r["template_key"],"template_version":r["template_version"]})).collect();
    Ok(json!({"active_template": active, "templates": templates}))
}

pub async fn post_platform_profile(
    State(state): State<AppState>,
    Json(request): Json<ProfileRequest>,
) -> AppResult<Json<Value>> {
    let writer = ApiSurfaceWriter::authorize(
        state.config.api_server_url.as_deref(),
        &request.stdb_token,
        request.org_id,
    )
    .await
    .map_err(setup_error)?;
    writer
        .require_platform_admin()
        .map_err(|_| AppError::Forbidden("Platform administrator required".into()))?;
    if let Some(profile) = request.profile {
        profile.validate()?;
        let mut skill_ids = Vec::new();
        for key in [
            "rag_generation",
            "form_suggestion",
            "action_draft_generation",
        ] {
            let call = crate::orchestrator::surface_provisioning::create_surface(0, key)
                .map_err(setup_error)?;
            let mut params = call.args()[1].clone();
            params["is_system"] = json!(true);
            writer
                .company_operation("erp.publish_ai_platform_skill", json!({"params":params}))
                .await
                .map_err(setup_error)?;
            let rows = state.stdb.query_sql(&format!("SELECT id FROM ai_skill WHERE organization_id = 0 AND skill_key = '{key}' AND is_system = true AND is_active = true LIMIT 2")).await.map_err(|_| AppError::Unavailable("Published skill readback failed".into()))?;
            if rows.len() != 1 {
                return Err(AppError::Unavailable("Published skill is ambiguous".into()));
            }
            skill_ids.push(
                rows[0]
                    .get("id")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| AppError::Unavailable("Published skill ID missing".into()))?,
            );
        }
        let params = json!({"template_key":profile.template_key,"template_version":profile.template_version,
            "generation_profile":profile.model_params(&profile.generation_profile,"generation"),
            "review_profile":profile.model_params(&profile.review_profile,"review"),"skill_ids":skill_ids,
            "currency":profile.currency,"monthly_limit_units":profile.monthly_limit_units,
            "rate_limit_per_minute":profile.rate_limit_per_minute,"max_enrolled_organizations":profile.max_enrolled_organizations});
        writer
            .company_operation(
                "erp.register_ai_platform_template",
                json!({"params":params}),
            )
            .await
            .map_err(setup_error)?;
        let rows = state.stdb.query_sql(&format!("SELECT id FROM ai_platform_template WHERE template_key = '{}' AND template_version = {} LIMIT 2",profile.template_key,profile.template_version)).await.map_err(|_| AppError::Unavailable("Platform template readback failed".into()))?;
        if rows.len() != 1 {
            return Err(AppError::Unavailable(
                "Platform template is ambiguous".into(),
            ));
        }
        let id = rows[0]
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| AppError::Unavailable("Platform template ID missing".into()))?;
        writer
            .company_operation("erp.set_ai_platform_default", json!({"templateId":id}))
            .await
            .map_err(setup_error)?;
    }
    Ok(Json(read_profile(&state).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile() -> PlatformProfile {
        serde_json::from_value(json!({
            "template_key":"alpha", "template_version":1,
            "generation_profile":{"provider":"mistral","model":"model-a","max_tokens":2048,"context_window":32000,"timeout_ms":30000,"max_concurrency":1,"input_cost_per_1k_microunits":0,"output_cost_per_1k_microunits":1000},
            "review_profile":{"provider":"mistral","model":"model-b","max_tokens":2048,"context_window":32000,"timeout_ms":30000,"max_concurrency":1,"input_cost_per_1k_microunits":0,"output_cost_per_1k_microunits":1000},
            "currency":"USD","monthly_limit_units":5000000,"rate_limit_per_minute":10,"max_enrolled_organizations":5
        })).unwrap()
    }
    #[test]
    fn validates_exact_models_and_reviewed_bounded_prices() {
        let mut p = profile();
        assert!(p.validate().is_ok());
        p.review_profile.model = p.generation_profile.model.clone();
        assert!(p.validate().is_err());
        let mut p = profile();
        p.template_key = "unsafe'key".into();
        assert!(p.validate().is_err());
        let mut p = profile();
        p.generation_profile.model = "model-latest".into();
        assert!(p.validate().is_err());
        let mut p = profile();
        p.generation_profile.output_cost_per_1k_microunits = 1_000_000_000_001;
        assert!(p.validate().is_err());
        let mut p = profile();
        p.review_profile.provider = "gemini".into();
        assert!(p.validate().is_err());
    }
    #[test]
    fn derives_roles_and_sats_options_without_client_authority_fields() {
        let p = profile();
        let generation = p.model_params(&p.generation_profile, "generation");
        assert_eq!(
            generation["allowed_roles"],
            json!(["decision", "reasoning", "generation"])
        );
        assert_eq!(
            generation["input_cost_per_1k_microunits"],
            json!({"some":0})
        );
        assert_eq!(generation["top_p"], json!({"none":[]}));
        let row = json!({"id":1,"created_by":"private", "created_at":123,"skill_ids":[1,2,3],"generation_profile":generation,"review_profile":p.model_params(&p.review_profile,"review")});
        let clean = clean_template(&row).unwrap();
        assert!(clean.get("created_by").is_none());
        assert!(clean.get("skill_ids").is_none());
        assert_eq!(
            clean["generation_profile"]["input_cost_per_1k_microunits"],
            0
        );
    }
}
