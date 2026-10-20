//! Explicitly configured, read-only offline admission. Never a server bearer credential.
use super::{core::Scope, RESOURCE, SCHEMA_HASH};
use anyhow::{bail, Context, Result};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
#[cfg(test)]
use ring::signature::KeyPair;
use ring::{
    rand::SystemRandom,
    signature::{EcdsaKeyPair, ECDSA_P256_SHA256_FIXED_SIGNING},
};
use serde::Serialize;
use std::{
    fmt,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_GRANT_SECONDS: u64 = 86_400;
pub struct OfflineGrantSigner {
    key: EcdsaKeyPair,
    key_id: String,
    deployment_id: String,
    audience: String,
    lifetime_seconds: u64,
}
// Config derives Debug; private key material must never enter logs.
impl fmt::Debug for OfflineGrantSigner {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OfflineGrantSigner")
            .field("key_id", &self.key_id)
            .field("deployment_id", &self.deployment_id)
            .field("audience", &self.audience)
            .field("lifetime_seconds", &self.lifetime_seconds)
            .finish_non_exhaustive()
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Claims<'a> {
    version: u8,
    resource: &'static str,
    deployment_id: &'a str,
    audience: &'a str,
    schema_hash: &'static str,
    scope: &'a Scope,
    issued_at: u64,
    expires_at: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedOfflineGrant {
    version: u8,
    algorithm: &'static str,
    key_id: String,
    payload: String,
    signature: String,
}
fn valid_label(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}
impl OfflineGrantSigner {
    pub fn new(
        pkcs8: &[u8],
        key_id: String,
        deployment_id: String,
        audience: String,
        lifetime_seconds: u64,
    ) -> Result<Self> {
        if !valid_label(&key_id)
            || !valid_label(&deployment_id)
            || !(1..=MAX_GRANT_SECONDS).contains(&lifetime_seconds)
        {
            bail!("invalid offline grant key/deployment identifier or lifetime");
        }
        let url = url::Url::parse(&audience).context("offline grant audience must be an origin")?;
        let localhost = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if audience != url.origin().ascii_serialization()
            || !(url.scheme() == "https" || (url.scheme() == "http" && localhost))
        {
            bail!("offline grant audience must be an HTTPS origin (localhost HTTP is allowed)");
        }
        let key = EcdsaKeyPair::from_pkcs8(
            &ECDSA_P256_SHA256_FIXED_SIGNING,
            pkcs8,
            &SystemRandom::new(),
        )
        .map_err(|_| anyhow::anyhow!("invalid offline grant P-256 PKCS8 key"))?;
        Ok(Self {
            key,
            key_id,
            deployment_id,
            audience,
            lifetime_seconds,
        })
    }
    /// Partially configured issuance is a startup error; no keys are generated as fallback.
    pub fn from_env() -> Result<Option<Arc<Self>>> {
        Self::from_values(|name| std::env::var(name).ok())
    }
    fn from_values(read: impl Fn(&str) -> Option<String>) -> Result<Option<Arc<Self>>> {
        const NAMES: [&str; 5] = [
            "LUMIERE_OFFLINE_GRANT_PKCS8_BASE64",
            "LUMIERE_OFFLINE_GRANT_KEY_ID",
            "LUMIERE_OFFLINE_GRANT_DEPLOYMENT_ID",
            "LUMIERE_OFFLINE_GRANT_AUDIENCE",
            "LUMIERE_OFFLINE_GRANT_TTL_SECS",
        ];
        let values = NAMES.map(|name| read(name));
        if values.iter().all(Option::is_none) {
            return Ok(None);
        }
        let mut supplied = Vec::with_capacity(values.len());
        for (index, value) in values.into_iter().enumerate() {
            supplied.push(value.filter(|value| !value.is_empty()).with_context(|| {
                format!(
                    "{} is required when offline grants are enabled",
                    NAMES[index]
                )
            })?);
        }
        if supplied[0].len() > 16_384 {
            bail!("offline grant key is too large");
        }
        let key = STANDARD
            .decode(&supplied[0])
            .context("invalid offline grant key encoding")?;
        let ttl = supplied[4]
            .parse::<u64>()
            .context("invalid offline grant lifetime")?;
        Ok(Some(Arc::new(Self::new(
            &key,
            supplied[1].clone(),
            supplied[2].clone(),
            supplied[3].clone(),
            ttl,
        )?)))
    }
    pub fn issue(&self, scope: &Scope) -> Result<SignedOfflineGrant> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("offline grant server clock precedes epoch")?
            .as_secs();
        self.issue_at(scope, now)
    }
    fn issue_at(&self, scope: &Scope, now: u64) -> Result<SignedOfflineGrant> {
        let expires_at = now
            .checked_add(self.lifetime_seconds)
            .context("offline grant expiry overflow")?;
        let claims = Claims {
            version: 1,
            resource: RESOURCE,
            deployment_id: &self.deployment_id,
            audience: &self.audience,
            schema_hash: SCHEMA_HASH,
            scope,
            issued_at: now,
            expires_at,
        };
        let bytes = serde_json::to_vec(&claims)?;
        if bytes.len() > 3000 {
            bail!("offline grant claims exceed protocol limit");
        }
        let payload = URL_SAFE_NO_PAD.encode(bytes);
        let message = format!(
            "lumiere-offline-category-grant-v1.{}.{}",
            self.key_id, payload
        );
        let signature = self
            .key
            .sign(&SystemRandom::new(), message.as_bytes())
            .map_err(|_| anyhow::anyhow!("offline grant signing failed"))?;
        Ok(SignedOfflineGrant {
            version: 1,
            algorithm: "ES256",
            key_id: self.key_id.clone(),
            payload,
            signature: URL_SAFE_NO_PAD.encode(signature.as_ref()),
        })
    }
    #[cfg(test)]
    fn public_key(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.key.public_key().as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{UnparsedPublicKey, ECDSA_P256_SHA256_FIXED};
    fn scope() -> Scope {
        Scope {
            environment_id: "env".into(),
            actor_id: "actor-a".into(),
            organization_id: "7".into(),
            company_id: Some("9".into()),
            authorization_version: "auth-1".into(),
        }
    }
    fn key() -> Vec<u8> {
        EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &SystemRandom::new())
            .unwrap()
            .as_ref()
            .to_vec()
    }
    #[test]
    fn signer_binds_exact_scope_resource_deployment_origin_schema_and_lifetime() {
        let signer = OfflineGrantSigner::new(
            &key(),
            "k1".into(),
            "test-deployment".into(),
            "https://erp.example".into(),
            3600,
        )
        .unwrap();
        let grant = signer.issue_at(&scope(), 1_700_000_000).unwrap();
        let claims: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(&grant.payload).unwrap()).unwrap();
        assert_eq!(claims["scope"], serde_json::to_value(scope()).unwrap());
        assert_eq!(claims["resource"], RESOURCE);
        assert_eq!(claims["schemaHash"], SCHEMA_HASH);
        assert_eq!(claims["deploymentId"], "test-deployment");
        assert_eq!(claims["audience"], "https://erp.example");
        assert_eq!(
            claims["expiresAt"].as_u64().unwrap() - claims["issuedAt"].as_u64().unwrap(),
            3600
        );
        let signature = URL_SAFE_NO_PAD.decode(&grant.signature).unwrap();
        assert_eq!(signature.len(), 64);
        let message = format!(
            "lumiere-offline-category-grant-v1.{}.{}",
            grant.key_id, grant.payload
        );
        let public = URL_SAFE_NO_PAD.decode(signer.public_key()).unwrap();
        UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, &public)
            .verify(message.as_bytes(), &signature)
            .unwrap();
        assert!(UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, &public)
            .verify(b"tampered", &signature)
            .is_err());
        if let Ok(file) = std::env::var("LUMIERE_TEST_GRANT_VECTOR") {
            std::fs::write(
                file,
                serde_json::to_vec(
                    &serde_json::json!({"publicKey": signer.public_key(), "grant": grant}),
                )
                .unwrap(),
            )
            .unwrap();
        }
    }
    #[test]
    fn disabled_and_partial_configuration_are_distinct() {
        assert!(OfflineGrantSigner::from_values(|_| None).unwrap().is_none());
        assert!(OfflineGrantSigner::from_values(
            |name| (name.ends_with("KEY_ID")).then(|| "k1".into())
        )
        .is_err());
    }
    #[test]
    fn invalid_key_labels_origin_and_unbounded_lifetime_fail_closed() {
        let key = key();
        for (id, deployment, audience, ttl) in [
            ("bad key", "d", "https://erp.example", 60),
            ("k", "", "https://erp.example", 60),
            ("k", "d", "http://erp.example", 60),
            ("k", "d", "https://erp.example/path", 60),
            ("k", "d", "https://user@erp.example", 60),
            ("k", "d", "https://erp.example", 0),
            ("k", "d", "https://erp.example", MAX_GRANT_SECONDS + 1),
        ] {
            assert!(OfflineGrantSigner::new(
                &key,
                id.into(),
                deployment.into(),
                audience.into(),
                ttl
            )
            .is_err());
        }
        assert!(OfflineGrantSigner::new(
            b"invalid",
            "k".into(),
            "d".into(),
            "https://erp.example".into(),
            60
        )
        .is_err());
        let signer = OfflineGrantSigner::new(
            &key,
            "k".into(),
            "d".into(),
            "http://127.0.0.1:4179".into(),
            60,
        )
        .unwrap();
        assert!(signer.issue_at(&scope(), u64::MAX).is_err());
        assert!(!format!("{signer:?}").contains(&STANDARD.encode(key)));
    }
}
