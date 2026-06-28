//! SpacetimeDB HTTP client aligned with `frontend/packages/stdb/src/http.ts`.
//!
//! - SQL: `POST /v1/database/{module}/sql` with `text/plain` body.
//! - Reducers: `POST /v1/database/{module}/call/{reducer}` with JSON array body.

use anyhow::{Context, Result};
use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum StdbClientError {
    #[error("SpacetimeDB HTTP {0}: {1}")]
    Http(String, String),
    #[error("failed to parse SQL response: {0}")]
    Parse(String),
}

#[derive(Clone)]
pub struct StdbClient {
    http: std::sync::Arc<reqwest::Client>,
    base_url: String,
    module: String,
    token: String,
}

impl StdbClient {
    pub fn new(mut base_url: String, module: String, token: String) -> Self {
        base_url = base_url.trim_end_matches('/').to_string();
        Self {
            http: std::sync::Arc::new(reqwest::Client::new()),
            base_url,
            module,
            token,
        }
    }

    /// Same connection settings, different bearer token (e.g. admin fallback).
    pub fn with_token(&self, token: impl Into<String>) -> Self {
        Self {
            http: self.http.clone(),
            base_url: self.base_url.clone(),
            module: self.module.clone(),
            token: token.into(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn module(&self) -> &str {
        &self.module
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn http(&self) -> &reqwest::Client {
        self.http.as_ref()
    }

    /// `POST /v1/identity` — anonymous identity + token (no bearer).
    pub async fn provision_identity(&self) -> Result<(String, String)> {
        let url = format!("{}/v1/identity", self.base_url);
        let resp = self
            .http
            .post(&url)
            .send()
            .await
            .context("provision_identity POST")?;
        if !resp.status().is_success() {
            let status = resp.status().to_string();
            let body = resp.text().await.unwrap_or_default();
            return Err(StdbClientError::Http(status, body).into());
        }
        let v: Value = resp.json().await.context("provision_identity json")?;
        let identity = extract_identity_string(&v, "identity").context("identity field")?;
        let token = v
            .get("token")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .context("token field")?;
        Ok((identity, token))
    }

    /// Run SQL and return rows as JSON objects with camelCase keys (SATS Option unwrapped).
    pub async fn query_sql(&self, sql: &str) -> Result<Vec<Value>> {
        let url = format!("{}/v1/database/{}/sql", self.base_url, self.module);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .header("Content-Type", "text/plain")
            .body(sql.to_string())
            .send()
            .await
            .with_context(|| format!("SQL request failed: {sql}"))?;

        if !resp.status().is_success() {
            let status = resp.status().to_string();
            let body = resp.text().await.unwrap_or_default();
            return Err(StdbClientError::Http(status, body).into());
        }

        let body = resp.text().await.context("read SQL body")?;
        parse_sats_sql_response(&body).context("parse SATS-SQL JSON")
    }

    pub async fn query_table(&self, table: &str) -> Result<Vec<Value>> {
        self.query_sql(&format!("SELECT * FROM {table}")).await
    }

    /// Call reducer; body is a JSON array of args (no `ReducerContext`).
    pub async fn call_reducer(&self, reducer: &str, args: Value) -> Result<()> {
        let url = format!(
            "{}/v1/database/{}/call/{}",
            self.base_url, self.module, reducer
        );
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .header("Content-Type", "application/json")
            .json(&args)
            .send()
            .await
            .with_context(|| format!("reducer call failed: {reducer}"))?;

        if !resp.status().is_success() {
            let status = resp.status().to_string();
            let body = resp.text().await.unwrap_or_default();
            return Err(StdbClientError::Http(status, body).into());
        }
        Ok(())
    }
}

fn extract_identity_string(v: &Value, key: &str) -> Option<String> {
    let x = v.get(key)?;
    if let Some(s) = x.as_str() {
        return Some(
            s.trim()
                .trim_start_matches("0x")
                .trim_start_matches("0X")
                .to_string(),
        );
    }
    None
}

// ── SATS-JSON (mirrors `http.ts`) ───────────────────────────────────────────

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

fn element_name(el: &Value) -> String {
    let name = &el["name"];
    if let Some(s) = name.get("some").and_then(|v| v.as_str()) {
        return s.to_string();
    }
    String::new()
}

fn sats_unit_enum_tag(key: &str) -> String {
    let mut chars = key.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

fn unwrap_sats(v: &Value) -> Value {
    match v {
        Value::Object(map) => {
            if let Some(inner) = map.get("some") {
                return unwrap_sats(inner);
            }
            if map.get("none").is_some() {
                return Value::Null;
            }
            // SATS unit-variant JSON: `{ "outInvoice": [] }` or `{ "outInvoice": {} }` → `"OutInvoice"`
            if map.len() == 1 {
                if let Some((key, val)) = map.iter().next() {
                    if val.as_array().is_some_and(|a| a.is_empty())
                        || val.as_object().is_some_and(|o| o.is_empty())
                    {
                        return Value::String(sats_unit_enum_tag(key));
                    }
                }
            }
        }
        _ => {}
    }
    v.clone()
}

fn parse_row(elements: &[Value], row: &[Value]) -> Value {
    let mut obj = serde_json::Map::new();
    for (i, el) in elements.iter().enumerate() {
        let snake = element_name(el);
        if snake.is_empty() {
            continue;
        }
        let key = snake_to_camel(&snake);
        let cell = row.get(i).map(unwrap_sats).unwrap_or(Value::Null);
        obj.insert(key, cell);
    }
    Value::Object(obj)
}

/// Top-level JSON: array of `{ schema: { elements }, rows: [][] }`; use first set.
pub fn parse_sats_sql_response(body: &str) -> Result<Vec<Value>> {
    let root: Value =
        serde_json::from_str(body).map_err(|e| StdbClientError::Parse(e.to_string()))?;
    let arr = root
        .as_array()
        .ok_or_else(|| StdbClientError::Parse("expected top-level array".into()))?;
    let first = arr
        .first()
        .ok_or_else(|| StdbClientError::Parse("empty result array".into()))?;
    let elements = first["schema"]["elements"]
        .as_array()
        .ok_or_else(|| StdbClientError::Parse("missing schema.elements".into()))?;
    let element_vals: Vec<Value> = elements.clone();
    let rows = first["rows"]
        .as_array()
        .ok_or_else(|| StdbClientError::Parse("missing rows".into()))?;
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let cols = r
            .as_array()
            .ok_or_else(|| StdbClientError::Parse("row not array".into()))?;
        let col_vals: Vec<Value> = cols.clone();
        out.push(parse_row(&element_vals, &col_vals));
    }
    Ok(out)
}
