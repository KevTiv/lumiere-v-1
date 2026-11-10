//! Interactive setup goes through the session-owning API. A hosted WorkOS
//! credential is never a native database credential, including for catalog reads.

use std::time::Duration;

use anyhow::Result;
use async_trait::async_trait;
use lumiere_auth_context::ORGANIZATION_HEADER;
use reqwest::{Client, Response, StatusCode, Url};
use serde::Deserialize;
use serde_json::json;
use stdb_auth::{permission_allowed, FieldAccessContext};
use stdb_client::{ReducerCall, StdbClient};

use super::surface_provisioning::{
    provision_generation_surfaces, ProvisionedSurface, SurfaceWriter,
};
use crate::error::AppError;

const CREATE_OPERATION: &str = "erp.create_ai_skill";
const MAX_SESSION_BYTES: usize = 1_048_576;
const MAX_OPERATION_BYTES: usize = 16_384;

#[derive(Clone, Copy, Debug)]
pub(crate) enum ApiStage {
    Session,
    Create,
}

impl std::fmt::Display for ApiStage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Session => "session verification",
            Self::Create => "skill registration",
        })
    }
}

/// Status and stage are safe to report. Upstream response bodies and credentials
/// are deliberately excluded; a transport source is retained for diagnostics.
#[derive(Debug, thiserror::Error)]
pub(crate) enum ApiSurfaceError {
    #[error("AI skill setup requires a configured API service")]
    NotConfigured,
    #[error("AI skill setup requires a trusted API service origin")]
    InvalidOrigin,
    #[error("AI skill setup organization does not match the authenticated session")]
    ScopeMismatch,
    #[error("AI skill setup requires ai_skill:create permission for this organization")]
    PermissionDenied,
    #[error("AI skill setup {stage} was rejected by the API (HTTP {status})")]
    Rejected { stage: ApiStage, status: u16 },
    #[error("AI skill setup {stage} is unavailable; inspect setup before retrying")]
    Transport {
        stage: ApiStage,
        #[source]
        source: reqwest::Error,
    },
    #[error("AI skill setup {stage} returned an invalid response; inspect setup before retrying")]
    InvalidResponse { stage: ApiStage },
    #[error("AI skill setup create operation does not match the authorized scope")]
    InvalidCreate,
}

