//! Generic STDB-row → PG-bind-value mapper, driven by `codec-manifest.json`.
//!
//! `audit_log`'s drainer (`audit_drainer.rs`) hand-writes per-field
//! extraction/binding/checksum code — tractable for its 14 columns, but
//! `pos_order` has ~50, and every future archive candidate (`sale_order`,
//! `account_move`, ...) will too. This module builds the UPSERT and its
//! bind values generically from the column list `lumiere-codegen` already
//! emits, so a new drainer only needs to say *which* table, not re-derive
//! per-field decode logic.
//!
//! ## What this does NOT decide
//!
//! Write-side decoding (`decode_row`) works from `pg_type` alone
//! (`"NUMERIC(20,0)"`, `"BIGINT"`, `"TEXT"`, ...) rather than the richer
//! `stdb_type` — `lumiere-codegen` is a bin-only crate (no `[lib]`), so
//! `GeneratedType` isn't importable here, and `pg_type` is a small closed
//! set that's sufficient for binding: the only ambiguity it introduces is
//! `BIGINT`, shared by `Timestamp` and plain signed-integer columns —
//! resolved by checking the JSON shape at decode time
//! (`{"microsSinceUnixEpoch": ...}` vs a raw number) rather than needing to
//! know the source type up front.
//!
//! Read-side reconstruction (`row_to_hot_json`) can't use that trick — a
//! `BIGINT` value coming back from Postgres has no shape to inspect, just a
//! plain integer — so it *does* need `stdb_type`, checked only as an exact
//! string equality (`"Timestamp"`), never parsed generically.

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use tokio_postgres::types::ToSql;
use tokio_postgres::Row;

use super::conventions;

/// One column's codec metadata, as loaded from `codec-manifest.json`.
#[derive(Debug, Clone)]
pub struct ColumnCodec {
    /// snake_case SQL/STDB column name.
    pub name: String,
    /// e.g. `"NUMERIC(20,0)"`, `"TEXT"`, `"BIGINT"`, `"BYTEA"`, `"JSONB"`.
    pub pg_type: String,
    /// `lumiere-codegen`'s `GeneratedType` Debug string for this column
    /// (e.g. `"U64"`, `"Timestamp"`, `"Identity"`) — used only to
    /// disambiguate `BIGINT` on read (see module doc); never parsed beyond
    /// an exact string check.
    pub stdb_type: String,
    pub nullable: bool,
}

/// Load `table`'s column codec list from a parsed `codec-manifest.json`.
pub fn load_columns(codec_manifest_json: &str, table: &str) -> Result<Vec<ColumnCodec>> {
    let manifest: Value =
        serde_json::from_str(codec_manifest_json).context("parse codec-manifest.json")?;
    let cols = manifest["tables"][table]["columns"]
        .as_array()
        .ok_or_else(|| anyhow!("codec-manifest.json: table '{table}' has no 'columns' array"))?;

    cols.iter()
        .map(|c| {
            Ok(ColumnCodec {
                name: c["name"]
                    .as_str()
                    .ok_or_else(|| anyhow!("codec-manifest.json: column missing 'name'"))?
                    .to_string(),
                pg_type: c["pg_type"]
                    .as_str()
                    .ok_or_else(|| anyhow!("codec-manifest.json: column missing 'pg_type'"))?
                    .to_string(),
                stdb_type: c["stdb_type"]
                    .as_str()
                    .ok_or_else(|| anyhow!("codec-manifest.json: column missing 'stdb_type'"))?
                    .to_string(),
                nullable: c["nullable"].as_bool().unwrap_or(false),
            })
        })
        .collect()
}

