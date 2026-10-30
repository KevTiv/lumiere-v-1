//! An operator-approved exception for one identity, source tenant and new code.
//!
//! The approval is `identity_hex:source_organization_id:target_code`. It is
//! disabled when absent or malformed. Reducers must inspect all membership
//! history, including revoked memberships, before using the exception.

/// Exact, bounded approval. This does not grant access to an existing tenant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdditionalTenantApproval<'a> {
    identity: &'a str,
    source_organization_id: u64,
    target_code: &'a str,
}

impl<'a> AdditionalTenantApproval<'a> {
    /// Parse one approval, rejecting lists, whitespace, wildcards and zero IDs.
    #[must_use]
    pub fn parse(policy: &'a str) -> Option<Self> {
        if policy.len() > 118 {
            return None;
        }
        let mut parts = policy.split(':');
        let identity = parts.next()?;
        let source_id = parts.next()?;
        let target_code = parts.next()?;
        if parts.next().is_some()
            || identity.len() != 64
            || !identity
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || source_id.is_empty()
            || source_id.starts_with('0')
            || !source_id.bytes().all(|b| b.is_ascii_digit())
            || !(2..=32).contains(&target_code.len())
            || !target_code
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
        {
            return None;
        }
        Some(Self {
            identity,
            source_organization_id: source_id.parse().ok()?,
            target_code,
        })
    }

    /// Match an authenticated actor and its verified current organization.
    #[must_use]
    pub fn permits_request(
        &self,
        actor: &str,
        source_organization_id: u64,
        target_code: &str,
    ) -> bool {
        self.permits_source(actor, source_organization_id) && self.target_code == target_code
    }

    /// Identify the approved source session for the new-tenant currency catalog.
    #[must_use]
    pub fn permits_source(&self, actor: &str, source_organization_id: u64) -> bool {
        self.identity == actor && self.source_organization_id == source_organization_id
    }

    /// Permit exactly one active historical membership in the approved source.
    ///
    /// The caller must pass unfiltered membership history. A second row consumes
    /// the exception permanently, including when that row is later revoked.
    #[must_use]
    pub fn permits_history(
        &self,
        actor: &str,
        target_code: &str,
        mut memberships: impl Iterator<Item = (u64, bool)>,
    ) -> bool {
        let Some((source, active)) = memberships.next() else {
            return false;
        };
        active && self.permits_request(actor, source, target_code) && memberships.next().is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACTOR: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    #[test]
    fn exact_actor_source_and_code_are_required() {
        let policy = format!("{ACTOR}:1:UMUNUPFU_MUGISHA");
        let approval = AdditionalTenantApproval::parse(&policy).expect("valid policy");
        assert!(approval.permits_history(ACTOR, "UMUNUPFU_MUGISHA", [(1, true)].into_iter()));
        for (actor, source, code) in [
            ("other", 1, "UMUNUPFU_MUGISHA"),
            (ACTOR, 2, "UMUNUPFU_MUGISHA"),
            (ACTOR, 1, "OTHER"),
        ] {
            assert!(!approval.permits_history(actor, code, [(source, true)].into_iter()));
        }
    }

    #[test]
    fn replay_and_revoked_membership_do_not_restore_approval() {
        let policy = format!("{ACTOR}:1:UMUNUPFU_MUGISHA");
        let approval = AdditionalTenantApproval::parse(&policy).expect("valid policy");
        for rows in [
            vec![],
            vec![(1, false)],
            vec![(1, true), (2, true)],
            vec![(1, true), (2, false)],
        ] {
            assert!(!approval.permits_history(ACTOR, "UMUNUPFU_MUGISHA", rows.into_iter()));
        }
    }

    #[test]
    fn malformed_and_unbounded_policies_deny() {
        for value in [
            String::new(),
            format!("{ACTOR}:0:TARGET"),
            format!("{ACTOR}:01:TARGET"),
            format!("{ACTOR}:18446744073709551616:TARGET"),
            format!("{ACTOR}:+1:TARGET"),
            format!("{ACTOR}:1:*"),
            format!("{ACTOR}:1:target"),
            format!("{ACTOR}:1:TARGET "),
            format!("{ACTOR}:1:TARGET:OTHER"),
            format!("{ACTOR}:1:TARGET,{ACTOR}:1:OTHER"),
            format!("{}:1:TARGET", ACTOR.to_uppercase()),
            format!("0x{ACTOR}:1:TARGET"),
            format!("{ACTOR}:1:{}", "T".repeat(33)),
        ] {
            assert!(AdditionalTenantApproval::parse(&value).is_none(), "{value}");
        }
    }
}
