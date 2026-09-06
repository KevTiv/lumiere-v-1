use crate::error::ApiError;
use serde_json::Value;
use stdb_client::StdbClient;

use super::row_values::row_u64;
#[cfg(test)]
use super::row_values::{row_id_u64, row_not_soft_deleted};
#[cfg(test)]
use std::collections::HashSet;

fn row_company_matches(row: &Value, company_id: u64, allow_shared: bool) -> bool {
    match row_u64(row, "companyId", "company_id") {
        Ok(Some(id)) => id == company_id,
        Ok(None) => allow_shared,
        Err(_) => false,
    }
}

pub(super) fn filter_direct_crm_company_rows(
    resource: &str,
    company_id: u64,
    rows: &mut Vec<Value>,
) -> bool {
    let is_direct_company_owned = matches!(
        resource,
        "contacts"
            | "opportunities"
            | "contact-phone-identities"
            | "contact-role-assignments"
            | "contact-communication-preferences"
    );
    if is_direct_company_owned {
        rows.retain(|row| row_company_matches(row, company_id, false));
    }
    is_direct_company_owned
}

#[cfg(test)]
pub(super) fn visible_parent_ids_from_rows(rows: &[Value], company_id: u64) -> HashSet<u64> {
    rows.iter()
        .filter(|row| row_company_matches(row, company_id, false) && row_not_soft_deleted(row))
        .map(row_id_u64)
        .filter(|id| *id > 0)
        .collect()
}

pub(super) async fn filter_crm_company_rows(
    _client: &StdbClient,
    resource: &str,
    _organization_id: u64,
    company_id: u64,
    rows: &mut Vec<Value>,
) -> Result<(), ApiError> {
    if filter_direct_crm_company_rows(resource, company_id, rows) {
        return Ok(());
    }

    match resource {
        "contact-duplicate-candidates"
        | "crm-forecast-snapshots"
        | "opportunity-lines"
        | "opportunity-presence"
        | "contact-tag-assignments"
        | "contact-category-assignments"
        | "segment-members"
        | "privacy-consent"
        | "contact-relationship-insights"
        | "contact-relationships"
        | "crm-conversations"
        | "crm-conversation-messages" => {
            rows.retain(|row| row_company_matches(row, company_id, false));
        }
        _ => {}
    }
    Ok(())
}
