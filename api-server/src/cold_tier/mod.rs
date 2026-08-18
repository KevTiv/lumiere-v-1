//! Cold-tier read plan and compiler types.
//!
//! A [`ResourceReadPlan`] is built once per authenticated request by the
//! existing session/auth resolution layer and then compiled into either a
//! SpacetimeDB SQL query or a Postgres SQL query.  Both compilers produce
//! queries that satisfy the same authorization, company scope, field
//! projection, ordering, and pagination constraints — preventing the hot and
//! cold paths from diverging on access-control semantics.
//!
//! ## Relationship to existing code
//!
//! Today `query_exec.rs` and `stdb-auth` inline the resolution of org scope,
//! field restrictions, and resource-specific predicates.  Phase 0 introduces
//! these types as the target representation; Phase 1+ migrates the audit-log
//! read path to use them.
//!
//! ## Non-negotiable invariants (from the plan)
//!
//! 1. All cold reads use the same resolved read contract as hot reads.
//!    No independent PG authorization or filter logic.
//! 2. Predicates are represented structurally to prevent unparenthesised
//!    boolean operator precedence bugs.
//! 3. `page` must be bounded — archive-capable reads are never unbounded.

pub mod audit_drainer;
pub mod audit_read;
pub mod conventions;
pub mod cursor;
pub mod ledger;
pub mod migrate;
pub mod pg_pool;

/// The canonical read contract for one API resource request.
///
/// Resolved once from the authenticated session, org/company scope, and field
/// policy.  Compiled into store-specific SQL by [`compile_stdb_sql`] and
/// [`compile_pg_sql`].
#[derive(Debug, Clone)]
pub struct ResourceReadPlan {
    /// Registry resource key, e.g. `"audit-log"`.
    pub resource: String,
    /// SQL table name in both STDB and PG (they share the logical schema).
    pub table: String,
    /// Ordered list of columns to return.  Never empty; always contains
    /// mandatory fields from the resource registry.
    pub projection: Vec<String>,
    /// Resolved organization scope — always required.
    pub organization_id: u64,
    /// Resolved company scope — `None` means "all companies the caller can see".
    pub company_id: Option<u64>,
    /// Additional structured predicates (AND-composed after org/company scope).
    pub predicates: Vec<ReadPredicate>,
    /// Ordering specification.  Must have at least one deterministic key.
    pub order: Vec<ReadOrder>,
    /// Page boundary.  All archive-capable reads must be bounded.
    pub page: PageSpec,
}

/// A structured predicate for use in a read plan.
///
/// Predicates are always AND-composed with each other and with the mandatory
/// `organization_id` and optional `company_id` scope predicates.  They are
/// never OR-composed at the top level to avoid precedence mistakes.
///
/// To express `(A OR B)`, use the `Or` variant explicitly.
#[derive(Debug, Clone)]
pub enum ReadPredicate {
    /// `column = value`
    Eq { column: String, value: ScalarValue },
    /// `column IS NULL`
    IsNull { column: String },
    /// `column IS NOT NULL`
    IsNotNull { column: String },
    /// `column >= value`
    Gte { column: String, value: ScalarValue },
    /// `column <= value`
    Lte { column: String, value: ScalarValue },
    /// `column IN (values)`
    In {
        column: String,
        values: Vec<ScalarValue>,
    },
    /// `(left OR right)` — parenthesised in generated SQL.
    Or(Box<ReadPredicate>, Box<ReadPredicate>),
}

/// A scalar value used in predicates.
#[derive(Debug, Clone)]
pub enum ScalarValue {
    U64(u64),
    I64(i64),
    Text(String),
    Bool(bool),
}

/// One element of an `ORDER BY` clause.
#[derive(Debug, Clone)]
pub struct ReadOrder {
    pub column: String,
    pub direction: OrderDirection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderDirection {
    Asc,
    Desc,
}

/// Page specification — both fields are required for archive-capable reads.
#[derive(Debug, Clone)]
pub struct PageSpec {
    /// Maximum number of rows to return after merging hot and cold results.
    pub limit: u32,
    /// Opaque cursor for keyset pagination (encoded as the value of the
    /// deterministic order key at the last row of the previous page).
    pub cursor: Option<String>,
}

impl PageSpec {
    /// Default page size used by the audit-log read path.
    pub const AUDIT_LOG_DEFAULT_LIMIT: u32 = 500;
}

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
    let mut binds: Vec<ScalarValue> = Vec::new();

