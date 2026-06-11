//! Advisory AI action draft generation. This route never executes reducers.
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ActionUiContext {
    pub route: Option<String>,
    pub module: Option<String>,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub selection_summary: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ActionDraftRequest {
    pub company_id: u64,
    pub query: String,
    pub ui_context: Option<ActionUiContext>,
    #[serde(default)]
    pub allowed_reducers: Vec<String>,
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
            add_if_allowed(&mut params, entry, "state", json!("todo"));
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

fn draft_actions(req: &ActionDraftRequest) -> Result<Vec<ActionDraft>, String> {
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
    Json(req): Json<ActionDraftRequest>,
) -> AppResult<Json<ActionDraftResponse>> {
    if req.company_id == 0 {
        return Err(AppError::BadRequest("company_id is required".into()));
    }
    if !non_empty(&req.query) {
        return Err(AppError::BadRequest("query must not be empty".into()));
    }

    let drafts = draft_actions(&req).map_err(AppError::BadRequest)?;

    tracing::info!(
        company_id = req.company_id,
        draft_count = drafts.len(),
        "Generated advisory action drafts"
    );

    Ok(Json(ActionDraftResponse { drafts }))
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
            company_id: 42,
            query: "create task follow up with customer".to_string(),
            ui_context: None,
            allowed_reducers: vec!["create_task".to_string()],
        };

        let drafts = draft_actions(&req).expect("drafts");
        assert_eq!(drafts[0].reducer_name, "create_task");
        assert_eq!(drafts[0].params_json["company_id"], json!(42));
        assert!(!drafts[0]
            .warnings
            .iter()
            .any(|warning| warning.contains("did not match")));
    }
}
