//! In-memory sliding-window rate limiting keyed by organization + agent.

use std::time::{Duration, Instant};

use dashmap::DashMap;

const WINDOW: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
pub struct AgentRateLimiter {
    windows: DashMap<String, Vec<Instant>>,
}

impl AgentRateLimiter {
    pub fn new() -> Self {
        Self {
            windows: DashMap::new(),
        }
    }

    /// Composite key: `org:{org_id}:agent:{agent_id}`.
    pub fn key(org_id: u64, agent_id: u64) -> String {
        format!("org:{org_id}:agent:{agent_id}")
    }

    /// Returns `true` when the request is allowed and records it in the window.
    /// A limit of `0` disables rate limiting (unlimited).
    pub fn check_and_acquire(&self, org_id: u64, agent_id: u64, limit_per_minute: u32) -> bool {
        if limit_per_minute == 0 {
            return true;
        }

        let key = Self::key(org_id, agent_id);
        let now = Instant::now();
        let cutoff = now.checked_sub(WINDOW).unwrap_or(now);

        let mut entry = self.windows.entry(key).or_default();
        entry.retain(|timestamp| *timestamp > cutoff);

        if entry.len() >= limit_per_minute as usize {
            return false;
        }

        entry.push(now);
        true
    }
}

impl Default for AgentRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_includes_org_and_agent() {
        assert_eq!(AgentRateLimiter::key(42, 7), "org:42:agent:7");
    }

    #[test]
    fn zero_limit_means_unlimited() {
        let limiter = AgentRateLimiter::new();
        for _ in 0..100 {
            assert!(limiter.check_and_acquire(1, 2, 0));
        }
    }

    #[test]
    fn enforces_limit_within_window() {
        let limiter = AgentRateLimiter::new();
        assert!(limiter.check_and_acquire(1, 1, 2));
        assert!(limiter.check_and_acquire(1, 1, 2));
        assert!(!limiter.check_and_acquire(1, 1, 2));
    }

    #[test]
    fn limits_are_scoped_per_org_and_agent() {
        let limiter = AgentRateLimiter::new();
        assert!(limiter.check_and_acquire(1, 1, 1));
        assert!(limiter.check_and_acquire(2, 1, 1));
        assert!(limiter.check_and_acquire(1, 2, 1));
        assert!(!limiter.check_and_acquire(1, 1, 1));
    }
}
