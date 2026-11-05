//! Durable cost admission for non-generative Mistral token/page usage.
//!
//! The native metered reducers use the same monetary budget/reservation rows as
//! chat, while retaining truthful usage units. A provider call happens only
//! after the existing provider-attempt owner atomically claims dispatch. Unknown
//! outcomes retain their hold; successful private outputs survive a lost reply.

use std::future::Future;

#[derive(Debug)]
pub(crate) struct MeteredRecoveryRequired;
impl std::fmt::Display for MeteredRecoveryRequired {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(
            "metered operation needs explicit recovery; automatic paid retries are forbidden",
        )
    }
}
impl std::error::Error for MeteredRecoveryRequired {}

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use stdb_client::{ReducerCall, StdbClient};

use crate::ai_spend::{self, AcceptAttemptRequest, AttemptResult, ProviderAttempt, SpendReader};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MeteredUnit {
    Tokens,
    Pages,
}

impl MeteredUnit {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Tokens => "tokens",
            Self::Pages => "pages",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct MeteredScope {
    pub organization_id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    /// Zero requests a narrow native infrastructure accounting run.
    pub run_id: u64,
    /// Trusted actor identity, or empty for a server-owned queue operation.
    pub actor_identity: String,
    pub request_key: String,
    pub model: String,
    pub unit: MeteredUnit,
    pub allowance: u32,
}

pub(crate) struct MeteredResult<T> {
    pub value: T,
    pub units: u32,
}

struct StoredMeter {
    reservation_id: u64,
    run_id: u64,
    actual_units: Option<u32>,
    result_json: Option<String>,
    dispatch_claim: Option<String>,
}

#[async_trait]
trait MeteredLedger: Send + Sync {
    async fn read(&self, scope: &MeteredScope) -> Result<Option<StoredMeter>>;
    async fn reserve(&self, scope: &MeteredScope) -> Result<()>;
    async fn attempt(
        &self,
        scope: &MeteredScope,
        row: &StoredMeter,
    ) -> Result<Option<ProviderAttempt>>;
    async fn accept(&self, scope: &MeteredScope, row: &StoredMeter) -> Result<()>;
    async fn claim(
        &self,
        scope: &MeteredScope,
        row: &StoredMeter,
        attempt_id: u64,
        claim_id: &str,
    ) -> Result<()>;
    async fn unknown(&self, scope: &MeteredScope, attempt_id: u64) -> Result<()>;
    async fn settle(
        &self,
        scope: &MeteredScope,
        row: &StoredMeter,
        attempt_id: u64,
        units: u32,
        result_json: &str,
    ) -> Result<()>;
}

struct StdbMeteredLedger<'a> {
    writer: &'a StdbClient,
    reader: &'a StdbClient,
}

fn optional_u32(value: &Value) -> Result<Option<u32>> {
    if value.is_null() {
        return Ok(None);
    }
    if let Some(object) = value.as_object() {
        if object.contains_key("none") {
            return Ok(None);
        }
        if let Some(inner) = object.get("some") {
            let inner = inner.as_array().and_then(|v| v.first()).unwrap_or(inner);
            return optional_u32(inner);
        }
    }
    value
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .map(Some)
        .context("invalid metered usage result")
}

fn optional_string(value: &Value) -> Result<Option<String>> {
    if value.is_null() {
        return Ok(None);
    }
    if let Some(object) = value.as_object() {
        if object.contains_key("none") {
            return Ok(None);
        }
        if let Some(inner) = object.get("some") {
            let inner = inner.as_array().and_then(|v| v.first()).unwrap_or(inner);
            return optional_string(inner);
        }
    }
    value
        .as_str()
        .map(|s| Some(s.to_owned()))
        .context("invalid metered stored result")
}

fn integer(row: &Value, name: &str) -> Result<u64> {
    let value = row
        .get(name)
        .context("metered result is missing an identity")?;
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .context("invalid metered identity")
}

