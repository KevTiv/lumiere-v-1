//! Provider-independent permission evaluation shared by API reads and reducers.

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

#[cfg(test)]
mod tests {
    use super::*;

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
