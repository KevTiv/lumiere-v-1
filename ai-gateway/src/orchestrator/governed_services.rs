//! GP-03 (governed intelligence program): shared governed execution
//! services.
//!
//! `governed-intelligence-program-migration.md` names seven responsibilities
//! that must be extracted from the loop into shared services so that a
//! typed `CapabilityStep`/`DecisionStep` (GP-08) and an accepted
//! `ReasoningStep` proposal (GP-02/GP-04) all execute through **one**
//! authorization/policy/recovery path instead of a loop-specific copy:
//!
//! ```text
//! CapabilityAdmission
//! CapabilityExecutor
//! SpendAdmission/Settlement
//! ApprovalCoordinator
//! VerificationService
//! ExecutionRecovery
//! FinalAnswerAdmission
//! ```
//!
//! Disposition of each, in this module:
//!
//! - `CapabilityAdmission` / `CapabilityExecutor`: new traits here, but they
//!   are thin wrappers over the *same* `LoopPolicy`/`LoopTools` trait
//!   objects `run_loop` already uses (`agent_loop.rs`). This is
//!   deliberate: the requirement is one policy/execution path, not a
//!   second one that happens to agree with the first. A
//!   `CapabilityProposal` (GP-01) is converted to the existing
//!   `ToolCallRequest` shape and handed to the same objects.
//! - `SpendAdmission`/`Settlement`: already a shared service
//!   (`spend_admission::SpendLedger`/`SpendAdmittedLlm`), explicitly
//!   retained per the migration doc. Nothing new is added here; the GP-02
//!   adapters are already generic over `&dyn LlmCompletion`, so composing
//!   them with `SpendAdmittedLlm` gives durable spend admission for
//!   `DecisionProvider`/`ReasoningProvider` calls with no code change.
//! - `ExecutionRecovery`: computes a deterministic, content-addressed
//!   recovery key from `(run_id, capability, arguments)` — never a
//!   model-supplied id — so a proposal repeated by model retry (same
//!   round or a resumed run) replays the recorded outcome instead of
//!   re-executing. This is what "mutation recovery never depends on model
//!   retry behavior" requires structurally. `InMemoryExecutionRecovery` is
//!   the reference/test implementation; `StdbExecutionRecovery` binds this
//!   to the durable `ai_capability_execution` store
//!   (`spacetimedb/src/ai/capability_execution.rs`) so recovery survives a
//!   process restart, not just a single run.
//! - `ApprovalCoordinator`: new, minimal. A `DraftOnly` admission decision
//!   already exists as `LoopStop::PendingApproval` in the current loop,
//!   backed by the H5 action-draft reducer path. This trait names that
//!   seam so `GovernedCapabilityService` can surface it uniformly; binding
//!   it to the H5 draft-creation reducer is a GP-04 wiring step; a draft
//!   is not fabricated here.
//! - `VerificationService` / `FinalAnswerAdmission`: the full evidence/
//!   answer gate remains AIH-15's dedicated scope (§7.3 of the completion
//!   plan) — passage/source-version matching, applicability/effective-date
//!   checks, arithmetic verification, and model-assisted claim-coverage /
//!   prose-to-evidence consistency are not implemented here.
//!   `DeterministicFinalAnswerAdmission` does perform one real §7.3 check
//!   deterministically: every citation a `FinalDraft` carries must resolve
//!   against evidence the server actually produced for this run, or the
//!   draft is blocked — "resolve citations server-side... fabricated IDs
//!   ... cannot produce a validated unsupported claim" applied literally,
//!   not just structural shape. `VerificationMethod` records which kind of
//!   check produced an outcome, per §7.3's "record whether that check was
//!   deterministic, model-assisted, or human-reviewed."
//!
//! `GovernedCapabilityService::run` is the composed entry point: admission
//! -> recovery lookup -> execution -> output protection -> recovery
//! record. `run.rs`/`proposal_loop.rs` construct it with
//! `StdbExecutionRecovery` for the `report_analysis` governed program path.

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::agent_loop::{LoopPolicy, LoopTools};
use super::intelligence::{CapabilityProposal, EvidenceRef, FinalDraft};
use crate::{
    harness::audit::{DecisionOutcome, PolicyDecision},
    providers::llm::ToolCallRequest,
    tools::types::ToolOutput,
};

fn proposal_to_call(proposal: &CapabilityProposal) -> ToolCallRequest {
    ToolCallRequest {
        id: None,
        name: proposal.capability.clone(),
        arguments: proposal.arguments.clone(),
        arguments_error: None,
    }
}

fn reason_summary(decision: &PolicyDecision) -> String {
    if decision.reasons.is_empty() {
        return format!("{:?}", decision.outcome);
    }
    decision
        .reasons
        .iter()
        .map(|r| r.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
}

/// Authorization/policy admission for one capability proposal. The only
/// production implementation (`PolicyBackedCapabilityAdmission`) delegates
/// to the same `LoopPolicy` the direct-execution loop uses today.
#[async_trait]
pub(super) trait CapabilityAdmission: Send + Sync {
    async fn admit(
        &self,
        proposal: &CapabilityProposal,
        completed_calls: u32,
    ) -> Result<PolicyDecision>;

    async fn protect_output(
        &self,
        proposal: &CapabilityProposal,
        completed_calls: u32,
        output: ToolOutput,
    ) -> Result<ToolOutput>;
}

pub(super) struct PolicyBackedCapabilityAdmission<'a> {
    policy: &'a dyn LoopPolicy,
}

impl<'a> PolicyBackedCapabilityAdmission<'a> {
    pub fn new(policy: &'a dyn LoopPolicy) -> Self {
        Self { policy }
    }
}

