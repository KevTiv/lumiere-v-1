//! Live ERP row snapshots via SpacetimeDB SQL (read-only grounding layer).

use anyhow::{Context, Result};
use serde::Deserialize;
use serde::Serialize;
use serde_json::{Map, Value};
use stdb_client::StdbClient;

use crate::{
    harness::entity_registry::{
        content_type_to_entity, entity_type_allowed, format_snapshot_label, lookup_entity_spec,
        EntitySnapshotSpec, RelationSnapshotSpec, ScopeKind,
    },
    qdrant_client::SearchResult,
    rig_agent::ContextHit,
};

/// UI focus metadata forwarded from the BFF (mirrors `routes/rag::UiContext`).
#[derive(Clone, Deserialize, Default)]
pub struct SnapshotUiContext {
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
}

pub const RAG_MAX_LIVE_SNAPSHOTS: usize = 3;
pub const HARNESS_MAX_LIVE_SNAPSHOTS: usize = 5;

#[derive(Clone, Debug, PartialEq)]
pub struct EntityRef {
    pub entity_type: String,
    pub entity_id: u64,
    pub priority: f32,
}

#[derive(Clone, Debug, Serialize)]
pub struct RelationSnapshot {
    pub relation_key: String,
    pub rows: Vec<Value>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LiveSnapshot {
    pub entity_type: String,
    pub entity_id: u64,
    pub label: String,
    pub snapshot_at: String,
    pub row: Value,
    pub relations: Vec<RelationSnapshot>,
}

pub fn filter_entity_refs_by_allowed_types(
    candidates: Vec<EntityRef>,
    allowed_entity_types: Option<&[String]>,
) -> Vec<EntityRef> {
    candidates
        .into_iter()
        .filter(|candidate| entity_type_allowed(&candidate.entity_type, allowed_entity_types))
        .collect()
}

pub fn resolve_snapshot_candidates(
    ui_context: Option<&SnapshotUiContext>,
    company_hits: &[SearchResult],
    org_hits: &[ContextHit],
    max: usize,
) -> Vec<EntityRef> {
    let mut candidates: Vec<EntityRef> = Vec::new();

    if let Some(ctx) = ui_context {
        if let (Some(entity_type), Some(entity_id)) = (
            ctx.entity_type.as_deref().filter(|s| !s.is_empty()),
            ctx.entity_id.as_deref().filter(|s| !s.is_empty()),
        ) {
            if let Some(id) = entity_id.parse::<u64>().ok().filter(|id| *id > 0) {
                if lookup_entity_spec(entity_type).is_some() {
                    candidates.push(EntityRef {
                        entity_type: entity_type.to_string(),
                        entity_id: id,
                        priority: 1.0,
                    });
                }
            }
        }
    }

    for hit in org_hits {
        if lookup_entity_spec(&hit.entity_type).is_none() {
            continue;
        }
        let Some(id) = hit.entity_id.parse::<u64>().ok().filter(|id| *id > 0) else {
            continue;
        };
        candidates.push(EntityRef {
            entity_type: hit.entity_type.clone(),
            entity_id: id,
            priority: hit.score,
        });
    }

    for hit in company_hits {
        let Some(entity_type) = content_type_to_entity(&hit.record.resource_kind) else {
            continue;
        };
        let Some(entity_id) = hit.record.resource_id.parse::<u64>().ok().filter(|id| *id > 0)
        else {
            continue;
        };
        candidates.push(EntityRef {
            entity_type: entity_type.to_string(),
            entity_id,
            priority: hit.score * 0.9,
        });
    }

    candidates.sort_by(|a, b| {
        b.priority
            .partial_cmp(&a.priority)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut seen = std::collections::HashSet::new();
    let mut deduped: Vec<EntityRef> = Vec::new();
    for candidate in candidates {
        let key = (candidate.entity_type.clone(), candidate.entity_id);
        if seen.insert(key) {
            deduped.push(candidate);
        }
        if deduped.len() >= max {
            break;
        }
    }

    deduped
}

pub async fn fetch_live_snapshots(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    candidates: &[EntityRef],
) -> Result<Vec<LiveSnapshot>> {
    let snapshot_at = utc_now_rfc3339();
    let mut out = Vec::new();

    for candidate in candidates {
        let Some(spec) = lookup_entity_spec(&candidate.entity_type) else {
            continue;
        };
        match fetch_one_snapshot(
            stdb,
            spec,
            org_id,
            company_id,
            candidate.entity_id,
            &snapshot_at,
        )
        .await
        {
            Ok(Some(snapshot)) => out.push(snapshot),
            Ok(None) => {}
            Err(err) => {
                tracing::warn!(
                    entity_type = %candidate.entity_type,
                    entity_id = candidate.entity_id,
                    error = %err,
                    "Live snapshot fetch failed; skipping entity"
                );
            }
        }
    }

    Ok(out)
}

async fn fetch_one_snapshot(
    stdb: &StdbClient,
    spec: &EntitySnapshotSpec,
    org_id: u64,
    company_id: u64,
    entity_id: u64,
    snapshot_at: &str,
) -> Result<Option<LiveSnapshot>> {
    let select_list = spec.prompt_fields.join(", ");
    let sql = build_snapshot_sql(spec, org_id, company_id, entity_id, &select_list);
    let rows = stdb
        .query_sql(&sql)
        .await
        .with_context(|| format!("snapshot SQL for {} #{}", spec.entity_type, entity_id))?;

    let Some(row) = rows.into_iter().next() else {
        return Ok(None);
    };

    if !row_matches_scope(spec, &row, org_id, company_id) {
        return Ok(None);
    }

    let filtered = filter_prompt_fields(&row, spec.prompt_fields);
    let label = format_snapshot_label(spec.label_template, entity_id);
    let relations = fetch_relation_snapshots(stdb, spec, org_id, company_id, entity_id).await?;

    Ok(Some(LiveSnapshot {
        entity_type: spec.entity_type.to_string(),
        entity_id,
        label,
        snapshot_at: snapshot_at.to_string(),
        row: filtered,
        relations,
    }))
}

async fn fetch_relation_snapshots(
    stdb: &StdbClient,
    spec: &EntitySnapshotSpec,
    org_id: u64,
    company_id: u64,
    entity_id: u64,
) -> Result<Vec<RelationSnapshot>> {
    let mut out = Vec::new();
    for relation in spec.relations {
        let select_list = relation.prompt_fields.join(", ");
        let sql = build_relation_sql(relation, org_id, company_id, entity_id, &select_list);
        let rows = stdb.query_sql(&sql).await.with_context(|| {
            format!(
                "relation SQL for {} #{} ({})",
                spec.entity_type, entity_id, relation.relation_key
            )
        })?;

        let filtered_rows: Vec<Value> = rows
            .into_iter()
            .filter(|row| row_matches_relation_scope(relation, row, org_id, company_id))
            .map(|row| filter_prompt_fields(&row, relation.prompt_fields))
            .collect();

        if !filtered_rows.is_empty() {
            out.push(RelationSnapshot {
                relation_key: relation.relation_key.to_string(),
                rows: filtered_rows,
            });
        }
    }
    Ok(out)
}

fn build_relation_sql(
    relation: &RelationSnapshotSpec,
    org_id: u64,
    company_id: u64,
    parent_entity_id: u64,
    select_list: &str,
) -> String {
    match relation.scope {
        ScopeKind::Company => {
            format!(
                "SELECT {select_list} FROM {} WHERE {} = {parent_entity_id} AND {} = {company_id} LIMIT {}",
                relation.table,
                relation.foreign_key,
                relation.company_column.unwrap_or("company_id"),
                relation.limit
            )
        }
        ScopeKind::Organization => {
            format!(
                "SELECT {select_list} FROM {} WHERE {} = {parent_entity_id} AND {} = {org_id} LIMIT {}",
                relation.table,
                relation.foreign_key,
                relation.org_column.unwrap_or("organization_id"),
                relation.limit
            )
        }
        ScopeKind::OrganizationOptionalCompany => {
            format!(
                "SELECT {select_list} FROM {} WHERE {} = {parent_entity_id} AND {} = {org_id} LIMIT {}",
                relation.table,
                relation.foreign_key,
                relation.org_column.unwrap_or("organization_id"),
                relation.limit
            )
        }
    }
}

fn row_matches_relation_scope(
    relation: &RelationSnapshotSpec,
    row: &Value,
    org_id: u64,
    company_id: u64,
) -> bool {
    if let Some(org_col) = relation.org_column {
        let camel = snake_to_camel(org_col);
        if let Some(row_org) = json_u64(row.get(org_col).or_else(|| row.get(&camel))) {
            if row_org != org_id {
                return false;
            }
        }
    }

    match relation.scope {
        ScopeKind::Company => {
            let col = relation.company_column.unwrap_or("company_id");
            let camel = snake_to_camel(col);
            json_u64(row.get(col).or_else(|| row.get(&camel))) == Some(company_id)
        }
        ScopeKind::Organization => true,
        ScopeKind::OrganizationOptionalCompany => {
            let col = relation.company_column.unwrap_or("company_id");
            let camel = snake_to_camel(col);
            match row.get(col).or_else(|| row.get(&camel)) {
                None | Some(Value::Null) => true,
                Some(value) => json_u64(Some(value)).is_none_or(|cid| cid == company_id),
            }
        }
    }
}

fn build_snapshot_sql(
    spec: &EntitySnapshotSpec,
    org_id: u64,
    company_id: u64,
    entity_id: u64,
    select_list: &str,
) -> String {
    match spec.scope {
        ScopeKind::Company => {
            format!(
                "SELECT {select_list} FROM {} WHERE {} = {entity_id} AND {} = {company_id} LIMIT 1",
                spec.table,
                spec.id_column,
                spec.company_column.unwrap_or("company_id")
            )
        }
        ScopeKind::Organization => {
            format!(
                "SELECT {select_list} FROM {} WHERE {} = {entity_id} AND {} = {org_id} LIMIT 1",
                spec.table,
                spec.id_column,
                spec.org_column.unwrap_or("organization_id")
            )
        }
        ScopeKind::OrganizationOptionalCompany => {
            format!(
                "SELECT {select_list} FROM {} WHERE {} = {entity_id} AND {} = {org_id} LIMIT 1",
                spec.table,
                spec.id_column,
                spec.org_column.unwrap_or("organization_id")
            )
        }
    }
}

fn row_matches_scope(spec: &EntitySnapshotSpec, row: &Value, org_id: u64, company_id: u64) -> bool {
    if let Some(org_col) = spec.org_column {
        let camel = snake_to_camel(org_col);
        if let Some(row_org) = json_u64(row.get(org_col).or_else(|| row.get(&camel))) {
            if row_org != org_id {
                return false;
            }
        }
    }

    match spec.scope {
        ScopeKind::Company => {
            let col = spec.company_column.unwrap_or("company_id");
            let camel = snake_to_camel(col);
            json_u64(row.get(col).or_else(|| row.get(&camel))) == Some(company_id)
        }
        ScopeKind::Organization => true,
        ScopeKind::OrganizationOptionalCompany => {
            let col = spec.company_column.unwrap_or("company_id");
            let camel = snake_to_camel(col);
            match row.get(col).or_else(|| row.get(&camel)) {
                None | Some(Value::Null) => true,
                Some(value) => json_u64(Some(value)).is_none_or(|cid| cid == company_id),
            }
        }
    }
}

fn filter_prompt_fields(row: &Value, fields: &[&str]) -> Value {
    let Some(obj) = row.as_object() else {
        return row.clone();
    };

    let mut out = Map::new();
    for field in fields {
        let camel = snake_to_camel(field);
        if let Some(value) = obj.get(*field).or_else(|| obj.get(&camel)) {
            out.insert(camel, value.clone());
        }
    }
    Value::Object(out)
}

pub fn format_live_context_block(snapshots: &[LiveSnapshot]) -> String {
    snapshots
        .iter()
        .enumerate()
        .map(|(i, snapshot)| {
            let json = serde_json::to_string(&snapshot.row).unwrap_or_else(|_| "{}".to_string());
            let mut block = format!(
                "[L{}] {} (as of {})\n{}",
                i + 1,
                snapshot.label,
                snapshot.snapshot_at,
                json
            );
            for relation in &snapshot.relations {
                let rel_json =
                    serde_json::to_string(&relation.rows).unwrap_or_else(|_| "[]".to_string());
                block.push_str(&format!("\n  {}: {}", relation.relation_key, rel_json));
            }
            block
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn json_u64(value: Option<&Value>) -> Option<u64> {
    let value = value?;
    if let Some(n) = value.as_u64() {
        return Some(n);
    }
    if let Some(n) = value.as_i64() {
        return (n >= 0).then_some(n as u64);
    }
    if let Some(s) = value.as_str() {
        return s.parse().ok();
    }
    None
}

fn snake_to_camel(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut upper = false;
    for c in s.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.push(c.to_ascii_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

fn utc_now_rfc3339() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    let days = secs / 86_400;
    let time_of_day = secs % 86_400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let (year, month, day) = civil_from_days(days as i64);
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}Z")
}

/// Algorithm from http://howardhinnant.github.io/date_algorithms.html (civil_from_days).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_prioritize_ui_focus() {
        let ui = SnapshotUiContext {
            entity_type: Some("sale_order".into()),
            entity_id: Some("42".into()),
            ..Default::default()
        };
        let org = vec![ContextHit {
            score: 0.95,
            entity_type: "product".into(),
            entity_id: "7".into(),
            text: String::new(),
            timestamp: 0,
            source: String::new(),
        }];
        let refs = resolve_snapshot_candidates(Some(&ui), &[], &org, 3);
        assert_eq!(refs[0].entity_type, "sale_order");
        assert_eq!(refs[0].entity_id, 42);
    }

    #[test]
    fn candidates_dedupe_entity_refs() {
        let ui = SnapshotUiContext {
            entity_type: Some("contact".into()),
            entity_id: Some("5".into()),
            ..Default::default()
        };
        let org = vec![ContextHit {
            score: 0.8,
            entity_type: "contact".into(),
            entity_id: "5".into(),
            text: String::new(),
            timestamp: 0,
            source: String::new(),
        }];
        let refs = resolve_snapshot_candidates(Some(&ui), &[], &org, 3);
        assert_eq!(refs.len(), 1);
    }

    #[test]
    fn filter_prompt_fields_strips_extra_columns() {
        let row = serde_json::json!({
            "id": 1,
            "name": "Widget",
            "secretToken": "nope",
            "listPrice": 9.99
        });
        let filtered = filter_prompt_fields(&row, &["id", "name", "list_price"]);
        let obj = filtered.as_object().expect("object");
        assert!(obj.contains_key("id"));
        assert!(obj.contains_key("name"));
        assert!(obj.contains_key("listPrice"));
        assert!(!obj.contains_key("secretToken"));
    }

    #[test]
    fn row_matches_optional_company_contact() {
        let spec = lookup_entity_spec("contact").expect("spec");
        let row = serde_json::json!({ "organizationId": 1, "companyId": null });
        assert!(row_matches_scope(spec, &row, 1, 10));

        let row_company = serde_json::json!({ "organizationId": 1, "companyId": 10 });
        assert!(row_matches_scope(spec, &row_company, 1, 10));

        let row_other = serde_json::json!({ "organizationId": 1, "companyId": 99 });
        assert!(!row_matches_scope(spec, &row_other, 1, 10));
    }

    #[test]
    fn live_context_block_labels_snapshots() {
        let block = format_live_context_block(&[LiveSnapshot {
            entity_type: "sale_order".into(),
            entity_id: 42,
            label: "Sale order #42".into(),
            snapshot_at: "2026-06-12T12:00:00Z".into(),
            row: serde_json::json!({"state": "sale"}),
            relations: vec![RelationSnapshot {
                relation_key: "lines".into(),
                rows: vec![serde_json::json!({"id": 1, "productId": 5})],
            }],
        }]);
        assert!(block.contains("[L1]"));
        assert!(block.contains("Sale order #42"));
        assert!(block.contains("lines:"));
    }

    #[test]
    fn filter_entity_refs_respects_allowlist() {
        let refs = filter_entity_refs_by_allowed_types(
            vec![
                EntityRef {
                    entity_type: "sale_order".into(),
                    entity_id: 1,
                    priority: 1.0,
                },
                EntityRef {
                    entity_type: "product".into(),
                    entity_id: 2,
                    priority: 0.5,
                },
            ],
            Some(&["sale_order".to_string()]),
        );
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].entity_type, "sale_order");
    }
}
