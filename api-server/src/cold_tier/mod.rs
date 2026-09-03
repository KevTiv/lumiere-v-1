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
pub mod commit_projection;
pub mod conventions;
pub mod cursor;
pub mod hydration;
pub mod ledger;
pub mod migrate;
pub mod pg_codec;
pub mod pg_pool;
pub mod pos_order_drainer;
pub mod pos_order_read;
pub mod projection_observability;
pub mod projection_worker;
pub mod reconciliation;
pub mod reconstruction;

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

/// The generated archive metadata needed to compile one resource's read
/// against both stores.  The resource name is an API alias; table names come
/// from the generated archive manifest and are never accepted from a caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveReadDescriptor {
    pub resource: &'static str,
    pub hot_table: String,
    pub cold_table: String,
    pub primary_key: String,
    pub organization_column: String,
    pub company_column: Option<String>,
    pub company_required: bool,
    pub storage_class: String,
    pub access_path: PartitionExpectation,
}

/// Physical access-path expectation generated from the reviewed storage
/// policy.  A read plan carries this metadata even though each backend
/// realizes it differently (STDB index/accessor versus PG partition/index).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PartitionExpectation {
    OrganizationPartition,
    OrganizationIndex,
}

const ARCHIVE_MANIFEST_JSON: &str = lumiere_contracts::manifests::ARCHIVE_MANIFEST;
const CODEC_MANIFEST_JSON: &str = lumiere_contracts::manifests::CODEC_MANIFEST;
const STORAGE_POLICY_JSON: &str =
    include_str!("../../../lumiere-codegen/storage-policy-manifest.json");
const MAX_ARCHIVE_PAGE: u32 = 501;

/// Resolve the reviewed/generated descriptor for an archive-capable API
/// resource.  This intentionally has a closed resource alias list: adding a
/// cold resource requires a generated archive-manifest entry and a reviewed
/// API alias, rather than allowing request data to select an arbitrary table.
pub fn archive_read_descriptor(
    resource: &str,
) -> Result<ArchiveReadDescriptor, cursor::CursorError> {
    let (api_resource, source_table) = match resource {
        "audit-log" => ("audit-log", "audit_log"),
        "pos-orders" => ("pos-orders", "pos_order"),
        _ => {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "resource '{resource}' is not an archive-capable read"
            )))
        }
    };

    let manifest: serde_json::Value = serde_json::from_str(ARCHIVE_MANIFEST_JSON).map_err(|e| {
        cursor::CursorError::InvalidPlan(format!("parse generated archive manifest: {e}"))
    })?;
    let candidate = manifest["candidates"]
        .as_array()
        .and_then(|candidates| {
            candidates
                .iter()
                .find(|candidate| candidate["table"].as_str() == Some(source_table))
        })
        .ok_or_else(|| {
            cursor::CursorError::InvalidPlan(format!(
                "generated archive manifest has no candidate for '{source_table}'"
            ))
        })?;
    let string_field = |name: &str| {
        candidate[name].as_str().map(str::to_owned).ok_or_else(|| {
            cursor::CursorError::InvalidPlan(format!(
                "archive candidate '{source_table}' is missing '{name}'"
            ))
        })
    };
    // v0.3.x contracts expose scope as an ordered `scope_columns` list;
    // newer generated manifests may also carry named scope mappings.  Accept
    // both shapes while retaining the same fail-closed organization rule.
    let organization_column = candidate["scope"]["organization_id"]
        .as_str()
        .or_else(|| {
            candidate["scope_columns"].as_array().and_then(|columns| {
                columns.iter().find_map(|column| {
                    (column.as_str() == Some("organization_id")).then_some("organization_id")
                })
            })
        })
        .map(str::to_owned)
        .ok_or_else(|| {
            cursor::CursorError::InvalidPlan(format!(
                "archive candidate '{source_table}' has no organization scope"
            ))
        })?;
    let company_column = candidate["scope"]["company_id"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| {
            candidate["scope_columns"]
                .as_array()
                .and_then(|columns| {
                    columns.iter().find_map(|column| {
                        (column.as_str() == Some("company_id")).then_some("company_id")
                    })
                })
                .map(str::to_owned)
        });

    let policy_manifest: serde_json::Value =
        serde_json::from_str(STORAGE_POLICY_JSON).map_err(|e| {
            cursor::CursorError::InvalidPlan(format!("parse generated storage policy: {e}"))
        })?;
    let policy = policy_manifest["policies"]
        .as_array()
        .and_then(|policies| {
            policies
                .iter()
                .find(|policy| policy["table"].as_str() == Some(source_table))
        })
        .ok_or_else(|| {
            cursor::CursorError::InvalidPlan(format!(
                "generated storage policy has no entry for '{source_table}'"
            ))
        })?;
    if policy["organization_ownership"].as_str() != Some("direct") {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "archive candidate '{source_table}' does not have direct organization ownership"
        )));
    }
    let access_path = match policy["postgres_access_path"].as_str() {
        Some("organization_partition") => PartitionExpectation::OrganizationPartition,
        Some("organization_index") => PartitionExpectation::OrganizationIndex,
        Some(other) => {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "unsupported generated access path '{other}' for '{source_table}'"
            )))
        }
        None => {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "storage policy '{source_table}' has no Postgres access path"
            )))
        }
    };
    // Older published contracts do not yet carry the policy's storage-class
    // annotation. Preserve the descriptor seam and use the generated
    // candidate as the compatibility fallback until the next contract tag.
    let storage_class = policy["storage_class"]
        .as_str()
        .or_else(|| candidate["storage_class"].as_str())
        .unwrap_or("archive")
        .to_owned();
    let company_required = company_column.is_some()
        && policy["company_column_nullable"].as_bool() == Some(false);

    Ok(ArchiveReadDescriptor {
        resource: api_resource,
        hot_table: source_table.to_owned(),
        cold_table: string_field("cold_table")?,
        primary_key: candidate["primary_key"]["column_name"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| {
                cursor::CursorError::InvalidPlan(format!(
                    "archive candidate '{source_table}' has no primary key"
                ))
            })?,
        organization_column,
        company_column,
        company_required,
        storage_class,
        access_path,
    })
}

