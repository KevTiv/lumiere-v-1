//! Sealed, server-derived execution authority for the governed runtime.
//!
//! This module does not decide policy. Callers first resolve current actor and
//! organization policy through the existing authorization and policy engines,
//! then seal that result here. A child envelope can only narrow every set-valued
//! dimension and can never change its actor or tenant. Verification is required
//! at each privileged boundary and fails closed when the seal, generation, or
//! validity interval is no longer current.

use std::{collections::BTreeSet, fmt};

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::harness::manifest::Capability;

const ENVELOPE_VERSION: u8 = 1;
const SHA256_BLOCK_BYTES: usize = 64;
const MAX_SCOPE_VALUES: usize = 64;
const MAX_SCOPE_VALUE_BYTES: usize = 128;
const MAX_ACTOR_IDENTITY_BYTES: usize = 256;
const MAX_DERIVATION_DEPTH: u8 = 16;
/// An envelope is a short-lived cache of an authorization decision, not a
/// durable grant. Long-running work must obtain a fresh, reauthorized envelope.
pub(crate) const MAX_ENVELOPE_LIFETIME_SECONDS: i64 = 24 * 60 * 60;

/// Policy dimensions that further restrict the actor and tenant authority.
///
/// Values are identifiers resolved by the existing policy sources. They are
/// intentionally not interpreted here: doing so would create a second policy
/// engine. Deterministic sets make subset checks and sealing unambiguous.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionRestrictions {
    data_classes: BTreeSet<String>,
    regions: BTreeSet<String>,
    processors: BTreeSet<String>,
    runtimes: BTreeSet<String>,
    disclosures: BTreeSet<String>,
    retentions: BTreeSet<String>,
}

impl ExecutionRestrictions {
    pub(crate) fn new(
        data_classes: impl IntoIterator<Item = impl Into<String>>,
        regions: impl IntoIterator<Item = impl Into<String>>,
        processors: impl IntoIterator<Item = impl Into<String>>,
        runtimes: impl IntoIterator<Item = impl Into<String>>,
        disclosures: impl IntoIterator<Item = impl Into<String>>,
        retentions: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        Self {
            data_classes: string_set(data_classes),
            regions: string_set(regions),
            processors: string_set(processors),
            runtimes: string_set(runtimes),
            disclosures: string_set(disclosures),
            retentions: string_set(retentions),
        }
    }

    pub(crate) fn data_classes(&self) -> &BTreeSet<String> {
        &self.data_classes
    }

    pub(crate) fn regions(&self) -> &BTreeSet<String> {
        &self.regions
    }

    pub(crate) fn processors(&self) -> &BTreeSet<String> {
        &self.processors
    }

    pub(crate) fn runtimes(&self) -> &BTreeSet<String> {
        &self.runtimes
    }

    pub(crate) fn disclosures(&self) -> &BTreeSet<String> {
        &self.disclosures
    }

    pub(crate) fn retentions(&self) -> &BTreeSet<String> {
        &self.retentions
    }

    fn validate(&self) -> Result<(), EnvelopeError> {
        validate_dimension("data classes", &self.data_classes)?;
        validate_dimension("regions", &self.regions)?;
        validate_dimension("processors", &self.processors)?;
        validate_dimension("runtimes", &self.runtimes)?;
        validate_dimension("disclosures", &self.disclosures)?;
        validate_dimension("retentions", &self.retentions)
    }

    fn ensure_subset_of(&self, parent: &Self) -> Result<(), EnvelopeError> {
        ensure_subset("data classes", &self.data_classes, &parent.data_classes)?;
        ensure_subset("regions", &self.regions, &parent.regions)?;
        ensure_subset("processors", &self.processors, &parent.processors)?;
        ensure_subset("runtimes", &self.runtimes, &parent.runtimes)?;
        ensure_subset("disclosures", &self.disclosures, &parent.disclosures)?;
        ensure_subset("retentions", &self.retentions, &parent.retentions)
    }
}

