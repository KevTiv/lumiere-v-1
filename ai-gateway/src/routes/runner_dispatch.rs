//! Server-owned dispatch, device enrollment and durable attempt transitions.

use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use ai_gateway::local_runner::{
    AdmissionError, Apply, Attempt, AttemptId, AttemptState, Decision, DeviceScope, EventFrame,
    RunnerEvent, PROTOCOL_VERSION,
};
use async_trait::async_trait;
use dashmap::{DashMap, DashSet};
use lumiere_auth_context::ActorContext;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;
use uuid::Uuid;

#[cfg(test)]
mod tests;

use crate::{
    error::{AppError, AppResult},
    harness::manifest::OrgPrivacyPolicy,
    routes::{
        evidence::require_scoped_capability_grant,
        run_lifecycle::LIFECYCLE_CAPABILITY,
        runner_inventory::{
            candidate_evidence_id, verify_inventory_candidate, InventoryAttempt, LowStockEvidence,
            VerifiedLowStockReadback, INVENTORY_LOW_STOCK_TOOL,
        },
        runner_mcp::{RunnerMcpAuthority, RunnerMcpGrant, MCP_PATH},
        runner_storage::{RunnerOwner, RunnerStore, StoredDevice, StoredRun},
    },
    state::AppState,
};

const PAIRING_LIFETIME_MS: u64 = 5 * 60_000;
const LEASE_LIFETIME_MS: u64 = 15 * 60_000;
const MAX_EVIDENCE: usize = 8;
const MAX_SAFE_WIRE_INTEGER: u128 = (1 << 53) - 1;
const MAX_CAS_RETRIES: usize = 5;
const SOCKET_QUEUE: usize = 64;

/// Registered only when a durable store is available. Connection senders and
/// acting-user tokens remain transient and confined to this gateway process.
pub(super) struct RunnerDispatch {
    state: AppState,
    store: Arc<dyn RunnerStore>,
    origin: Url,
    connections: DashMap<String, Connection>,
    actors: DashMap<u64, BrowserAuthority>,
    verifications: DashSet<u64>,
    admitted_provider: Provider,
    pilot_company_id: u64,
}

#[derive(Clone)]
struct BrowserAuthority {
    actor: ActorContext,
    expires_at_ms: u64,
}

