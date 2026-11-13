//! Bounded SQL reads over the private Assistant transcript tables.

use anyhow::{ensure, Context, Result};
use serde_json::Value;

use crate::{normalize_spacetime_identity_header, StdbClient, StdbClientError};

const SESSION_COLUMNS: &str =
    "id, organization_id, company_id, session_key, title, route, module, active_tab, archived, create_date, write_date";
const MESSAGE_COLUMNS: &str =
    "id, organization_id, company_id, session_key, role, content, sources_json, model, duration_ms, status, create_date, metadata, turn_id";
const CONTEXT_COLUMNS: &str = "id, role, content, status, metadata, model, sources_json, turn_id";
const MESSAGE_PREVIEW_COLUMNS: &str =
    "id, organization_id, company_id, session_key, role, status, create_date, turn_id";
const SESSION_PREVIEW_COLUMNS: &str =
    "id, organization_id, company_id, session_key, archived, create_date, write_date";
const MAX_CONTEXT_BYTES: usize = 512 * 1024;
const MAX_PAGE_ROWS: usize = 64;
const MAX_SEEK_QUERIES: usize = 256;
const PAYLOAD_BATCH_ROWS: usize = 8;
const MAX_BATCH_BYTES: usize = 512 * 1024;
const MAX_LEGACY_ROW_BYTES: usize = 2 * 1024 * 1024;
// Reserve space for the response wrapper, cursor and commas between rows.
const MAX_PAGE_BYTES: usize = 512 * 1024 - 256;

pub struct ChatMessagePage {
    pub rows: Vec<Value>,
    pub next_cursor: Option<u64>,
}

pub fn valid_chat_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 150
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub fn chat_row_id(row: &Value) -> Result<u64> {
    row.get("id")
        .and_then(|id| id.as_u64().or_else(|| id.as_str()?.parse().ok()))
        .filter(|id| *id > 0)
        .context("chat history row has no numeric ID")
}

fn actor_scope(org: u64, company: u64, actor: &str, actor_column: &str) -> Result<String> {
    ensure!(
        org > 0 && company > 0,
        "chat history requires an organization and company"
    );
    let actor =
        normalize_spacetime_identity_header(actor).context("invalid chat history identity")?;
    Ok(format!(
        "organization_id = {org} AND company_id = {company} AND {actor_column} = 0x{actor}"
    ))
}

fn thread_scope(
    org: u64,
    company: u64,
    actor: &str,
    key: &str,
    actor_column: &str,
) -> Result<String> {
    ensure!(valid_chat_key(key), "invalid chat session key");
    let scope = actor_scope(org, company, actor, actor_column)?;
    Ok(format!("{scope} AND session_key = '{key}'"))
}

async fn select_ids(
    client: &StdbClient,
    table: &str,
    predicate: &str,
    low: u64,
    high: u64,
    limit: usize,
    newest_first: bool,
) -> Result<Vec<u64>> {
    ensure!(
        (1..=MAX_PAGE_ROWS).contains(&limit),
        "invalid chat history limit"
    );
    if low > high {
        return Ok(Vec::new());
    }

    let client = client.with_query_limits(limit + 1, 64 * 1024)?;
    // SpacetimeDB SQL LIMIT does not specify row order. Read only IDs until
    // a range is proven complete, and visit the preferred half first. Even
    // with globally sparse IDs, the stack is limited by the ID width.
    let mut pending = vec![(low, high)];
    let mut result = Vec::with_capacity(limit);
    let mut probes = 0;
    while let Some((low, high)) = pending.pop() {
        probes += 1;
        ensure!(
            probes <= MAX_SEEK_QUERIES,
            "chat history page scan exhausted"
        );
        let available = limit - result.len();
        let probe_limit = available + 1;
        let sql = format!(
            "SELECT id FROM {table} WHERE {predicate} AND id >= {low} AND id <= {high} LIMIT {probe_limit}"
        );
        let rows = client.query_sql(&sql).await?;
        let mut ids = rows.iter().map(chat_row_id).collect::<Result<Vec<_>>>()?;
        ids.sort_unstable();
        ensure!(
            ids.iter().all(|id| (low..=high).contains(id))
                && ids.windows(2).all(|pair| pair[0] < pair[1]),
            "chat history ID escaped its window"
        );
        if ids.len() <= available {
            if newest_first {
                ids.reverse();
            }
            result.extend(ids);
            if result.len() == limit {
                break;
            }
            continue;
        }

        // The full sample already proves there are enough IDs on the
        // preferred side of its extreme, so discard the opposite tail.
        let first = ids
            .first()
            .copied()
            .context("empty full chat history sample")?;
        let last = ids
            .last()
            .copied()
            .context("empty full chat history sample")?;
        let (low, high) = if newest_first {
            (first, high)
        } else {
            (low, last)
        };
        ensure!(low < high, "invalid chat history ID interval");
        let midpoint = low + (high - low) / 2;
        if newest_first {
            pending.push((low, midpoint));
            pending.push((midpoint + 1, high));
        } else {
            pending.push((midpoint + 1, high));
            pending.push((low, midpoint));
        }
    }
    Ok(result)
}

