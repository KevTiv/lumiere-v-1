//! Trusted candidate-certification worker foundations.
//!
//! Certification is deliberately separate from active-release resolution, but
//! it uses the same immutable skill-version records. Only this worker receives
//! the dedicated certification SpacetimeDB identity. Browser callers may queue
//! work; they never provide actual output or a pass/fail result.
//!
//! Built-in adapters execute only against the exact immutable environment
//! pinned when a request is claimed. SQL-like reads use reviewed templates over
//! an in-memory dataset, and file reads use an in-memory virtual filesystem.
//! Neither broker can reach live tenant state or a host/desktop path.

use std::{sync::Arc, time::Duration};

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use stdb_client::StdbClient;
use thiserror::Error;
use uuid::Uuid;

use crate::config::Config;

use super::release_registry::{
    candidate_policy_manifest, load_candidate_certification_environment,
    load_candidate_certification_inputs, CandidateCertificationEnvironment,
    CandidateCertificationInputs, CandidateSkillVersion,
};
use super::{
    audit::DecisionOutcome,
    certification_fixtures::{
        scoped_sql, tenant_files, CapabilityEvidence, CertificationTenantScope,
        ImmutableCertificationDataset,
    },
    data_scope_resolver::ResourceRegistry,
    low_stock::{self, LowStockInput, LOW_STOCK_RESOURCE},
    manifest::{Capability, SkillVersionRef},
    policy_engine::{
        ExecutionMetadata, ExecutionPlan, PlannedToolCall, PolicyEngine, PolicyExecutionRequest,
    },
    privacy_guard::PrivacyGuard,
    report_composer::{self, ReportComposerInput, REPORT_COMPOSER_RESOURCE},
    skill_registry::SkillRegistry,
};

const MAX_CERTIFICATION_BATCH_SIZE: u32 = 100;
const MAX_EXECUTOR_RUN_ID_LEN: usize = 240;
const MAX_ERROR_CODE_LEN: usize = 120;
const MAX_FAILURE_REASON_LEN: usize = 8_000;
const MAX_METADATA_LEN: usize = 8_000;
const CERTIFICATION_TIMEOUT_REASON: &str =
    "certification adapter exceeded the configured execution deadline";
const FALLBACK_FAILURE_REASON: &str = "certification execution failed";
const FALLBACK_ERROR_CODE: &str = "certification_error";

