//! Transaction boundary for the local runner controller.

use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};
use stdb_client::{reducer_contract, Exposure, ReducerCall, StdbClient, StdbClientError};

use crate::error::{AppError, AppResult};

#[cfg(test)]
pub(crate) mod test_support;

#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunnerOwner {
    pub organization_id: u64,
    pub company_id: u64,
    pub actor_identity: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredDevice {
    #[serde(flatten)]
    pub owner: RunnerOwner,
    pub device_id: String,
    pub credential_digest: String,
    pub label: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredRun {
    #[serde(flatten)]
    pub owner: RunnerOwner,
    pub device_id: String,
    pub run_id: u64,
    pub request_key: String,
    pub mcp_digest: String,
    pub expires_at_ms: u64,
    pub active: bool,
    pub version: u64,
    pub payload: String,
}

const ISSUE_PAIRING: &str = "issue_ai_local_runner_pairing";
const CLAIM_PAIRING: &str = "claim_ai_local_runner_pairing";
const REVOKE_DEVICE: &str = "revoke_ai_local_runner_device";
const START_RUN: &str = "start_ai_local_runner_run";
const UPDATE_RUN: &str = "update_ai_local_runner_run";
const PAIRING_VIEW: &str = "ai_local_runner_pairing_read";
const DEVICE_VIEW: &str = "ai_local_runner_device_read";
const RUN_VIEW: &str = "ai_local_runner_run_read";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredPairing {
    #[serde(flatten)]
    owner: RunnerOwner,
    expires_at_ms: u64,
}

/// Use a dedicated native STDB credential for the active `ai_local_runner`
/// service bindings. The API caller's credentials remain with the controller.
pub(crate) struct StdbRunnerStore {
    client: StdbClient,
}

impl StdbRunnerStore {
    pub(crate) fn new(client: &StdbClient) -> AppResult<Self> {
        let names = [
            ISSUE_PAIRING,
            CLAIM_PAIRING,
            REVOKE_DEVICE,
            START_RUN,
            UPDATE_RUN,
        ];
        if names.into_iter().any(|name| {
            reducer_contract(name).is_none_or(|entry| entry.exposure != Exposure::Denied)
        }) {
            return Err(AppError::Unavailable(
                "The durable local runner contract is unavailable".into(),
            ));
        }
        Ok(Self {
            // Allow JSON wire escaping over the database's 2 MiB payload limit.
            client: client
                .with_query_limits(1024, 16 * 1024 * 1024)
                .map_err(|_| storage_unavailable())?,
        })
    }

    async fn mutate(&self, operation: &str, args: Value) -> AppResult<bool> {
        match self
            .client
            .call_reducer(ReducerCall::from_name(operation, args))
            .await
        {
            Ok(()) => Ok(true),
            Err(error) => {
                let upstream = error.downcast_ref::<StdbClientError>();
                if upstream.is_some_and(|error| {
                    error.status_code() == Some(530)
                        && error
                            .response_body()
                            .is_some_and(|body| body.contains("local runner storage conflict"))
                }) {
                    return Ok(false);
                }
                // The SQL clause, serialized state, token digests, and raw
                // upstream error are unsuitable for application logs.
                tracing::warn!(operation, "Local runner storage mutation unavailable");
                Err(storage_unavailable())
            }
        }
    }

    async fn read<T: DeserializeOwned>(
        &self,
        view: &str,
        filter: &str,
        limit: usize,
    ) -> AppResult<Vec<T>> {
        self.client
            .query_sql(&format!(
                "SELECT * FROM {view} WHERE {filter} LIMIT {limit}"
            ))
            .await
            .map_err(|_| storage_unavailable())?
            .into_iter()
            .map(|value| serde_json::from_value(value).map_err(|_| storage_unavailable()))
            .collect()
    }

    async fn read_one<T: DeserializeOwned>(
        &self,
        view: &str,
        filter: &str,
    ) -> AppResult<Option<T>> {
        let mut entries = self.read(view, filter, 2).await?;
        if entries.len() > 1 {
            return Err(storage_unavailable());
        }
        Ok(entries.pop())
    }
}

fn storage_unavailable() -> AppError {
    AppError::Unavailable("Local runner storage is temporarily unavailable".into())
}

// In SpaceTimeDB 2.8 a successful HTTP reducer response alone is not a
// durability acknowledgement. A confirmed SQL read observes the commit before
// the gateway acknowledges the write or hands a new credential to its caller.
fn confirmed(found: bool) -> AppResult<bool> {
    found.then_some(true).ok_or_else(storage_unavailable)
}

fn is_lower_hex(byte: u8) -> bool {
    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
}

fn checked_digest(value: &str) -> AppResult<&str> {
    if value.len() == 64 && value.bytes().all(is_lower_hex) {
        return Ok(value);
    }
    Err(AppError::BadRequest(
        "Invalid local runner identifier".into(),
    ))
}

fn owner_actor(owner: &RunnerOwner) -> AppResult<String> {
    let identity = owner.actor_identity.to_ascii_lowercase();
    checked_digest(identity.strip_prefix("0x").unwrap_or(&identity)).map(str::to_owned)
}

fn checked_device_id(value: &str) -> AppResult<&str> {
    if uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value) {
        return Ok(value);
    }
    Err(AppError::BadRequest("Invalid local runner device".into()))
}

