//! Country pack activation smoke test (A11).
use spacetimedb::{ReducerContext, Table};

use crate::core::audit::audit_log;
use crate::core::country_pack::{
    company_country_pack, country_pack_definition, country_pack_tax_rule, set_company_country_pack,
    CompanyCountryPack, CountryPackDefinition, SetCompanyCountryPackParams,
};
use crate::core::migrations::apply_pending_global_migrations;
use crate::core::persistence::{
    organization_commit, organization_commit_cursor, organization_row_change,
};
use crate::documents::documents::{
    add_document_version, create_document, create_document_folder, delete_document, doc_folder,
    document, document_version, restore_document, AddDocumentVersionParams,
    CreateDocumentFolderParams, CreateDocumentParams, Document,
};
use crate::documents::pack_locale::{
    document_residency_region_for_company, document_search_analyzer_for_company,
    document_search_language_for_company, fiscal_archive_kinds_for_company,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_country_pack_activation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    apply_pending_global_migrations(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    let za = ctx
        .db
        .country_pack_definition()
        .country_pack_by_pack_key()
        .filter((&fixture.organization_id, &"za".to_string()))
        .next()
        .ok_or("ZA pack definition missing")?;

    if !za.is_active {
        return Err("ZA pack should be active".to_string());
    }

    let tax_rules = ctx
        .db
        .country_pack_tax_rule()
        .pack_tax_by_pack()
        .filter((&fixture.organization_id, &"za".to_string()))
        .count();
    if tax_rules == 0 {
        return Err("ZA pack tax rules missing".to_string());
    }

    set_company_country_pack(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        SetCompanyCountryPackParams {
            pack_key: "za".to_string(),
            enabled: true,
            configuration: Some(r#"{"pilot":true}"#.to_string()),
        },
    )?;

    let activated = ctx
        .db
        .company_country_pack()
        .company_country_pack_by_company()
        .filter(&fixture.company_id)
        .find(|p| p.pack_key == "za" && p.enabled)
        .ok_or("Company country pack not activated")?;

    if activated.organization_id != fixture.organization_id {
        return Err("Country pack org scope mismatch".to_string());
    }

    Ok(())
}

const DOCUMENT_PACK_KEY: &str = "document-locale-fixture";
const DOCUMENT_PACK_METADATA: &str = r#"{
    "document_search_language":"en",
    "document_search_analyzer":"english",
    "document_residency_region":"fixture-region",
    "fiscal_archive_kinds":["tax_invoice_pdf"]
}"#;

fn document_pack_definition(organization_id: u64, metadata: &str) -> CountryPackDefinition {
    CountryPackDefinition {
        organization_pack_key: format!("{organization_id}:{DOCUMENT_PACK_KEY}"),
        organization_id,
        pack_key: DOCUMENT_PACK_KEY.into(),
        country_code: "AU".into(),
        name: "Document locale test pack".into(),
        region: "test".into(),
        version: "1.0.0".into(),
        acceptance_status: "accepted".into(),
        effective_from: None,
        effective_to: None,
        is_active: true,
        metadata: Some(metadata.into()),
    }
}

fn document_archive_params(name: &str, fiscal_kind: Option<&str>) -> CreateDocumentParams {
    CreateDocumentParams {
        name: name.into(),
        description: None,
        file_name: format!("{name}.pdf"),
        file_size: 32,
        mimetype: "application/pdf".into(),
        url: format!("/api/documents/blobs/object/1/pack-fixture/{name}"),
        checksum: "c".repeat(64),
        folder_id: None,
        res_model: None,
        res_id: None,
        partner_id: None,
        tag_ids: vec![],
        is_favorite: false,
        classification_id: None,
        retention_days: None,
        fiscal_kind: fiscal_kind.map(str::to_string),
        residency_region: None,
        metadata: None,
    }
}

/// Compare complete rows so a rejected registration cannot hide a partial version,
/// folder counter update, changed existing document, or audit write.
fn document_archive_snapshot(ctx: &ReducerContext, organization_id: u64) -> Result<String, String> {
    let mut tables = serde_json::Map::new();
    macro_rules! capture {
        ($accessor:ident) => {{
            let mut rows = ctx
                .db
                .$accessor()
                .iter()
                .filter(|row| row.organization_id == organization_id)
                .map(|row| {
                    serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(&row))
                        .map_err(|error| {
                            format!("cannot snapshot {}: {error}", stringify!($accessor))
                        })
                })
                .collect::<Result<Vec<_>, String>>()?;
            rows.sort_by_key(serde_json::Value::to_string);
            tables.insert(stringify!($accessor).into(), serde_json::Value::Array(rows));
        }};
    }
    capture!(document);
    capture!(document_version);
    capture!(doc_folder);
    capture!(audit_log);
    capture!(organization_commit);
    capture!(organization_commit_cursor);
    capture!(organization_row_change);
    Ok(serde_json::Value::Object(tables).to_string())
}