#[derive(Clone, Debug, PartialEq, Eq)]
struct CertificationRequest {
    id: u64,
    organization_id: u64,
    company_id: u64,
    skill_id: u64,
    skill_version_id: u64,
    fixture_id: u64,
    runtime_profile_id: Option<u64>,
    certification_environment_id: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CertificationRuntimeProfile {
    id: u64,
    organization_id: u64,
    runtime_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CertificationEvidenceHashes {
    environment: String,
    policy_snapshot: String,
    execution: String,
}

/// Adapter input intentionally excludes the fixture's expected output.
///
/// The expected value remains available only to the persistence/assertion
/// layer, preventing adapters from copying it into `actual_output`.
#[derive(Clone, Debug, PartialEq)]
pub struct CandidateExecutionRequest {
    pub version: CandidateSkillVersion,
    pub fixture_id: u64,
    pub fixture_key: String,
    pub input: Value,
    pub scope: CertificationTenantScope,
    pub environment: CandidateCertificationEnvironment,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CandidateExecution {
    pub actual_output: Value,
    pub executor_run_id: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum CertificationExecutionError {
    #[error("no certification adapter supports skill '{skill_key}' version '{version}'")]
    UnsupportedSkill { skill_key: String, version: String },
    #[error("certification adapter failed: {0}")]
    Adapter(String),
    #[error("certification adapter exceeded the configured execution deadline")]
    Timeout,
}

#[async_trait]
pub trait CandidateCertificationAdapter: Send + Sync {
    /// Return true only for exact candidate versions this adapter can execute.
    fn supports(&self, version: &CandidateSkillVersion) -> bool;

    async fn execute(
        &self,
        request: CandidateExecutionRequest,
    ) -> Result<CandidateExecution, CertificationExecutionError>;
}

/// Closed registry of executable candidate adapters.
///
/// The default registry is empty and therefore fails closed. Production
/// contains only built-ins bound to an exact compiled bundle hash.
#[derive(Default)]
pub struct CandidateAdapterRegistry {
    adapters: Vec<Arc<dyn CandidateCertificationAdapter>>,
}

impl CandidateAdapterRegistry {
    pub fn new(adapters: Vec<Arc<dyn CandidateCertificationAdapter>>) -> Self {
        Self { adapters }
    }

    /// Production registry for candidate certification.
    ///
    /// Expected fixture output is assertion data and is never exposed to these
    /// adapters. Each adapter consumes only its pinned immutable environment.
    pub fn production() -> Self {
        Self::new(vec![
            Arc::new(LowStockCertificationAdapter),
            Arc::new(ReportComposerCertificationAdapter),
        ])
    }

    pub async fn execute(
        &self,
        candidate: CandidateCertificationInputs,
        environment: CandidateCertificationEnvironment,
        organization_id: u64,
        company_id: u64,
    ) -> Result<CandidateExecution, CertificationExecutionError> {
        let request = execution_request(&candidate, environment, organization_id, company_id)?;
        let adapter = self
            .adapters
            .iter()
            .find(|adapter| adapter.supports(&candidate.version))
            .ok_or_else(|| CertificationExecutionError::UnsupportedSkill {
                skill_key: candidate.version.skill_key.clone(),
                version: candidate.version.version.clone(),
            })?;

        adapter.execute(request).await
    }
}

fn execution_request(
    candidate: &CandidateCertificationInputs,
    environment: CandidateCertificationEnvironment,
    organization_id: u64,
    company_id: u64,
) -> Result<CandidateExecutionRequest, CertificationExecutionError> {
    if environment.organization_id != organization_id
        || environment.skill_id != candidate.version.skill_id
        || environment.fixture_id != candidate.fixture.id
    {
        return Err(CertificationExecutionError::Adapter(
            "pinned certification environment does not match the candidate request".to_string(),
        ));
    }
    let scope = CertificationTenantScope::new(organization_id, company_id)
        .map_err(|error| CertificationExecutionError::Adapter(error.to_string()))?;
    Ok(CandidateExecutionRequest {
        version: candidate.version.clone(),
        fixture_id: candidate.fixture.id,
        fixture_key: candidate.fixture.fixture_key.clone(),
        input: candidate.fixture.input.clone(),
        scope,
        environment,
    })
}

const REPORT_PREVIEW_FIXTURE_PATH: &str = "reports/daily_business_summary_v1/preview.json";
const BUILT_IN_SEMVER: &str = "1.0.0";

struct LowStockCertificationAdapter;

#[async_trait]
impl CandidateCertificationAdapter for LowStockCertificationAdapter {
    fn supports(&self, version: &CandidateSkillVersion) -> bool {
        version.skill_key == low_stock::LOW_STOCK_SKILL_KEY
            && version.version == BUILT_IN_SEMVER
            && version.source_hash == low_stock_certification_bundle_hash()
    }

    async fn execute(
        &self,
        request: CandidateExecutionRequest,
    ) -> Result<CandidateExecution, CertificationExecutionError> {
        if !request
            .version
            .resources
            .iter()
            .any(|resource| resource == LOW_STOCK_RESOURCE)
        {
            return Err(CertificationExecutionError::Adapter(
                "candidate does not declare the low-stock resource".to_string(),
            ));
        }
        let input: LowStockInput =
            serde_json::from_value(request.input.clone()).map_err(|error| {
                CertificationExecutionError::Adapter(format!(
                    "invalid low-stock fixture input: {error}"
                ))
            })?;
        (low_stock::resource_contract().validate_input)(&request.input)
            .map_err(CertificationExecutionError::Adapter)?;
        let dataset = ImmutableCertificationDataset::parse(
            request.scope,
            &request.version.resources,
            &request.environment,
        )
        .map_err(|error| CertificationExecutionError::Adapter(error.to_string()))?;
        let result = scoped_sql::execute_low_stock(&dataset, &input, 100)
            .map_err(|error| CertificationExecutionError::Adapter(error.to_string()))?;
        (low_stock::resource_contract().validate_output)(&result.output)
            .map_err(CertificationExecutionError::Adapter)?;
        let (output, policy_evidence) = execute_canonical_policy(
            &request,
            result.output,
            LOW_STOCK_RESOURCE,
            low_stock::LOW_STOCK_OUTPUT_TYPE,
            low_stock::NAMED_READ_TOOL,
        )?;
        Ok(execution_with_evidence(
            output,
            request.environment.id,
            result.evidence,
            policy_evidence,
        ))
    }
}

struct ReportComposerCertificationAdapter;

#[async_trait]
impl CandidateCertificationAdapter for ReportComposerCertificationAdapter {
    fn supports(&self, version: &CandidateSkillVersion) -> bool {
        version.skill_key == report_composer::REPORT_COMPOSER_SKILL_KEY
            && version.version == BUILT_IN_SEMVER
            && version.source_hash == report_composer_certification_bundle_hash()
    }

    async fn execute(
        &self,
        request: CandidateExecutionRequest,
    ) -> Result<CandidateExecution, CertificationExecutionError> {
        if !request
            .version
            .resources
            .iter()
            .any(|resource| resource == REPORT_COMPOSER_RESOURCE)
        {
            return Err(CertificationExecutionError::Adapter(
                "candidate does not declare the report-composer resource".to_string(),
            ));
        }
        let input: ReportComposerInput =
            serde_json::from_value(request.input.clone()).map_err(|error| {
                CertificationExecutionError::Adapter(format!(
                    "invalid report-composer fixture input: {error}"
                ))
            })?;
        (report_composer::resource_contract().validate_input)(&request.input)
            .map_err(CertificationExecutionError::Adapter)?;
        if input.company_id != request.scope.company_id {
            return Err(CertificationExecutionError::Adapter(
                "report-composer input company does not match the claimed scope".to_string(),
            ));
        }
        let files = tenant_files::VirtualTenantFiles::parse(
            request.scope,
            [REPORT_PREVIEW_FIXTURE_PATH],
            &request.environment,
        )
        .map_err(|error| CertificationExecutionError::Adapter(error.to_string()))?;
        let file = files
            .read_scoped_json(REPORT_PREVIEW_FIXTURE_PATH)
            .map_err(|error| CertificationExecutionError::Adapter(error.to_string()))?;
        let output = report_composer::build_composer_output(
            &input.report_key,
            input.company_id,
            &file.content,
        )
        .map_err(CertificationExecutionError::Adapter)?;
        let output = serde_json::to_value(output)
            .map_err(|error| CertificationExecutionError::Adapter(error.to_string()))?;
        (report_composer::resource_contract().validate_output)(&output)
            .map_err(CertificationExecutionError::Adapter)?;
        let (output, policy_evidence) = execute_canonical_policy(
            &request,
            output,
            REPORT_COMPOSER_RESOURCE,
            report_composer::REPORT_COMPOSER_OUTPUT_TYPE,
            report_composer::NAMED_READ_TOOL,
        )?;
        Ok(execution_with_evidence(
            output,
            request.environment.id,
            file.evidence,
            policy_evidence,
        ))
    }
}

fn execute_canonical_policy(
    request: &CandidateExecutionRequest,
    candidate_output: Value,
    resource: &str,
    output_type: &str,
    tool_name: &str,
) -> Result<(Value, Value), CertificationExecutionError> {
    let expected_rows = candidate_output
        .get("items")
        .and_then(Value::as_array)
        .map_or(0, |items| items.len() as u32);
    let execution = PolicyExecutionRequest {
        skill: SkillVersionRef::new(request.version.skill_key.clone(), 1),
        organization_id: request.scope.organization_id,
        company_id: request.scope.company_id,
        correlation_id: format!(
            "certification:{}:{}",
            request.environment.id, request.fixture_id
        ),
        metadata: ExecutionMetadata {
            actor_id: Some("ai-gateway-certification".to_string()),
            causation_id: Some(request.environment.environment_fingerprint.clone()),
            ..Default::default()
        },
        input: request.input.clone(),
        plan: ExecutionPlan {
            named_resources: vec![resource.to_string()],
            tool_calls: vec![PlannedToolCall {
                tool_name: tool_name.to_string(),
                capability: Capability::NamedRead,
                named_resource: Some(resource.to_string()),
            }],
            steps: 1,
            expected_rows,
            output_type: output_type.to_string(),
        },
    };
    let manifest = candidate_policy_manifest(&request.version)
        .map_err(CertificationExecutionError::Adapter)?;
    let decision = PolicyEngine::new(
        SkillRegistry::exact(manifest.clone()),
        ResourceRegistry::built_in(),
    )
    .evaluate(&execution);
    if decision.outcome != DecisionOutcome::Allow {
        let reasons = decision
            .reasons
            .iter()
            .map(|reason| reason.message.as_str())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(CertificationExecutionError::Adapter(format!(
            "canonical policy denied certification execution: {reasons}"
        )));
    }

    let contract = match request.version.skill_key.as_str() {
        low_stock::LOW_STOCK_SKILL_KEY => low_stock::resource_contract(),
        report_composer::REPORT_COMPOSER_SKILL_KEY => report_composer::resource_contract(),
        _ => unreachable!("manifest match rejects unknown built-ins"),
    };
    let merged_privacy = manifest.privacy.merge_with_org(&Default::default());
    let (mut output, privacy) = PrivacyGuard
        .protect_output(
            &candidate_output,
            &contract.rows_field,
            request.scope.company_id,
            &merged_privacy,
        )
        .map_err(|error| CertificationExecutionError::Adapter(error.message()))?;
    let original = candidate_output.as_object().ok_or_else(|| {
        CertificationExecutionError::Adapter(
            "candidate output must be an object before privacy enforcement".to_string(),
        )
    })?;
    let protected = output.as_object_mut().ok_or_else(|| {
        CertificationExecutionError::Adapter(
            "privacy-protected output must be an object".to_string(),
        )
    })?;
    for (field, value) in original {
        if field != &contract.rows_field {
            protected.insert(field.clone(), value.clone());
        }
    }
    if privacy.rows_processed > manifest.limits.max_rows {
        return Err(CertificationExecutionError::Adapter(format!(
            "canonical policy row limit exceeded: {} > {}",
            privacy.rows_processed, manifest.limits.max_rows
        )));
    }
    (contract.validate_output)(&output).map_err(CertificationExecutionError::Adapter)?;

    let policy_evidence = serde_json::json!({
        "decisionHashes": &decision.hashes,
        "outcome": decision.outcome,
        "privacy": &privacy,
        "resultHash": hash_value(&serde_json::json!({
            "decision": &decision,
            "output": &output,
        })),
    });
    Ok((output, policy_evidence))
}

fn execution_with_evidence(
    actual_output: Value,
    certification_environment_id: u64,
    evidence: CapabilityEvidence,
    policy_evidence: Value,
) -> CandidateExecution {
    CandidateExecution {
        actual_output,
        executor_run_id: None,
        metadata: Some(serde_json::json!({
            "capabilityEvidence": [evidence],
            "certificationEnvironmentId": certification_environment_id,
            "policyEvidence": policy_evidence,
        })),
    }
}

pub fn low_stock_certification_bundle_hash() -> String {
    compiled_bundle_hash(&[
        include_bytes!("low_stock.rs"),
        include_bytes!("certification.rs"),
        include_bytes!("certification_fixtures.rs"),
        include_bytes!("data_scope_resolver.rs"),
        include_bytes!("manifest.rs"),
        include_bytes!("policy_engine.rs"),
        include_bytes!("../tools/scoped_sql.rs"),
    ])
}

pub fn report_composer_certification_bundle_hash() -> String {
    compiled_bundle_hash(&[
        include_bytes!("report_composer.rs"),
        include_bytes!("certification.rs"),
        include_bytes!("certification_fixtures.rs"),
        include_bytes!("data_scope_resolver.rs"),
        include_bytes!("manifest.rs"),
        include_bytes!("policy_engine.rs"),
        include_bytes!("../tools/tenant_files.rs"),
    ])
}

fn compiled_bundle_hash(parts: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"lumiere.ai.certification.compiled_bundle.v1");
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    format!("sha256:{:x}", hasher.finalize())
}

pub async fn run(
    config: Arc<Config>,
    stdb: Arc<StdbClient>,
    adapters: Arc<CandidateAdapterRegistry>,
) {
    let Some(expected_runtime_hash) = config.ai_certification_runtime_hash.as_deref() else {
        tracing::error!(
            "AI certification worker refused to start without AI_CERTIFICATION_RUNTIME_HASH"
        );
        return;
    };
    let poll_interval = Duration::from_secs(config.ai_certification_poll_secs.max(1));
    let execution_timeout = Duration::from_secs(config.ai_certification_timeout_secs);
    let batch_size = config
        .ai_certification_batch_size
        .clamp(1, MAX_CERTIFICATION_BATCH_SIZE);
    let mut interval = tokio::time::interval(poll_interval);

    tracing::info!(
        poll_secs = poll_interval.as_secs(),
        batch_size,
        timeout_secs = execution_timeout.as_secs(),
        "AI certification worker started"
    );

    loop {
        interval.tick().await;
        match process_batch(
            &stdb,
            adapters.as_ref(),
            expected_runtime_hash,
            batch_size,
            execution_timeout,
        )
        .await
        {
            Ok(processed) if processed > 0 => {
                tracing::info!(processed, "AI certification requests processed");
            }
            Ok(_) => {}
            Err(error) => {
                tracing::error!(error = %error, "AI certification worker poll failed");
            }
        }
    }
}

async fn process_batch(
    stdb: &StdbClient,
    adapters: &CandidateAdapterRegistry,
    expected_runtime_hash: &str,
    batch_size: u32,
    execution_timeout: Duration,
) -> Result<usize> {
    let requests = load_claim_candidates(stdb, batch_size).await?;
    let mut processed = 0;

    for queued in requests {
        if let Err(error) = claim_request(stdb, &queued).await {
            tracing::warn!(
                request_id = queued.id,
                organization_id = queued.organization_id,
                error = %error,
                "AI certification claim failed"
            );
            continue;
        }

        let request = match load_claimed_request(stdb, queued.organization_id, queued.id).await {
            Ok(request) => request,
            Err(error) => {
                tracing::error!(
                    request_id = queued.id,
                    organization_id = queued.organization_id,
                    error = %error,
                    "Claimed AI certification request could not be reloaded"
                );
                continue;
            }
        };

        match process_claimed_request(
            stdb,
            adapters,
            expected_runtime_hash,
            request.clone(),
            execution_timeout,
        )
        .await
        {
            Ok(()) => processed += 1,
            Err(error) => {
                tracing::error!(
                    request_id = request.id,
                    organization_id = request.organization_id,
                    error = %error,
                    "AI certification request processing failed"
                );
            }
        }
    }

    Ok(processed)
}

async fn process_claimed_request(
    stdb: &StdbClient,
    adapters: &CandidateAdapterRegistry,
    expected_runtime_hash: &str,
    request: CertificationRequest,
    execution_timeout: Duration,
) -> Result<()> {
    let certification_environment_id = request
        .certification_environment_id
        .context("claimed certification request has no pinned environment")?;
    let environment = load_candidate_certification_environment(
        stdb,
        request.organization_id,
        request.fixture_id,
        certification_environment_id,
    )
    .await
    .map_err(anyhow::Error::msg)?;
    let environment_hash = environment.environment_fingerprint.clone();

    let profile_id = request
        .runtime_profile_id
        .context("claimed certification request has no runtime profile")?;
    let profile = load_runtime_profile(stdb, request.organization_id, profile_id).await?;
    if profile.organization_id != request.organization_id {
        anyhow::bail!("certification runtime profile organization mismatch");
    }
    let executor_run_id = format!("certification:{}", Uuid::new_v4());
    if !runtime_profile_matches(&profile, expected_runtime_hash) {
        let reason = "claimed runtime profile does not match this executor build";
        let hashes = failure_hashes(
            &request,
            &environment_hash,
            "runtime_hash_mismatch",
            reason,
            &executor_run_id,
        );
        fail_request(
            stdb,
            &request,
            "runtime_hash_mismatch",
            reason,
            &executor_run_id,
            &hashes,
            None,
        )
        .await?;
        return Ok(());
    }

    let candidate = match load_candidate_certification_inputs(
        stdb,
        request.organization_id,
        request.skill_version_id,
        request.fixture_id,
    )
    .await
    {
        Ok(candidate) => candidate,
        Err(error) => {
            let reason = bounded_failure_reason(&error);
            let hashes = failure_hashes(
                &request,
                &environment_hash,
                "candidate_load_failed",
                &reason,
                &executor_run_id,
            );
            fail_request(
                stdb,
                &request,
                "candidate_load_failed",
                &reason,
                &executor_run_id,
                &hashes,
                None,
            )
            .await?;
            return Ok(());
        }
    };

    if candidate.version.skill_id != request.skill_id
        || environment.skill_id != request.skill_id
        || environment.fixture_id != request.fixture_id
        || environment.organization_id != request.organization_id
    {
        let reason =
            "claimed request, immutable candidate, and pinned environment scopes do not match";
        let hashes = failure_hashes(
            &request,
            &environment_hash,
            "candidate_scope_mismatch",
            reason,
            &executor_run_id,
        );
        fail_request(
            stdb,
            &request,
            "candidate_scope_mismatch",
            reason,
            &executor_run_id,
            &hashes,
            None,
        )
        .await?;
        return Ok(());
    }

    let base_policy_snapshot_hash = policy_snapshot_hash(&request, &candidate);
    let execution = match execute_with_timeout(
        adapters,
        candidate.clone(),
        environment,
        request.organization_id,
        request.company_id,
        execution_timeout,
    )
    .await
    {
        Ok(execution) => execution,
        Err(error) => {
            let (error_code, reason) = execution_failure(&error);
            let hashes = CertificationEvidenceHashes {
                environment: environment_hash,
                policy_snapshot: denied_policy_snapshot_hash(
                    &request,
                    &candidate,
                    &base_policy_snapshot_hash,
                    error_code,
                    &reason,
                ),
                execution: hash_value(&serde_json::json!({
                    "error_code": error_code,
                    "failure_reason": reason,
                    "fixture_id": request.fixture_id,
                    "request_id": request.id,
                    "skill_version_id": request.skill_version_id,
                    "executor_run_id": executor_run_id,
                })),
            };
            fail_request(
                stdb,
                &request,
                error_code,
                &reason,
                &executor_run_id,
                &hashes,
                None,
            )
            .await?;
            return Ok(());
        }
    };

    let effective_run_id =
        trusted_executor_run_id(execution.executor_run_id.as_deref(), &executor_run_id);
    let enforced_policy_snapshot_hash =
        enforced_policy_snapshot_hash(&request, &candidate, &execution);
    let hashes = CertificationEvidenceHashes {
        environment: environment_hash,
        policy_snapshot: enforced_policy_snapshot_hash,
        execution: execution_hash(&request, &candidate, &execution, &effective_run_id),
    };
    let actual_output_json =
        serde_json::to_string(&execution.actual_output).context("serialize actual output")?;
    let metadata = bounded_adapter_metadata(execution.metadata.as_ref());

    if let Err(error) = complete_request(
        stdb,
        &request,
        &actual_output_json,
        &effective_run_id,
        &hashes,
        metadata.as_deref(),
    )
    .await
    {
        let reason = bounded_failure_reason(&format!("complete certification evidence: {error}"));
        fail_request(
            stdb,
            &request,
            "completion_failed",
            &reason,
            &effective_run_id,
            &hashes,
            None,
        )
        .await
        .with_context(|| reason)?;
    }

    Ok(())
}

async fn execute_with_timeout(
    adapters: &CandidateAdapterRegistry,
    candidate: CandidateCertificationInputs,
    environment: CandidateCertificationEnvironment,
    organization_id: u64,
    company_id: u64,
    execution_timeout: Duration,
) -> Result<CandidateExecution, CertificationExecutionError> {
    tokio::time::timeout(
        execution_timeout,
        adapters.execute(candidate, environment, organization_id, company_id),
    )
    .await
    .map_err(|_| CertificationExecutionError::Timeout)?
}

fn execution_failure(error: &CertificationExecutionError) -> (&'static str, String) {
    match error {
        CertificationExecutionError::UnsupportedSkill { .. } => (
            "unsupported_skill",
            bounded_failure_reason(&error.to_string()),
        ),
        CertificationExecutionError::Adapter(_) => (
            "adapter_execution_failed",
            bounded_failure_reason(&error.to_string()),
        ),
        CertificationExecutionError::Timeout => (
            "certification_timeout",
            CERTIFICATION_TIMEOUT_REASON.to_string(),
        ),
    }
}

fn trusted_executor_run_id(adapter_run_id: Option<&str>, worker_run_id: &str) -> String {
    adapter_run_id
        .filter(|run_id| valid_reducer_text(run_id, MAX_EXECUTOR_RUN_ID_LEN))
        .unwrap_or(worker_run_id)
        .to_string()
}

fn reducer_executor_run_id(run_id: &str) -> String {
    if valid_reducer_text(run_id, MAX_EXECUTOR_RUN_ID_LEN) {
        run_id.to_string()
    } else {
        format!("certification:{}", Uuid::new_v4())
    }
}

fn bounded_error_code(error_code: &str) -> String {
    let normalized = error_code
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '_' | '-')
            {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let normalized = truncate_utf8(normalized.trim_matches('_'), MAX_ERROR_CODE_LEN);
    if normalized.is_empty() {
        FALLBACK_ERROR_CODE.to_string()
    } else {
        normalized
    }
}

fn bounded_failure_reason(reason: &str) -> String {
    let normalized = reason
        .trim()
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let normalized = truncate_utf8(normalized.trim(), MAX_FAILURE_REASON_LEN);
    if normalized.is_empty() {
        FALLBACK_FAILURE_REASON.to_string()
    } else {
        normalized
    }
}

fn bounded_adapter_metadata(metadata: Option<&Value>) -> Option<String> {
    metadata.map(|value| {
        let serialized = serde_json::to_string(value).unwrap_or_else(|_| "null".to_string());
        bounded_metadata_text(Some(&serialized)).unwrap_or_else(|| {
            serde_json::json!({
                "metadataOmitted": true,
                "metadataSha256": hash_value(value),
            })
            .to_string()
        })
    })
}

fn bounded_metadata_text(metadata: Option<&str>) -> Option<String> {
    let metadata = metadata?.trim();
    if metadata.is_empty() {
        return None;
    }
    if valid_reducer_text(metadata, MAX_METADATA_LEN) {
        return Some(metadata.to_string());
    }
    Some(
        serde_json::json!({
            "metadataOmitted": true,
            "metadataSha256": sha256_prefixed(metadata.as_bytes()),
        })
        .to_string(),
    )
}

fn valid_reducer_text(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value == value.trim()
        && value.len() <= max_len
        && !value.chars().any(char::is_control)
}

fn truncate_utf8(value: &str, max_len: usize) -> String {
    if value.len() <= max_len {
        return value.to_string();
    }
    let mut end = max_len;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].trim_end().to_string()
}

async fn load_claim_candidates(
    stdb: &StdbClient,
    batch_size: u32,
) -> Result<Vec<CertificationRequest>> {
    let sql = claim_candidate_sql(batch_size);
    let rows = stdb
        .query_sql(&sql)
        .await
        .context("load queued or reclaimable AI certification requests")?;

    rows.iter().map(parse_request).collect()
}

fn claim_candidate_sql(batch_size: u32) -> String {
    format!(
        "SELECT id, organization_id, company_id, skill_id, skill_version_id, fixture_id, runtime_profile_id, certification_environment_id \
         FROM ai_skill_certification_request \
         WHERE status = 'Queued' OR status = 'Running' LIMIT {}",
        batch_size.clamp(1, MAX_CERTIFICATION_BATCH_SIZE)
    )
}

async fn claim_request(stdb: &StdbClient, request: &CertificationRequest) -> Result<()> {
    stdb.call_reducer(
        "claim_ai_skill_certification",
        serde_json::json!([request.organization_id, request.id]),
    )
    .await
    .context("claim AI skill certification")
}

async fn load_claimed_request(
    stdb: &StdbClient,
    organization_id: u64,
    request_id: u64,
) -> Result<CertificationRequest> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, skill_id, skill_version_id, fixture_id, runtime_profile_id, certification_environment_id \
             FROM ai_skill_certification_request WHERE id = {request_id} AND organization_id = {organization_id} AND status = 'Running' LIMIT 2"
        ))
        .await
        .context("reload claimed AI certification request")?;
    if rows.len() != 1 {
        anyhow::bail!("claimed certification request was not found exactly once");
    }
    parse_request(&rows[0])
}

