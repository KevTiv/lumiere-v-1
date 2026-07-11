//! Structured harness audit trail for promoted green skills.
//!
//! Emits correlation-linked events to tracing and returns an immutable trail for
//! API responses and downstream persistence.

use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessAuditEvent {
    pub sequence: u32,
    pub phase: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessAuditTrail {
    pub correlation_id: String,
    pub events: Vec<HarnessAuditEvent>,
}

pub struct HarnessAuditLogger {
    correlation_id: String,
    events: Vec<HarnessAuditEvent>,
    next_sequence: u32,
}

impl HarnessAuditLogger {
    pub fn new(correlation_id: impl Into<String>) -> Self {
        Self {
            correlation_id: correlation_id.into(),
            events: Vec::new(),
            next_sequence: 1,
        }
    }

    pub fn correlation_id(&self) -> &str {
        &self.correlation_id
    }

    pub fn record(&mut self, phase: impl Into<String>, message: impl Into<String>) {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let phase = phase.into();
        let message = message.into();
        info!(
            target: "harness_audit",
            correlation_id = %self.correlation_id,
            sequence,
            phase = %phase,
            message = %message,
            "harness audit"
        );
        self.events.push(HarnessAuditEvent {
            sequence,
            phase,
            message,
        });
    }

    pub fn into_trail(self) -> HarnessAuditTrail {
        HarnessAuditTrail {
            correlation_id: self.correlation_id,
            events: self.events,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_trail_assigns_monotonic_sequence_numbers() {
        let mut logger = HarnessAuditLogger::new("corr-1");
        logger.record("requested", "skill run requested");
        logger.record("policy", "policy allow");
        let trail = logger.into_trail();
        assert_eq!(trail.correlation_id, "corr-1");
        assert_eq!(trail.events.len(), 2);
        assert_eq!(trail.events[0].sequence, 1);
        assert_eq!(trail.events[1].sequence, 2);
    }
}
