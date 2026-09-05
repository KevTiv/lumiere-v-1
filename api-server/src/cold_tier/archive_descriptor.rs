//! Generated archive metadata and the reviewed resource alias boundary.
use super::cursor;

/// The generated archive metadata needed to compile one resource's read
/// against both stores.  The resource name is an API alias; table names come
/// from the generated archive manifest and are never accepted from a caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveReadDescriptor {
    pub resource: &'static str,
    pub hot_table: String,
    pub cold_table: String,
    pub primary_key: String,
    pub organization_column: String,
    pub company_column: Option<String>,
    pub company_required: bool,
    pub storage_class: String,
    pub access_path: PartitionExpectation,
}

/// Physical access-path expectation generated from the reviewed storage
/// policy.  A read plan carries this metadata even though each backend
/// realizes it differently (STDB index/accessor versus PG partition/index).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PartitionExpectation {
    OrganizationPartition,
    OrganizationIndex,
}

const ARCHIVE_MANIFEST_JSON: &str = lumiere_contracts::manifests::ARCHIVE_MANIFEST;
const STORAGE_POLICY_JSON: &str =
    include_str!("../../../lumiere-codegen/storage-policy-manifest.json");

/// Resolve the reviewed/generated descriptor for an archive-capable API
/// resource.  This intentionally has a closed resource alias list: adding a
/// cold resource requires a generated archive-manifest entry and a reviewed
/// API alias, rather than allowing request data to select an arbitrary table.
pub fn archive_read_descriptor(
    resource: &str,
) -> Result<ArchiveReadDescriptor, cursor::CursorError> {
    let (api_resource, source_table) = match resource {
        "audit-log" => ("audit-log", "audit_log"),
        "pos-orders" => ("pos-orders", "pos_order"),
        _ => {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "resource '{resource}' is not an archive-capable read"
            )))
        }
    };

    let manifest: serde_json::Value = serde_json::from_str(ARCHIVE_MANIFEST_JSON).map_err(|e| {
        cursor::CursorError::InvalidPlan(format!("parse generated archive manifest: {e}"))
    })?;
    let candidate = manifest["candidates"]
        .as_array()
        .and_then(|candidates| {
            candidates
                .iter()
                .find(|candidate| candidate["table"].as_str() == Some(source_table))
        })
        .ok_or_else(|| {
            cursor::CursorError::InvalidPlan(format!(
                "generated archive manifest has no candidate for '{source_table}'"
            ))
        })?;
    let string_field = |name: &str| {
        candidate[name].as_str().map(str::to_owned).ok_or_else(|| {
            cursor::CursorError::InvalidPlan(format!(
                "archive candidate '{source_table}' is missing '{name}'"
            ))
        })
    };
    // v0.3.x contracts expose scope as an ordered `scope_columns` list;
    // newer generated manifests may also carry named scope mappings.  Accept
    // both shapes while retaining the same fail-closed organization rule.
    let organization_column = candidate["scope"]["organization_id"]
        .as_str()
        .or_else(|| {
            candidate["scope_columns"].as_array().and_then(|columns| {
                columns.iter().find_map(|column| {
                    (column.as_str() == Some("organization_id")).then_some("organization_id")
                })
            })
        })
        .map(str::to_owned)
        .ok_or_else(|| {
            cursor::CursorError::InvalidPlan(format!(
                "archive candidate '{source_table}' has no organization scope"
            ))
        })?;
    let company_column = candidate["scope"]["company_id"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| {
            candidate["scope_columns"]
                .as_array()
                .and_then(|columns| {
                    columns.iter().find_map(|column| {
                        (column.as_str() == Some("company_id")).then_some("company_id")
                    })
                })
                .map(str::to_owned)
        });

    let policy_manifest: serde_json::Value =
        serde_json::from_str(STORAGE_POLICY_JSON).map_err(|e| {
            cursor::CursorError::InvalidPlan(format!("parse generated storage policy: {e}"))
        })?;
    let policy = policy_manifest["policies"]
        .as_array()
        .and_then(|policies| {
            policies
                .iter()
                .find(|policy| policy["table"].as_str() == Some(source_table))
        })
        .ok_or_else(|| {
            cursor::CursorError::InvalidPlan(format!(
                "generated storage policy has no entry for '{source_table}'"
            ))
        })?;
    if policy["organization_ownership"].as_str() != Some("direct") {
        return Err(cursor::CursorError::InvalidPlan(format!(
            "archive candidate '{source_table}' does not have direct organization ownership"
        )));
    }
    let access_path = match policy["postgres_access_path"].as_str() {
        Some("organization_partition") => PartitionExpectation::OrganizationPartition,
        Some("organization_index") => PartitionExpectation::OrganizationIndex,
        Some(other) => {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "unsupported generated access path '{other}' for '{source_table}'"
            )))
        }
        None => {
            return Err(cursor::CursorError::InvalidPlan(format!(
                "storage policy '{source_table}' has no Postgres access path"
            )))
        }
    };
    // Older published contracts do not yet carry the policy's storage-class
    // annotation. Preserve the descriptor seam and use the generated
    // candidate as the compatibility fallback until the next contract tag.
    let storage_class = policy["storage_class"]
        .as_str()
        .or_else(|| candidate["storage_class"].as_str())
        .unwrap_or("archive")
        .to_owned();
    let company_required =
        company_column.is_some() && policy["company_column_nullable"].as_bool() == Some(false);

    Ok(ArchiveReadDescriptor {
        resource: api_resource,
        hot_table: source_table.to_owned(),
        cold_table: string_field("cold_table")?,
        primary_key: candidate["primary_key"]["column_name"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| {
                cursor::CursorError::InvalidPlan(format!(
                    "archive candidate '{source_table}' has no primary key"
                ))
            })?,
        organization_column,
        company_column,
        company_required,
        storage_class,
        access_path,
    })
}