#[async_trait::async_trait]
impl RunnerStore for StdbRunnerStore {
    async fn issue_pairing(
        &self,
        owner: &RunnerOwner,
        digest: &str,
        expires_at_ms: u64,
    ) -> AppResult<()> {
        let digest = checked_digest(digest)?;
        let actor = owner_actor(owner)?;
        let written = self
            .mutate(
                ISSUE_PAIRING,
                json!([owner.organization_id, {
                    "company_id": owner.company_id,
                    "actor_identity": actor,
                    "digest": digest,
                    "expires_at_ms": expires_at_ms,
                }]),
            )
            .await?;
        if !written {
            return Err(storage_unavailable());
        }
        let record: Option<StoredPairing> = self
            .read_one(PAIRING_VIEW, &format!("digest = '{digest}'"))
            .await?;
        confirmed(record.is_some_and(|record| {
            record.owner.organization_id == owner.organization_id
                && record.owner.company_id == owner.company_id
                && record.owner.actor_identity == actor
                && record.expires_at_ms == expires_at_ms
        }))?;
        Ok(())
    }

    async fn claim_pairing(
        &self,
        digest: &str,
        device_id: &str,
        credential_digest: &str,
        label: &str,
        _now_ms: u64,
    ) -> AppResult<bool> {
        let claim = self
            .mutate(
                CLAIM_PAIRING,
                json!([{
                    "digest": checked_digest(digest)?,
                    "device_id": checked_device_id(device_id)?,
                    "credential_digest": checked_digest(credential_digest)?,
                    "label": label,
                }]),
            )
            .await?;
        if !claim {
            return Ok(false);
        }
        confirmed(self.device(device_id).await?.is_some_and(|device| {
            device.credential_digest == credential_digest && device.label == label
        }))
    }

    async fn device(&self, device_id: &str) -> AppResult<Option<StoredDevice>> {
        let device_id = checked_device_id(device_id)?;
        self.read_one(DEVICE_VIEW, &format!("device_id = '{device_id}'"))
            .await
    }

    async fn devices(&self, owner: &RunnerOwner) -> AppResult<Vec<StoredDevice>> {
        let actor = owner_actor(owner)?;
        let RunnerOwner {
            organization_id,
            company_id,
            ..
        } = owner;
        self.read(DEVICE_VIEW, &format!(
            "organization_id = {organization_id} AND company_id = {company_id} AND actor_identity = '{actor}'"
        ), 1024).await
    }

    async fn revoke_device(&self, owner: &RunnerOwner, device_id: &str) -> AppResult<bool> {
        let revoked = self
            .mutate(
                REVOKE_DEVICE,
                json!([
                    owner.organization_id,
                    owner.company_id,
                    owner_actor(owner)?,
                    checked_device_id(device_id)?,
                ]),
            )
            .await?;
        if !revoked {
            return Ok(false);
        }
        confirmed(self.device(device_id).await?.is_none())
    }

    async fn run(&self, run_id: u64) -> AppResult<Option<StoredRun>> {
        self.read_one(RUN_VIEW, &format!("run_id = {run_id}")).await
    }

