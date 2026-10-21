//! Server-owned alpha founder admission. Changes require rebuilding the module.
//!
//! `LUMIERE_ALPHA_FOUNDER_IDENTITIES` is a comma-separated list of at most 100
//! canonical, lowercase, 64-character identity hex strings. No whitespace,
//! prefixes, wildcards, or partially valid policies are accepted.

const MAX_FOUNDERS: usize = 100;
const IDENTITY_HEX_LEN: usize = 64;
const ADMISSION_DENIED: &str = "Organization creation requires alpha founder approval";

/// Only deliberately enabled development artifacts may bypass alpha admission.
/// The feature check prevents a production build from honoring a stray dev flag.
fn dev_admission_bypass(dev_module: bool, dev_reducers: Option<&str>) -> bool {
    dev_module
        && dev_reducers.is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

fn canonical_identity(identity: &str) -> bool {
    identity.len() == IDENTITY_HEX_LEN
        && identity
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Validate the entire policy before honoring any entry, including a matching
/// entry before a malformed entry. Empty/missing policies always fail closed.
fn founder_is_approved(policy: Option<&str>, actor: &str) -> bool {
    let Some(policy) = policy else {
        return false;
    };
    if !canonical_identity(actor)
        || policy.is_empty()
        || policy.len() > MAX_FOUNDERS * (IDENTITY_HEX_LEN + 1) - 1
    {
        return false;
    }

    let mut count = 0;
    let mut approved = false;
    for identity in policy.split(',') {
        count += 1;
        if count > MAX_FOUNDERS || !canonical_identity(identity) {
            return false;
        }
        approved |= identity == actor;
    }
    approved
}

fn check_founder_admission(
    policy: Option<&str>,
    actor: &str,
    has_membership_history: bool,
    trusted_dev: bool,
) -> Result<(), String> {
    if trusted_dev {
        return Ok(());
    }
    if !founder_is_approved(policy, actor) {
        return Err(ADMISSION_DENIED.to_string());
    }
    // Never filter on is_active: revoking a membership must not give its
    // identity another alpha tenant. Membership removal retains the row.
    if has_membership_history {
        return Err("Alpha founders may create only one organization".to_string());
    }
    Ok(())
}

pub(super) fn require_alpha_founder(
    actor: &str,
    has_membership_history: bool,
) -> Result<(), String> {
    check_founder_admission(
        option_env!("LUMIERE_ALPHA_FOUNDER_IDENTITIES"),
        actor,
        has_membership_history,
        dev_admission_bypass(
            cfg!(feature = "dev-module"),
            option_env!("LUMIERE_ENABLE_DEV_REDUCERS"),
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACTOR: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const OTHER: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn admits_only_exact_canonical_founder() {
        assert!(check_founder_admission(Some(ACTOR), ACTOR, false, false).is_ok());
        assert!(founder_is_approved(Some(&format!("{OTHER},{ACTOR}")), ACTOR));
        assert!(!founder_is_approved(Some(OTHER), ACTOR));
        assert!(!founder_is_approved(Some(ACTOR), &ACTOR.to_uppercase()));
        assert!(!founder_is_approved(Some(ACTOR), &format!("0x{ACTOR}")));
    }

    #[test]
    fn missing_and_malformed_policies_fail_closed_including_valid_prefix() {
        assert!(!founder_is_approved(None, ACTOR));
        for policy in [
            String::new(),
            "*".into(),
            ACTOR.to_uppercase(),
            format!("0x{ACTOR}"),
            format!(" {ACTOR}"),
            format!("{ACTOR} "),
            format!("{ACTOR},"),
            format!(",{ACTOR}"),
            format!("{ACTOR},*"),
            format!("{ACTOR},{OTHER},bad"),
            ACTOR[..63].into(),
            format!("{ACTOR}\n"),
        ] {
            assert!(
                check_founder_admission(Some(&policy), ACTOR, false, false).is_err(),
                "{policy}"
            );
        }
    }

    #[test]
    fn founder_policy_is_bounded() {
        let maximum = vec![ACTOR; MAX_FOUNDERS].join(",");
        assert!(founder_is_approved(Some(&maximum), ACTOR));
        let excessive = vec![ACTOR; MAX_FOUNDERS + 1].join(",");
        assert!(!founder_is_approved(Some(&excessive), ACTOR));
    }

    #[test]
    fn repeated_or_revoked_membership_does_not_restore_admission() {
        // Both active and revoked membership rows constitute history. The
        // reducer queries by identity without filtering the active flag.
        for is_active in [true, false] {
            let memberships = [(ACTOR, is_active)];
            let history = memberships
                .iter()
                .any(|(identity, _)| *identity == ACTOR);
            assert!(check_founder_admission(Some(ACTOR), ACTOR, history, false).is_err());
        }
    }

    #[test]
    fn only_explicit_dev_build_and_flag_bypass_policy_and_fixture_quotas() {
        for flag in [None, Some("0"), Some("false"), Some("true ")] {
            assert!(!dev_admission_bypass(true, flag));
        }
        for flag in [Some("1"), Some("true"), Some("TRUE")] {
            assert!(!dev_admission_bypass(false, flag));
            assert!(dev_admission_bypass(true, flag));
        }
        assert!(check_founder_admission(None, ACTOR, true, true).is_ok());
        assert!(check_founder_admission(None, ACTOR, false, false).is_err());
    }
}
