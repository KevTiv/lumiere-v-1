//! AI-006/AI-007: org-scope enforcement on insight mutations and document_id FK
//! validation on document processing jobs.
use spacetimedb::{ReducerContext, Table};

use crate::ai::intelligence::{
    ai_document_processing_job, ai_insight, approve_document_processing_job,
    complete_document_processing_job, create_ai_insight, create_document_processing_job,
    dismiss_insight, CompleteDocumentProcessingJobParams, CreateAiInsightParams,
    CreateDocumentProcessingJobParams,
};
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::documents::documents::{create_document, document, CreateDocumentParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::InsightSeverity;

fn create_test_insight(ctx: &ReducerContext, fixture: &OrgFixture, title: &str) -> Result<u64, String> {
    create_ai_insight(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateAiInsightParams {
            severity: InsightSeverity::Medium,
            title: title.to_string(),
            description: "test insight".to_string(),
            recommendations: vec![],
            related_model: "sale_order".to_string(),
            confidence: 0.5,
            tags: vec![],
            related_id: None,
            generated_by: None,
            impact_score: None,
            priority: None,
            metadata: None,
        },
    )?;
    ctx.db
        .ai_insight()
        .iter()
        .find(|i| i.organization_id == fixture.organization_id && i.title == title)
        .map(|i| i.id)
        .ok_or_else(|| format!("insight {title} not found after create"))
}

/// AI-006: mutating an insight requires it to belong to the caller-scoped organization.
pub fn test_insight_org_scope(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;

    let foreign_insight_id = create_test_insight(ctx, &foreign, "AI-006 Foreign Insight")?;

    let result = dismiss_insight(ctx, local.organization_id, None, foreign_insight_id);
    match result {
        Err(ref e) if e.contains("organization") => {}
        other => {
            return Err(format!(
                "cross-org dismiss: expected organization error, got {other:?}"
            ))
        }
    }
    let unchanged = ctx
        .db
        .ai_insight()
        .id()
        .find(&foreign_insight_id)
        .ok_or("foreign insight disappeared")?;
    if unchanged.dismissed {
        return Err("cross-org dismiss mutated a foreign-org insight".to_string());
    }

    let local_insight_id = create_test_insight(ctx, &local, "AI-006 Local Insight")?;
    dismiss_insight(ctx, local.organization_id, None, local_insight_id)?;
    let dismissed = ctx
        .db
        .ai_insight()
        .id()
        .find(&local_insight_id)
        .ok_or("local insight disappeared")?;
    if !dismissed.dismissed {
        return Err("same-org dismiss did not persist".to_string());
    }

    Ok(())
}

/// AI-007: document_id on a processing job must resolve to a real, same-org document.
pub fn test_document_processing_job_document_relation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;

    let checksum = "a".repeat(64);
    create_document(
        ctx,
        foreign.organization_id,
        Some(foreign.company_id),
        CreateDocumentParams {
            name: "AI-007 Foreign Doc".to_string(),
            description: None,
            file_name: "foreign.pdf".to_string(),
            file_size: 128,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/default/ai-007-foreign".to_string(),
            checksum: checksum.clone(),
            folder_id: None,
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let foreign_doc_id = ctx
        .db
        .document()
        .iter()
        .find(|d| d.organization_id == foreign.organization_id && d.name == "AI-007 Foreign Doc")
        .map(|d| d.id)
        .ok_or("foreign document not found after create")?;

    let missing_doc_id = ctx.db.document().iter().map(|d| d.id).max().unwrap_or(0) + 1000;

    for (case, doc_id, expected) in [
        ("missing", missing_doc_id, "not found"),
        ("cross-org", foreign_doc_id, "organization"),
    ] {
        let result = create_document_processing_job(
            ctx,
            local.organization_id,
            Some(local.company_id),
            CreateDocumentProcessingJobParams {
                document_type: "invoice".to_string(),
                job_type: "ocr".to_string(),
                ai_agent_id: None,
                input_data: None,
                document_id: Some(doc_id),
                document_version_id: None,
                metadata: None,
            },
        );
        match result {
            Err(ref e) if e.contains(expected) => {}
            other => {
                return Err(format!(
                    "{case} document_id: expected {expected:?} error, got {other:?}"
                ))
            }
        }
    }

    create_document(
        ctx,
        local.organization_id,
        Some(local.company_id),
        CreateDocumentParams {
            name: "AI-007 Local Doc".to_string(),
            description: None,
            file_name: "local.pdf".to_string(),
            file_size: 128,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/default/ai-007-local".to_string(),
            checksum,
            folder_id: None,
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let local_doc_id = ctx
        .db
        .document()
        .iter()
        .find(|d| d.organization_id == local.organization_id && d.name == "AI-007 Local Doc")
        .map(|d| d.id)
        .ok_or("local document not found after create")?;

    create_document_processing_job(
        ctx,
        local.organization_id,
        Some(local.company_id),
        CreateDocumentProcessingJobParams {
            document_type: "invoice".to_string(),
            job_type: "ocr".to_string(),
            ai_agent_id: None,
            input_data: None,
            document_id: Some(local_doc_id),
            document_version_id: None,
            metadata: None,
        },
    )?;
    let persisted = ctx
        .db
        .ai_document_processing_job()
        .iter()
        .find(|j| j.organization_id == local.organization_id && j.document_id == Some(local_doc_id))
        .ok_or("valid document processing job was not persisted")?;
    if persisted.document_id != Some(local_doc_id) {
        return Err("valid document_id was not persisted".to_string());
    }

    complete_document_processing_job(
        ctx,
        local.organization_id,
        Some(local.company_id),
        persisted.id,
        CompleteDocumentProcessingJobParams {
            extracted_data: Some(r#"{"vendor":"C2","total":12.5}"#.to_string()),
            confidence_score: Some(0.99),
            model_used: Some("c2-test".to_string()),
            tokens_used: Some(1),
            cost: Some(0.0),
            error_message: None,
        },
    )?;
    approve_document_processing_job(
        ctx,
        local.organization_id,
        Some(local.company_id),
        persisted.id,
    )?;
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .iter()
        .filter(|commit| {
            commit.organization_id == local.organization_id
                && commit.operation_id == "erp.approve_document_processing_job"
                && commit.correlation_id
                    == format!("document-processing-job:{}:approve", persisted.id)
        })
        .collect();
    if commits.len() != 1 || commits[0].row_change_count != 2 {
        return Err(format!(
            "AI approval should emit one two-row organization commit, got {} / {:?}",
            commits.len(),
            commits.first().map(|commit| commit.row_change_count)
        ));
    }
    let commit = &commits[0];
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .iter()
        .filter(|change| {
            change.organization_id == local.organization_id
                && change.commit_sequence == commit.sequence
        })
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    let tables: Vec<_> = changes
        .iter()
        .map(|change| change.table_name.as_str())
        .collect();
    if tables != ["document", "ai_document_processing_job"] {
        return Err(format!("AI approval commit row order mismatch: {tables:?}"));
    }

    Ok(())
}
