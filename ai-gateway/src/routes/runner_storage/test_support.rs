//! Storage port fixture for exercising the gateway without a released module.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use super::{RunnerOwner, RunnerStore, StoredDevice, StoredRun};
use crate::error::AppResult;

struct Pairing {
    owner: RunnerOwner,
    expires_at_ms: u64,
    device_id: Option<String>,
}

#[derive(Default)]
struct State {
    pairs: HashMap<String, Pairing>,
    devices: HashMap<String, StoredDevice>,
    runs: HashMap<u64, StoredRun>,
}

#[derive(Default)]
pub(crate) struct MemoryRunnerStore {
    state: Mutex<State>,
}

fn system_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[async_trait::async_trait]
impl RunnerStore for MemoryRunnerStore {
    async fn issue_pairing(
        &self,
        owner: &RunnerOwner,
        digest: &str,
        expires_at_ms: u64,
    ) -> AppResult<()> {
        let now = system_now_ms();
        let mut state = self.state.lock().unwrap();
        state.pairs.retain(|_, pair| {
            pair.expires_at_ms > now && (pair.owner != *owner || pair.device_id.is_some())
        });
        state.pairs.insert(
            digest.into(),
            Pairing {
                owner: owner.clone(),
                expires_at_ms,
                device_id: None,
            },
        );
        Ok(())
    }

    async fn claim_pairing(
        &self,
        digest: &str,
        device_id: &str,
        credential_digest: &str,
        label: &str,
        now_ms: u64,
    ) -> AppResult<bool> {
        let mut state = self.state.lock().unwrap();
        let Some(pair) = state
            .pairs
            .get(digest)
            .filter(|entry| entry.expires_at_ms > now_ms)
        else {
            return Ok(false);
        };
        if let Some(claim) = &pair.device_id {
            return Ok(claim == device_id
                && state.devices.get(device_id).is_some_and(|device| {
                    device.credential_digest == credential_digest && device.label == label
                }));
        }
        if state.devices.contains_key(device_id) {
            return Ok(false);
        }
        let owner = pair.owner.clone();
        state.pairs.get_mut(digest).unwrap().device_id = Some(device_id.into());
        state.devices.insert(
            device_id.into(),
            StoredDevice {
                owner,
                device_id: device_id.into(),
                credential_digest: credential_digest.into(),
                label: label.into(),
            },
        );
        Ok(true)
    }

    async fn device(&self, device_id: &str) -> AppResult<Option<StoredDevice>> {
        Ok(self.state.lock().unwrap().devices.get(device_id).cloned())
    }

    async fn devices(&self, owner: &RunnerOwner) -> AppResult<Vec<StoredDevice>> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .devices
            .values()
            .filter(|row| row.owner == *owner)
            .cloned()
            .collect())
    }

    async fn revoke_device(&self, owner: &RunnerOwner, device_id: &str) -> AppResult<bool> {
        let mut state = self.state.lock().unwrap();
        if state
            .devices
            .get(device_id)
            .is_some_and(|row| row.owner == *owner)
        {
            return Ok(state.devices.remove(device_id).is_some());
        }
        Ok(false)
    }

    async fn run(&self, run_id: u64) -> AppResult<Option<StoredRun>> {
        Ok(self.state.lock().unwrap().runs.get(&run_id).cloned())
    }

    async fn run_by_request(&self, request_key: &str) -> AppResult<Option<StoredRun>> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .runs
            .values()
            .find(|row| row.request_key == request_key)
            .cloned())
    }

    async fn run_by_grant(&self, mcp_digest: &str) -> AppResult<Option<StoredRun>> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .runs
            .values()
            .find(|row| row.mcp_digest == mcp_digest)
            .cloned())
    }

    async fn active_run_for_device(
        &self,
        device_id: &str,
        now_ms: u64,
    ) -> AppResult<Option<StoredRun>> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .runs
            .values()
            .find(|row| row.device_id == device_id && row.active && row.expires_at_ms > now_ms)
            .cloned())
    }

    async fn insert_run(&self, run: &StoredRun) -> AppResult<bool> {
        let mut state = self.state.lock().unwrap();
        let now = system_now_ms();
        if run.version != 0
            || !run.active
            || run.expires_at_ms <= now
            || !state
                .devices
                .get(&run.device_id)
                .is_some_and(|device| device.owner == run.owner)
            || state.runs.values().any(|row| {
                row.run_id == run.run_id
                    || row.request_key == run.request_key
                    || row.mcp_digest == run.mcp_digest
                    || (row.device_id == run.device_id && row.active && row.expires_at_ms > now)
            })
        {
            return Ok(false);
        }
        state.runs.insert(run.run_id, run.clone());
        Ok(true)
    }

    async fn update_run(
        &self,
        record: &StoredRun,
        expected_version: u64,
        require_fresh: bool,
    ) -> AppResult<bool> {
        let mut state = self.state.lock().unwrap();
        if !state
            .devices
            .get(&record.device_id)
            .is_some_and(|device| device.owner == record.owner)
        {
            return Ok(false);
        }
        let Some(row) = state.runs.get_mut(&record.run_id) else {
            return Ok(false);
        };
        if row.version != expected_version
            || expected_version.checked_add(1) != Some(record.version)
            || row.owner != record.owner
            || row.device_id != record.device_id
            || !row.active
            || (require_fresh && row.expires_at_ms <= system_now_ms())
            || (!require_fresh && record.active)
        {
            return Ok(false);
        }
        row.version = record.version;
        row.active = record.active;
        row.payload.clone_from(&record.payload);
        Ok(true)
    }
}