fn assert_archive_rejected_without_writes(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
    kind: &str,
    expected_error: &str,
) -> Result<(), String> {
    let before = document_archive_snapshot(ctx, fixture.organization_id)?;
    let error = create_document(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        document_archive_params(name, Some(kind)),
    )
    .err()
    .ok_or_else(|| format!("{name}: fiscal archive unexpectedly succeeded"))?;
    if !error.contains(expected_error) {
        return Err(format!(
            "{name}: expected {expected_error:?}, got {error:?}"
        ));
    }
    if document_archive_snapshot(ctx, fixture.organization_id)? != before {
        return Err(format!(
            "{name}: rejected fiscal archive changed document or audit rows"
        ));
    }
    Ok(())
}

/// Simulate stored activations becoming stale or ineligible after activation.
/// Each fiscal reducer rejection must be explicit and occur before any writes.
pub fn test_document_pack_lookup_requires_accepted_effective_pin(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let definition_key = format!("{org}:{DOCUMENT_PACK_KEY}");
    ctx.db
        .country_pack_definition()
        .insert(document_pack_definition(org, DOCUMENT_PACK_METADATA));
    ctx.db.company_country_pack().insert(CompanyCountryPack {
        id: 0,
        organization_id: org,
        company_id: fixture.company_id,
        pack_key: DOCUMENT_PACK_KEY.into(),
        pinned_pack_version: "1.0.0".into(),
        enabled: true,
        configuration: None,
        activated_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
    });

    if document_search_language_for_company(ctx, org, Some(fixture.company_id)).as_deref()
        != Some("en")
        || document_search_analyzer_for_company(ctx, org, Some(fixture.company_id)).as_deref()
            != Some("english")
        || document_residency_region_for_company(ctx, org, Some(fixture.company_id)).as_deref()
            != Some("fixture-region")
    {
        return Err("accepted document pack defaults did not resolve".into());
    }

    for state in [
        "stale",
        "inactive",
        "review-required",
        "draft",
        "future",
        "expired",
    ] {
        let mut definition = document_pack_definition(org, DOCUMENT_PACK_METADATA);
        match state {
            "stale" => definition.version = "2.0.0".into(),
            "inactive" => definition.is_active = false,
            "review-required" => definition.acceptance_status = "review_required".into(),
            "draft" => definition.acceptance_status = "draft".into(),
            "future" => {
                definition.effective_from = Some(ctx.timestamp + std::time::Duration::from_secs(1));
            }
            "expired" => definition.effective_to = Some(ctx.timestamp),
            _ => return Err("unknown document pack test state".into()),
        }
        ctx.db
            .country_pack_definition()
            .organization_pack_key()
            .update(definition);
        if document_search_language_for_company(ctx, org, Some(fixture.company_id)).is_some()
            || document_search_analyzer_for_company(ctx, org, Some(fixture.company_id)).is_some()
            || document_residency_region_for_company(ctx, org, Some(fixture.company_id)).is_some()
        {
            return Err(format!(
                "{state}: document defaults adopted an invalid definition"
            ));
        }
        let expected_error = if state == "stale" {
            "pin mismatch"
        } else {
            "not accepted and effective"
        };
        assert_archive_rejected_without_writes(
            ctx,
            &fixture,
            state,
            "tax_invoice_pdf",
            expected_error,
        )?;
    }

    ctx.db
        .country_pack_definition()
        .organization_pack_key()
        .delete(&definition_key);
    assert_archive_rejected_without_writes(
        ctx,
        &fixture,
        "missing",
        "tax_invoice_pdf",
        "definition is missing",
    )?;
    ctx.db
        .country_pack_definition()
        .insert(document_pack_definition(
            foreign.organization_id,
            DOCUMENT_PACK_METADATA,
        ));
    if document_search_language_for_company(ctx, org, Some(fixture.company_id)).is_some() {
        return Err("document locale leaked a foreign organization definition".into());
    }
    assert_archive_rejected_without_writes(
        ctx,
        &fixture,
        "foreign-definition",
        "tax_invoice_pdf",
        "definition is missing",
    )?;

    // Another valid pack declaring the kind cannot mask the broken enabled pin.
    let mut valid = document_pack_definition(org, DOCUMENT_PACK_METADATA);
    valid.pack_key = "document-valid-fixture".into();
    valid.organization_pack_key = format!("{org}:document-valid-fixture");
    ctx.db.country_pack_definition().insert(valid);
    set_company_country_pack(
        ctx,
        org,
        fixture.company_id,
        SetCompanyCountryPackParams {
            pack_key: "document-valid-fixture".into(),
            enabled: true,
            configuration: None,
        },
    )?;
    assert_archive_rejected_without_writes(
        ctx,
        &fixture,
        "valid-pack-cannot-mask-missing",
        "tax_invoice_pdf",
        "definition is missing",
    )?;
    Ok(())
}

