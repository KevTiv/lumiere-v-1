//! Built-in red action-draft skill manifests for the harness bridge.
//!
//! These are **adapters** around reducers already exposed through the legacy
//! action-draft allowlist. They do not introduce new execution authority; they
//! force the red skill through the human-approval action-draft flow.

use super::manifest::{
    Capability, ExecutionLimits, PrivacyPolicy, ReviewMetadata, ReviewStatus, RiskClass,
    SkillManifest, SkillVersionRef,
};

pub const CREATE_SALE_ORDER_DRAFT_SKILL_KEY: &str = "create_sale_order_draft";
pub const CREATE_SALE_ORDER_DRAFT_VERSION: u32 = 1;
pub const CREATE_SALE_ORDER_DRAFT_OUTPUT_TYPE: &str = "action_draft.create_sale_order.v1";

pub fn create_sale_order_draft_manifest() -> SkillManifest {
    SkillManifest {
        skill: SkillVersionRef::new(
            CREATE_SALE_ORDER_DRAFT_SKILL_KEY,
            CREATE_SALE_ORDER_DRAFT_VERSION,
        ),
        review: ReviewMetadata {
            status: ReviewStatus::Promoted,
            reviewed_by: "phase1-action-draft-bridge".to_string(),
            reviewed_at: "2026-07-10T00:00:00Z".to_string(),
        },
        risk: RiskClass::Red,
        named_resources: vec![],
        allowed_tools: vec!["create_sale_order".to_string()],
        allowed_capabilities: vec![Capability::ActionDraft],
        output_type: CREATE_SALE_ORDER_DRAFT_OUTPUT_TYPE.to_string(),
        limits: ExecutionLimits {
            max_rows: 0,
            max_steps: 1,
            max_tool_calls: 1,
        },
        privacy: PrivacyPolicy::new([] as [&str; 0]),
    }
}
