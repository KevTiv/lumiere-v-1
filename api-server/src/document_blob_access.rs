//! Record visibility for managed document objects, including historical versions.

use serde_json::Value;
use std::borrow::Cow;
use stdb_auth::{has_resource_read_permission, identity_sql_literal, FieldAccessContext};

/// Scope recorded by the server when it accepts an upload or creates an output.
/// A missing creator is legacy/unproven storage metadata, never an org-wide grant.
pub(super) struct DocumentBlobScope<'a> {
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub creator_identity: Option<&'a str>,
    pub url: &'a str,
    pub checksum: &'a str,
}

#[cfg(test)]
pub(super) struct GeneratedBlobScope<'a> {
    pub organization_id: u64,
    pub company_id: u64,
    pub creator_identity: &'a str,
    pub url: &'a str,
    pub checksum: &'a str,
}

/// Preserve the generated-output caller while sharing the same policy as uploads.
#[cfg(test)]
pub(super) fn generated_pdf_is_visible(
    scope: &GeneratedBlobScope<'_>,
    access: Option<&FieldAccessContext>,
    documents: &[Value],
    versions: &[Value],
) -> bool {
    document_blob_is_visible(
        &DocumentBlobScope {
            organization_id: scope.organization_id,
            company_id: Some(scope.company_id),
            creator_identity: Some(scope.creator_identity),
            url: scope.url,
            checksum: scope.checksum,
        },
        access,
        documents,
        versions,
    )
}

/// Both row sets must come from the canonical authorized resource queries.
/// Documents must be live and owner-scoped; versions must be creator-scoped.
/// This additional check binds those records to the server-recorded object owner
/// and exact bytes. It never grants access to unregistered or unproven uploads.
pub(super) fn document_blob_is_visible(
    scope: &DocumentBlobScope<'_>,
    access: Option<&FieldAccessContext>,
    documents: &[Value],
    versions: &[Value],
) -> bool {
    let Some(access) = access else {
        return false;
    };
    let Some(actor) = scoped_actor(scope, access) else {
        return false;
    };
    if !has_resource_read_permission(Some(access), "documents") {
        return false;
    };
    // A caller-owned row pointing at someone else's object cannot manufacture
    // byte access. This also rejects legacy blobs without trusted ownership.
    if scope
        .creator_identity
        .and_then(|identity| identity_sql_literal(identity).ok())
        .as_deref()
        != Some(actor.as_str())
    {
        return false;
    }

    let visible_document = |row: &Value| {
        positive_id(row, "id", "id").is_some()
            && positive_id(row, "organizationId", "organization_id") == Some(scope.organization_id)
            && matching_fields(row, "companyId", "company_id", |value| match scope.company_id {
                Some(company_id) => positive_number(value) == Some(company_id),
                None => value.is_null(),
            })
            && matching_fields(row, "ownerId", "owner_id", |value| {
                value
                    .as_str()
                    .and_then(|identity| identity_sql_literal(identity).ok())
                    .as_deref()
                    == Some(actor.as_str())
            })
            // The canonical SQL already requires is_deleted = false, even when
            // field policy omits this column. Reject contradictory input if present.
            && ["isDeleted", "is_deleted"]
                .iter()
                .filter_map(|key| row.get(key))
                .all(|value| value == &Value::Bool(false))
    };
    let matches_blob = |row: &Value| {
        row.get("url").and_then(Value::as_str) == Some(scope.url)
            && row.get("checksum").and_then(Value::as_str) == Some(scope.checksum)
    };
    if documents
        .iter()
        .any(|row| visible_document(row) && matches_blob(row))
    {
        return true;
    }
    has_resource_read_permission(Some(access), "document-versions")
        && versions.iter().any(|version| {
            positive_id(version, "organizationId", "organization_id") == Some(scope.organization_id)
                && positive_id(version, "documentId", "document_id").is_some_and(|id| {
                    documents.iter().any(|document| {
                        positive_id(document, "id", "id") == Some(id) && visible_document(document)
                    })
                })
                && matches_blob(version)
        })
}

