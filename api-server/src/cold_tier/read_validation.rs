//! Shared validation before either store emits SQL.
use super::{
    archive_read_descriptor, cursor, pg_codec, ArchiveReadDescriptor, ReadPredicate,
    ResourceReadPlan,
};
const CODEC_MANIFEST_JSON: &str = lumiere_contracts::manifests::CODEC_MANIFEST;
const MAX_ARCHIVE_PAGE: u32 = 501;

/// Validate a read plan before either SQL compiler emits a query.
///
/// The plan is deliberately checked against generated archive and codec
/// metadata.  This keeps table/column/cast selection out of request data and
/// makes the STDB and PG compilers share the same scope and projection rules.
pub fn validate_resource_read_plan(
    plan: &ResourceReadPlan,
) -> Result<ArchiveReadDescriptor, cursor::CursorError> {
    if plan.organization_id == 0 {
        return Err(cursor::CursorError::InvalidPlan(
            "organization_id must be greater than zero".into(),
        ));
    }
    if !(1..=MAX_ARCHIVE_PAGE).contains(&plan.page.limit) {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "page limit must be between 1 and {MAX_ARCHIVE_PAGE}"
        )));
    }
    if plan.order.is_empty() {
        return Err(cursor::CursorError::InvalidPlan(
            "order must contain a deterministic key".into(),
        ));
    }

    let descriptor = archive_read_descriptor(&plan.resource)?;
    if plan.table != descriptor.hot_table {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "resource '{}' must use generated hot table '{}'",
            plan.resource, descriptor.hot_table
        )));
    }
    if plan.company_id.is_some() && descriptor.company_column.is_none() {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "resource '{}' does not support company scope",
            plan.resource
        )));
    }
    if descriptor.company_required && plan.company_id.is_none() {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "resource '{}' requires resolved company scope",
            plan.resource
        )));
    }

    let codec =
        pg_codec::load_columns(CODEC_MANIFEST_JSON, &descriptor.hot_table).map_err(|e| {
            cursor::CursorError::InvalidPlan(format!(
                "load generated codec for '{}': {e}",
                descriptor.hot_table
            ))
        })?;
    let allowed_columns: std::collections::HashSet<&str> =
        codec.iter().map(|column| column.name.as_str()).collect();
    if plan.projection.is_empty() {
        return Err(cursor::CursorError::InvalidPlan(
            "projection must not be empty".into(),
        ));
    }
    for entry in &plan.projection {
        let (column, cast) = entry
            .split_once("::")
            .map_or((entry.as_str(), None), |(column, cast)| {
                (column, Some(cast))
            });
        if !allowed_columns.contains(column) {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "column '{column}' is not generated for '{}'",
                descriptor.hot_table
            )));
        }
        if cast.is_some_and(|cast| cast != "TEXT") {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "unsupported projection cast for '{column}'"
            )));
        }
    }
    if !plan
        .projection
        .iter()
        .any(|entry| entry.split("::").next() == Some(descriptor.organization_column.as_str()))
    {
        return Err(cursor::CursorError::InvalidPlan(
            "projection must include organization scope".into(),
        ));
    }
    for order in &plan.order {
        if !allowed_columns.contains(order.column.as_str()) {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "order column '{}' is not generated for '{}'",
                order.column, descriptor.hot_table
            )));
        }
        if !plan
            .projection
            .iter()
            .any(|entry| entry.split("::").next() == Some(order.column.as_str()))
        {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "order column '{}' must be projected",
                order.column
            )));
        }
    }
    if !plan
        .order
        .iter()
        .any(|order| order.column == descriptor.primary_key)
    {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "order must include generated primary key '{}'",
            descriptor.primary_key
        )));
    }
    validate_predicates(&plan.predicates, &allowed_columns)?;
    Ok(descriptor)
}

fn validate_predicates(
    predicates: &[ReadPredicate],
    allowed_columns: &std::collections::HashSet<&str>,
) -> Result<(), cursor::CursorError> {
    for predicate in predicates {
        let column = match predicate {
            ReadPredicate::Eq { column, .. }
            | ReadPredicate::IsNull { column }
            | ReadPredicate::IsNotNull { column }
            | ReadPredicate::Gte { column, .. }
            | ReadPredicate::Lte { column, .. }
            | ReadPredicate::In { column, .. } => Some(column.as_str()),
            ReadPredicate::Or(left, right) => {
                validate_predicates(std::slice::from_ref(left.as_ref()), allowed_columns)?;
                validate_predicates(std::slice::from_ref(right.as_ref()), allowed_columns)?;
                None
            }
        };
        if let Some(column) = column {
            if !allowed_columns.contains(column) {
                return Err(cursor::CursorError::InvalidPlan(format!(
                    "predicate column '{column}' is not generated"
                )));
            }
        }
    }
    Ok(())
}