/// Build `ResourceReadPlan.projection` entries for a cold-tier read:
/// `"column::TEXT"` for `NUMERIC`/`JSONB` columns (tokio-postgres has no
/// native decoder for either without a bignum crate — see module doc),
/// plain `"column"` otherwise. `compile_stdb_sql` strips the `::CAST`
/// suffix automatically, so this same projection list is valid for both
/// compilers.
pub fn projection_with_pg_casts(columns: &[ColumnCodec]) -> Vec<String> {
    columns
        .iter()
        .map(|c| match c.pg_type.as_str() {
            "NUMERIC(20,0)" | "JSONB" => format!("{}::TEXT", c.name),
            _ => c.name.clone(),
        })
        .collect()
}

/// Reconstruct one PG cold row into the same camelCase/number/timestamp-
/// object JSON shape `StdbClient::query_sql` returns for hot rows — so a
/// caller can merge hot and cold rows without caring which store a row
/// came from. `row`'s columns must be in the same order as `columns`, cast
/// per `projection_with_pg_casts` (i.e. actually queried via that helper).
pub fn row_to_hot_json(columns: &[ColumnCodec], row: &Row) -> Result<Value> {
    let mut map = serde_json::Map::new();
    for (i, col) in columns.iter().enumerate() {
        let value = read_pg_column(col, row, i)
            .with_context(|| format!("column '{}' (index {i})", col.name))?;
        map.insert(snake_to_camel(&col.name), value);
    }
    Ok(Value::Object(map))
}

fn read_pg_column(col: &ColumnCodec, row: &Row, i: usize) -> Result<Value> {
    Ok(match col.pg_type.as_str() {
        "NUMERIC(20,0)" => {
            let s: Option<String> = row.try_get(i)?;
            match s {
                Some(s) => {
                    let n: u64 = s
                        .parse()
                        .with_context(|| format!("non-numeric NUMERIC text '{s}'"))?;
                    json!(n)
                }
                None => Value::Null,
            }
        }
        "BIGINT" => {
            let n: Option<i64> = row.try_get(i)?;
            match n {
                Some(n) if col.stdb_type == "Timestamp" => json!({ "microsSinceUnixEpoch": n }),
                Some(n) => json!(n),
                None => Value::Null,
            }
        }
        "INTEGER" => {
            let n: Option<i32> = row.try_get(i)?;
            n.map(|n| json!(n)).unwrap_or(Value::Null)
        }
        "DOUBLE PRECISION" => {
            let n: Option<f64> = row.try_get(i)?;
            n.map(|n| json!(n)).unwrap_or(Value::Null)
        }
        "REAL" => {
            let n: Option<f32> = row.try_get(i)?;
            n.map(|n| json!(n)).unwrap_or(Value::Null)
        }
        "BOOLEAN" => {
            let b: Option<bool> = row.try_get(i)?;
            b.map(Value::Bool).unwrap_or(Value::Null)
        }
        "BYTEA" => {
            let b: Option<Vec<u8>> = row.try_get(i)?;
            b.map(|b| Value::String(hex::encode(b)))
                .unwrap_or(Value::Null)
        }
        "JSONB" => {
            // Read via the ::TEXT cast (projection_with_pg_casts), same reason
            // NUMERIC needs one: no with-serde_json-1 feature on tokio-postgres.
            let s: Option<String> = row.try_get(i)?;
            match s {
                Some(s) => serde_json::from_str(&s).context("parse JSONB text")?,
                None => Value::Null,
            }
        }
        "TEXT" => {
            let s: Option<String> = row.try_get(i)?;
            s.map(Value::String).unwrap_or(Value::Null)
        }
        other => anyhow::bail!("unhandled pg_type '{other}' on read"),
    })
}

/// A decoded, bindable value for one column.
#[derive(Debug, Clone)]
pub enum PgValue {
    /// u64-domain integer, bound as decimal text and cast `::TEXT::NUMERIC` —
    /// avoids needing a bignum crate just to bind `NUMERIC(20,0)`.
    NumericText(Option<String>),
    /// Array/struct column, bound as JSON text and cast `::TEXT::JSONB`.
    JsonbText(Option<String>),
    BigInt(Option<i64>),
    Integer(Option<i32>),
    Double(Option<f64>),
    Real(Option<f32>),
    Boolean(Option<bool>),
    Bytea(Option<Vec<u8>>),
    Text(Option<String>),
}