async fn read_ids(
    client: &StdbClient,
    table: &str,
    columns: &str,
    predicate: &str,
    ids: Vec<u64>,
    max_bytes: usize,
) -> Result<Vec<Value>> {
    let bounded = client.with_query_limits(PAYLOAD_BATCH_ROWS, MAX_BATCH_BYTES)?;
    let single = client.with_query_limits(1, MAX_LEGACY_ROW_BYTES)?;
    let mut result = Vec::with_capacity(ids.len());
    let mut total_bytes = 0_usize;
    'payload: for batch in ids.chunks(PAYLOAD_BATCH_ROWS) {
        let terms = batch
            .iter()
            .map(|id| format!("id = {id}"))
            .collect::<Vec<_>>();
        let sql = format!(
            "SELECT {columns} FROM {table} WHERE {predicate} AND ({}) LIMIT {}",
            terms.join(" OR "),
            batch.len(),
        );
        let mut rows = match bounded.query_sql(&sql).await {
            Ok(rows) => rows,
            Err(error) if exceeds_query_bytes(&error) => {
                let mut rows = Vec::new();
                let mut bytes = 0;
                for id in batch {
                    let sql = format!(
                        "SELECT {columns} FROM {table} WHERE {predicate} AND id = {id} LIMIT 1"
                    );
                    let returned = match single.query_sql(&sql).await {
                        Ok(rows) => rows,
                        Err(error) if exceeds_query_bytes(&error) => {
                            let columns = if table == "ai_chat_message" {
                                MESSAGE_PREVIEW_COLUMNS
                            } else {
                                SESSION_PREVIEW_COLUMNS
                            };
                            let sql = format!(
                                "SELECT {columns} FROM {table} WHERE {predicate} AND id = {id} LIMIT 1"
                            );
                            let mut rows = bounded.query_sql(&sql).await?;
                            for row in &mut rows {
                                bound_legacy_row(row);
                            }
                            rows
                        }
                        Err(error) => return Err(error),
                    };
                    for mut row in returned {
                        let mut size = serde_json::to_vec(&row)?.len();
                        if size > max_bytes {
                            bound_legacy_row(&mut row);
                            size = serde_json::to_vec(&row)?.len();
                        }
                        bytes += size;
                        rows.push(row);
                    }
                    if bytes > max_bytes {
                        break;
                    }
                }
                rows
            }
            Err(error) => return Err(error),
        };
        for id in batch {
            let Some(index) = rows
                .iter()
                .position(|row| chat_row_id(row).ok() == Some(*id))
            else {
                continue;
            };
            let row = rows.swap_remove(index);
            let mut row = row;
            // Oversized legacy records remain reachable by ID. Show a bounded
            // transcript preview and omit large card payloads for that row.
            if serde_json::to_vec(&row)?.len() > max_bytes {
                bound_legacy_row(&mut row);
            }
            total_bytes += serde_json::to_vec(&row)?.len();
            if total_bytes > max_bytes {
                break 'payload;
            }
            result.push(row);
        }
        ensure!(rows.is_empty(), "chat history row escaped its page");
    }
    Ok(result)
}

fn newest_page_cursor(rows: &[Value], selected: usize, more_ids: bool) -> Result<Option<u64>> {
    if more_ids || rows.len() < selected {
        return rows.last().map(chat_row_id).transpose();
    }
    Ok(None)
}

fn exceeds_query_bytes(error: &anyhow::Error) -> bool {
    matches!(error.downcast_ref(), Some(StdbClientError::QueryByteLimit))
}