pub fn test_document_fiscal_archive_requires_declared_kind(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    create_document(
        ctx,
        org,
        Some(fixture.company_id),
        document_archive_params("ordinary-no-pack", None),
    )?;
    let ordinary = ctx
        .db
        .document()
        .iter()
        .find(|row| row.organization_id == org && row.name == "ordinary-no-pack")
        .ok_or("ordinary document without a country pack was not created")?;
    if ordinary.index_language.is_some() || ordinary.residency_region.is_some() {
        return Err("ordinary no-pack document invented locale metadata".into());
    }
    assert_archive_rejected_without_writes(
        ctx,
        &fixture,
        "archive-no-pack",
        "tax_invoice_pdf",
        "not declared",
    )?;
    ctx.db
        .country_pack_definition()
        .insert(document_pack_definition(
            org,
            r#"{"document_search_language":"en"}"#,
        ));
    set_company_country_pack(
        ctx,
        org,
        fixture.company_id,
        SetCompanyCountryPackParams {
            pack_key: DOCUMENT_PACK_KEY.into(),
            enabled: true,
            configuration: None,
        },
    )?;
    for metadata in [
        r#"{"document_search_language":"en"}"#,
        r#"{"fiscal_archive_kinds":[]}"#,
        r#"{"fiscal_archive_kinds":"tax_invoice_pdf"}"#,
        "invalid-json",
    ] {
        ctx.db
            .country_pack_definition()
            .organization_pack_key()
            .update(document_pack_definition(org, metadata));
        assert_archive_rejected_without_writes(
            ctx,
            &fixture,
            "archive-empty-declaration",
            "tax_invoice_pdf",
            "not declared",
        )?;
    }
    ctx.db
        .country_pack_definition()
        .organization_pack_key()
        .update(document_pack_definition(org, DOCUMENT_PACK_METADATA));
    create_document(
        ctx,
        org,
        Some(fixture.company_id),
        document_archive_params("accepted-tax-invoice", Some("tax_invoice_pdf")),
    )?;
    let accepted = ctx
        .db
        .document()
        .iter()
        .find(|row| row.organization_id == org && row.name == "accepted-tax-invoice")
        .ok_or("declared fiscal archive was not created")?;
    if accepted.index_language.as_deref() != Some("en")
        || accepted.residency_region.as_deref() != Some("fixture-region")
        || accepted.current_version_id.is_none()
    {
        return Err("declared fiscal archive lost locale defaults or initial version".into());
    }

    // Declaring a draft fiscal kind does not invent an official MIME contract.
    ctx.db
        .country_pack_definition()
        .organization_pack_key()
        .update(document_pack_definition(
            org,
            r#"{"fiscal_archive_kinds":["ebm_invoice","vat_return"]}"#,
        ));
    for kind in ["ebm_invoice", "vat_return"] {
        assert_archive_rejected_without_writes(ctx, &fixture, kind, kind, "unknown fiscal_kind")?;
    }
    if fiscal_archive_kinds_for_company(ctx, org, None)? != Vec::<String>::new() {
        return Err("company-less lookup adopted a company pack".into());
    }
    Ok(())
}