impl PgValue {
    pub(crate) fn needs_cast(&self) -> Option<&'static str> {
        match self {
            PgValue::NumericText(_) => Some("TEXT::NUMERIC"),
            PgValue::JsonbText(_) => Some("TEXT::JSONB"),
            _ => None,
        }
    }

    pub(crate) fn as_sql(&self) -> &(dyn ToSql + Sync) {
        match self {
            PgValue::NumericText(v) | PgValue::JsonbText(v) | PgValue::Text(v) => v,
            PgValue::BigInt(v) => v,
            PgValue::Integer(v) => v,
            PgValue::Double(v) => v,
            PgValue::Real(v) => v,
            PgValue::Boolean(v) => v,
            PgValue::Bytea(v) => v,
        }
    }

    /// The value's contribution to the row's canonical checksum — literally
    /// what got bound, so the checksum matches what's actually in PG.
    fn canonical_json(&self) -> Value {
        match self {
            PgValue::NumericText(v) | PgValue::JsonbText(v) | PgValue::Text(v) => {
                v.clone().map(Value::String).unwrap_or(Value::Null)
            }
            PgValue::BigInt(v) => v
                .map(|n| Value::String(n.to_string()))
                .unwrap_or(Value::Null),
            PgValue::Integer(v) => v
                .map(|n| Value::String(n.to_string()))
                .unwrap_or(Value::Null),
            PgValue::Double(v) => v
                .map(|n| Value::String(n.to_string()))
                .unwrap_or(Value::Null),
            PgValue::Real(v) => v
                .map(|n| Value::String(n.to_string()))
                .unwrap_or(Value::Null),
            PgValue::Boolean(v) => v.map(Value::Bool).unwrap_or(Value::Null),
            PgValue::Bytea(v) => v
                .clone()
                .map(|b| Value::String(hex::encode(b)))
                .unwrap_or(Value::Null),
        }
    }
}

/// Decode every column's value out of one hot-row (the camelCase JSON
/// `StdbClient::query_sql` returns), keyed by each column's snake_case name
/// converted to camelCase.
///
/// Never coerces a missing/malformed value to a default — an error here
/// means the batch item is skipped and logged loudly, not silently zeroed
/// (matches the same rule `audit_drainer.rs` follows).
pub fn decode_row(columns: &[ColumnCodec], row: &Value) -> Result<Vec<PgValue>> {
    columns
        .iter()
        .map(|col| {
            let key = snake_to_camel(&col.name);
            let raw = row.get(&key).unwrap_or(&Value::Null);
            decode_column(col, raw).with_context(|| format!("column '{}'", col.name))
        })
        .collect()
}

