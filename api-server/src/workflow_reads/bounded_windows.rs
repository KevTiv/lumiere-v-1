//! Complete numeric-ID windows for SpacetimeDB HTTP SQL without ordered LIMIT.
//! Callers supply fixed table/column names and an already-authorized predicate.

use crate::error::ApiError;
use stdb_client::StdbClient;

pub(crate) const ID_WINDOW: u64 = 128;
pub(crate) const MAX_SEEK_PROBES: usize = 64;

pub(crate) fn window_sql(
    table: &'static str,
    columns: &str,
    predicate: &str,
    after: u64,
    end: u64,
) -> String {
    format!("SELECT {columns} FROM {table} WHERE {predicate} AND id > {after} AND id <= {end} LIMIT {ID_WINDOW}")
}

pub(crate) struct BoundedIdReader<'a> {
    owner: &'a StdbClient,
    table: &'static str,
    predicate: &'a str,
}

impl<'a> BoundedIdReader<'a> {
    pub(crate) fn new(owner: &'a StdbClient, table: &'static str, predicate: &'a str) -> Self {
        Self {
            owner,
            table,
            predicate,
        }
    }

    pub(crate) fn window_sql(&self, columns: &str, after: u64, end: u64) -> String {
        window_sql(self.table, columns, self.predicate, after, end)
    }

    /// Return one scoped ID, making no assumption about its traversal order.
    pub(crate) async fn witness(
        &self,
        after: u64,
        through: Option<u64>,
    ) -> Result<Option<u64>, ApiError> {
        if after == u64::MAX {
            return Ok(None);
        }
        let upper = through
            .map(|end| format!(" AND id <= {end}"))
            .unwrap_or_default();
        let sql = format!(
            "SELECT id FROM {} WHERE {} AND id > {after}{upper} LIMIT 1",
            self.table, self.predicate
        );
        let rows = self
            .owner
            .query_sql(&sql)
            .await
            .map_err(ApiError::internal)?;
        let Some(row) = rows.first() else {
            return Ok(None);
        };
        let id = row
            .get("id")
            .and_then(|value| {
                value
                    .as_u64()
                    .or_else(|| value.as_str().and_then(|id| id.parse().ok()))
            })
            .filter(|id| *id > after && through.is_none_or(|end| *id <= end))
            .ok_or_else(|| ApiError::Internal("work item escaped the ID probe scope".into()))?;
        Ok(Some(id))
    }

    /// Locate the next complete window without treating an arbitrary witness
    /// as the lowest ID. Only ranges proved empty advance the cursor boundary.
    /// Share `probes` across a request to bound sparse, global-ID scans too.
    pub(crate) async fn seek_window_start(
        &self,
        after: &mut u64,
        mut upper: u64,
        probes: &mut usize,
    ) -> Result<(), ApiError> {
        let first_end = after.saturating_add(ID_WINDOW);
        if upper <= first_end || *probes >= MAX_SEEK_PROBES {
            return Ok(());
        }
        *probes += 1;
        if self.witness(*after, Some(first_end)).await?.is_some() {
            return Ok(());
        }
        *after = first_end;
        while upper.saturating_sub(*after) > ID_WINDOW && *probes < MAX_SEEK_PROBES {
            let midpoint = *after + (upper - *after) / 2;
            *probes += 1;
            match self.witness(*after, Some(midpoint)).await? {
                Some(witness) => upper = witness,
                None => *after = midpoint,
            }
        }
        Ok(())
    }
}
