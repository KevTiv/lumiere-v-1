//! Advisory AI action draft generation. This route never executes reducers.
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::{
    ai_agent::{
        ensure_allowed_action, ensure_model_allowed, ensure_within_budget, record_ai_spend,
        resolve_agent,
    },
    error::{AppError, AppResult},
    harness::snapshot::{
        fetch_live_snapshots, filter_entity_refs_by_allowed_types, EntityRef, LiveSnapshot,
    },
    providers::llm::LlmMessage,
    state::AppState,
};

const ACTION_DRAFT_MAX_TOKENS: u32 = 2048;
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ActionUiContext {
    pub route: Option<String>,
    pub module: Option<String>,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub selection_summary: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ActionDraftRequest {
    pub org_id: Option<u64>,
    pub company_id: u64,
    pub query: String,
    pub ui_context: Option<ActionUiContext>,
    #[serde(default)]
    pub allowed_reducers: Vec<String>,
    #[serde(default)]
    pub allowed_entity_types: Vec<String>,
    pub agent_id: Option<u64>,
    pub team_member_id: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ActionDraft {
    pub reducer_name: String,
    pub params_json: Value,
    pub confidence: f32,
    pub warnings: Vec<String>,
    pub summary: String,
    pub elevated: bool,
}

#[derive(Debug, Serialize)]
pub struct ActionDraftResponse {
    pub drafts: Vec<ActionDraft>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grounding_snapshots: Option<Vec<LiveSnapshot>>,
}

#[derive(Debug)]
struct ActionCatalogEntry {
    reducer_name: &'static str,
    elevated: bool,
    param_fields: &'static [&'static str],
    keywords: &'static [&'static str],
}

const ACTION_CATALOG: &[ActionCatalogEntry] = &[
    ActionCatalogEntry {
        reducer_name: "create_task",
        elevated: false,
        param_fields: &[
            "company_id",
            "name",
            "description",
            "priority",
            "state",
            "kanban_state",
            "project_id",
            "partner_id",
            "date_deadline",
            "metadata",
        ],
        keywords: &["task", "todo", "follow up", "follow-up", "remind"],
    },
    ActionCatalogEntry {
        reducer_name: "create_sale_order",
        elevated: true,
        param_fields: &[
            "company_id",
            "partner_id",
            "partner_invoice_id",
            "partner_shipping_id",
            "pricelist_id",
            "currency_id",
            "warehouse_id",
            "order_lines",
            "origin",
            "client_order_ref",
            "note",
            "metadata",
        ],
        keywords: &["quote", "quotation", "sale order", "sales order"],
    },
    ActionCatalogEntry {
        reducer_name: "create_purchase_order",
        elevated: true,
        param_fields: &[
            "company_id",
            "partner_id",
            "currency_id",
            "picking_type_id",
            "order_lines",
            "origin",
            "notes",
            "metadata",
        ],
        keywords: &["purchase", "rfq", "vendor", "buy"],
    },
];

fn clean_json_response(text: &str) -> &str {
    text.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
}

fn catalog_schema_json(entries: &[&ActionCatalogEntry]) -> String {
    let schema: Vec<Value> = entries
        .iter()
        .map(|entry| {
            json!({
                "reducer_name": entry.reducer_name,
                "elevated": entry.elevated,
                "param_fields": entry.param_fields,
            })
        })
        .collect();
    serde_json::to_string_pretty(&schema).unwrap_or_else(|_| "[]".to_string())
}