fn decode_column(col: &ColumnCodec, raw: &Value) -> Result<PgValue> {
    if raw.is_null() {
        if !col.nullable {
            anyhow::bail!("non-nullable but value is null");
        }
        return Ok(null_value_for(&col.pg_type)?);
    }

    Ok(match col.pg_type.as_str() {
        "NUMERIC(20,0)" => {
            let n = raw
                .as_u64()
                .ok_or_else(|| anyhow!("expected u64-like number, got {raw}"))?;
            PgValue::NumericText(Some(n.to_string()))
        }
        "BIGINT" => {
            // Timestamp columns arrive as {"microsSinceUnixEpoch": <i64>};
            // plain integer columns arrive as a raw JSON number.
            let n = if let Some(micros) = raw.get("microsSinceUnixEpoch").and_then(|v| v.as_i64()) {
                micros
            } else {
                raw.as_i64()
                    .ok_or_else(|| anyhow!("expected i64-like number or timestamp, got {raw}"))?
            };
            PgValue::BigInt(Some(n))
        }
        "INTEGER" => {
            let n = raw
                .as_i64()
                .ok_or_else(|| anyhow!("expected integer, got {raw}"))?;
            let n =
                i32::try_from(n).map_err(|_| anyhow!("value {n} out of i32 range for INTEGER"))?;
            PgValue::Integer(Some(n))
        }
        "DOUBLE PRECISION" => {
            let n = raw
                .as_f64()
                .ok_or_else(|| anyhow!("expected number, got {raw}"))?;
            PgValue::Double(Some(n))
        }
        "REAL" => {
            let n = raw
                .as_f64()
                .ok_or_else(|| anyhow!("expected number, got {raw}"))?;
            PgValue::Real(Some(n as f32))
        }
        "BOOLEAN" => {
            let b = raw
                .as_bool()
                .ok_or_else(|| anyhow!("expected bool, got {raw}"))?;
            PgValue::Boolean(Some(b))
        }
        "BYTEA" => {
            let bytes = decode_identity_bytes(raw)?;
            PgValue::Bytea(Some(bytes))
        }
        "JSONB" => PgValue::JsonbText(Some(serde_json::to_string(raw)?)),
        "TEXT" => {
            let s = raw
                .as_str()
                .ok_or_else(|| anyhow!("expected string, got {raw}"))?;
            PgValue::Text(Some(s.to_string()))
        }
        other => anyhow::bail!("unhandled pg_type '{other}'"),
    })
}

/// Decode one value using generated column metadata. Projection application
/// uses this for a tombstone key, where a complete row is intentionally absent.
pub(crate) fn decode_key_value(col: &ColumnCodec, raw: &Value) -> Result<PgValue> {
    decode_column(col, raw)
}

fn null_value_for(pg_type: &str) -> Result<PgValue> {
    Ok(match pg_type {
        "NUMERIC(20,0)" => PgValue::NumericText(None),
        "BIGINT" => PgValue::BigInt(None),
        "INTEGER" => PgValue::Integer(None),
        "DOUBLE PRECISION" => PgValue::Double(None),
        "REAL" => PgValue::Real(None),
        "BOOLEAN" => PgValue::Boolean(None),
        "BYTEA" => PgValue::Bytea(None),
        "JSONB" => PgValue::JsonbText(None),
        "TEXT" => PgValue::Text(None),
        other => anyhow::bail!("unhandled pg_type '{other}' for a null value"),
    })
}

/// Extract raw bytes from an `Identity` cell — accepts a hex string
/// (optionally `0x`-prefixed) or a JSON array of 32 byte numbers. See the
/// same acceptance rule (and the reason for it — this hasn't been verified
/// against a live module's actual SQL-endpoint JSON shape yet) documented
/// on `audit_drainer::identity_hex_and_bytes`.
fn decode_identity_bytes(v: &Value) -> Result<Vec<u8>> {
    match v {
        Value::String(s) => {
            let stripped = s
                .strip_prefix("0x")
                .or_else(|| s.strip_prefix("0X"))
                .unwrap_or(s);
            if stripped.len() != 64 || !stripped.chars().all(|c| c.is_ascii_hexdigit()) {
                anyhow::bail!("expected 64 hex chars for Identity, got '{s}'");
            }
            hex::decode(stripped.to_ascii_lowercase()).context("hex decode Identity")
        }
        Value::Array(arr) => {
            if arr.len() != 32 {
                anyhow::bail!("expected 32-byte array for Identity, got len {}", arr.len());
            }
            arr.iter()
                .map(|el| {
                    el.as_u64()
                        .filter(|n| *n <= 255)
                        .map(|n| n as u8)
                        .ok_or_else(|| anyhow!("non-byte element {el} in Identity array"))
                })
                .collect()
        }
        other => anyhow::bail!("expected hex string or byte array for Identity, got {other}"),
    }
}