async fn load_runtime_profile(
    stdb: &StdbClient,
    organization_id: u64,
    profile_id: u64,
) -> Result<CertificationRuntimeProfile> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT id, organization_id, runtime_hash \
             FROM ai_skill_certification_runtime_profile WHERE id = {profile_id} AND organization_id = {organization_id} LIMIT 2"
        ))
        .await
        .context("load claimed AI certification runtime profile")?;
    if rows.len() != 1 {
        anyhow::bail!("certification runtime profile was not found exactly once");
    }
    parse_runtime_profile(&rows[0])
}

async fn complete_request(
    stdb: &StdbClient,
    request: &CertificationRequest,
    actual_output_json: &str,
    executor_run_id: &str,
    hashes: &CertificationEvidenceHashes,
    metadata: Option<&str>,
) -> Result<()> {
    let executor_run_id = reducer_executor_run_id(executor_run_id);
    let metadata = bounded_metadata_text(metadata);
    stdb.call_reducer(
        "complete_ai_skill_certification",
        complete_reducer_args(
            request,
            actual_output_json,
            &executor_run_id,
            hashes,
            metadata.as_deref(),
        ),
    )
    .await
    .context("complete AI skill certification")
}

#[allow(clippy::too_many_arguments)]
async fn fail_request(
    stdb: &StdbClient,
    request: &CertificationRequest,
    error_code: &str,
    failure_reason: &str,
    executor_run_id: &str,
    hashes: &CertificationEvidenceHashes,
    metadata: Option<&str>,
) -> Result<()> {
    let error_code = bounded_error_code(error_code);
    let failure_reason = bounded_failure_reason(failure_reason);
    let executor_run_id = reducer_executor_run_id(executor_run_id);
    let metadata = bounded_metadata_text(metadata);
    stdb.call_reducer(
        "fail_ai_skill_certification",
        fail_reducer_args(
            request,
            &error_code,
            &failure_reason,
            &executor_run_id,
            hashes,
            metadata.as_deref(),
        ),
    )
    .await
    .context("fail AI skill certification")
}