fn build_action_draft_prompt(
    req: &ActionDraftRequest,
    entries: &[&ActionCatalogEntry],
    grounding_snapshots: Option<&[LiveSnapshot]>,
) -> String {
    let schema = catalog_schema_json(entries);
    let ui_context = req
        .ui_context
        .as_ref()
        .and_then(|ctx| serde_json::to_string_pretty(ctx).ok())
        .unwrap_or_else(|| "{}".to_string());
    let grounding = grounding_snapshots
        .map(|snapshots| {
            serde_json::to_string_pretty(snapshots).unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string());

    format!(
        "Organization id: {org_id}\nCompany id: {company_id}\n\nAllowed reducer catalog (only use reducers listed here):\n{schema}\n\nUI context:\n{ui_context}\n\nLive ERP snapshots (authoritative when present):\n{grounding}\n\nUser request:\n{query}\n\nReturn ONLY valid JSON matching this shape:\n{{\"drafts\":[{{\"reducer_name\":\"create_task\",\"params_json\":{{\"company_id\":{company_id}}},\"confidence\":0.0,\"warnings\":[\"note\"],\"summary\":\"short human summary\"}}]}}\nRules:\n- Include company_id in every params_json.\n- Use numeric ids from live snapshots when available.\n- Never invent partner/product ids when snapshots lack them; add warnings instead.\n- order_lines must be JSON arrays when included.\n- Drafts are advisory; do not claim execution.\n- Prefer one best draft unless the user clearly asks for multiple actions.",
        org_id = req.org_id.unwrap_or(0),
        company_id = req.company_id,
        schema = schema,
        ui_context = ui_context,
        grounding = grounding,
        query = req.query.trim(),
    )
}

fn sanitize_draft_params(
    entry: &ActionCatalogEntry,
    company_id: u64,
    raw: &Value,
) -> Map<String, Value> {
    let mut params = Map::new();
    let Some(raw_obj) = raw.as_object() else {
        params.insert("company_id".to_string(), json!(company_id));
        return params;
    };

    for key in entry.param_fields {
        let Some(value) = raw_obj.get(*key) else {
            continue;
        };
        if *key == "order_lines" {
            if value.is_array() {
                params.insert(key.to_string(), value.clone());
            }
            continue;
        }
        params.insert(key.to_string(), value.clone());
    }

    params.insert("company_id".to_string(), json!(company_id));
    params
}

fn parse_llm_drafts(
    req: &ActionDraftRequest,
    entries: &[&ActionCatalogEntry],
    raw: &Value,
) -> Result<Vec<ActionDraft>, String> {
    let Some(raw_drafts) = raw.get("drafts").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };

    let mut drafts = Vec::new();
    for raw_draft in raw_drafts {
        let Some(reducer_name) = raw_draft
            .get("reducer_name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
        else {
            continue;
        };
        let Some(entry) = entries
            .iter()
            .copied()
            .find(|entry| entry.reducer_name == reducer_name)
        else {
            continue;
        };

        let params = sanitize_draft_params(
            entry,
            req.company_id,
            raw_draft.get("params_json").unwrap_or(&Value::Null),
        );
        let mut warnings = raw_draft
            .get("warnings")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        warnings.extend(validate_params(entry, req.company_id, &params));

        let confidence = raw_draft
            .get("confidence")
            .and_then(Value::as_f64)
            .unwrap_or(0.5)
            .clamp(0.0, 1.0) as f32;
        let summary = raw_draft
            .get("summary")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                format!(
                    "Draft {} from the user request; no reducer was executed.",
                    entry.reducer_name
                )
            });

        drafts.push(ActionDraft {
            reducer_name: entry.reducer_name.to_string(),
            params_json: Value::Object(params),
            confidence,
            warnings,
            summary,
            elevated: entry.elevated,
        });
    }

    Ok(drafts)
}

async fn draft_actions_llm(
    state: &AppState,
    req: &ActionDraftRequest,
    grounding_snapshots: Option<&[LiveSnapshot]>,
) -> Result<Vec<ActionDraft>, String> {
    let org_id = req
        .org_id
        .filter(|id| *id > 0)
        .ok_or("org_id is required for LLM draft generation")?;
    let entries = allowed_catalog_entries(&req.allowed_reducers)?;
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    let agent = resolve_agent(
        &state.stdb,
        org_id,
        req.agent_id,
        req.team_member_id,
    )
    .await
    .map_err(|e| e.to_string())?;

    ensure_allowed_action(&agent, "action_draft").map_err(|e| e.to_string())?;
    ensure_model_allowed(&agent).map_err(|e| e.to_string())?;
    ensure_within_budget(&agent).map_err(|e| e.to_string())?;

    let prompt = build_action_draft_prompt(req, &entries, grounding_snapshots);
    let system = format!(
        "{}\n\nYou propose ERP action drafts from natural language. Return schema-constrained JSON only. Never execute reducers or claim mutations occurred.",
        agent.system_prompt
    );

    let llm_resp = state
        .providers
        .llm
        .complete(crate::providers::llm::LlmRequest {
            provider: agent.provider.clone(),
            model: agent.model.clone(),
            system,
            messages: vec![LlmMessage {
                role: "user".to_string(),
                content: prompt,
            }],
            max_tokens: agent.max_tokens.min(ACTION_DRAFT_MAX_TOKENS),
            temperature: Some(agent.temperature),
            top_p: Some(agent.top_p),
        })
        .await
        .map_err(|e| format!("LLM request failed: {e}"))?;

    let total_tokens = llm_resp.input_tokens + llm_resp.output_tokens;
    if total_tokens > 0 {
        if let Err(e) = record_ai_spend(&state.stdb, org_id, agent.agent_id, total_tokens).await {
            tracing::warn!(
                agent_id = agent.agent_id,
                error = %e,
                "record_ai_spend failed"
            );
        }
    }

    let model_json: Value = serde_json::from_str(clean_json_response(&llm_resp.text))
        .map_err(|e| format!("failed to parse action draft JSON: {e}"))?;
    parse_llm_drafts(req, &entries, &model_json)
}

