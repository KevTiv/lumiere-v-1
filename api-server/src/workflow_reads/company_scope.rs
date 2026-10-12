//! Workflow company scope and row filters.
use super::row_u64;
use crate::error::ApiError;
use serde_json::Value;
use std::collections::HashSet;
use stdb_auth::{identity_sql_literal, FieldAccessContext};
use stdb_client::StdbClient;

pub(super) async fn allowed_company_ids(
    owner: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<HashSet<u64>, ApiError> {
    let Some(fa) = fa.filter(|context| context.organization_id == organization_id) else {
        return Ok(HashSet::new());
    };
    let sql =
        format!("SELECT id, deleted_at FROM company WHERE organization_id = {organization_id}");
    let rows = owner.query_sql(&sql).await.map_err(ApiError::internal)?;
    let mut ids = HashSet::new();
    for r in rows {
        if let Some(id) = row_u64(&r, "id").filter(|_| {
            r.get("deletedAt")
                .or_else(|| r.get("deleted_at"))
                .is_none_or(Value::is_null)
        }) {
            if id > 0 {
                ids.insert(id);
            }
        }
    }
    if fa.is_superuser {
        return Ok(ids);
    }
    let identity = identity_sql_literal(&fa.identity_hex).map_err(ApiError::Internal)?;
    let memberships = owner.query_sql(&format!(
        "SELECT organization_id, company_id, is_active FROM user_organization WHERE user_identity = {identity}"
    )).await.map_err(ApiError::internal)?;
    Ok(membership_company_ids(organization_id, &ids, &memberships))
}

fn membership_company_ids(
    org: u64,
    live_companies: &HashSet<u64>,
    memberships: &[Value],
) -> HashSet<u64> {
    let mut allowed = HashSet::new();
    for membership in memberships {
        let member_org = row_u64(membership, "organizationId")
            .or_else(|| row_u64(membership, "organization_id"));
        let active = membership
            .get("isActive")
            .or_else(|| membership.get("is_active"))
            .and_then(Value::as_bool)
            == Some(true);
        if member_org != Some(org) || !active {
            continue;
        }
        let Some(company) = membership
            .get("companyId")
            .or_else(|| membership.get("company_id"))
        else {
            continue;
        };
        if company.is_null() {
            allowed.extend(live_companies);
        } else if let Some(id) = company
            .as_u64()
            .or_else(|| company.as_str().and_then(|value| value.parse().ok()))
        {
            if live_companies.contains(&id) {
                allowed.insert(id);
            }
        }
    }
    allowed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn workflow_company_scope_uses_current_memberships() {
        let companies = HashSet::from([7, 8]);
        let rows = vec![
            json!({"organizationId":1,"companyId":7,"isActive":true}),
            json!({"organizationId":1,"companyId":8,"isActive":false}),
            json!({"organizationId":2,"companyId":8,"isActive":true}),
            json!({"organizationId":1,"companyId":99,"isActive":true}),
        ];
        assert_eq!(
            membership_company_ids(1, &companies, &rows),
            HashSet::from([7])
        );
        assert_eq!(
            membership_company_ids(
                1,
                &companies,
                &[json!({"organization_id":1,"company_id":null,"is_active":true})]
            ),
            companies
        );
        assert!(membership_company_ids(
            1,
            &companies,
            &[
                json!({"organizationId":1,"isActive":true}),
                json!({"organizationId":1,"companyId":"bad","isActive":true})
            ]
        )
        .is_empty());
    }
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