#[async_trait]
impl CapabilityAdmission for PolicyBackedCapabilityAdmission<'_> {
    async fn admit(
        &self,
        proposal: &CapabilityProposal,
        completed_calls: u32,
    ) -> Result<PolicyDecision> {
        self.policy
            .evaluate(&proposal_to_call(proposal), completed_calls)
            .await
    }

    async fn protect_output(
        &self,
        proposal: &CapabilityProposal,
        completed_calls: u32,
        output: ToolOutput,
    ) -> Result<ToolOutput> {
        self.policy
            .protect_output(&proposal_to_call(proposal), completed_calls, output)
            .await
    }
}

/// Executes one admitted capability proposal. The only production
/// implementation (`ToolsBackedCapabilityExecutor`) delegates to the same
/// `LoopTools` the direct-execution loop uses today — generated capability
/// IR remains the only executable ERP vocabulary either way.
#[async_trait]
pub(super) trait CapabilityExecutor: Send + Sync {
    async fn execute(&self, proposal: &CapabilityProposal) -> Result<ToolOutput>;
}

pub(super) struct ToolsBackedCapabilityExecutor<'a> {
    tools: &'a dyn LoopTools,
}

impl<'a> ToolsBackedCapabilityExecutor<'a> {
    pub fn new(tools: &'a dyn LoopTools) -> Self {
        Self { tools }
    }
}

#[async_trait]
impl CapabilityExecutor for ToolsBackedCapabilityExecutor<'_> {
    async fn execute(&self, proposal: &CapabilityProposal) -> Result<ToolOutput> {
        self.tools.execute(&proposal_to_call(proposal)).await
    }
}

/// Deduplicates capability execution by a deterministic, content-addressed
/// key rather than anything the model supplies, so a repeated proposal
/// (model retry, resumed run) replays the recorded outcome instead of
/// re-executing a mutation.
#[async_trait]
pub(super) trait ExecutionRecovery: Send + Sync {
    fn recovery_key(&self, run_id: u64, proposal: &CapabilityProposal) -> Result<String>;
    async fn already_executed(
        &self,
        run_id: u64,
        proposal: &CapabilityProposal,
        key: &str,
    ) -> Result<Option<ToolOutput>>;
    async fn record_outcome(
        &self,
        run_id: u64,
        proposal: &CapabilityProposal,
        key: &str,
        output: &ToolOutput,
    ) -> Result<()>;
}

/// Deterministic, content-addressed recovery key derivation shared by every
/// `ExecutionRecovery` implementation — `(run_id, capability, arguments)`,
/// never a model-supplied id, so a proposal repeated by model retry or a
/// resumed run maps to the same durable key.
fn capability_recovery_key(run_id: u64, proposal: &CapabilityProposal) -> Result<String> {
    if run_id == 0 {
        bail!("recovery key requires a durable nonzero run_id");
    }
    let canonical = serde_json::to_vec(&(run_id, &proposal.capability, &proposal.arguments))
        .context("serialize capability proposal for recovery key")?;
    let digest = Sha256::digest(&canonical);
    Ok(format!("gp03:capability:{digest:x}"))
}

/// Deterministic, run-scoped idempotency key for one capability's durable
/// approval draft, so a proposal repeated by model retry or a resumed run
/// resolves the same `AiActionDraft` instead of creating another. Shares
/// `ai_spend::input_request_key`'s scheme (`h5:draft:run:<id>:input:<hex>`)
/// so it round-trips through the same `SpendReader::draft_request` lookup
/// `tools::action_draft`'s run-correlated path already uses.
fn approval_request_key(run_id: u64, proposal: &CapabilityProposal) -> Result<String> {
    crate::ai_spend::input_request_key(
        crate::ai_spend::RequestKind::Draft,
        run_id,
        &serde_json::json!({
            "capability": proposal.capability,
            "arguments": proposal.arguments,
        }),
    )
}

/// Reference implementation used in tests and by any caller that does not
/// require durability across process restarts. `StdbExecutionRecovery`
/// below is the production implementation.
pub(super) struct InMemoryExecutionRecovery {
    seen: std::sync::Mutex<std::collections::HashMap<String, ToolOutput>>,
}