    async fn run_by_request(&self, request_key: &str) -> AppResult<Option<StoredRun>> {
        let request_key = checked_digest(request_key)?;
        self.read_one(RUN_VIEW, &format!("request_key = '{request_key}'"))
            .await
    }

    async fn run_by_grant(&self, mcp_digest: &str) -> AppResult<Option<StoredRun>> {
        let mcp_digest = checked_digest(mcp_digest)?;
        self.read_one(RUN_VIEW, &format!("mcp_digest = '{mcp_digest}'"))
            .await
    }

    async fn active_run_for_device(
        &self,
        device_id: &str,
        now_ms: u64,
    ) -> AppResult<Option<StoredRun>> {
        let device_id = checked_device_id(device_id)?;
        self.read_one(
            RUN_VIEW,
            &format!("device_id = '{device_id}' AND active = true AND expires_at_ms > {now_ms}"),
        )
        .await
    }

    async fn insert_run(&self, run: &StoredRun) -> AppResult<bool> {
        if run.version != 0 || !run.active {
            return Err(storage_unavailable());
        }
        let inserted = self
            .mutate(
                START_RUN,
                json!([run.owner.organization_id, {
                    "company_id": run.owner.company_id,
                    "actor_identity": owner_actor(&run.owner)?,
                    "run_id": run.run_id,
                    "device_id": checked_device_id(&run.device_id)?,
                    "request_key": checked_digest(&run.request_key)?,
                    "mcp_digest": checked_digest(&run.mcp_digest)?,
                    "expires_at_ms": run.expires_at_ms,
                    "payload": run.payload,
                }]),
            )
            .await?;
        if !inserted {
            return Ok(false);
        }
        confirmed(self.run(run.run_id).await?.is_some_and(|stored| {
            stored.request_key == run.request_key && stored.mcp_digest == run.mcp_digest
        }))
    }

    async fn update_run(
        &self,
        record: &StoredRun,
        expected_version: u64,
        require_fresh: bool,
    ) -> AppResult<bool> {
        if expected_version.checked_add(1) != Some(record.version) {
            return Ok(false);
        }
        let updated = self
            .mutate(
                UPDATE_RUN,
                json!([record.owner.organization_id, {
                    "run_id": record.run_id,
                    "company_id": record.owner.company_id,
                    "actor_identity": owner_actor(&record.owner)?,
                    "device_id": checked_device_id(&record.device_id)?,
                    "expected_version": expected_version,
                    "require_fresh": require_fresh,
                    "active": record.active,
                    "payload": record.payload,
                }]),
            )
            .await?;
        if !updated {
            return Ok(false);
        }
        confirmed(self.run(record.run_id).await?.is_some_and(|stored| {
            stored.version > record.version
                || (stored.version == record.version
                    && stored.active == record.active
                    && stored.payload == record.payload)
        }))
    }
}

#[async_trait::async_trait]
pub(crate) trait RunnerStore: Send + Sync {
    async fn issue_pairing(
        &self,
        owner: &RunnerOwner,
        digest: &str,
        expires_at_ms: u64,
    ) -> AppResult<()>;

    async fn claim_pairing(
        &self,
        digest: &str,
        device_id: &str,
        credential_digest: &str,
        label: &str,
        now_ms: u64,
    ) -> AppResult<bool>;

    async fn device(&self, device_id: &str) -> AppResult<Option<StoredDevice>>;
    async fn devices(&self, owner: &RunnerOwner) -> AppResult<Vec<StoredDevice>>;
    async fn revoke_device(&self, owner: &RunnerOwner, device_id: &str) -> AppResult<bool>;

    async fn run(&self, run_id: u64) -> AppResult<Option<StoredRun>>;
    async fn run_by_request(&self, request_key: &str) -> AppResult<Option<StoredRun>>;
    async fn run_by_grant(&self, mcp_digest: &str) -> AppResult<Option<StoredRun>>;
    async fn active_run_for_device(
        &self,
        device_id: &str,
        now_ms: u64,
    ) -> AppResult<Option<StoredRun>>;

    async fn insert_run(&self, run: &StoredRun) -> AppResult<bool>;

    /// Commit one version and its replay payload together. Live effects
    /// require the persisted lease to still be unexpired at commit time.
    async fn update_run(
        &self,
        record: &StoredRun,
        expected_version: u64,
        require_fresh: bool,
    ) -> AppResult<bool>;
}
