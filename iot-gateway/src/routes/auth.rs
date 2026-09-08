//! Post-pair hub credential scope for gateway device traffic.

use axum::{
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::state::AppState;

#[derive(Debug)]
pub(crate) struct AuthError {
    status: StatusCode,
    message: String,
}

impl AuthError {
    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }

    pub(crate) fn internal(error: impl Into<String>) -> Self {
        tracing::error!(error = %error.into(), "IoT gateway internal authorization failure");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "internal server error".into(),
        }
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "success": false, "message": self.message })),
        )
            .into_response()
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct AuthorizedTarget {
    organization_id: u64,
    company_id: u64,
    hub_id: u64,
}

impl AuthorizedTarget {
    pub(crate) fn organization_id(self) -> u64 {
        self.organization_id
    }
}

/// Verify the opaque bearer credential against the hash stored on the target
/// hub, then return only server-derived organization/company scope.
pub(crate) async fn authorize_target(
    state: &AppState,
    headers: &HeaderMap,
    table: TargetTable,
    target_id: u64,
) -> Result<AuthorizedTarget, AuthError> {
    if target_id == 0 {
        return Err(AuthError::forbidden("target id must be greater than zero"));
    }
    let credential = bearer_token(headers)?;
    let target = load_target_scope(state, table, target_id).await?;
    let presented_hash = credential_hash(credential);
    if !constant_time_eq(target.credential_hash.as_bytes(), presented_hash.as_bytes()) {
        return Err(AuthError::unauthorized("invalid hub credential"));
    }

    Ok(AuthorizedTarget {
        organization_id: target.organization_id,
        company_id: target.company_id,
        hub_id: target.hub_id,
    })
}

pub(crate) async fn enforce_target_scope(
    state: &AppState,
    table: TargetTable,
    target_id: u64,
    expected: AuthorizedTarget,
) -> Result<(), AuthError> {
    let target = load_target_scope(state, table, target_id).await?;
    if target.organization_id != expected.organization_id
        || target.company_id != expected.company_id
        || target.hub_id != expected.hub_id
    {
        return Err(AuthError::forbidden(
            "target is outside the authenticated company scope",
        ));
    }
    Ok(())
}

async fn load_target_scope(
    state: &AppState,
    table: TargetTable,
    target_id: u64,
) -> Result<TargetScope, AuthError> {
    let target = state
        .stdb
        .query_sql(&table.select_sql(target_id))
        .await
        .map_err(|error| AuthError::internal(error.to_string()))?
        .into_iter()
        .next()
        .ok_or_else(|| AuthError::not_found("target not found"))?;
    let organization_id = row_u64(&target, "organizationId", "organization_id")
        .ok_or_else(|| AuthError::internal("target has no organization scope"))?;
    let company_id = row_u64(&target, "companyId", "company_id")
        .ok_or_else(|| AuthError::internal("target has no company scope"))?;
    let hub_id = match table {
        TargetTable::Hub => target_id,
        TargetTable::Device => row_u64(&target, "hubId", "hub_id")
            .ok_or_else(|| AuthError::internal("device has no hub scope"))?,
        TargetTable::Action => {
            let device_id = row_u64(&target, "deviceId", "device_id")
                .ok_or_else(|| AuthError::internal("action has no device scope"))?;
            let device = state
                .stdb
                .query_sql(&TargetTable::Device.select_sql(device_id))
                .await
                .map_err(|error| AuthError::internal(error.to_string()))?
                .into_iter()
                .next()
                .ok_or_else(|| AuthError::not_found("action device not found"))?;
            let device_org = row_u64(&device, "organizationId", "organization_id")
                .ok_or_else(|| AuthError::internal("action device has no organization scope"))?;
            let device_company = row_u64(&device, "companyId", "company_id")
                .ok_or_else(|| AuthError::internal("action device has no company scope"))?;
            if device_org != organization_id || device_company != company_id {
                return Err(AuthError::forbidden(
                    "action and device tenant scope do not match",
                ));
            }
            row_u64(&device, "hubId", "hub_id")
                .ok_or_else(|| AuthError::internal("action device has no hub scope"))?
        }
    };
    if organization_id == 0 || company_id == 0 || hub_id == 0 {
        return Err(AuthError::forbidden("target has invalid tenant scope"));
    }
    let hub = state
        .stdb
        .query_sql(&TargetTable::Hub.select_sql(hub_id))
        .await
        .map_err(|error| AuthError::internal(error.to_string()))?
        .into_iter()
        .next()
        .ok_or_else(|| AuthError::not_found("target hub not found"))?;
    let hub_org = row_u64(&hub, "organizationId", "organization_id")
        .ok_or_else(|| AuthError::internal("hub has no organization scope"))?;
    let hub_company = row_u64(&hub, "companyId", "company_id")
        .ok_or_else(|| AuthError::internal("hub has no company scope"))?;
    if hub_org != organization_id || hub_company != company_id {
        return Err(AuthError::forbidden(
            "target and hub tenant scope do not match",
        ));
    }
    let credential_hash = row_string(&hub, "credentialHash", "credential_hash")
        .ok_or_else(|| AuthError::unauthorized("hub has no active credential"))?;
    Ok(TargetScope {
        organization_id,
        company_id,
        hub_id,
        credential_hash,
    })
}