/// Receipts use their own canonical resource rather than a synthetic Document.
/// The caller must first verify that storage metadata records the receipt purpose.
/// Reviewer sharing is deliberately not inferred from the organization alone.
pub(super) fn expense_receipt_blob_is_visible(
    scope: &DocumentBlobScope<'_>,
    object_key: &str,
    access: Option<&FieldAccessContext>,
    receipts: &[Value],
) -> bool {
    let Some(access) = access else {
        return false;
    };
    let Some(actor) = scoped_actor(scope, access) else {
        return false;
    };
    if scope.company_id.is_none()
        || object_key.is_empty()
        || !has_resource_read_permission(Some(access), "expense-receipts")
        || scope
            .creator_identity
            .and_then(|identity| identity_sql_literal(identity).ok())
            .as_deref()
            != Some(actor.as_str())
    {
        return false;
    }
    receipts.iter().any(|row| {
        row_scope_matches(row, scope, false)
            && matching_fields(row, "storageKey", "storage_key", |value| {
                value.as_str() == Some(object_key)
            })
            && matching_fields(row, "contentHash", "content_hash", |value| {
                value.as_str() == Some(scope.checksum)
            })
    })
}

/// Published branding is shareable only through an authorized, projected record
/// containing its exact pinned reference. The caller must enforce Branding purpose,
/// pinned download hash and raster validation; a PNG document is not a brand asset.
/// Unsaved uploader previews are a separate explicit, write-authorized operation.
pub(super) fn branding_blob_is_visible(
    scope: &DocumentBlobScope<'_>,
    access: Option<&FieldAccessContext>,
    templates: &[Value],
    invoices: &[Value],
) -> bool {
    let Some(access) = access else {
        return false;
    };
    if scoped_actor(scope, access).is_none() {
        return false;
    }
    let pinned = format!("{}?sha256={}", scope.url, scope.checksum);
    if has_resource_read_permission(Some(access), "document-templates")
        && templates.iter().any(|row| {
            if !row_scope_matches(row, scope, true)
                || !matching_fields(row, "isActive", "is_active", |value| {
                    value == &Value::Bool(true)
                })
            {
                return false;
            }
            let Some(metadata) = row_metadata(row) else {
                return false;
            };
            let designer = metadata.get("documentBranding").is_some_and(|branding| {
                branding.get("schemaVersion").and_then(Value::as_u64) == Some(1)
                    && branding.get("logoUrl").and_then(Value::as_str) == Some(pinned.as_str())
            });
            let invoice_profile = row.get("model").and_then(Value::as_str) == Some("account_move")
                && matching_fields(row, "reportType", "report_type", |value| {
                    value.as_str() == Some("lumiere-invoice-profile-v1")
                })
                && metadata.get("invoiceProfile").is_some_and(|profile| {
                    profile.get("schemaVersion").and_then(Value::as_u64) == Some(1)
                        && profile
                            .get("values")
                            .and_then(|values| values.get("logoUrl"))
                            .and_then(Value::as_str)
                            == Some(pinned.as_str())
                });
            designer || invoice_profile
        })
    {
        return true;
    }
    has_resource_read_permission(Some(access), "account-moves")
        && invoices.iter().any(|row| {
            if !row_scope_matches(row, scope, true) {
                return false;
            }
            let Some(metadata) = row_metadata(row) else {
                return false;
            };
            metadata.get("invoiceDocument").is_some_and(|snapshot| {
                matches!(
                    snapshot.get("schemaVersion").and_then(Value::as_u64),
                    Some(1 | 2)
                ) && snapshot
                    .get("profile")
                    .and_then(|profile| profile.get("logoUrl"))
                    .and_then(Value::as_str)
                    == Some(pinned.as_str())
            })
        })
}

fn scoped_actor(scope: &DocumentBlobScope<'_>, access: &FieldAccessContext) -> Option<String> {
    if scope.organization_id == 0
        || access.organization_id != scope.organization_id
        || scope.company_id == Some(0)
        || scope.url.is_empty()
        || scope.checksum.len() != 64
        || !scope.checksum.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    // Every purpose requires provenance. Legacy metadata must be migrated using
    // reviewed ownership evidence, not inferred from a caller-supplied record.
    identity_sql_literal(scope.creator_identity?).ok()?;
    identity_sql_literal(&access.identity_hex).ok()
}

fn row_scope_matches(
    row: &Value,
    scope: &DocumentBlobScope<'_>,
    allow_shared_branding: bool,
) -> bool {
    let Some(company) = row.get("companyId").or_else(|| row.get("company_id")) else {
        return false;
    };
    let company_id = if company.is_null() {
        None
    } else {
        let Some(company_id) = positive_number(company) else {
            return false;
        };
        Some(company_id)
    };
    (scope.company_id == company_id || (scope.company_id.is_none() && allow_shared_branding))
        && positive_id(row, "id", "id").is_some()
        && positive_id(row, "organizationId", "organization_id") == Some(scope.organization_id)
        && matching_fields(row, "companyId", "company_id", |value| match company_id {
            Some(company_id) => positive_number(value) == Some(company_id),
            None => value.is_null(),
        })
}

