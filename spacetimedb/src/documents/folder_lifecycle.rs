//! Server-owned folder trash state. The original row and object references stay intact.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::documents::DocumentFolder;

const LIFECYCLE_KEY: &str = "documentFolderLifecycle";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FolderTrash {
    state: TrashState,
    deleted_at_micros: String,
    deleted_by: String,
    original_parent_id: Option<u64>,
    previous_metadata: Option<String>,
}

#[derive(Deserialize, Serialize)]
enum TrashState {
    #[serde(rename = "trashed")]
    Trashed,
}

fn metadata_value(metadata: Option<&str>) -> Option<Value> {
    metadata.and_then(|value| serde_json::from_str(value).ok())
}

fn lifecycle_value(metadata: Option<&str>) -> Option<Value> {
    metadata_value(metadata)?.get(LIFECYCLE_KEY).cloned()
}

fn trash_state(metadata: Option<&str>) -> Result<Option<FolderTrash>, String> {
    lifecycle_value(metadata)
        .map(|value| {
            serde_json::from_value(value)
                .map_err(|_| "Folder lifecycle metadata is invalid".to_string())
        })
        .transpose()
}

pub(super) fn is_trashed(folder: &DocumentFolder) -> Result<bool, String> {
    Ok(trash_state(folder.metadata.as_deref())?.is_some())
}

/// Ordinary metadata updates cannot create, replace or remove the server-owned marker.
pub(super) fn validate_metadata_change(
    previous: Option<&str>,
    next: Option<&str>,
) -> Result<(), String> {
    if lifecycle_value(previous) != lifecycle_value(next) {
        return Err("Folder lifecycle metadata is server-managed".to_string());
    }
    Ok(())
}

pub(super) fn trash_metadata(
    folder: &DocumentFolder,
    deleted_at_micros: i64,
    deleted_by: String,
) -> Result<String, String> {
    if is_trashed(folder)? {
        return Err("Folder is already in trash".to_string());
    }
    let mut metadata = match metadata_value(folder.metadata.as_deref()) {
        Some(Value::Object(object)) => object,
        _ => Map::new(),
    };
    let state = FolderTrash {
        state: TrashState::Trashed,
        deleted_at_micros: deleted_at_micros.to_string(),
        deleted_by,
        original_parent_id: folder.parent_id,
        previous_metadata: folder.metadata.clone(),
    };
    metadata.insert(
        LIFECYCLE_KEY.to_string(),
        serde_json::to_value(state).map_err(|error| error.to_string())?,
    );
    serde_json::to_string(&metadata).map_err(|error| error.to_string())
}

pub(super) fn restored_metadata(folder: &DocumentFolder) -> Result<Option<String>, String> {
    let state = trash_state(folder.metadata.as_deref())?.ok_or("Folder is not in trash")?;
    // A reserved marker cannot be nested to manufacture an older restore state.
    validate_metadata_change(None, state.previous_metadata.as_deref())?;
    Ok(state.previous_metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_marker_cannot_be_forged_removed_or_changed() {
        let marker = r#"{"documentFolderLifecycle":{"state":"trashed"}}"#;
        assert!(validate_metadata_change(None, Some(marker)).is_err());
        assert!(validate_metadata_change(Some(marker), None).is_err());
        assert!(validate_metadata_change(Some(marker), Some(marker)).is_ok());
        assert!(validate_metadata_change(Some("legacy text"), Some(r#"{"color":"blue"}"#)).is_ok());
        assert!(trash_state(Some(marker)).is_err());
        assert!(trash_state(Some(r#"{"documentFolderLifecycle":null}"#)).is_err());
    }
}
