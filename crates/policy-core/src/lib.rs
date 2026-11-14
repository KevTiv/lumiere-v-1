//! Provider-independent permission evaluation shared by API reads and reducers.

pub mod additional_tenant;
pub mod ai_skills;
pub mod expense_allocations;
pub mod skill_projection;

/// Reserved non-interactive operator namespace, including future versions.
pub const PERSISTENT_PLATFORM_OPERATOR_METADATA_PREFIX: &str = "persistent_platform_operator_";
/// Stable server-owned marker for explicit, non-lease operator enrollment.
pub const PERSISTENT_PLATFORM_OPERATOR_METADATA_KEY: &str = "persistent_platform_operator_v1";

/// One explicitly approved non-human principal and its exact tenant binding.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PersistentPlatformOperatorPolicy {
    pub identity_hex: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub approval_ref: String,
}

impl PersistentPlatformOperatorPolicy {
    /// Parse `64hex:positiveOrg:positiveCompany:approvalRef`.
    /// Approval references are 1–128 ASCII alphanumeric, `.`, `_`, or `-`.
    pub fn parse(raw: &str) -> Result<Self, String> {
        if raw.len() > 235 {
            return Err("invalid persistent platform operator policy".into());
        }
        let parts: Vec<_> = raw.split(':').collect();
        if parts.len() != 4
            || parts[0].len() != 64
            || !parts[0].bytes().all(|b| b.is_ascii_hexdigit())
            || parts[0].bytes().all(|b| b == b'0')
            || parts[3].is_empty()
            || parts[3].len() > 128
            || !parts[3]
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        {
            return Err("invalid persistent platform operator policy".into());
        }
        let positive = |value: &str| -> Result<u64, String> {
            if value.is_empty()
                || value.starts_with('0')
                || !value.bytes().all(|b| b.is_ascii_digit())
            {
                return Err("invalid operator scope".into());
            }
            value
                .parse::<u64>()
                .ok()
                .filter(|id| *id > 0)
                .ok_or_else(|| "invalid operator scope".into())
        };
        Ok(Self {
            identity_hex: parts[0].to_ascii_lowercase(),
            organization_id: positive(parts[1])?,
            company_id: positive(parts[2])?,
            approval_ref: parts[3].into(),
        })
    }

    /// Exact identity and scope match; no wildcard or fallback authority.
    pub fn matches(&self, identity_hex: &str, organization_id: u64, company_id: u64) -> bool {
        self.identity_hex.eq_ignore_ascii_case(identity_hex)
            && self.organization_id == organization_id
            && self.company_id == company_id
    }
}

/// Validate original bootstrap provenance for explicit enrollment, allowing expiry.
/// This does not authorize ordinary lease access.
pub fn persistent_operator_source_lease_valid(raw: &str, now_micros: i64) -> bool {
    let mut parts = raw.split(':');
    if parts.next() != Some("lumiere-platform-bootstrap-v1") {
        return false;
    }
    let issued = parts.next().and_then(|v| v.parse::<i64>().ok());
    let expires = parts.next().and_then(|v| v.parse::<i64>().ok());
    matches!((issued, expires, parts.next()), (Some(i), Some(e), None)
        if i >= 0 && i <= now_micros && e > i && e.saturating_sub(i) <= 3_600_000_000)
}

/// An already scoped policy grant for the authenticated user or an effective role.
pub struct Grant<'a> {
    pub resource: &'a str,
    pub action: &'a str,
    pub allow: bool,
}

/// Canonical action names at the authorization boundary.
pub fn action(value: &str) -> &str {
    match value {
        "view" => "read",
        "update" => "write",
        "manage" | "all" => "*",
        other => other,
    }
}

/// Match canonical resources, allowing only the established separator alias.
pub fn resource_matches(configured: &str, requested: &str) -> bool {
    configured == "*" || configured.replace('-', "_") == requested.replace('-', "_")
}

/// Domain operation capabilities retain their own resource while sharing module policy.
/// In particular, account_payment CRUD never implies payment posting or reversal.
pub fn operation_resource_module(resource: &str) -> Option<&'static str> {
    match resource {
        "payment" => Some("accounting"),
        _ => None,
    }
}