fn decode_meter(row: &Value, scope: &MeteredScope) -> Result<StoredMeter> {
    if integer(row, "organization_id")? != scope.organization_id
        || integer(row, "company_id")? != scope.company_id
        || integer(row, "agent_id")? != scope.agent_id
        || row.get("request_key").and_then(Value::as_str) != Some(scope.request_key.as_str())
        || row.get("model").and_then(Value::as_str) != Some(scope.model.as_str())
        || row.get("unit").and_then(Value::as_str) != Some(scope.unit.as_str())
        || integer(row, "allowance")? != u64::from(scope.allowance)
        || (!scope.actor_identity.is_empty()
            && row.get("actor_identity").and_then(Value::as_str)
                != Some(scope.actor_identity.as_str()))
    {
        bail!("metered result does not match the trusted operation");
    }
    let run_id = integer(row, "run_id")?;
    if run_id == 0 || (scope.run_id != 0 && scope.run_id != run_id) {
        bail!("metered result has a different run binding");
    }
    Ok(StoredMeter {
        reservation_id: integer(row, "reservation_id")?,
        run_id,
        actual_units: optional_u32(
            row.get("actual_units")
                .context("metered result has no usage")?,
        )?,
        result_json: optional_string(
            row.get("result_json")
                .context("metered result has no recovery state")?,
        )?,
        dispatch_claim: optional_string(
            row.get("dispatch_claim")
                .context("metered result has no dispatch state")?,
        )?,
    })
}

async fn native_call(writer: &StdbClient, name: &str, args: Value) -> Result<()> {
    // Unknown names fail before I/O until canonical contracts are generated,
    // released and pinned. There is deliberately no unchecked HTTP fallback.
    let call = ReducerCall::from_name(name, args)
        .context("the metered-spend contract release is required before activation")?;
    writer
        .call_reducer(call)
        .await
        .context("metered spend native operation failed")
}

#[async_trait]
impl MeteredLedger for StdbMeteredLedger<'_> {
    async fn read(&self, scope: &MeteredScope) -> Result<Option<StoredMeter>> {
        ai_spend::validate_request_key(&scope.request_key)?;
        let key = scope.request_key.replace('\'', "''");
        let sql = format!("SELECT reservation_id, organization_id, company_id, agent_id, run_id, request_key, actor_identity, model, dispatch_claim, unit, allowance, actual_units, result_json FROM ai_metered_usage_read WHERE organization_id = {} AND company_id = {} AND agent_id = {} AND request_key = '{}' LIMIT 2",
            scope.organization_id, scope.company_id, scope.agent_id, key);
        let rows = self
            .reader
            .query_sql_sats(&sql)
            .await
            .context("read private metered spend")?;
        let matches = rows
            .iter()
            .filter(|r| {
                r.get("request_key").and_then(Value::as_str) == Some(scope.request_key.as_str())
            })
            .collect::<Vec<_>>();
        if matches.len() > 1 {
            bail!("metered spend has ambiguous request identity");
        }
        matches
            .first()
            .map(|row| decode_meter(row, scope))
            .transpose()
    }

    async fn reserve(&self, scope: &MeteredScope) -> Result<()> {
        native_call(self.writer, "reserve_ai_metered_spend", json!([scope.organization_id, {
            "company_id":scope.company_id,"agent_id":scope.agent_id,"run_id":scope.run_id,
            "actor_identity":scope.actor_identity,"request_key":scope.request_key,"model":scope.model,
            "unit":scope.unit.as_str(),"allowance":scope.allowance }])).await
    }

    async fn attempt(
        &self,
        scope: &MeteredScope,
        row: &StoredMeter,
    ) -> Result<Option<ProviderAttempt>> {
        SpendReader::new(self.reader)
            .provider_attempt(scope.organization_id, row.run_id, &scope.request_key)
            .await
    }

    async fn accept(&self, scope: &MeteredScope, row: &StoredMeter) -> Result<()> {
        ai_spend::accept_provider_attempt(
            self.writer,
            &AcceptAttemptRequest {
                organization_id: scope.organization_id,
                company_id: scope.company_id,
                agent_id: scope.agent_id,
                run_id: row.run_id,
                reservation_id: row.reservation_id,
                request_key: scope.request_key.clone(),
                provider: "mistral".into(),
                model: scope.model.clone(),
            },
        )
        .await
    }

    async fn claim(
        &self,
        scope: &MeteredScope,
        row: &StoredMeter,
        attempt_id: u64,
        claim_id: &str,
    ) -> Result<()> {
        native_call(
            self.writer,
            "claim_ai_metered_dispatch",
            json!([
                scope.organization_id,
                row.reservation_id,
                attempt_id,
                claim_id
            ]),
        )
        .await
    }

    async fn unknown(&self, scope: &MeteredScope, attempt_id: u64) -> Result<()> {
        ai_spend::record_provider_attempt_result(
            self.writer,
            scope.organization_id,
            &AttemptResult::outcome_unknown(
                attempt_id,
                "metered provider result requires reconciliation",
            ),
        )
        .await
    }

    async fn settle(
        &self,
        scope: &MeteredScope,
        row: &StoredMeter,
        attempt_id: u64,
        units: u32,
        result_json: &str,
    ) -> Result<()> {
        native_call(
            self.writer,
            "settle_ai_metered_spend",
            json!([scope.organization_id, {
            "reservation_id":row.reservation_id,"attempt_id":attempt_id,
            "actual_units":units,"result_json":result_json }]),
        )
        .await
    }
}

