/// Documents Module — File management and knowledge base
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **DocumentFolder** | Folder hierarchy for organizing documents |
/// | **Document** | File documents with versioning and access control |
/// | **DocumentVersion** | Immutable version snapshots |
/// | **KnowledgeArticleCategory** | Article categories |
/// | **KnowledgeArticle** | Wiki articles with hierarchy and permissions |
pub mod documents;
pub mod drive_sync;
pub mod esign;
pub mod knowledge;
pub mod legal_hold;
pub mod pack_locale;
pub mod presence;
pub mod regional;
pub mod templates;

pub use documents::*;
pub use drive_sync::*;
pub use esign::*;
pub use knowledge::*;
pub use legal_hold::*;
pub use presence::*;
pub use regional::*;
pub use templates::*;
