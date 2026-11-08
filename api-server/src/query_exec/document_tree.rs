//! Internal folder ancestry checks, applied before returning any projected document rows.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use serde_json::Value;
use stdb_auth::identity_sql_literal;
use stdb_client::StdbClient;

use super::super::company_scope::resolve_template_company_ids;
use super::document_row_id;
use crate::error::ApiError;

const MAX_FOLDER_DEPTH: usize = 128;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FolderTrash {
    state: TrashState,
    deleted_at_micros: String,
    deleted_by: String,
    original_parent_id: Option<u64>,
    previous_metadata: Option<String>,
}

#[derive(Deserialize)]
enum TrashState {
    #[serde(rename = "trashed")]
    Trashed,
}

fn value<'a>(row: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    match (row.get(camel), row.get(snake)) {
        (Some(a), Some(b)) if a != b => None,
        (Some(value), _) | (_, Some(value)) => Some(value),
        _ => None,
    }
}

fn optional_id(row: &Value, camel: &str, snake: &str) -> Option<Option<u64>> {
    if value(row, camel, snake)?.is_null() {
        return Some(None);
    }
    document_row_id(row, camel, snake).map(Some)
}

fn trashed(metadata: &Value) -> Option<bool> {
    if metadata.is_null() {
        return Some(false);
    }
    let raw = metadata.as_str()?;
    // Opaque legacy metadata remains valid. Only the reserved structured marker
    // has lifecycle semantics; a malformed marker is never treated as active.
    let Ok(Value::Object(metadata)) = serde_json::from_str::<Value>(raw) else {
        return Some(false);
    };
    let Some(state) = metadata.get("documentFolderLifecycle") else {
        return Some(false);
    };
    let state: FolderTrash = serde_json::from_value(state.clone()).ok()?;
    let _ = (
        state.state,
        state.deleted_at_micros,
        state.deleted_by,
        state.original_parent_id,
        state.previous_metadata,
    );
    Some(true)
}

#[derive(Clone, PartialEq)]
struct FolderNode {
    company_id: Option<u64>,
    parent_id: Option<u64>,
    trashed: bool,
}

pub(super) struct DocumentTree {
    organization_id: u64,
    actor: String,
    company_ids: BTreeSet<u64>,
    folders: BTreeMap<u64, FolderNode>,
}

impl DocumentTree {
    fn from_rows(
        organization_id: u64,
        actor: String,
        company_ids: Vec<u64>,
        rows: &[Value],
    ) -> Self {
        let mut tree = Self {
            organization_id,
            actor,
            company_ids: company_ids.into_iter().collect(),
            folders: BTreeMap::new(),
        };
        let mut conflicts = BTreeSet::new();
        for row in rows {
            let Some((id, node)) = tree.folder_node(row) else {
                continue;
            };
            if tree
                .folders
                .get(&id)
                .is_some_and(|previous| previous != &node)
            {
                conflicts.insert(id);
            }
            tree.folders.insert(id, node);
        }
        for id in conflicts {
            tree.folders.remove(&id);
        }
        tree
    }

    fn folder_node(&self, row: &Value) -> Option<(u64, FolderNode)> {
        let id = document_row_id(row, "id", "id")?;
        if document_row_id(row, "organizationId", "organization_id") != Some(self.organization_id) {
            return None;
        }
        let company_id = optional_id(row, "companyId", "company_id")?;
        if company_id.is_some_and(|company| !self.company_ids.contains(&company)) {
            return None;
        }
        let restricted = value(row, "isAccessRestricted", "is_access_restricted")?.as_bool()?;
        let owner = identity_sql_literal(value(row, "ownerId", "owner_id")?.as_str()?).ok()?;
        // Keep the current pilot's owner-only restriction; internal graph reads
        // do not introduce grants absent from the ordinary folder projection.
        if restricted && owner != self.actor {
            return None;
        }
        Some((
            id,
            FolderNode {
                company_id,
                parent_id: optional_id(row, "parentId", "parent_id")?,
                trashed: trashed(value(row, "metadata", "metadata")?)?,
            },
        ))
    }

