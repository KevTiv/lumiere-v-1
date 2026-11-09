use spacetimedb::{Identity, ReducerContext, Table};

use crate::ai::evidence_lineage::{
    ai_evidence_claim, record_ai_evidence_claim, RecordAiEvidenceClaimParams,
};
use crate::ai::evidence_source::{
    ai_evidence_passage, ai_evidence_source_version, ingest_document_blob_content,
};
use crate::ai::intelligence::{
    search_embedding, upsert_search_embedding, UpsertSearchEmbeddingParams,
};
use crate::core::organization::{company, Company};
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::documents::documents::{
    add_document_version, create_document, create_document_folder, delete_document,
    delete_document_folder, doc_folder, document, document_version, move_document,
    record_document_view, restore_document, update_document, update_document_folder,
    AddDocumentVersionParams, CreateDocumentFolderParams, CreateDocumentParams, Document,
    DocumentFolder, UpdateDocumentFolderParams, UpdateDocumentParams,
};
use crate::documents::folder_operations::{
    move_document_folder, restore_document_folder, trash_document_folder,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn create_folder(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
    parent_id: Option<u64>,
    metadata: Option<String>,
) -> Result<DocumentFolder, String> {
    create_document_folder(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateDocumentFolderParams {
            name: name.to_string(),
            description: None,
            parent_id,
            is_access_restricted: false,
            is_hidden: false,
            is_readonly: false,
            is_favorite: false,
            sequence: 1,
            storage_id: None,
            residency_region: None,
            metadata,
        },
    )?;
    ctx.db
        .doc_folder()
        .doc_folder_by_org()
        .filter(&fixture.organization_id)
        .find(|folder| folder.name == name.trim())
        .ok_or_else(|| "Folder fixture missing".to_string())
}

fn upload_params(name: &str, folder_id: Option<u64>) -> CreateDocumentParams {
    CreateDocumentParams {
        name: name.to_string(),
        description: None,
        file_name: format!("{name}.txt"),
        file_size: 10,
        mimetype: "text/plain".to_string(),
        url: format!("/api/documents/blobs/object/1/default/{name}"),
        checksum: "a".repeat(64),
        folder_id,
        res_model: None,
        res_id: None,
        partner_id: None,
        tag_ids: vec![],
        is_favorite: false,
        classification_id: None,
        retention_days: None,
        fiscal_kind: None,
        residency_region: None,
        metadata: None,
    }
}

fn create_file(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
    folder_id: Option<u64>,
) -> Result<Document, String> {
    create_document(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        upload_params(name, folder_id),
    )?;
    ctx.db
        .document()
        .document_by_org()
        .filter(&fixture.organization_id)
        .find(|doc| doc.name == name)
        .ok_or_else(|| "Document fixture missing".to_string())
}

fn update_params() -> UpdateDocumentFolderParams {
    UpdateDocumentFolderParams {
        name: None,
        description: None,
        parent_id: None,
        sequence: None,
        is_access_restricted: None,
        is_hidden: None,
        is_readonly: None,
        is_favorite: None,
        storage_id: None,
        residency_region: None,
        metadata: None,
    }
}

fn reject(result: Result<(), String>, label: &str) -> Result<(), String> {
    if result.is_ok() {
        Err(format!("Expected rejection: {label}"))
    } else {
        Ok(())
    }
}

fn trashed(folder: &DocumentFolder) -> bool {
    folder
        .metadata
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .is_some_and(|metadata| metadata.get("documentFolderLifecycle").is_some())
}

pub fn test_folder_tree_move_trash_restore(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let original_metadata = Some("legacy opaque metadata".to_string());
    let source = create_folder(
        ctx,
        &fixture,
        "Tree Source",
        None,
        original_metadata.clone(),
    )?;
    let child = create_folder(ctx, &fixture, "Tree Child", Some(source.id), None)?;
    let target = create_folder(ctx, &fixture, "Tree Target", None, None)?;
    let already_trashed =
        create_folder(ctx, &fixture, "Previously Trashed", Some(source.id), None)?;
    let live = create_file(ctx, &fixture, "tree-live", Some(child.id))?;
    let deleted = create_file(ctx, &fixture, "tree-deleted", Some(source.id))?;
    delete_document(ctx, org, deleted.id)?;
    trash_document_folder(ctx, org, already_trashed.id)?;
    ctx.db.document().id().update(Document {
        is_locked: true,
        locked_by: Some(Identity::from_byte_array([0xe3; 32])),
        ..live.clone()
    });
    reject(
        trash_document_folder(ctx, org, source.id),
        "trash a subtree with a locked document",
    )?;
    reject(
        move_document_folder(ctx, org, source.id, Some(target.id)),
        "move a subtree with another user's document lock",
    )?;
    ctx.db.document().id().update(live.clone());

    reject(
        move_document_folder(ctx, org, source.id, Some(child.id)),
        "descendant destination",
    )?;
    // A stale cached path must not permit a cycle or survive a successful move.
    ctx.db.doc_folder().id().update(DocumentFolder {
        parent_path: "/stale".into(),
        ..child.clone()
    });
    reject(
        move_document_folder(ctx, org, source.id, Some(child.id)),
        "cycle with stale cached path",
    )?;
    move_document_folder(ctx, org, source.id, Some(target.id))?;
    let moved_child = ctx
        .db
        .doc_folder()
        .id()
        .find(&child.id)
        .ok_or("Moved child missing")?;
    if moved_child.parent_path != format!("/{}/{}", target.id, source.id) {
        return Err("Descendant path was not updated".into());
    }
    move_document_folder(ctx, org, source.id, None)?;
    let moved = ctx
        .db
        .doc_folder()
        .id()
        .find(&source.id)
        .ok_or("Moved root missing")?;
    let child_after_root = ctx
        .db
        .doc_folder()
        .id()
        .find(&child.id)
        .ok_or("Root child missing")?;
    if moved.parent_id.is_some()
        || moved.parent_path != "/"
        || child_after_root.parent_path != format!("/{}", source.id)
    {
        return Err("Explicit root move did not repair the subtree".into());
    }
    move_document(ctx, org, live.id, None)?;
    if ctx
        .db
        .document()
        .id()
        .find(&live.id)
        .ok_or("Moved document missing")?
        .folder_id
        .is_some()
    {
        return Err("Document root move failed".into());
    }
    move_document(ctx, org, live.id, Some(child.id))?;
    trash_document_folder(ctx, org, source.id)?;
    trash_document_folder(ctx, org, source.id)?; // Retry preserves the same tombstone.
    reject(
        restore_document_folder(ctx, org, already_trashed.id, None),
        "restore child while its ancestor remains in trash",
    )?;
    reject(
        record_document_view(ctx, org, live.id),
        "view below a trashed ancestor",
    )?;
    reject(
        create_document(
            ctx,
            org,
            Some(fixture.company_id),
            upload_params("blocked-upload", Some(child.id)),
        ),
        "upload below a trashed ancestor",
    )?;
    reject(
        move_document(ctx, org, live.id, None),
        "move from a trashed ancestor",
    )?;
    reject(
        restore_document(ctx, org, deleted.id),
        "restore an individual file into a trashed ancestor",
    )?;
    reject(
        update_document_folder(
            ctx,
            org,
            source.id,
            UpdateDocumentFolderParams {
                metadata: Some("{}".into()),
                ..update_params()
            },
        ),
        "remove tombstone through metadata update",
    )?;

    restore_document_folder(ctx, org, source.id, None)?;
    restore_document_folder(ctx, org, source.id, None)?;
    let restored = ctx
        .db
        .doc_folder()
        .id()
        .find(&source.id)
        .ok_or("Restored root missing")?;
    if restored.metadata != original_metadata {
        return Err("Folder restore did not preserve exact original metadata".into());
    }
    if !trashed(
        &ctx.db
            .doc_folder()
            .id()
            .find(&already_trashed.id)
            .ok_or("Prior trash missing")?,
    ) {
        return Err("Parent restore resurrected a separately trashed child".into());
    }
    let live_after = ctx
        .db
        .document()
        .id()
        .find(&live.id)
        .ok_or("Live document missing")?;
    let deleted_after = ctx
        .db
        .document()
        .id()
        .find(&deleted.id)
        .ok_or("Deleted document missing")?;
    if live_after.is_deleted || !deleted_after.is_deleted || live_after.url != live.url {
        return Err("Folder lifecycle changed document deletion state or blob reference".into());
    }
    record_document_view(ctx, org, live.id)?;

    let retained = create_folder(ctx, &fixture, "Retained Deleted File", None, None)?;
    let retained_file = create_file(ctx, &fixture, "retained-deleted", Some(retained.id))?;
    delete_document(ctx, org, retained_file.id)?;
    reject(
        delete_document_folder(ctx, org, retained.id),
        "hard deletion strands a retained deleted file",
    )?;
    Ok(())
}

pub fn test_folder_scope_acl_and_collision(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let parent = create_folder(ctx, &fixture, "Private Parent", None, None)?;
    let child = create_folder(ctx, &fixture, "Child", Some(parent.id), None)?;
    let foreign_folder = create_folder(ctx, &foreign, "Foreign", None, None)?;
    reject(
        move_document_folder(ctx, org, child.id, Some(foreign_folder.id)),
        "cross organization destination",
    )?;
    let original_company = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("Company fixture missing")?;
    let other_company = ctx.db.company().insert(Company {
        id: 0,
        external_id: format!("folder-scope-{}", fixture.company_id),
        name: "Other folder company".into(),
        code: format!("FOLDER-{}", fixture.company_id),
        is_parent: false,
        parent_id: Some(fixture.company_id),
        ..original_company
    });
    let other_fixture = OrgFixture {
        company_id: other_company.id,
        ..fixture.clone()
    };
    let other_company_folder = create_folder(ctx, &other_fixture, "Other Company", None, None)?;
    reject(
        move_document_folder(ctx, org, child.id, Some(other_company_folder.id)),
        "cross company destination",
    )?;
    reject(
        create_folder(
            ctx,
            &fixture,
            "Wrong Company Child",
            Some(other_company_folder.id),
            None,
        )
        .map(|_| ()),
        "cross company parent during create",
    )?;
    reject(
        create_document(
            ctx,
            org,
            None,
            upload_params("unscoped-file", Some(parent.id)),
        ),
        "unscoped document in company folder",
    )?;
    reject(
        create_folder(ctx, &fixture, "Private Parent", None, None).map(|_| ()),
        "active name collision",
    )?;
    let private_destination = create_folder(ctx, &fixture, "Private Destination", None, None)?;
    update_document_folder(
        ctx,
        org,
        private_destination.id,
        UpdateDocumentFolderParams {
            is_access_restricted: Some(true),
            ..update_params()
        },
    )?;
    let other_owner_file = create_file(ctx, &fixture, "other-owner", None)?;
    ctx.db.document().id().update(Document {
        owner_id: Identity::from_byte_array([0xe2; 32]),
        ..other_owner_file.clone()
    });
    reject(
        move_document(ctx, org, other_owner_file.id, Some(private_destination.id)),
        "move another owner's document into a private folder",
    )?;
    reject(
        update_document(
            ctx,
            org,
            other_owner_file.id,
            UpdateDocumentParams {
                folder_id: Some(private_destination.id),
                name: None,
                description: None,
                tag_ids: None,
                is_favorite: None,
                res_model: None,
                res_id: None,
                partner_id: None,
                metadata: None,
            },
        ),
        "legacy move of another owner's document",
    )?;
    if ctx
        .db
        .document()
        .id()
        .find(&other_owner_file.id)
        .ok_or("Non-owner move fixture missing")?
        .folder_id
        .is_some()
    {
        return Err("Rejected non-owner move changed the document folder".into());
    }

    update_document_folder(
        ctx,
        org,
        parent.id,
        UpdateDocumentFolderParams {
            is_access_restricted: Some(true),
            ..update_params()
        },
    )?;
    reject(
        move_document_folder(ctx, org, child.id, None),
        "move broadens inherited access",
    )?;
    update_document_folder(
        ctx,
        org,
        child.id,
        UpdateDocumentFolderParams {
            is_access_restricted: Some(true),
            ..update_params()
        },
    )?;
    move_document_folder(ctx, org, child.id, None)?;
    move_document_folder(ctx, org, child.id, Some(parent.id))?;

    let restricted = ctx
        .db
        .doc_folder()
        .id()
        .find(&parent.id)
        .ok_or("Restricted parent missing")?;
    ctx.db.doc_folder().id().update(DocumentFolder {
        owner_id: Identity::from_byte_array([0xe1; 32]),
        write_access_ids: vec![],
        read_access_ids: vec![],
        ..restricted
    });
    reject(
        create_folder(ctx, &fixture, "Forbidden Child", Some(parent.id), None).map(|_| ()),
        "create under a forbidden parent",
    )?;
    reject(
        update_document_folder(
            ctx,
            org,
            child.id,
            UpdateDocumentFolderParams {
                name: Some("Bypass".into()),
                ..update_params()
            },
        ),
        "rename below a forbidden ancestor",
    )?;
    reject(
        move_document_folder(ctx, org, child.id, None),
        "move out of a forbidden ancestor",
    )?;
    reject(
        trash_document_folder(ctx, org, child.id),
        "trash below a forbidden ancestor",
    )?;

    let first = create_folder(ctx, &fixture, "Restore Collision", None, None)?;
    trash_document_folder(ctx, org, first.id)?;
    create_folder(ctx, &fixture, "Restore Collision", None, None)?;
    reject(
        restore_document_folder(ctx, org, first.id, None),
        "restore name collision",
    )?;
    let alternative = create_folder(ctx, &fixture, "Restore Destination", None, None)?;
    restore_document_folder(ctx, org, first.id, Some(alternative.id))?;
    reject(
        restore_document_folder(ctx, org, first.id, None),
        "stale restore must not become a move",
    )?;
    Ok(())
}

pub fn test_historical_document_version_retry(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let folder = create_folder(ctx, &fixture, "Version Retries", None, None)?;
    let doc = create_file(ctx, &fixture, "version-retry", Some(folder.id))?;
    let org = fixture.organization_id;
    let first = AddDocumentVersionParams {
        file_name: "revision-2.txt".into(),
        file_size: 20,
        mimetype: "text/plain".into(),
        url: "/api/documents/blobs/object/1/default/revision-2".into(),
        checksum: "b".repeat(64),
        changes_description: Some("Second revision".into()),
    };
    add_document_version(ctx, org, doc.id, first.clone())?;
    add_document_version(ctx, org, doc.id, first.clone())?;
    add_document_version(
        ctx,
        org,
        doc.id,
        AddDocumentVersionParams {
            file_name: "revision-3.txt".into(),
            file_size: 30,
            url: "/api/documents/blobs/object/1/default/revision-3".into(),
            checksum: "c".repeat(64),
            changes_description: Some("Third revision".into()),
            ..first.clone()
        },
    )?;
    let current = ctx
        .db
        .document()
        .id()
        .find(&doc.id)
        .ok_or("Current version missing")?;
    add_document_version(ctx, org, doc.id, first.clone())?;
    let recovered = ctx
        .db
        .document()
        .id()
        .find(&doc.id)
        .ok_or("Recovered version missing")?;
    if recovered.current_version_id != current.current_version_id
        || recovered.version_count != 3
        || ctx
            .db
            .document_version()
            .version_by_document()
            .filter(&doc.id)
            .count()
            != 3
    {
        return Err("Historical retry duplicated or replaced the current version".into());
    }
    ctx.db.document().id().update(Document {
        is_locked: true,
        locked_by: Some(Identity::from_byte_array([0xe4; 32])),
        locked_at: Some(ctx.timestamp),
        locked_until: Some(ctx.timestamp),
        ..recovered
    });
    add_document_version(ctx, org, doc.id, first.clone())?;
    if !ctx
        .db
        .document()
        .id()
        .find(&doc.id)
        .ok_or("Replayed version missing")?
        .is_locked
    {
        return Err("Exact historical retry mutated an expired lock".into());
    }
    reject(
        add_document_version(
            ctx,
            org,
            doc.id,
            AddDocumentVersionParams {
                file_size: 21,
                ..first.clone()
            },
        ),
        "same object with conflicting payload",
    )?;
    ctx.db.doc_folder().id().update(DocumentFolder {
        is_readonly: true,
        ..folder
    });
    reject(
        add_document_version(ctx, org, doc.id, first),
        "replay after folder write access revoked",
    )?;
    Ok(())
}

pub fn test_folder_trash_records_complete_evidence_outcome(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    let folder = create_folder(ctx, &fixture, "Evidence Folder", None, None)?;
    let doc = create_file(ctx, &fixture, "evidence-folder-document", Some(folder.id))?;
    let (version_id, _) = ingest_document_blob_content(
        ctx,
        org,
        company,
        doc.id,
        &doc.name,
        1,
        doc.url.as_deref().ok_or("Evidence file URL missing")?,
        doc.checksum.as_deref(),
        "Invoices above the limit require approval.",
        "inspected",
    )?;
    let source_key = format!("document:{}", doc.id);
    let passage = ctx
        .db
        .ai_evidence_passage()
        .ai_evidence_passage_by_source()
        .filter((&org, &company, &"document".to_string(), &source_key))
        .next()
        .ok_or("Document evidence passage missing")?;
    record_ai_evidence_claim(
        ctx,
        org,
        company,
        RecordAiEvidenceClaimParams {
            kind: "sourced_fact".into(),
            statement: "Invoices above the limit require approval.".into(),
            supporting_passage_ids: vec![passage.id],
            contradicting_passage_ids: vec![],
            calculation_ref: None,
            assumptions: vec![],
            contribution_id: None,
            verification_method: "deterministic".into(),
            verification_outcome: "supported".into(),
            verification_note: None,
            supersedes_claim_id: None,
        },
    )?;
    let claim = ctx
        .db
        .ai_evidence_claim()
        .ai_evidence_claim_by_org()
        .filter(&org)
        .max_by_key(|claim| claim.id)
        .ok_or("Document evidence claim missing")?;
    upsert_search_embedding(
        ctx,
        org,
        Some(company),
        UpsertSearchEmbeddingParams {
            content_type: "ai_evidence_passage".into(),
            content_id: passage.id,
            expected_fingerprint: passage.content_hash.clone(),
            index_generation: "folder-evidence-v1".into(),
            metadata: None,
        },
    )?;
    trash_document_folder(ctx, org, folder.id)?;
    if ctx
        .db
        .ai_evidence_source_version()
        .id()
        .find(&version_id)
        .ok_or("Retired version missing")?
        .status
        != "access_revoked"
        || ctx
            .db
            .ai_evidence_passage()
            .id()
            .find(&passage.id)
            .ok_or("Retired passage missing")?
            .text_state
            != "restricted"
        || ctx
            .db
            .ai_evidence_claim()
            .id()
            .find(&claim.id)
            .ok_or("Dependent claim missing")?
            .status
            != "needs_review"
    {
        return Err("Folder trash did not revoke evidence and its dependent claim".into());
    }
    let embedding = ctx
        .db
        .search_embedding()
        .embedding_by_content()
        .filter(&"ai_evidence_passage".to_string())
        .find(|row| {
            row.organization_id == org
                && row.company_id == Some(company)
                && row.content_id == passage.id
        })
        .ok_or("Retired embedding missing")?;
    if embedding.sync_status != "deleted" {
        return Err("Folder trash did not invalidate its semantic embedding".into());
    }
    let commit = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&org)
        .filter(|row| row.operation_id == "erp.trash_document_folder")
        .max_by_key(|row| row.sequence)
        .ok_or("Folder trash commit missing")?;
    let changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter((&org, &commit.sequence))
        .collect();
    for table in [
        "doc_folder",
        "ai_evidence_source_version",
        "ai_evidence_passage",
        "ai_evidence_source_change",
        "ai_evidence_dependency",
        "ai_evidence_claim",
        "search_embedding",
        "queue_job",
        "audit_log",
        "business_change",
    ] {
        if !changes.iter().any(|row| row.table_name == table) {
            return Err(format!("Folder trash commit omitted {table}"));
        }
    }
    if changes
        .iter()
        .any(|row| row.table_name == "ai_evidence_source")
    {
        return Err("Folder trash persisted an unchanged evidence source".into());
    }
    restore_document_folder(ctx, org, folder.id, None)?;
    if ctx
        .db
        .ai_evidence_source_version()
        .id()
        .find(&version_id)
        .ok_or("Restored source missing")?
        .status
        != "access_revoked"
    {
        return Err("Folder restore silently reactivated retired AI evidence".into());
    }
    Ok(())
}
