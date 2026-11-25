//! Pairing transitions for the local runner. The in-process store is for
//! deterministic tests and development. A public listener needs transactional
//! storage with the same claim and revocation semantics.

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use lumiere_auth_context::ActorContext;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::local_runner::DeviceScope;

const PAIRING_LIFETIME: Duration = Duration::from_secs(5 * 60);
const MAX_WAITING_CODES: usize = 256;
const MAX_DEVICES: usize = 1024;
type SecretDigest = [u8; 32];

#[derive(Clone, PartialEq, Eq)]
struct PairOwner {
    organization_id: u64,
    company_id: u64,
    actor_identity: String,
}

impl From<&ActorContext> for PairOwner {
    fn from(actor: &ActorContext) -> Self {
        Self {
            organization_id: actor.organization_id,
            company_id: actor.company_id,
            actor_identity: actor.identity.clone(),
        }
    }
}

struct PendingCode {
    owner: PairOwner,
    expires_at: Instant,
}

struct Device {
    owner: PairOwner,
    label: String,
    credential: SecretDigest,
}

pub struct PairingOffer {
    pub code: String,
    pub expires_in: Duration,
}

pub struct ClaimedDevice {
    pub device_id: String,
    pub credential: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PairedDevice {
    pub device_id: String,
    pub label: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum PairingError {
    #[error("pairing capacity exceeded")]
    Capacity,
    #[error("pairing code is invalid or expired")]
    InvalidCode,
    #[error("device label is invalid")]
    InvalidLabel,
}

#[derive(Default)]
pub struct PairingStore {
    codes: HashMap<SecretDigest, PendingCode>,
    devices: HashMap<String, Device>,
}

impl PairingStore {
    /// Called after the BFF has resolved the current, company-scoped grant.
    pub fn issue(
        &mut self,
        actor: &ActorContext,
        now: Instant,
    ) -> Result<PairingOffer, PairingError> {
        let owner = PairOwner::from(actor);
        self.codes
            .retain(|_, code| code.expires_at > now && code.owner != owner);
        if self.codes.len() >= MAX_WAITING_CODES || self.devices.len() >= MAX_DEVICES {
            return Err(PairingError::Capacity);
        }

        let code = Uuid::new_v4().to_string();
        self.codes.insert(
            hash_secret(&code),
            PendingCode {
                owner,
                expires_at: now + PAIRING_LIFETIME,
            },
        );
        Ok(PairingOffer {
            code,
            expires_in: PAIRING_LIFETIME,
        })
    }

    /// Check and consume the code while holding the same exclusive store
    /// access. The caller gets the new credential exactly once.
    pub fn claim(
        &mut self,
        code: &str,
        label: &str,
        now: Instant,
    ) -> Result<ClaimedDevice, PairingError> {
        let label = label.trim();
        if label.is_empty() || label.len() > 128 || label.chars().any(char::is_control) {
            return Err(PairingError::InvalidLabel);
        }
        if !is_canonical_uuid(code) {
            return Err(PairingError::InvalidCode);
        }
        if self.devices.len() >= MAX_DEVICES {
            return Err(PairingError::Capacity);
        }

        let pending = self
            .codes
            .remove(&hash_secret(code))
            .filter(|pending| pending.expires_at > now)
            .ok_or(PairingError::InvalidCode)?;
        let device_id = Uuid::new_v4().to_string();
        let credential = Uuid::new_v4().to_string();
        self.devices.insert(
            device_id.clone(),
            Device {
                owner: pending.owner,
                label: label.to_owned(),
                credential: hash_secret(&credential),
            },
        );
        Ok(ClaimedDevice {
            device_id,
            credential,
        })
    }

    /// The socket identity comes only from the device credential and lookup.
    /// The gateway still rechecks current actor authority before ERP dispatch.
    pub fn authenticate(&self, device_id: &str, credential: &str) -> Option<DeviceScope> {
        if !is_canonical_uuid(credential) {
            return None;
        }
        let device = self.devices.get(device_id)?;
        if !same_digest(&device.credential, &hash_secret(credential)) {
            return None;
        }
        Some(DeviceScope {
            organization_id: device.owner.organization_id,
            company_id: device.owner.company_id,
            actor_identity: device.owner.actor_identity.clone(),
            device_id: device_id.to_owned(),
        })
    }

    pub fn list(&self, actor: &ActorContext) -> Vec<PairedDevice> {
        let owner = PairOwner::from(actor);
        let mut devices: Vec<_> = self
            .devices
            .iter()
            .filter(|(_, device)| device.owner == owner)
            .map(|(device_id, device)| PairedDevice {
                device_id: device_id.clone(),
                label: device.label.clone(),
            })
            .collect();
        devices.sort_unstable_by(|left, right| left.device_id.cmp(&right.device_id));
        devices
    }

    pub fn revoke(&mut self, actor: &ActorContext, device_id: &str) -> bool {
        let owner = PairOwner::from(actor);
        if self
            .devices
            .get(device_id)
            .is_some_and(|device| device.owner == owner)
        {
            self.devices.remove(device_id);
            return true;
        }
        false
    }
}

fn hash_secret(secret: &str) -> SecretDigest {
    Sha256::digest(secret.as_bytes()).into()
}

fn is_canonical_uuid(value: &str) -> bool {
    value.len() == 36 && Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}

fn same_digest(left: &SecretDigest, right: &SecretDigest) -> bool {
    // Compare all digest bytes, independent of the first mismatch.
    left.iter()
        .zip(right)
        .fold(0, |difference, (left, right)| difference | (left ^ right))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actor(identity: &str, company_id: u64) -> ActorContext {
        ActorContext::new(&identity.repeat(64), "api-token", 1, company_id).unwrap()
    }

    #[test]
    fn pair_code_expires_and_a_new_offer_supersedes_the_previous_one() {
        let actor = actor("a", 4097);
        let mut store = PairingStore::default();
        let now = Instant::now();
        let previous = store.issue(&actor, now).unwrap();
        let current = store.issue(&actor, now).unwrap();
        assert!(matches!(
            store.claim(&previous.code, "Device", now),
            Err(PairingError::InvalidCode)
        ));
        assert!(matches!(
            store.claim(&current.code, "Device", now + current.expires_in),
            Err(PairingError::InvalidCode)
        ));
    }

    #[test]
    fn claim_is_single_use_and_revoke_requires_the_exact_actor_and_company() {
        let owner = actor("a", 4097);
        let same_company = actor("b", 4097);
        let another_company = actor("a", 4098);
        let mut store = PairingStore::default();
        let now = Instant::now();
        let offer = store.issue(&owner, now).unwrap();
        let claimed = store.claim(&offer.code, "Device", now).unwrap();
        assert!(matches!(
            store.claim(&offer.code, "Other device", now),
            Err(PairingError::InvalidCode)
        ));
        assert_eq!(store.list(&owner).len(), 1);
        assert!(store.list(&same_company).is_empty());
        assert!(!store.revoke(&same_company, &claimed.device_id));
        assert!(!store.revoke(&another_company, &claimed.device_id));
        let scope = store
            .authenticate(&claimed.device_id, &claimed.credential)
            .unwrap();
        assert_eq!(scope.company_id, 4097);
        assert_eq!(scope.actor_identity, owner.identity);
        assert!(store.revoke(&owner, &claimed.device_id));
        assert!(store
            .authenticate(&claimed.device_id, &claimed.credential)
            .is_none());
    }

    #[test]
    fn one_device_cannot_authenticate_using_another_devices_credential() {
        let owner = actor("a", 4097);
        let mut store = PairingStore::default();
        let now = Instant::now();
        let first = store.issue(&owner, now).unwrap();
        let first = store.claim(&first.code, "First", now).unwrap();
        let second = store.issue(&owner, now).unwrap();
        let second = store.claim(&second.code, "Second", now).unwrap();
        assert!(store
            .authenticate(&first.device_id, &second.credential)
            .is_none());
    }
}
