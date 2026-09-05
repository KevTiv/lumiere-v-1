//! Store-specific SQL emission from the shared validated contract.
use super::{
    cursor, validate_resource_read_plan, OrderDirection, ReadPredicate, ResourceReadPlan,
    ScalarValue,
};

// ---------------------------------------------------------------------------
// SQL compilers
// ---------------------------------------------------------------------------

/// Compile a [`ResourceReadPlan`] into a SpacetimeDB SQL fragment.
///
/// Returns `(sql_text, bind_values)` where bind values are positional (`$1`,
/// `$2`, …) in the same order as the returned vec.  Errors if `plan.page.cursor`
/// is set but malformed, or doesn't decode against `plan.order`.
///
/// Phase 0: skeleton only — full implementation comes in Phase 1 alongside the
/// audit-log read-path migration.
pub fn compile_stdb_sql(
    plan: &ResourceReadPlan,
) -> Result<(String, Vec<ScalarValue>), cursor::CursorError> {
    compile_sql(plan, QuotingStyle::StdbBacktick)
}

/// Compile a [`ResourceReadPlan`] into a Postgres SQL fragment.
///
/// Returns `(sql_text, bind_values)` — same contract as [`compile_stdb_sql`].
///
/// Phase 0: skeleton only — full implementation comes in Phase 1.
pub fn compile_pg_sql(
    plan: &ResourceReadPlan,
) -> Result<(String, Vec<ScalarValue>), cursor::CursorError> {
    compile_sql(plan, QuotingStyle::PgDollar)
}

/// Substitute `compile_stdb_sql`'s `?` placeholders with literal values.
///
/// `StdbClient::query_sql` sends a plain SQL string over HTTP — there is no
/// separate parameter-binding channel the way `tokio-postgres` has for the
/// PG side, so the `?` placeholders `compile_stdb_sql` emits must be turned
/// into an actually-executable query by inlining literals before sending.
///
/// Safe against injection from the bind *values* themselves: `Text` values
/// are single-quote-escaped, and every other variant is a Rust primitive
/// with no free-text representation. It is not "safe" against a caller
/// constructing malformed SQL some other way — the emitted `?` characters
/// are only ever placeholder tokens `compile_sql` itself produces via
/// `push_bind`, never literal content, so a 1:1 in-order substitution is
/// correct as long as `sql` came from `compile_stdb_sql`.
pub fn inline_stdb_literals(sql: &str, binds: &[ScalarValue]) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut bind_iter = binds.iter();
    for ch in sql.chars() {
        if ch == '?' {
            if let Some(value) = bind_iter.next() {
                out.push_str(&stdb_literal(value));
                continue;
            }
        }
        out.push(ch);
    }
    out
}

fn stdb_literal(value: &ScalarValue) -> String {
    match value {
        ScalarValue::U64(n) => n.to_string(),
        ScalarValue::I64(n) => n.to_string(),
        ScalarValue::Bool(b) => b.to_string(),
        ScalarValue::Text(s) => format!("'{}'", s.replace('\'', "''")),
    }
}

#[derive(Clone, Copy)]
enum QuotingStyle {
    /// SpacetimeDB uses backtick-quoted identifiers.
    StdbBacktick,
    /// Postgres uses double-quoted identifiers and `$N` placeholders.
    PgDollar,
}

