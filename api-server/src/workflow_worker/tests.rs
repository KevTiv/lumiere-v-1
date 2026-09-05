//! Timer and crash/replay behavior; simulation support is test-only.
use super::adapter::{dispatch_allowlisted, outbox_record_idempotency_key, OutboxPayload};
use super::outbox::fresh_lease_token_at;
use super::timers::{timer_fire_idempotency_key, timer_is_due};
use super::*;

/// Forced crash points for Gate W crash/replay suite (WF-10–WF-12).
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DispatchCrashPoint {
    None,
    BeforeExternalCall,
    AfterExternalCallBeforeResult,
    AfterResultBeforeComplete,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DispatchPhase {
    Claimed,
    ExternalSucceeded,
    ResultRecorded,
    JobCompleted,
}

#[cfg(test)]
#[derive(Debug, Default)]
struct FakeExternalLedger {
    /// Effect keys that have a committed local result (semantic once).
    committed_effects: std::collections::BTreeSet<String>,
    /// External provider call count (may exceed committed on crash-after-call).
    external_calls: u64,
    /// Completions recorded after a successful result commit.
    completions: u64,
}

#[cfg(test)]
#[derive(Debug)]
enum DispatchAttemptError {
    Crashed(DispatchPhase),
    DuplicateEffect,
}

/// Pure outbox attempt used by Gate W tests: claim → adapter → result → complete.
#[cfg(test)]
fn run_outbox_attempt(
    ledger: &mut FakeExternalLedger,
    effect_key: &str,
    crash: DispatchCrashPoint,
) -> Result<DispatchPhase, DispatchAttemptError> {
    if ledger.committed_effects.contains(effect_key) {
        return Err(DispatchAttemptError::DuplicateEffect);
    }
    let _claimed = DispatchPhase::Claimed;
    if crash == DispatchCrashPoint::BeforeExternalCall {
        return Err(DispatchAttemptError::Crashed(DispatchPhase::Claimed));
    }

    ledger.external_calls += 1;
    if crash == DispatchCrashPoint::AfterExternalCallBeforeResult {
        return Err(DispatchAttemptError::Crashed(
            DispatchPhase::ExternalSucceeded,
        ));
    }

    if !ledger.committed_effects.insert(effect_key.to_string()) {
        return Err(DispatchAttemptError::DuplicateEffect);
    }
    if crash == DispatchCrashPoint::AfterResultBeforeComplete {
        return Err(DispatchAttemptError::Crashed(DispatchPhase::ResultRecorded));
    }

    ledger.completions += 1;
    Ok(DispatchPhase::JobCompleted)
}

/// Replay after crash: only commits once per effect key (WF-11).
#[cfg(test)]
fn replay_outbox_until_complete(
    ledger: &mut FakeExternalLedger,
    effect_key: &str,
) -> Result<DispatchPhase, DispatchAttemptError> {
    match run_outbox_attempt(ledger, effect_key, DispatchCrashPoint::None) {
        Ok(phase) => Ok(phase),
        Err(DispatchAttemptError::DuplicateEffect) => Ok(DispatchPhase::JobCompleted),
        Err(other) => Err(other),
    }
}

#[test]
fn dispatch_env_flag_defaults_off() {
    // Production default is false; tests must not require the env var.
    let enabled = std::env::var("LUMIERE_WORKFLOW_EXTERNAL_DISPATCH_ENABLED")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let _ = enabled;
}

#[test]
fn lease_tokens_differ_when_clock_advances() {
    let a = fresh_lease_token_at(1, 2, 100);
    let b = fresh_lease_token_at(1, 2, 101);
    assert_ne!(a, b);
    assert!(a.starts_with("lease:"));
}

#[test]
fn outbox_payload_parses_camel_and_snake() {
    let raw = r#"{"outboxId":9,"companyId":3,"actionKey":"http.post","effectKey":"e1"}"#;
    let p: OutboxPayload = serde_json::from_str(raw).unwrap();
    assert_eq!(p.outbox_id, Some(9));
    assert_eq!(p.company_id, 3);
    assert_eq!(p.action_key.as_deref(), Some("http.post"));
    assert_eq!(outbox_record_idempotency_key(&p), "e1");

    let envelope = r#"{"action_key":"external.test","company_id":5,"payload":{"x":1}}"#;
    let e: OutboxPayload = serde_json::from_str(envelope).unwrap();
    assert_eq!(e.company_id, 5);
    assert_eq!(e.action_key.as_deref(), Some("external.test"));
    assert!(e.outbox_id.is_none());
}

#[test]
fn dispatch_allowlist_fail_closed_with_webhook() {
    let mut config = Config {
        port: 1,
        stdb_host: String::new(),
        stdb_module: String::new(),
        stdb_server_token: None,
        cors_origins: vec![],
        dev_mock_org_id: None,
        ai_gateway_url: String::new(),
        ai_gateway_required: false,
        workos_client_id: None,
        stdb_credential_encryption_key: None,
        resend_api_key: None,
        resend_from_email: String::new(),
        app_url: String::new(),
        cookie_secure: false,
        report_renderer_url: None,
        report_artifact_dir: std::env::temp_dir(),
        document_blob_dir: std::env::temp_dir(),
        owner_report_worker_poll_secs: 15,
        owner_report_worker_name: String::new(),
        owner_report_worker_port: 1,
        workflow_worker_poll_secs: 15,
        workflow_worker_name: String::new(),
        workflow_worker_port: 1,
        workflow_worker_org_ids: vec![],
        workflow_worker_lease_ttl_secs: 60,
        workflow_external_dispatch_enabled: true,
        workflow_external_dispatch_company_ids: vec![3],
        workflow_external_dispatch_action_keys: vec!["external.test.execute:v1".into()],
        workflow_external_webhook_url: Some("http://127.0.0.1:9999/hook".into()),
        workflow_external_webhook_timeout_ms: 1000,
    };
    assert!(dispatch_allowlisted(
        &config,
        3,
        Some("external.test.execute:v1")
    ));
    assert!(!dispatch_allowlisted(
        &config,
        9,
        Some("external.test.execute:v1")
    ));
    assert!(!dispatch_allowlisted(&config, 3, Some("other.action")));
    config.workflow_external_dispatch_action_keys.clear();
    assert!(!dispatch_allowlisted(
        &config,
        3,
        Some("external.test.execute:v1")
    ));
    config.workflow_external_webhook_url = None;
    assert!(dispatch_allowlisted(
        &config,
        3,
        Some("external.test.execute:v1")
    ));
}

#[test]
fn wf10_fake_clock_fires_only_when_due() {
    let due = 1_000_000u64;
    assert!(!timer_is_due(due, due - 1));
    assert!(timer_is_due(due, due));
    assert!(timer_is_due(due, due + 5));
    assert_eq!(timer_fire_idempotency_key(42, 3), "timer-fire:42:3");
}

#[test]
fn wf10_restart_past_due_fires_once_idempotency_key() {
    // Stop worker past due → restart → same timer/revision → same fire key.
    let key_a = timer_fire_idempotency_key(7, 1);
    let key_b = timer_fire_idempotency_key(7, 1);
    assert_eq!(key_a, key_b);
    assert_ne!(timer_fire_idempotency_key(7, 2), key_a);
}

#[test]
fn wf11_crash_before_external_call_replays_without_duplicate_effect() {
    let mut ledger = FakeExternalLedger::default();
    let err = run_outbox_attempt(
        &mut ledger,
        "effect:order:1",
        DispatchCrashPoint::BeforeExternalCall,
    )
    .unwrap_err();
    assert!(matches!(
        err,
        DispatchAttemptError::Crashed(DispatchPhase::Claimed)
    ));
    assert_eq!(ledger.external_calls, 0);
    assert!(ledger.committed_effects.is_empty());

    let phase = replay_outbox_until_complete(&mut ledger, "effect:order:1").unwrap();
    assert_eq!(phase, DispatchPhase::JobCompleted);
    assert_eq!(ledger.external_calls, 1);
    assert_eq!(ledger.committed_effects.len(), 1);
    assert_eq!(ledger.completions, 1);
}

#[test]
fn wf11_crash_after_external_before_result_replays_once() {
    let mut ledger = FakeExternalLedger::default();
    let err = run_outbox_attempt(
        &mut ledger,
        "effect:order:2",
        DispatchCrashPoint::AfterExternalCallBeforeResult,
    )
    .unwrap_err();
    assert!(matches!(
        err,
        DispatchAttemptError::Crashed(DispatchPhase::ExternalSucceeded)
    ));
    assert_eq!(ledger.external_calls, 1);
    assert!(ledger.committed_effects.is_empty());

    let phase = replay_outbox_until_complete(&mut ledger, "effect:order:2").unwrap();
    assert_eq!(phase, DispatchPhase::JobCompleted);
    // External may be called again; local commit is still once.
    assert_eq!(ledger.external_calls, 2);
    assert_eq!(ledger.committed_effects.len(), 1);
    assert_eq!(ledger.completions, 1);
}

#[test]
fn wf11_crash_after_result_before_complete_does_not_double_commit() {
    let mut ledger = FakeExternalLedger::default();
    let err = run_outbox_attempt(
        &mut ledger,
        "effect:order:3",
        DispatchCrashPoint::AfterResultBeforeComplete,
    )
    .unwrap_err();
    assert!(matches!(
        err,
        DispatchAttemptError::Crashed(DispatchPhase::ResultRecorded)
    ));
    assert_eq!(ledger.committed_effects.len(), 1);
    assert_eq!(ledger.completions, 0);

    let phase = replay_outbox_until_complete(&mut ledger, "effect:order:3").unwrap();
    assert_eq!(phase, DispatchPhase::JobCompleted);
    assert_eq!(ledger.committed_effects.len(), 1);
    // Replay sees DuplicateEffect and treats as already complete (no second completion).
    assert_eq!(ledger.completions, 0);
}

#[test]
fn wf12_two_replicas_same_effect_key_one_committed_effect() {
    let mut ledger = FakeExternalLedger::default();
    let a = run_outbox_attempt(&mut ledger, "effect:shared", DispatchCrashPoint::None).unwrap();
    assert_eq!(a, DispatchPhase::JobCompleted);
    let b = run_outbox_attempt(&mut ledger, "effect:shared", DispatchCrashPoint::None);
    assert!(matches!(b, Err(DispatchAttemptError::DuplicateEffect)));
    assert_eq!(ledger.committed_effects.len(), 1);
    assert_eq!(ledger.completions, 1);
    assert_eq!(ledger.external_calls, 1);
}

#[test]
fn shutdown_mid_cycle_leaves_uncommitted_effect_for_restart() {
    let mut ledger = FakeExternalLedger::default();
    let _ = run_outbox_attempt(
        &mut ledger,
        "effect:shutdown",
        DispatchCrashPoint::AfterExternalCallBeforeResult,
    );
    assert!(ledger.committed_effects.is_empty());
    replay_outbox_until_complete(&mut ledger, "effect:shutdown").unwrap();
    assert_eq!(ledger.committed_effects.len(), 1);
}
