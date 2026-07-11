use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
pub struct SkillVersionRef {
    pub skill_key: String,
    pub version: u32,
}

impl SkillVersionRef {
    pub fn new(skill_key: impl Into<String>, version: u32) -> Self {
        Self {
            skill_key: skill_key.into(),
            version,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewStatus {
    Draft,
    Reviewed,
    Promoted,
    Retired,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ReviewMetadata {
    pub status: ReviewStatus,
    pub reviewed_by: String,
    pub reviewed_at: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskClass {
    Green,
    Amber,
    Red,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    NamedRead,
    ActionDraft,
    ActionExecute,
    RawSql,
    Network,
    Filesystem,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ExecutionLimits {
    pub max_rows: u32,
    pub max_steps: u32,
    pub max_tool_calls: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PrivacyPolicy {
    pub allowed_fields: Vec<String>,
    #[serde(default = "default_true")]
    pub mask_phone_fields: bool,
    #[serde(default = "default_true")]
    pub mask_payment_references: bool,
    #[serde(default = "default_true")]
    pub suppress_secrets: bool,
}

impl PrivacyPolicy {
    pub fn new(allowed_fields: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            allowed_fields: allowed_fields.into_iter().map(Into::into).collect(),
            mask_phone_fields: true,
            mask_payment_references: true,
            suppress_secrets: true,
        }
    }

    /// Merge the skill-level privacy policy with an organization-level policy.
    ///
    /// Org policy is a further restriction: it can suppress or mask fields the
    /// skill allows, but it cannot widen the skill's allowlist. This keeps the
    /// skill manifest as the authoritative output contract while letting admins
    /// enforce tenant-specific field policy.
    pub fn merge_with_org(&self, org: &OrgPrivacyPolicy) -> MergedPrivacyPolicy {
        let allowed: std::collections::BTreeSet<String> = self
            .allowed_fields
            .iter()
            .map(|field| normalized_field(field))
            .collect();

        let org_allowed: std::collections::BTreeSet<String> = org
            .allowed_fields
            .iter()
            .map(|field| normalized_field(field))
            .collect();

        let org_masked: std::collections::BTreeSet<String> = org
            .masked_fields
            .iter()
            .map(|field| normalized_field(field))
            .collect();

        let org_suppressed: std::collections::BTreeSet<String> = org
            .suppressed_fields
            .iter()
            .map(|field| normalized_field(field))
            .collect();

        // Final allowed set:
        // - Must be in the skill allowlist.
        // - Must not be org-suppressed.
        // - If the org explicitly allows `*`, all skill-allowed fields pass.
        // - Otherwise, if the org lists specific allowed fields, restrict to the
        //   intersection (admins can use this to narrow, not widen).
        let mut merged_allowed = Vec::new();
        let org_allows_all = org_allowed.contains("*");
        for field in &self.allowed_fields {
            let normalized = normalized_field(field);
            if org_suppressed.contains(&normalized) {
                continue;
            }
            if !org_allowed.is_empty() && !org_allows_all && !org_allowed.contains(&normalized) {
                continue;
            }
            merged_allowed.push(field.clone());
        }

        // Masked fields are those the skill would mask, plus org-masked fields
        // that survived suppression and remain allowed.
        let mut merged_masked = Vec::new();
        for field in &merged_allowed {
            let normalized = normalized_field(field);
            if org_masked.contains(&normalized) {
                merged_masked.push(field.clone());
            }
        }

        MergedPrivacyPolicy {
            allowed_fields: merged_allowed,
            masked_fields: merged_masked,
            mask_phone_fields: self.mask_phone_fields && org.mask_phone_fields,
            mask_payment_references: self.mask_payment_references && org.mask_payment_references,
            suppress_secrets: self.suppress_secrets || org.suppress_secrets,
        }
    }
}

fn default_true() -> bool {
    true
}

fn normalized_field(field: &str) -> String {
    field
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Organization-level field policy resolved from Casbin-style rules.
///
/// This is intentionally separate from `PrivacyPolicy`: it expresses admin
/// restrictions (allow/mask/deny per field) rather than the skill author's
/// output contract.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgPrivacyPolicy {
    #[serde(default)]
    pub allowed_fields: Vec<String>,
    #[serde(default)]
    pub masked_fields: Vec<String>,
    #[serde(default)]
    pub suppressed_fields: Vec<String>,
    #[serde(default = "default_true")]
    pub mask_phone_fields: bool,
    #[serde(default = "default_true")]
    pub mask_payment_references: bool,
    #[serde(default = "default_true")]
    pub suppress_secrets: bool,
}

/// Effective privacy policy after merging skill and org rules.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MergedPrivacyPolicy {
    pub allowed_fields: Vec<String>,
    pub masked_fields: Vec<String>,
    pub mask_phone_fields: bool,
    pub mask_payment_references: bool,
    pub suppress_secrets: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill_policy() -> PrivacyPolicy {
        PrivacyPolicy::new([
            "company_id",
            "name",
            "customer_phone",
            "payment_reference",
            "internal_note",
        ])
    }

    #[test]
    fn merge_keeps_skill_allowed_fields_when_org_is_empty() {
        let merged = skill_policy().merge_with_org(&OrgPrivacyPolicy::default());
        assert_eq!(
            merged.allowed_fields,
            vec![
                "company_id",
                "name",
                "customer_phone",
                "payment_reference",
                "internal_note",
            ]
        );
        assert!(merged.masked_fields.is_empty());
    }

    #[test]
    fn merge_suppresses_org_denied_fields() {
        let org = OrgPrivacyPolicy {
            suppressed_fields: vec!["internal_note".to_string()],
            ..OrgPrivacyPolicy::default()
        };
        let merged = skill_policy().merge_with_org(&org);
        assert!(!merged.allowed_fields.contains(&"internal_note".to_string()));
        assert!(merged
            .allowed_fields
            .contains(&"customer_phone".to_string()));
    }

    #[test]
    fn merge_masks_org_masked_fields() {
        let org = OrgPrivacyPolicy {
            masked_fields: vec!["customer_phone".to_string()],
            ..OrgPrivacyPolicy::default()
        };
        let merged = skill_policy().merge_with_org(&org);
        assert!(merged
            .allowed_fields
            .contains(&"customer_phone".to_string()));
        assert!(merged.masked_fields.contains(&"customer_phone".to_string()));
    }

    #[test]
    fn merge_does_not_widen_skill_allowlist() {
        let org = OrgPrivacyPolicy {
            allowed_fields: vec!["ssn".to_string()],
            ..OrgPrivacyPolicy::default()
        };
        let merged = skill_policy().merge_with_org(&org);
        assert!(!merged.allowed_fields.contains(&"ssn".to_string()));
    }

    #[test]
    fn merge_intersects_when_org_lists_specific_allowed_fields() {
        let org = OrgPrivacyPolicy {
            allowed_fields: vec!["company_id".to_string(), "name".to_string()],
            ..OrgPrivacyPolicy::default()
        };
        let merged = skill_policy().merge_with_org(&org);
        assert_eq!(
            merged.allowed_fields,
            vec!["company_id".to_string(), "name".to_string()]
        );
    }

    #[test]
    fn merge_allows_all_when_org_uses_wildcard() {
        let org = OrgPrivacyPolicy {
            allowed_fields: vec!["*".to_string()],
            ..OrgPrivacyPolicy::default()
        };
        let merged = skill_policy().merge_with_org(&org);
        assert_eq!(merged.allowed_fields, skill_policy().allowed_fields);
    }

    #[test]
    fn merge_toggles_category_flags() {
        let org = OrgPrivacyPolicy {
            mask_phone_fields: false,
            mask_payment_references: false,
            suppress_secrets: false,
            ..OrgPrivacyPolicy::default()
        };
        let merged = skill_policy().merge_with_org(&org);
        assert!(!merged.mask_phone_fields);
        assert!(!merged.mask_payment_references);
        assert!(merged.suppress_secrets);
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SkillManifest {
    pub skill: SkillVersionRef,
    pub review: ReviewMetadata,
    pub risk: RiskClass,
    pub named_resources: Vec<String>,
    pub allowed_tools: Vec<String>,
    pub allowed_capabilities: Vec<Capability>,
    pub output_type: String,
    pub limits: ExecutionLimits,
    pub privacy: PrivacyPolicy,
}