fn row_metadata(row: &Value) -> Option<Cow<'_, Value>> {
    match row.get("metadata")? {
        Value::String(raw) => serde_json::from_str(raw).ok().map(Cow::Owned),
        value @ Value::Object(_) => Some(Cow::Borrowed(value)),
        _ => None,
    }
}

fn positive_number(value: &Value) -> Option<u64> {
    let id = value.as_u64().or_else(|| {
        value
            .as_str()
            .filter(|text| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit()))?
            .parse()
            .ok()
    })?;
    (id > 0).then_some(id)
}

fn positive_id(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    let id = positive_number(row.get(camel).or_else(|| row.get(snake))?)?;
    matching_fields(row, camel, snake, |value| {
        positive_number(value) == Some(id)
    })
    .then_some(id)
}

/// Accept either canonical encoding, but never conflicting alias values.
fn matching_fields(
    row: &Value,
    camel: &str,
    snake: &str,
    matches: impl Fn(&Value) -> bool,
) -> bool {
    match (row.get(camel), row.get(snake)) {
        (Some(a), Some(b)) => matches(a) && matches(b),
        (Some(value), None) | (None, Some(value)) => matches(value),
        (None, None) => false,
    }
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

    fn uploaded_scope(company_id: Option<u64>) -> DocumentBlobScope<'static> {
        DocumentBlobScope {
            organization_id: 7,
            company_id,
            creator_identity: Some(ACTOR),
            url: "/api/documents/blobs/object/7/default/upload",
            checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }
    }

    fn document(scope: &DocumentBlobScope<'_>) -> Value {
        json!({
            "id": 9,
            "organizationId": scope.organization_id,
            "companyId": scope.company_id,
            "ownerId": ACTOR,
            "url": scope.url,
            "checksum": scope.checksum,
        })
    }

    #[test]
    fn uploaded_object_requires_registration_and_proven_uploader_identity() {
        let scope = uploaded_scope(Some(3));
        let rows = [document(&scope)];
        let reader = access(&["document:read"]);
        assert!(document_blob_is_visible(&scope, Some(&reader), &rows, &[]));
        assert!(
            !document_blob_is_visible(&scope, Some(&reader), &[], &[]),
            "a completed upload alone must not grant byte access"
        );
        for creator_identity in [None, Some(OTHER), Some("invalid")] {
            let unproven = DocumentBlobScope {
                creator_identity,
                ..scope
            };
            assert!(
                !document_blob_is_visible(&unproven, Some(&reader), &rows, &[]),
                "registering a copied URL cannot claim another uploader's or a legacy object"
            );
        }
    }

    #[test]
    fn uploaded_object_read_rechecks_permission_identity_and_organization() {
        let scope = uploaded_scope(Some(3));
        let rows = [document(&scope)];
        for permissions in [
            vec![],
            vec!["document:write"],
            vec!["document_version:read"],
        ] {
            assert!(!document_blob_is_visible(
                &scope,
                Some(&access(&permissions)),
                &rows,
                &[]
            ));
        }
        assert!(!document_blob_is_visible(&scope, None, &rows, &[]));
        let mut reader = access(&["document:read"]);
        reader.org_permissions.push(stdb_auth::ActionPermission {
            resource: "document".into(),
            action: "read".into(),
            allow: false,
        });
        assert!(!document_blob_is_visible(&scope, Some(&reader), &rows, &[]));
        reader.org_permissions.clear();
        reader.identity_hex = OTHER.into();
        assert!(!document_blob_is_visible(&scope, Some(&reader), &rows, &[]));
        reader.identity_hex = ACTOR.into();
        reader.organization_id = 8;
        assert!(!document_blob_is_visible(&scope, Some(&reader), &rows, &[]));
    }

    #[test]
    fn organization_owned_upload_requires_explicit_matching_null_company() {
        let scope = uploaded_scope(None);
        let original = document(&scope);
        let reader = access(&["document:read"]);
        assert!(document_blob_is_visible(
            &scope,
            Some(&reader),
            std::slice::from_ref(&original),
            &[]
        ));
        for company in [json!(3), json!(0), json!("invalid"), json!({"none": []})] {
            let mut row = original.clone();
            row["companyId"] = company;
            assert!(!document_blob_is_visible(
                &scope,
                Some(&reader),
                &[row],
                &[]
            ));
        }
        let mut missing = original;
        missing.as_object_mut().unwrap().remove("companyId");
        assert!(!document_blob_is_visible(
            &scope,
            Some(&reader),
            &[missing],
            &[]
        ));
    }

    #[test]
    fn uploaded_document_scope_masks_deletion_and_conflicting_aliases_fail_closed() {
        let scope = uploaded_scope(Some(3));
        let original = document(&scope);
        let reader = access(&["document:read"]);
        for (field, value) in [
            ("id", json!(0)),
            ("organizationId", json!(8)),
            ("organization_id", json!(8)),
            ("companyId", Value::Null),
            ("company_id", json!(4)),
            ("ownerId", json!(OTHER)),
            ("owner_id", json!(OTHER)),
            ("url", json!("copied-url")),
            ("checksum", json!("b".repeat(64))),
            ("isDeleted", json!(true)),
            ("is_deleted", json!(true)),
        ] {
            let mut row = original.clone();
            row[field] = value;
            assert!(
                !document_blob_is_visible(&scope, Some(&reader), &[row], &[]),
                "{field} must not widen access"
            );
        }
        for masked_field in [
            "id",
            "organizationId",
            "companyId",
            "ownerId",
            "url",
            "checksum",
        ] {
            let mut projected = original.clone();
            projected.as_object_mut().unwrap().remove(masked_field);
            assert!(
                !document_blob_is_visible(&scope, Some(&reader), &[projected], &[]),
                "missing {masked_field} cannot be recovered from unprojected rows"
            );
        }
    }

    #[test]
    fn uploaded_history_requires_version_permission_exact_bytes_and_a_live_parent() {
        let scope = uploaded_scope(Some(3));
        let mut parent = document(&scope);
        parent["url"] = json!("new-version");
        parent["checksum"] = json!("b".repeat(64));
        let version = json!({
            "id": 11,
            "organizationId": 7,
            "documentId": 9,
            "url": scope.url,
            "checksum": scope.checksum,
        });
        let reader = access(&["document:read", "document_version:read"]);
        assert!(document_blob_is_visible(
            &scope,
            Some(&reader),
            std::slice::from_ref(&parent),
            std::slice::from_ref(&version)
        ));
        assert!(!document_blob_is_visible(
            &scope,
            Some(&access(&["document:read"])),
            std::slice::from_ref(&parent),
            std::slice::from_ref(&version)
        ));
        assert!(!document_blob_is_visible(
            &scope,
            Some(&reader),
            &[],
            std::slice::from_ref(&version)
        ));
        for (field, value) in [
            ("documentId", json!(10)),
            ("document_id", json!(10)),
            ("organizationId", json!(8)),
            ("organization_id", json!(8)),
            ("url", Value::Null),
            ("checksum", json!("b".repeat(64))),
        ] {
            let mut invalid = version.clone();
            invalid[field] = value;
            assert!(!document_blob_is_visible(
                &scope,
                Some(&reader),
                std::slice::from_ref(&parent),
                &[invalid]
            ));
        }
        parent["isDeleted"] = json!(true);
        assert!(!document_blob_is_visible(
            &scope,
            Some(&reader),
            &[parent],
            &[version]
        ));
    }

    #[test]
    fn canonical_aliases_and_large_ids_preserve_exact_scope() {
        let scope = DocumentBlobScope {
            company_id: Some(u64::MAX),
            ..uploaded_scope(None)
        };
        let row = json!({
            "id": "18446744073709551615",
            "organization_id": "7",
            "company_id": "18446744073709551615",
            "owner_id": ACTOR,
            "url": scope.url,
            "checksum": scope.checksum,
            "is_deleted": false,
        });
        assert!(document_blob_is_visible(
            &scope,
            Some(&access(&["document:read"])),
            &[row],
            &[]
        ));
    }

    #[test]
    fn receipt_access_requires_current_read_scope_owner_key_and_hash() {
        let scope = uploaded_scope(Some(3));
        let key = "org-7/default/upload";
        let original = json!({
            "id": 12, "organizationId": 7, "companyId": 3,
            "storageKey": key, "contentHash": scope.checksum,
        });
        let reader = access(&["hr_expense_receipt:read"]);
        assert!(expense_receipt_blob_is_visible(
            &scope,
            key,
            Some(&reader),
            std::slice::from_ref(&original)
        ));
        assert!(!expense_receipt_blob_is_visible(
            &scope,
            key,
            Some(&access(&["hr_expense:create"])),
            std::slice::from_ref(&original)
        ));
        let copied = DocumentBlobScope {
            creator_identity: Some(OTHER),
            ..scope
        };
        assert!(!expense_receipt_blob_is_visible(
            &copied,
            key,
            Some(&reader),
            std::slice::from_ref(&original)
        ));
        for (field, value) in [
            ("companyId", json!(4)),
            ("organizationId", json!(8)),
            ("storageKey", json!("another-object")),
            ("contentHash", Value::Null),
            ("content_hash", json!("b".repeat(64))),
        ] {
            let mut row = original.clone();
            row[field] = value;
            assert!(!expense_receipt_blob_is_visible(
                &scope,
                key,
                Some(&reader),
                &[row]
            ));
        }
        assert!(!expense_receipt_blob_is_visible(
            &scope,
            key,
            Some(&reader),
            &[]
        ));
    }

    #[test]
    fn published_branding_requires_exact_projected_reference_and_current_permission() {
        let scope = DocumentBlobScope {
            creator_identity: Some(OTHER),
            ..uploaded_scope(Some(3))
        };
        let pinned = format!("{}?sha256={}", scope.url, scope.checksum);
        let original = json!({
            "id": 14, "organizationId": 7, "companyId": 3, "isActive": true,
            "metadata": json!({"documentBranding": {"schemaVersion": 1, "logoUrl": pinned}}).to_string(),
        });
        let reader = access(&["document_template:read"]);
        assert!(branding_blob_is_visible(
            &scope,
            Some(&reader),
            std::slice::from_ref(&original),
            &[]
        ));
        assert!(!branding_blob_is_visible(
            &scope,
            Some(&access(&["document:read"])),
            std::slice::from_ref(&original),
            &[]
        ));
        assert!(!branding_blob_is_visible(&scope, Some(&reader), &[], &[]));
        for (field, value) in [
            ("companyId", json!(4)),
            ("organization_id", json!(8)),
            ("isActive", json!(false)),
            ("metadata", Value::Null),
            ("metadata", json!("invalid-json")),
            (
                "metadata",
                json!({"documentBranding": {"schemaVersion": 1, "logoUrl": scope.url}}),
            ),
            (
                "metadata",
                json!({"documentBranding": {"schemaVersion": 2, "logoUrl": pinned}}),
            ),
        ] {
            let mut row = original.clone();
            row[field] = value;
            assert!(!branding_blob_is_visible(
                &scope,
                Some(&reader),
                &[row],
                &[]
            ));
        }
        let legacy = DocumentBlobScope {
            creator_identity: None,
            ..scope
        };
        assert!(!branding_blob_is_visible(
            &legacy,
            Some(&reader),
            &[original],
            &[]
        ));
    }

    #[test]
    fn branding_profiles_and_issued_invoice_snapshots_preserve_only_authorized_references() {
        let scope = uploaded_scope(None);
        let pinned = format!("{}?sha256={}", scope.url, scope.checksum);
        let profile = json!({
            "id": 14, "organizationId": 7, "companyId": null, "isActive": true,
            "model": "account_move", "reportType": "lumiere-invoice-profile-v1",
            "metadata": {"invoiceProfile": {"schemaVersion": 1, "values": {"logoUrl": pinned}}},
        });
        assert!(branding_blob_is_visible(
            &scope,
            Some(&access(&["document_template:read"])),
            &[profile],
            &[]
        ));
        let invoice = json!({
            "id": 17, "organizationId": 7, "companyId": 3,
            "metadata": {"invoiceDocument": {"schemaVersion": 2, "profile": {"logoUrl": pinned}}},
        });
        let reader = access(&["account_move:read"]);
        assert!(branding_blob_is_visible(
            &scope,
            Some(&reader),
            &[],
            std::slice::from_ref(&invoice)
        ));
        assert!(!branding_blob_is_visible(
            &scope,
            Some(&access(&["document_template:read"])),
            &[],
            std::slice::from_ref(&invoice)
        ));
        let another_company = DocumentBlobScope {
            company_id: Some(4),
            ..scope
        };
        assert!(!branding_blob_is_visible(
            &another_company,
            Some(&reader),
            &[],
            std::slice::from_ref(&invoice)
        ));
        let mut contradictory = invoice;
        contradictory["company_id"] = json!(4);
        assert!(!branding_blob_is_visible(
            &scope,
            Some(&reader),
            &[],
            &[contradictory]
        ));
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