#[derive(Debug)]
struct TargetScope {
    organization_id: u64,
    company_id: u64,
    hub_id: u64,
    credential_hash: String,
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, AuthError> {
    let value = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AuthError::unauthorized("bearer authorization required"))?;
    let (scheme, token) = value
        .split_once(' ')
        .ok_or_else(|| AuthError::unauthorized("bearer authorization required"))?;
    if !scheme.eq_ignore_ascii_case("bearer") || token.trim().is_empty() {
        return Err(AuthError::unauthorized("bearer authorization required"));
    }
    Ok(token.trim())
}

fn row_u64(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_string(row: &Value, camel: &str, snake: &str) -> Option<String> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

pub(crate) fn credential_hash(credential: &str) -> String {
    hex::encode(Sha256::digest(credential.as_bytes()))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum TargetTable {
    Hub,
    Device,
    Action,
}

impl TargetTable {
    fn select_sql(self, id: u64) -> String {
        let table = match self {
            Self::Hub => "iot_hub",
            Self::Device => "iot_device",
            Self::Action => "iot_action",
        };
        let extra = match self {
            Self::Hub => ", credential_hash",
            Self::Device => ", hub_id",
            Self::Action => ", device_id",
        };
        format!("SELECT organization_id, company_id{extra} FROM {table} WHERE id = {id}")
    }
}

#[cfg(test)]
mod tests {
    use super::{bearer_token, constant_time_eq, credential_hash, row_u64};
    use axum::http::{header::AUTHORIZATION, HeaderMap, HeaderValue};
    use serde_json::json;

    #[test]
    fn bearer_header_is_required_and_case_insensitive() {
        let mut headers = HeaderMap::new();
        assert!(bearer_token(&headers).is_err());
        headers.insert(AUTHORIZATION, HeaderValue::from_static("bEaReR token"));
        assert!(matches!(bearer_token(&headers), Ok("token")));
    }

    #[test]
    fn target_scope_accepts_camel_and_snake_rows() {
        let row = json!({"organization_id": 4, "companyId": "9"});
        assert_eq!(row_u64(&row, "organizationId", "organization_id"), Some(4));
        assert_eq!(row_u64(&row, "companyId", "company_id"), Some(9));
    }

    #[test]
    fn opaque_credentials_hash_and_compare_without_plaintext_storage() {
        let hash = credential_hash("hub-secret");
        assert_eq!(hash.len(), 64);
        assert!(constant_time_eq(hash.as_bytes(), hash.as_bytes()));
        assert!(!constant_time_eq(
            hash.as_bytes(),
            credential_hash("other-secret").as_bytes()
        ));
    }
}