/// Return the exact completed output on replay; otherwise dispatch at most once.
pub(crate) async fn execute_metered<T, F, Fut>(
    writer: &StdbClient,
    reader: &StdbClient,
    scope: MeteredScope,
    call: F,
) -> Result<T>
where
    T: Serialize + DeserializeOwned,
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<MeteredResult<T>>>,
{
    execute_with_ledger(&StdbMeteredLedger { writer, reader }, scope, call).await
}

async fn execute_with_ledger<T, F, Fut>(
    ledger: &dyn MeteredLedger,
    scope: MeteredScope,
    call: F,
) -> Result<T>
where
    T: Serialize + DeserializeOwned,
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<MeteredResult<T>>>,
{
    if scope.organization_id == 0
        || scope.company_id == 0
        || scope.agent_id == 0
        || scope.allowance == 0
        || scope.allowance > 10_000_000
        || scope.model.is_empty()
        || scope.model.ends_with("-latest")
    {
        bail!("metered provider call requires a complete trusted scope and exact model");
    }
    ai_spend::validate_request_key(&scope.request_key)?;
    let existing = ledger.read(&scope).await?;
    if let Some(existing) = &existing {
        if existing.actual_units.is_some() {
            return recover_output(existing).context(MeteredRecoveryRequired);
        }
        if existing.dispatch_claim.is_some() {
            return Err(anyhow::anyhow!(
                "metered provider request is already claimed; reconcile its outcome"
            ))
            .context(MeteredRecoveryRequired);
        }
    }
    // A reserved request without a dispatch owner can resume safely. A unique
    // native invocation claim still decides the single eventual provider call.
    ledger.reserve(&scope).await?;
    let row = ledger
        .read(&scope)
        .await?
        .context("metered reservation readback is unavailable")?;
    if row.actual_units.is_some() {
        return recover_output(&row).context(MeteredRecoveryRequired);
    }
    if let Some(attempt) = ledger.attempt(&scope, &row).await? {
        if attempt.status != "accepted" {
            return Err(anyhow::anyhow!(
                "metered provider attempt already dispatched; no automatic redispatch"
            ))
            .context(MeteredRecoveryRequired);
        }
    } else {
        ledger.accept(&scope, &row).await?;
    }
    let attempt = ledger
        .attempt(&scope, &row)
        .await?
        .context("metered attempt readback is unavailable")?;
    if attempt.reservation_id != row.reservation_id
        || attempt.company_id != scope.company_id
        || attempt.agent_id != scope.agent_id
        || attempt.model != scope.model
        || attempt.provider != "mistral"
        || attempt.status != "accepted"
    {
        return Err(anyhow::anyhow!(
            "metered provider attempt does not match the dispatch binding"
        ))
        .context(MeteredRecoveryRequired);
    }
    let claim_id = uuid::Uuid::new_v4().simple().to_string();
    ledger
        .claim(&scope, &row, attempt.id, &claim_id)
        .await
        .context(MeteredRecoveryRequired)?;
    async {
        let claimed = ledger
            .read(&scope)
            .await?
            .context("metered dispatch claim is unavailable")?;
        if claimed.dispatch_claim.as_deref() != Some(claim_id.as_str()) {
            bail!("metered dispatch belongs to another invocation");
        }
        let output = match call().await {
            Ok(output) => output,
            Err(_) => {
                // Suppress provider payload/transport details; preserve the durable hold.
                let _ = ledger.unknown(&scope, attempt.id).await;
                bail!("metered provider outcome is uncertain; reconcile the existing request");
            }
        };
        if output.units > scope.allowance {
            let _ = ledger.unknown(&scope, attempt.id).await;
            bail!("metered usage exceeds its allowance; reserved spend requires reconciliation");
        }
        let result =
            serde_json::to_string(&output.value).context("serialize private metered result")?;
        if result.len() > 1_048_576 {
            let _ = ledger.unknown(&scope, attempt.id).await;
            bail!("metered output exceeds its durable recovery bound");
        }
        ledger
            .settle(&scope, &row, attempt.id, output.units, &result)
            .await
            .context(
                "provider completed but metered settlement requires recovery; do not redispatch",
            )?;
        let settled = ledger
            .read(&scope)
            .await?
            .context("metered settlement readback is unavailable")?;
        if settled.actual_units != Some(output.units)
            || settled.result_json.as_deref() != Some(result.as_str())
        {
            bail!("metered settlement readback does not match the exact provider result");
        }
        Ok(output.value)
    }
    .await
    .context(MeteredRecoveryRequired)
}

