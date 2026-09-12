//! Owned Postgres parameters; u64 binds remain decimal text with NUMERIC casts.
use super::ScalarValue;

/// An owned `ScalarValue` converted to whatever native Rust type actually
/// binds against `compile_pg_sql`'s placeholders (which carry the matching
/// `::NUMERIC` cast for `U64` — see the read SQL compiler). Any caller
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