fn non_empty(value: &str) -> bool {
    !value.trim().is_empty()
}

fn catalog_entry(reducer_name: &str) -> Option<&'static ActionCatalogEntry> {
    ACTION_CATALOG
        .iter()
        .find(|entry| entry.reducer_name == reducer_name)
}

fn allowed_catalog_entries(
    allowed_reducers: &[String],
) -> Result<Vec<&'static ActionCatalogEntry>, String> {
    if allowed_reducers.is_empty() {
        return Ok(ACTION_CATALOG.iter().collect());
    }

    let mut entries = Vec::new();
    for reducer in allowed_reducers {
        let reducer = reducer.trim();
        let Some(entry) = catalog_entry(reducer) else {
            return Err(format!("unknown allowed reducer: {reducer}"));
        };
        if !entries
            .iter()
            .any(|existing: &&ActionCatalogEntry| existing.reducer_name == entry.reducer_name)
        {
            entries.push(entry);
        }
    }
    Ok(entries)
}

fn choose_catalog_entry<'a>(
    query: &str,
    ui_context: Option<&ActionUiContext>,
    entries: &'a [&'static ActionCatalogEntry],
) -> Option<&'a ActionCatalogEntry> {
    let haystack = format!(
        "{} {} {} {} {}",
        query,
        ui_context
            .and_then(|ctx| ctx.route.as_deref())
            .unwrap_or_default(),
        ui_context
            .and_then(|ctx| ctx.module.as_deref())
            .unwrap_or_default(),
        ui_context
            .and_then(|ctx| ctx.entity_type.as_deref())
            .unwrap_or_default(),
        ui_context
            .and_then(|ctx| ctx.selection_summary.as_deref())
            .unwrap_or_default()
    )
    .to_ascii_lowercase();

    entries
        .iter()
        .copied()
        .find(|entry| {
            entry
                .keywords
                .iter()
                .any(|keyword| haystack.contains(keyword))
        })
        .or_else(|| entries.first().copied())
}

fn add_if_allowed(
    params: &mut Map<String, Value>,
    entry: &ActionCatalogEntry,
    key: &str,
    value: Value,
) {
    if entry.param_fields.contains(&key) {
        params.insert(key.to_string(), value);
    }
}

fn title_from_query(query: &str) -> String {
    let trimmed = query.trim();
    let without_prefix = trimmed
        .strip_prefix("create")
        .or_else(|| trimmed.strip_prefix("Create"))
        .unwrap_or(trimmed)
        .trim();
    let title: String = without_prefix.chars().take(120).collect();
    if title.is_empty() {
        "Review AI-proposed action".to_string()
    } else {
        title
    }
}

