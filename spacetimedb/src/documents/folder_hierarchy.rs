//! Folder ancestry, scope and access checks shared by document mutations.

use std::collections::{BTreeMap, BTreeSet};

use spacetimedb::{Identity, ReducerContext, Table};

use super::documents::{doc_folder, DocumentFolder};
use super::{folder_lifecycle, knowledge_guides::require_company_membership};

pub(super) const MAX_FOLDER_DEPTH: usize = 128;
const MAX_FOLDER_SUBTREE: usize = 4096;

#[derive(Clone, Copy)]
pub(super) enum FolderAccess {
    Read,
    Write,
}

pub(super) fn require_company_access(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
) -> Result<(), String> {
    if let Some(company_id) = company_id {
        require_company_membership(ctx, organization_id, company_id)?;
    }
    Ok(())
}

pub(super) fn ensure_company_scope(
    folder: &DocumentFolder,
    company_id: Option<u64>,
) -> Result<(), String> {
    if folder.company_id.is_some() && folder.company_id != company_id {
        return Err("Folder does not belong to this company".to_string());
    }
    Ok(())
}

fn require_access(
    folder: &DocumentFolder,
    sender: Identity,
    access: FolderAccess,
) -> Result<(), String> {
    if matches!(access, FolderAccess::Write) && folder.is_readonly {
        return Err("Folder is read-only".to_string());
    }
    if !folder.is_access_restricted
        || folder.owner_id == sender
        || folder.write_access_ids.contains(&sender)
        || matches!(access, FolderAccess::Read) && folder.read_access_ids.contains(&sender)
    {
        return Ok(());
    }
    Err(match access {
        FolderAccess::Read => "You do not have read access to this folder".to_string(),
        FolderAccess::Write => "You do not have write access to this folder".to_string(),
    })
}

/// Resolve every parent from authoritative links; cached paths never authorize access.
/// The first element is the requested folder and the last is its root.
pub(super) fn authorized_chain(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    folder_id: Option<u64>,
    access: FolderAccess,
    allow_self_trash: bool,
) -> Result<Vec<DocumentFolder>, String> {
    require_company_access(ctx, organization_id, company_id)?;
    let mut next = folder_id;
    let mut seen = BTreeSet::new();
    let mut chain = Vec::new();
    while let Some(id) = next {
        if id == 0 || !seen.insert(id) || chain.len() >= MAX_FOLDER_DEPTH {
            return Err("Folder ancestry is invalid".to_string());
        }
        let folder = ctx
            .db
            .doc_folder()
            .id()
            .find(&id)
            .ok_or("Folder not found")?;
        if folder.organization_id != organization_id {
            return Err("Folder does not belong to this organization".to_string());
        }
        ensure_company_scope(&folder, company_id)?;
        if folder_lifecycle::is_trashed(&folder)? && !(allow_self_trash && Some(id) == folder_id) {
            return Err("Folder is in trash; restore it before continuing".to_string());
        }
        require_access(&folder, ctx.sender(), access)?;
        next = folder.parent_id;
        chain.push(folder);
    }
    Ok(chain)
}

pub(super) fn path_for_parent(chain: &[DocumentFolder]) -> String {
    if chain.is_empty() {
        return "/".to_string();
    }
    format!(
        "/{}",
        chain
            .iter()
            .rev()
            .map(|folder| folder.id.to_string())
            .collect::<Vec<_>>()
            .join("/")
    )
}

pub(super) fn validate_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty()
        || matches!(name, "." | "..")
        || name.chars().count() > 255
        || name
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '\\'))
    {
        return Err(
            "Folder name must contain 1 to 255 characters without path separators".to_string(),
        );
    }
    Ok(name.to_string())
}

pub(super) fn require_unique_name(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    parent_id: Option<u64>,
    except_id: Option<u64>,
    name: &str,
) -> Result<(), String> {
    let normalized = name.to_lowercase();
    for folder in ctx
        .db
        .doc_folder()
        .doc_folder_by_org()
        .filter(&organization_id)
    {
        if folder.parent_id == parent_id
            && folder.company_id == company_id
            && Some(folder.id) != except_id
            && folder.name.trim().to_lowercase() == normalized
            && !folder_lifecycle::is_trashed(&folder)?
        {
            return Err("A folder with this name already exists in the destination".to_string());
        }
    }
    Ok(())
}

