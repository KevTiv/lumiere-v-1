//! Global cursor / ordering contract for archive-capable reads.
//!
//! ## Contract
//!
//! Every archive-capable resource resolves a [`ResourceReadPlan`](super::ResourceReadPlan)
//! whose `order` is a non-empty list of deterministic order keys and whose
//! `page.limit` is bounded.  Pagination across the hot and cold stores uses
//! **keyset cursors**: a cursor encodes the order-key values of the last row
//! returned by the previous page, so the next page can resume with a
//! deterministic predicate (`id < cursor` for DESC, `id > cursor` for ASC).
//!
//! ## Encoding
//!
//! A cursor is a URL-safe base64 string of a canonical JSON object:
//!
//! ```json
//! {"v": [<order-key value>, ...]}
//! ```
//!
//! The values appear in the same order as `ResourceReadPlan::order`.  Only
//! scalar order-key values are encoded (the columns listed in `order`).
//! Keyset pagination requires that the order keys be unique, or that a final
//! tie-breaker column (typically the primary key) is appended to `order`.
//!
//! ## Why keyset, not offset
//!
//! Offset pagination is not stable across a sliding hot/cold window: rows move
//! from hot to cold between requests, so `OFFSET n` can skip or duplicate
//! rows.  Keyset cursors are stable because they predicate on the last seen
//! key value, which is independent of where the row physically resides.
//!
//! ## Phase 0 scope
//!
//! This module defines the encoding and the round-trip helpers.  The
//! audit-log read path (Phase 1) does not require a cursor today — its
//! existing API contract returns a single bounded page (latest 500 rows by
//! `id DESC`) and no consumer passes a cursor.  The contract exists so
//! future mutable resources can adopt it without changing the encoding.

use base64::Engine;
use serde_json::Value;

use crate::cold_tier::{OrderDirection, ReadOrder, ScalarValue};

/// Encode a cursor from the order-key values of the last returned row.
///
/// `order` and `last_row_values` must have the same length and correspond
/// element-for-element.  Returns `None` if either slice is empty (a cursor
/// requires at least one order key).
pub fn encode_cursor(order: &[ReadOrder], last_row_values: &[ScalarValue]) -> Option<String> {
    if order.is_empty() || last_row_values.len() != order.len() {
        return None;
    }
    let values: Vec<Value> = last_row_values.iter().map(scalar_to_json).collect();
    let payload = serde_json::json!({ "v": values });
    let bytes = serde_json::to_vec(&payload).ok()?;
    Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&bytes))
}

/// Decode a cursor string back into the order-key values.
///
/// The number of decoded values is guaranteed to equal `order.len()`.  A
/// malformed cursor or a length mismatch is an error — callers must never
/// silently coerce a bad cursor into an unbounded query.
pub fn decode_cursor(cursor: &str, order: &[ReadOrder]) -> Result<Vec<ScalarValue>, CursorError> {
    if order.is_empty() {
        return Err(CursorError::EmptyOrder);
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(cursor.trim())
        .map_err(|_| CursorError::Malformed)?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| CursorError::Malformed)?;
    let arr = value
        .get("v")
        .and_then(|v| v.as_array())
        .ok_or(CursorError::Malformed)?;
    if arr.len() != order.len() {
        return Err(CursorError::LengthMismatch {
            expected: order.len(),
            actual: arr.len(),
        });
    }
    arr.iter().map(json_to_scalar).collect()
}

