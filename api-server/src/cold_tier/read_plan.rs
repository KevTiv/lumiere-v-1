//! Authenticated, store-independent read contract.

/// The canonical read contract for one API resource request.
///
/// Resolved once from the authenticated session, org/company scope, and field
/// policy. Compiled into store-specific SQL by [`super::compile_stdb_sql`] and
/// [`super::compile_pg_sql`].
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