fn bound_legacy_row(row: &mut Value) {
    if let Some(fields) = row.as_object_mut() {
        for field in ["sourcesJson", "metadata"] {
            if fields.contains_key(field) {
                fields.insert(field.into(), Value::Null);
            }
        }
        for (field, limit) in [
            ("content", 48 * 1024),
            ("title", 512),
            ("route", 2048),
            ("module", 150),
            ("activeTab", 150),
            ("model", 256),
        ] {
            if let Some(value) = fields.get_mut(field) {
                if let Some(text) = value.as_str() {
                    *value = Value::String(text[..text.floor_char_boundary(limit)].to_owned());
                }
            }
        }
        if fields.contains_key("role") && !fields.contains_key("content") {
            fields.insert("content".into(), Value::String(String::new()));
        }
        fields.insert("historyTruncated".into(), Value::Bool(true));
    }
}

impl StdbClient {
    /// Requires the database owner token. Callers authorize current company access
    /// before passing an authenticated actor identity to these private-table reads.
    pub async fn chat_session(
        &self,
        org: u64,
        company: u64,
        actor: &str,
        key: &str,
    ) -> Result<Option<Value>> {
        let scope = thread_scope(org, company, actor, key, "create_uid")?;
        let client = self.with_query_limits(1, 32 * 1024)?;
        let ids = client
            .query_sql(&format!(
                "SELECT id FROM ai_chat_session WHERE {scope} LIMIT 2"
            ))
            .await?;
        let ids = ids.iter().map(chat_row_id).collect::<Result<Vec<_>>>()?;
        let rows = read_ids(
            self,
            "ai_chat_session",
            SESSION_COLUMNS,
            &scope,
            ids,
            MAX_PAGE_BYTES,
        )
        .await?;
        Ok(rows.into_iter().next())
    }

    pub async fn chat_sessions_page(
        &self,
        org: u64,
        company: u64,
        actor: &str,
        archived: bool,
        module: Option<&str>,
        before: Option<u64>,
        limit: usize,
    ) -> Result<ChatMessagePage> {
        ensure!(
            (1..MAX_PAGE_ROWS).contains(&limit),
            "invalid chat history limit"
        );
        let mut scope = format!(
            "{} AND archived = {archived}",
            actor_scope(org, company, actor, "create_uid")?
        );
        if let Some(module) = module {
            ensure!(valid_chat_key(module), "invalid chat module");
            scope.push_str(&format!(" AND module = '{module}'"));
        }
        let high = before.map_or(u64::MAX, |id| id.saturating_sub(1));
        let mut ids = select_ids(self, "ai_chat_session", &scope, 1, high, limit + 1, true).await?;
        let remaining = ids.len() > limit;
        ids.truncate(limit);
        let selected = ids.len();
        let rows = read_ids(
            self,
            "ai_chat_session",
            SESSION_COLUMNS,
            &scope,
            ids,
            MAX_PAGE_BYTES,
        )
        .await?;
        let next_cursor = newest_page_cursor(&rows, selected, remaining)?;
        Ok(ChatMessagePage { rows, next_cursor })
    }

    pub async fn chat_message(
        &self,
        org: u64,
        company: u64,
        actor: &str,
        key: &str,
        id: u64,
    ) -> Result<Option<Value>> {
        let scope = thread_scope(org, company, actor, key, "created_by")?;
        let rows = read_ids(
            self,
            "ai_chat_message",
            MESSAGE_COLUMNS,
            &scope,
            vec![id],
            MAX_PAGE_BYTES,
        )
        .await?;
        Ok(rows.into_iter().next())
    }

