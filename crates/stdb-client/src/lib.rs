//! SpacetimeDB HTTP client aligned with `frontend/packages/stdb/src/http.ts`.
//!
//! - SQL: `POST /v1/database/{module}/sql` with `text/plain` body.
//! - Reducers: `POST /v1/database/{module}/call/{reducer}` with JSON array body.

use anyhow::{Context, Result};
use serde_json::Value;

mod contract;
pub use contract::{
    company_scope_paths, reducer_contract, reducer_contract_by_operation_id, reducer_names,
    CompanyScopePath, Exposure, IntoReducerCall, ReducerCall, ReducerContract,
    ReducerContractError, ReducerName, ReducerParam, ScalarKind,
};

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

    /// Call a reducer whose name and arguments were validated against the module manifest.
    pub async fn call_reducer(&self, call: impl IntoReducerCall) -> Result<()> {
        let call = call.into_reducer_call()?;
        let (contract, args) = call.into_parts();
        self.call_reducer_unchecked(
            contract.name,
            Value::Array(encode_reducer_wire_args(contract, args)),
        )
        .await
    }

    async fn call_reducer_unchecked(&self, reducer: &str, args: Value) -> Result<()> {
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

/// The public reducer contract accepts ergonomic JSON scalars/null for
/// top-level `Option<T>` parameters. SpacetimeDB's reducer HTTP endpoint uses
/// SATS sum encoding on the wire, so encode those values only after contract
/// validation. Composite arguments already contain their generated SATS
/// representation and must remain untouched.
fn encode_reducer_wire_args(contract: &ReducerContract, args: Vec<Value>) -> Vec<Value> {
    args.into_iter()
        .zip(contract.params)
        .map(|(value, parameter)| {
            if matches!(
                parameter.kind,
                ScalarKind::OptionalBool
                    | ScalarKind::OptionalFloat
                    | ScalarKind::OptionalSignedInteger
                    | ScalarKind::OptionalUnsignedInteger
                    | ScalarKind::OptionalString
            ) {
                if value.is_null() {
                    serde_json::json!({ "none": [] })
                } else {
                    serde_json::json!({ "some": value })
                }
            } else {
                value
            }
        })
        .collect()
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

fn variant_name_from_element(v: &Value) -> Option<String> {
    v.get("name")?
        .get("some")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
}

fn is_option_sum(sum: &Value) -> bool {
    let Some(variants) = sum.get("variants").and_then(|v| v.as_array()) else {
        return false;
    };
    let mut has_some = false;
    let mut has_none = false;
    for v in variants {
        match variant_name_from_element(v).as_deref() {
            Some("some") => has_some = true,
            Some("none") => has_none = true,
            _ => {}
        }
    }
    has_some && has_none
}

fn is_timestamp_product(atype: &Value) -> bool {
    let Some(elements) = atype
        .get("Product")
        .and_then(|p| p.get("elements"))
        .and_then(|e| e.as_array())
    else {
        return false;
    };
    elements.len() == 1 && element_name(&elements[0]) == "__timestamp_micros_since_unix_epoch__"
}

fn is_empty_payload(v: &Value) -> bool {
    match v {
        Value::Array(a) => a.is_empty(),
        Value::Object(o) => o.is_empty(),
        Value::Null => true,
        _ => false,
    }
}

fn is_unit_product(atype: &Value) -> bool {
    atype
        .get("Product")
        .and_then(|p| p.get("elements"))
        .and_then(|e| e.as_array())
        .is_some_and(|els| els.is_empty())
}

fn unwrap_sats_object(v: &Value) -> Option<Value> {
    let map = v.as_object()?;
    if let Some(inner) = map.get("some") {
        return Some(unwrap_sats_typed(inner, None));
    }
    if map.get("none").is_some() {
        return Some(Value::Null);
    }
    // SATS unit-variant JSON: `{ "outInvoice": [] }` or `{ "outInvoice": {} }` → `"OutInvoice"`
    if map.len() == 1 {
        if let Some((key, val)) = map.iter().next() {
            if val.as_array().is_some_and(|a| a.is_empty())
                || val.as_object().is_some_and(|o| o.is_empty())
            {
                return Some(Value::String(sats_unit_enum_tag(key)));
            }
        }
    }
    None
}

fn unwrap_sats_typed(v: &Value, algebraic_type: Option<&Value>) -> Value {
    if let Some(unwrapped) = unwrap_sats_object(v) {
        return unwrapped;
    }

    if let Some(atype) = algebraic_type {
        if let Some(sum) = atype.get("Sum") {
            if let Value::Array(arr) = v {
                if arr.len() >= 2 {
                    let tag = arr[0].as_u64();
                    let payload = &arr[1];
                    if is_option_sum(sum) {
                        return match tag {
                            Some(0) => {
                                let inner = &sum["variants"][0]["algebraic_type"];
                                unwrap_sats_typed(payload, Some(inner))
                            }
                            Some(1) => Value::Null,
                            _ => v.clone(),
                        };
                    }
                    if let Some(variants) = sum.get("variants").and_then(|x| x.as_array()) {
                        if let Some(idx) = tag {
                            if let Some(variant) = variants.get(idx as usize) {
                                let name = variant_name_from_element(variant).unwrap_or_default();
                                let inner_type = variant.get("algebraic_type");
                                if inner_type.is_some_and(is_unit_product)
                                    && is_empty_payload(payload)
                                {
                                    return Value::String(sats_unit_enum_tag(&name));
                                }
                                if let Some(inner) = inner_type {
                                    return unwrap_sats_typed(payload, Some(inner));
                                }
                            }
                        }
                    }
                }
            }
        }

        if is_timestamp_product(atype) {
            if let Value::Array(arr) = v {
                if let Some(micros) = arr.first().and_then(|x| x.as_i64()) {
                    return serde_json::json!({ "microsSinceUnixEpoch": micros });
                }
            }
        }
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
        let algebraic_type = el.get("algebraic_type");
        let cell = row
            .get(i)
            .map(|v| unwrap_sats_typed(v, algebraic_type))
            .unwrap_or(Value::Null);
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

#[cfg(test)]
mod tests {
    use super::{encode_reducer_wire_args, parse_sats_sql_response, reducer_contract};
    use serde_json::json;

    #[test]
    fn encodes_top_level_optional_scalars_as_sats_sums_for_reducer_http() {
        let contract = reducer_contract("create_workflow").expect("create_workflow contract");
        let args = encode_reducer_wire_args(
            contract,
            vec![json!(7), json!(42), json!({ "metadata": { "none": [] } })],
        );
        assert_eq!(args[0], json!(7));
        assert_eq!(args[1], json!({ "some": 42 }));
        assert_eq!(args[2], json!({ "metadata": { "none": [] } }));

        let args = encode_reducer_wire_args(
            contract,
            vec![json!(7), json!(null), json!({ "metadata": { "none": [] } })],
        );
        assert_eq!(args[1], json!({ "none": [] }));
    }

    #[test]
    fn unwraps_option_some_string_and_enum_unit_variants() {
        let body = r#"[
          {
            "schema": {
              "elements": [
                {
                  "name": { "some": "move_type" },
                  "algebraic_type": {
                    "Sum": {
                      "variants": [
                        { "name": { "some": "entry" }, "algebraic_type": { "Product": { "elements": [] } } },
                        { "name": { "some": "outInvoice" }, "algebraic_type": { "Product": { "elements": [] } } }
                      ]
                    }
                  }
                },
                {
                  "name": { "some": "invoice_partner_display_name" },
                  "algebraic_type": {
                    "Sum": {
                      "variants": [
                        { "name": { "some": "some" }, "algebraic_type": { "String": [] } },
                        { "name": { "some": "none" }, "algebraic_type": { "Product": { "elements": [] } } }
                      ]
                    }
                  }
                },
                {
                  "name": { "some": "state" },
                  "algebraic_type": {
                    "Sum": {
                      "variants": [
                        { "name": { "some": "draft" }, "algebraic_type": { "Product": { "elements": [] } } },
                        { "name": { "some": "posted" }, "algebraic_type": { "Product": { "elements": [] } } }
                      ]
                    }
                  }
                }
              ]
            },
            "rows": [[ [1, []], [0, "Acme Corporation"], [1, []] ]]
          }
        ]"#;
        let rows = parse_sats_sql_response(body).expect("parse");
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row["moveType"], json!("OutInvoice"));
        assert_eq!(row["invoicePartnerDisplayName"], json!("Acme Corporation"));
        assert_eq!(row["state"], json!("Posted"));
    }

    #[test]
    fn unwraps_timestamp_product_and_option_none() {
        let body = r#"[
          {
            "schema": {
              "elements": [
                {
                  "name": { "some": "date" },
                  "algebraic_type": {
                    "Product": {
                      "elements": [
                        {
                          "name": { "some": "__timestamp_micros_since_unix_epoch__" },
                          "algebraic_type": { "I64": [] }
                        }
                      ]
                    }
                  }
                },
                {
                  "name": { "some": "invoice_date" },
                  "algebraic_type": {
                    "Sum": {
                      "variants": [
                        {
                          "name": { "some": "some" },
                          "algebraic_type": {
                            "Product": {
                              "elements": [
                                {
                                  "name": { "some": "__timestamp_micros_since_unix_epoch__" },
                                  "algebraic_type": { "I64": [] }
                                }
                              ]
                            }
                          }
                        },
                        { "name": { "some": "none" }, "algebraic_type": { "Product": { "elements": [] } } }
                      ]
                    }
                  }
                },
                {
                  "name": { "some": "metadata" },
                  "algebraic_type": {
                    "Sum": {
                      "variants": [
                        { "name": { "some": "some" }, "algebraic_type": { "String": [] } },
                        { "name": { "some": "none" }, "algebraic_type": { "Product": { "elements": [] } } }
                      ]
                    }
                  }
                }
              ]
            },
            "rows": [[ [1781987714525004], [0, [1781987714525004]], [1, []] ]]
          }
        ]"#;
        let rows = parse_sats_sql_response(body).expect("parse");
        let row = &rows[0];
        assert_eq!(
            row["date"],
            json!({ "microsSinceUnixEpoch": 1781987714525004_i64 })
        );
        assert_eq!(
            row["invoiceDate"],
            json!({ "microsSinceUnixEpoch": 1781987714525004_i64 })
        );
        assert!(row["metadata"].is_null());
    }
}
