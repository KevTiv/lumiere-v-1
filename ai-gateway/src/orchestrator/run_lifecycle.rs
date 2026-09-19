//! Typed AIH-20/24 run-lifecycle commands.
//!
//! These contracts make optimistic concurrency and immutable parent lineage
//! explicit before interrupt/resume/fork/compare receive public routes. The
//! governed runtime currently executes `Resume`; the remaining commands are
//! intentionally authority-free request shapes, not an implicit mutation API.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuationToken {
    #[serde(alias = "run_id")]
    pub run_id: u64,
    #[serde(alias = "checkpoint_hash")]
    pub checkpoint_hash: String,
    pub cursor: u32,
    #[serde(alias = "concurrency_version")]
    pub concurrency_version: u64,
}

impl ContinuationToken {
    pub fn validate(&self) -> Result<()> {
        if self.run_id == 0 || self.concurrency_version == 0 {
            bail!("continuation token requires a run and concurrency version");
        }
        if self.checkpoint_hash.len() != 64
            || !self
                .checkpoint_hash
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            bail!("continuation checkpoint hash must be a SHA-256 hex digest");
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RunLifecycleCommand {
    Interrupt {
        continuation: ContinuationToken,
        reason: String,
    },
    Resume {
        continuation: ContinuationToken,
    },
    Fork {
        parent: ContinuationToken,
        fork_key: String,
    },
    Compare {
        left: ContinuationToken,
        right: ContinuationToken,
    },
}

impl RunLifecycleCommand {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Interrupt {
                continuation,
                reason,
            } => {
                continuation.validate()?;
                if reason.trim().is_empty() {
                    bail!("interrupt reason is required");
                }
            }
            Self::Resume { continuation } => continuation.validate()?,
            Self::Fork { parent, fork_key } => {
                parent.validate()?;
                if fork_key.trim().is_empty() {
                    bail!("fork key is required");
                }
            }
            Self::Compare { left, right } => {
                left.validate()?;
                right.validate()?;
                if left == right {
                    bail!("compare requires two distinct continuations");
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(run_id: u64, version: u64) -> ContinuationToken {
        ContinuationToken {
            run_id,
            checkpoint_hash: "a".repeat(64),
            cursor: 4,
            concurrency_version: version,
        }
    }

    #[test]
    fn lifecycle_commands_require_checked_lineage() {
        assert!(RunLifecycleCommand::Resume {
            continuation: token(8, 2),
        }
        .validate()
        .is_ok());
        assert!(RunLifecycleCommand::Fork {
            parent: token(8, 2),
            fork_key: "scenario-b".to_string(),
        }
        .validate()
        .is_ok());

        let mut forged = token(8, 2);
        forged.checkpoint_hash = "not-a-hash".to_string();
        assert!(RunLifecycleCommand::Resume {
            continuation: forged,
        }
        .validate()
        .is_err());
    }

    #[test]
    fn compare_rejects_the_same_checkpoint() {
        let continuation = token(8, 2);
        assert!(RunLifecycleCommand::Compare {
            left: continuation.clone(),
            right: continuation,
        }
        .validate()
        .is_err());
    }
}
