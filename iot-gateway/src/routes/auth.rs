//! Authenticated HTTP scope for gateway user/device management requests.

use axum::{
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

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
}

impl AuthorizedTarget {
    pub(crate) fn organization_id(self) -> u64 {
        self.organization_id
    }
}

/// Verify the bearer token at SpacetimeDB, then authorize the target row's
/// organization and company through the actor's active membership.
pub(crate) async fn authorize_target(
    state: &AppState,
    headers: &HeaderMap,
    table: TargetTable,
    target_id: u64,
) -> Result<AuthorizedTarget, AuthError> {
    if target_id == 0 {
        return Err(AuthError::forbidden("target id must be greater than zero"));
    }
    let token = bearer_token(headers)?;
    let actor_client = state.stdb.with_token(token);
    let identity = actor_client
        .authenticated_identity()
        .await
        .map_err(|_| AuthError::unauthorized("invalid or unauthenticated SpacetimeDB token"))?;

    let (organization_id, company_id) = load_target_scope(state, table, target_id).await?;
    let membership_sql = format!(
        "SELECT organization_id, company_id, is_active FROM user_organization WHERE organization_id = {organization_id} AND user_identity = 0x{identity} AND is_active = true"
    );
    let membership = actor_client
        .query_sql(&membership_sql)
        .await
        .map_err(|error| AuthError::internal(error.to_string()))?
        .into_iter()
        .next()
        .ok_or_else(|| AuthError::forbidden("active organization membership required"))?;
    let membership_company = row_u64(&membership, "companyId", "company_id")
        .ok_or_else(|| AuthError::forbidden("active membership has no company scope"))?;
    if membership_company == 0 || membership_company != company_id {
        return Err(AuthError::forbidden(
            "actor is not a member of the target company",
        ));
    }

    Ok(AuthorizedTarget {
        organization_id,
        company_id,
    })
}

pub(crate) async fn enforce_target_scope(
    state: &AppState,
    table: TargetTable,
    target_id: u64,
    expected: AuthorizedTarget,
) -> Result<(), AuthError> {
    let (organization_id, company_id) = load_target_scope(state, table, target_id).await?;
    if organization_id != expected.organization_id || company_id != expected.company_id {
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
) -> Result<(u64, u64), AuthError> {
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
    if organization_id == 0 || company_id == 0 {
        return Err(AuthError::forbidden("target has invalid tenant scope"));
    }
    Ok((organization_id, company_id))
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
        format!("SELECT organization_id, company_id FROM {table} WHERE id = {id}")
    }
}

#[cfg(test)]
mod tests {
    use super::{bearer_token, row_u64};
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
}
