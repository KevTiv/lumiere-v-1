//! Persistence and isolation proof for presentation-module draft versions.

use serde_json::json;
use sha2::{Digest, Sha256};
use spacetimedb::{Identity, ReducerContext, Table};

use crate::core::audit::audit_log;
use crate::core::persistence::{
    organization_commit, organization_commit_cursor, organization_row_change,
};
use crate::core::users::remove_user_from_organization;
use crate::presentation::{
    presentation_module, presentation_module_version, save_presentation_module, PresentationModule,
};
use crate::test_harness::OrgFixture;
use lumiere_presentation_core::prepare_saved_draft;

fn definition(module_id: &str, title: &str, base_revision: Option<u64>) -> String {
    json!({
        "schemaVersion": 1,
        "moduleId": module_id,
        "title": title,
        "baseRevision": base_revision.map(|revision| revision.to_string()),
        "applicationContract": "v0.3.40",
        "componentCatalogVersion": 1,
        "pages": [{
            "id": "overview",
            "title": "Overview",
            "nodes": [{
                "kind": "collection",
                "id": "entries",
                "slot": "primary",
                "component": {"id": "erp.collection", "version": 1},
                "resource": "account-moves",
                "fields": ["name"],
                "pageSize": 10
            }]
        }]
    })
    .to_string()
}

pub fn test_presentation_module_revision_round_trip(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let first_input = definition("collections", "Collections", None);
    let prepared = prepare_saved_draft(&first_input, None)?;
    save_presentation_module(ctx, fixture.organization_id, None, first_input)?;

    let head = ctx
        .db
        .presentation_module()
        .iter()
        .find(|module| module.organization_id == fixture.organization_id)
        .ok_or("presentation module head was not persisted")?;
    if head.current_revision != 1 {
        return Err(format!(
            "expected revision 1, got {}",
            head.current_revision
        ));
    }
    let first = ctx
        .db
        .presentation_module_version()
        .iter()
        .find(|version| version.module_id == head.id && version.revision == 1)
        .ok_or("revision 1 snapshot was not persisted")?;
    if first.definition_json != prepared.definition_json
        || first.schema_version != prepared.schema_version
        || first.application_contract != prepared.application_contract
        || first.component_catalog_version != prepared.component_catalog_version
    {
        return Err("stored snapshot does not match canonical prepared definition".into());
    }
    let expected_hash = hex::encode(Sha256::digest(first.definition_json.as_bytes()));
    if first.definition_hash != expected_hash {
        return Err("stored snapshot hash does not match canonical definition".into());
    }
    let first_snapshot = first.definition_json.clone();
    let first_version_id = first.id;

    let first_commit = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&fixture.organization_id)
        .max_by_key(|commit| commit.sequence)
        .ok_or("successful save commit missing")?;
    if first_commit.operation_id != "erp.save_presentation_module" {
        return Err("successful save has the wrong commit operation".into());
    }
    let first_changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_organization()
        .filter(&fixture.organization_id)
        .filter(|change| change.commit_sequence == first_commit.sequence)
        .collect();
    if first_changes.len() != 3
        || !first_changes
            .iter()
            .any(|change| change.table_name == "audit_log")
        || !first_changes
            .iter()
            .any(|change| change.table_name == "presentation_module")
        || !first_changes
            .iter()
            .any(|change| change.table_name == "presentation_module_version")
    {
        return Err("successful save commit does not contain head and version changes".into());
    }
    let audit = ctx
        .db
        .audit_log()
        .iter()
        .find(|entry| {
            entry.organization_id == fixture.organization_id
                && entry.table_name == "presentation_module_version"
                && entry.record_id == first_version_id
        })
        .ok_or("successful save audit row missing")?;
    if audit.action != "CREATE" || !audit.changed_fields.iter().any(|field| field == "revision") {
        return Err("successful save audit row is incomplete".into());
    }

    save_presentation_module(
        ctx,
        fixture.organization_id,
        Some(1),
        definition("collections", "Renamed", Some(1)),
    )?;
    let updated_head = ctx
        .db
        .presentation_module()
        .iter()
        .find(|module| module.id == head.id)
        .ok_or("updated presentation module head missing")?;
    if updated_head.current_revision != 2 {
        return Err(format!(
            "expected revision 2, got {}",
            updated_head.current_revision
        ));
    }
    let unchanged = ctx
        .db
        .presentation_module_version()
        .iter()
        .find(|version| version.module_id == head.id && version.revision == 1)
        .ok_or("revision 1 snapshot disappeared")?;
    if unchanged.definition_json != first_snapshot {
        return Err("revision 1 snapshot changed after revision 2 save".into());
    }

    let before_versions = ctx.db.presentation_module_version().iter().count();
    let before_commits = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&fixture.organization_id)
        .count();
    let before_cursor = ctx
        .db
        .organization_commit_cursor()
        .organization_id()
        .find(&fixture.organization_id)
        .map(|cursor| cursor.next_sequence);
    let stale = match save_presentation_module(
        ctx,
        fixture.organization_id,
        Some(1),
        definition("collections", "Stale", Some(1)),
    ) {
        Ok(()) => return Err("stale expected revision must be rejected".into()),
        Err(error) => error,
    };
    if !stale.contains("stale") {
        return Err(format!("unexpected stale revision error: {stale}"));
    }
    if ctx.db.presentation_module_version().iter().count() != before_versions {
        return Err("stale save created a presentation version".into());
    }
    if ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&fixture.organization_id)
        .count()
        != before_commits
    {
        return Err("stale save created an organization commit".into());
    }
    if ctx
        .db
        .organization_commit_cursor()
        .organization_id()
        .find(&fixture.organization_id)
        .map(|cursor| cursor.next_sequence)
        != before_cursor
    {
        return Err("stale save advanced the organization commit cursor".into());
    }
    Ok(())
}