#[derive(Clone)]
struct Connection {
    id: Uuid,
    sender: mpsc::Sender<Value>,
    providers: Vec<ProviderStatus>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Provider {
    Codex,
    Claude,
    Antigravity,
    Vibe,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum ProviderState {
    Missing,
    SignInRequired,
    Ready,
    Unavailable,
    QuotaLimited,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Capability {
    Resume,
    Permission,
    Usage,
    Quota,
    Mcp,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Funding {
    Subscription,
    Api,
    Unknown,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ProviderStatus {
    provider: Provider,
    state: ProviderState,
    capabilities: Vec<Capability>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    funding: Option<Funding>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct StartRequest {
    pub company_id: u64,
    device_id: String,
    conversation_id: String,
    request_id: String,
    provider: Provider,
    prompt: String,
    org_privacy_policy: OrgPrivacyPolicy,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PairingResponse {
    code: String,
    expires_at: String,
    gateway_origin: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeviceCredential {
    device_id: String,
    credential: String,
}

#[derive(Deserialize, Serialize)]
struct AttemptRecord {
    id: AttemptId,
    attempt: Attempt,
    request_hash: String,
    privacy_policy: OrgPrivacyPolicy,
    timeline: Vec<Value>,
    evidence: BTreeMap<String, String>,
}

impl AttemptRecord {
    fn decode(run: &StoredRun) -> AppResult<Self> {
        let record: Self = serde_json::from_str(&run.payload)
            .map_err(|_| AppError::Internal("invalid stored runner attempt".into()))?;
        if record.id.run_id != run.run_id.to_string()
            || !record
                .attempt
                .matches_binding(&record.id, &scope_for(run), run.expires_at_ms)
        {
            return Err(AppError::Internal("invalid stored runner binding".into()));
        }
        Ok(record)
    }

    fn encode(&self) -> AppResult<String> {
        serde_json::to_string(self)
            .map_err(|_| AppError::Internal("cannot encode runner attempt".into()))
    }

    fn push(&mut self, mut event: Value) {
        event["seq"] = json!(self.timeline.len() + 1);
        self.timeline.push(event);
    }

    fn terminal(&self) -> bool {
        matches!(
            self.attempt.state(),
            AttemptState::Completed
                | AttemptState::Withheld
                | AttemptState::Cancelled
                | AttemptState::Failed
                | AttemptState::OutcomeUnknown
        )
    }
}

pub(super) struct Replay {
    pub events: Vec<Value>,
    pub terminal: bool,
    pub verifying: bool,
}

impl RunnerDispatch {
    pub(super) fn new(
        state: AppState,
        store: Arc<dyn RunnerStore>,
        origin: Url,
        admitted_provider: Provider,
        pilot_company_id: u64,
    ) -> AppResult<Self> {
        let loopback = matches!(origin.host_str(), Some("127.0.0.1" | "[::1]" | "localhost"));
        if !(origin.scheme() == "https" || origin.scheme() == "http" && loopback)
            || pilot_company_id == 0
            || origin.host().is_none()
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
        {
            return Err(AppError::BadRequest("invalid runner gateway origin".into()));
        }

        Ok(Self {
            state,
            store,
            origin,
            connections: DashMap::new(),
            actors: DashMap::new(),
            verifications: DashSet::new(),
            admitted_provider,
            pilot_company_id,
        })
    }

    pub(super) fn admits_company(&self, company_id: u64) -> bool {
        company_id == self.pilot_company_id
    }

    async fn authorize_actor(&self, actor: &ActorContext) -> AppResult<()> {
        if !self.admits_company(actor.company_id) {
            return Err(device_denied());
        }
        authorize_actor(&self.state, actor).await
    }

    pub(super) async fn issue_pairing(&self, actor: &ActorContext) -> AppResult<PairingResponse> {
        self.authorize_actor(actor).await?;
        let code = Uuid::new_v4().to_string();
        let expiration = now_ms() + PAIRING_LIFETIME_MS;
        self.store
            .issue_pairing(&owner(actor), &digest(&code), expiration)
            .await?;
        let expires_at = chrono::DateTime::from_timestamp_millis(expiration as i64)
            .ok_or_else(|| AppError::Internal("invalid pairing expiry".into()))?
            .to_rfc3339();
        Ok(PairingResponse {
            code,
            expires_at,
            gateway_origin: self.origin.origin().ascii_serialization(),
        })
    }

    pub(super) async fn claim_pairing(
        &self,
        code: &str,
        label: Option<&str>,
    ) -> AppResult<DeviceCredential> {
        if !canonical_uuid(code) {
            return Err(device_denied());
        }
        let label = label.unwrap_or("Local runner").trim();
        if label.is_empty() || label.len() > 80 || label.chars().any(char::is_control) {
            return Err(AppError::BadRequest("invalid runner device label".into()));
        }

        let device_id = Uuid::new_v4().to_string();
        let credential = Uuid::new_v4().to_string();
        if !self
            .store
            .claim_pairing(
                &digest(code),
                &device_id,
                &digest(&credential),
                label,
                now_ms(),
            )
            .await?
        {
            return Err(device_denied());
        }
        Ok(DeviceCredential {
            device_id,
            credential,
        })
    }

    pub(super) async fn devices(&self, actor: &ActorContext) -> AppResult<Value> {
        self.authorize_actor(actor).await?;
        let devices = self
            .store
            .devices(&owner(actor))
            .await?
            .into_iter()
            .map(|device| {
                let connected = self.connections.get(&device.device_id);
                let providers: Vec<_> = connected
                    .iter()
                    .flat_map(|connection| connection.providers.iter())
                    .filter(|provider| provider.provider == self.admitted_provider)
                    .collect();
                json!({
                    "deviceId": device.device_id,
                    "label": device.label,
                    "state": if connected.is_some() { "online" } else { "offline" },
                    "providers": providers
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({ "version": PROTOCOL_VERSION, "enabled": true, "devices": devices }))
    }

    pub(super) async fn revoke(&self, actor: &ActorContext, device_id: &str) -> AppResult<()> {
        self.authorize_actor(actor).await?;
        if !canonical_uuid(device_id) || !self.store.revoke_device(&owner(actor), device_id).await?
        {
            return Err(device_denied());
        }
        self.connections.remove(device_id);
        self.actors
            .retain(|_, binding| binding.expires_at_ms > now_ms());
        Ok(())
    }

    pub(super) async fn authenticate_device(
        &self,
        device_id: &str,
        credential: &str,
    ) -> AppResult<StoredDevice> {
        if !canonical_uuid(device_id) || !canonical_uuid(credential) {
            return Err(device_denied());
        }
        let device = self
            .store
            .device(device_id)
            .await?
            .filter(|device| device.owner.company_id == self.pilot_company_id)
            .ok_or_else(device_denied)?;
        // Constant-time comparison of fixed-length, unpadded digest encodings.
        let presented = digest(credential);
        let different = device
            .credential_digest
            .bytes()
            .zip(presented.bytes())
            .fold(0, |difference, (left, right)| difference | (left ^ right));
        if device.credential_digest.len() != presented.len() || different != 0 {
            return Err(device_denied());
        }
        Ok(device)
    }

    pub(super) async fn connect(
        &self,
        device: &StoredDevice,
        providers: Vec<ProviderStatus>,
    ) -> AppResult<(Uuid, mpsc::Receiver<Value>)> {
        validate_providers(&providers)?;
        let live_device = self
            .store
            .device(&device.device_id)
            .await?
            .ok_or_else(device_denied)?;
        if live_device.owner != device.owner
            || live_device.credential_digest != device.credential_digest
        {
            return Err(device_denied());
        }
        let id = Uuid::new_v4();
        let (sender, receiver) = mpsc::channel(SOCKET_QUEUE);
        self.connections.insert(
            device.device_id.clone(),
            Connection {
                id,
                sender: sender.clone(),
                providers,
            },
        );
        // Register before reading the durable controls so commands committed
        // during this read can also be routed to the replacement socket.
        if let Err(error) = self.replay_controls(&device.device_id, &sender).await {
            self.disconnect(&device.device_id, id);
            return Err(error);
        }
        Ok((id, receiver))
    }

    async fn replay_controls(
        &self,
        device_id: &str,
        sender: &mpsc::Sender<Value>,
    ) -> AppResult<()> {
        if let Some(pending) = self
            .store
            .active_run_for_device(device_id, now_ms())
            .await?
        {
            let record = AttemptRecord::decode(&pending)?;
            for (permission_id, decision) in record.attempt.pending_permission_replies() {
                send(
                    sender,
                    permission_reply(&record.id, permission_id, decision),
                )?;
            }
            if record.attempt.state() == AttemptState::Cancelling {
                send(sender, command(&record.id, "cancel", json!({})))?;
            }
        }
        Ok(())
    }

    pub(super) fn disconnect(&self, device_id: &str, connection_id: Uuid) {
        self.connections
            .remove_if(device_id, |_, existing| existing.id == connection_id);
    }

    pub(super) fn is_current_connection(&self, device_id: &str, connection_id: Uuid) -> bool {
        self.connections
            .get(device_id)
            .is_some_and(|existing| existing.id == connection_id)
    }

    pub(super) async fn start(
        &self,
        actor: &ActorContext,
        request: StartRequest,
    ) -> AppResult<AttemptId> {
        self.authorize_actor(actor).await?;
        if !canonical_uuid(&request.device_id)
            || !wire_id(&request.request_id)
            || !wire_id(&request.conversation_id)
            || request.prompt.trim().is_empty()
            || request.prompt.len() > 8 * 1024
        {
            return Err(AppError::BadRequest("invalid runner turn intent".into()));
        }

        let owner = owner(actor);
        let request_key = digest(
            &json!([
                owner.organization_id,
                owner.company_id,
                owner.actor_identity,
                request.request_id
            ])
            .to_string(),
        );
        let request_hash = digest(
            &json!([
                request.device_id,
                request.conversation_id,
                request.provider,
                request.prompt
            ])
            .to_string(),
        );
        if let Some(previous) = self.store.run_by_request(&request_key).await? {
            self.current_device(&previous).await?;
            return self.accept_replay(actor, previous, &request_hash);
        }

        let device = self
            .store
            .device(&request.device_id)
            .await?
            .filter(|device| device.owner == owner)
            .ok_or_else(device_denied)?;
        let connection = self
            .connections
            .get(&device.device_id)
            .filter(|connection| {
                request.provider == self.admitted_provider
                    && connection.providers.iter().any(|provider| {
                        provider.provider == request.provider
                            && provider.state == ProviderState::Ready
                            && provider.capabilities.contains(&Capability::Mcp)
                    })
            })
            .map(|connection| connection.clone())
            .ok_or_else(|| {
                AppError::Unavailable("selected runner provider is offline or unavailable".into())
            })?;

        let run_id = (Uuid::new_v4().as_u128() & MAX_SAFE_WIRE_INTEGER) as u64;
        if run_id == 0 {
            return Err(AppError::Unavailable(
                "runner could not allocate a run ID".into(),
            ));
        }
        let id = AttemptId {
            run_id: run_id.to_string(),
            attempt_id: Uuid::new_v4().to_string(),
            lease_id: Uuid::new_v4().to_string(),
        };
        let expires_at_ms = now_ms() + LEASE_LIFETIME_MS;
        let token = Uuid::new_v4().to_string();
        let mut run = StoredRun {
            owner,
            device_id: device.device_id.clone(),
            run_id,
            request_key,
            mcp_digest: digest(&token),
            expires_at_ms,
            active: true,
            version: 0,
            payload: String::new(),
        };
        let mut record = AttemptRecord {
            id: id.clone(),
            attempt: Attempt::new(id.clone(), scope_for(&run), expires_at_ms),
            request_hash,
            privacy_policy: request.org_privacy_policy,
            timeline: Vec::new(),
            evidence: BTreeMap::new(),
        };
        record.push(json!({ "type": "activity", "message": "Waiting for the local runner." }));
        run.payload = record.encode()?;
        if !self.store.insert_run(&run).await? {
            return match self.store.run_by_request(&run.request_key).await? {
                Some(previous) => self.accept_replay(actor, previous, &record.request_hash),
                None => Err(AppError::Unavailable(
                    "runner already has an active turn".into(),
                )),
            };
        }

        self.bind_actor(&run, actor)?;
        let url = self
            .origin
            .join(MCP_PATH)
            .map_err(|_| AppError::Internal("invalid runner MCP URL".into()))?;
        let prompt = format!(
            "For this Lumière inventory turn use inventory_low_stock. Answer with one JSON object containing evidenceId from the tool and productIds as an array of product ID strings. The gateway verifies the answer before displaying it.\n\nUser question:\n{}",
            request.prompt
        );
        if !self.is_current_connection(&device.device_id, connection.id)
            || send(
                &connection.sender,
                command(
                    &id,
                    "dispatch",
                    json!({ "provider": request.provider, "prompt": prompt, "mcp": { "url": url.as_str(), "token": token } }),
                ),
            )
            .is_err()
        {
            // An attempt exists even if delivery failed. The caller should
            // receive its ID and observe recovery rather than redispatch.
            match self.settle_unknown(run.run_id).await {
                Ok(()) => {}
                Err(_) => tracing::warn!(run_id, stage = "runner_dispatch_requires_reconciliation"),
            }
        }
        tracing::info!(run_id, attempt_id = %id.attempt_id, stage = "runner_attempt_created");
        Ok(id)
    }

    fn accept_replay(
        &self,
        actor: &ActorContext,
        stored: StoredRun,
        expected_request: &str,
    ) -> AppResult<AttemptId> {
        let record = AttemptRecord::decode(&stored)?;
        if stored.owner != owner(actor) || record.request_hash != expected_request {
            return Err(AppError::BadRequest(
                "runner request ID was already used".into(),
            ));
        }
        if stored.active && stored.expires_at_ms > now_ms() {
            self.bind_actor(&stored, actor)?;
        }
        Ok(record.id)
    }

    fn bind_actor(&self, run: &StoredRun, actor: &ActorContext) -> AppResult<()> {
        if run.owner != owner(actor) || run.expires_at_ms <= now_ms() {
            return Err(device_denied());
        }
        self.actors
            .retain(|_, binding| binding.expires_at_ms > now_ms());
        self.actors.insert(
            run.run_id,
            BrowserAuthority {
                actor: actor.clone(),
                expires_at_ms: run.expires_at_ms,
            },
        );
        Ok(())
    }

    fn bound_actor(&self, run: &StoredRun) -> AppResult<ActorContext> {
        self.actors
            .get(&run.run_id)
            .filter(|binding| {
                binding.expires_at_ms > now_ms() && run.owner == owner(&binding.actor)
            })
            .map(|binding| binding.actor.clone())
            .ok_or_else(|| {
                AppError::Unavailable("reattach Lumière chat to continue this run".into())
            })
    }

    async fn current_device(&self, run: &StoredRun) -> AppResult<StoredDevice> {
        self.store
            .device(&run.device_id)
            .await?
            .filter(|device| device.owner == run.owner)
            .ok_or_else(device_denied)
    }

    pub(super) async fn ingest(
        &self,
        device: &StoredDevice,
        connection: Uuid,
        frame: EventFrame,
    ) -> AppResult<Apply> {
        let run_id = parse_run_id(&frame.run_id)?;
        for _ in 0..MAX_CAS_RETRIES {
            let run = self
                .store
                .run(run_id)
                .await?
                .filter(|run| run.device_id == device.device_id && run.owner == device.owner)
                .ok_or_else(device_denied)?;
            let current = self.current_device(&run).await?;
            if current.credential_digest != device.credential_digest
                || !self.is_current_connection(&device.device_id, connection)
            {
                return Err(device_denied());
            }

            let mut record = AttemptRecord::decode(&run)?;
            let result = record
                .attempt
                .ingest(&scope_for(&run), now_ms(), frame.clone())
                .map_err(admission_error)?;
            if result == Apply::Replayed {
                return Ok(result);
            }
            if record.attempt.state() == AttemptState::Withheld {
                record.push(cancelled_before_verification());
            } else if let Some(event) = browser_event(&frame.event) {
                record.push(event);
            }
            let terminal = record.terminal();
            if self.persist(run, record, true).await? {
                if terminal {
                    self.actors.remove(&run_id);
                }
                return Ok(result);
            }
        }
        Err(reconcile())
    }

    pub(super) fn schedule_verification(self: &Arc<Self>, run_id: u64) {
        if !self.verifications.insert(run_id) {
            return;
        }
        let dispatcher = self.clone();
        tokio::spawn(async move {
            if dispatcher.verify_candidate(run_id).await.is_err() {
                tracing::warn!(run_id, stage = "runner_verification_waiting");
            }
            dispatcher.verifications.remove(&run_id);
        });
    }

    pub(super) async fn verify_candidate(&self, run_id: u64) -> AppResult<()> {
        let Some(run) = self.store.run(run_id).await? else {
            return Ok(());
        };
        let mut record = AttemptRecord::decode(&run)?;
        if !run.active || record.attempt.state() != AttemptState::Verifying {
            return Ok(());
        }
        let actor = self.bound_actor(&run)?;
        self.current_device(&run).await?;
        self.authorize_actor(&actor).await?;
        let verified = match self.verify_readback(&run, &record, &actor).await {
            Err(error @ (AppError::Unavailable(_) | AppError::Internal(_))) => {
                // The browser stream retries active verification after a
                // recoverable dependency failure, until the lease expires.
                return Err(error);
            }
            verified => verified,
        };

        // Revalidate acting authority after the awaited read. The persistence
        // CAS also rechecks device and deadline at the commit boundary.
        self.authorize_actor(&actor).await?;
        let admitted = verified.is_ok();
        record
            .attempt
            .finish_verification(admitted)
            .map_err(admission_error)?;
        let event = match verified {
            Ok(payload) => verified_event(run_id, payload),
            Err(_) => failed(
                "verification_required",
                "The runner answer could not be verified. Read current inventory and try again.",
            ),
        };
        record.push(event);
        if self.persist(run, record, true).await? {
            self.actors.remove(&run_id);
            tracing::info!(run_id, admitted, stage = "runner_verification_finished");
        }
        Ok(())
    }

    async fn verify_readback(
        &self,
        run: &StoredRun,
        record: &AttemptRecord,
        actor: &ActorContext,
    ) -> AppResult<VerifiedLowStockReadback> {
        let candidate = record
            .attempt
            .candidate_text()
            .ok_or_else(|| AppError::Internal("runner candidate is missing".into()))?;
        let evidence_id = candidate_evidence_id(candidate)?.to_string();
        let evidence = record
            .evidence
            .get(&evidence_id)
            .ok_or_else(|| AppError::Forbidden("runner evidence is missing".into()))?;
        let evidence = LowStockEvidence::decode_stored(evidence)?;
        let allowed_tools = [INVENTORY_LOW_STOCK_TOOL.to_string()];
        let scope = InventoryAttempt::new(
            actor,
            &record.privacy_policy,
            run.run_id,
            &record.id.attempt_id,
            &allowed_tools,
        )?;
        verify_inventory_candidate(&self.state, &scope, &evidence, candidate).await
    }

    pub(super) async fn replay(
        &self,
        actor: &ActorContext,
        run_id: u64,
        after: usize,
        refresh_authority: bool,
    ) -> AppResult<Replay> {
        if refresh_authority {
            self.authorize_actor(actor).await?;
        }
        let run = self.browser_run(actor, run_id).await?;
        let mut record = AttemptRecord::decode(&run)?;
        if !refresh_authority && after < record.timeline.len() {
            self.authorize_actor(actor).await?;
        }
        if after > record.timeline.len() {
            return Err(AppError::BadRequest(
                "runner event cursor is ahead of the run".into(),
            ));
        }
        if run.active && run.expires_at_ms <= now_ms() {
            self.settle_unknown(run_id).await?;
            let stored = self.browser_run(actor, run_id).await?;
            record = AttemptRecord::decode(&stored)?;
        } else if run.active && refresh_authority {
            self.bind_actor(&run, actor)?;
        }
        let mut events = record.timeline[after..].to_vec();
        if let Some(result) = events
            .last_mut()
            .filter(|event| event["type"] == "verified")
        {
            // A published result is durable, but its inventory data remains
            // subject to current authorization when the browser reattaches.
            if let Err(error) = self.verify_readback(&run, &record, actor).await {
                if matches!(error, AppError::Forbidden(_) | AppError::NotFound(_)) {
                    return Err(device_denied());
                }
                let sequence = result["seq"].clone();
                *result = failed(
                    "verification_required",
                    "Inventory could not be verified again. Read the current stock and try again.",
                );
                result["seq"] = sequence;
            }
            self.current_device(&run).await?;
            self.authorize_actor(actor).await?;
        }
        Ok(Replay {
            events,
            terminal: record.terminal(),
            verifying: record.attempt.state() == AttemptState::Verifying,
        })
    }

    pub(super) async fn cancel(&self, actor: &ActorContext, run_id: u64) -> AppResult<()> {
        self.authorize_actor(actor).await?;
        for _ in 0..MAX_CAS_RETRIES {
            let run = self.browser_run(actor, run_id).await?;
            let mut record = AttemptRecord::decode(&run)?;
            let command = command(&record.id, "cancel", json!({}));
            let device_id = run.device_id.clone();
            let apply = record.attempt.request_cancel().map_err(admission_error)?;
            let terminal = record.terminal();
            if terminal {
                record.push(cancelled_before_verification());
            }
            if apply == Apply::Replayed || self.persist(run, record, true).await? {
                if terminal {
                    self.actors.remove(&run_id);
                } else {
                    self.send_connected(&device_id, command);
                }
                return Ok(());
            }
        }
        Err(reconcile())
    }

    pub(super) async fn permission(
        &self,
        actor: &ActorContext,
        run_id: u64,
        permission_id: &str,
        decision: Decision,
    ) -> AppResult<()> {
        self.authorize_actor(actor).await?;
        if !wire_id(permission_id) {
            return Err(AppError::BadRequest("invalid runner permission ID".into()));
        }
        for _ in 0..MAX_CAS_RETRIES {
            let run = self.browser_run(actor, run_id).await?;
            let mut record = AttemptRecord::decode(&run)?;
            let command = permission_reply(&record.id, permission_id, decision);
            let device_id = run.device_id.clone();
            let apply = record
                .attempt
                .answer_permission(permission_id, decision)
                .map_err(admission_error)?;
            if apply == Apply::Replayed || self.persist(run, record, true).await? {
                self.send_connected(&device_id, command);
                return Ok(());
            }
        }
        Err(reconcile())
    }

    fn send_connected(&self, device_id: &str, command: Value) {
        let socket = self
            .connections
            .get(device_id)
            .map(|connection| connection.clone());
        if let Some(socket) = socket {
            if send(&socket.sender, command).is_err() {
                // Disconnect a blocked socket so pending durable commands
                // replay after the runner reconnects.
                self.disconnect(device_id, socket.id);
            }
        }
    }

    async fn browser_run(&self, actor: &ActorContext, run_id: u64) -> AppResult<StoredRun> {
        let run = self
            .store
            .run(run_id)
            .await?
            .filter(|run| run.owner == owner(actor))
            .ok_or_else(device_denied)?;
        self.current_device(&run).await?;
        Ok(run)
    }

    async fn settle_unknown(&self, run_id: u64) -> AppResult<()> {
        for _ in 0..MAX_CAS_RETRIES {
            let Some(run) = self.store.run(run_id).await? else {
                return Ok(());
            };
            let mut record = AttemptRecord::decode(&run)?;
            if !run.active {
                return Ok(());
            }
            if record.attempt.state() == AttemptState::Verifying {
                record
                    .attempt
                    .finish_verification(false)
                    .map_err(admission_error)?;
            } else {
                record
                    .attempt
                    .mark_outcome_unknown()
                    .map_err(admission_error)?;
            }
            record.push(failed(
                "outcome_unknown",
                "The runner could not confirm this turn. Check the device before trying again.",
            ));
            if self.persist(run, record, false).await? {
                self.actors.remove(&run_id);
                return Ok(());
            }
        }
        Err(reconcile())
    }

    async fn persist(
        &self,
        mut run: StoredRun,
        record: AttemptRecord,
        require_fresh: bool,
    ) -> AppResult<bool> {
        let previous = run.version;
        run.version = previous
            .checked_add(1)
            .ok_or_else(|| AppError::Internal("runner revision overflow".into()))?;
        run.active = !record.terminal();
        run.payload = record.encode()?;
        self.store.update_run(&run, previous, require_fresh).await
    }

    async fn run_for_bearer(&self, bearer: &str) -> AppResult<(StoredRun, AttemptRecord)> {
        if !canonical_uuid(bearer) {
            return Err(device_denied());
        }
        let run = self
            .store
            .run_by_grant(&digest(bearer))
            .await?
            .filter(|run| run.active && run.expires_at_ms > now_ms())
            .ok_or_else(device_denied)?;
        let record = AttemptRecord::decode(&run)?;
        if !record.attempt.permits_tool_use() {
            return Err(device_denied());
        }
        self.current_device(&run).await?;
        Ok((run, record))
    }
}

#[async_trait]
impl RunnerMcpAuthority for RunnerDispatch {
    async fn authorize(&self, bearer: &str) -> AppResult<RunnerMcpGrant> {
        let (run, record) = self.run_for_bearer(bearer).await?;
        let actor = self.bound_actor(&run)?;
        self.authorize_actor(&actor).await?;
        Ok(RunnerMcpGrant {
            actor,
            privacy_policy: record.privacy_policy,
            run_id: run.run_id,
            attempt_id: record.id.attempt_id,
            allowed_tools: vec![INVENTORY_LOW_STOCK_TOOL.to_string()],
            device_id: run.device_id,
            lease_id: record.id.lease_id,
        })
    }

    async fn store_evidence(
        &self,
        bearer: &str,
        grant: &RunnerMcpGrant,
        evidence: LowStockEvidence,
    ) -> AppResult<()> {
        let evidence_id = evidence.id().to_string();
        let encoded = evidence.encode_stored()?;
        self.authorize_actor(&grant.actor).await?;
        for _ in 0..MAX_CAS_RETRIES {
            let (run, mut record) = self.run_for_bearer(bearer).await?;
            if run.run_id != grant.run_id
                || run.owner != owner(&grant.actor)
                || run.device_id != grant.device_id
                || record.id.attempt_id != grant.attempt_id
                || record.id.lease_id != grant.lease_id
                || record.privacy_policy != grant.privacy_policy
                || self.bound_actor(&run)? != grant.actor
            {
                return Err(device_denied());
            }
            if record.evidence.len() >= MAX_EVIDENCE {
                return Err(AppError::RateLimitExceeded(
                    "runner evidence budget reached".into(),
                ));
            }
            record.evidence.insert(evidence_id.clone(), encoded.clone());
            if self.persist(run, record, true).await? {
                return Ok(());
            }
        }
        Err(reconcile())
    }
}

pub(super) async fn authorize_actor(state: &AppState, actor: &ActorContext) -> AppResult<()> {
    require_scoped_capability_grant(
        state,
        &actor.identity,
        &actor.token,
        actor.organization_id,
        actor.company_id,
        LIFECYCLE_CAPABILITY,
    )
    .await?;
    Ok(())
}

pub(super) fn parse_run_id(value: &str) -> AppResult<u64> {
    value
        .parse::<u64>()
        .ok()
        .filter(|id| {
            *id != 0 && u128::from(*id) <= MAX_SAFE_WIRE_INTEGER && id.to_string() == value
        })
        .ok_or_else(|| AppError::BadRequest("invalid runner run ID".into()))
}

fn owner(actor: &ActorContext) -> RunnerOwner {
    RunnerOwner {
        organization_id: actor.organization_id,
        company_id: actor.company_id,
        actor_identity: actor
            .identity
            .strip_prefix("0x")
            .or_else(|| actor.identity.strip_prefix("0X"))
            .unwrap_or(&actor.identity)
            .to_ascii_lowercase(),
    }
}

fn scope_for(run: &StoredRun) -> DeviceScope {
    DeviceScope {
        organization_id: run.owner.organization_id,
        company_id: run.owner.company_id,
        actor_identity: run.owner.actor_identity.clone(),
        device_id: run.device_id.clone(),
    }
}

fn now_ms() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX - LEASE_LIFETIME_MS)
}

fn canonical_uuid(value: &str) -> bool {
    value.len() == 36 && Uuid::parse_str(value).is_ok_and(|uuid| uuid.to_string() == value)
}

fn wire_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    (1..=128).contains(&value.len())
        && bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || b"_.:-".contains(&byte))
}

fn digest(secret: &str) -> String {
    format!("{:x}", Sha256::digest(secret.as_bytes()))
}

fn device_denied() -> AppError {
    AppError::Forbidden("runner device or attempt is unauthorized".into())
}

fn reconcile() -> AppError {
    AppError::Unavailable("runner is reconciling its last operation".into())
}

fn admission_error(error: AdmissionError) -> AppError {
    match error {
        AdmissionError::Scope | AdmissionError::Lease => device_denied(),
        AdmissionError::Capacity => AppError::RateLimitExceeded(error.to_string()),
        _ => AppError::BadRequest(error.to_string()),
    }
}

fn validate_providers(providers: &[ProviderStatus]) -> AppResult<()> {
    if providers.len() > 4
        || providers.iter().enumerate().any(|(index, provider)| {
            providers[..index]
                .iter()
                .any(|prior| prior.provider == provider.provider)
                || provider.version.as_ref().is_some_and(|value| {
                    value.trim().is_empty()
                        || value.encode_utf16().count() > 128
                        || value.chars().any(char::is_control)
                })
                || provider.capabilities.len() > 5
                || provider
                    .capabilities
                    .iter()
                    .enumerate()
                    .any(|(index, capability)| provider.capabilities[..index].contains(capability))
        })
    {
        return Err(AppError::BadRequest(
            "invalid runner provider discovery".into(),
        ));
    }
    Ok(())
}

fn send(sender: &mpsc::Sender<Value>, value: Value) -> AppResult<()> {
    sender
        .try_send(value)
        .map_err(|_| AppError::Unavailable("runner connection cannot accept dispatch".into()))
}

fn command(id: &AttemptId, kind: &str, mut value: Value) -> Value {
    value["type"] = json!(kind);
    value["runId"] = json!(id.run_id);
    value["attemptId"] = json!(id.attempt_id);
    value["leaseId"] = json!(id.lease_id);
    value
}

pub(super) fn acknowledgement(frame: &EventFrame) -> Value {
    json!({
        "type": "ack",
        "runId": frame.run_id,
        "attemptId": frame.attempt_id,
        "leaseId": frame.lease_id,
        "seq": frame.seq
    })
}

fn permission_reply(id: &AttemptId, permission_id: &str, decision: Decision) -> Value {
    command(
        id,
        "permissionReply",
        json!({ "permissionId": permission_id, "decision": decision }),
    )
}

fn cancelled_before_verification() -> Value {
    failed(
        "candidate_withheld",
        "The run was cancelled before its answer could be verified.",
    )
}

fn failed(code: &str, message: &str) -> Value {
    json!({ "type": "failed", "code": code, "message": message })
}

fn verified_event(run_id: u64, reply: VerifiedLowStockReadback) -> Value {
    let sources = reply
        .sources
        .into_iter()
        .map(|source| {
            json!({
                "kind": "live",
                "trust": "authoritative",
                "entity_type": "product",
                "entity_id": source.product_id,
                "label": source.label,
                "text_snippet": ""
            })
        })
        .collect::<Vec<_>>();
    json!({
        "type": "verified",
        "answer": reply.answer,
        "evidence_id": reply.evidence_id,
        "run_id": run_id,
        "sources": sources
    })
}

fn browser_event(event: &RunnerEvent) -> Option<Value> {
    match event {
        RunnerEvent::Activity { .. } => Some(json!({
            "type": "activity",
            "message": "The local provider is working."
        })),
        RunnerEvent::Tool {
            tool_id, status, ..
        } => Some(json!({
            "type": "tool", "toolId": digest(tool_id), "name": INVENTORY_LOW_STOCK_TOOL, "status": status
        })),
        RunnerEvent::Permission { permission_id, .. } => Some(json!({
            "type": "permission", "permissionId": permission_id,
            "label": "The local provider requested permission."
        })),
        RunnerEvent::Failed { code, .. } if code == "outcome_unknown" => Some(failed(
            "outcome_unknown",
            "The local runner could not confirm the turn outcome.",
        )),
        RunnerEvent::Failed { .. } => Some(failed("runner_failed", "The local run failed.")),
        RunnerEvent::Session { .. } | RunnerEvent::Candidate { .. } => None,
        other => serde_json::to_value(other).ok(),
    }
}
