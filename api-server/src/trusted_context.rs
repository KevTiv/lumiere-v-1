//! Trusted authority for session-backed reducer operations.
//!
//! This context deliberately owns the client and all server-derived scope.
//! Callers cannot construct it from a token, organization id, or arbitrary
//! JSON map; the only interactive constructor accepts a resolved session.

use rand::{rngs::OsRng, RngCore};
use std::collections::BTreeSet;

use stdb_auth::FieldAccessContext;
use stdb_client::{ReducerContract, StdbClient};

use crate::{error::ApiError, session::ApiSession};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CompanyScope {
    OrganizationWide,
    Companies(Vec<u64>),
}

impl CompanyScope {
    pub(crate) fn from_ids(values: impl IntoIterator<Item = u64>) -> Result<Self, ApiError> {
        let mut ids = BTreeSet::new();
        for id in values {
            if id == 0 {
                return Err(invalid_context("company scope contains zero"));
            }
            ids.insert(id);
        }
        if ids.is_empty() {
            Ok(Self::OrganizationWide)
        } else {
            Ok(Self::Companies(ids.into_iter().collect()))
        }
    }

    #[cfg(test)]
    pub(crate) fn ids(&self) -> &[u64] {
        match self {
            Self::OrganizationWide => &[],
            Self::Companies(ids) => ids,
        }
    }
}

/// Authority for a session-backed reducer call.
pub(crate) struct TrustedOperationContext {
    client: StdbClient,
    actor_identity: String,
    organization_id: u64,
    field_access: FieldAccessContext,
    operation_id: &'static str,
    correlation_id: String,
    company_scope: CompanyScope,
}

impl TrustedOperationContext {
    /// Construct authority only from the session resolved by the auth boundary
    /// and a client carrying exactly that session's token.
    pub(crate) fn from_session(
        session: ApiSession,
        client: StdbClient,
        operation_id: &'static str,
    ) -> Result<Self, ApiError> {
        let organization_id = session
            .organization_id
            .ok_or_else(|| ApiError::Forbidden("session has no organization".into()))?;
        if organization_id == 0 {
            return Err(invalid_context(
                "session organization must be greater than zero",
            ));
        }
        if operation_id.trim().is_empty() {
            return Err(invalid_context(
                "operation contract identity must not be blank",
            ));
        }

        let actor_identity = normalize_identity(&session.identity_hex)?;
        let session_token = require_nonempty(session.stdb_token, "session token")?;
        if client.token() != session_token {
            return Err(invalid_context(
                "trusted client token does not match the resolved session",
            ));
        }

        let field_access = session
            .field_access
            .ok_or_else(|| ApiError::Forbidden("session has no field-access context".into()))?;
        if field_access.organization_id != organization_id {
            return Err(invalid_context(
                "field-access organization does not match the session",
            ));
        }
        if normalize_identity(&field_access.identity_hex)? != actor_identity {
            return Err(invalid_context(
                "field-access identity does not match the session",
            ));
        }

        Ok(Self {
            client,
            actor_identity,
            organization_id,
            field_access,
            operation_id,
            correlation_id: opaque_correlation_id(),
            company_scope: CompanyScope::OrganizationWide,
        })
    }

    pub(crate) fn client(&self) -> &StdbClient {
        &self.client
    }

    pub(crate) fn actor_identity(&self) -> &str {
        &self.actor_identity
    }

    pub(crate) fn organization_id(&self) -> u64 {
        self.organization_id
    }

    pub(crate) fn field_access(&self) -> &FieldAccessContext {
        &self.field_access
    }

    pub(crate) fn ensure_contract(
        &self,
        contract: &'static ReducerContract,
    ) -> Result<(), ApiError> {
        if self.operation_id == contract.contract_operation_id {
            Ok(())
        } else {
            Err(ApiError::Forbidden(
                "trusted operation context does not match reducer contract".into(),
            ))
        }
    }

    pub(crate) fn correlation_id(&self) -> &str {
        &self.correlation_id
    }

    #[cfg(test)]
    pub(crate) fn company_scope(&self) -> &CompanyScope {
        &self.company_scope
    }

    /// Record the server-resolved company scope before the reducer call.
    pub(crate) fn with_company_scope(mut self, ids: Vec<u64>) -> Result<Self, ApiError> {
        self.company_scope = CompanyScope::from_ids(ids)?;
        Ok(self)
    }

    pub(crate) fn require_company_scope(&self, ids: &[u64]) -> Result<(), ApiError> {
        let expected = CompanyScope::from_ids(ids.iter().copied())?;
        if self.company_scope == expected {
            Ok(())
        } else {
            Err(ApiError::Forbidden(
                "trusted company scope was not resolved for this reducer call".into(),
            ))
        }
    }
}