fn build_params(
    entry: &ActionCatalogEntry,
    company_id: u64,
    query: &str,
    ui_context: Option<&ActionUiContext>,
) -> Map<String, Value> {
    let mut params = Map::new();
    add_if_allowed(&mut params, entry, "company_id", json!(company_id));
    add_if_allowed(
        &mut params,
        entry,
        "metadata",
        json!({ "source": "ai_gateway_action_draft" }),
    );

    match entry.reducer_name {
        "create_task" => {
            add_if_allowed(&mut params, entry, "name", json!(title_from_query(query)));
            add_if_allowed(&mut params, entry, "description", json!(query.trim()));
            add_if_allowed(&mut params, entry, "priority", json!("1"));
            add_if_allowed(&mut params, entry, "state", json!("InProgress"));
            add_if_allowed(&mut params, entry, "kanban_state", json!("normal"));
            if let Some(entity_type) = ui_context.and_then(|ctx| ctx.entity_type.as_deref()) {
                if entity_type == "project_project" {
                    if let Some(project_id) = ui_context
                        .and_then(|ctx| ctx.entity_id.as_deref())
                        .and_then(|id| id.parse::<u64>().ok())
                    {
                        add_if_allowed(&mut params, entry, "project_id", json!(project_id));
                    }
                }
            }
        }
        "create_sale_order" => {
            add_if_allowed(&mut params, entry, "origin", json!("AI action draft"));
            add_if_allowed(&mut params, entry, "note", json!(query.trim()));
            add_if_allowed(&mut params, entry, "order_lines", json!([]));
        }
        "create_purchase_order" => {
            add_if_allowed(&mut params, entry, "origin", json!("AI action draft"));
            add_if_allowed(&mut params, entry, "notes", json!(query.trim()));
            add_if_allowed(&mut params, entry, "order_lines", json!([]));
        }
        _ => {}
    }

    params
}

fn validate_params(
    entry: &ActionCatalogEntry,
    company_id: u64,
    params: &Map<String, Value>,
) -> Vec<String> {
    let mut warnings = Vec::new();

    for key in params.keys() {
        if !entry.param_fields.contains(&key.as_str()) {
            warnings.push(format!("removed unsupported param field: {key}"));
        }
    }

    match params.get("company_id").and_then(Value::as_u64) {
        Some(param_company_id) if param_company_id == company_id => {}
        Some(_) => warnings.push("draft company_id did not match request company_id".to_string()),
        None => warnings.push(
            "draft includes no company_id param; caller must keep company scope flat".to_string(),
        ),
    }

    if entry.elevated {
        warnings.push(
            "elevated reducer: requires explicit human approval before execution".to_string(),
        );
    }

    warnings
}

fn snapshot_candidates_from_ui_context(ui_context: Option<&ActionUiContext>) -> Vec<EntityRef> {
    let Some(ctx) = ui_context else {
        return Vec::new();
    };
    let Some(entity_type) = ctx.entity_type.as_deref().filter(|value| !value.is_empty()) else {
        return Vec::new();
    };
    let Some(entity_id) = ctx
        .entity_id
        .as_deref()
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|id| *id > 0)
    else {
        return Vec::new();
    };

    vec![EntityRef {
        entity_type: entity_type.to_string(),
        entity_id,
        priority: 1.0,
    }]
}

async fn fetch_grounding_snapshots(
    state: &AppState,
    req: &ActionDraftRequest,
) -> Option<Vec<LiveSnapshot>> {
    let org_id = req.org_id.filter(|id| *id > 0)?;
    let allowed = (!req.allowed_entity_types.is_empty()).then_some(req.allowed_entity_types.as_slice());
    let candidates = filter_entity_refs_by_allowed_types(
        snapshot_candidates_from_ui_context(req.ui_context.as_ref()),
        allowed,
    );
    if candidates.is_empty() {
        return None;
    }

    fetch_live_snapshots(&state.stdb, org_id, req.company_id, &candidates)
        .await
        .ok()
        .filter(|snapshots| !snapshots.is_empty())
}

fn enrich_drafts_with_grounding(drafts: &mut [ActionDraft], snapshots: &[LiveSnapshot]) {
    for draft in drafts.iter_mut() {
        draft.warnings.push(format!(
            "grounded against {} live snapshot(s) from current ERP state",
            snapshots.len()
        ));
        if let Some(snapshot) = snapshots.first() {
            draft.summary = format!(
                "{} (grounded on {} #{})",
                draft.summary.trim_end_matches('.'),
                snapshot.entity_type.replace('_', " "),
                snapshot.entity_id
            );
        }
    }
}