/// Validate a read plan before either SQL compiler emits a query.
///
/// The plan is deliberately checked against generated archive and codec
/// metadata.  This keeps table/column/cast selection out of request data and
/// makes the STDB and PG compilers share the same scope and projection rules.
pub fn validate_resource_read_plan(
    plan: &ResourceReadPlan,
) -> Result<ArchiveReadDescriptor, cursor::CursorError> {
    if plan.organization_id == 0 {
        return Err(cursor::CursorError::InvalidPlan(
            "organization_id must be greater than zero".into(),
        ));
    }
    if !(1..=MAX_ARCHIVE_PAGE).contains(&plan.page.limit) {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "page limit must be between 1 and {MAX_ARCHIVE_PAGE}"
        )));
    }
    if plan.order.is_empty() {
        return Err(cursor::CursorError::InvalidPlan(
            "order must contain a deterministic key".into(),
        ));
    }

    let descriptor = archive_read_descriptor(&plan.resource)?;
    if plan.table != descriptor.hot_table {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "resource '{}' must use generated hot table '{}'",
            plan.resource, descriptor.hot_table
        )));
    }
    if plan.company_id.is_some() && descriptor.company_column.is_none() {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "resource '{}' does not support company scope",
            plan.resource
        )));
    }
    if descriptor.company_required && plan.company_id.is_none() {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "resource '{}' requires resolved company scope",
            plan.resource
        )));
    }

    let codec =
        pg_codec::load_columns(CODEC_MANIFEST_JSON, &descriptor.hot_table).map_err(|e| {
            cursor::CursorError::InvalidPlan(format!(
                "load generated codec for '{}': {e}",
                descriptor.hot_table
            ))
        })?;
    let allowed_columns: std::collections::HashSet<&str> =
        codec.iter().map(|column| column.name.as_str()).collect();
    if plan.projection.is_empty() {
        return Err(cursor::CursorError::InvalidPlan(
            "projection must not be empty".into(),
        ));
    }
    for entry in &plan.projection {
        let (column, cast) = entry
            .split_once("::")
            .map_or((entry.as_str(), None), |(column, cast)| {
                (column, Some(cast))
            });
        if !allowed_columns.contains(column) {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "column '{column}' is not generated for '{}'",
                descriptor.hot_table
            )));
        }
        if cast.is_some_and(|cast| cast != "TEXT") {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "unsupported projection cast for '{column}'"
            )));
        }
    }
    if !plan
        .projection
        .iter()
        .any(|entry| entry.split("::").next() == Some(descriptor.organization_column.as_str()))
    {
        return Err(cursor::CursorError::InvalidPlan(
            "projection must include organization scope".into(),
        ));
    }
    for order in &plan.order {
        if !allowed_columns.contains(order.column.as_str()) {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "order column '{}' is not generated for '{}'",
                order.column, descriptor.hot_table
            )));
        }
        if !plan
            .projection
            .iter()
            .any(|entry| entry.split("::").next() == Some(order.column.as_str()))
        {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "order column '{}' must be projected",
                order.column
            )));
        }
    }
    if !plan
        .order
        .iter()
        .any(|order| order.column == descriptor.primary_key)
    {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "order must include generated primary key '{}'",
            descriptor.primary_key
        )));
    }
    validate_predicates(&plan.predicates, &allowed_columns)?;
    Ok(descriptor)
}