    // SELECT
    let cols = plan
        .projection
        .iter()
        .map(|c| quote_ident(c, style))
        .collect::<Vec<_>>()
        .join(", ");
    let mut sql = format!(
        "SELECT {cols} FROM {table}",
        table = quote_ident(&plan.table, style)
    );

    // WHERE
    let mut conditions: Vec<String> = Vec::new();

    // Mandatory org scope — always first.
    let org_bind = push_bind(&mut binds, ScalarValue::U64(plan.organization_id), style);
    conditions.push(format!(
        "{} = {org_bind}",
        quote_ident("organization_id", style)
    ));

    // Optional company scope.
    if let Some(company_id) = plan.company_id {
        let co_bind = push_bind(&mut binds, ScalarValue::U64(company_id), style);
        conditions.push(format!("{} = {co_bind}", quote_ident("company_id", style)));
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
                QuotingStyle::PgDollar => format!("${}", base + i),
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
    binds.push(value);
    match style {
        QuotingStyle::StdbBacktick => "?".to_string(),
        QuotingStyle::PgDollar => format!("${}", binds.len()),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn audit_plan() -> ResourceReadPlan {
        ResourceReadPlan {
            resource: "audit-log".into(),
            table: "audit_log".into(),
            projection: vec!["id".into(), "organization_id".into(), "action".into()],
            organization_id: 42,
            company_id: Some(7),
            predicates: vec![],
            order: vec![ReadOrder {
                column: "id".into(),
                direction: OrderDirection::Desc,
            }],
            page: PageSpec {
                limit: PageSpec::AUDIT_LOG_DEFAULT_LIMIT,
                cursor: None,
            },
        }
    }

    #[test]
    fn pg_sql_contains_org_scope() {
        let plan = audit_plan();
        let (sql, binds) = compile_pg_sql(&plan).unwrap();
        assert!(sql.contains("\"organization_id\" = $1"), "SQL: {sql}");
        assert!(sql.contains("\"company_id\" = $2"), "SQL: {sql}");
        assert!(matches!(binds[0], ScalarValue::U64(42)));
        assert!(matches!(binds[1], ScalarValue::U64(7)));
    }

    #[test]
    fn pg_sql_contains_order_and_limit() {
        let plan = audit_plan();
        let (sql, _) = compile_pg_sql(&plan).unwrap();
        assert!(sql.contains("ORDER BY \"id\" DESC"), "SQL: {sql}");
        assert!(sql.contains("LIMIT 500"), "SQL: {sql}");
    }

    #[test]
    fn stdb_sql_uses_question_mark_placeholders() {
        let plan = audit_plan();
        let (sql, _) = compile_stdb_sql(&plan).unwrap();
        assert!(sql.contains("`organization_id` = ?"), "SQL: {sql}");
    }

    #[test]
    fn or_predicate_is_parenthesised() {
        let mut plan = audit_plan();
        plan.predicates.push(ReadPredicate::Or(
            Box::new(ReadPredicate::IsNull {
                column: "company_id".into(),
            }),
            Box::new(ReadPredicate::Eq {
                column: "company_id".into(),
                value: ScalarValue::U64(7),
            }),
        ));
        let (sql, _) = compile_pg_sql(&plan).unwrap();
        assert!(
            sql.contains("(\"company_id\" IS NULL OR \"company_id\" ="),
            "SQL: {sql}"
        );
    }

    #[test]
    fn in_predicate_with_empty_values_compiles_to_false() {
        let mut plan = audit_plan();
        plan.predicates.push(ReadPredicate::In {
            column: "company_id".into(),
            values: vec![],
        });
        let (sql, _) = compile_pg_sql(&plan).unwrap();
        assert!(sql.contains("AND FALSE"), "SQL: {sql}");
    }

    #[test]
    fn cursor_applies_keyset_predicate() {
        let mut plan = audit_plan();
        let cursor = cursor::encode_cursor(&plan.order, &[ScalarValue::U64(100)]).unwrap();
        plan.page.cursor = Some(cursor);
        let (sql, binds) = compile_pg_sql(&plan).unwrap();
        assert!(sql.contains("\"id\" < $3"), "SQL: {sql}");
        assert!(matches!(binds[2], ScalarValue::U64(100)));
    }

    #[test]
    fn malformed_cursor_is_rejected() {
        let mut plan = audit_plan();
        plan.page.cursor = Some("not-a-valid-cursor!!".into());
        assert!(compile_pg_sql(&plan).is_err());
    }

    #[test]
    fn quoted_identifier_neutralizes_embedded_quote() {
        assert_eq!(quote_ident(r#"a"b"#, QuotingStyle::PgDollar), "\"a\"\"b\"");
    }
}