    fn allows_chain(
        &self,
        folder_id: Option<u64>,
        company_id: Option<u64>,
        allow_self_trash: bool,
    ) -> bool {
        let mut next = folder_id;
        let mut seen = BTreeSet::new();
        while let Some(id) = next {
            if !seen.insert(id) || seen.len() > MAX_FOLDER_DEPTH {
                return false;
            }
            let Some(folder) = self.folders.get(&id) else {
                return false;
            };
            if folder.company_id.is_some() && folder.company_id != company_id {
                return false;
            }
            if folder.trashed && !(allow_self_trash && Some(id) == folder_id) {
                return false;
            }
            next = folder.parent_id;
        }
        true
    }

    pub(super) fn folder_visible(&self, id: u64, deleted: bool) -> bool {
        self.folders.get(&id).is_some_and(|folder| {
            folder.trashed == deleted && self.allows_chain(Some(id), folder.company_id, deleted)
        })
    }

    pub(super) fn parent_path(&self, id: u64) -> Option<String> {
        let folder = self.folders.get(&id)?;
        if !self.folder_visible(id, folder.trashed) {
            return None;
        }
        let mut ids = Vec::new();
        let mut next = folder.parent_id;
        while let Some(parent) = next {
            ids.push(parent.to_string());
            next = self.folders.get(&parent)?.parent_id;
        }
        ids.reverse();
        Some(format!("/{}", ids.join("/")))
    }

    pub(super) fn document_visible(&self, row: &Value, deleted: bool) -> bool {
        if document_row_id(row, "organizationId", "organization_id") != Some(self.organization_id)
            || document_row_id(row, "id", "id").is_none()
            || value(row, "ownerId", "owner_id")
                .and_then(Value::as_str)
                .and_then(|identity| identity_sql_literal(identity).ok())
                .as_deref()
                != Some(self.actor.as_str())
            || value(row, "isDeleted", "is_deleted") != Some(&Value::Bool(deleted))
        {
            return false;
        }
        let Some(company_id) = optional_id(row, "companyId", "company_id") else {
            return false;
        };
        if company_id.is_some_and(|id| !self.company_ids.contains(&id)) {
            return false;
        }
        let Some(folder_id) = optional_id(row, "folderId", "folder_id") else {
            return false;
        };
        self.allows_chain(folder_id, company_id, false)
    }
}

pub(super) async fn read_tree(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    requested_company_id: Option<u64>,
) -> Result<DocumentTree, ApiError> {
    let actor = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let company_ids =
        resolve_template_company_ids(client, organization_id, identity_hex, requested_company_id)
            .await?;
    let folders = client.query_sql(&format!(
        "SELECT id, organization_id, company_id, parent_id, owner_id, is_access_restricted, metadata FROM doc_folder WHERE organization_id = {organization_id} AND (is_access_restricted = false OR owner_id = {actor})"
    )).await.map_err(ApiError::internal)?;
    Ok(DocumentTree::from_rows(
        organization_id,
        actor,
        company_ids,
        &folders,
    ))
}

pub(super) async fn visible_document_rows(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    tree: &DocumentTree,
    deleted: bool,
) -> Result<Vec<Value>, ApiError> {
    let actor = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let mut rows = client.query_sql(&format!(
        "SELECT id, organization_id, company_id, folder_id, owner_id, is_deleted FROM document WHERE organization_id = {organization_id} AND is_deleted = {deleted} AND owner_id = {actor}"
    )).await.map_err(ApiError::internal)?;
    rows.retain(|row| tree.document_visible(row, deleted));
    Ok(rows)
}