pub fn test_presentation_module_rejects_invalid_payload(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let before_commits = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&fixture.organization_id)
        .count();
    let before_cursor = ctx
        .db
        .organization_commit_cursor()
        .organization_id()
        .find(&fixture.organization_id)
        .map(|cursor| cursor.next_sequence);
    let error =
        match save_presentation_module(ctx, fixture.organization_id, None, "{not-json".to_string())
        {
            Ok(()) => return Err("malformed presentation payload must be rejected".into()),
            Err(error) => error,
        };
    if !error.contains("invalid module definition") {
        return Err(format!("unexpected malformed payload error: {error}"));
    }
    if ctx
        .db
        .presentation_module()
        .iter()
        .any(|module| module.organization_id == fixture.organization_id)
    {
        return Err("invalid payload created a presentation module head".into());
    }
    if ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&fixture.organization_id)
        .count()
        != before_commits
        || ctx
            .db
            .organization_commit_cursor()
            .organization_id()
            .find(&fixture.organization_id)
            .map(|cursor| cursor.next_sequence)
            != before_cursor
    {
        return Err("invalid payload changed organization commit state".into());
    }
    Ok(())
}

pub fn test_presentation_module_owner_scope_isolated(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign_owner = Identity::from_byte_array([9; 32]);
    ctx.db.presentation_module().insert(PresentationModule {
        scope_key: format!(
            "{}:{}:collections",
            fixture.organization_id,
            foreign_owner.to_hex()
        ),
        id: 0,
        organization_id: fixture.organization_id,
        owner_identity: foreign_owner,
        module_key: "collections".into(),
        current_revision: 4,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    save_presentation_module(
        ctx,
        fixture.organization_id,
        None,
        definition("collections", "Owner copy", None),
    )?;
    let heads: Vec<_> = ctx
        .db
        .presentation_module()
        .iter()
        .filter(|module| {
            module.organization_id == fixture.organization_id && module.module_key == "collections"
        })
        .collect();
    if heads.len() != 2
        || !heads
            .iter()
            .any(|module| module.owner_identity == foreign_owner)
    {
        return Err("module heads were not isolated by owner identity".into());
    }
    if heads
        .iter()
        .find(|module| module.owner_identity == foreign_owner)
        .map(|module| module.current_revision)
        != Some(4)
    {
        return Err("foreign owner head was modified".into());
    }
    Ok(())
}

pub fn test_presentation_module_rejects_inactive_cross_org_actor(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let owner = OrgFixture::seed_minimal(ctx)?;
    let other = OrgFixture::seed_minimal(ctx)?;
    remove_user_from_organization(ctx, ctx.sender(), other.organization_id)?;

    let before = ctx.db.presentation_module().iter().count();
    let before_commits = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&other.organization_id)
        .count();
    let before_cursor = ctx
        .db
        .organization_commit_cursor()
        .organization_id()
        .find(&other.organization_id)
        .map(|cursor| cursor.next_sequence);
    let error = match save_presentation_module(
        ctx,
        other.organization_id,
        None,
        definition("cross-org", "Denied", None),
    ) {
        Ok(()) => return Err("inactive cross-organization actor must be rejected".into()),
        Err(error) => error,
    };
    if !error.contains("Not a member") {
        return Err(format!("unexpected cross-org denial: {error}"));
    }
    if ctx.db.presentation_module().iter().count() != before {
        return Err("cross-org denial created a presentation module".into());
    }
    if ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&other.organization_id)
        .count()
        != before_commits
        || ctx
            .db
            .organization_commit_cursor()
            .organization_id()
            .find(&other.organization_id)
            .map(|cursor| cursor.next_sequence)
            != before_cursor
    {
        return Err("cross-org denial changed organization commit state".into());
    }
    if ctx
        .db
        .presentation_module()
        .iter()
        .any(|module| module.organization_id == owner.organization_id)
    {
        return Err("cross-org denial altered the owner organization".into());
    }
    Ok(())
}