/// Canonical checksum for a decoded row, keyed by column name (already
/// snake_case, already sorted — `serde_json::Map` is `BTreeMap`-backed with
/// no `preserve_order` feature enabled anywhere in this workspace).
pub fn checksum_for(columns: &[ColumnCodec], values: &[PgValue]) -> String {
    let map: serde_json::Map<String, Value> = columns
        .iter()
        .zip(values.iter())
        .map(|(col, val)| (col.name.clone(), val.canonical_json()))
        .collect();
    conventions::compute_payload_checksum_canonical(&Value::Object(map))
}

/// Insert-or-version-upsert one decoded row into `cold_table`. Returns the
/// number of rows affected (0 means a stale/no-op retry — the row in PG
/// already has an equal-or-newer `archive_version`).
pub async fn upsert_row(
    client: &deadpool_postgres::Object,
    cold_table: &str,
    columns: &[ColumnCodec],
    values: &[PgValue],
    checksum: &str,
) -> Result<u64> {
    if !columns.iter().any(|c| c.name == "archive_version") {
        anyhow::bail!(
            "upsert_row: 'archive_version' column not found — is this a versioned candidate?"
        );
    }

    let mut col_names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    col_names.push("payload_checksum");

    let mut placeholders = Vec::with_capacity(col_names.len());
    let mut params: Vec<&(dyn ToSql + Sync)> = Vec::with_capacity(col_names.len());
    for (i, val) in values.iter().enumerate() {
        placeholders.push(match val.needs_cast() {
            Some(cast) => format!("${}::{cast}", i + 1),
            None => format!("${}", i + 1),
        });
        params.push(val.as_sql());
    }
    let checksum_owned = checksum.to_string();
    placeholders.push(format!("${}", values.len() + 1));
    params.push(&checksum_owned);

    let update_assignments: Vec<String> = col_names
        .iter()
        .filter(|c| **c != "id")
        .map(|c| format!("{c} = EXCLUDED.{c}"))
        .collect();

    let sql = format!(
        "INSERT INTO {cold_table} ({cols}) VALUES ({vals}) \
         ON CONFLICT (id) DO UPDATE SET {updates} \
         WHERE EXCLUDED.archive_version > {cold_table}.archive_version",
        cold_table = cold_table,
        cols = col_names.join(", "),
        vals = placeholders.join(", "),
        updates = update_assignments.join(", "),
    );

    let rows = client
        .execute(&sql, &params)
        .await
        .with_context(|| format!("upsert into {cold_table}"))?;
    Ok(rows)
}

