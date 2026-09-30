//! Loopback-only process restart acceptance for Phase 4 spend recovery.
//!
//! This module is compiled only with the `phase4-acceptance` feature. It drives
//! the production [`SpendAdmittedLlm`] and SpacetimeDB ledger without starting
//! HTTP, Qdrant, or background workers, so two separate `gateway` processes can
//! prove that an ambiguous provider outcome is durable and never redispatched.

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde_json::json;
use stdb_client::StdbClient;

use super::spend_admission::{SpendAdmittedLlm, SpendBinding, StdbSpendLedger};
use crate::{
    ai_spend::{request_key, RequestKind, SpendReader, ATTEMPT_OUTCOME_UNKNOWN},
    providers::llm::{
        CompletionTermination, LlmCompletion, LlmMessage, LlmRequest, LlmResponse, ThinkingMode,
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProbeMode {
    Timeout,
    Recover,
}

impl ProbeMode {
    fn from_env() -> Result<Self> {
        match required("PHASE4_RESTART_MODE")?.as_str() {
            "timeout" => Ok(Self::Timeout),
            "recover" => Ok(Self::Recover),
            _ => bail!("PHASE4_RESTART_MODE must be timeout or recover"),
        }
    }
}

struct ObservedProvider {
    counter_path: PathBuf,
    mode: ProbeMode,
}

#[async_trait]
impl LlmCompletion for ObservedProvider {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse> {
        increment_counter(&self.counter_path)?;
        if self.mode == ProbeMode::Timeout {
            bail!("phase4 injected ambiguous provider timeout");
        }
        Ok(LlmResponse {
            text: "this recovery response must never be dispatched".to_string(),
            input_tokens: 1,
            output_tokens: 1,
            model: req.model,
            provider: req.provider,
            tool_calls: Vec::new(),
            termination: CompletionTermination::Complete,
            provider_done_reason: Some("stop".to_string()),
            thinking_observed: false,
        })
    }
}

pub(crate) async fn run_from_env() -> Result<()> {
    if required("PHASE4_DISPOSABLE_STDB")? != "1" {
        bail!("PHASE4_DISPOSABLE_STDB=1 is required");
    }
    let host = required("STDB_HOST")?;
    require_loopback(&host)?;
    let module = required("STDB_MODULE")?;
    if !module.starts_with("lumiere-v1-phase4-") && module != "lumiere-c7-ai-source" {
        bail!(
            "STDB_MODULE must use the disposable lumiere-v1-phase4- prefix or equal lumiere-c7-ai-source"
        );
    }
    let token = required("STDB_TOKEN")?;
    let organization_id = positive_u64("PHASE4_ORGANIZATION_ID")?;
    let company_id = positive_u64("PHASE4_COMPANY_ID")?;
    let agent_id = positive_u64("PHASE4_AGENT_ID")?;
    let run_id = positive_u64("PHASE4_RUN_ID")?;
    let provider_name = required("PHASE4_PROVIDER")?;
    let model = required("PHASE4_MODEL")?;
    let counter_path = counter_path()?;
    let mode = ProbeMode::from_env()?;

    let writer = StdbClient::new(host.clone(), module.clone(), token.clone());
    let reader = StdbClient::new(host, module.clone(), token);
    let ledger = StdbSpendLedger {
        writer: &writer,
        reader: &reader,
    };
    let binding = SpendBinding {
        organization_id,
        company_id,
        agent_id,
        run_id,
        provider: provider_name.clone(),
        model: model.clone(),
        agent_max_tokens: 32,
        context_window: 4_096,
    };
    let provider = ObservedProvider {
        counter_path: counter_path.clone(),
        mode,
    };
    let admitted = SpendAdmittedLlm::new(&provider, &ledger, binding)?;
    let request = LlmRequest {
        provider: provider_name,
        model,
        system: "phase4 restart probe".to_string(),
        messages: vec![LlmMessage::text("user", "prove durable no redispatch")],
        max_tokens: 16,
        temperature: Some(0.0),
        top_p: Some(1.0),
        tools: Vec::new(),
        single_shot_tool: false,
        thinking: ThinkingMode::Disabled,
    };
    let before = read_counter(&counter_path)?;
    admitted
        .complete(request)
        .await
        .expect_err("phase4 restart probe must fail closed");
    let after = read_counter(&counter_path)?;
    let key = request_key(RequestKind::Spend, run_id, 1, 0)?;
    let attempt = SpendReader::new(&reader)
        .provider_attempt(organization_id, run_id, &key)
        .await?
        .context("phase4 provider attempt is missing")?;
    if attempt.status != ATTEMPT_OUTCOME_UNKNOWN {
        bail!("phase4 provider attempt must remain outcome_unknown");
    }

    match mode {
        ProbeMode::Timeout => {
            if after != before + 1 {
                bail!("timeout process did not observe exactly one ambiguous dispatch");
            }
        }
        ProbeMode::Recover => {
            if after != before {
                bail!("restarted process did not fail closed before provider dispatch");
            }
        }
    }

    println!(
        "{}",
        json!({
            "verified": true,
            "mode": match mode { ProbeMode::Timeout => "timeout", ProbeMode::Recover => "recover" },
            "module": module,
            "organization_id": organization_id,
            "run_id": run_id,
            "request_key": key,
            "attempt_status": attempt.status,
            "provider_dispatch_before": before,
            "provider_dispatch_after": after,
        })
    );
    Ok(())
}

fn required(name: &str) -> Result<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .with_context(|| format!("{name} is required"))
}

fn positive_u64(name: &str) -> Result<u64> {
    let value = required(name)?
        .parse::<u64>()
        .with_context(|| format!("{name} must be a positive integer"))?;
    if value == 0 {
        bail!("{name} must be a positive integer");
    }
    Ok(value)
}

fn require_loopback(host: &str) -> Result<()> {
    let parsed = reqwest::Url::parse(host).context("STDB_HOST must be a valid URL")?;
    if parsed.scheme() != "http"
        || !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        bail!("STDB_HOST must be a loopback HTTP origin");
    }
    Ok(())
}

fn counter_path() -> Result<PathBuf> {
    let path = PathBuf::from(required("PHASE4_PROVIDER_COUNTER_PATH")?);
    if !path.is_absolute()
        || !path.starts_with("/tmp")
        || path
            .components()
            .any(|component| component.as_os_str() == "..")
        || path
            .file_name()
            .and_then(|name| name.to_str())
            .is_none_or(|name| !name.starts_with("lumiere-phase4-provider-"))
    {
        bail!("PHASE4_PROVIDER_COUNTER_PATH must be /tmp/lumiere-phase4-provider-*");
    }
    Ok(path)
}

fn read_counter(path: &Path) -> Result<u64> {
    match fs::read_to_string(path) {
        Ok(value) => value
            .trim()
            .parse::<u64>()
            .context("parse provider dispatch counter"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error).context("read provider dispatch counter"),
    }
}

fn increment_counter(path: &Path) -> Result<()> {
    let next = read_counter(path)?
        .checked_add(1)
        .context("provider dispatch counter overflow")?;
    fs::write(path, format!("{next}\n")).context("write provider dispatch counter")
}
