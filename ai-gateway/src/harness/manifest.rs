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

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
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
}

fn default_true() -> bool {
    true
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
