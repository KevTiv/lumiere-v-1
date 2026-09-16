//! AIH-13: source, passage, contribution — explicit params, no hidden defaults.

use spacetimedb::{ReducerContext, Table};

use crate::ai::provenance::{
    ai_contribution, ai_source_passage, ai_source_version, create_ai_contribution,
    create_ai_source_passage, create_ai_source_version, CreateAiContributionParams,
    CreateAiSourcePassageParams, CreateAiSourceVersionParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

/// AIH-13.1: book / paper / company_publication / erp_record round-trip
pub fn test_provenance_round_trip(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    // Every field is supplied explicitly via CreateAiSourceVersionParams — no
    // helper hides a `None` or `0`.
    create_ai_source_version(
        ctx,
        fixture.organization_id,
        CreateAiSourceVersionParams {
            company_id: None,
            kind: "book".to_string(),
            title: "AIH-13 Book".to_string(),
            authors_json: Some(r#"["Ada Lovelace"]"#.to_string()),
            publisher: Some("Lumiere Press".to_string()),
            publication_date: Some("2021-06-01".to_string()),
            edition: Some("2".to_string()),
            version_label: None,
            uri: None,
            doi: None,
            file_reference: None,
            content_hash: "hash-book-001".to_string(),
            snapshot_ref: None,
            retrieval_time: None,
            origin: "retrieved".to_string(),
            owner_identity: None,
            scope: "organization".to_string(),
            retention_policy: "retain".to_string(),
            inspection_state: "inspected".to_string(),
        },
    )?;

    create_ai_source_version(
        ctx,
        fixture.organization_id,
        CreateAiSourceVersionParams {
            company_id: None,
            kind: "paper".to_string(),
            title: "AIH-13 Paper".to_string(),
            authors_json: Some(r#"["Grace Hopper","Alan Turing"]"#.to_string()),
            publisher: None,
            publication_date: None,
            edition: None,
            version_label: None,
            uri: None,
            doi: Some("10.1234/ai.2026.001".to_string()),
            file_reference: None,
            content_hash: "hash-paper-001".to_string(),
            snapshot_ref: None,
            retrieval_time: None,
            origin: "authored".to_string(),
            owner_identity: None,
            scope: "organization".to_string(),
            retention_policy: "retain".to_string(),
            inspection_state: "inspected".to_string(),
        },
    )?;

    create_ai_source_version(
        ctx,
        fixture.organization_id,
        CreateAiSourceVersionParams {
            company_id: Some(fixture.company_id),
            kind: "company_publication".to_string(),
            title: "AIH-13 Company Practice".to_string(),
            authors_json: None,
            publisher: Some("Acme Corp".to_string()),
            publication_date: None,
            edition: None,
            version_label: None,
            uri: None,
            doi: None,
            file_reference: None,
            content_hash: "hash-company-001".to_string(),
            snapshot_ref: None,
            retrieval_time: None,
            origin: "authored".to_string(),
            owner_identity: None,
            scope: "company".to_string(),
            retention_policy: "retain".to_string(),
            inspection_state: "inspected".to_string(),
        },
    )?;

    create_ai_source_version(
        ctx,
        fixture.organization_id,
        CreateAiSourceVersionParams {
            company_id: None,
            kind: "erp_record".to_string(),
            title: "AIH-13 ERP Policy".to_string(),
            authors_json: None,
            publisher: None,
            publication_date: None,
            edition: None,
            version_label: None,
            uri: None,
            doi: None,
            file_reference: None,
            content_hash: "hash-erp-001".to_string(),
            snapshot_ref: None,
            retrieval_time: None,
            origin: "authored".to_string(),
            owner_identity: None,
            scope: "organization".to_string(),
            retention_policy: "retain".to_string(),
            inspection_state: "inspected".to_string(),
        },
    )?;

    let versions: Vec<_> = ctx
        .db
        .ai_source_version()
        .ai_source_version_by_org()
        .filter(&fixture.organization_id)
        .filter(|v| v.title.starts_with("AIH-13 "))
        .collect();
    if versions.len() != 4 {
        return Err(format!(
            "AIH-13.1 expected 4 sources, got {}",
            versions.len()
        ));
    }

    let book_id = versions
        .iter()
        .find(|v| v.title == "AIH-13 Book")
        .map(|v| v.id)
        .ok_or("book version not found")?;

    // Passage + contribution — every Option is an explicit caller-supplied value,
    // not a default hidden inside the reducer.
    create_ai_source_passage(
        ctx,
        fixture.organization_id,
        CreateAiSourcePassageParams {
            source_version_id: book_id,
            passage_kind: "text".to_string(),
            content: "Exact passage text from p. 42".to_string(),
            content_hash: "phash-book-42".to_string(),
            coordinates_json: Some(r#"{"page":42,"section":"3.2"}"#.to_string()),
            is_original: true,
            processor_ref: None,
            correction_ref: None,
        },
    )?;
    let passage_id = ctx
        .db
        .ai_source_passage()
        .ai_source_passage_by_version()
        .filter(&book_id)
        .map(|p| p.id)
        .next()
        .ok_or("book passage not found")?;

    create_ai_contribution(
        ctx,
        fixture.organization_id,
        CreateAiContributionParams {
            source_version_id: Some(book_id),
            passage_id: Some(passage_id),
            contributor_kind: "user".to_string(),
            session_ref: Some("session-ai13".to_string()),
            turn_ref: Some("turn-3".to_string()),
            event_ref: None,
            inspection_state: "inspected".to_string(),
        },
    )?;

    let passages: Vec<_> = ctx
        .db
        .ai_source_passage()
        .iter()
        .filter(|p| p.source_version_id == book_id)
        .collect();
    if passages.len() != 1 || passages[0].content != "Exact passage text from p. 42" {
        return Err("AIH-13.1 passage round-trip failed".to_string());
    }
    let contribs: Vec<_> = ctx
        .db
        .ai_contribution()
        .iter()
        .filter(|c| c.source_version_id == Some(book_id))
        .collect();
    if contribs.is_empty() {
        return Err("AIH-13.1 contribution not persisted".to_string());
    }
    Ok(())
}

/// AIH-13.2: unknown authors/pages remain unknown — caller passes `None` explicitly.
pub fn test_provenance_unknown_preservation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    create_ai_source_version(
        ctx,
        fixture.organization_id,
        CreateAiSourceVersionParams {
            company_id: None,
            kind: "book".to_string(),
            title: "AIH-13 Unknowns".to_string(),
            authors_json: None, // explicit unknown
            publisher: None,
            publication_date: None, // explicit unknown
            edition: None,
            version_label: None,
            uri: None,
            doi: None,
            file_reference: None,
            content_hash: "hash-unknown-001".to_string(),
            snapshot_ref: None,
            retrieval_time: None,
            origin: "authored".to_string(),
            owner_identity: None,
            scope: "organization".to_string(),
            retention_policy: "retain".to_string(),
            inspection_state: "inspected".to_string(),
        },
    )?;

    let row = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|v| v.title == "AIH-13 Unknowns")
        .ok_or("unknown source not found")?;
    if row.authors_json.is_some() {
        return Err("AIH-13.2 authors_json should remain None when unknown".to_string());
    }
    if row.publication_date.is_some() {
        return Err("AIH-13.2 publication_date should remain None when unknown".to_string());
    }

    create_ai_source_passage(
        ctx,
        fixture.organization_id,
        CreateAiSourcePassageParams {
            source_version_id: row.id,
            passage_kind: "record".to_string(),
            content: r#"{"field":"amount","value":100}"#.to_string(),
            content_hash: "phash-unknown-1".to_string(),
            coordinates_json: None, // explicit unknown
            is_original: true,
            processor_ref: None,
            correction_ref: None,
        },
    )?;
    let passage = ctx
        .db
        .ai_source_passage()
        .ai_source_passage_by_version()
        .filter(&row.id)
        .next()
        .ok_or("unknown passage not found")?;
    if passage.coordinates_json.is_some() {
        return Err("AIH-13.2 coordinates should remain None when unknown".to_string());
    }
    Ok(())
}

/// AIH-13.3: recalled sources remain unverified
pub fn test_provenance_recalled_stays_unverified(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    create_ai_source_version(
        ctx,
        fixture.organization_id,
        CreateAiSourceVersionParams {
            company_id: None,
            kind: "paper".to_string(),
            title: "AIH-13 Recalled".to_string(),
            authors_json: None,
            publisher: None,
            publication_date: None,
            edition: None,
            version_label: None,
            uri: None,
            doi: None,
            file_reference: None,
            content_hash: "hash-recalled-001".to_string(),
            snapshot_ref: None,
            retrieval_time: None,
            origin: "recalled".to_string(),
            owner_identity: None,
            scope: "organization".to_string(),
            retention_policy: "retain".to_string(),
            inspection_state: "unverified_recollection".to_string(),
        },
    )?;

    let row = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|v| v.title == "AIH-13 Recalled")
        .ok_or("recalled source not found")?;
    if row.inspection_state != "unverified_recollection" {
        return Err("AIH-13.3 recalled source should stay unverified_recollection".to_string());
    }
    if row.origin != "recalled" {
        return Err("AIH-13.3 origin should stay recalled".to_string());
    }

    create_ai_contribution(
        ctx,
        fixture.organization_id,
        CreateAiContributionParams {
            source_version_id: Some(row.id),
            passage_id: None,
            contributor_kind: "agent".to_string(),
            session_ref: Some("session-recall".to_string()),
            turn_ref: None,
            event_ref: None,
            inspection_state: "unverified_recollection".to_string(),
        },
    )?;
    let contrib = ctx
        .db
        .ai_contribution()
        .iter()
        .find(|c| c.source_version_id == Some(row.id))
        .ok_or("recalled contribution not found")?;
    if contrib.inspection_state != "unverified_recollection" {
        return Err("AIH-13.3 contribution should stay unverified_recollection".to_string());
    }
    Ok(())
}

/// AIH-13.4: cross-scope references are denied
pub fn test_provenance_cross_scope_denied(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;

    create_ai_source_version(
        ctx,
        foreign.organization_id,
        CreateAiSourceVersionParams {
            company_id: None,
            kind: "book".to_string(),
            title: "AIH-13 Foreign Book".to_string(),
            authors_json: None,
            publisher: None,
            publication_date: None,
            edition: None,
            version_label: None,
            uri: None,
            doi: None,
            file_reference: None,
            content_hash: "hash-foreign-001".to_string(),
            snapshot_ref: None,
            retrieval_time: None,
            origin: "authored".to_string(),
            owner_identity: None,
            scope: "organization".to_string(),
            retention_policy: "retain".to_string(),
            inspection_state: "inspected".to_string(),
        },
    )?;
    let foreign_id = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|v| v.title == "AIH-13 Foreign Book")
        .map(|v| v.id)
        .ok_or("foreign source not found")?;

    let cross = create_ai_source_passage(
        ctx,
        local.organization_id,
        CreateAiSourcePassageParams {
            source_version_id: foreign_id, // explicit foreign id — must be rejected
            passage_kind: "text".to_string(),
            content: "cross-org attempt".to_string(),
            content_hash: "phash-cross".to_string(),
            coordinates_json: None,
            is_original: true,
            processor_ref: None,
            correction_ref: None,
        },
    );
    match cross {
        Err(ref e) if e.contains("organization") => {}
        other => {
            return Err(format!(
                "AIH-13.4 cross-org passage: expected organization error, got {other:?}"
            ))
        }
    }

    let cross_contrib = create_ai_contribution(
        ctx,
        local.organization_id,
        CreateAiContributionParams {
            source_version_id: Some(foreign_id),
            passage_id: None,
            contributor_kind: "user".to_string(),
            session_ref: None,
            turn_ref: None,
            event_ref: None,
            inspection_state: "inspected".to_string(),
        },
    );
    match cross_contrib {
        Err(ref e) if e.contains("organization") => {}
        other => {
            return Err(format!(
                "AIH-13.4 cross-org contribution: expected organization error, got {other:?}"
            ))
        }
    }
    Ok(())
}

