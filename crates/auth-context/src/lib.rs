//! Shared interactive actor transport. These headers describe a caller; they
//! authenticate nobody by themselves. Receivers must authenticate the sending
//! service and ask the session-owning API for current, scope-bound authority.
//! WorkOS verification, identity binding and native sessions stay in that API.

use http::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use std::{fmt, time::Duration};

pub const ACTOR_IDENTITY_HEADER: &str = "x-lumiere-actor-identity";
pub const ACTOR_TOKEN_HEADER: &str = "x-lumiere-actor-token";
pub const ORGANIZATION_HEADER: &str = "x-lumiere-organization-id";
pub const COMPANY_HEADER: &str = "x-lumiere-company-id";

#[derive(Clone, PartialEq, Eq)]
pub struct ActorContext {
    pub identity: String,
    /// API credential, including a WorkOS access token in hosted mode. Never
    /// use this as a native STDB credential or replace it with a service token.
    pub token: String,
    pub organization_id: u64,
    pub company_id: u64,
}

impl fmt::Debug for ActorContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ActorContext")
            .field("identity", &self.identity)
            .field("organization_id", &self.organization_id)
            .field("company_id", &self.company_id)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ActorContextError {
    #[error("acting-user context is required")]
    Missing,
    #[error("acting-user context is invalid")]
    Invalid,
    #[error("requested company does not match the acting-user scope")]
    CompanyMismatch,
}

impl ActorContext {
    pub fn new(
        identity: &str,
        token: &str,
        organization_id: u64,
        company_id: u64,
    ) -> Result<Self, ActorContextError> {
        let identity = identity.trim();
        let hex = identity
            .strip_prefix("0x")
            .or_else(|| identity.strip_prefix("0X"))
            .unwrap_or(identity);
        let token = token.trim();
        if hex.len() != 64
            || !hex.bytes().all(|byte| byte.is_ascii_hexdigit())
            || token.is_empty()
            || organization_id == 0
            || company_id == 0
            || HeaderValue::from_str(token).is_err()
        {
            return Err(ActorContextError::Invalid);
        }
        Ok(Self {
            identity: identity.into(),
            token: token.into(),
            organization_id,
            company_id,
        })
    }

    pub fn from_headers(headers: &HeaderMap) -> Result<Self, ActorContextError> {
        let required = |name| {
            let mut values = headers.get_all(name).iter();
            let value = values.next().ok_or(ActorContextError::Missing)?;
            if values.next().is_some() {
                return Err(ActorContextError::Invalid);
            }
            value
                .to_str()
                .ok()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .ok_or(ActorContextError::Invalid)
        };
        let id = |name| {
            required(name)?
                .parse::<u64>()
                .map_err(|_| ActorContextError::Invalid)
        };
        Self::new(
            required(ACTOR_IDENTITY_HEADER)?,
            required(ACTOR_TOKEN_HEADER)?,
            id(ORGANIZATION_HEADER)?,
            id(COMPANY_HEADER)?,
        )
    }

    pub fn require_company(&self, company_id: u64) -> Result<(), ActorContextError> {
        if self.company_id != company_id {
            return Err(ActorContextError::CompanyMismatch);
        }
        Ok(())
    }

    pub fn headers(&self) -> Result<HeaderMap, ActorContextError> {
        // Revalidate even if a caller constructed or modified public fields.
        Self::new(
            &self.identity,
            &self.token,
            self.organization_id,
            self.company_id,
        )?;
        let mut headers = HeaderMap::new();
        for (name, value) in [
            (ACTOR_IDENTITY_HEADER, self.identity.clone()),
            (ACTOR_TOKEN_HEADER, self.token.clone()),
            (ORGANIZATION_HEADER, self.organization_id.to_string()),
            (COMPANY_HEADER, self.company_id.to_string()),
        ] {
            headers.insert(
                name,
                HeaderValue::from_str(&value).map_err(|_| ActorContextError::Invalid)?,
            );
        }
        Ok(headers)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CapabilityGrant {
    pub capability_key: String,
    pub max_rows: u64,
    pub max_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CapabilityGrantEnvelope {
    pub organization_id: u64,
    pub company_id: u64,
    pub actor_identity: String,
    #[serde(default)]
    pub knowledge_team_refs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placement_generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy_snapshot_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_grants_hash: Option<String>,
    pub grants: Vec<CapabilityGrant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapabilityGrantBounds {
    pub max_rows: u64,
    pub max_bytes: u64,
}

impl CapabilityGrantEnvelope {
    pub fn matches_actor(&self, actor: &ActorContext) -> bool {
        self.organization_id == actor.organization_id
            && self.company_id == actor.company_id
            && self.actor_identity == actor.identity
    }

    /// Exact capability only. Duplicate grants can narrow limits, never widen them.
    pub fn bounds_for(
        &self,
        actor: &ActorContext,
        capability: &str,
    ) -> Option<CapabilityGrantBounds> {
        if !self.matches_actor(actor) {
            return None;
        }
        self.grants
            .iter()
            .filter(|g| g.capability_key == capability && g.max_rows > 0 && g.max_bytes > 0)
            .map(|g| CapabilityGrantBounds {
                max_rows: g.max_rows,
                max_bytes: g.max_bytes,
            })
            .reduce(|a, b| CapabilityGrantBounds {
                max_rows: a.max_rows.min(b.max_rows),
                max_bytes: a.max_bytes.min(b.max_bytes),
            })
    }

    pub fn permits(&self, actor: &ActorContext, capability: &str) -> bool {
        self.bounds_for(actor, capability).is_some()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AuthorityError {
    #[error("acting-user authorization is not permitted")]
    Denied,
    #[error("acting-user authorization is unavailable")]
    Unavailable,
}

/// No grant cache and no provider secrets: every call revalidates through the
/// API's configured auth authority and checks its echoed actor and tenant scope.
pub async fn fetch_capability_grants(
    http: &reqwest::Client,
    api_base: &str,
    actor: &ActorContext,
    timeout: Duration,
) -> Result<CapabilityGrantEnvelope, AuthorityError> {
    ActorContext::new(
        &actor.identity,
        &actor.token,
        actor.organization_id,
        actor.company_id,
    )
    .map_err(|_| AuthorityError::Denied)?;
    let response = http
        .get(format!(
            "{}/v1/ai/capability-grants",
            api_base.trim_end_matches('/')
        ))
        .query(&[("companyId", actor.company_id)])
        .bearer_auth(&actor.token)
        .header("x-stdb-identity", &actor.identity)
        .timeout(timeout)
        .send()
        .await
        .map_err(|_| AuthorityError::Unavailable)?;
    if !response.status().is_success() {
        return Err(if matches!(response.status().as_u16(), 401 | 403 | 404) {
            AuthorityError::Denied
        } else {
            AuthorityError::Unavailable
        });
    }
    let envelope: CapabilityGrantEnvelope = response
        .json()
        .await
        .map_err(|_| AuthorityError::Unavailable)?;
    if !envelope.matches_actor(actor) {
        return Err(AuthorityError::Denied);
    }
    Ok(envelope)
}

#[cfg(test)]
mod tests;
