//! Reusable template lifecycle through the same reducers exposed to signed-in clients.

use spacetimedb::{ReducerContext, Table};

use crate::core::audit::audit_log;
use crate::core::permissions::{role, Role};
use crate::core::users::{
    find_user_profile_for_organization, user_organization, user_profile, UserProfile,
};
use crate::documents::invoice_profile::INVOICE_PROFILE_REPORT_TYPE;
use crate::documents::templates::{
    create_document_template, document_template, update_document_template,
    CreateDocumentTemplateParams, DocumentTemplate, UpdateDocumentTemplateParams,
};
use crate::helpers::check_permission;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn designer_metadata(text: &str) -> String {
    serde_json::json!({
        "documentDesigner": {
            "schemaVersion": 1, "engine": "grapesjs", "kind": "rich-text",
            "project": {"assets": [], "styles": [], "pages": [{"frames": [{"component": {
                "type": "wrapper", "tagName": "body", "components": [{
                    "tagName": "p", "components": [{"type": "textnode", "content": text}]
                }]
            }}]}]}
        },
        "other": "keep"
    })
    .to_string()
}

fn create_params(name: &str) -> CreateDocumentTemplateParams {
    CreateDocumentTemplateParams {
        name: name.to_string(),
        model: "document".to_string(),
        report_type: "lumiere-rich-text-template-v1".to_string(),
        body_html: "<p>Initial text</p>".to_string(),
        header_html: Some("<p>Header</p>".to_string()),
        footer_html: Some("<p>Footer</p>".to_string()),
        variable_bindings_json: Some("{}".to_string()),
        is_default: false,
        is_active: true,
        metadata: Some(designer_metadata("Initial text")),
    }
}

fn unchanged_params() -> UpdateDocumentTemplateParams {
    UpdateDocumentTemplateParams {
        name: None,
        report_type: None,
        body_html: None,
        header_html: None,
        footer_html: None,
        variable_bindings_json: None,
        is_default: None,
        is_active: None,
        metadata: None,
    }
}

fn read_template(ctx: &ReducerContext, template_id: u64) -> Result<DocumentTemplate, String> {
    ctx.db
        .document_template()
        .id()
        .find(&template_id)
        .ok_or_else(|| "template disappeared".to_string())
}

fn create_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    name: &str,
) -> Result<DocumentTemplate, String> {
    create_document_template(ctx, organization_id, company_id, create_params(name))?;
    ctx.db
        .document_template()
        .document_template_by_org()
        .filter(&organization_id)
        .find(|row| row.company_id == company_id && row.name == name)
        .ok_or_else(|| "created template missing from organization query".to_string())
}

fn template_state(row: &DocumentTemplate) -> serde_json::Value {
    serde_json::json!({
        "id": row.id, "organization_id": row.organization_id, "company_id": row.company_id,
        "name": row.name, "model": row.model, "report_type": row.report_type,
        "body_html": row.body_html, "header_html": row.header_html, "footer_html": row.footer_html,
        "variable_bindings_json": row.variable_bindings_json,
        "is_default": row.is_default, "is_active": row.is_active, "metadata": row.metadata,
    })
}

fn audit_ids(ctx: &ReducerContext, template_id: u64) -> Vec<u64> {
    ctx.db
        .audit_log()
        .iter()
        .filter(|row| row.table_name == "document_template" && row.record_id == template_id)
        .map(|row| row.id)
        .collect()
}

fn rejected(result: Result<(), String>, expected: &str) -> Result<(), String> {
    match result {
        Err(message) if message.contains(expected) => Ok(()),
        other => Err(format!(
            "expected {expected:?} rejection, received {other:?}"
        )),
    }
}