fn complete_reducer_args(
    request: &CertificationRequest,
    actual_output_json: &str,
    executor_run_id: &str,
    hashes: &CertificationEvidenceHashes,
    metadata: Option<&str>,
) -> Value {
    serde_json::json!([
        request.organization_id,
        {
            "requestId": request.id,
            "actualOutputJson": actual_output_json,
            "environmentHash": hashes.environment,
            "policySnapshotHash": hashes.policy_snapshot,
            "executionEvidenceHash": hashes.execution,
            "executorRunId": executor_run_id,
            "metadata": metadata,
        }
    ])
}

fn fail_reducer_args(
    request: &CertificationRequest,
    error_code: &str,
    failure_reason: &str,
    executor_run_id: &str,
    hashes: &CertificationEvidenceHashes,
    metadata: Option<&str>,
) -> Value {
    serde_json::json!([
        request.organization_id,
        {
            "requestId": request.id,
            "errorCode": error_code,
            "failureReason": failure_reason,
            "environmentHash": hashes.environment,
            "policySnapshotHash": hashes.policy_snapshot,
            "executionEvidenceHash": hashes.execution,
            "executorRunId": executor_run_id,
            "metadata": metadata,
        }
    ])
}

fn parse_request(row: &Value) -> Result<CertificationRequest> {
    Ok(CertificationRequest {
        id: required_u64(row, "id", "id")?,
        organization_id: required_u64(row, "organizationId", "organization_id")?,
        company_id: required_u64(row, "companyId", "company_id")?,
        skill_id: required_u64(row, "skillId", "skill_id")?,
        skill_version_id: required_u64(row, "skillVersionId", "skill_version_id")?,
        fixture_id: required_u64(row, "fixtureId", "fixture_id")?,
        runtime_profile_id: optional_u64(row, "runtimeProfileId", "runtime_profile_id"),
        certification_environment_id: optional_u64(
            row,
            "certificationEnvironmentId",
            "certification_environment_id",
        ),
    })
}

