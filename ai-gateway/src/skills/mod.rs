//! Bundled ERP skill definitions loaded from markdown files (Claude/Cursor skill style).

mod md_loader;
mod briefing;
mod import;
mod insights;

pub use briefing::{collect_briefing_context, BriefingContext};
pub use import::{analyze_import_mapping, preview_import_mapping, ImportAnalyzeResult, ImportPreviewResult};
pub use insights::{scan_insights, InsightsScanResult};
pub use md_loader::{
    compose_prompt, discover_bundled_skills, load_bundled_skill, resolve_skills_dir, BundledSkillMd,
    SyncSkillPayload,
};
