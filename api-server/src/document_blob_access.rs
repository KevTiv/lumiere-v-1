//! Record visibility for server-generated PDF objects, including historical versions.

use serde_json::Value;
use stdb_auth::{has_resource_read_permission, identity_sql_literal, FieldAccessContext};

use crate::document_render::{
    invoice::row_u64,
    quotation::{cell, exact_company},
};

pub(super) struct GeneratedBlobScope<'a> {
    pub organization_id: u64,
    pub company_id: u64,
    pub creator_identity: &'a str,
    pub url: &'a str,
    pub checksum: &'a str,
}

/// Both inputs must come from the canonical authorized resource queries. Current
/// documents are owner-only; version queries independently require version read
/// permission and are creator-only. A version also needs a still-visible parent.
pub(super) fn generated_pdf_is_visible(
    scope: &GeneratedBlobScope<'_>,
    access: Option<&FieldAccessContext>,
    documents: &[Value],
    versions: &[Value],
) -> bool {
    let Some(access) = access.filter(|access| access.organization_id == scope.organization_id)
    else {
        return false;
    };
    if scope.organization_id == 0
        || scope.company_id == 0
        || !has_resource_read_permission(Some(access), "documents")
    {
        return false;
    }
    let Ok(actor) = identity_sql_literal(&access.identity_hex) else {
        return false;
    };
    // Document ownership is set to the creating actor and has no update input.
    // Bind the object itself to that actor so registering a copied URL on a new
    // document cannot manufacture access to another author's output bytes.
    if identity_sql_literal(scope.creator_identity).ok().as_deref() != Some(actor.as_str()) {
        return false;
    }
    let visible = documents
        .iter()
        .filter(|row| {
            exact_company(row, scope.organization_id, scope.company_id)
                && cell(row, &["ownerId", "owner_id"])
                    .and_then(Value::as_str)
                    .and_then(|identity| identity_sql_literal(identity).ok())
                    .as_deref()
                    == Some(actor.as_str())
        })
        .collect::<Vec<_>>();
    let matches_blob = |row: &Value| {
        cell(row, &["url"]).and_then(Value::as_str) == Some(scope.url)
            && cell(row, &["checksum"]).and_then(Value::as_str) == Some(scope.checksum)
    };
    if visible.iter().any(|row| matches_blob(row)) {
        return true;
    }
    has_resource_read_permission(Some(access), "document-versions")
        && versions.iter().any(|version| {
            row_u64(version, &["organizationId", "organization_id"]) == Some(scope.organization_id)
                && row_u64(version, &["documentId", "document_id"]).is_some_and(|id| {
                    visible
                        .iter()
                        .any(|document| row_u64(document, &["id"]) == Some(id))
                })
                && matches_blob(version)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ACTOR: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const OTHER: &str = "123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

    fn access(permissions: &[&str]) -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 7,
            role_id: 3,
            role_name: "Document reader".into(),
            is_superuser: false,
            role_permissions: permissions.iter().map(|value| (*value).into()).collect(),
            identity_hex: ACTOR.into(),
            field_permissions: vec![],
            role_ids: Vec::new(),
            org_permissions: Vec::new(),
        }
    }

    #[test]
    fn generated_pdf_requires_document_read_and_exact_owner_company_and_bytes() {
        let checksum = "a".repeat(64);
        let scope = GeneratedBlobScope {
            organization_id: 7,
            company_id: 3,
            creator_identity: ACTOR,
            url: "/api/documents/blobs/object/7/generated/file",
            checksum: &checksum,
        };
        let original = json!({"id":9,"organizationId":7,"companyId":3,"ownerId":ACTOR,"url":scope.url,"checksum":checksum});
        assert!(generated_pdf_is_visible(
            &scope,
            Some(&access(&["document:read"])),
            &[original.clone()],
            &[]
        ));
        assert!(!generated_pdf_is_visible(
            &scope,
            Some(&access(&[])),
            &[original.clone()],
            &[]
        ));
        let copied_object = GeneratedBlobScope {
            creator_identity: OTHER,
            ..scope
        };
        assert!(
            !generated_pdf_is_visible(
                &copied_object,
                Some(&access(&["document:read"])),
                &[original.clone()],
                &[]
            ),
            "a caller-owned registration of another actor's copied URL must not grant access"
        );
        assert!(!generated_pdf_is_visible(
            &scope,
            None,
            &[original.clone()],
            &[]
        ));
        for (key, value) in [
            ("organizationId", json!(8)),
            ("companyId", json!(4)),
            ("ownerId", json!(OTHER)),
            ("url", json!("other")),
            ("checksum", json!("b".repeat(64))),
        ] {
            let mut row = original.clone();
            row[key] = value;
            assert!(
                !generated_pdf_is_visible(&scope, Some(&access(&["document:read"])), &[row], &[]),
                "{key}"
            );
        }
    }

    #[test]
    fn generated_pdf_history_requires_visible_parent_and_authorized_version_read() {
        let checksum = "a".repeat(64);
        let scope = GeneratedBlobScope {
            organization_id: 7,
            company_id: 3,
            creator_identity: ACTOR,
            url: "/api/documents/blobs/object/7/generated/original",
            checksum: &checksum,
        };
        let parent = json!({"id":9,"organizationId":7,"companyId":3,"ownerId":ACTOR,"url":"new-version","checksum":"b".repeat(64)});
        let version =
            json!({"id":11,"organizationId":7,"documentId":9,"url":scope.url,"checksum":checksum});
        let reader = access(&["document:read", "document_version:read"]);
        assert!(generated_pdf_is_visible(
            &scope,
            Some(&reader),
            &[parent.clone()],
            &[version.clone()]
        ));
        assert!(!generated_pdf_is_visible(
            &scope,
            Some(&access(&["document:read"])),
            &[parent.clone()],
            &[version.clone()]
        ));
        assert!(!generated_pdf_is_visible(
            &scope,
            Some(&reader),
            &[],
            &[version.clone()]
        ));
        let mut other_parent = parent.clone();
        other_parent["ownerId"] = json!(OTHER);
        assert!(!generated_pdf_is_visible(
            &scope,
            Some(&reader),
            &[other_parent],
            &[version.clone()]
        ));
        let mut foreign_version = version;
        foreign_version["documentId"] = json!(10);
        assert!(!generated_pdf_is_visible(
            &scope,
            Some(&reader),
            &[parent],
            &[foreign_version]
        ));
    }
}
