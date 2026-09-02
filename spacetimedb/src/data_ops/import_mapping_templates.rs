/// Import Mapping Templates — saved column maps for AI-assisted CSV imports.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::data_ops::import_tracker::{import_job, ImportJob};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = import_mapping_template,
    public,
    index(
        accessor = import_template_by_org_table,
        btree(columns = [organization_id, table_name])
    )
)]
pub struct ImportMappingTemplate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub organization_id: u64,
    /// Target entity / import job table name (e.g. "contact", "sale_order").
    pub table_name: String,
    pub name: String,
    /// JSON object: source CSV header -> ERP field name.
    pub mapping_json: String,
    pub use_count: u32,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct SaveImportMappingTemplateParams {
    pub name: String,
    pub table_name: String,
    pub mapping_json: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct FinalizeImportAssistantJobParams {
    pub metadata_json: String,
    pub template_id: Option<u64>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn save_import_mapping_template(
    ctx: &ReducerContext,
    organization_id: u64,
    template_id: Option<u64>,
    params: SaveImportMappingTemplateParams,
) -> Result<(), String> {
    if params.name.trim().is_empty() {
        return Err("Template name cannot be empty".to_string());
    }
    if params.table_name.trim().is_empty() {
        return Err("table_name is required".to_string());
    }
    if params.mapping_json.trim().is_empty() {
        return Err("mapping_json is required".to_string());
    }
    if serde_json::from_str::<serde_json::Value>(&params.mapping_json).is_err() {
        return Err("mapping_json must be valid JSON".to_string());
    }

    check_permission(ctx, organization_id, &params.table_name, "create")?;

    if let Some(existing_id) = template_id {
        let existing = ctx
            .db
            .import_mapping_template()
            .id()
            .find(&existing_id)
            .ok_or("Import mapping template not found")?;
        if existing.organization_id != organization_id {
            return Err("Template does not belong to this organization".to_string());
        }
        if existing.table_name != params.table_name {
            return Err("table_name cannot change when updating a template".to_string());
        }

        ctx.db
            .import_mapping_template()
            .id()
            .update(ImportMappingTemplate {
                name: params.name.clone(),
                mapping_json: params.mapping_json.clone(),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                ..existing
            });

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: None,
                table_name: "import_mapping_template",
                record_id: existing_id,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "name": params.name,
                        "table_name": params.table_name,
                    })
                    .to_string(),
                ),
                changed_fields: vec!["name".to_string(), "mapping_json".to_string()],
                metadata: None,
            },
        );
        return Ok(());
    }

    let row = ctx
        .db
        .import_mapping_template()
        .insert(ImportMappingTemplate {
            id: 0,
            organization_id,
            table_name: params.table_name.clone(),
            name: params.name.clone(),
            mapping_json: params.mapping_json.clone(),
            use_count: 0,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: None,
            write_date: None,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "import_mapping_template",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "table_name": params.table_name,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "mapping_json".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_import_mapping_template(
    ctx: &ReducerContext,
    organization_id: u64,
    template_id: u64,
) -> Result<(), String> {
    let existing = ctx
        .db
        .import_mapping_template()
        .id()
        .find(&template_id)
        .ok_or("Import mapping template not found")?;
    if existing.organization_id != organization_id {
        return Err("Template does not belong to this organization".to_string());
    }

    check_permission(ctx, organization_id, &existing.table_name, "create")?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "import_mapping_template",
            record_id: template_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "name": existing.name,
                    "table_name": existing.table_name,
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    ctx.db.import_mapping_template().id().delete(&template_id);
    Ok(())
}

#[spacetimedb::reducer]
pub fn finalize_import_assistant_job(
    ctx: &ReducerContext,
    organization_id: u64,
    job_id: u64,
    params: FinalizeImportAssistantJobParams,
) -> Result<(), String> {
    if params.metadata_json.trim().is_empty() {
        return Err("metadata_json is required".to_string());
    }
    if serde_json::from_str::<serde_json::Value>(&params.metadata_json).is_err() {
        return Err("metadata_json must be valid JSON".to_string());
    }

    let job = ctx
        .db
        .import_job()
        .id()
        .find(&job_id)
        .ok_or("Import job not found")?;
    if job.organization_id != organization_id {
        return Err("Import job does not belong to this organization".to_string());
    }

    check_permission(ctx, organization_id, &job.table_name, "create")?;

    if let Some(template_id) = params.template_id {
        let template = ctx
            .db
            .import_mapping_template()
            .id()
            .find(&template_id)
            .ok_or("Import mapping template not found")?;
        if template.organization_id != organization_id {
            return Err("Template does not belong to this organization".to_string());
        }
        if template.table_name != job.table_name {
            return Err("Template table_name does not match import job".to_string());
        }

        ctx.db
            .import_mapping_template()
            .id()
            .update(ImportMappingTemplate {
                use_count: template.use_count.saturating_add(1),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                ..template
            });
    }

    ctx.db.import_job().id().update(ImportJob {
        metadata: Some(params.metadata_json.clone()),
        ..job
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "import_job",
            record_id: job_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(params.metadata_json),
            changed_fields: vec!["metadata".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