pub(crate) fn setup_error(error: anyhow::Error) -> AppError {
    let Some(cause) = error.downcast_ref::<ApiSurfaceError>() else {
        // Catalog errors already have controlled, non-sensitive context. Do not
        // expose the database response body by formatting the full error chain.
        return AppError::Internal(error.to_string());
    };
    let message = if error.to_string() == cause.to_string() {
        cause.to_string()
    } else {
        format!("{error}: {cause}")
    };
    match cause {
        ApiSurfaceError::ScopeMismatch
        | ApiSurfaceError::PermissionDenied
        | ApiSurfaceError::Rejected {
            status: 401 | 403, ..
        } => AppError::Forbidden(message),
        ApiSurfaceError::Rejected { status: 429, .. } => AppError::RateLimitExceeded(message),
        ApiSurfaceError::Rejected {
            status: 400 | 409 | 422,
            ..
        } => AppError::BadRequest(message),
        ApiSurfaceError::InvalidCreate => AppError::Internal(message),
        _ => AppError::Unavailable(message),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiSession {
    identity_hex: String,
    organization_id: u64,
    field_access: FieldAccessContext,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationReceipt {
    ok: bool,
    operation_id: String,
    correlation_id: String,
}

#[derive(Deserialize)]
struct OperationError {
    error: String,
}

/// Constructed only after session scope and create permission have been verified,
/// including when every bundled surface already exists and setup is a no-op.
pub(crate) struct ApiSurfaceWriter<'a> {
    http: Client,
    origin: Url,
    api_token: &'a str,
    identity: String,
    organization_id: u64,
    is_superuser: bool,
}

impl<'a> ApiSurfaceWriter<'a> {
    pub(crate) fn require_platform_admin(&self) -> Result<()> {
        if !self.is_superuser {
            anyhow::bail!("platform administrator required");
        }
        Ok(())
    }

    /// Keep the native catalog read bound to the organization authorized during
    /// construction; callers cannot supply a different scope for a no-op setup.
    pub(crate) async fn provision(&self, reader: &StdbClient) -> Result<Vec<ProvisionedSurface>> {
        provision_generation_surfaces(self, reader, self.organization_id).await
    }

    /// Apply defaults through the same actor-authorized operation bridge.
    pub(crate) async fn provision_company_defaults(
        &self,
        company_id: u64,
        agent_id: u64,
        intelligence_policy_ref: &str,
    ) -> Result<()> {
        self.company_operation(
            "erp.provision_ai_company_defaults",
            json!({
                "companyId": company_id,
                "agentId": agent_id,
                "intelligencePolicyRef": intelligence_policy_ref,
            }),
        )
        .await
    }

    /// Enrollment selects the platform-approved template inside the reducer.
    pub(crate) async fn enroll_company_defaults(&self, company_id: u64) -> Result<()> {
        self.company_operation(
            "erp.enroll_ai_company_defaults",
            json!({"companyId": company_id}),
        )
        .await
    }

    pub(crate) async fn company_operation(
        &self,
        operation: &str,
        payload: serde_json::Value,
    ) -> Result<()> {
        let mut url = self.origin.clone();
        url.set_path(&format!("/v1/operations/{operation}"));
        let response = self
            .http
            .post(url)
            .bearer_auth(self.api_token)
            .header("x-stdb-identity", &self.identity)
            .header(ORGANIZATION_HEADER, self.organization_id)
            .json(&payload)
            .send()
            .await
            .map_err(|source| ApiSurfaceError::Transport {
                stage: ApiStage::Create,
                source,
            })?;
        if response.status() != StatusCode::OK {
            return Err(ApiSurfaceError::Rejected {
                stage: ApiStage::Create,
                status: response.status().as_u16(),
            }
            .into());
        }
        let bytes = bounded_response(response, ApiStage::Create, MAX_OPERATION_BYTES).await?;
        let receipt: OperationReceipt =
            serde_json::from_slice(&bytes).map_err(|_| ApiSurfaceError::InvalidResponse {
                stage: ApiStage::Create,
            })?;
        if !receipt.ok
            || receipt.operation_id != operation
            || receipt.correlation_id.trim().is_empty()
        {
            return Err(ApiSurfaceError::InvalidResponse {
                stage: ApiStage::Create,
            }
            .into());
        }
        Ok(())
    }

    pub(crate) async fn authorize(
        api_origin: Option<&str>,
        api_token: &'a str,
        organization_id: u64,
    ) -> Result<Self> {
        let origin = trusted_origin(api_origin.ok_or(ApiSurfaceError::NotConfigured)?)?;
        let http = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .map_err(|source| ApiSurfaceError::Transport {
                stage: ApiStage::Session,
                source,
            })?;
        let mut session_url = origin.clone();
        session_url.set_path("/v1/session/field-access");
        let response = http
            .get(session_url)
            .bearer_auth(api_token)
            .send()
            .await
            .map_err(|source| ApiSurfaceError::Transport {
                stage: ApiStage::Session,
                source,
            })?;
        if response.status() != StatusCode::OK {
            return Err(ApiSurfaceError::Rejected {
                stage: ApiStage::Session,
                status: response.status().as_u16(),
            }
            .into());
        }
        let bytes = bounded_response(response, ApiStage::Session, MAX_SESSION_BYTES).await?;
        let session: ApiSession =
            serde_json::from_slice(&bytes).map_err(|_| ApiSurfaceError::InvalidResponse {
                stage: ApiStage::Session,
            })?;
        if organization_id == 0
            || session.organization_id != organization_id
            || session.field_access.organization_id != organization_id
            || session.identity_hex.trim().is_empty()
            || session.identity_hex != session.field_access.identity_hex
        {
            return Err(ApiSurfaceError::ScopeMismatch.into());
        }
        if !permission_allowed(&session.field_access, "ai_skill", "create") {
            return Err(ApiSurfaceError::PermissionDenied.into());
        }
        Ok(Self {
            http,
            origin,
            api_token,
            identity: session.identity_hex,
            organization_id,
            is_superuser: session.field_access.is_superuser,
        })
    }
}

fn trusted_origin(raw: &str) -> Result<Url, ApiSurfaceError> {
    let url = Url::parse(raw).map_err(|_| ApiSurfaceError::InvalidOrigin)?;
    let trusted_http = url.host_str().is_some_and(|host| {
        host == "localhost"
            || host == "127.0.0.1"
            || host == "[::1]"
            || host == "api-server"
            || host.ends_with(".railway.internal")
    });
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || !(url.scheme() == "https" || (url.scheme() == "http" && trusted_http))
    {
        return Err(ApiSurfaceError::InvalidOrigin);
    }
    Ok(url)
}

async fn bounded_response(
    mut response: Response,
    stage: ApiStage,
    max_bytes: usize,
) -> Result<Vec<u8>, ApiSurfaceError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(ApiSurfaceError::InvalidResponse { stage });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|source| ApiSurfaceError::Transport { stage, source })?
    {
        if chunk.len() > max_bytes - bytes.len() {
            return Err(ApiSurfaceError::InvalidResponse { stage });
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[async_trait]
impl SurfaceWriter for ApiSurfaceWriter<'_> {
    async fn create_surface(&self, skill_key: &str, create: ReducerCall) -> Result<bool> {
        let [organization_id, params] = create.args() else {
            return Err(ApiSurfaceError::InvalidCreate.into());
        };
        if create.contract().contract_operation_id != CREATE_OPERATION
            || organization_id.as_u64() != Some(self.organization_id)
            || params["skill_key"].as_str() != Some(skill_key)
        {
            return Err(ApiSurfaceError::InvalidCreate.into());
        }
        let mut operation_url = self.origin.clone();
        operation_url.set_path("/v1/operations/erp.create_ai_skill");
        let response = self
            .http
            .post(operation_url)
            .bearer_auth(self.api_token)
            .header("x-stdb-identity", &self.identity)
            // The API checks this against its freshly resolved session before
            // dispatch, closing an organization switch after the preflight.
            .header(ORGANIZATION_HEADER, self.organization_id)
            .json(&json!({ "params": params }))
            .send()
            .await
            .map_err(|source| ApiSurfaceError::Transport {
                stage: ApiStage::Create,
                source,
            })?;
        let status = response.status();
        if status == StatusCode::UNPROCESSABLE_ENTITY {
            let bytes = bounded_response(response, ApiStage::Create, MAX_OPERATION_BYTES).await?;
            let duplicate = serde_json::from_slice::<OperationError>(&bytes).is_ok_and(|error| {
                error
                    .error
                    .contains(&format!("skill_key '{skill_key}' already exists"))
            });
            if duplicate {
                // The shared state machine still requires an organization-owned
                // readback. No uncertain response is treated as a duplicate.
                return Ok(false);
            }
        } else if status == StatusCode::OK {
            let bytes = bounded_response(response, ApiStage::Create, MAX_OPERATION_BYTES).await?;
            let receipt: OperationReceipt =
                serde_json::from_slice(&bytes).map_err(|_| ApiSurfaceError::InvalidResponse {
                    stage: ApiStage::Create,
                })?;
            if receipt.ok
                && receipt.operation_id == CREATE_OPERATION
                && !receipt.correlation_id.trim().is_empty()
            {
                return Ok(true);
            }
            return Err(ApiSurfaceError::InvalidResponse {
                stage: ApiStage::Create,
            }
            .into());
        }
        Err(ApiSurfaceError::Rejected {
            stage: ApiStage::Create,
            status: status.as_u16(),
        }
        .into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_requires_a_fixed_trusted_api_origin() {
        for origin in [
            "https://api.example.test",
            "http://api-server:8082",
            "http://api-server.railway.internal:8080/",
            "http://127.0.0.1:8080",
            "http://[::1]:8080",
        ] {
            assert!(trusted_origin(origin).is_ok(), "{origin}");
        }
        for origin in [
            "http://api.example.test",
            "https://user:password@api.example.test",
            "https://api.example.test/?token=secret",
            "https://api.example.test/#fragment",
            "https://api.example.test/other-service",
        ] {
            assert!(trusted_origin(origin).is_err(), "{origin}");
        }
    }
}

#[cfg(test)]
mod platform_authority_tests {
    use super::*;

    #[test]
    fn tenant_configuration_permission_does_not_grant_platform_authority() {
        let mut writer = ApiSurfaceWriter {
            http: Client::new(),
            origin: Url::parse("http://localhost:3000").unwrap(),
            api_token: "test-session",
            identity: "test-actor".into(),
            organization_id: 7,
            is_superuser: false,
        };
        assert!(writer.require_platform_admin().is_err());
        writer.is_superuser = true;
        assert!(writer.require_platform_admin().is_ok());
    }
}