pub(super) fn visible_counts(rows: &[Value]) -> BTreeMap<u64, u64> {
    let mut counts = BTreeMap::new();
    for row in rows {
        if let Some(Some(folder_id)) = optional_id(row, "folderId", "folder_id") {
            *counts.entry(folder_id).or_insert(0) += 1;
        }
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ACTOR: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const OTHER: &str = "123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

    fn folder(id: u64, parent_id: Option<u64>) -> Value {
        json!({"id":id,"organizationId":7,"companyId":12,"parentId":parent_id,"ownerId":ACTOR,"isAccessRestricted":false,"metadata":null})
    }

    fn trash(folder: &mut Value) {
        folder["metadata"] = json!(json!({"documentFolderLifecycle":{
            "state":"trashed","deletedAtMicros":"1","deletedBy":ACTOR,
            "originalParentId":folder["parentId"],"previousMetadata":null
        }})
        .to_string());
    }

    fn document(folder_id: Option<u64>) -> Value {
        json!({"id":100,"organizationId":7,"companyId":12,"folderId":folder_id,"ownerId":ACTOR,"isDeleted":false})
    }

    fn tree(rows: &[Value]) -> DocumentTree {
        DocumentTree::from_rows(7, identity_sql_literal(ACTOR).unwrap(), vec![12], rows)
    }

    #[test]
    fn trashed_ancestor_hides_descendants_files_and_preexisting_deleted_files() {
        let mut root = folder(1, None);
        let mut child = folder(2, Some(1));
        trash(&mut child);
        let active = folder(3, Some(1));
        let before = tree(&[root.clone(), child.clone(), active.clone()]);
        assert!(before.folder_visible(1, false));
        assert!(before.folder_visible(2, true));
        assert!(before.document_visible(&document(Some(3)), false));
        trash(&mut root);
        let trashed = tree(&[root, child, active]);
        assert!(trashed.folder_visible(1, true));
        assert!(!trashed.folder_visible(1, false));
        assert!(!trashed.folder_visible(2, true));
        assert!(!trashed.folder_visible(3, false));
        assert!(!trashed.document_visible(&document(Some(3)), false));
        let mut deleted = document(Some(3));
        deleted["isDeleted"] = json!(true);
        assert!(!trashed.document_visible(&deleted, true));
        assert!(trashed.document_visible(&document(None), false));
    }

    #[test]
    fn missing_foreign_denied_and_cyclic_ancestors_fail_closed() {
        let leaf = folder(2, Some(1));
        assert!(!tree(&[leaf.clone()]).folder_visible(2, false));
        for (field, value) in [("organizationId", json!(8)), ("companyId", json!(13))] {
            let mut root = folder(1, None);
            root[field] = value;
            assert!(!tree(&[root, leaf.clone()]).folder_visible(2, false));
        }
        let mut root = folder(1, None);
        root["isAccessRestricted"] = json!(true);
        root["ownerId"] = json!(OTHER);
        assert!(!tree(&[root, leaf.clone()]).document_visible(&document(Some(2)), false));
        assert!(!tree(&[folder(1, Some(2)), leaf]).folder_visible(2, false));
    }

    #[test]
    fn invalid_markers_and_missing_scope_cannot_turn_into_active_rows() {
        let mut root = folder(1, None);
        root["metadata"] = json!(r#"{"documentFolderLifecycle":{"state":"trashed"}}"#);
        assert!(!tree(&[root.clone()]).folder_visible(1, false));
        assert!(!tree(&[root]).folder_visible(1, true));
        let valid = tree(&[folder(1, None)]);
        for field in [
            "organizationId",
            "companyId",
            "folderId",
            "ownerId",
            "isDeleted",
        ] {
            let mut doc = document(Some(1));
            doc.as_object_mut().unwrap().remove(field);
            assert!(!valid.document_visible(&doc, false), "{field}");
        }
        let mut global_child = folder(2, Some(1));
        global_child["companyId"] = Value::Null;
        assert!(!tree(&[folder(1, None), global_child]).folder_visible(2, false));
    }

    #[test]
    fn paths_and_counts_are_derived_only_from_current_visible_rows() {
        let mut root = folder(1, None);
        root["parentPath"] = json!("/999/secret");
        root["documentCount"] = json!(99);
        let visible = tree(&[root, folder(2, Some(1))]);
        assert_eq!(visible.parent_path(1).as_deref(), Some("/"));
        assert_eq!(visible.parent_path(2).as_deref(), Some("/1"));
        assert_eq!(visible.parent_path(999), None);
        let owned = document(Some(2));
        let mut other_owner = owned.clone();
        other_owner["id"] = json!(101);
        other_owner["ownerId"] = json!(OTHER);
        let mut other_company = owned.clone();
        other_company["id"] = json!(102);
        other_company["companyId"] = json!(13);
        let mut deleted = owned.clone();
        deleted["id"] = json!(103);
        deleted["isDeleted"] = json!(true);
        let rows: Vec<_> = [owned, other_owner, other_company, deleted]
            .into_iter()
            .filter(|row| visible.document_visible(row, false))
            .collect();
        assert_eq!(visible_counts(&rows), BTreeMap::from([(2, 1)]));
    }
}
