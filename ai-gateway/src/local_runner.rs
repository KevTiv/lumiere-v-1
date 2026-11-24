//! Admission and replay for a server-bound local runner attempt.
//!
//! A transport must authenticate the device and recheck current scope before
//! invoking this module. Production callers must persist each accepted event
//! and its state transition atomically before acknowledging it to the runner.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u8 = 1;
const MAX_SAFE_WIRE_INTEGER: u64 = (1 << 53) - 1;
const MAX_PAGE: usize = 128;
const MAX_EVENTS: usize = 1024;
const MAX_PERMISSIONS: usize = 32;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttemptId {
    pub run_id: String,
    pub attempt_id: String,
    pub lease_id: String,
}

/// Scope derived from authenticated device enrollment and the acting user.
#[derive(Clone, PartialEq, Eq)]
pub struct DeviceScope {
    pub organization_id: u64,
    pub company_id: u64,
    pub actor_identity: String,
    pub device_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventFrame {
    #[serde(rename = "type")]
    pub frame_type: EventFrameType,
    pub run_id: String,
    pub attempt_id: String,
    pub lease_id: String,
    pub seq: u64,
    pub event: RunnerEvent,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EventFrameType {
    Event,
}

/// Runner output is a candidate or operational telemetry. The verified browser
/// completion is intentionally absent from this wire type.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RunnerEvent {
    Activity {
        message: String,
    },
    Tool {
        tool_id: String,
        name: String,
        status: String,
    },
    Permission {
        permission_id: String,
        label: String,
    },
    PermissionResolved {
        permission_id: String,
    },
    Usage {
        scope: String,
        metric: String,
        value: f64,
        #[serde(
            default,
            deserialize_with = "optional_bool",
            skip_serializing_if = "Option::is_none"
        )]
        estimated: Option<bool>,
    },
    Session {
        native_session_id: String,
    },
    Candidate {
        text: String,
    },
    Cancelled,
    Failed {
        code: String,
        message: String,
    },
}

fn optional_bool<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<bool>, D::Error> {
    bool::deserialize(deserializer).map(Some)
}

impl RunnerEvent {
    fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Candidate { .. } | Self::Cancelled | Self::Failed { .. }
        )
    }

    fn is_valid(&self) -> bool {
        match self {
            Self::Activity { message } => bounded_text(message, 512),
            Self::Tool {
                tool_id,
                name,
                status,
            } => {
                bounded_text(tool_id, 256)
                    && bounded_text(name, 128)
                    && matches!(status.as_str(), "running" | "completed" | "failed")
            }
            Self::Permission {
                permission_id,
                label,
            } => valid_id(permission_id) && bounded_text(label, 512),
            Self::PermissionResolved { permission_id } => valid_id(permission_id),
            Self::Usage {
                scope,
                metric,
                value,
                ..
            } => valid_usage(scope, metric, *value),
            Self::Session { native_session_id } => bounded_text(native_session_id, 512),
            Self::Candidate { text } => bounded_text(text, 32768),
            Self::Cancelled => true,
            Self::Failed { code, message } => valid_id(code) && bounded_text(message, 512),
        }
    }
}

fn bounded_text(value: &str, max_units: usize) -> bool {
    let trimmed = value.trim_matches(|c: char| match c {
        '\u{85}' => false,
        '\u{feff}' => true,
        _ => c.is_whitespace(),
    });
    !trimmed.is_empty() && value.encode_utf16().count() <= max_units
}

fn valid_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    (1..=128).contains(&value.len())
        && bytes
            .next()
            .is_some_and(|value| value.is_ascii_alphanumeric())
        && bytes.all(|value| value.is_ascii_alphanumeric() || b"_.:-".contains(&value))
}