fn validate_predicates(
    predicates: &[ReadPredicate],
    allowed_columns: &std::collections::HashSet<&str>,
) -> Result<(), cursor::CursorError> {
    for predicate in predicates {
        let column = match predicate {
            ReadPredicate::Eq { column, .. }
            | ReadPredicate::IsNull { column }
            | ReadPredicate::IsNotNull { column }
            | ReadPredicate::Gte { column, .. }
            | ReadPredicate::Lte { column, .. }
            | ReadPredicate::In { column, .. } => Some(column.as_str()),
            ReadPredicate::Or(left, right) => {
                validate_predicates(std::slice::from_ref(left.as_ref()), allowed_columns)?;
                validate_predicates(std::slice::from_ref(right.as_ref()), allowed_columns)?;
                None
            }
        };
        if let Some(column) = column {
            if !allowed_columns.contains(column) {
                return Err(cursor::CursorError::InvalidPlan(format!(
                    "predicate column '{column}' is not generated"
                )));
            }
        }
    }
    Ok(())
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

/// An owned `ScalarValue` converted to whatever native Rust type actually
/// binds against `compile_pg_sql`'s placeholders (which carry the matching
/// `::NUMERIC` cast for `U64` — see [`pg_cast_suffix`]). Any caller
/// executing a `compile_pg_sql` query against `tokio-postgres` needs this;
/// it's not specific to one resource.
#[derive(Debug, Clone)]
pub enum PgBind {
    /// `U64`, bound as decimal text — matches the `::NUMERIC` cast every
    /// `U64` placeholder carries.
    NumericText(String),
    Int(i64),
    Text(String),
    Bool(bool),
}

impl PgBind {
    pub fn as_sql(&self) -> &(dyn tokio_postgres::types::ToSql + Sync) {
        match self {
            PgBind::NumericText(s) | PgBind::Text(s) => s,
            PgBind::Int(n) => n,
            PgBind::Bool(b) => b,
        }
    }
}

/// Convert `compile_pg_sql`'s bind values into their `tokio-postgres`
/// binding representation, in order.
pub fn scalar_binds_to_pg(values: &[ScalarValue]) -> Vec<PgBind> {
    values
        .iter()
        .map(|v| match v {
            ScalarValue::U64(n) => PgBind::NumericText(n.to_string()),
            ScalarValue::I64(n) => PgBind::Int(*n),
            ScalarValue::Text(s) => PgBind::Text(s.clone()),
            ScalarValue::Bool(b) => PgBind::Bool(*b),
        })
        .collect()
}

/// Deterministically merge one bounded page from hot STDB and durable PG.
///
/// The primary key is validated on every row, hot rows are visited first so
/// they win the archive-finalization overlap, and duplicates from either
/// source are removed before the global order/limit is applied.
pub fn merge_hot_cold_u64(
    hot_rows: Vec<serde_json::Value>,
    cold_rows: Vec<serde_json::Value>,
    key: &str,
    direction: OrderDirection,
    limit: u32,
) -> Result<(Vec<serde_json::Value>, bool), cursor::CursorError> {
    let mut seen = std::collections::HashSet::new();
    let mut merged = Vec::with_capacity(hot_rows.len() + cold_rows.len());
    for row in hot_rows.into_iter().chain(cold_rows) {
        let id = row.get(key).and_then(serde_json::Value::as_u64).ok_or_else(|| {
            cursor::CursorError::InvalidPlan(format!(
                "merged archive row has no valid u64 key '{key}'"
            ))
        })?;
        if seen.insert(id) {
            merged.push(row);
        }
    }
    merged.sort_by(|left, right| {
        let left = left.get(key).and_then(serde_json::Value::as_u64);
        let right = right.get(key).and_then(serde_json::Value::as_u64);
        match direction {
            OrderDirection::Asc => left.cmp(&right),
            OrderDirection::Desc => right.cmp(&left),
        }
    });
    let has_more = merged.len() > limit as usize;
    merged.truncate(limit as usize);
    Ok((merged, has_more))
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
        assert!(
            sql.contains("\"organization_id\" = $1::NUMERIC"),
            "SQL: {sql}"
        );
        assert!(sql.contains("\"company_id\" = $2::NUMERIC"), "SQL: {sql}");
        assert!(matches!(binds[0], ScalarValue::U64(42)));
        assert!(matches!(binds[1], ScalarValue::U64(7)));
    }

    #[test]
    fn pg_sql_contains_order_and_limit() {
        let plan = audit_plan();
        let (sql, _) = compile_pg_sql(&plan).unwrap();
        assert!(sql.contains("FROM \"cold_audit_log\""), "SQL: {sql}");
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
        assert!(sql.contains("\"id\" < $3::NUMERIC"), "SQL: {sql}");
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

    #[test]
    fn projection_cast_suffix_applies_for_pg_and_strips_for_stdb() {
        let mut plan = audit_plan();
        plan.projection = vec!["id::TEXT".into(), "organization_id".into(), "action".into()];

        let (pg_sql, _) = compile_pg_sql(&plan).unwrap();
        assert!(pg_sql.contains("\"id\"::TEXT"), "SQL: {pg_sql}");

        let (stdb_sql, _) = compile_stdb_sql(&plan).unwrap();
        assert!(stdb_sql.contains("`id`"), "SQL: {stdb_sql}");
        assert!(!stdb_sql.contains("::TEXT"), "SQL: {stdb_sql}");
    }

    #[test]
    fn inline_stdb_literals_substitutes_in_order() {
        let mut plan = audit_plan();
        plan.predicates.push(ReadPredicate::Eq {
            column: "action".into(),
            value: ScalarValue::Text("it's fine".into()),
        });
        let (sql, binds) = compile_stdb_sql(&plan).unwrap();
        let inlined = inline_stdb_literals(&sql, &binds);

        assert!(!inlined.contains('?'), "SQL: {inlined}");
        assert!(inlined.contains("= 42"), "SQL: {inlined}");
        assert!(inlined.contains("'it''s fine'"), "SQL: {inlined}");
    }

    #[test]
    fn arbitrary_resource_and_table_are_rejected_before_sql_emission() {
        let mut plan = audit_plan();
        plan.resource = "caller-selected-table".into();
        assert!(matches!(
            compile_pg_sql(&plan),
            Err(cursor::CursorError::InvalidPlan(_))
        ));

        let mut plan = audit_plan();
        plan.table = "audit_log; DROP TABLE company".into();
        assert!(matches!(
            compile_stdb_sql(&plan),
            Err(cursor::CursorError::InvalidPlan(_))
        ));
    }

    #[test]
    fn arbitrary_projection_cast_is_rejected() {
        let mut plan = audit_plan();
        plan.projection.push("action::JSONB".into());
        assert!(compile_pg_sql(&plan).is_err());
    }

    #[test]
    fn company_owned_archive_read_requires_resolved_company_scope() {
        let columns = pg_codec::load_columns(CODEC_MANIFEST_JSON, "pos_order").unwrap();
        let plan = ResourceReadPlan {
            resource: "pos-orders".into(),
            table: "pos_order".into(),
            projection: pg_codec::projection_with_pg_casts(&columns),
            organization_id: 42,
            company_id: None,
            predicates: vec![],
            order: vec![ReadOrder {
                column: "id".into(),
                direction: OrderDirection::Desc,
            }],
            page: PageSpec {
                limit: 100,
                cursor: None,
            },
        };

        assert!(matches!(
            compile_pg_sql(&plan),
            Err(cursor::CursorError::InvalidPlan(message))
                if message.contains("requires resolved company scope")
        ));
    }
}