/// Build the SQL predicate fragment for resuming *after* a cursor.
///
/// Returns `(fragment, binds)` where `fragment` is a parenthesised predicate
/// and `binds` are the scalar values to bind in order.  For a single order
/// key the fragment is `col < $n` (DESC) or `col > $n` (ASC).  Multi-key
/// cursors use a row-value comparison `(col1, col2) < ($n, $m)`.
///
/// `placeholder` maps a 1-based bind index to a SQL placeholder string (e.g.
/// `$1` for PG or `?` for STDB).  `quote_col` quotes a column identifier for
/// the target store (e.g. `"col"` for PG or `` `col` `` for STDB).  Both are
/// injected so this stays independent of the store-specific syntax.
pub fn cursor_predicate<F, Q>(
    order: &[ReadOrder],
    cursor_values: &[ScalarValue],
    placeholder: F,
    quote_col: Q,
) -> Result<(String, Vec<ScalarValue>), CursorError>
where
    F: Fn(usize) -> String,
    Q: Fn(&str) -> String,
{
    if order.is_empty() {
        return Err(CursorError::EmptyOrder);
    }
    if order.len() != cursor_values.len() {
        return Err(CursorError::LengthMismatch {
            expected: order.len(),
            actual: cursor_values.len(),
        });
    }

    let binds: Vec<ScalarValue> = cursor_values.to_vec();

    if order.len() == 1 {
        let col = quote_col(&order[0].column);
        let op = match order[0].direction {
            OrderDirection::Desc => "<",
            OrderDirection::Asc => ">",
        };
        let p = placeholder(1);
        return Ok((format!("{col} {op} {p}"), binds));
    }

    // Multi-key: row-value comparison (col1, col2, ...) < ($1, $2, ...).
    // Both STDB SQL and Postgres support row-value comparisons, but a single
    // operator only compares correctly when every key sorts the same
    // direction — a mixed-direction row comparison would silently pick the
    // wrong rows, so reject it instead of guessing.  The read-plan resolver
    // must append a same-direction tie-breaker (typically the primary key).
    let all_desc = order.iter().all(|o| o.direction == OrderDirection::Desc);
    let all_asc = order.iter().all(|o| o.direction == OrderDirection::Asc);
    if !all_desc && !all_asc {
        return Err(CursorError::MixedDirection);
    }
    let op = if all_desc { "<" } else { ">" };

    let cols: Vec<String> = order.iter().map(|o| quote_col(&o.column)).collect();
    let placeholders: Vec<String> = (1..=order.len()).map(|i| placeholder(i)).collect();

    Ok((
        format!("({}) {op} ({})", cols.join(", "), placeholders.join(", ")),
        binds,
    ))
}

/// Errors that can occur while decoding a cursor.
#[derive(Debug, thiserror::Error)]
pub enum CursorError {
    /// The read plan is not an allowlisted, bounded archive read.
    #[error("invalid resource read plan: {0}")]
    InvalidPlan(String),
    /// The `order` list is empty; a cursor requires at least one order key.
    #[error("cursor requires a non-empty order list")]
    EmptyOrder,
    /// The cursor string is malformed base64 or JSON.
    #[error("malformed cursor")]
    Malformed,
    /// The number of encoded values does not match the order list length.
    #[error("cursor length mismatch: expected {expected}, got {actual}")]
    LengthMismatch { expected: usize, actual: usize },
    /// A cursor value has an unsupported scalar type.
    #[error("cursor value has an unsupported scalar type")]
    UnsupportedScalar,
    /// A multi-key cursor's order columns don't all sort the same direction,
    /// so a single row-value comparison operator can't express it correctly.
    #[error("multi-key cursor requires all order columns to share one sort direction")]
    MixedDirection,
}

// Each scalar is tagged with its variant so decoding never has to guess a
// type from the JSON shape alone — e.g. a Text value that happens to look
// like a number (`"007"`) must not be reinterpreted as U64 on decode.
fn scalar_to_json(v: &ScalarValue) -> Value {
    match v {
        ScalarValue::U64(n) => {
            // u64 may exceed JSON's safe integer range; encode as a decimal
            // string so the round-trip is lossless (matches the API JSON
            // representation for U64 columns).
            serde_json::json!({ "u64": n.to_string() })
        }
        ScalarValue::I64(n) => serde_json::json!({ "i64": n }),
        ScalarValue::Text(s) => serde_json::json!({ "text": s }),
        ScalarValue::Bool(b) => serde_json::json!({ "bool": b }),
    }
}