/// Superuser is explicit; otherwise any matching deny overrides every allow.
pub fn allows(
    superuser: bool,
    permissions: &[String],
    grants: &[Grant<'_>],
    resource: &str,
    requested_action: &str,
) -> bool {
    allows_in_module(
        superuser,
        permissions,
        grants,
        resource,
        requested_action,
        None,
    )
}

/// Apply the same policy to a canonical resource and its declared module.
pub fn allows_in_module(
    superuser: bool,
    permissions: &[String],
    grants: &[Grant<'_>],
    resource: &str,
    requested_action: &str,
    module: Option<&str>,
) -> bool {
    if superuser {
        return true;
    }
    let matches = |configured_resource: &str, configured_action: &str| {
        (resource_matches(configured_resource, resource)
            || module.is_some_and(|module| configured_resource == format!("module:{module}")))
            && (action(configured_action) == "*"
                || action(configured_action) == action(requested_action))
    };
    if grants
        .iter()
        .any(|g| !g.allow && matches(g.resource, g.action))
    {
        return false;
    }
    grants
        .iter()
        .any(|g| g.allow && matches(g.resource, g.action))
        || permissions
            .iter()
            .any(|p| p.rsplit_once(':').is_some_and(|(r, a)| matches(r, a)))
}

/// Check an operator bootstrap lease stored in server-owned profile metadata.
/// Ordinary metadata has no lease. Reserved lease metadata must be well formed,
/// start no later than `now_micros`, and expire within one hour of issue.
/// PostgreSQL JSON string literals and SpacetimeDB strings use the same format.
pub fn platform_bootstrap_lease_active(metadata: Option<&str>, now_micros: i64) -> bool {
    const PREFIX: &str = "lumiere-platform-bootstrap-v1";
    let Some(raw) = metadata else {
        return true;
    };
    let raw = raw.trim();
    let raw = raw
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(raw)
        .trim();
    if !raw.starts_with("lumiere-platform-bootstrap-") {
        return true;
    }
    let Some(lease) = raw
        .strip_prefix(PREFIX)
        .and_then(|value| value.strip_prefix(':'))
    else {
        return false;
    };
    let Some((issued, expires)) = lease.split_once(':') else {
        return false;
    };
    let (Ok(issued), Ok(expires)) = (issued.parse::<i64>(), expires.parse::<i64>()) else {
        return false;
    };
    issued >= 0
        && expires > issued
        && expires.saturating_sub(issued) <= 3_600_000_000
        && now_micros >= issued
        && now_micros < expires
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persistent_operator_policy_is_exact_and_default_denied() {
        let identity = "ab".repeat(32);
        let valid = format!("{identity}:12:34:approval-2026_01");
        let policy = PersistentPlatformOperatorPolicy::parse(&valid).unwrap();
        assert!(policy.matches(&identity, 12, 34));
        assert!(!policy.matches(&identity, 13, 34));
        assert!(!policy.matches(&identity, 12, 35));
        assert!(!policy.matches(&"cd".repeat(32), 12, 34));
        for invalid in [
            String::new(),
            "*:12:34:approval".into(),
            format!("{}:12:34:approval", "0".repeat(64)),
            format!("{identity}:0:34:approval"),
            format!("{identity}:12:0:approval"),
            format!("{identity}:+12:34:approval"),
            format!("{identity}:18446744073709551616:34:approval"),
            format!("{identity}:12:34:"),
            format!("{identity}:12:34:approval:true"),
            format!("{identity}:12:34:approval,other"),
            format!("{identity}:12:34: approval"),
            format!("{identity}:12:34:{}", "a".repeat(129)),
        ] {
            assert!(
                PersistentPlatformOperatorPolicy::parse(&invalid).is_err(),
                "{invalid}"
            );
        }
    }

    #[test]
    fn expired_source_is_provenance_only_not_effective_authority() {
        let raw = "lumiere-platform-bootstrap-v1:1:2";
        assert!(persistent_operator_source_lease_valid(raw, 3));
        assert!(!platform_bootstrap_lease_active(Some(raw), 3));
        for invalid in [
            "lumiere-platform-bootstrap-v2:1:2",
            "lumiere-platform-bootstrap-v1:-1:2",
            "lumiere-platform-bootstrap-v1:1:3600000002",
            "lumiere-platform-bootstrap-v1:4:5",
            "lumiere-platform-bootstrap-v1:1:2:3",
        ] {
            assert!(!persistent_operator_source_lease_valid(invalid, 3));
        }
    }

    #[test]
    fn bootstrap_authority_expires_without_a_cleanup_write() {
        let lease = "lumiere-platform-bootstrap-v1:100:3600000100";
        assert!(platform_bootstrap_lease_active(Some(lease), 100));
        assert!(platform_bootstrap_lease_active(Some(lease), 3600000099));
        assert!(!platform_bootstrap_lease_active(Some(lease), 99));
        assert!(!platform_bootstrap_lease_active(Some(lease), 3600000100));
        assert!(!platform_bootstrap_lease_active(Some(lease), i64::MAX));
        assert!(platform_bootstrap_lease_active(
            Some(&format!("\"{lease}\"")),
            100
        ));
        let spaced_json = format!("\"  {lease}  \"");
        assert!(platform_bootstrap_lease_active(Some(&spaced_json), 100));
        assert!(!platform_bootstrap_lease_active(
            Some(&spaced_json),
            3600000100
        ));
    }

    #[test]
    fn malformed_or_overlong_bootstrap_leases_never_authorize() {
        for lease in [
            "lumiere-platform-bootstrap-v1",
            "lumiere-platform-bootstrap-v2:1:2",
            "lumiere-platform-bootstrap-v1:bad:2",
            "lumiere-platform-bootstrap-v1:1:1",
            "lumiere-platform-bootstrap-v1:-1:2",
            "lumiere-platform-bootstrap-v1:1:3600000002",
            "lumiere-platform-bootstrap-v1:1:9999999999999999999999999",
        ] {
            assert!(!platform_bootstrap_lease_active(Some(lease), 1), "{lease}");
        }
        assert!(platform_bootstrap_lease_active(None, 1));
        assert!(platform_bootstrap_lease_active(Some("{\"seed\":true}"), 1));
    }

    #[test]
    fn payment_operations_keep_explicit_capabilities_under_accounting_module_denies() {
        let module = operation_resource_module("payment");
        for action in ["post", "cancel", "reverse"] {
            assert!(!allows_in_module(
                false,
                &["account_payment:*".into()],
                &[],
                "payment",
                action,
                module
            ));
            assert!(!allows_in_module(
                false,
                &["payment:write".into()],
                &[],
                "payment",
                action,
                module
            ));
            let permissions = vec![format!("payment:{action}")];
            assert!(allows_in_module(
                false,
                &permissions,
                &[],
                "payment",
                action,
                module
            ));
            let deny = [Grant {
                resource: "module:accounting",
                action: "all",
                allow: false,
            }];
            assert!(!allows_in_module(
                false,
                &permissions,
                &deny,
                "payment",
                action,
                module
            ));
            assert!(allows_in_module(
                false,
                &["module:accounting:*".into()],
                &[],
                "payment",
                action,
                module
            ));
        }
    }

    #[test]
    fn configured_duties_detect_module_and_canonical_wildcards_and_respect_denies() {
        for permission in ["module:accounting:*", "account_move:*"] {
            let permissions = vec![permission.into()];
            let holds = |action, grants: &[Grant<'_>]| {
                allows_in_module(
                    false,
                    &permissions,
                    grants,
                    "account_move",
                    action,
                    Some("accounting"),
                )
            };
            assert!(holds("create", &[]) && holds("write", &[]));
            let deny = [Grant {
                resource: "account_move",
                action: "update",
                allow: false,
            }];
            assert!(holds("create", &deny));
            assert!(!holds("write", &deny));
        }
    }

    #[test]
    fn denies_override_wildcards_and_actions_are_canonical() {
        let permissions = vec!["*:*".into()];
        let deny = [Grant {
            resource: "sale_order",
            action: "write",
            allow: false,
        }];
        assert!(!allows(false, &permissions, &deny, "sale-order", "update"));
        assert!(allows(false, &permissions, &deny, "sale_order", "read"));
        assert!(allows(true, &permissions, &deny, "sale_order", "update"));
        assert!(!allows(false, &[], &[], "sale_order", "read"));
    }

    #[test]
    fn upsert_never_implies_create_or_update_authority() {
        let permissions = vec!["sale_order:read".into(), "sale_order:write".into()];
        assert!(allows(false, &permissions, &[], "sale_order", "update"));
        assert!(!allows(false, &permissions, &[], "sale_order", "create"));
        assert!(!allows(false, &permissions, &[], "sale_order", "upsert"));
    }
    #[test]
    fn module_grants_use_declared_ownership_and_resource_denies_win() {
        let permissions = vec!["module:crm:read".into()];
        assert!(allows_in_module(
            false,
            &permissions,
            &[],
            "contact",
            "view",
            Some("crm")
        ));
        assert!(!allows_in_module(
            false,
            &permissions,
            &[],
            "contact",
            "read",
            Some("hr")
        ));
        let deny = [Grant {
            resource: "contact",
            action: "read",
            allow: false,
        }];
        assert!(!allows_in_module(
            false,
            &permissions,
            &deny,
            "contact",
            "read",
            Some("crm")
        ));
        let deny = [Grant {
            resource: "module:crm",
            action: "all",
            allow: false,
        }];
        assert!(!allows_in_module(
            false,
            &["*:*".into()],
            &deny,
            "contact",
            "read",
            Some("crm")
        ));
    }
}