fn invalid_context(message: &str) -> ApiError {
    ApiError::BadRequest(format!("invalid trusted operation context: {message}"))
}

fn require_nonempty(value: String, field: &str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        Err(invalid_context(&format!("{field} must not be blank")))
    } else {
        Ok(value.to_owned())
    }
}

fn normalize_identity(value: &str) -> Result<String, ApiError> {
    let value = value.trim();
    let value = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .unwrap_or(value);
    if value.is_empty() {
        return Err(invalid_context("identity must not be blank"));
    }
    Ok(value.to_ascii_lowercase())
}

fn opaque_correlation_id() -> String {
    let mut bytes = [0_u8; 32];
    let mut rng = OsRng;
    rng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field_access(organization_id: u64, identity_hex: &str) -> FieldAccessContext {
        FieldAccessContext {
            organization_id,
            role_id: 1,
            role_name: "member".into(),
            is_superuser: false,
            role_permissions: Vec::new(),
            identity_hex: identity_hex.into(),
            field_permissions: Vec::new(),
        }
    }

    fn session(
        organization_id: Option<u64>,
        identity_hex: &str,
        field_access: Option<FieldAccessContext>,
    ) -> ApiSession {
        ApiSession {
            stdb_token: "session-token".into(),
            identity_hex: identity_hex.into(),
            organization_id,
            field_access,
        }
    }

    fn client(token: &str) -> StdbClient {
        StdbClient::new(
            "http://localhost:3000".into(),
            "lumiere-test".into(),
            token.into(),
        )
    }

    #[test]
    fn requires_matching_nonzero_session_and_field_access() {
        let context = TrustedOperationContext::from_session(
            session(Some(7), "0xABCD", Some(field_access(7, "abcd"))),
            client("session-token"),
            "erp.create_lead",
        )
        .expect("valid context");
        assert_eq!(context.organization_id(), 7);
        assert_eq!(context.actor_identity(), "abcd");

        for invalid in [
            session(None, "abcd", Some(field_access(7, "abcd"))),
            session(Some(0), "abcd", Some(field_access(0, "abcd"))),
            session(Some(7), "abcd", None),
            session(Some(7), "abcd", Some(field_access(8, "abcd"))),
            session(Some(7), "abcd", Some(field_access(7, "different"))),
        ] {
            assert!(TrustedOperationContext::from_session(
                invalid,
                client("session-token"),
                "erp.create_lead"
            )
            .is_err());
        }
    }

    #[test]
    fn rejects_client_token_mismatch_and_blank_operation() {
        let valid_session = session(Some(7), "abcd", Some(field_access(7, "abcd")));
        assert!(TrustedOperationContext::from_session(
            session(Some(7), "abcd", Some(field_access(7, "abcd"))),
            client("other-token"),
            "erp.create_lead"
        )
        .is_err());
        assert!(
            TrustedOperationContext::from_session(valid_session, client("session-token"), " ")
                .is_err()
        );
    }

    #[test]
    fn operation_identity_must_match_the_locked_contract() {
        let context = TrustedOperationContext::from_session(
            session(Some(7), "abcd", Some(field_access(7, "abcd"))),
            client("session-token"),
            "erp.create_lead",
        )
        .expect("valid context");
        let lead = stdb_client::reducer_contract("create_lead").expect("lead contract");
        let other = stdb_client::reducer_contract("create_task").expect("task contract");
        assert!(context.ensure_contract(lead).is_ok());
        assert!(context.ensure_contract(other).is_err());
    }

    #[test]
    fn company_scope_is_sorted_deduplicated_and_nonzero() {
        let context = TrustedOperationContext::from_session(
            session(Some(7), "abcd", Some(field_access(7, "abcd"))),
            client("session-token"),
            "erp.create_lead",
        )
        .expect("valid context")
        .with_company_scope(vec![9, 2, 9])
        .expect("company scope");
        assert_eq!(context.company_scope().ids(), &[2, 9]);
        assert!(context.require_company_scope(&[9, 2]).is_ok());
        assert!(context.with_company_scope(vec![0]).is_err());
    }

    #[test]
    fn correlation_is_server_generated_opaque_hex() {
        let context = TrustedOperationContext::from_session(
            session(Some(7), "abcd", Some(field_access(7, "abcd"))),
            client("session-token"),
            "erp.create_lead",
        )
        .expect("valid context");
        assert_eq!(context.correlation_id().len(), 64);
        assert!(context
            .correlation_id()
            .bytes()
            .all(|b| b.is_ascii_hexdigit()));
    }
}