fn draft_actions_stub(req: &ActionDraftRequest) -> Result<Vec<ActionDraft>, String> {
    let entries = allowed_catalog_entries(&req.allowed_reducers)?;
    let Some(entry) = choose_catalog_entry(&req.query, req.ui_context.as_ref(), &entries) else {
        return Ok(Vec::new());
    };

    let params = build_params(entry, req.company_id, &req.query, req.ui_context.as_ref());
    let warnings = validate_params(entry, req.company_id, &params);
    let confidence = if warnings
        .iter()
        .any(|w| w.contains("company_id did not match"))
    {
        0.0
    } else if entry.elevated {
        0.62
    } else {
        0.74
    };

    Ok(vec![ActionDraft {
        reducer_name: entry.reducer_name.to_string(),
        params_json: Value::Object(params),
        confidence,
        warnings,
        summary: format!(
            "Draft {} from the user request; no reducer was executed.",
            entry.reducer_name
        ),
        elevated: entry.elevated,
    }])
}

pub async fn post_draft(
    State(state): State<AppState>,
    Json(req): Json<ActionDraftRequest>,
) -> AppResult<Json<ActionDraftResponse>> {
    if req.company_id == 0 {
        return Err(AppError::BadRequest("company_id is required".into()));
    }
    if !non_empty(&req.query) {
        return Err(AppError::BadRequest("query must not be empty".into()));
    }

    let grounding_snapshots = fetch_grounding_snapshots(&state, &req).await;

    let mut drafts = match draft_actions_llm(
        &state,
        &req,
        grounding_snapshots.as_deref(),
    )
    .await
    {
        Ok(llm_drafts) if !llm_drafts.is_empty() => llm_drafts,
        Ok(_) => draft_actions_stub(&req).map_err(AppError::BadRequest)?,
        Err(err) => {
            tracing::warn!(error = %err, "LLM action draft generation failed; using keyword stub");
            draft_actions_stub(&req).map_err(AppError::BadRequest)?
        }
    };

    if let Some(ref snapshots) = grounding_snapshots {
        enrich_drafts_with_grounding(&mut drafts, snapshots);
    }

    tracing::info!(
        company_id = req.company_id,
        draft_count = drafts.len(),
        grounding_snapshot_count = grounding_snapshots.as_ref().map_or(0, Vec::len),
        "Generated advisory action drafts"
    );

    Ok(Json(ActionDraftResponse {
        drafts,
        grounding_snapshots,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_allowed_reducer() {
        let result = allowed_catalog_entries(&["drop_database".to_string()]);
        assert!(result.is_err());
    }

    #[test]
    fn task_draft_keeps_company_id_in_scope() {
        let req = ActionDraftRequest {
            org_id: Some(1),
            company_id: 42,
            query: "create task follow up with customer".to_string(),
            ui_context: None,
            allowed_reducers: vec!["create_task".to_string()],
            allowed_entity_types: Vec::new(),
            agent_id: None,
            team_member_id: None,
        };

        let drafts = draft_actions_stub(&req).expect("drafts");
        assert_eq!(drafts[0].reducer_name, "create_task");
        assert_eq!(drafts[0].params_json["company_id"], json!(42));
        assert!(!drafts[0]
            .warnings
            .iter()
            .any(|warning| warning.contains("did not match")));
    }

    #[test]
    fn sanitize_draft_params_strips_unknown_fields() {
        let entry = catalog_entry("create_task").expect("entry");
        let params = sanitize_draft_params(
            entry,
            42,
            &json!({
                "company_id": 42,
                "name": "Follow up",
                "unexpected": true
            }),
        );
        assert_eq!(params.get("name").and_then(Value::as_str), Some("Follow up"));
        assert!(params.get("unexpected").is_none());
    }

    #[test]
    fn parse_llm_drafts_accepts_schema_constrained_output() {
        let req = ActionDraftRequest {
            org_id: Some(1),
            company_id: 42,
            query: "create task".to_string(),
            ui_context: None,
            allowed_reducers: vec!["create_task".to_string()],
            allowed_entity_types: Vec::new(),
            agent_id: None,
            team_member_id: None,
        };
        let entries = allowed_catalog_entries(&req.allowed_reducers).expect("entries");
        let drafts = parse_llm_drafts(
            &req,
            &entries,
            &json!({
                "drafts": [{
                    "reducer_name": "create_task",
                    "params_json": { "company_id": 42, "name": "Call vendor" },
                    "confidence": 0.81,
                    "warnings": [],
                    "summary": "Create a follow-up task"
                }]
            }),
        )
        .expect("drafts");
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].params_json["name"], json!("Call vendor"));
    }
}