fn archive_version_params(name: &str, mimetype: &str) -> AddDocumentVersionParams {
    AddDocumentVersionParams {
        file_name: format!("{name}.blob"),
        file_size: 48,
        mimetype: mimetype.into(),
        url: format!("/api/documents/blobs/object/1/pack-fixture/{name}"),
        checksum: "d".repeat(64),
        changes_description: Some("Country pack version validation fixture".into()),
    }
}

pub fn test_fiscal_document_versions_revalidate_pack_and_mime(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    ctx.db
        .country_pack_definition()
        .insert(document_pack_definition(org, DOCUMENT_PACK_METADATA));
    set_company_country_pack(
        ctx,
        org,
        fixture.company_id,
        SetCompanyCountryPackParams {
            pack_key: DOCUMENT_PACK_KEY.into(),
            enabled: true,
            configuration: None,
        },
    )?;
    create_document(
        ctx,
        org,
        Some(fixture.company_id),
        document_archive_params("versioned-fiscal-invoice", Some("tax_invoice_pdf")),
    )?;
    let fiscal = ctx
        .db
        .document()
        .iter()
        .find(|row| row.organization_id == org && row.name == "versioned-fiscal-invoice")
        .ok_or("fiscal version test document missing")?;
    let document_id = fiscal.id;
    // This expired lock would be cleared by refresh_expired_lock. A rejected
    // archive revision must leave even those lock fields untouched.
    ctx.db.document().id().update(Document {
        is_locked: true,
        locked_by: Some(ctx.sender()),
        locked_at: Some(ctx.timestamp),
        locked_until: Some(ctx.timestamp),
        ..fiscal
    });

    for state in ["mime", "stale", "inactive", "review-required", "expired"] {
        let mut definition = document_pack_definition(org, DOCUMENT_PACK_METADATA);
        let (mimetype, expected_error) = match state {
            "mime" => ("application/xml", "requires MIME"),
            "stale" => {
                definition.version = "2.0.0".into();
                ("application/pdf", "pin mismatch")
            }
            "inactive" => {
                definition.is_active = false;
                ("application/pdf", "not accepted and effective")
            }
            "review-required" => {
                definition.acceptance_status = "review_required".into();
                ("application/pdf", "not accepted and effective")
            }
            "expired" => {
                definition.effective_to = Some(ctx.timestamp);
                ("application/pdf", "not accepted and effective")
            }
            _ => return Err("unknown fiscal version fixture state".into()),
        };
        ctx.db
            .country_pack_definition()
            .organization_pack_key()
            .update(definition);
        let before = document_archive_snapshot(ctx, org)?;
        let error = add_document_version(
            ctx,
            org,
            document_id,
            archive_version_params(state, mimetype),
        )
        .err()
        .ok_or_else(|| format!("{state}: invalid fiscal revision succeeded"))?;
        if !error.contains(expected_error) {
            return Err(format!(
                "{state}: unexpected fiscal revision error: {error}"
            ));
        }
        if document_archive_snapshot(ctx, org)? != before {
            return Err(format!(
                "{state}: rejected fiscal revision changed document, version, lock, audit or commit state"
            ));
        }
    }

    // Fiscal status is absent here: ordinary versioning stays available even
    // while the company's enabled pack is ineffective.
    create_document(
        ctx,
        org,
        Some(fixture.company_id),
        document_archive_params("ordinary-version-invoice", None),
    )?;
    let ordinary_id = ctx
        .db
        .document()
        .iter()
        .find(|row| row.organization_id == org && row.name == "ordinary-version-invoice")
        .map(|row| row.id)
        .ok_or("ordinary version fixture document missing")?;
    add_document_version(
        ctx,
        org,
        ordinary_id,
        archive_version_params("ordinary-xml-version", "application/xml"),
    )?;

    ctx.db
        .country_pack_definition()
        .organization_pack_key()
        .update(document_pack_definition(org, DOCUMENT_PACK_METADATA));
    add_document_version(
        ctx,
        org,
        document_id,
        archive_version_params("accepted-fiscal-version", "application/pdf"),
    )?;
    let final_fiscal = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("versioned fiscal document disappeared")?;
    if final_fiscal.version_count != 2
        || final_fiscal.mimetype != "application/pdf"
        || final_fiscal.is_locked
    {
        return Err("accepted fiscal revision did not create exactly one PDF version".into());
    }
    Ok(())
}

