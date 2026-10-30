//! Sender-scoped reads for the gateway's durable recovery and evidence adapters.
//!
//! Private source tables remain private. Only the existing active
//! `ai_spend_reader` binding can read rows, and only in its organizations.
//! The gateway still checks the acting user's company and evidence grants.

use super::capability_execution::{ai_capability_execution__view, AiCapabilityExecution};
use super::evidence_dependency::{
    ai_evidence_dependency__view, ai_evidence_source_change__view, AiEvidenceDependency,
    AiEvidenceSourceChange,
};
use super::evidence_lineage::{
    ai_artifact_component__view, ai_evidence_claim__view, ai_evidence_decision__view,
    AiArtifactComponent, AiEvidenceClaim, AiEvidenceDecision,
};
use super::evidence_source::{
    ai_evidence_contribution__view, ai_evidence_passage__view, ai_evidence_source__view,
    ai_evidence_source_version__view, AiEvidenceContribution, AiEvidencePassage, AiEvidenceSource,
    AiEvidenceSourceVersion,
};
use super::knowledge_entry::{
    ai_knowledge_entry__view, ai_knowledge_entry_version__view, ai_knowledge_review__view,
    AiKnowledgeEntry, AiKnowledgeEntryVersion, AiKnowledgeReview,
};
use super::spend_reads::authorized_organization_ids;
use crate::documents::knowledge::knowledge_article__view;
use crate::documents::knowledge_guides::{knowledge_guide__view, knowledge_guide_revision__view};
use spacetimedb::ViewContext;

/// Only the existing bound gateway reader can see this private-guide association.
/// The gateway must additionally check the acting member, company and current revision.
#[derive(Clone, spacetimedb::SpacetimeType)]
pub struct KnowledgeGuideAuthorityRead {
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub revision: u32,
    pub title: String,
    pub content_hash: String,
    pub revision_author: spacetimedb::Identity,
    pub member_ids: Vec<spacetimedb::Identity>,
    pub module: String,
    pub language: String,
}

#[spacetimedb::view(accessor = knowledge_guide_authority_read, public, primary_key = id)]
pub fn knowledge_guide_authority_read(ctx: &ViewContext) -> Vec<KnowledgeGuideAuthorityRead> {
    let mut rows = Vec::new();
    for org in authorized_organization_ids(ctx) {
        for guide in ctx
            .db
            .knowledge_guide()
            .knowledge_guide_by_org()
            .filter(&org)
        {
            let Some(article) = ctx.db.knowledge_article().id().find(&guide.id) else {
                continue;
            };
            let Some(revision) = ctx
                .db
                .knowledge_guide_revision()
                .knowledge_guide_revision_by_guide()
                .filter(&guide.id)
                .find(|row| {
                    row.organization_id == org
                        && row.company_id == guide.company_id
                        && row.revision == guide.latest_revision
                })
            else {
                continue;
            };
            rows.push(KnowledgeGuideAuthorityRead {
                id: guide.id,
                organization_id: org,
                company_id: guide.company_id,
                revision: guide.latest_revision,
                title: revision.title,
                content_hash: revision.content_hash,
                revision_author: revision.create_uid,
                member_ids: article.member_ids,
                module: guide.module,
                language: revision.language,
            });
        }
    }
    rows
}

#[spacetimedb::view(accessor = ai_capability_execution_read, public, primary_key = id)]
pub fn ai_capability_execution_read(ctx: &ViewContext) -> Vec<AiCapabilityExecution> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_capability_execution()
                .ai_capability_execution_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_evidence_passage_read, public, primary_key = id)]
pub fn ai_evidence_passage_read(ctx: &ViewContext) -> Vec<AiEvidencePassage> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_evidence_passage()
                .ai_evidence_passage_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_evidence_source_read, public, primary_key = id)]
pub fn ai_evidence_source_read(ctx: &ViewContext) -> Vec<AiEvidenceSource> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_evidence_source()
                .ai_evidence_source_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_evidence_source_version_read, public, primary_key = id)]
pub fn ai_evidence_source_version_read(ctx: &ViewContext) -> Vec<AiEvidenceSourceVersion> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_evidence_source_version()
                .ai_evidence_source_version_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_evidence_contribution_read, public, primary_key = id)]
pub fn ai_evidence_contribution_read(ctx: &ViewContext) -> Vec<AiEvidenceContribution> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_evidence_contribution()
                .ai_evidence_contribution_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_evidence_claim_read, public, primary_key = id)]
pub fn ai_evidence_claim_read(ctx: &ViewContext) -> Vec<AiEvidenceClaim> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_evidence_claim()
                .ai_evidence_claim_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_evidence_decision_read, public, primary_key = id)]
pub fn ai_evidence_decision_read(ctx: &ViewContext) -> Vec<AiEvidenceDecision> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_evidence_decision()
                .ai_evidence_decision_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_artifact_component_read, public, primary_key = id)]
pub fn ai_artifact_component_read(ctx: &ViewContext) -> Vec<AiArtifactComponent> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_artifact_component()
                .ai_artifact_component_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_evidence_dependency_read, public, primary_key = id)]
pub fn ai_evidence_dependency_read(ctx: &ViewContext) -> Vec<AiEvidenceDependency> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_evidence_dependency()
                .ai_evidence_dependency_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_evidence_source_change_read, public, primary_key = id)]
pub fn ai_evidence_source_change_read(ctx: &ViewContext) -> Vec<AiEvidenceSourceChange> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_evidence_source_change()
                .ai_evidence_source_change_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_knowledge_entry_read, public, primary_key = id)]
pub fn ai_knowledge_entry_read(ctx: &ViewContext) -> Vec<AiKnowledgeEntry> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_knowledge_entry()
                .ai_knowledge_entry_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_knowledge_entry_version_read, public, primary_key = id)]
pub fn ai_knowledge_entry_version_read(ctx: &ViewContext) -> Vec<AiKnowledgeEntryVersion> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_knowledge_entry_version()
                .ai_knowledge_entry_version_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_knowledge_review_read, public, primary_key = id)]
pub fn ai_knowledge_review_read(ctx: &ViewContext) -> Vec<AiKnowledgeReview> {
    authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|organization_id| {
            ctx.db
                .ai_knowledge_review()
                .ai_knowledge_review_by_org()
                .filter(&organization_id)
                .collect::<Vec<_>>()
        })
        .collect()
}