fn parse_runtime_profile(row: &Value) -> Result<CertificationRuntimeProfile> {
    let runtime_hash = row_string(row, "runtimeHash", "runtime_hash")
        .filter(|value| valid_sha256(value))
        .context("runtime profile hash is missing or invalid")?;
    Ok(CertificationRuntimeProfile {
        id: required_u64(row, "id", "id")?,
        organization_id: required_u64(row, "organizationId", "organization_id")?,
        runtime_hash,
    })
}

fn policy_snapshot_hash(
    request: &CertificationRequest,
    candidate: &CandidateCertificationInputs,
) -> String {
    hash_value(&policy_snapshot_material(request, candidate))
}

fn policy_snapshot_material(
    request: &CertificationRequest,
    candidate: &CandidateCertificationInputs,
) -> Value {
    serde_json::json!({
        "company_id": request.company_id,
        "manifest": candidate.version.manifest_json,
        "max_steps": candidate.version.max_steps,
        "max_tool_calls": candidate.version.max_tool_calls,
        "organization_id": request.organization_id,
        "output_types": candidate.version.output_types,
        "permissions": candidate.version.permissions,
        "resources": candidate.version.resources,
        "risk": format!("{:?}", candidate.version.risk).to_ascii_lowercase(),
        "skill_version_id": candidate.version.id,
    })
}

fn enforced_policy_snapshot_hash(
    request: &CertificationRequest,
    candidate: &CandidateCertificationInputs,
    execution: &CandidateExecution,
) -> String {
    hash_value(&serde_json::json!({
        "candidate_policy": policy_snapshot_material(request, candidate),
        "policy_evidence": execution
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("policyEvidence")),
    }))
}

fn denied_policy_snapshot_hash(
    request: &CertificationRequest,
    candidate: &CandidateCertificationInputs,
    base_policy_snapshot_hash: &str,
    error_code: &str,
    failure_reason: &str,
) -> String {
    hash_value(&serde_json::json!({
        "base_policy_snapshot_hash": base_policy_snapshot_hash,
        "candidate_policy": policy_snapshot_material(request, candidate),
        "enforcement_failure": {
            "error_code": error_code,
            "failure_reason": failure_reason,
        },
    }))
}

fn execution_hash(
    request: &CertificationRequest,
    candidate: &CandidateCertificationInputs,
    execution: &CandidateExecution,
    executor_run_id: &str,
) -> String {
    hash_value(&serde_json::json!({
        "actual_output": execution.actual_output,
        "executor_run_id": executor_run_id,
        "fixture_id": request.fixture_id,
        "fixture_input": candidate.fixture.input,
        "metadata": execution.metadata,
        "request_id": request.id,
        "skill_source_hash": candidate.version.source_hash,
        "skill_version_id": request.skill_version_id,
    }))
}

