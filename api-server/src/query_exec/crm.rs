use crate::error::ApiError;
use serde_json::Value;
use stdb_client::StdbClient;

use super::row_values::row_company_matches;
#[cfg(test)]
use super::row_values::{row_id_u64, row_not_soft_deleted};
#[cfg(test)]
use std::collections::HashSet;

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

pub(super) fn sort_crm_rows(resource: &str, rows: &mut [Value]) {
    match resource {
        "contact-tags" | "contact-categories" | "contact-segments" => {
            rows.sort_by(|a, b| {
                let an = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let bn = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                an.cmp(bn)
            });
        }
        "opportunity-stages" => {
            rows.sort_by(|a, b| {
                let asq = a.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                let bsq = b.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                asq.cmp(&bsq)
            });
        }
        "activities" => {
            rows.sort_by(|a, b| {
                let ai = a.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let bi = b.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                bi.cmp(&ai)
            });
        }
        _ => {}
    }
}
