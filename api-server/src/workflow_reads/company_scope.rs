//! Workflow company scope and row filters.
use super::row_u64;
use crate::error::ApiError;
use serde_json::Value;
use std::collections::HashSet;
use stdb_auth::FieldAccessContext;
use stdb_client::StdbClient;

pub(super) async fn allowed_company_ids(
    owner: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<HashSet<u64>, ApiError> {
    // Reuse org companies; FieldAccessContext does not currently carry a selected
    // operating company — UI filters further by query key. BFF enforces membership.
    let sql = format!("SELECT id FROM company WHERE organization_id = {organization_id}");
    let rows = owner.query_sql(&sql).await.map_err(ApiError::internal)?;
    let mut ids = HashSet::new();
    for r in rows {
        if let Some(id) = row_u64(&r, "id") {
            if id > 0 {
                ids.insert(id);
            }
        }
    }
    // Superusers still scoped to org companies above.
    let _ = fa;
    Ok(ids)
}

pub(super) fn row_company_allowed(row: &Value, allowed: &HashSet<u64>) -> bool {
    match row_u64(row, "companyId").or_else(|| row_u64(row, "company_id")) {
        Some(cid) => allowed.contains(&cid),
        None => false,
    }
}

pub(super) fn row_optional_company_allowed(row: &Value, allowed: &HashSet<u64>) -> bool {
    match row
        .get("companyId")
        .filter(|value| !value.is_null())
        .or_else(|| row.get("company_id").filter(|value| !value.is_null()))
    {
        // Only absent/null company scope denotes an organization-wide definition.
        None => true,
        Some(value) => value
            .as_u64()
            .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
            .is_some_and(|id| id > 0 && allowed.contains(&id)),
    }
}