pub(crate) fn snake_to_camel(s: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn cols() -> Vec<ColumnCodec> {
        vec![
            ColumnCodec {
                name: "id".into(),
                pg_type: "NUMERIC(20,0)".into(),
                stdb_type: "U64".into(),
                nullable: false,
            },
            ColumnCodec {
                name: "company_id".into(),
                pg_type: "NUMERIC(20,0)".into(),
                stdb_type: "U64".into(),
                nullable: true,
            },
            ColumnCodec {
                name: "uid".into(),
                pg_type: "TEXT".into(),
                stdb_type: "String".into(),
                nullable: false,
            },
            ColumnCodec {
                name: "amount_paid".into(),
                pg_type: "DOUBLE PRECISION".into(),
                stdb_type: "F64".into(),
                nullable: false,
            },
            ColumnCodec {
                name: "to_invoice".into(),
                pg_type: "BOOLEAN".into(),
                stdb_type: "Bool".into(),
                nullable: false,
            },
            ColumnCodec {
                name: "lines".into(),
                pg_type: "JSONB".into(),
                stdb_type: "Vec(U64)".into(),
                nullable: false,
            },
            ColumnCodec {
                name: "user_id".into(),
                pg_type: "BYTEA".into(),
                stdb_type: "Identity".into(),
                nullable: false,
            },
            ColumnCodec {
                name: "date_order".into(),
                pg_type: "BIGINT".into(),
                stdb_type: "Timestamp".into(),
                nullable: false,
            },
            ColumnCodec {
                name: "cold_eligible_at".into(),
                pg_type: "BIGINT".into(),
                stdb_type: "Timestamp".into(),
                nullable: true,
            },
            ColumnCodec {
                name: "archive_version".into(),
                pg_type: "NUMERIC(20,0)".into(),
                stdb_type: "U64".into(),
                nullable: false,
            },
        ]
    }

    fn sample_row() -> Value {
        json!({
            "id": 42,
            "companyId": null,
            "uid": "abc-1",
            "amountPaid": 10.5,
            "toInvoice": true,
            "lines": [1, 2, 3],
            "userId": "ab".repeat(32),
            "dateOrder": { "microsSinceUnixEpoch": 1_781_987_714_525_004_i64 },
            "coldEligibleAt": { "microsSinceUnixEpoch": 1_781_987_714_525_004_i64 },
            "archiveVersion": 1,
        })
    }

    #[test]
    fn decodes_every_pg_type_variant() {
        let values = decode_row(&cols(), &sample_row()).unwrap();
        assert!(matches!(values[0], PgValue::NumericText(Some(ref s)) if s == "42"));
        assert!(matches!(values[1], PgValue::NumericText(None)));
        assert!(matches!(values[2], PgValue::Text(Some(ref s)) if s == "abc-1"));
        assert!(matches!(values[3], PgValue::Double(Some(v)) if v == 10.5));
        assert!(matches!(values[4], PgValue::Boolean(Some(true))));
        assert!(matches!(values[5], PgValue::JsonbText(Some(ref s)) if s == "[1,2,3]"));
        match &values[6] {
            PgValue::Bytea(Some(b)) => assert_eq!(b.len(), 32),
            other => panic!("expected Bytea, got {other:?}"),
        }
        assert!(matches!(
            values[7],
            PgValue::BigInt(Some(1_781_987_714_525_004))
        ));
        assert!(matches!(
            values[8],
            PgValue::BigInt(Some(1_781_987_714_525_004))
        ));
        assert!(matches!(values[9], PgValue::NumericText(Some(ref s)) if s == "1"));
    }

    #[test]
    fn rejects_null_in_non_nullable_column() {
        let mut row = sample_row();
        row["uid"] = Value::Null;
        let err = decode_row(&cols(), &row).unwrap_err();
        assert!(err.to_string().contains("uid"));
    }

    #[test]
    fn checksum_is_deterministic_and_sensitive_to_changes() {
        let values_a = decode_row(&cols(), &sample_row()).unwrap();
        let values_b = decode_row(&cols(), &sample_row()).unwrap();
        assert_eq!(
            checksum_for(&cols(), &values_a),
            checksum_for(&cols(), &values_b)
        );

        let mut altered = sample_row();
        altered["uid"] = json!("different");
        let values_c = decode_row(&cols(), &altered).unwrap();
        assert_ne!(
            checksum_for(&cols(), &values_a),
            checksum_for(&cols(), &values_c)
        );
    }

    #[test]
    fn snake_to_camel_matches_stdb_client_convention() {
        assert_eq!(snake_to_camel("cold_eligible_at"), "coldEligibleAt");
        assert_eq!(snake_to_camel("id"), "id");
        assert_eq!(snake_to_camel("uid"), "uid");
    }

    #[test]
    fn projection_casts_numeric_and_jsonb_only() {
        let projection = projection_with_pg_casts(&cols());
        assert_eq!(projection[0], "id::TEXT"); // NUMERIC(20,0)
        assert_eq!(projection[2], "uid"); // TEXT — no cast
        assert_eq!(projection[5], "lines::TEXT"); // JSONB
        assert_eq!(projection[7], "date_order"); // BIGINT — no cast
    }
}