impl InMemoryExecutionRecovery {
    pub fn new() -> Self {
        Self {
            seen: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
}

impl Default for InMemoryExecutionRecovery {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ExecutionRecovery for InMemoryExecutionRecovery {
    fn recovery_key(&self, run_id: u64, proposal: &CapabilityProposal) -> Result<String> {
        capability_recovery_key(run_id, proposal)
    }

    async fn already_executed(
        &self,
        _run_id: u64,
        _proposal: &CapabilityProposal,
        key: &str,
    ) -> Result<Option<ToolOutput>> {
        Ok(self.seen.lock().unwrap().get(key).cloned())
    }

    async fn record_outcome(
        &self,
        _run_id: u64,
        _proposal: &CapabilityProposal,
        key: &str,
        output: &ToolOutput,
    ) -> Result<()> {
        self.seen
            .lock()
            .unwrap()
            .insert(key.to_string(), output.clone());
        Ok(())
    }
}

/// Production implementation. Binds `ExecutionRecovery` to the durable,
/// organization-owned `ai_capability_execution` store
/// (`spacetimedb/src/ai/capability_execution.rs`) so a capability proposal
/// repeated by model retry or a *resumed run* replays the recorded outcome
/// instead of re-executing a mutation — the in-process
/// `InMemoryExecutionRecovery` above only survives one process lifetime.
///
/// `writer` calls the two `ai_capability_execution` reducers and must be a
/// principal already granted `ai_capability_execution/write`. `reader`
/// queries the row back (the table is private, so a plain client cannot
/// subscribe to it) — mirroring `StdbSpendLedger`, this reuses the
/// dedicated `AI_SPEND_READ_STDB_TOKEN` read principal rather than adding a
/// second one, since both are internal ledger-style tables read by the same
/// gateway process.
///
/// A row found in status `"claimed"` (an earlier claim with no recorded
/// outcome — either genuinely in flight or left behind by a crashed
/// process) is deliberately *not* treated as safe to re-execute: unlike
/// `ai_spend`'s `outcome_unknown`, nothing here can distinguish "still
/// running" from "crashed before recording," so silently proceeding could
/// double-execute a mutation. It surfaces as an error requiring explicit
/// reconciliation instead.
pub(super) struct StdbExecutionRecovery<'a> {
    pub writer: &'a stdb_client::StdbClient,
    pub reader: &'a stdb_client::StdbClient,
    pub organization_id: u64,
    pub company_id: u64,
}

#[derive(Debug)]
struct CapabilityExecutionRow {
    status: String,
    output_json: Option<String>,
    failure_reason: Option<String>,
}

impl StdbExecutionRecovery<'_> {
    async fn load(&self, key: &str) -> Result<Option<CapabilityExecutionRow>> {
        let key = key.replace('\'', "''");
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_capability_execution WHERE organization_id = {} \
                 AND recovery_key = '{key}' LIMIT 1",
                self.organization_id
            ))
            .await
            .context("load durable capability execution recovery row")?;
        rows.first().map(decode_capability_execution_row).transpose()
    }

    async fn claim(&self, run_id: u64, proposal: &CapabilityProposal, key: &str) -> Result<()> {
        self.writer
            .call_reducer(stdb_client::ReducerCall::from_name(
                "claim_ai_capability_execution",
                serde_json::json!([
                    self.organization_id,
                    {
                        "company_id": self.company_id,
                        "run_id": run_id,
                        "recovery_key": key,
                        "capability": proposal.capability,
                    }
                ]),
            ))
            .await
            .context("claim durable capability execution")
    }
}

#[async_trait]
impl ExecutionRecovery for StdbExecutionRecovery<'_> {
    fn recovery_key(&self, run_id: u64, proposal: &CapabilityProposal) -> Result<String> {
        capability_recovery_key(run_id, proposal)
    }

    async fn already_executed(
        &self,
        run_id: u64,
        proposal: &CapabilityProposal,
        key: &str,
    ) -> Result<Option<ToolOutput>> {
        if self.organization_id == 0 || self.company_id == 0 {
            bail!("durable execution recovery requires organization and company context");
        }
        if let Some(row) = self.load(key).await? {
            return match row.status.as_str() {
                "succeeded" => {
                    let output_json = row
                        .output_json
                        .context("succeeded capability execution row is missing output_json")?;
                    let output: ToolOutput = serde_json::from_str(&output_json)
                        .context("decode replayed capability execution output")?;
                    Ok(Some(output))
                }
                "failed" => bail!(
                    "capability execution for recovery key '{key}' previously failed ({}); \
                     requires reconciliation before retry",
                    row.failure_reason.as_deref().unwrap_or("no reason recorded")
                ),
                "claimed" => bail!(
                    "capability execution for recovery key '{key}' is claimed but unresolved; \
                     requires reconciliation before retry, not automatic re-execution"
                ),
                other => bail!("unexpected capability execution status '{other}'"),
            };
        }
        self.claim(run_id, proposal, key).await?;
        Ok(None)
    }

    async fn record_outcome(
        &self,
        _run_id: u64,
        _proposal: &CapabilityProposal,
        key: &str,
        output: &ToolOutput,
    ) -> Result<()> {
        let output_json = serde_json::to_string(output).context("serialize capability output")?;
        let output_hash = format!("{:x}", Sha256::digest(output_json.as_bytes()));
        self.writer
            .call_reducer(stdb_client::ReducerCall::from_name(
                "record_ai_capability_execution_result",
                serde_json::json!([
                    self.organization_id,
                    {
                        "recovery_key": key,
                        "status": "succeeded",
                        "output_json": output_json,
                        "output_hash": output_hash,
                        "failure_reason": null,
                    }
                ]),
            ))
            .await
            .context("record durable capability execution result")
    }
}