/// Exact server-derived authority associated with one actor and tenant.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrustedExecutionScope {
    actor_identity: String,
    organization_id: u64,
    company_id: u64,
    capabilities: BTreeSet<Capability>,
    restrictions: ExecutionRestrictions,
}

impl TrustedExecutionScope {
    pub(crate) fn new(
        actor_identity: impl Into<String>,
        organization_id: u64,
        company_id: u64,
        capabilities: impl IntoIterator<Item = Capability>,
        restrictions: ExecutionRestrictions,
    ) -> Result<Self, EnvelopeError> {
        let scope = Self {
            actor_identity: actor_identity.into(),
            organization_id,
            company_id,
            capabilities: capabilities.into_iter().collect(),
            restrictions,
        };
        scope.validate()?;
        Ok(scope)
    }

    pub(crate) fn actor_identity(&self) -> &str {
        &self.actor_identity
    }

    pub(crate) fn organization_id(&self) -> u64 {
        self.organization_id
    }

    pub(crate) fn company_id(&self) -> u64 {
        self.company_id
    }

    pub(crate) fn capabilities(&self) -> &BTreeSet<Capability> {
        &self.capabilities
    }

    pub(crate) fn restrictions(&self) -> &ExecutionRestrictions {
        &self.restrictions
    }

    pub(crate) fn permits(&self, capability: Capability) -> bool {
        self.capabilities.contains(&capability)
    }

    fn validate(&self) -> Result<(), EnvelopeError> {
        validate_identifier(
            "actor identity",
            &self.actor_identity,
            MAX_ACTOR_IDENTITY_BYTES,
        )?;
        if self.organization_id == 0 || self.company_id == 0 {
            return Err(EnvelopeError::InvalidScope(
                "organization and company must be nonzero",
            ));
        }
        if self.capabilities.is_empty() || self.capabilities.len() > MAX_SCOPE_VALUES {
            return Err(EnvelopeError::InvalidScope(
                "capability scope must be nonempty and bounded",
            ));
        }
        self.restrictions.validate()
    }

    fn ensure_subset_of(&self, parent: &Self) -> Result<(), EnvelopeError> {
        if self.actor_identity != parent.actor_identity {
            return Err(EnvelopeError::ScopeWidened("actor identity"));
        }
        if self.organization_id != parent.organization_id {
            return Err(EnvelopeError::ScopeWidened("organization"));
        }
        if self.company_id != parent.company_id {
            return Err(EnvelopeError::ScopeWidened("company"));
        }
        if !self.capabilities.is_subset(&parent.capabilities) {
            return Err(EnvelopeError::ScopeWidened("capabilities"));
        }
        self.restrictions.ensure_subset_of(&parent.restrictions)
    }
}

#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopePayload {
    version: u8,
    authorization_generation: u64,
    issued_at_epoch_seconds: i64,
    expires_at_epoch_seconds: i64,
    derivation_depth: u8,
    scope: TrustedExecutionScope,
}

/// A sealed snapshot of current execution authority.
///
/// Fields and the seal are private so ordinary runtime code cannot construct or
/// mutate trusted authority. `Serialize` supports audit persistence; there is no
/// `Deserialize` implementation because untrusted wire input is never authority.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrustedExecutionEnvelope {
    payload: EnvelopePayload,
    seal: [u8; 32],
}

impl fmt::Debug for TrustedExecutionEnvelope {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedExecutionEnvelope")
            .field(
                "authorization_generation",
                &self.payload.authorization_generation,
            )
            .field(
                "issued_at_epoch_seconds",
                &self.payload.issued_at_epoch_seconds,
            )
            .field(
                "expires_at_epoch_seconds",
                &self.payload.expires_at_epoch_seconds,
            )
            .field("derivation_depth", &self.payload.derivation_depth)
            .field("scope", &self.payload.scope)
            .field("seal", &"[redacted]")
            .finish()
    }
}

impl TrustedExecutionEnvelope {
    pub(crate) fn scope(&self) -> &TrustedExecutionScope {
        &self.payload.scope
    }