fn recover_output<T: DeserializeOwned>(row: &StoredMeter) -> Result<T> {
    serde_json::from_str(
        row.result_json
            .as_deref()
            .context("metered output needs explicit recovery")?,
    )
    .context("stored metered output is incompatible")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    };

    #[derive(Default)]
    struct State {
        reserved: bool,
        status: String,
        result: Option<(u32, String)>,
        claim: Option<String>,
        admission_blocked: bool,
    }
    #[derive(Default)]
    struct TestLedger {
        state: Mutex<State>,
    }
    fn scope() -> MeteredScope {
        MeteredScope {
            organization_id: 1,
            company_id: 2,
            agent_id: 3,
            run_id: 0,
            actor_identity: "a".repeat(64),
            request_key: "ocr:document:hash".into(),
            model: "mistral-ocr-2603".into(),
            unit: MeteredUnit::Pages,
            allowance: 5,
        }
    }
    #[async_trait]
    impl MeteredLedger for TestLedger {
        async fn read(&self, _: &MeteredScope) -> Result<Option<StoredMeter>> {
            let s = self.state.lock().map_err(|_| anyhow::anyhow!("poisoned"))?;
            Ok(s.reserved.then(|| StoredMeter {
                reservation_id: 4,
                run_id: 5,
                actual_units: s.result.as_ref().map(|r| r.0),
                result_json: s.result.as_ref().map(|r| r.1.clone()),
                dispatch_claim: s.claim.clone(),
            }))
        }
        async fn reserve(&self, _: &MeteredScope) -> Result<()> {
            let mut state = self.state.lock().map_err(|_| anyhow::anyhow!("poisoned"))?;
            if state.admission_blocked {
                bail!("meter price not provisioned");
            }
            state.reserved = true;
            Ok(())
        }
        async fn attempt(
            &self,
            scope: &MeteredScope,
            _: &StoredMeter,
        ) -> Result<Option<ProviderAttempt>> {
            let s = self.state.lock().map_err(|_| anyhow::anyhow!("poisoned"))?;
            Ok((!s.status.is_empty()).then(|| ProviderAttempt {
                id: 6,
                company_id: 2,
                agent_id: 3,
                reservation_id: 4,
                request_key: scope.request_key.clone(),
                provider: "mistral".into(),
                model: scope.model.clone(),
                status: s.status.clone(),
                input_tokens: 0,
                output_tokens: 0,
                failure_reason: None,
                resolution: None,
                recovery_actor: None,
                recovery_approval_id: None,
                reconciliation_actor: None,
                reconciliation_approval_id: None,
            }))
        }
        async fn accept(&self, _: &MeteredScope, _: &StoredMeter) -> Result<()> {
            let mut s = self.state.lock().map_err(|_| anyhow::anyhow!("poisoned"))?;
            if s.status.is_empty() {
                s.status = "accepted".into();
            }
            Ok(())
        }
        async fn claim(
            &self,
            _: &MeteredScope,
            _: &StoredMeter,
            _: u64,
            claim: &str,
        ) -> Result<()> {
            let mut s = self.state.lock().map_err(|_| anyhow::anyhow!("poisoned"))?;
            if s.status != "accepted" {
                bail!("already claimed");
            }
            s.status = "dispatched".into();
            s.claim = Some(claim.to_owned());
            Ok(())
        }
        async fn unknown(&self, _: &MeteredScope, _: u64) -> Result<()> {
            self.state
                .lock()
                .map_err(|_| anyhow::anyhow!("poisoned"))?
                .status = "outcome_unknown".into();
            Ok(())
        }
        async fn settle(
            &self,
            _: &MeteredScope,
            _: &StoredMeter,
            _: u64,
            units: u32,
            result: &str,
        ) -> Result<()> {
            let mut s = self.state.lock().map_err(|_| anyhow::anyhow!("poisoned"))?;
            s.status = "succeeded".into();
            s.result = Some((units, result.into()));
            Ok(())
        }
    }
    #[tokio::test]
    async fn setup_blocker_does_not_classify_as_uncertain_paid_dispatch() {
        let ledger = TestLedger::default();
        ledger.state.lock().unwrap().admission_blocked = true;
        let calls = AtomicUsize::new(0);
        let result: Result<String> = execute_with_ledger(&ledger, scope(), || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(MeteredResult {
                value: "never".into(),
                units: 1,
            })
        })
        .await;
        let error = result.unwrap_err();
        assert!(error.downcast_ref::<MeteredRecoveryRequired>().is_none());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(!ledger.state.lock().unwrap().reserved);
    }

    #[tokio::test]
    async fn unclaimed_reservation_resumes_without_a_second_hold() {
        let ledger = TestLedger::default();
        ledger.state.lock().unwrap().reserved = true;
        let result: String = execute_with_ledger(&ledger, scope(), || async {
            Ok(MeteredResult {
                value: "resumed".into(),
                units: 1,
            })
        })
        .await
        .unwrap();
        assert_eq!(result, "resumed");
        assert_eq!(ledger.state.lock().unwrap().status, "succeeded");
    }

    #[tokio::test]
    async fn settled_retry_recovers_exact_text_without_a_second_provider_call() {
        let ledger = TestLedger::default();
        let calls = AtomicUsize::new(0);
        let first = execute_with_ledger(&ledger, scope(), || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(MeteredResult {
                value: "receipt text".to_owned(),
                units: 2,
            })
        })
        .await
        .unwrap();
        let retry: String = execute_with_ledger(&ledger, scope(), || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(MeteredResult {
                value: "different text".to_owned(),
                units: 2,
            })
        })
        .await
        .unwrap();
        assert_eq!(first, retry);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
    #[tokio::test]
    async fn lost_provider_reply_retains_hold_and_blocks_repeat_dispatch() {
        let ledger = TestLedger::default();
        let calls = AtomicUsize::new(0);
        let first: Result<String> = execute_with_ledger(&ledger, scope(), || async {
            calls.fetch_add(1, Ordering::SeqCst);
            bail!("timeout")
        })
        .await;
        assert!(first.is_err());
        let retry: Result<String> = execute_with_ledger(&ledger, scope(), || async {
            calls.fetch_add(1, Ordering::SeqCst);
            bail!("must not dispatch")
        })
        .await;
        assert!(retry.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(ledger.state.lock().unwrap().status, "outcome_unknown");
        assert!(ledger.state.lock().unwrap().reserved);
    }
    #[tokio::test]
    async fn over_allowance_never_settles_and_cannot_be_retried() {
        let ledger = TestLedger::default();
        let result: Result<String> = execute_with_ledger(&ledger, scope(), || async {
            Ok(MeteredResult {
                value: "text".into(),
                units: 6,
            })
        })
        .await;
        assert!(result.is_err());
        assert!(ledger.state.lock().unwrap().result.is_none());
    }
    #[test]
    fn exact_meter_readback_rejects_foreign_actor() {
        let row = json!({"organization_id":1,"company_id":2,"agent_id":3,"request_key":"ocr:document:hash",
            "model":"mistral-ocr-2603","dispatch_claim":null,"unit":"pages","allowance":5,"actor_identity":"b".repeat(64),"run_id":5,
            "reservation_id":4,"actual_units":{"none":[]},"result_json":{"none":[]}});
        assert!(decode_meter(&row, &scope()).is_err());
    }

    #[tokio::test]
    async fn real_sql_transport_preserves_meter_scope_and_optional_result() {
        let option = |kind: Value| {
            json!({"Sum":{"variants":[
                {"name":{"some":"some"},"algebraic_type":kind},
                {"name":{"some":"none"},"algebraic_type":{"Product":{"elements":[]}}}
            ]}})
        };
        let columns = vec![
            ("reservation_id", json!({"U64":[]})),
            ("organization_id", json!({"U64":[]})),
            ("company_id", json!({"U64":[]})),
            ("agent_id", json!({"U64":[]})),
            ("run_id", json!({"U64":[]})),
            ("request_key", json!({"String":[]})),
            ("actor_identity", json!({"String":[]})),
            ("model", json!({"String":[]})),
            ("dispatch_claim", option(json!({"String":[]}))),
            ("unit", json!({"String":[]})),
            ("allowance", json!({"U32":[]})),
            ("actual_units", option(json!({"U32":[]}))),
            ("result_json", option(json!({"String":[]}))),
        ];
        let elements: Vec<_> = columns
            .into_iter()
            .map(|(name, kind)| {
                json!({
            "name":{"some":name},"algebraic_type":kind})
            })
            .collect();
        let response = json!([{"schema":{"elements":elements},"rows":[[
            4,1,2,3,5,"ocr:document:hash","a".repeat(64),"mistral-ocr-2603",
            [0,"c".repeat(32)],"pages",5,[0,2],[0,"\"receipt text\""]
        ]]}]);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = axum::Router::new().fallback(move |sql: String| {
            let body = response.clone();
            async move {
                assert!(sql.contains("request_key = 'ocr:document:hash' LIMIT 2"));
                axum::Json(body)
            }
        });
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = StdbClient::new(
            format!("http://{address}"),
            "test".into(),
            "test-token".into(),
        );
        let ledger = StdbMeteredLedger {
            writer: &client,
            reader: &client,
        };
        let row = ledger.read(&scope()).await.unwrap().unwrap();
        assert_eq!(row.reservation_id, 4);
        assert_eq!(row.actual_units, Some(2));
        assert_eq!(recover_output::<String>(&row).unwrap(), "receipt text");
        assert_eq!(row.dispatch_claim, Some("c".repeat(32)));
        server.abort();
    }
}