pub fn test_document_template_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = Some(fixture.company_id);
    let original = create_template(ctx, org, company, "Reusable text")?;
    let body = "<p>Edited text</p>".to_string();
    let metadata = designer_metadata("Edited text");
    update_document_template(
        ctx,
        org,
        company,
        original.id,
        UpdateDocumentTemplateParams {
            name: Some("  Welcome text  ".to_string()),
            body_html: Some(body.clone()),
            metadata: Some(metadata.clone()),
            ..unchanged_params()
        },
    )?;
    let edited = read_template(ctx, original.id)?;
    if edited.name != "Welcome text"
        || edited.body_html != body
        || edited.metadata.as_ref() != Some(&metadata)
    {
        return Err("template edit did not atomically preserve its name, body and metadata".into());
    }
    if edited.model != original.model
        || edited.create_uid != original.create_uid
        || edited.create_date != original.create_date
    {
        return Err("template edit changed immutable creation fields".into());
    }

    for is_active in [false, true] {
        update_document_template(
            ctx,
            org,
            company,
            original.id,
            UpdateDocumentTemplateParams {
                is_active: Some(is_active),
                ..unchanged_params()
            },
        )?;
        let current = read_template(ctx, original.id)?;
        let mut expected = template_state(&edited);
        expected["is_active"] = serde_json::json!(is_active);
        if template_state(&current) != expected {
            return Err("activation change altered template content or scope".into());
        }
        let audit = ctx
            .db
            .audit_log()
            .iter()
            .filter(|row| row.table_name == "document_template" && row.record_id == original.id)
            .max_by_key(|row| row.id)
            .ok_or("template lifecycle audit missing")?;
        if audit.changed_fields != vec!["is_active".to_string()] {
            return Err("activation audit did not identify the changed field".into());
        }
        let old: serde_json::Value = serde_json::from_str(
            audit
                .old_values
                .as_deref()
                .ok_or("activation audit missing old state")?,
        )
        .map_err(|error| error.to_string())?;
        let new: serde_json::Value = serde_json::from_str(
            audit
                .new_values
                .as_deref()
                .ok_or("activation audit missing new state")?,
        )
        .map_err(|error| error.to_string())?;
        if old["is_active"] != serde_json::json!(!is_active)
            || new["is_active"] != serde_json::json!(is_active)
        {
            return Err("activation audit did not retain before and after values".into());
        }
    }

    let audits_before = audit_ids(ctx, original.id);
    update_document_template(
        ctx,
        org,
        company,
        original.id,
        UpdateDocumentTemplateParams {
            name: Some(" Welcome text ".to_string()),
            body_html: Some(body),
            metadata: Some(metadata),
            is_active: Some(true),
            ..unchanged_params()
        },
    )?;
    if audit_ids(ctx, original.id) != audits_before {
        return Err("identical template update created a duplicate audit event".into());
    }

    // Nested options must retain their established explicit-clear behavior.
    update_document_template(
        ctx,
        org,
        company,
        original.id,
        UpdateDocumentTemplateParams {
            header_html: Some(None),
            footer_html: Some(None),
            variable_bindings_json: Some(None),
            ..unchanged_params()
        },
    )?;
    let cleared = read_template(ctx, original.id)?;
    if cleared.header_html.is_some()
        || cleared.footer_html.is_some()
        || cleared.variable_bindings_json.is_some()
        || cleared.metadata != edited.metadata
    {
        return Err("optional fields were not cleared independently from designer metadata".into());
    }

    let global = create_template(ctx, org, None, "Organization text")?;
    update_document_template(
        ctx,
        org,
        None,
        global.id,
        UpdateDocumentTemplateParams {
            is_active: Some(false),
            ..unchanged_params()
        },
    )?;
    if read_template(ctx, global.id)?.is_active {
        return Err("explicit organization-global update did not persist".into());
    }
    Ok(())
}