fn failure_hashes(
    request: &CertificationRequest,
    environment_hash: &str,
    error_code: &str,
    failure_reason: &str,
    executor_run_id: &str,
) -> CertificationEvidenceHashes {
    CertificationEvidenceHashes {
        environment: environment_hash.to_string(),
        policy_snapshot: hash_value(&serde_json::json!({
            "company_id": request.company_id,
            "organization_id": request.organization_id,
            "skill_id": request.skill_id,
            "skill_version_id": request.skill_version_id,
        })),
        execution: hash_value(&serde_json::json!({
            "error_code": error_code,
            "executor_run_id": executor_run_id,
            "failure_reason": failure_reason,
            "fixture_id": request.fixture_id,
            "request_id": request.id,
            "skill_version_id": request.skill_version_id,
        })),
    }
}

fn required_u64(row: &Value, camel: &str, snake: &str) -> Result<u64> {
    optional_u64(row, camel, snake)
        .filter(|value| *value > 0)
        .with_context(|| format!("{snake} is missing or invalid"))
}

fn optional_u64(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_string(row: &Value, camel: &str, snake: &str) -> Option<String> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn valid_sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn runtime_profile_matches(
    profile: &CertificationRuntimeProfile,
    expected_runtime_hash: &str,
) -> bool {
    valid_sha256(expected_runtime_hash) && profile.runtime_hash == expected_runtime_hash
}

pub fn hash_value(value: &Value) -> String {
    let canonical = canonicalize(value);
    let bytes = serde_json::to_vec(&canonical).unwrap_or_else(|_| b"null".to_vec());
    sha256_prefixed(&bytes)
}

fn sha256_prefixed(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries: Vec<_> = object.iter().collect();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            let mut canonical = Map::new();
            for (key, value) in entries {
                canonical.insert(key.clone(), canonicalize(value));
            }
            Value::Object(canonical)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::{
        manifest::RiskClass,
        release_registry::{CandidateFixture, CandidateSkillVersion},
    };
    use std::sync::atomic::{AtomicBool, Ordering};

    struct EchoInputAdapter;

    #[async_trait]
    impl CandidateCertificationAdapter for EchoInputAdapter {
        fn supports(&self, version: &CandidateSkillVersion) -> bool {
            version.skill_key == "echo" && version.version.starts_with("1.")
        }

        async fn execute(
            &self,
            request: CandidateExecutionRequest,
        ) -> Result<CandidateExecution, CertificationExecutionError> {
            Ok(CandidateExecution {
                actual_output: request.input,
                executor_run_id: Some("adapter-run-42".to_string()),
                metadata: None,
            })
        }
    }

    struct CancellationProbeAdapter {
        cancelled: Arc<AtomicBool>,
    }

    struct CancellationSignal(Arc<AtomicBool>);

    impl Drop for CancellationSignal {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[async_trait]
    impl CandidateCertificationAdapter for CancellationProbeAdapter {
        fn supports(&self, version: &CandidateSkillVersion) -> bool {
            version.skill_key == "echo"
        }

        async fn execute(
            &self,
            _request: CandidateExecutionRequest,
        ) -> Result<CandidateExecution, CertificationExecutionError> {
            let _cancellation_signal = CancellationSignal(self.cancelled.clone());
            std::future::pending().await
        }
    }

    fn candidate(expected_output: Value) -> CandidateCertificationInputs {
        CandidateCertificationInputs {
            version: CandidateSkillVersion {
                id: 3,
                organization_id: 7,
                skill_id: 11,
                skill_key: "echo".to_string(),
                version: "1.0.0".to_string(),
                manifest_json: serde_json::json!({"skill_key": "echo"}),
                source_hash: format!("sha256:{}", "a".repeat(64)),
                risk: RiskClass::Green,
                max_steps: 1,
                max_tool_calls: 1,
                permissions: vec![],
                resources: vec![],
                output_types: vec!["application/json".to_string()],
            },
            fixture: CandidateFixture {
                id: 5,
                organization_id: 7,
                skill_id: 11,
                fixture_key: "echo-1".to_string(),
                input: serde_json::json!({"source": "executed"}),
                expected_output,
            },
        }
    }

    fn environment(dataset: Value, virtual_files: Value) -> CandidateCertificationEnvironment {
        CandidateCertificationEnvironment {
            id: 13,
            organization_id: 7,
            skill_id: 11,
            fixture_id: 5,
            dataset,
            virtual_files,
            environment_fingerprint: format!("sha256:{}", "e".repeat(64)),
        }
    }

    fn empty_environment() -> CandidateCertificationEnvironment {
        environment(serde_json::json!({}), serde_json::json!({}))
    }

    fn built_in_candidate(skill_key: &str, source_hash_byte: char) -> CandidateCertificationInputs {
        let mut candidate = candidate(serde_json::json!({"items": []}));
        candidate.version.skill_key = skill_key.to_string();
        candidate.version.source_hash =
            format!("sha256:{}", source_hash_byte.to_string().repeat(64));
        candidate.version.manifest_json = serde_json::json!({
            "skill_key": skill_key,
            "source_hash": candidate.version.source_hash,
            "version": "1.0.0"
        });
        candidate.fixture.input = match skill_key {
            "report_composer" => serde_json::json!({
                "companyId": 8,
                "date": "2026-07-10",
                "reportKey": "daily_business_summary_v1",
                "timezone": "UTC"
            }),
            "low_stock" => serde_json::json!({
                "location_id": null,
                "threshold": 5.0
            }),
            _ => Value::Null,
        };
        candidate.version.resources = match skill_key {
            "report_composer" => vec![REPORT_COMPOSER_RESOURCE.to_string()],
            "low_stock" => vec![LOW_STOCK_RESOURCE.to_string()],
            _ => Vec::new(),
        };
        candidate.version.output_types = match skill_key {
            "report_composer" => vec![report_composer::REPORT_COMPOSER_OUTPUT_TYPE.to_string()],
            "low_stock" => vec![low_stock::LOW_STOCK_OUTPUT_TYPE.to_string()],
            _ => vec!["application/json".to_string()],
        };
        candidate
    }

    fn low_stock_environment() -> CandidateCertificationEnvironment {
        environment(
            serde_json::json!({
                (LOW_STOCK_RESOURCE): {
                    "organizationId": 7,
                    "companyId": 8,
                    "data": {
                        "products": [{
                            "organizationId": 7,
                            "companyId": 8,
                            "id": 20,
                            "defaultCode": "W-20",
                            "name": "Widget",
                            "reorderingMinQty": 5.0
                        }],
                        "stockQuants": [{
                            "organizationId": 7,
                            "companyId": 8,
                            "productId": 20,
                            "locationId": 4,
                            "quantity": 2.0
                        }]
                    }
                }
            }),
            serde_json::json!({}),
        )
    }

    fn report_environment() -> CandidateCertificationEnvironment {
        let preview = serde_json::json!({
            "organizationId": 7,
            "companyId": 8,
            "content": {
                "currency": {"currencyId": 1, "minorUnitScale": 2},
                "report": {
                    "totals": {
                        "salesGross": {"minorUnits": 1000},
                        "purchasesGross": {"minorUnits": 300},
                        "receipts": {"minorUnits": 900},
                        "disbursements": {"minorUnits": 200},
                        "feesAndTax": {"minorUnits": 100},
                        "netCashFlow": {"minorUnits": 700}
                    }
                }
            }
        })
        .to_string();
        environment(
            serde_json::json!({}),
            serde_json::json!({(REPORT_PREVIEW_FIXTURE_PATH): preview}),
        )
    }

    #[tokio::test]
    async fn adapter_receives_input_but_not_expected_output() {
        let registry = CandidateAdapterRegistry::new(vec![Arc::new(EchoInputAdapter)]);
        let result = registry
            .execute(
                candidate(serde_json::json!({"source": "self-attested"})),
                empty_environment(),
                7,
                8,
            )
            .await
            .expect("supported adapter should execute");

        assert_eq!(
            result.actual_output,
            serde_json::json!({"source": "executed"})
        );
    }

    #[tokio::test]
    async fn timed_out_adapter_is_cancelled_and_never_returns_a_pass() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let registry = CandidateAdapterRegistry::new(vec![Arc::new(CancellationProbeAdapter {
            cancelled: cancelled.clone(),
        })]);

        let result = execute_with_timeout(
            &registry,
            candidate(serde_json::json!({"source": "must-not-pass"})),
            empty_environment(),
            7,
            8,
            Duration::from_millis(1),
        )
        .await;

        assert_eq!(result, Err(CertificationExecutionError::Timeout));
        assert!(
            cancelled.load(Ordering::SeqCst),
            "timeout must drop the in-flight adapter future"
        );
        let (error_code, reason) = execution_failure(&CertificationExecutionError::Timeout);
        assert_eq!(error_code, "certification_timeout");
        assert_eq!(reason, CERTIFICATION_TIMEOUT_REASON);
        assert!(
            reason.len() < 128,
            "terminal timeout reason must be bounded"
        );
    }

    #[test]
    fn polling_includes_queued_and_running_claim_candidates() {
        let sql = claim_candidate_sql(MAX_CERTIFICATION_BATCH_SIZE + 1);

        assert!(sql.contains("status = 'Queued'"));
        assert!(sql.contains("status = 'Running'"));
        assert!(sql.ends_with("LIMIT 100"));
    }

    #[test]
    fn invalid_adapter_run_id_falls_back_to_the_worker_run_id() {
        let worker_run_id = "certification:trusted";

        assert_eq!(
            trusted_executor_run_id(Some("adapter-run-42"), worker_run_id),
            "adapter-run-42"
        );
        assert_eq!(
            trusted_executor_run_id(
                Some(&"x".repeat(MAX_EXECUTOR_RUN_ID_LEN + 1)),
                worker_run_id
            ),
            worker_run_id
        );
        assert_eq!(
            trusted_executor_run_id(Some("adapter\nforged"), worker_run_id),
            worker_run_id
        );
        assert_eq!(
            trusted_executor_run_id(Some(" padded "), worker_run_id),
            worker_run_id
        );
    }

    #[test]
    fn reducer_failure_fields_are_sanitized_and_byte_bounded() {
        let error_code = bounded_error_code(&format!(
            " Adapter Failed /\n{} ",
            "X".repeat(MAX_ERROR_CODE_LEN + 20)
        ));
        let reason =
            bounded_failure_reason(&format!(" adapter\u{0000} failure {}", "é".repeat(5_000)));

        assert!(valid_reducer_text(&error_code, MAX_ERROR_CODE_LEN));
        assert!(error_code
            .chars()
            .all(|character| character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '_' | '-')));
        assert!(reason.len() <= MAX_FAILURE_REASON_LEN);
        assert!(!reason.chars().any(char::is_control));
        assert!(!reason.is_empty());
    }

    #[test]
    fn oversized_adapter_metadata_is_replaced_by_a_bounded_digest() {
        let metadata = serde_json::json!({
            "untrusted": "x".repeat(MAX_METADATA_LEN + 1),
        });
        let bounded =
            bounded_adapter_metadata(Some(&metadata)).expect("metadata should remain attributable");
        let parsed: Value = serde_json::from_str(&bounded).expect("summary should remain JSON");

        assert!(bounded.len() <= MAX_METADATA_LEN);
        assert_eq!(parsed["metadataOmitted"], true);
        assert!(parsed["metadataSha256"].as_str().is_some_and(valid_sha256));
    }

    #[tokio::test]
    async fn unsupported_candidate_fails_closed() {
        let registry = CandidateAdapterRegistry::default();
        let candidate = candidate(serde_json::json!({"source": "executed"}));
        let error = registry
            .execute(candidate, empty_environment(), 7, 8)
            .await
            .expect_err("empty registry must deny execution");

        assert_eq!(
            error,
            CertificationExecutionError::UnsupportedSkill {
                skill_key: "echo".to_string(),
                version: "1.0.0".to_string(),
            }
        );
    }

    #[tokio::test]
    async fn report_composer_rejects_a_source_hash_not_bound_to_the_adapter() {
        let registry = CandidateAdapterRegistry::production();
        let candidate = built_in_candidate("report_composer", 'a');
        let error = registry
            .execute(candidate, report_environment(), 7, 8)
            .await
            .expect_err("source mismatch must fail closed");

        assert!(matches!(
            error,
            CertificationExecutionError::UnsupportedSkill { ref skill_key, .. }
                if skill_key == "report_composer"
        ));
    }

    #[tokio::test]
    async fn low_stock_rejects_a_source_hash_not_bound_to_the_adapter() {
        let registry = CandidateAdapterRegistry::production();
        let candidate = built_in_candidate("low_stock", 'b');
        let error = registry
            .execute(candidate, low_stock_environment(), 7, 8)
            .await
            .expect_err("source mismatch must fail closed");

        assert!(matches!(
            error,
            CertificationExecutionError::UnsupportedSkill { ref skill_key, .. }
                if skill_key == "low_stock"
        ));
    }

    #[tokio::test]
    async fn low_stock_executes_only_the_pinned_scoped_dataset() {
        let registry = CandidateAdapterRegistry::production();
        let mut candidate = built_in_candidate("low_stock", '0');
        candidate.version.source_hash = low_stock_certification_bundle_hash();

        let result = registry
            .execute(candidate, low_stock_environment(), 7, 8)
            .await
            .expect("bound low-stock adapter should execute");

        assert_eq!(result.actual_output["items"][0]["product_id"], 20);
        assert_eq!(
            result
                .metadata
                .as_ref()
                .and_then(|value| value.get("certificationEnvironmentId"))
                .and_then(Value::as_u64),
            Some(13)
        );
        assert_eq!(
            result
                .metadata
                .as_ref()
                .and_then(|value| value.pointer("/policyEvidence/outcome"))
                .and_then(Value::as_str),
            Some("allow")
        );
    }

    #[tokio::test]
    async fn report_composer_executes_only_the_pinned_virtual_preview() {
        let registry = CandidateAdapterRegistry::production();
        let mut candidate = built_in_candidate("report_composer", '0');
        candidate.version.source_hash = report_composer_certification_bundle_hash();

        let result = registry
            .execute(candidate, report_environment(), 7, 8)
            .await
            .expect("bound report adapter should execute");

        assert_eq!(result.actual_output["items"][0]["companyId"], 8);
        assert_eq!(result.actual_output["items"][0]["valueMinorUnits"], 1000);
    }

    #[tokio::test]
    async fn built_in_execution_does_not_depend_on_expected_output() {
        let registry = CandidateAdapterRegistry::production();
        let mut left = built_in_candidate("low_stock", '0');
        left.version.source_hash = low_stock_certification_bundle_hash();
        let mut right = left.clone();
        left.fixture.expected_output = serde_json::json!({"items": []});
        right.fixture.expected_output =
            serde_json::json!({"items": [{"copied": "must never happen"}]});

        let left_output = registry
            .execute(left, low_stock_environment(), 7, 8)
            .await
            .expect("first execution");
        let right_output = registry
            .execute(right, low_stock_environment(), 7, 8)
            .await
            .expect("second execution");

        assert_eq!(left_output.actual_output, right_output.actual_output);
    }

    #[tokio::test]
    async fn candidate_policy_drift_fails_closed() {
        let registry = CandidateAdapterRegistry::production();
        let mut red = built_in_candidate("low_stock", '0');
        red.version.source_hash = low_stock_certification_bundle_hash();
        red.version.risk = RiskClass::Red;
        assert!(matches!(
            registry
                .execute(red, low_stock_environment(), 7, 8)
                .await,
            Err(CertificationExecutionError::Adapter(message))
                if message.contains("canonical policy denied")
        ));

        let mut invalid_limit = built_in_candidate("low_stock", '0');
        invalid_limit.version.source_hash = low_stock_certification_bundle_hash();
        invalid_limit.version.max_tool_calls = 0;
        assert!(matches!(
            registry
                .execute(invalid_limit, low_stock_environment(), 7, 8)
                .await,
            Err(CertificationExecutionError::Adapter(message))
                if message.contains("invalid execution limits")
        ));

        let mut missing_resource = built_in_candidate("low_stock", '0');
        missing_resource.version.source_hash = low_stock_certification_bundle_hash();
        missing_resource.version.resources.clear();
        assert!(matches!(
            registry
                .execute(missing_resource, low_stock_environment(), 7, 8)
                .await,
            Err(CertificationExecutionError::Adapter(message))
                if message.contains("does not declare")
        ));
    }

    #[test]
    fn evidence_hash_is_sha256_prefixed_and_key_order_stable() {
        let left = hash_value(&serde_json::json!({"actual": {"a": 1, "b": 2}}));
        let right = hash_value(&serde_json::json!({"actual": {"b": 2, "a": 1}}));

        assert_eq!(left, right);
        assert_eq!(left.len(), "sha256:".len() + 64);
    }

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            sha256_prefixed(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn parses_claimed_request_and_runtime_profile() {
        let request = parse_request(&serde_json::json!({
            "id": 1,
            "organizationId": 2,
            "companyId": 3,
            "skillId": 4,
            "skillVersionId": 5,
            "fixtureId": 6,
            "runtimeProfileId": 7,
            "certificationEnvironmentId": 8
        }))
        .expect("request should parse");
        let profile = parse_runtime_profile(&serde_json::json!({
            "id": 7,
            "organization_id": 2,
            "runtime_hash": format!("sha256:{}", "a".repeat(64))
        }))
        .expect("profile should parse");

        assert_eq!(request.runtime_profile_id, Some(profile.id));
        assert_eq!(request.certification_environment_id, Some(8));
        assert_eq!(profile.organization_id, request.organization_id);
    }

    #[test]
    fn rejects_runtime_profile_with_unprefixed_hash() {
        let error = parse_runtime_profile(&serde_json::json!({
            "id": 7,
            "organization_id": 2,
            "runtime_hash": "a".repeat(64)
        }))
        .expect_err("unprefixed runtime hash must fail");

        assert!(error.to_string().contains("runtime profile hash"));
    }

    #[test]
    fn claimed_profile_must_match_the_executor_build() {
        let profile = CertificationRuntimeProfile {
            id: 1,
            organization_id: 2,
            runtime_hash: format!("sha256:{}", "a".repeat(64)),
        };

        assert!(runtime_profile_matches(&profile, &profile.runtime_hash));
        assert!(!runtime_profile_matches(
            &profile,
            &format!("sha256:{}", "b".repeat(64))
        ));
    }

    #[test]
    fn policy_hash_changes_with_company_scope() {
        let candidate = candidate(serde_json::json!({"source": "executed"}));
        let request = CertificationRequest {
            id: 1,
            organization_id: 7,
            company_id: 8,
            skill_id: 11,
            skill_version_id: 3,
            fixture_id: 5,
            runtime_profile_id: Some(9),
            certification_environment_id: Some(13),
        };
        let left = policy_snapshot_hash(&request, &candidate);
        let right = policy_snapshot_hash(
            &CertificationRequest {
                company_id: 99,
                ..request
            },
            &candidate,
        );

        assert_ne!(left, right);
    }

    #[test]
    fn enforced_policy_hash_binds_the_actual_policy_evidence() {
        let candidate = candidate(serde_json::json!({"source": "executed"}));
        let request = CertificationRequest {
            id: 1,
            organization_id: 7,
            company_id: 8,
            skill_id: 11,
            skill_version_id: 3,
            fixture_id: 5,
            runtime_profile_id: Some(9),
            certification_environment_id: Some(13),
        };
        let execution = |result_hash: &str| CandidateExecution {
            actual_output: serde_json::json!({"items": []}),
            executor_run_id: None,
            metadata: Some(serde_json::json!({
                "policyEvidence": {
                    "decisionHashes": {"request_hash": "one"},
                    "outcome": "allow",
                    "resultHash": result_hash,
                }
            })),
        };

        assert_ne!(
            enforced_policy_snapshot_hash(&request, &candidate, &execution("first")),
            enforced_policy_snapshot_hash(&request, &candidate, &execution("second"))
        );
    }

    #[test]
    fn failure_evidence_uses_the_exact_pinned_environment_hash() {
        let request = CertificationRequest {
            id: 1,
            organization_id: 7,
            company_id: 8,
            skill_id: 11,
            skill_version_id: 3,
            fixture_id: 5,
            runtime_profile_id: Some(9),
            certification_environment_id: Some(13),
        };
        let pinned = format!("sha256:{}", "d".repeat(64));
        let hashes = failure_hashes(&request, &pinned, "test_failure", "denied", "run-1");

        assert_eq!(hashes.environment, pinned);
    }

    #[test]
    fn reducer_payloads_use_sats_camel_case_fields() {
        let request = CertificationRequest {
            id: 1,
            organization_id: 7,
            company_id: 8,
            skill_id: 11,
            skill_version_id: 3,
            fixture_id: 5,
            runtime_profile_id: Some(9),
            certification_environment_id: Some(13),
        };
        let hashes = CertificationEvidenceHashes {
            environment: format!("sha256:{}", "a".repeat(64)),
            policy_snapshot: format!("sha256:{}", "b".repeat(64)),
            execution: format!("sha256:{}", "c".repeat(64)),
        };

        let complete = complete_reducer_args(&request, "{}", "run-1", &hashes, None);
        let complete_params = complete[1]
            .as_object()
            .expect("complete params should be an object");
        assert!(complete_params.contains_key("requestId"));
        assert!(complete_params.contains_key("actualOutputJson"));
        assert!(!complete_params.contains_key("request_id"));

        let fail = fail_reducer_args(
            &request,
            "unsupported_skill",
            "unsupported",
            "run-1",
            &hashes,
            None,
        );
        let fail_params = fail[1]
            .as_object()
            .expect("fail params should be an object");
        assert!(fail_params.contains_key("errorCode"));
        assert!(fail_params.contains_key("failureReason"));
        assert!(!fail_params.contains_key("error_code"));
    }
}
