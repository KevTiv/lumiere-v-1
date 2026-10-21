//! Strict selected-field projection for both SQL snapshots and durable SATS rows.

use super::core::{FeedError, Scope};
use serde_json::{json, Value};

fn field<'a>(row: &'a Value, snake: &str, camel: &str) -> Result<&'a Value, FeedError> {
    row.get(snake)
        .or_else(|| row.get(camel))
        .ok_or_else(|| FeedError::InvalidSource(format!("missing {snake}")))
}

pub fn number(value: &Value) -> Result<u64, FeedError> {
    if let Some(value) = value.as_u64() {
        return Ok(value);
    }
    value
        .as_str()
        .ok_or_else(|| FeedError::InvalidSource("expected u64".into()))
        .and_then(|value| {
            super::core::parse_cursor(value)
                .map_err(|_| FeedError::InvalidSource("expected u64".into()))
        })
}

fn option(value: &Value) -> Result<Option<&Value>, FeedError> {
    if value.is_null() {
        return Ok(None);
    }
    if let Some(object) = value.as_object() {
        if object.len() == 1 && object.contains_key("none") {
            if object["none"].as_array().is_some_and(Vec::is_empty) {
                return Ok(None);
            }
            return Err(FeedError::InvalidSource("malformed SATS none".into()));
        }
        if object.len() == 1 {
            if let Some(value) = object.get("some") {
                if value.is_null() {
                    return Err(FeedError::InvalidSource("malformed SATS some".into()));
                }
                return Ok(Some(value));
            }
        }
    }
    Ok(Some(value))
}

fn optional_id(row: &Value, snake: &str, camel: &str) -> Result<Option<String>, FeedError> {
    option(field(row, snake, camel)?)?
        .map(number)
        .transpose()
        .map(|id| id.map(|id| id.to_string()))
}

/// None means a foreign-company row, never a permitted partial row.
pub fn project(row: &Value, scope: &Scope) -> Result<Option<Value>, FeedError> {
    let organization = number(field(row, "organization_id", "organizationId")?)?.to_string();
    if organization != scope.organization_id {
        return Err(FeedError::InvalidSource("foreign organization".into()));
    }
    let company = optional_id(row, "company_id", "companyId")?;
    if company.is_some() && company != scope.company_id {
        return Ok(None);
    }
    let id = number(field(row, "id", "id")?)?.to_string();
    if option(field(row, "deleted_at", "deletedAt")?)?.is_some() {
        return Ok(Some(json!({"operation": "delete", "id": id})));
    }
    let name = field(row, "name", "name")?
        .as_str()
        .filter(|s| s.encode_utf16().count() <= 4096)
        .ok_or_else(|| FeedError::InvalidSource("invalid category name".into()))?;
    let parent = optional_id(row, "parent_id", "parentId")?;
    let sequence = u32::try_from(number(field(row, "sequence", "sequence")?)?)
        .map_err(|_| FeedError::InvalidSource("sequence exceeds u32".into()))?;
    Ok(Some(
        json!({"operation": "upsert", "row": {"id": id, "organization_id": organization, "company_id": company, "name": name, "parent_id": parent, "sequence": sequence}}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scope() -> Scope {
        Scope {
            environment_id: "env".into(),
            actor_id: "actor".into(),
            organization_id: "7".into(),
            company_id: Some("9".into()),
            authorization_version: "v1".into(),
        }
    }
    fn row() -> Value {
        json!({"id":u64::MAX,"organization_id":7,"company_id":{"some":9},"name":"Produce","parent_id":{"none":[]},"sequence":1,"deleted_at":{"none":[]},"metadata":"must not escape"})
    }
    #[test]
    fn sats_projection_preserves_ids_without_exposing_metadata() {
        let change = project(&row(), &scope()).unwrap().unwrap();
        assert_eq!(change["row"]["id"], u64::MAX.to_string());
        assert_eq!(change["row"]["parent_id"], Value::Null);
        assert_eq!(change["row"].as_object().unwrap().len(), 6);
        assert!(change["row"].get("metadata").is_none());
    }
    #[test]
    fn denied_company_is_filtered_and_foreign_org_fails() {
        let mut row = row();
        row["company_id"] = json!({"some":8});
        assert!(project(&row, &scope()).unwrap().is_none());
        row["organization_id"] = json!(8);
        assert!(project(&row, &scope()).is_err());
    }
    #[test]
    fn soft_delete_produces_scoped_identity_only() {
        let mut row = row();
        row["deleted_at"] = json!({"some":{"microsSinceUnixEpoch":1}});
        assert_eq!(
            project(&row, &scope()).unwrap().unwrap(),
            json!({"operation":"delete","id":u64::MAX.to_string()})
        );
    }
    #[test]
    fn malformed_options_and_u32_fail_closed() {
        let mut row = row();
        row["parent_id"] = json!({"none":[1]});
        assert!(project(&row, &scope()).is_err());
        row["parent_id"] = Value::Null;
        row["sequence"] = json!(4294967296u64);
        assert!(project(&row, &scope()).is_err());
    }
    #[test]
    fn hot_sql_and_org_shared_row_use_the_same_codec() {
        let hot = json!({"id":1,"organizationId":7,"companyId":null,"name":"Shared","parentId":null,"sequence":0,"deletedAt":null});
        assert_eq!(
            project(&hot, &scope()).unwrap().unwrap()["row"]["company_id"],
            Value::Null
        );
    }
}
