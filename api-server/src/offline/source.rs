use serde_json::Value;
use stdb_client::StdbClient;

use super::{
    core::{CategorySource, FeedError, Scope},
    generated_category::{SNAPSHOT_COLUMNS, TABLE},
    rows,
};
use crate::cold_tier::{commit_projection, projection_worker};

pub struct StdbCategorySource<'a> {
    pub client: &'a StdbClient,
    pub scope: &'a Scope,
}

fn invalid(error: impl std::fmt::Display) -> FeedError {
    FeedError::InvalidSource(error.to_string())
}

impl CategorySource for StdbCategorySource<'_> {
    async fn watermark(&self) -> Result<u64, FeedError> {
        let organization = super::core::parse_cursor(&self.scope.organization_id)?;
        let rows = self.client.query_sql(&format!("SELECT organization_id, next_sequence FROM organization_commit_cursor WHERE organization_id = {organization}")).await.map_err(invalid)?;
        match rows.as_slice() {
            [] => Ok(0),
            [row] if rows::number(&row["organizationId"])? == organization => {
                rows::number(&row["nextSequence"])?
                    .checked_sub(1)
                    .ok_or_else(|| invalid("invalid organization cursor"))
            }
            _ => Err(invalid("organization cursor cardinality/scope mismatch")),
        }
    }

    async fn snapshot_rows(&self) -> Result<Vec<Value>, FeedError> {
        let organization = super::core::parse_cursor(&self.scope.organization_id)?;
        let company = self
            .scope
            .company_id
            .as_deref()
            .ok_or_else(|| invalid("company scope required"))?;
        let company = super::core::parse_cursor(company)?;
        let query = format!("SELECT {SNAPSHOT_COLUMNS} FROM {TABLE} WHERE organization_id = {organization} AND (company_id = {company} OR company_id IS NULL) AND deleted_at IS NULL LIMIT 1001");
        let rows = self.client.query_sql(&query).await.map_err(invalid)?;
        let mut output = Vec::new();
        let mut identities = std::collections::BTreeSet::new();
        for row in rows {
            if let Some(change) = rows::project(&row, self.scope)? {
                if change["operation"] != "upsert" {
                    return Err(invalid("snapshot contains deleted row"));
                }
                let row = change["row"].clone();
                if !identities.insert(row["id"].clone().to_string()) {
                    return Err(invalid("duplicate snapshot identity"));
                }
                output.push(row);
            }
        }
        Ok(output)
    }

    async fn commit_changes(&self, sequence: u64) -> Result<Vec<Value>, FeedError> {
        let organization = super::core::parse_cursor(&self.scope.organization_id)?;
        let commits = self.client.query_sql(&format!("SELECT * FROM organization_commit WHERE organization_id = {organization} AND sequence = {sequence}")).await.map_err(invalid)?;
        let commit = match commits.as_slice() {
            [] => return Err(FeedError::Reset),
            [row] => projection_worker::parse_commit(row).map_err(invalid)?,
            _ => return Err(invalid("duplicate organization commit")),
        };
        if commit.organization_id != organization || commit.sequence != sequence {
            return Err(invalid("foreign commit"));
        }
        if commit.row_change_count > 10_000 {
            return Err(FeedError::Reset);
        }
        let changes = self.client.query_sql(&format!("SELECT * FROM organization_row_change WHERE organization_id = {organization} AND commit_sequence = {sequence}")).await.map_err(invalid)?;
        if changes
            .iter()
            .map(|row| row.to_string().len())
            .sum::<usize>()
            > 4 * 1024 * 1024
        {
            return Err(FeedError::Reset);
        }
        let mut changes = changes
            .iter()
            .map(projection_worker::parse_change)
            .collect::<Result<Vec<_>, _>>()
            .map_err(invalid)?;
        changes.sort_by_key(|change| change.ordinal);
        if changes.len() != commit.row_change_count as usize {
            return Err(FeedError::Reset);
        }
        commit_projection::validate_replay(&commit, &changes).map_err(invalid)?;
        let mut output = Vec::new();
        for change in changes
            .into_iter()
            .filter(|change| change.table_name == TABLE)
        {
            // Physical category deletion is not a current domain workflow. Without
            // its previous company identity, a bare tombstone cannot prove visibility.
            if change.change_kind != "upsert" {
                return Err(FeedError::Reset);
            }
            let row: Value = serde_json::from_str(
                change
                    .row_json
                    .as_deref()
                    .ok_or_else(|| invalid("missing category row"))?,
            )
            .map_err(invalid)?;
            if let Some(change) = rows::project(&row, self.scope)? {
                output.push(change);
            }
        }
        Ok(output)
    }
}
