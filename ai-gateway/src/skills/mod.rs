//! Bundled ERP skill definitions loaded from markdown files (Claude/Cursor skill style).

mod briefing;
mod import;
mod insights;
mod md_loader;

pub use briefing::{collect_briefing_context, BriefingContext, BriefingContextRequest};
pub use import::{
    analyze_import_mapping, parse_csv_text, preview_import_mapping, scan_csv_content,
    ImportAnalyzeRequest, ImportAnalyzeResponse, ImportPreviewRequest,
    ImportPreviewResponse,
};
pub use insights::{scan_insights, InsightsScanRequest, InsightsScanResult};
pub use md_loader::{
    bundled_to_sync_payload, compose_prompt, discover_bundled_skills, load_bundled_skill,
    resolve_skills_dir, BundledSkillMd,
};