fn decode_capability_execution_row(row: &Value) -> Result<CapabilityExecutionRow> {
    let status = row
        .get("status")
        .and_then(Value::as_str)
        .context("capability execution row missing status")?
        .to_string();
    let output_json = row
        .get("outputJson")
        .or_else(|| row.get("output_json"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let failure_reason = row
        .get("failureReason")
        .or_else(|| row.get("failure_reason"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(CapabilityExecutionRow {
        status,
        output_json,
        failure_reason,
    })
}

/// Names the seam a `DraftOnly` admission decision routes through.
/// `StdbApprovalCoordinator` binds it to the existing H5 action-draft
/// reducer path so approval is a real, human-actionable durable record
/// rather than only an in-memory value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ApprovalStatus {
    Pending,
    Approved { execution_record_id: Option<u64> },
    Rejected(String),
}

#[async_trait]
pub(super) trait ApprovalCoordinator: Send + Sync {
    async fn request_approval(
        &self,
        run_id: u64,
        proposal: &CapabilityProposal,
        decision: &PolicyDecision,
    ) -> Result<ApprovalRequest>;

    async fn approval_status(&self, draft_id: u64) -> Result<ApprovalStatus>;
}

#[derive(Clone, Debug)]
pub(super) struct ApprovalRequest {
    pub capability: String,
    pub reason: String,
    /// The durable `AiActionDraft` id a human reviews/approves, when the
    /// coordinator created one. `None` for `RecordingApprovalCoordinator`.
    pub draft_id: Option<u64>,
}

/// Records the approval requirement without creating a durable draft.
/// Reference/test implementation; `StdbApprovalCoordinator` is production.
pub(super) struct RecordingApprovalCoordinator;

#[async_trait]
impl ApprovalCoordinator for RecordingApprovalCoordinator {
    async fn request_approval(
        &self,
        _run_id: u64,
        proposal: &CapabilityProposal,
        decision: &PolicyDecision,
    ) -> Result<ApprovalRequest> {
        Ok(ApprovalRequest {
            capability: proposal.capability.clone(),
            reason: reason_summary(decision),
            draft_id: None,
        })
    }

    async fn approval_status(&self, _draft_id: u64) -> Result<ApprovalStatus> {
        Ok(ApprovalStatus::Pending)
    }
}

/// Production implementation. Binds `ApprovalCoordinator` to the durable H5
/// action-draft path (`create_ai_run_action_draft`,
/// `spacetimedb/src/ai/action_drafts.rs`) so a `DraftOnly` policy decision
/// produces a real `AiActionDraft` row a human can review, rather than only
/// an in-memory `ApprovalRequest`. Approving that row directly executes
/// `proposal.capability` (as `reducer_name`) with `proposal.arguments` (as
/// `params_json`), so this only ever succeeds for a capability already
/// present in the organization's `ai_reducer_allowlist` — a capability
/// outside it fails closed with a clear "reducer not allowed" error at
/// draft-creation time (`create_ai_action_draft_inner` checks the
/// allowlist immediately, not only at approval), never a misleading or
/// inert draft.
///
/// `elevated` is always false here: the drafts library's elevated path
/// requires governance metadata (source/diff hashes, a correction plan)
/// this call site has no basis to fabricate. A `DraftOnly` policy decision
/// is already the approval gate; claiming `elevated` on top of it without
/// real data would misrepresent the audit trail rather than strengthen it.
///
/// Uses the same request-key idempotency and `AI_SPEND_READ_STDB_TOKEN`
/// read-back pattern as `tools::action_draft`'s run-correlated path
/// (`ai_spend::input_request_key`/`create_run_action_draft`/`SpendReader`),
/// so a repeated proposal (model retry, resumed run) resolves the same
/// draft id instead of creating another.
pub(super) struct StdbApprovalCoordinator<'a> {
    pub writer: &'a stdb_client::StdbClient,
    pub reader: &'a stdb_client::StdbClient,
    pub organization_id: u64,
    pub company_id: u64,
}

#[async_trait]
impl ApprovalCoordinator for StdbApprovalCoordinator<'_> {
    async fn request_approval(
        &self,
        run_id: u64,
        proposal: &CapabilityProposal,
        decision: &PolicyDecision,
    ) -> Result<ApprovalRequest> {
        if self.organization_id == 0 || self.company_id == 0 {
            bail!("durable approval requires organization and company context");
        }
        let reason = reason_summary(decision);
        let params_json =
            serde_json::to_string(&proposal.arguments).context("serialize capability arguments")?;
        let summary = proposal
            .rationale
            .clone()
            .unwrap_or_else(|| format!("{} requires approval", proposal.capability));
        let metadata = serde_json::to_string(&serde_json::json!({
            "run_id": run_id,
            "reason": reason,
        }))
        .ok();
        let draft_params = serde_json::json!({
            "reducer_name": proposal.capability,
            "params_json": params_json,
            "summary": summary,
            "confidence": 1.0,
            "elevated": false,
            "warnings_json": Value::Null,
            "source_query": Value::Null,
            "ui_context_json": Value::Null,
            "expires_at": Value::Null,
            "metadata": metadata,
        });
        let request_key = approval_request_key(run_id, proposal)?;
        crate::ai_spend::create_run_action_draft(
            self.writer,
            self.organization_id,
            self.company_id,
            run_id,
            &request_key,
            draft_params,
        )
        .await
        .context("create durable approval draft for capability proposal")?;
        let draft_id = crate::ai_spend::SpendReader::new(self.reader)
            .draft_request(self.organization_id, self.company_id, run_id, &request_key)
            .await
            .context("resolve durable approval draft id")?
            .map(|request| request.draft_id);
        Ok(ApprovalRequest {
            capability: proposal.capability.clone(),
            reason,
            draft_id,
        })
    }

    async fn approval_status(&self, draft_id: u64) -> Result<ApprovalStatus> {
        if draft_id == 0 {
            bail!("approval draft id must be nonzero");
        }
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_action_draft WHERE organization_id = {}                  AND company_id = {} AND id = {} LIMIT 1",
                self.organization_id, self.company_id, draft_id
            ))
            .await
            .context("load durable approval draft status")?;
        let row = rows.first().context("approval draft not found")?;
        let status = row
            .get("status")
            .and_then(Value::as_str)
            .context("approval draft status missing")?;
        Ok(match status {
            "pending" => ApprovalStatus::Pending,
            "approved" => ApprovalStatus::Approved {
                execution_record_id: row
                    .get("executionRecordId")
                    .or_else(|| row.get("execution_record_id"))
                    .and_then(Value::as_u64),
            },
            "rejected" => ApprovalStatus::Rejected(
                row.get("rejectReason")
                    .or_else(|| row.get("reject_reason"))
                    .and_then(Value::as_str)
                    .unwrap_or("approval was rejected")
                    .to_string(),
            ),
            "failed" => ApprovalStatus::Rejected(
                row.get("executionError")
                    .or_else(|| row.get("execution_error"))
                    .and_then(Value::as_str)
                    .unwrap_or("approved action execution failed")
                    .to_string(),
            ),
            "expired" => ApprovalStatus::Rejected("approval draft expired".to_string()),
            other => bail!("unknown approval draft status '{other}'"),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum VerificationOutcome {
    Verified,
    RequiresReview { reason: String },
    Failed { reason: String },
}

/// Validates a capability's output/evidence before it may feed a decision
/// or final answer. This is a **shape-only placeholder**: it does not
/// resolve citations, check applicability/effective dates, or verify
/// arithmetic. AIH-15 owns that full evidence/answer gate; this trait only
/// reserves the seam so later steps route through *a* verification call
/// rather than none.
#[async_trait]
pub(super) trait VerificationService: Send + Sync {
    async fn verify(
        &self,
        output: &ToolOutput,
        evidence: &[EvidenceRef],
    ) -> Result<VerificationOutcome>;
}

pub(super) struct ShapeOnlyVerificationService;

#[async_trait]
impl VerificationService for ShapeOnlyVerificationService {
    async fn verify(
        &self,
        output: &ToolOutput,
        evidence: &[EvidenceRef],
    ) -> Result<VerificationOutcome> {
        if output.summary.trim().is_empty() {
            return Ok(VerificationOutcome::Failed {
                reason: "capability output has no summary to verify".to_string(),
            });
        }
        for reference in evidence {
            if let Err(error) = reference.validate() {
                return Ok(VerificationOutcome::Failed {
                    reason: format!("invalid evidence reference: {error}"),
                });
            }
        }
        if evidence.is_empty() && matches!(output.data, Value::Null) {
            return Ok(VerificationOutcome::RequiresReview {
                reason: "no evidence and no structured output data to check".to_string(),
            });
        }
        Ok(VerificationOutcome::Verified)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum AnswerAdmissionOutcome {
    Admitted,
    RequiresReview { reason: String },
    Blocked { reason: String },
}

/// Which kind of check produced a `VerificationOutcome`/
/// `AnswerAdmissionOutcome` — §7.3 requires this be recorded, since
/// "a model-assisted semantic check is fallible and cannot confer domain
/// approval." `Deterministic` is a plain mechanical check (citation
/// existence, shape, arithmetic); `ModelAssisted` used a provider call and
/// is therefore fallible; `HumanReviewed` means a person, not code, made
/// the call. Nothing in this module produces `ModelAssisted` or
/// `HumanReviewed` today — both are real AIH-15 scope, not implemented
/// here — but the type exists now so a caller records which kind of
/// evidence it is holding rather than treating every outcome as
/// equally authoritative.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum VerificationMethod {
    Deterministic,
    ModelAssisted,
    HumanReviewed,
}

impl VerificationMethod {
    pub fn label(self) -> &'static str {
        match self {
            Self::Deterministic => "deterministic",
            Self::ModelAssisted => "model_assisted",
            Self::HumanReviewed => "human_reviewed",
        }
    }
}

/// Gate a `FinalDraft` must pass before it is presented as complete.
///
/// `known_evidence` is the set of `EvidenceRef`s the *server* actually
/// produced for this run — `context.evidence` plus every
/// `"capability_output"` ref a real tool-backed node produced (see
/// `evidence_for_node`/`known_evidence_for_run` in `governed_program.rs`).
/// `DeterministicFinalAnswerAdmission` checks every citation in the draft
/// against that set: §7.3's "resolve citations server-side, never a
/// model-invented URL" applied literally, since `draft` itself comes
/// straight from provider output (`ReasoningOutcome::FinalDraft`) and
/// nothing about `EvidenceRef`'s shape alone proves the model didn't just
/// invent a plausible-looking kind/id pair.
///
/// What this still does **not** do, and is real remaining AIH-15/§7.3
/// scope: passage/source-version matching within a resolved citation,
/// applicability/effective-date checks, arithmetic verification, and
/// claim-coverage / prose-to-evidence consistency (which needs a
/// model-assisted semantic check — `VerificationMethod::ModelAssisted` —
/// since it cannot be done by citation-existence alone).
#[async_trait]
pub(super) trait FinalAnswerAdmission: Send + Sync {
    async fn admit(
        &self,
        draft: &FinalDraft,
        known_evidence: &std::collections::HashSet<EvidenceRef>,
    ) -> Result<AnswerAdmissionOutcome>;
}

pub(super) struct ShapeOnlyFinalAnswerAdmission;

#[async_trait]
impl FinalAnswerAdmission for ShapeOnlyFinalAnswerAdmission {
    async fn admit(
        &self,
        draft: &FinalDraft,
        _known_evidence: &std::collections::HashSet<EvidenceRef>,
    ) -> Result<AnswerAdmissionOutcome> {
        if let Err(error) = draft.validate() {
            return Ok(AnswerAdmissionOutcome::Blocked {
                reason: error.to_string(),
            });
        }
        if draft.citations.is_empty() {
            return Ok(AnswerAdmissionOutcome::RequiresReview {
                reason: "final draft carries no evidence citations".to_string(),
            });
        }
        Ok(AnswerAdmissionOutcome::Admitted)
    }
}

pub(super) struct DeterministicFinalAnswerAdmission;

#[async_trait]
impl FinalAnswerAdmission for DeterministicFinalAnswerAdmission {
    async fn admit(
        &self,
        draft: &FinalDraft,
        known_evidence: &std::collections::HashSet<EvidenceRef>,
    ) -> Result<AnswerAdmissionOutcome> {
        if let Err(error) = draft.validate() {
            return Ok(AnswerAdmissionOutcome::Blocked {
                reason: error.to_string(),
            });
        }
        if draft.citations.is_empty() {
            return Ok(AnswerAdmissionOutcome::RequiresReview {
                reason: "final draft carries no evidence citations".to_string(),
            });
        }
        if let Some(fabricated) = draft
            .citations
            .iter()
            .find(|citation| !known_evidence.contains(citation))
        {
            return Ok(AnswerAdmissionOutcome::Blocked {
                reason: format!(
                    "citation '{}:{}' does not correspond to evidence this run actually produced",
                    fabricated.kind, fabricated.id
                ),
            });
        }
        Ok(AnswerAdmissionOutcome::Admitted)
    }
}

/// Outcome of routing one capability proposal through the composed
/// governed path.
#[derive(Clone, Debug)]
pub(super) enum CapabilityStepOutcome {
    Executed(ToolOutput),
    /// A prior identical proposal already ran for this run; the recorded
    /// outcome was replayed instead of executing again.
    Replayed(ToolOutput),
    Denied(String),
    PendingApproval(ApprovalRequest),
}

/// The single composed path a typed `CapabilityStep`, `DecisionStep`
/// (indirectly, via a `CapabilityProposal` it emits) and an accepted
/// `ReasoningStep` proposal all use: admission -> recovery lookup ->
/// execution -> output protection -> recovery record. The governed program
/// runtime and proposal-only reasoning path both reuse this service.
pub(super) struct GovernedCapabilityService<'a> {
    admission: &'a dyn CapabilityAdmission,
    executor: &'a dyn CapabilityExecutor,
    recovery: &'a dyn ExecutionRecovery,
    approvals: &'a dyn ApprovalCoordinator,
}

impl<'a> GovernedCapabilityService<'a> {
    pub fn new(
        admission: &'a dyn CapabilityAdmission,
        executor: &'a dyn CapabilityExecutor,
        recovery: &'a dyn ExecutionRecovery,
        approvals: &'a dyn ApprovalCoordinator,
    ) -> Self {
        Self {
            admission,
            executor,
            recovery,
            approvals,
        }
    }

    pub async fn request_explicit_approval(
        &self,
        run_id: u64,
        proposal: &CapabilityProposal,
        completed_calls: u32,
    ) -> Result<Result<ApprovalRequest, String>> {
        proposal.validate().context("invalid approval capability proposal")?;
        let mut decision = self.admission.admit(proposal, completed_calls).await?;
        if decision.outcome == DecisionOutcome::Deny {
            return Ok(Err(reason_summary(&decision)));
        }
        decision.outcome = DecisionOutcome::DraftOnly;
        let request = self
            .approvals
            .request_approval(run_id, proposal, &decision)
            .await?;
        Ok(Ok(request))
    }

    pub async fn approval_status(&self, draft_id: u64) -> Result<ApprovalStatus> {
        self.approvals.approval_status(draft_id).await
    }

    pub async fn run(
        &self,
        run_id: u64,
        proposal: &CapabilityProposal,
        completed_calls: u32,
    ) -> Result<CapabilityStepOutcome> {
        proposal.validate().context("invalid capability proposal")?;

        let decision = self.admission.admit(proposal, completed_calls).await?;
        match decision.outcome {
            DecisionOutcome::Deny => {
                return Ok(CapabilityStepOutcome::Denied(reason_summary(&decision)));
            }
            DecisionOutcome::DraftOnly => {
                let request = self
                    .approvals
                    .request_approval(run_id, proposal, &decision)
                    .await?;
                return Ok(CapabilityStepOutcome::PendingApproval(request));
            }
            DecisionOutcome::Allow => {}
        }

        let key = self.recovery.recovery_key(run_id, proposal)?;
        if let Some(cached) = self.recovery.already_executed(run_id, proposal, &key).await? {
            return Ok(CapabilityStepOutcome::Replayed(cached));
        }

        let output = self.executor.execute(proposal).await?;
        let output = self
            .admission
            .protect_output(proposal, completed_calls, output)
            .await?;
        self.recovery
            .record_outcome(run_id, proposal, &key, &output)
            .await?;
        Ok(CapabilityStepOutcome::Executed(output))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::audit::{
        CorrelationMetadata, DecisionHashes, DecisionReason, PolicyReasonCode,
    };
    use crate::harness::manifest::SkillVersionRef;
    use serde_json::json;
    use std::sync::Mutex as StdMutex;

    fn proposal() -> CapabilityProposal {
        CapabilityProposal {
            capability: "erp.search".to_string(),
            arguments: json!({"q": "PO-42"}),
            rationale: None,
        }
    }

    fn output(summary: &str) -> ToolOutput {
        ToolOutput {
            summary: summary.to_string(),
            data: json!({"rows": 1}),
            citations: vec![],
            row_count: Some(1),
        }
    }

    fn decision(outcome: DecisionOutcome) -> PolicyDecision {
        PolicyDecision {
            outcome,
            skill: SkillVersionRef::new("test-skill", 1),
            risk: None,
            reasons: vec![DecisionReason::new(
                PolicyReasonCode::Allowed,
                "test policy",
            )],
            correlation: CorrelationMetadata {
                correlation_id: "test-correlation".into(),
                organization_id: 1,
                company_id: 1,
                actor_id: Some("test-actor".into()),
                causation_id: Some("test-causation".into()),
            },
            hashes: DecisionHashes {
                request_hash: "request-hash".into(),
                input_hash: "input-hash".into(),
                manifest_hash: Some("manifest-hash".into()),
            },
            enforced_limits: None,
        }
    }

    struct FakePolicy {
        outcome: DecisionOutcome,
        evaluate_calls: StdMutex<u32>,
    }

    #[async_trait]
    impl LoopPolicy for FakePolicy {
        async fn evaluate(
            &self,
            _call: &ToolCallRequest,
            _completed_calls: u32,
        ) -> Result<PolicyDecision> {
            *self.evaluate_calls.lock().unwrap() += 1;
            Ok(decision(self.outcome.clone()))
        }

        async fn protect_output(
            &self,
            _call: &ToolCallRequest,
            _completed_calls: u32,
            output: ToolOutput,
        ) -> Result<ToolOutput> {
            Ok(output)
        }
    }

    struct FakeTools {
        execute_calls: StdMutex<u32>,
    }

    #[async_trait]
    impl LoopTools for FakeTools {
        async fn execute(&self, call: &ToolCallRequest) -> Result<ToolOutput> {
            *self.execute_calls.lock().unwrap() += 1;
            Ok(output(&format!("executed {}", call.name)))
        }
    }

    #[tokio::test]
    async fn allow_executes_and_records_recovery() {
        let policy = FakePolicy {
            outcome: DecisionOutcome::Allow,
            evaluate_calls: StdMutex::new(0),
        };
        let tools = FakeTools {
            execute_calls: StdMutex::new(0),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let service = GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);

        let outcome = service.run(7, &proposal(), 0).await.unwrap();
        match outcome {
            CapabilityStepOutcome::Executed(output) => {
                assert_eq!(output.summary, "executed erp.search");
            }
            other => panic!("expected Executed, got {other:?}"),
        }
        assert_eq!(*tools.execute_calls.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn repeated_proposal_replays_instead_of_re_executing() {
        let policy = FakePolicy {
            outcome: DecisionOutcome::Allow,
            evaluate_calls: StdMutex::new(0),
        };
        let tools = FakeTools {
            execute_calls: StdMutex::new(0),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let service = GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);

        let first = service.run(7, &proposal(), 0).await.unwrap();
        assert!(matches!(first, CapabilityStepOutcome::Executed(_)));
        let second = service.run(7, &proposal(), 1).await.unwrap();
        assert!(matches!(second, CapabilityStepOutcome::Replayed(_)));
        // Only the first call actually executed the underlying tool.
        assert_eq!(*tools.execute_calls.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn different_run_ids_do_not_share_recovery_state() {
        let policy = FakePolicy {
            outcome: DecisionOutcome::Allow,
            evaluate_calls: StdMutex::new(0),
        };
        let tools = FakeTools {
            execute_calls: StdMutex::new(0),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let service = GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);

        service.run(7, &proposal(), 0).await.unwrap();
        service.run(8, &proposal(), 0).await.unwrap();
        assert_eq!(*tools.execute_calls.lock().unwrap(), 2);
    }

    #[tokio::test]
    async fn deny_short_circuits_before_execution() {
        let policy = FakePolicy {
            outcome: DecisionOutcome::Deny,
            evaluate_calls: StdMutex::new(0),
        };
        let tools = FakeTools {
            execute_calls: StdMutex::new(0),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let service = GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);

        let outcome = service.run(7, &proposal(), 0).await.unwrap();
        assert!(matches!(outcome, CapabilityStepOutcome::Denied(_)));
        assert_eq!(*tools.execute_calls.lock().unwrap(), 0);
    }

    #[tokio::test]
    async fn draft_only_routes_through_approval_coordinator() {
        let policy = FakePolicy {
            outcome: DecisionOutcome::DraftOnly,
            evaluate_calls: StdMutex::new(0),
        };
        let tools = FakeTools {
            execute_calls: StdMutex::new(0),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let service = GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);

        let outcome = service.run(7, &proposal(), 0).await.unwrap();
        match outcome {
            CapabilityStepOutcome::PendingApproval(request) => {
                assert_eq!(request.capability, "erp.search");
            }
            other => panic!("expected PendingApproval, got {other:?}"),
        }
        assert_eq!(*tools.execute_calls.lock().unwrap(), 0);
    }

    #[tokio::test]
    async fn invalid_proposal_is_rejected_before_admission() {
        let policy = FakePolicy {
            outcome: DecisionOutcome::Allow,
            evaluate_calls: StdMutex::new(0),
        };
        let tools = FakeTools {
            execute_calls: StdMutex::new(0),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let service = GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);

        let mut bad = proposal();
        bad.capability = String::new();
        assert!(service.run(7, &bad, 0).await.is_err());
        assert_eq!(*policy.evaluate_calls.lock().unwrap(), 0);
    }

    #[tokio::test]
    async fn recovery_key_requires_nonzero_run_id() {
        let recovery = InMemoryExecutionRecovery::new();
        assert!(recovery.recovery_key(0, &proposal()).is_err());
    }

    #[tokio::test]
    async fn recovery_key_is_deterministic_and_argument_sensitive() {
        let recovery = InMemoryExecutionRecovery::new();
        let a = recovery.recovery_key(1, &proposal()).unwrap();
        let b = recovery.recovery_key(1, &proposal()).unwrap();
        assert_eq!(a, b);

        let mut different = proposal();
        different.arguments = json!({"q": "PO-99"});
        let c = recovery.recovery_key(1, &different).unwrap();
        assert_ne!(a, c);
    }

    #[tokio::test]
    async fn shape_only_verification_flags_missing_summary() {
        let service = ShapeOnlyVerificationService;
        let empty = ToolOutput {
            summary: String::new(),
            data: Value::Null,
            citations: vec![],
            row_count: None,
        };
        let outcome = service.verify(&empty, &[]).await.unwrap();
        assert!(matches!(outcome, VerificationOutcome::Failed { .. }));
    }

    #[tokio::test]
    async fn shape_only_verification_requires_review_without_evidence_or_data() {
        let service = ShapeOnlyVerificationService;
        let bare = ToolOutput {
            summary: "did a thing".to_string(),
            data: Value::Null,
            citations: vec![],
            row_count: None,
        };
        let outcome = service.verify(&bare, &[]).await.unwrap();
        assert!(matches!(
            outcome,
            VerificationOutcome::RequiresReview { .. }
        ));
    }

    #[tokio::test]
    async fn shape_only_verification_rejects_malformed_evidence() {
        let service = ShapeOnlyVerificationService;
        let bad_evidence = [EvidenceRef {
            kind: String::new(),
            id: "x".to_string(),
        }];
        let outcome = service.verify(&output("ok"), &bad_evidence).await.unwrap();
        assert!(matches!(outcome, VerificationOutcome::Failed { .. }));
    }

    #[tokio::test]
    async fn shape_only_verification_passes_with_evidence() {
        let service = ShapeOnlyVerificationService;
        let evidence = [EvidenceRef {
            kind: "erp_record".to_string(),
            id: "PO-42".to_string(),
        }];
        let outcome = service.verify(&output("ok"), &evidence).await.unwrap();
        assert_eq!(outcome, VerificationOutcome::Verified);
    }

    #[tokio::test]
    async fn shape_only_final_answer_admission_blocks_invalid_draft() {
        let service = ShapeOnlyFinalAnswerAdmission;
        let empty = FinalDraft {
            content: String::new(),
            citations: vec![],
        };
        let known = std::collections::HashSet::new();
        let outcome = service.admit(&empty, &known).await.unwrap();
        assert!(matches!(outcome, AnswerAdmissionOutcome::Blocked { .. }));
    }

    #[tokio::test]
    async fn shape_only_final_answer_admission_requires_review_without_citations() {
        let service = ShapeOnlyFinalAnswerAdmission;
        let draft = FinalDraft {
            content: "the answer".to_string(),
            citations: vec![],
        };
        let known = std::collections::HashSet::new();
        let outcome = service.admit(&draft, &known).await.unwrap();
        assert!(matches!(
            outcome,
            AnswerAdmissionOutcome::RequiresReview { .. }
        ));
    }

    #[tokio::test]
    async fn shape_only_final_answer_admission_admits_cited_draft() {
        let service = ShapeOnlyFinalAnswerAdmission;
        let draft = FinalDraft {
            content: "the answer".to_string(),
            citations: vec![EvidenceRef {
                kind: "erp_record".to_string(),
                id: "PO-42".to_string(),
            }],
        };
        let known = std::collections::HashSet::new();
        let outcome = service.admit(&draft, &known).await.unwrap();
        assert_eq!(outcome, AnswerAdmissionOutcome::Admitted);
    }

    #[tokio::test]
    async fn deterministic_final_answer_admission_blocks_fabricated_citations() {
        let service = DeterministicFinalAnswerAdmission;
        let draft = FinalDraft {
            content: "the answer".to_string(),
            citations: vec![EvidenceRef {
                kind: "erp_record".to_string(),
                id: "PO-42".to_string(),
            }],
        };
        let outcome = service
            .admit(&draft, &std::collections::HashSet::new())
            .await
            .unwrap();
        assert!(matches!(outcome, AnswerAdmissionOutcome::Blocked { .. }));
    }

    #[tokio::test]
    async fn deterministic_final_answer_admission_admits_verified_citations() {
        let service = DeterministicFinalAnswerAdmission;
        let citation = EvidenceRef {
            kind: "erp_record".to_string(),
            id: "PO-42".to_string(),
        };
        let draft = FinalDraft {
            content: "the answer".to_string(),
            citations: vec![citation.clone()],
        };
        let mut known = std::collections::HashSet::new();
        known.insert(citation);
        let outcome = service.admit(&draft, &known).await.unwrap();
        assert_eq!(outcome, AnswerAdmissionOutcome::Admitted);
    }

    #[test]
    fn capability_recovery_key_is_stable_and_requires_a_durable_run_id() {
        let a = capability_recovery_key(1, &proposal()).unwrap();
        let b = capability_recovery_key(1, &proposal()).unwrap();
        assert_eq!(a, b);

        let mut other = proposal();
        other.arguments = json!({"q": "different"});
        let c = capability_recovery_key(1, &other).unwrap();
        assert_ne!(a, c);

        assert!(capability_recovery_key(0, &proposal()).is_err());
    }

    #[test]
    fn approval_request_key_is_stable_and_argument_sensitive() {
        let a = approval_request_key(1, &proposal()).unwrap();
        let b = approval_request_key(1, &proposal()).unwrap();
        assert_eq!(a, b);

        let mut other = proposal();
        other.arguments = json!({"q": "different"});
        let c = approval_request_key(1, &other).unwrap();
        assert_ne!(a, c);

        // Distinct from the execution recovery key for the same proposal —
        // approval and recovery are two different durable stores, never
        // sharing a key namespace by coincidence.
        assert_ne!(a, capability_recovery_key(1, &proposal()).unwrap());

        assert!(approval_request_key(0, &proposal()).is_err());
    }

    #[test]
    fn decode_capability_execution_row_reads_camel_case_fields() {
        let row = json!({
            "status": "succeeded",
            "outputJson": "{\"summary\":\"ok\"}",
            "failureReason": null,
        });
        let decoded = decode_capability_execution_row(&row).unwrap();
        assert_eq!(decoded.status, "succeeded");
        assert_eq!(decoded.output_json.as_deref(), Some("{\"summary\":\"ok\"}"));
        assert!(decoded.failure_reason.is_none());
    }

    #[test]
    fn decode_capability_execution_row_falls_back_to_snake_case_fields() {
        let row = json!({
            "status": "failed",
            "output_json": null,
            "failure_reason": "provider timeout",
        });
        let decoded = decode_capability_execution_row(&row).unwrap();
        assert_eq!(decoded.status, "failed");
        assert!(decoded.output_json.is_none());
        assert_eq!(decoded.failure_reason.as_deref(), Some("provider timeout"));
    }

    #[test]
    fn decode_capability_execution_row_requires_status() {
        let row = json!({"outputJson": null, "failureReason": null});
        assert!(decode_capability_execution_row(&row).is_err());
    }
}