    pub(crate) fn authorization_generation(&self) -> u64 {
        self.payload.authorization_generation
    }

    pub(crate) fn expires_at_epoch_seconds(&self) -> i64 {
        self.payload.expires_at_epoch_seconds
    }

    pub(crate) fn derivation_depth(&self) -> u8 {
        self.payload.derivation_depth
    }
}

/// Holds process-local sealing authority supplied from trusted server config.
pub(crate) struct ExecutionEnvelopeAuthority {
    signing_key: [u8; 32],
}

impl fmt::Debug for ExecutionEnvelopeAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExecutionEnvelopeAuthority")
            .field("signing_key", &"[redacted]")
            .finish()
    }
}

impl ExecutionEnvelopeAuthority {
    /// Creates sealing authority from at least 256 bits of server-only keying
    /// material. The key must never originate in a model request or client body.
    pub(crate) fn new(server_key: &[u8]) -> Result<Self, EnvelopeError> {
        if server_key.len() < 32 {
            return Err(EnvelopeError::WeakSigningKey);
        }
        Ok(Self {
            signing_key: Sha256::digest(server_key).into(),
        })
    }

    /// Seals a freshly resolved root scope. Policy resolution happens before
    /// this call; sealing the scope does not grant anything by itself.
    pub(crate) fn issue_root(
        &self,
        scope: TrustedExecutionScope,
        authorization_generation: u64,
        issued_at_epoch_seconds: i64,
        expires_at_epoch_seconds: i64,
    ) -> Result<TrustedExecutionEnvelope, EnvelopeError> {
        let payload = EnvelopePayload {
            version: ENVELOPE_VERSION,
            authorization_generation,
            issued_at_epoch_seconds,
            expires_at_epoch_seconds,
            derivation_depth: 0,
            scope,
        };
        self.seal(payload)
    }