fn json_to_scalar(v: &Value) -> Result<ScalarValue, CursorError> {
    let obj = v.as_object().ok_or(CursorError::UnsupportedScalar)?;
    if let Some(Value::String(s)) = obj.get("u64") {
        return s
            .parse::<u64>()
            .map(ScalarValue::U64)
            .map_err(|_| CursorError::UnsupportedScalar);
    }
    if let Some(n) = obj.get("i64") {
        return n
            .as_i64()
            .map(ScalarValue::I64)
            .ok_or(CursorError::UnsupportedScalar);
    }
    if let Some(Value::String(s)) = obj.get("text") {
        return Ok(ScalarValue::Text(s.clone()));
    }
    if let Some(Value::Bool(b)) = obj.get("bool") {
        return Ok(ScalarValue::Bool(*b));
    }
    Err(CursorError::UnsupportedScalar)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn order_id_desc() -> Vec<ReadOrder> {
        vec![ReadOrder {
            column: "id".into(),
            direction: OrderDirection::Desc,
        }]
    }

    #[test]
    fn round_trip_single_key() {
        let order = order_id_desc();
        let values = vec![ScalarValue::U64(42)];
        let cursor = encode_cursor(&order, &values).unwrap();
        let decoded = decode_cursor(&cursor, &order).unwrap();
        assert_eq!(decoded.len(), 1);
        assert!(matches!(decoded[0], ScalarValue::U64(42)));
    }

    #[test]
    fn u64_lossless_round_trip() {
        // Value beyond i64::MAX must survive the round trip.
        let order = order_id_desc();
        let big = u64::MAX;
        let cursor = encode_cursor(&order, &[ScalarValue::U64(big)]).unwrap();
        let decoded = decode_cursor(&cursor, &order).unwrap();
        assert!(matches!(decoded[0], ScalarValue::U64(n) if n == big));
    }

    #[test]
    fn length_mismatch_is_an_error() {
        let order = order_id_desc();
        let bad = encode_cursor(&order, &[ScalarValue::U64(1), ScalarValue::U64(2)]);
        // encode_cursor rejects length mismatch itself, so craft a bad cursor
        // manually: encode two values, decode against a one-key order.
        let two_key_order = vec![
            ReadOrder {
                column: "a".into(),
                direction: OrderDirection::Desc,
            },
            ReadOrder {
                column: "b".into(),
                direction: OrderDirection::Desc,
            },
        ];
        let cursor =
            encode_cursor(&two_key_order, &[ScalarValue::U64(1), ScalarValue::U64(2)]).unwrap();
        let err = decode_cursor(&cursor, &order).unwrap_err();
        assert!(matches!(
            err,
            CursorError::LengthMismatch {
                expected: 1,
                actual: 2
            }
        ));
        let _ = bad;
    }

    #[test]
    fn malformed_cursor_is_an_error() {
        let order = order_id_desc();
        assert!(matches!(
            decode_cursor("not-base64!!", &order).unwrap_err(),
            CursorError::Malformed
        ));
    }

    #[test]
    fn empty_order_cannot_encode() {
        assert!(encode_cursor(&[], &[ScalarValue::U64(1)]).is_none());
    }

    #[test]
    fn cursor_predicate_single_key_desc() {
        let order = order_id_desc();
        let values = vec![ScalarValue::U64(100)];
        let (frag, binds) =
            cursor_predicate(&order, &values, |i| format!("${i}"), |c| c.to_string()).unwrap();
        assert_eq!(frag, "id < $1");
        assert_eq!(binds.len(), 1);
        assert!(matches!(binds[0], ScalarValue::U64(100)));
    }

    #[test]
    fn cursor_predicate_single_key_asc() {
        let order = vec![ReadOrder {
            column: "id".into(),
            direction: OrderDirection::Asc,
        }];
        let (frag, _) = cursor_predicate(
            &order,
            &[ScalarValue::U64(100)],
            |i| format!("${i}"),
            |c| c.to_string(),
        )
        .unwrap();
        assert_eq!(frag, "id > $1");
    }

    #[test]
    fn cursor_predicate_stdb_question_mark() {
        let order = order_id_desc();
        let (frag, _) = cursor_predicate(
            &order,
            &[ScalarValue::U64(100)],
            |_| "?".into(),
            |c| format!("`{c}`"),
        )
        .unwrap();
        assert_eq!(frag, "`id` < ?");
    }

    #[test]
    fn cursor_predicate_multi_key() {
        let order = vec![
            ReadOrder {
                column: "created_at".into(),
                direction: OrderDirection::Desc,
            },
            ReadOrder {
                column: "id".into(),
                direction: OrderDirection::Desc,
            },
        ];
        let values = vec![ScalarValue::I64(123), ScalarValue::U64(456)];
        let (frag, binds) =
            cursor_predicate(&order, &values, |i| format!("${i}"), |c| c.to_string()).unwrap();
        assert_eq!(frag, "(created_at, id) < ($1, $2)");
        assert_eq!(binds.len(), 2);
    }

    #[test]
    fn cursor_predicate_mixed_direction_is_an_error() {
        let order = vec![
            ReadOrder {
                column: "created_at".into(),
                direction: OrderDirection::Asc,
            },
            ReadOrder {
                column: "id".into(),
                direction: OrderDirection::Desc,
            },
        ];
        let values = vec![ScalarValue::I64(123), ScalarValue::U64(456)];
        let err =
            cursor_predicate(&order, &values, |i| format!("${i}"), |c| c.to_string()).unwrap_err();
        assert!(matches!(err, CursorError::MixedDirection));
    }

    #[test]
    fn text_value_that_looks_numeric_round_trips_as_text() {
        let order = vec![ReadOrder {
            column: "ref_code".into(),
            direction: OrderDirection::Desc,
        }];
        let values = vec![ScalarValue::Text("007".into())];
        let cursor = encode_cursor(&order, &values).unwrap();
        let decoded = decode_cursor(&cursor, &order).unwrap();
        assert!(matches!(&decoded[0], ScalarValue::Text(s) if s == "007"));
    }
}