/// AIH-13.5: snapshots retain exact hashes — caller-supplied hash is preserved verbatim.
pub fn test_provenance_snapshot_identity(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    create_ai_source_version(
        ctx,
        fixture.organization_id,
        CreateAiSourceVersionParams {
            company_id: None,
            kind: "paper".to_string(),
            title: "AIH-13 Snapshot".to_string(),
            authors_json: None,
            publisher: None,
            publication_date: None,
            edition: None,
            version_label: None,
            uri: None,
            doi: None,
            file_reference: None,
            content_hash: "sha256:abc123deadbeef".to_string(), // explicit caller-supplied hash
            snapshot_ref: Some("s3://snapshots/ai13/snapshot.pdf".to_string()),
            retrieval_time: None,
            origin: "retrieved".to_string(),
            owner_identity: None,
            scope: "organization".to_string(),
            retention_policy: "retain".to_string(),
            inspection_state: "inspected".to_string(),
        },
    )?;

    let vid = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|v| v.title == "AIH-13 Snapshot")
        .map(|v| v.id)
        .ok_or("snapshot source not found")?;
    let stored = ctx
        .db
        .ai_source_version()
        .id()
        .find(&vid)
        .ok_or("snapshot source disappeared")?;
    if stored.content_hash != "sha256:abc123deadbeef" {
        return Err("AIH-13.5 content_hash not retained exactly".to_string());
    }

    create_ai_source_passage(
        ctx,
        fixture.organization_id,
        CreateAiSourcePassageParams {
            source_version_id: vid,
            passage_kind: "text".to_string(),
            content: "OCR text with minor errors".to_string(),
            content_hash: "phash-ocr-001".to_string(),
            coordinates_json: Some(r#"{"page":1}"#.to_string()),
            is_original: false,
            processor_ref: Some("ocr:tesseract:v5".to_string()),
            correction_ref: Some("corrected-by:kev".to_string()),
        },
    )?;
    let passage = ctx
        .db
        .ai_source_passage()
        .ai_source_passage_by_version()
        .filter(&vid)
        .next()
        .ok_or("ocr passage not found")?;
    if passage.content_hash != "phash-ocr-001" {
        return Err("AIH-13.5 passage content_hash not retained".to_string());
    }
    if passage.is_original {
        return Err("AIH-13.5 OCR passage should not be is_original".to_string());
    }
    if passage.processor_ref.as_deref() != Some("ocr:tesseract:v5") {
        return Err("AIH-13.5 processor_ref not retained".to_string());
    }
    Ok(())
}