/// Quote a table/column identifier for the given store, doubling any embedded
/// quote character so a crafted identifier can't break out of the quoted
/// context and inject SQL — matching the safety `QuotingStyle` documents.
fn quote_ident(name: &str, style: QuotingStyle) -> String {
    match style {
        QuotingStyle::StdbBacktick => format!("`{}`", name.replace('`', "``")),
        QuotingStyle::PgDollar => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

fn compile_sql(
    plan: &ResourceReadPlan,
    style: QuotingStyle,
) -> Result<(String, Vec<ScalarValue>), cursor::CursorError> {
    let descriptor = validate_resource_read_plan(plan)?;
    let mut binds: Vec<ScalarValue> = Vec::new();

    // SELECT
    //
    // A projection entry may carry a `column::CAST` suffix (e.g. `"id::TEXT"`)
    // — needed on the PG side to read NUMERIC/JSONB columns back without a
    // bignum crate (tokio-postgres has no native NUMERIC decoder). Applied
    // only for PgDollar; stripped for StdbBacktick, since STDB returns
    // natively typed JSON and has no use for a PG cast hint.
    let cols = plan
        .projection
        .iter()
        .map(|c| match c.split_once("::") {
            Some((name, cast)) => match style {
                QuotingStyle::PgDollar => format!("{}::{cast}", quote_ident(name, style)),
                QuotingStyle::StdbBacktick => quote_ident(name, style),
            },
            None => quote_ident(c, style),
        })
        .collect::<Vec<_>>()
        .join(", ");
    let table = match style {
        QuotingStyle::StdbBacktick => &descriptor.hot_table,
        QuotingStyle::PgDollar => &descriptor.cold_table,
    };
    let mut sql = format!(
        "SELECT {cols} FROM {table}",
        table = quote_ident(table, style)
    );

    // WHERE
    let mut conditions: Vec<String> = Vec::new();

    // Mandatory org scope — always first.
    let org_bind = push_bind(&mut binds, ScalarValue::U64(plan.organization_id), style);
    conditions.push(format!(
        "{} = {org_bind}",
        quote_ident(&descriptor.organization_column, style)
    ));

    // Optional company scope.
    if let Some(company_id) = plan.company_id {
        let company_column = descriptor.company_column.as_deref().ok_or_else(|| {
            cursor::CursorError::InvalidPlan("company scope is not supported".into())
        })?;
        let co_bind = push_bind(&mut binds, ScalarValue::U64(company_id), style);
        conditions.push(format!(
            "{} = {co_bind}",
            quote_ident(company_column, style)
        ));
    }

    // Keyset cursor — resumes after the last row of the previous page.
    if let Some(cursor_str) = &plan.page.cursor {
        let cursor_values = cursor::decode_cursor(cursor_str, &plan.order)?;
        let base = binds.len();
        let (frag, cursor_binds) = cursor::cursor_predicate(
            &plan.order,
            &cursor_values,
            |i| match style {
                QuotingStyle::StdbBacktick => "?".to_string(),
                QuotingStyle::PgDollar => {
                    format!("${}{}", base + i, pg_cast_suffix(&cursor_values[i - 1]))
                }
            },
            |col| quote_ident(col, style),
        )?;
        conditions.push(frag);
        binds.extend(cursor_binds);
    }

    // Additional predicates.
    for pred in &plan.predicates {
        conditions.push(compile_predicate(pred, &mut binds, style));
    }

    if !conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
    }

    // ORDER BY
    if !plan.order.is_empty() {
        let order_clause = plan
            .order
            .iter()
            .map(|o| {
                let dir = match o.direction {
                    OrderDirection::Asc => "ASC",
                    OrderDirection::Desc => "DESC",
                };
                format!("{} {dir}", quote_ident(&o.column, style))
            })
            .collect::<Vec<_>>()
            .join(", ");
        sql.push_str(" ORDER BY ");
        sql.push_str(&order_clause);
    }

    // LIMIT
    sql.push_str(&format!(" LIMIT {}", plan.page.limit));

    Ok((sql, binds))
}

fn compile_predicate(
    pred: &ReadPredicate,
    binds: &mut Vec<ScalarValue>,
    style: QuotingStyle,
) -> String {
    match pred {
        ReadPredicate::Eq { column, value } => {
            let b = push_bind(binds, value.clone(), style);
            format!("{} = {b}", quote_ident(column, style))
        }
        ReadPredicate::IsNull { column } => format!("{} IS NULL", quote_ident(column, style)),
        ReadPredicate::IsNotNull { column } => {
            format!("{} IS NOT NULL", quote_ident(column, style))
        }
        ReadPredicate::Gte { column, value } => {
            let b = push_bind(binds, value.clone(), style);
            format!("{} >= {b}", quote_ident(column, style))
        }
        ReadPredicate::Lte { column, value } => {
            let b = push_bind(binds, value.clone(), style);
            format!("{} <= {b}", quote_ident(column, style))
        }
        ReadPredicate::In { column, values } => {
            if values.is_empty() {
                // No values can match; `column IN ()` is invalid SQL, so
                // compile the empty case to a predicate that is always false.
                return "FALSE".to_string();
            }
            let placeholders = values
                .iter()
                .map(|v| push_bind(binds, v.clone(), style))
                .collect::<Vec<_>>()
                .join(", ");
            format!("{} IN ({placeholders})", quote_ident(column, style))
        }
        ReadPredicate::Or(left, right) => {
            let l = compile_predicate(left, binds, style);
            let r = compile_predicate(right, binds, style);
            format!("({l} OR {r})")
        }
    }
}

fn push_bind(binds: &mut Vec<ScalarValue>, value: ScalarValue, style: QuotingStyle) -> String {
    let cast = pg_cast_suffix(&value);
    binds.push(value);
    match style {
        QuotingStyle::StdbBacktick => "?".to_string(),
        QuotingStyle::PgDollar => format!("${}{cast}", binds.len()),
    }
}

/// Cast suffix needed on a PG placeholder for this value's SQL type. Only
/// `U64` needs one: it's always bound as decimal text (no bignum crate — see
/// `pg_codec`'s module doc for the read-side half of this), so without an
/// explicit `::NUMERIC` a comparison against a `NUMERIC(20,0)` column (e.g.
/// `organization_id`) is a text/numeric type mismatch Postgres rejects
/// outright, rather than silently comparing wrong. Every other `ScalarValue`
/// variant already binds as its natively-matching PG type.
fn pg_cast_suffix(value: &ScalarValue) -> &'static str {
    match value {
        ScalarValue::U64(_) => "::NUMERIC",
        ScalarValue::I64(_) | ScalarValue::Text(_) | ScalarValue::Bool(_) => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quoted_identifier_neutralizes_embedded_quote() {
        assert_eq!(quote_ident(r#"a"b"#, QuotingStyle::PgDollar), "\"a\"\"b\"");
    }
}
