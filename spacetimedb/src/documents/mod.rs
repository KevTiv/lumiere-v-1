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
pub mod knowledge;

pub use documents::*;
pub use knowledge::*;