pub fn test_document_template_rejections(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = Some(fixture.company_id);
    let template = create_template(ctx, org, company, "Protected reusable text")?;
    let before = template_state(&template);
    let audits_before = audit_ids(ctx, template.id);

    rejected(
        create_document_template(
            ctx,
            org,
            Some(foreign.company_id),
            create_params("Foreign company"),
        ),
        "does not belong",
    )?;
    if ctx
        .db
        .document_template()
        .document_template_by_org()
        .filter(&org)
        .count()
        != 1
    {
        return Err("rejected foreign-company creation wrote a template".into());
    }
    rejected(
        update_document_template(
            ctx,
            foreign.organization_id,
            Some(foreign.company_id),
            template.id,
            unchanged_params(),
        ),
        "does not belong to this organization",
    )?;
    for wrong_company in [None, Some(foreign.company_id)] {
        rejected(
            update_document_template(ctx, org, wrong_company, template.id, unchanged_params()),
            "does not belong to this company scope",
        )?;
    }
    rejected(
        update_document_template(
            ctx,
            org,
            company,
            template.id,
            UpdateDocumentTemplateParams {
                name: Some(" \n ".to_string()),
                body_html: Some("<p>Must not persist</p>".to_string()),
                ..unchanged_params()
            },
        ),
        "name is required",
    )?;
    rejected(
        update_document_template(
            ctx,
            org,
            company,
            template.id,
            UpdateDocumentTemplateParams {
                body_html: Some(" \n ".to_string()),
                metadata: Some("must not persist".to_string()),
                ..unchanged_params()
            },
        ),
        "body_html is required",
    )?;
    rejected(
        update_document_template(
            ctx,
            org,
            company,
            template.id,
            UpdateDocumentTemplateParams {
                report_type: Some(INVOICE_PROFILE_REPORT_TYPE.to_string()),
                ..unchanged_params()
            },
        ),
        "invoice profile versions are immutable",
    )?;

    create_document_template(
        ctx,
        org,
        company,
        CreateDocumentTemplateParams {
            model: "account_move".to_string(),
            report_type: INVOICE_PROFILE_REPORT_TYPE.to_string(),
            is_default: true,
            metadata: Some(r#"{"invoiceProfile":{"schemaVersion":1,"values":{}}}"#.to_string()),
            ..create_params("Immutable invoice profile")
        },
    )?;
    let invoice_profile = ctx
        .db
        .document_template()
        .document_template_by_org()
        .filter(&org)
        .find(|row| row.report_type == INVOICE_PROFILE_REPORT_TYPE)
        .ok_or("invoice profile fixture missing")?;
    let profile_audits = audit_ids(ctx, invoice_profile.id);
    rejected(
        update_document_template(
            ctx,
            org,
            company,
            invoice_profile.id,
            UpdateDocumentTemplateParams {
                report_type: Some("lumiere-document-layout-v1".to_string()),
                is_active: Some(false),
                ..unchanged_params()
            },
        ),
        "invoice profile versions are immutable",
    )?;
    if template_state(&read_template(ctx, invoice_profile.id)?) != template_state(&invoice_profile)
        || audit_ids(ctx, invoice_profile.id) != profile_audits
    {
        return Err("invoice profile update changed an immutable publication".into());
    }

    // A user with read/create but no write cannot edit, deactivate, or replay a no-op.
    let profile =
        find_user_profile_for_organization(ctx, ctx.sender(), org).ok_or("test profile missing")?;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == org && row.is_active)
        .ok_or("test membership missing")?;
    let original_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("test role missing")?;
    let was_superuser = profile.is_superuser;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    ctx.db.role().id().update(Role {
        permissions: vec![
            "document_template:read".to_string(),
            "document_template:create".to_string(),
        ],
        ..original_role.clone()
    });
    let can_read = check_permission(ctx, org, "document_template", "read");
    let denied = [
        update_document_template(
            ctx,
            org,
            company,
            template.id,
            UpdateDocumentTemplateParams {
                name: Some("Denied edit".to_string()),
                ..unchanged_params()
            },
        ),
        update_document_template(
            ctx,
            org,
            company,
            template.id,
            UpdateDocumentTemplateParams {
                is_active: Some(false),
                ..unchanged_params()
            },
        ),
        update_document_template(ctx, org, company, template.id, unchanged_params()),
    ];
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), org)
        .ok_or("test profile disappeared")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: was_superuser,
        ..profile
    });
    ctx.db.role().id().update(original_role);
    can_read?;
    for result in denied {
        rejected(result, "Permission denied: write on document_template")?;
    }
    if template_state(&read_template(ctx, template.id)?) != before
        || audit_ids(ctx, template.id) != audits_before
    {
        return Err("rejected template mutations changed content or audit history".into());
    }
    Ok(())
}