fn valid_usage(scope: &str, metric: &str, value: f64) -> bool {
    if !value.is_finite() || value < 0.0 {
        return false;
    }
    let tokens = value.fract() == 0.0 && value <= MAX_SAFE_WIRE_INTEGER as f64;
    match (scope, metric) {
        ("turn" | "session", "input_tokens" | "output_tokens" | "total_tokens")
        | ("context", "context_tokens") => tokens,
        ("turn" | "session", "cost_usd") => true,
        ("account", "limit_percent") => value <= 100.0,
        _ => false,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttemptState {
    PendingDispatch,
    Running,
    WaitingPermission,
    Cancelling,
    Verifying,
    Completed,
    Withheld,
    Cancelled,
    Failed,
    OutcomeUnknown,
}

impl AttemptState {
    fn accepts_runner_events(self) -> bool {
        matches!(
            self,
            Self::PendingDispatch | Self::Running | Self::WaitingPermission | Self::Cancelling
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Approve,
    Deny,
}

#[derive(Clone, Copy)]
enum PermissionState {
    Pending,
    Answered(Decision),
    Resolved(Option<Decision>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Apply {
    Applied,
    Replayed,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum AdmissionError {
    #[error("attempt scope does not match")]
    Scope,
    #[error("attempt lease does not match or has expired")]
    Lease,
    #[error("runner event sequence is not contiguous")]
    Sequence,
    #[error("runner replay differs from the accepted event")]
    ReplayConflict,
    #[error("runner event is invalid")]
    InvalidEvent,
    #[error("attempt reached its event or permission capacity")]
    Capacity,
    #[error("attempt no longer accepts this command")]
    State,
    #[error("attempt permission is unknown or conflicts with an existing decision")]
    Permission,
}

/// An in-memory attempt aggregate. Register attempts and persist transitions
/// in the same transaction before enabling this on a network transport.
pub struct Attempt {
    id: AttemptId,
    owner: DeviceScope,
    lease_expires_at_ms: u64,
    state: AttemptState,
    events: Vec<RunnerEvent>,
    permissions: BTreeMap<String, PermissionState>,
}

impl Attempt {
    pub fn new(id: AttemptId, owner: DeviceScope, lease_expires_at_ms: u64) -> Self {
        Self {
            id,
            owner,
            lease_expires_at_ms,
            state: AttemptState::PendingDispatch,
            events: Vec::new(),
            permissions: BTreeMap::new(),
        }
    }

    pub fn state(&self) -> AttemptState {
        self.state
    }

    pub fn accepts_scope(&self, scope: &DeviceScope) -> bool {
        self.owner == *scope
    }

    pub fn ingest(
        &mut self,
        scope: &DeviceScope,
        now_ms: u64,
        frame: EventFrame,
    ) -> Result<Apply, AdmissionError> {
        if !self.accepts_scope(scope) {
            return Err(AdmissionError::Scope);
        }
        if frame.run_id != self.id.run_id
            || frame.attempt_id != self.id.attempt_id
            || frame.lease_id != self.id.lease_id
            || now_ms >= self.lease_expires_at_ms
        {
            return Err(AdmissionError::Lease);
        }
        if !(1..=MAX_SAFE_WIRE_INTEGER).contains(&frame.seq) {
            return Err(AdmissionError::Sequence);
        }
        let index = usize::try_from(frame.seq - 1).map_err(|_| AdmissionError::Sequence)?;
        if let Some(previous) = self.events.get(index) {
            return if *previous == frame.event {
                Ok(Apply::Replayed)
            } else {
                Err(AdmissionError::ReplayConflict)
            };
        }
        if index != self.events.len() {
            return Err(AdmissionError::Sequence);
        }
        if !self.state.accepts_runner_events() {
            return Err(AdmissionError::State);
        }
        if !frame.event.is_valid() {
            return Err(AdmissionError::InvalidEvent);
        }
        // Reserve a slot for completion or cancellation at the telemetry limit.
        let limit = if frame.event.is_terminal() {
            MAX_EVENTS
        } else {
            MAX_EVENTS - 1
        };
        if index >= limit {
            return Err(AdmissionError::Capacity);
        }

        self.apply_event(&frame.event)?;
        self.events.push(frame.event);
        Ok(Apply::Applied)
    }

    /// Internal recovery only. Browser streams require a separate projection.
    pub fn events_after(
        &self,
        scope: &DeviceScope,
        cursor: u64,
        limit: usize,
    ) -> Result<&[RunnerEvent], AdmissionError> {
        if !self.accepts_scope(scope) {
            return Err(AdmissionError::Scope);
        }
        let start = usize::try_from(cursor).map_err(|_| AdmissionError::Sequence)?;
        if start > self.events.len() {
            return Err(AdmissionError::Sequence);
        }
        let end = start
            .saturating_add(limit.min(MAX_PAGE))
            .min(self.events.len());
        Ok(&self.events[start..end])
    }

    pub fn answer_permission(
        &mut self,
        permission_id: &str,
        decision: Decision,
    ) -> Result<Apply, AdmissionError> {
        let answer = self
            .permissions
            .get_mut(permission_id)
            .ok_or(AdmissionError::Permission)?;
        match *answer {
            PermissionState::Answered(existing) | PermissionState::Resolved(Some(existing))
                if existing == decision =>
            {
                return Ok(Apply::Replayed);
            }
            PermissionState::Answered(_) | PermissionState::Resolved(_) => {
                return Err(AdmissionError::Permission);
            }
            PermissionState::Pending => {}
        }
        if self.state != AttemptState::WaitingPermission {
            return Err(AdmissionError::State);
        }
        *answer = PermissionState::Answered(decision);
        Ok(Apply::Applied)
    }

    pub fn request_cancel(&mut self) -> Result<Apply, AdmissionError> {
        if self.state == AttemptState::Cancelling {
            return Ok(Apply::Replayed);
        }
        if !self.state.accepts_runner_events() {
            return Err(AdmissionError::State);
        }
        self.state = AttemptState::Cancelling;
        Ok(Apply::Applied)
    }

    pub fn mark_outcome_unknown(&mut self) -> Result<(), AdmissionError> {
        if !self.state.accepts_runner_events() {
            return Err(AdmissionError::State);
        }
        self.state = AttemptState::OutcomeUnknown;
        Ok(())
    }

    /// Called only after the server's evidence gate has made an admission decision.
    pub fn finish_verification(&mut self, admitted: bool) -> Result<(), AdmissionError> {
        if self.state != AttemptState::Verifying {
            return Err(AdmissionError::State);
        }
        self.state = if admitted {
            AttemptState::Completed
        } else {
            AttemptState::Withheld
        };
        Ok(())
    }

    fn has_pending_permission(&self) -> bool {
        self.permissions
            .values()
            .any(|value| !matches!(value, PermissionState::Resolved(_)))
    }

    fn apply_event(&mut self, event: &RunnerEvent) -> Result<(), AdmissionError> {
        let cancelling = self.state == AttemptState::Cancelling;
        self.state = match event {
            RunnerEvent::Candidate { .. } if self.has_pending_permission() => {
                return Err(AdmissionError::InvalidEvent);
            }
            RunnerEvent::Candidate { .. } => AttemptState::Verifying,
            RunnerEvent::Cancelled => AttemptState::Cancelled,
            RunnerEvent::Failed { code, .. } if code == "outcome_unknown" => {
                AttemptState::OutcomeUnknown
            }
            RunnerEvent::Failed { .. } => AttemptState::Failed,
            RunnerEvent::Permission { .. } if cancelling => return Err(AdmissionError::State),
            RunnerEvent::Permission { permission_id, .. } => {
                if self.permissions.contains_key(permission_id) {
                    return Err(AdmissionError::Permission);
                }
                if self.permissions.len() >= MAX_PERMISSIONS {
                    return Err(AdmissionError::Capacity);
                }
                self.permissions
                    .insert(permission_id.clone(), PermissionState::Pending);
                AttemptState::WaitingPermission
            }
            RunnerEvent::PermissionResolved { permission_id } => {
                let permission = self
                    .permissions
                    .get_mut(permission_id)
                    .ok_or(AdmissionError::Permission)?;
                let decision = match *permission {
                    PermissionState::Pending => None,
                    PermissionState::Answered(decision) => Some(decision),
                    PermissionState::Resolved(_) => return Err(AdmissionError::Permission),
                };
                *permission = PermissionState::Resolved(decision);
                if cancelling || self.has_pending_permission() {
                    self.state
                } else {
                    AttemptState::Running
                }
            }
            _ if self.state == AttemptState::PendingDispatch => AttemptState::Running,
            _ => self.state,
        };
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> DeviceScope {
        DeviceScope {
            organization_id: 10,
            company_id: 4097,
            actor_identity: "actor".into(),
            device_id: "device".into(),
        }
    }

    fn attempt() -> Attempt {
        Attempt::new(
            AttemptId {
                run_id: "9007199254740993".into(),
                attempt_id: "attempt".into(),
                lease_id: "lease".into(),
            },
            scope(),
            100,
        )
    }

    fn frame(seq: u64, event: RunnerEvent) -> EventFrame {
        EventFrame {
            frame_type: EventFrameType::Event,
            run_id: "9007199254740993".into(),
            attempt_id: "attempt".into(),
            lease_id: "lease".into(),
            seq,
            event,
        }
    }

    fn activity(seq: u64, message: &str) -> EventFrame {
        frame(
            seq,
            RunnerEvent::Activity {
                message: message.into(),
            },
        )
    }

    #[test]
    fn accepts_contiguous_events_and_replays_only_exact_duplicates() {
        let mut attempt = attempt();
        let scope = scope();
        assert_eq!(
            attempt.ingest(&scope, 1, activity(2, "early")),
            Err(AdmissionError::Sequence)
        );
        assert_eq!(
            attempt.ingest(&scope, 1, activity(1, "reading")),
            Ok(Apply::Applied)
        );
        assert_eq!(
            attempt.ingest(&scope, 1, activity(1, "reading")),
            Ok(Apply::Replayed)
        );
        assert_eq!(
            attempt.ingest(&scope, 1, activity(1, "different")),
            Err(AdmissionError::ReplayConflict)
        );
        assert_eq!(
            attempt.ingest(&scope, 1, activity(2, "done")),
            Ok(Apply::Applied)
        );
        assert_eq!(
            attempt.events_after(&scope, 1, 10).unwrap(),
            &[activity(2, "done").event]
        );
    }

    #[test]
    fn denies_other_company_and_expired_or_stale_leases() {
        let mut attempt = attempt();
        let other_scope = DeviceScope {
            company_id: 4098,
            ..scope()
        };
        let mut stale = activity(1, "reading");
        stale.lease_id = "old_lease".into();
        assert_eq!(
            attempt.ingest(&other_scope, 1, activity(1, "reading")),
            Err(AdmissionError::Scope)
        );
        assert_eq!(
            attempt.events_after(&other_scope, 0, 10),
            Err(AdmissionError::Scope)
        );
        assert_eq!(
            attempt.ingest(&scope(), 1, stale),
            Err(AdmissionError::Lease)
        );
        assert_eq!(
            attempt.ingest(&scope(), 100, activity(1, "reading")),
            Err(AdmissionError::Lease)
        );
        assert_eq!(attempt.state(), AttemptState::PendingDispatch);
    }

    #[test]
    fn runner_candidate_only_enters_verification() {
        let mut attempt = attempt();
        let candidate = frame(
            1,
            RunnerEvent::Candidate {
                text: "unverified".into(),
            },
        );
        assert_eq!(
            attempt.ingest(&scope(), 1, candidate.clone()),
            Ok(Apply::Applied)
        );
        assert_eq!(attempt.state(), AttemptState::Verifying);
        assert_eq!(
            attempt.ingest(&scope(), 1, activity(2, "too late")),
            Err(AdmissionError::State)
        );
        attempt.finish_verification(false).unwrap();
        assert_eq!(attempt.state(), AttemptState::Withheld);
        assert_eq!(attempt.ingest(&scope(), 1, candidate), Ok(Apply::Replayed));
        let forged = serde_json::json!({
            "type": "event", "runId": "1", "attemptId": "a", "leaseId": "l",
            "seq": 1, "event": {"type": "verifiedAnswer", "text": "forged"}
        });
        assert!(serde_json::from_value::<EventFrame>(forged).is_err());
    }

    #[test]
    fn permission_retries_are_idempotent_and_cancellation_requires_acknowledgement() {
        let mut attempt = attempt();
        let permission = frame(
            1,
            RunnerEvent::Permission {
                permission_id: "permission".into(),
                label: "read".into(),
            },
        );
        assert_eq!(attempt.ingest(&scope(), 1, permission), Ok(Apply::Applied));
        assert_eq!(attempt.state(), AttemptState::WaitingPermission);
        assert_eq!(
            attempt.answer_permission("permission", Decision::Deny),
            Ok(Apply::Applied)
        );
        assert_eq!(
            attempt.answer_permission("permission", Decision::Deny),
            Ok(Apply::Replayed)
        );
        assert_eq!(
            attempt.answer_permission("permission", Decision::Approve),
            Err(AdmissionError::Permission)
        );
        assert_eq!(attempt.state(), AttemptState::WaitingPermission);
        let resolved = frame(
            2,
            RunnerEvent::PermissionResolved {
                permission_id: "permission".into(),
            },
        );
        assert_eq!(attempt.ingest(&scope(), 2, resolved), Ok(Apply::Applied));
        assert_eq!(attempt.state(), AttemptState::Running);
        assert_eq!(attempt.request_cancel(), Ok(Apply::Applied));
        assert_eq!(attempt.state(), AttemptState::Cancelling);
        assert_eq!(attempt.request_cancel(), Ok(Apply::Replayed));
        assert_eq!(
            attempt.ingest(&scope(), 2, frame(3, RunnerEvent::Cancelled)),
            Ok(Apply::Applied)
        );
        assert_eq!(attempt.state(), AttemptState::Cancelled);
    }

    #[test]
    fn unknown_outcome_cannot_be_replaced_by_late_runner_output() {
        let mut attempt = attempt();
        attempt.mark_outcome_unknown().unwrap();
        assert_eq!(
            attempt.ingest(&scope(), 1, activity(1, "late")),
            Err(AdmissionError::State)
        );
        assert_eq!(
            attempt.finish_verification(true),
            Err(AdmissionError::State)
        );
    }

    #[test]
    fn host_unknown_outcome_is_distinct_from_known_failure() {
        let mut attempt = attempt();
        let failed = frame(
            1,
            RunnerEvent::Failed {
                code: "outcome_unknown".into(),
                message: "could not verify the native session outcome".into(),
            },
        );
        assert_eq!(attempt.ingest(&scope(), 1, failed), Ok(Apply::Applied));
        assert_eq!(attempt.state(), AttemptState::OutcomeUnknown);
    }

    #[test]
    fn cancellation_does_not_bypass_an_unresolved_permission() {
        let mut attempt = attempt();
        let scope = scope();
        let permission = frame(
            1,
            RunnerEvent::Permission {
                permission_id: "permission".into(),
                label: "read".into(),
            },
        );
        attempt.ingest(&scope, 1, permission).unwrap();
        attempt.request_cancel().unwrap();
        let candidate = frame(
            2,
            RunnerEvent::Candidate {
                text: "still requires permission".into(),
            },
        );
        assert_eq!(
            attempt.ingest(&scope, 2, candidate),
            Err(AdmissionError::InvalidEvent)
        );
        assert_eq!(
            attempt.ingest(&scope, 2, frame(2, RunnerEvent::Cancelled)),
            Ok(Apply::Applied)
        );
    }

    #[test]
    fn bounded_events_reserve_room_for_a_terminal_frame() {
        let mut attempt = attempt();
        let scope = scope();
        for seq in 1..MAX_EVENTS as u64 {
            attempt.ingest(&scope, 1, activity(seq, "working")).unwrap();
        }
        let last = MAX_EVENTS as u64;
        assert_eq!(
            attempt.ingest(&scope, 1, activity(last, "more")),
            Err(AdmissionError::Capacity)
        );
        assert_eq!(
            attempt.ingest(&scope, 1, frame(last, RunnerEvent::Cancelled)),
            Ok(Apply::Applied)
        );
    }

    #[test]
    fn permission_history_is_bounded_without_consuming_the_rejected_sequence() {
        let mut attempt = attempt();
        let scope = scope();
        let permission = |seq| {
            frame(
                seq,
                RunnerEvent::Permission {
                    permission_id: format!("permission-{seq}"),
                    label: "read".into(),
                },
            )
        };
        for seq in 1..=MAX_PERMISSIONS as u64 {
            attempt.ingest(&scope, 1, permission(seq)).unwrap();
        }
        let overflow = MAX_PERMISSIONS as u64 + 1;
        assert_eq!(
            attempt.ingest(&scope, 1, permission(overflow)),
            Err(AdmissionError::Capacity)
        );
        assert_eq!(
            attempt.ingest(&scope, 1, frame(overflow, RunnerEvent::Cancelled)),
            Ok(Apply::Applied)
        );
    }

    #[test]
    fn rust_accepts_the_shared_wire_fixture_without_numeric_id_loss() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../local-runner/protocol/fixture-v1.json"))
                .unwrap();
        let candidate: EventFrame = serde_json::from_value(fixture["candidate"].clone()).unwrap();
        assert_eq!(candidate.run_id, "9007199254740993");
        assert_eq!(candidate.seq, 2);
        assert!(candidate.event.is_valid());
        assert_eq!(
            serde_json::to_value(candidate).unwrap(),
            fixture["candidate"]
        );
    }
}