/// Validate the complete affected subtree before any folder is moved or trashed.
pub(super) fn authorized_subtree(
    ctx: &ReducerContext,
    root: &DocumentFolder,
) -> Result<Vec<DocumentFolder>, String> {
    // This SDK cannot filter nullable indexes. Build the adjacency map once,
    // including foreign rows so corrupt cross-tenant descendants fail closed.
    let mut by_parent = BTreeMap::<u64, Vec<DocumentFolder>>::new();
    for folder in ctx.db.doc_folder().iter() {
        if let Some(parent_id) = folder.parent_id {
            by_parent.entry(parent_id).or_default().push(folder);
        }
    }
    let mut folders = vec![root.clone()];
    let mut seen = BTreeSet::from([root.id]);
    let mut index = 0;
    while index < folders.len() {
        let parent = &folders[index];
        let mut children = Vec::new();
        for child in by_parent.remove(&parent.id).unwrap_or_default() {
            if child.organization_id != root.organization_id {
                return Err("Folder descendant belongs to another organization".to_string());
            }
            ensure_company_scope(parent, child.company_id)?;
            require_company_access(ctx, child.organization_id, child.company_id)?;
            require_access(&child, ctx.sender(), FolderAccess::Write)?;
            folder_lifecycle::is_trashed(&child)?;
            if !seen.insert(child.id) || seen.len() > MAX_FOLDER_SUBTREE {
                return Err("Folder subtree is cyclic or exceeds the supported size".to_string());
            }
            children.push(child);
        }
        folders.extend(children);
        index += 1;
    }
    Ok(folders)
}

#[derive(Debug, PartialEq)]
enum Audience {
    Everyone,
    Only(BTreeSet<Identity>),
}

impl Audience {
    fn intersect(self, next: BTreeSet<Identity>) -> Self {
        match self {
            Self::Everyone => Self::Only(next),
            Self::Only(previous) => Self::Only(previous.intersection(&next).copied().collect()),
        }
    }

    fn is_subset_of(&self, previous: &Self) -> bool {
        match (self, previous) {
            (_, Self::Everyone) => true,
            (Self::Everyone, Self::Only(_)) => false,
            (Self::Only(next), Self::Only(previous)) => next.is_subset(previous),
        }
    }
}

fn audience(chain: &[DocumentFolder], access: FolderAccess) -> Audience {
    chain.iter().fold(Audience::Everyone, |audience, folder| {
        if matches!(access, FolderAccess::Write) && folder.is_readonly {
            return Audience::Only(BTreeSet::new());
        }
        if !folder.is_access_restricted {
            return audience;
        }
        let mut members = BTreeSet::from([folder.owner_id]);
        members.extend(folder.write_access_ids.iter().copied());
        if matches!(access, FolderAccess::Read) {
            members.extend(folder.read_access_ids.iter().copied());
        }
        audience.intersect(members)
    })
}

pub(super) fn require_no_access_expansion(
    previous: &[DocumentFolder],
    next: &[DocumentFolder],
) -> Result<(), String> {
    for access in [FolderAccess::Read, FolderAccess::Write] {
        if !audience(next, access).is_subset_of(&audience(previous, access)) {
            return Err("Moving to this destination would broaden folder access; restrict access before moving".to_string());
        }
    }
    Ok(())
}

/// Rebuild paths for the root and all descendants, preserving every stable folder ID.
pub(super) fn relocated_subtree(
    folders: Vec<DocumentFolder>,
    parent_id: Option<u64>,
    parent_path: String,
) -> Result<Vec<DocumentFolder>, String> {
    let mut paths = BTreeMap::<u64, (String, usize)>::new();
    let mut relocated = Vec::with_capacity(folders.len());
    for (index, mut folder) in folders.into_iter().enumerate() {
        let (path, depth) = if index == 0 {
            folder.parent_id = parent_id;
            (
                parent_path.clone(),
                parent_path
                    .split('/')
                    .filter(|part| !part.is_empty())
                    .count(),
            )
        } else {
            let parent_id = folder.parent_id.ok_or("Folder descendant has no parent")?;
            let (path, depth) = paths
                .get(&parent_id)
                .ok_or("Folder descendant is out of order")?;
            (
                format!("{}/{parent_id}", path.trim_end_matches('/')),
                depth + 1,
            )
        };
        if depth >= MAX_FOLDER_DEPTH {
            return Err("Folder destination would exceed the supported nesting depth".to_string());
        }
        folder.parent_path = path.clone();
        paths.insert(folder.id, (path, depth));
        relocated.push(folder);
    }
    Ok(relocated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names_are_bounded_and_cannot_be_paths() {
        assert_eq!(validate_name("  Invoices  ").unwrap(), "Invoices");
        for invalid in ["", " ", ".", "..", "a/b", "a\\b", "a\nb", "a\0b"] {
            assert!(validate_name(invalid).is_err(), "{invalid:?}");
        }
        assert!(validate_name(&"a".repeat(256)).is_err());
    }

    #[test]
    fn restricted_audiences_cannot_be_broadened_by_a_move() {
        let owner = Identity::from_u128(1);
        let other = Identity::from_u128(2);
        let limited = Audience::Only(BTreeSet::from([owner]));
        assert!(limited.is_subset_of(&Audience::Everyone));
        assert!(!Audience::Everyone.is_subset_of(&limited));
        assert!(!Audience::Only(BTreeSet::from([owner, other])).is_subset_of(&limited));
        assert_eq!(
            Audience::Only(BTreeSet::from([owner, other])).intersect(BTreeSet::from([owner])),
            limited
        );
    }
}