pub fn test_fiscal_document_restore_revalidates_pack_without_writes(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    ctx.db
        .country_pack_definition()
        .insert(document_pack_definition(org, DOCUMENT_PACK_METADATA));
    set_company_country_pack(
        ctx,
        org,
        fixture.company_id,
        SetCompanyCountryPackParams {
            pack_key: DOCUMENT_PACK_KEY.into(),
            enabled: true,
            configuration: None,
        },
    )?;
    create_document_folder(
        ctx,
        org,
        Some(fixture.company_id),
        CreateDocumentFolderParams {
            name: "Fiscal restore fixture".into(),
            description: None,
            parent_id: None,
            is_access_restricted: false,
            is_hidden: false,
            is_readonly: false,
            is_favorite: false,
            sequence: 1,
            storage_id: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let folder_id = ctx
        .db
        .doc_folder()
        .iter()
        .find(|row| row.organization_id == org && row.name == "Fiscal restore fixture")
        .map(|row| row.id)
        .ok_or("fiscal restore folder missing")?;
    for (name, kind) in [
        ("restore-fiscal", Some("tax_invoice_pdf")),
        ("restore-ordinary", None),
    ] {
        let mut params = document_archive_params(name, kind);
        params.folder_id = Some(folder_id);
        create_document(ctx, org, Some(fixture.company_id), params)?;
    }
    let find_document_id = |name: &str| {
        ctx.db
            .document()
            .iter()
            .find(|row| row.organization_id == org && row.name == name)
            .map(|row| row.id)
            .ok_or_else(|| format!("{name} fixture missing"))
    };
    let fiscal_id = find_document_id("restore-fiscal")?;
    let ordinary_id = find_document_id("restore-ordinary")?;
    delete_document(ctx, org, fiscal_id)?;
    delete_document(ctx, org, ordinary_id)?;

    for state in ["mime", "stale", "review-required", "expired"] {
        let mut definition = document_pack_definition(org, DOCUMENT_PACK_METADATA);
        let expected_error = match state {
            "mime" => "requires MIME",
            "stale" => {
                definition.version = "2.0.0".into();
                "pin mismatch"
            }
            "review-required" => {
                definition.acceptance_status = "review_required".into();
                "not accepted and effective"
            }
            "expired" => {
                definition.effective_to = Some(ctx.timestamp);
                "not accepted and effective"
            }
            _ => return Err("unknown fiscal restore fixture state".into()),
        };
        ctx.db
            .country_pack_definition()
            .organization_pack_key()
            .update(definition);
        let fiscal = ctx
            .db
            .document()
            .id()
            .find(&fiscal_id)
            .ok_or("fiscal restore document disappeared")?;
        ctx.db.document().id().update(Document {
            mimetype: if state == "mime" {
                "application/xml"
            } else {
                "application/pdf"
            }
            .into(),
            ..fiscal
        });
        let before = document_archive_snapshot(ctx, org)?;
        let error = restore_document(ctx, org, fiscal_id)
            .err()
            .ok_or_else(|| format!("{state}: invalid fiscal archive restoration succeeded"))?;
        if !error.contains(expected_error) {
            return Err(format!("{state}: unexpected fiscal restore error: {error}"));
        }
        if document_archive_snapshot(ctx, org)? != before {
            return Err(format!("{state}: denied restoration changed document, version, folder counter, audit or commit rows"));
        }
    }
    // Ordinary restoration remains available while the enabled pack is expired.
    restore_document(ctx, org, ordinary_id)?;
    ctx.db
        .country_pack_definition()
        .organization_pack_key()
        .update(document_pack_definition(org, DOCUMENT_PACK_METADATA));
    restore_document(ctx, org, fiscal_id)?;
    let folder = ctx
        .db
        .doc_folder()
        .id()
        .find(&folder_id)
        .ok_or("restore folder disappeared")?;
    let fiscal = ctx
        .db
        .document()
        .id()
        .find(&fiscal_id)
        .ok_or("restored fiscal document disappeared")?;
    if folder.document_count != 2 || fiscal.is_deleted || fiscal.deleted_at.is_some() {
        return Err("accepted restore did not reactivate exactly one fiscal archive".into());
    }
    Ok(())
}