    pub async fn chat_message_page(
        &self,
        org: u64,
        company: u64,
        actor: &str,
        key: &str,
        before: Option<u64>,
        limit: usize,
    ) -> Result<Vec<Value>> {
        let scope = thread_scope(org, company, actor, key, "created_by")?;
        let high = before.map_or(u64::MAX, |id| id.saturating_sub(1));
        let ids = select_ids(self, "ai_chat_message", &scope, 1, high, limit, true).await?;
        let mut rows = read_ids(
            self,
            "ai_chat_message",
            CONTEXT_COLUMNS,
            &scope,
            ids,
            MAX_CONTEXT_BYTES,
        )
        .await?;
        rows.reverse();
        Ok(rows)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn chat_message_page_with_cursor(
        &self,
        org: u64,
        company: u64,
        actor: &str,
        key: &str,
        before: Option<u64>,
        limit: usize,
        search: bool,
    ) -> Result<ChatMessagePage> {
        ensure!(limit < MAX_PAGE_ROWS, "invalid chat history limit");
        let scope = thread_scope(org, company, actor, key, "created_by")?;
        let high = before.map_or(u64::MAX, |id| id.saturating_sub(1));
        let mut ids = select_ids(self, "ai_chat_message", &scope, 1, high, limit + 1, true).await?;
        let remaining = ids.len() > limit;
        ids.truncate(limit);
        let selected = ids.len();
        let columns = if search {
            "id, content"
        } else {
            MESSAGE_COLUMNS
        };
        let mut rows = read_ids(
            self,
            "ai_chat_message",
            columns,
            &scope,
            ids,
            MAX_PAGE_BYTES,
        )
        .await?;
        let next_cursor = newest_page_cursor(&rows, selected, remaining)?;
        rows.reverse();
        Ok(ChatMessagePage { rows, next_cursor })
    }

    pub async fn chat_message_range(
        &self,
        org: u64,
        company: u64,
        actor: &str,
        key: &str,
        after: u64,
        through: u64,
        limit: usize,
    ) -> Result<Vec<Value>> {
        if after >= through {
            return Ok(Vec::new());
        }
        let scope = thread_scope(org, company, actor, key, "created_by")?;
        let ids = select_ids(
            self,
            "ai_chat_message",
            &scope,
            after.saturating_add(1),
            through,
            limit,
            false,
        )
        .await?;
        read_ids(
            self,
            "ai_chat_message",
            CONTEXT_COLUMNS,
            &scope,
            ids,
            MAX_CONTEXT_BYTES,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Router};
    use serde_json::json;

    #[tokio::test]
    async fn unordered_sql_pagination_finds_latest_and_oldest_sparse_ids() {
        let ids = [1, 8, 37, 800, 8_000, 800_000, u32::MAX as u64 + 1];
        let app = Router::new().route(
            "/v1/database/test/sql",
            post(move |sql: String| async move {
                let low = number_after(&sql, "id >= ");
                let high = number_after(&sql, "id <= ");
                let limit = number_after(&sql, "LIMIT ") as usize;
                let rows = ids
                    .iter()
                    .filter(|&&id| (low..=high).contains(&id))
                    .take(limit)
                    .map(|id| vec![*id])
                    .collect::<Vec<_>>();
                axum::Json(json!([{
                    "schema": { "elements": [{ "name": { "some": "id" }, "algebraic_type": { "U64": [] } }] },
                    "rows": rows,
                }]))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = StdbClient::new(format!("http://{address}"), "test".into(), "owner".into());
        assert_eq!(
            select_ids(
                &client,
                "ai_chat_message",
                "company_id = 4",
                1,
                u64::MAX,
                3,
                true
            )
            .await
            .unwrap(),
            vec![ids[6], ids[5], ids[4]]
        );
        assert_eq!(
            select_ids(
                &client,
                "ai_chat_message",
                "company_id = 4",
                2,
                u64::MAX,
                3,
                false
            )
            .await
            .unwrap(),
            vec![8, 37, 800]
        );
        server.abort();
    }

    fn number_after(sql: &str, marker: &str) -> u64 {
        sql.split_once(marker)
            .unwrap()
            .1
            .split_whitespace()
            .next()
            .unwrap()
            .parse()
            .unwrap()
    }

    #[test]
    fn page_cursor_survives_payload_truncation() {
        let rows = [json!({ "id": 40 }), json!({ "id": 30 })];
        assert_eq!(newest_page_cursor(&rows, 3, false).unwrap(), Some(30));
        assert_eq!(newest_page_cursor(&rows, 2, true).unwrap(), Some(30));
        assert_eq!(newest_page_cursor(&rows, 2, false).unwrap(), None);
    }

    #[test]
    fn oversized_preview_keeps_id_and_utf8_boundary() {
        let mut row = json!({ "id": 7, "content": "é".repeat(80_000), "sourcesJson": "large" });
        bound_legacy_row(&mut row);
        assert_eq!(row["id"], 7);
        assert_eq!(row["content"].as_str().unwrap().len(), 48 * 1024);
        assert_eq!(row["sourcesJson"], Value::Null);
        assert_eq!(row["historyTruncated"], true);
    }
}