    /// Verifies integrity and current validity, returning trusted scope only on
    /// success. A current authorization generation must be resolved outside the
    /// envelope so revocation invalidates already-issued authority.
    pub(crate) fn verify<'a>(
        &self,
        envelope: &'a TrustedExecutionEnvelope,
        current_authorization_generation: u64,
        now_epoch_seconds: i64,
    ) -> Result<&'a TrustedExecutionScope, EnvelopeError> {
        let expected = self.mac(&envelope.payload)?;
        if !constant_time_equal(&expected, &envelope.seal) {
            return Err(EnvelopeError::Tampered);
        }
        validate_payload(&envelope.payload)?;
        if envelope.payload.authorization_generation != current_authorization_generation {
            return Err(EnvelopeError::GenerationMismatch);
        }
        if now_epoch_seconds < envelope.payload.issued_at_epoch_seconds {
            return Err(EnvelopeError::NotYetValid);
        }
        if now_epoch_seconds >= envelope.payload.expires_at_epoch_seconds {
            return Err(EnvelopeError::Expired);
        }
        Ok(&envelope.payload.scope)
    }

    /// Produces a sealed child only when every authority dimension is an exact
    /// tenant/actor match or a subset of its verified parent.
    pub(crate) fn derive_child(
        &self,
        parent: &TrustedExecutionEnvelope,
        child_scope: TrustedExecutionScope,
        current_authorization_generation: u64,
        issued_at_epoch_seconds: i64,
        expires_at_epoch_seconds: i64,
    ) -> Result<TrustedExecutionEnvelope, EnvelopeError> {
        self.verify(
            parent,
            current_authorization_generation,
            issued_at_epoch_seconds,
        )?;
        child_scope.ensure_subset_of(&parent.payload.scope)?;
        if expires_at_epoch_seconds > parent.payload.expires_at_epoch_seconds {
            return Err(EnvelopeError::ScopeWidened("expiry"));
        }
        let derivation_depth = parent
            .payload
            .derivation_depth
            .checked_add(1)
            .filter(|depth| *depth <= MAX_DERIVATION_DEPTH)
            .ok_or(EnvelopeError::DerivationLimit)?;
        self.seal(EnvelopePayload {
            version: ENVELOPE_VERSION,
            authorization_generation: parent.payload.authorization_generation,
            issued_at_epoch_seconds,
            expires_at_epoch_seconds,
            derivation_depth,
            scope: child_scope,
        })
    }

    fn seal(&self, payload: EnvelopePayload) -> Result<TrustedExecutionEnvelope, EnvelopeError> {
        validate_payload(&payload)?;
        let seal = self.mac(&payload)?;
        Ok(TrustedExecutionEnvelope { payload, seal })
    }

    fn mac(&self, payload: &EnvelopePayload) -> Result<[u8; 32], EnvelopeError> {
        let encoded = serde_json::to_vec(payload).map_err(|_| EnvelopeError::Encoding)?;
        Ok(hmac_sha256(&self.signing_key, &encoded))
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub(crate) enum EnvelopeError {
    #[error("execution envelope signing key must contain at least 256 bits")]
    WeakSigningKey,
    #[error("execution envelope scope is invalid: {0}")]
    InvalidScope(&'static str),
    #[error("execution envelope validity interval is invalid")]
    InvalidValidity,
    #[error("execution envelope authorization generation must be nonzero")]
    InvalidGeneration,
    #[error("execution envelope encoding failed")]
    Encoding,
    #[error("execution envelope integrity check failed")]
    Tampered,
    #[error("execution envelope authorization generation is stale")]
    GenerationMismatch,
    #[error("execution envelope is not yet valid")]
    NotYetValid,
    #[error("execution envelope has expired")]
    Expired,
    #[error("child execution envelope widens {0}")]
    ScopeWidened(&'static str),
    #[error("execution envelope derivation limit exceeded")]
    DerivationLimit,
}

fn validate_payload(payload: &EnvelopePayload) -> Result<(), EnvelopeError> {
    if payload.version != ENVELOPE_VERSION || payload.derivation_depth > MAX_DERIVATION_DEPTH {
        return Err(EnvelopeError::InvalidValidity);
    }
    if payload.authorization_generation == 0 {
        return Err(EnvelopeError::InvalidGeneration);
    }
    payload
        .expires_at_epoch_seconds
        .checked_sub(payload.issued_at_epoch_seconds)
        .filter(|lifetime| *lifetime > 0 && *lifetime <= MAX_ENVELOPE_LIFETIME_SECONDS)
        .ok_or(EnvelopeError::InvalidValidity)?;
    payload.scope.validate()
}

fn string_set(values: impl IntoIterator<Item = impl Into<String>>) -> BTreeSet<String> {
    values.into_iter().map(Into::into).collect()
}

fn validate_dimension(name: &'static str, values: &BTreeSet<String>) -> Result<(), EnvelopeError> {
    if values.is_empty() || values.len() > MAX_SCOPE_VALUES {
        return Err(EnvelopeError::InvalidScope(match name {
            "data classes" => "data-class scope must be nonempty and bounded",
            "regions" => "region scope must be nonempty and bounded",
            "processors" => "processor scope must be nonempty and bounded",
            "runtimes" => "runtime scope must be nonempty and bounded",
            "disclosures" => "disclosure scope must be nonempty and bounded",
            _ => "retention scope must be nonempty and bounded",
        }));
    }
    for value in values {
        validate_identifier(name, value, MAX_SCOPE_VALUE_BYTES)?;
    }
    Ok(())
}

fn validate_identifier(
    name: &'static str,
    value: &str,
    max_bytes: usize,
) -> Result<(), EnvelopeError> {
    if value.is_empty()
        || value.len() > max_bytes
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(EnvelopeError::InvalidScope(match name {
            "actor identity" => "actor identity is malformed",
            "data classes" => "data-class identifier is malformed",
            "regions" => "region identifier is malformed",
            "processors" => "processor identifier is malformed",
            "runtimes" => "runtime identifier is malformed",
            "disclosures" => "disclosure identifier is malformed",
            _ => "retention identifier is malformed",
        }));
    }
    Ok(())
}

fn ensure_subset<T: Ord>(
    name: &'static str,
    child: &BTreeSet<T>,
    parent: &BTreeSet<T>,
) -> Result<(), EnvelopeError> {
    if child.is_subset(parent) {
        Ok(())
    } else {
        Err(EnvelopeError::ScopeWidened(name))
    }
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut padded_key = [0_u8; SHA256_BLOCK_BYTES];
    if key.len() > SHA256_BLOCK_BYTES {
        let digest = Sha256::digest(key);
        padded_key[..digest.len()].copy_from_slice(&digest);
    } else {
        padded_key[..key.len()].copy_from_slice(key);
    }

    let mut inner_pad = [0x36_u8; SHA256_BLOCK_BYTES];
    let mut outer_pad = [0x5c_u8; SHA256_BLOCK_BYTES];
    for ((inner, outer), key_byte) in inner_pad
        .iter_mut()
        .zip(outer_pad.iter_mut())
        .zip(padded_key)
    {
        *inner ^= key_byte;
        *outer ^= key_byte;
    }

    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    outer.finalize().into()
}

fn constant_time_equal(left: &[u8; 32], right: &[u8; 32]) -> bool {
    let difference = left
        .iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        });
    difference == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_700_000_000;
    const GENERATION: u64 = 41;

    fn authority() -> ExecutionEnvelopeAuthority {
        ExecutionEnvelopeAuthority::new(&[0x5a; 32]).expect("strong test key")
    }

    fn restrictions(
        data_classes: &[&str],
        regions: &[&str],
        processors: &[&str],
    ) -> ExecutionRestrictions {
        ExecutionRestrictions::new(
            data_classes.iter().copied(),
            regions.iter().copied(),
            processors.iter().copied(),
            ["governed-agent-v1"],
            ["redacted-result"],
            ["run-retention"],
        )
    }

    fn root_scope() -> TrustedExecutionScope {
        TrustedExecutionScope::new(
            "actor:4f5e",
            7,
            11,
            [Capability::NamedRead, Capability::ActionDraft],
            restrictions(
                &["internal", "confidential"],
                &["eu-west", "eu-central"],
                &["openai-eu", "local"],
            ),
        )
        .expect("valid scope")
    }

    fn root() -> TrustedExecutionEnvelope {
        authority()
            .issue_root(root_scope(), GENERATION, NOW, NOW + 600)
            .expect("valid envelope")
    }

    #[test]
    fn verified_root_exposes_server_derived_scope() {
        let authority = authority();
        let envelope = authority
            .issue_root(root_scope(), GENERATION, NOW, NOW + 600)
            .expect("valid envelope");

        let verified = authority
            .verify(&envelope, GENERATION, NOW + 1)
            .expect("current envelope");

        assert_eq!(verified.organization_id(), 7);
        assert_eq!(verified.company_id(), 11);
        assert_eq!(verified.actor_identity(), "actor:4f5e");
        assert!(verified.permits(Capability::NamedRead));
        assert_eq!(envelope.authorization_generation(), GENERATION);
    }

    #[test]
    fn child_derivation_can_only_narrow_all_dimensions() {
        let authority = authority();
        let parent = root();
        let child_scope = TrustedExecutionScope::new(
            "actor:4f5e",
            7,
            11,
            [Capability::NamedRead],
            restrictions(&["internal"], &["eu-west"], &["local"]),
        )
        .expect("valid child scope");

        let child = authority
            .derive_child(&parent, child_scope, GENERATION, NOW + 10, NOW + 300)
            .expect("narrow child");

        let verified = authority
            .verify(&child, GENERATION, NOW + 11)
            .expect("valid child");
        assert_eq!(child.derivation_depth(), 1);
        assert_eq!(child.expires_at_epoch_seconds(), NOW + 300);
        assert_eq!(
            verified.restrictions().regions(),
            &BTreeSet::from(["eu-west".to_string()])
        );
        assert!(!verified.permits(Capability::ActionDraft));
    }

    #[test]
    fn child_derivation_rejects_every_kind_of_scope_widening() {
        let authority = authority();
        let parent = root();
        let child = TrustedExecutionScope::new(
            "actor:4f5e",
            7,
            11,
            [Capability::NamedRead],
            restrictions(&["internal"], &["eu-west"], &["local"]),
        )
        .expect("valid child scope");
        let mut cases = Vec::new();

        let mut widened = child.clone();
        widened.actor_identity = "another-actor".to_string();
        cases.push(widened);
        let mut widened = child.clone();
        widened.organization_id = 8;
        cases.push(widened);
        let mut widened = child.clone();
        widened.company_id = 12;
        cases.push(widened);
        let mut widened = child.clone();
        widened.capabilities.insert(Capability::Network);
        cases.push(widened);

        for dimension in 0..6 {
            let mut widened = child.clone();
            let target = match dimension {
                0 => &mut widened.restrictions.data_classes,
                1 => &mut widened.restrictions.regions,
                2 => &mut widened.restrictions.processors,
                3 => &mut widened.restrictions.runtimes,
                4 => &mut widened.restrictions.disclosures,
                _ => &mut widened.restrictions.retentions,
            };
            target.insert("not-parent-authorized".to_string());
            cases.push(widened);
        }

        for widened in cases {
            assert!(matches!(
                authority.derive_child(&parent, widened, GENERATION, NOW + 1, NOW + 300),
                Err(EnvelopeError::ScopeWidened(_))
            ));
        }
        assert_eq!(
            authority
                .derive_child(&parent, root_scope(), GENERATION, NOW + 1, NOW + 601)
                .expect_err("expiry may not widen"),
            EnvelopeError::ScopeWidened("expiry")
        );
    }

    #[test]
    fn tamper_wrong_key_expiry_and_generation_all_fail_closed() {
        let authority = authority();
        let envelope = root();

        let mut tampered = envelope.clone();
        tampered.payload.scope.company_id = 99;
        assert_eq!(
            authority.verify(&tampered, GENERATION, NOW + 1),
            Err(EnvelopeError::Tampered)
        );

        let other_authority =
            ExecutionEnvelopeAuthority::new(&[0x6b; 32]).expect("strong alternate key");
        assert_eq!(
            other_authority.verify(&envelope, GENERATION, NOW + 1),
            Err(EnvelopeError::Tampered)
        );
        assert_eq!(
            authority.verify(&envelope, GENERATION + 1, NOW + 1),
            Err(EnvelopeError::GenerationMismatch)
        );
        assert_eq!(
            authority.verify(&envelope, GENERATION, NOW + 600),
            Err(EnvelopeError::Expired)
        );
    }

    #[test]
    fn issuance_rejects_unbounded_or_malformed_authority() {
        assert_eq!(
            ExecutionEnvelopeAuthority::new(&[0_u8; 31]).expect_err("weak key"),
            EnvelopeError::WeakSigningKey
        );
        assert!(matches!(
            TrustedExecutionScope::new(
                " actor ",
                7,
                11,
                [Capability::NamedRead],
                restrictions(&["internal"], &["eu-west"], &["local"]),
            ),
            Err(EnvelopeError::InvalidScope(_))
        ));
        assert_eq!(
            authority()
                .issue_root(
                    root_scope(),
                    GENERATION,
                    NOW,
                    NOW + MAX_ENVELOPE_LIFETIME_SECONDS + 1
                )
                .expect_err("overlong lifetime"),
            EnvelopeError::InvalidValidity
        );
    }

    #[test]
    fn hmac_matches_rfc_4231_sha256_vector() {
        let expected = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";
        let actual = hmac_sha256(&[0x0b; 20], b"Hi There");
        assert_eq!(hex(&actual), expected);
    }

    fn hex(bytes: &[u8]) -> String {
        use std::fmt::Write as _;
        bytes.iter().fold(String::new(), |mut value, byte| {
            let _ = write!(value, "{byte:02x}");
            value
        })
    }
}
