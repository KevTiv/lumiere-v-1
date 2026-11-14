//! Actor-specific skill checks are owned by the API's session authority.

use std::{sync::OnceLock, time::Duration};

use lumiere_auth_context::ActorContext;
use serde::Deserialize;

use crate::{error::AppError, state::AppState};

static AUTHORITY_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

#[derive(Clone, Copy, Debug, thiserror::Error)]
pub(crate) enum SkillAccessError {
    #[error("You do not have access to this AI skill. Contact an organization administrator.")]
    Denied,
    #[error("AI skill access could not be verified. Try again later.")]
    Unavailable,
}

impl From<SkillAccessError> for AppError {
    fn from(error: SkillAccessError) -> Self {
        match error {
            SkillAccessError::Denied => Self::Forbidden(error.to_string()),
            SkillAccessError::Unavailable => Self::Unavailable(error.to_string()),
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SkillAccessResponse {
    organization_id: u64,
    company_id: u64,
    actor_identity: String,
    skill_key: String,
    allowed: bool,
}

impl SkillAccessResponse {
    fn authorize(&self, actor: &ActorContext, skill_key: &str) -> Result<(), SkillAccessError> {
        if self.allowed
            && self.organization_id == actor.organization_id
            && self.company_id == actor.company_id
            && unprefixed_identity(&self.actor_identity)
                .eq_ignore_ascii_case(unprefixed_identity(&actor.identity))
            && self.skill_key == skill_key
        {
            Ok(())
        } else {
            Err(SkillAccessError::Denied)
        }
    }
}

fn unprefixed_identity(identity: &str) -> &str {
    identity
        .strip_prefix("0x")
        .or_else(|| identity.strip_prefix("0X"))
        .unwrap_or(identity)
}

/// Always reauthenticate the current human user. The selected AI persona is
/// never interpreted as the user, and a previous successful check is not cached.
pub(crate) struct ActorSkillAccess<'a> {
    state: &'a AppState,
    actor: ActorContext,
}

impl<'a> ActorSkillAccess<'a> {
    pub(crate) fn new(
        state: &'a AppState,
        organization_id: u64,
        company_id: u64,
        token: &str,
        identity: &str,
    ) -> Result<Self, SkillAccessError> {
        let actor = ActorContext::new(identity, token, organization_id, company_id)
            .map_err(|_| SkillAccessError::Denied)?;
        Ok(Self { state, actor })
    }

    pub(crate) async fn require(&self, skill_key: &str) -> Result<(), SkillAccessError> {
        let api_base = self
            .state
            .config
            .api_server_url
            .as_deref()
            .ok_or(SkillAccessError::Unavailable)?;
        let client = AUTHORITY_CLIENT.get_or_init(|| {
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("construct skill authority HTTP client")
        });
        let company_id = self.actor.company_id.to_string();
        let response = client
            .get(format!(
                "{}/v1/ai/skills/access/check",
                api_base.trim_end_matches('/')
            ))
            .query(&[("companyId", company_id.as_str()), ("skillKey", skill_key)])
            .bearer_auth(&self.actor.token)
            .header("x-stdb-identity", &self.actor.identity)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|_| SkillAccessError::Unavailable)?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                401 | 403 => SkillAccessError::Denied,
                _ => SkillAccessError::Unavailable,
            });
        }

        response
            .json::<SkillAccessResponse>()
            .await
            .map_err(|_| SkillAccessError::Unavailable)?
            .authorize(&self.actor, skill_key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn skill_access_uses_exact_scope_actor_and_key() {
        let identity = "a".repeat(64);
        let actor = ActorContext::new(&identity, "session", 17, 23).unwrap();
        let response = json!({
            "organizationId": 17,
            "companyId": 23,
            "actorIdentity": format!("0x{}", identity.to_uppercase()),
            "skillKey": "rag_generation",
            "allowed": true,
        });
        let evaluate = |value| {
            serde_json::from_value::<SkillAccessResponse>(value)
                .unwrap()
                .authorize(&actor, "rag_generation")
        };
        assert!(evaluate(response.clone()).is_ok());
        for (field, replacement) in [
            ("organizationId", json!(18)),
            ("companyId", json!(24)),
            ("actorIdentity", json!("b".repeat(64))),
            ("skillKey", json!("form_suggestion")),
            ("allowed", json!(false)),
        ] {
            let mut mismatched = response.clone();
            mismatched[field] = replacement;
            assert!(matches!(
                evaluate(mismatched),
                Err(SkillAccessError::Denied)
            ));
        }
    }
}
