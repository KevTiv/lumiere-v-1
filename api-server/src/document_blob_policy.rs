//! Current actor and operation checks for managed uploads.
//!
//! Purpose is fixed in server metadata when the upload is reserved. It never
//! comes from a download request and cannot turn an ordinary document into a
//! branding preview or an expense receipt.

use serde::{Deserialize, Serialize};
use stdb_auth::{identity_sql_literal, permission_allowed, FieldAccessContext};

use crate::error::ApiError;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum BlobPurpose {
    #[default]
    Document,
    Branding,
    ExpenseReceipt,
}

/// Identity must be established by the session, never a caller-supplied owner.
pub(super) fn creator_matches(creator: Option<&str>, actor: &str) -> bool {
    let Some(creator) = creator else {
        return false;
    };
    matches!(
        (identity_sql_literal(creator), identity_sql_literal(actor)),
        (Ok(creator), Ok(actor)) if creator == actor
    )
}

/// Re-evaluated at reservation, upload and completion so grants can be revoked
/// between steps. Company membership is checked separately against authority.
pub(super) fn require_upload_permission(
    access: Option<&FieldAccessContext>,
    organization_id: u64,
    actor: &str,
    purpose: BlobPurpose,
) -> Result<(), ApiError> {
    let access = access
        .filter(|access| {
            organization_id != 0
                && access.organization_id == organization_id
                && creator_matches(Some(&access.identity_hex), actor)
        })
        .ok_or_else(|| ApiError::Forbidden("upload membership is unavailable".into()))?;
    let allowed = match purpose {
        BlobPurpose::Document => {
            permission_allowed(access, "document", "create")
                || permission_allowed(access, "document_version", "create")
        }
        BlobPurpose::Branding => {
            permission_allowed(access, "document_template", "create")
                || permission_allowed(access, "document_template", "write")
        }
        BlobPurpose::ExpenseReceipt => permission_allowed(access, "hr_expense", "create"),
    };
    if !allowed {
        return Err(ApiError::Forbidden(
            "permission denied for this upload purpose".into(),
        ));
    }
    Ok(())
}

/// Branding is the only purpose eligible for an unpublished image preview.
/// Actual raster bytes and the pinned checksum are verified by the reader.
pub(super) fn validate_upload_purpose(
    purpose: BlobPurpose,
    content_type: &str,
    size: u64,
    company_id: Option<u64>,
) -> Result<(), ApiError> {
    if company_id == Some(0) {
        return Err(ApiError::BadRequest("companyId must be positive".into()));
    }
    if purpose == BlobPurpose::ExpenseReceipt && company_id.is_none() {
        return Err(ApiError::BadRequest(
            "expense receipts require a company".into(),
        ));
    }
    if purpose == BlobPurpose::Branding
        && (size == 0
            || size > 2 * 1024 * 1024
            || !matches!(content_type, "image/png" | "image/jpeg"))
    {
        return Err(ApiError::Unprocessable(
            "branding must be a non-empty PNG or JPEG up to 2 MiB".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use stdb_auth::ActionPermission;

    const ACTOR: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const OTHER: &str = "123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

    fn access(permissions: &[&str]) -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 7,
            identity_hex: ACTOR.into(),
            role_permissions: permissions.iter().map(|value| (*value).into()).collect(),
            ..FieldAccessContext::default()
        }
    }

    #[test]
    fn upload_purpose_cannot_borrow_another_workflows_permission() {
        let writer = access(&["document:create"]);
        assert!(require_upload_permission(Some(&writer), 7, ACTOR, BlobPurpose::Document).is_ok());
        assert!(require_upload_permission(Some(&writer), 7, ACTOR, BlobPurpose::Branding).is_err());
        assert!(
            require_upload_permission(Some(&writer), 7, ACTOR, BlobPurpose::ExpenseReceipt)
                .is_err()
        );
        let branding = access(&["document_template:write"]);
        assert!(
            require_upload_permission(Some(&branding), 7, ACTOR, BlobPurpose::Branding).is_ok()
        );
        assert!(
            require_upload_permission(Some(&branding), 7, ACTOR, BlobPurpose::Document).is_err()
        );
        let expense = access(&["hr_expense:create"]);
        assert!(
            require_upload_permission(Some(&expense), 7, ACTOR, BlobPurpose::ExpenseReceipt)
                .is_ok()
        );
        assert!(
            require_upload_permission(Some(&expense), 7, ACTOR, BlobPurpose::Document).is_err()
        );
    }

    #[test]
    fn current_membership_identity_and_permission_are_all_required() {
        let writer = access(&["document:create"]);
        for (org, actor) in [(8, ACTOR), (0, ACTOR), (7, OTHER), (7, "invalid")] {
            assert!(
                require_upload_permission(Some(&writer), org, actor, BlobPurpose::Document)
                    .is_err()
            );
        }
        assert!(require_upload_permission(None, 7, ACTOR, BlobPurpose::Document).is_err());
        assert!(
            require_upload_permission(Some(&access(&[])), 7, ACTOR, BlobPurpose::Document).is_err()
        );
        assert!(!creator_matches(None, ACTOR));
        assert!(!creator_matches(Some("invalid"), "invalid"));
        assert!(creator_matches(Some(&format!("0x{ACTOR}")), ACTOR));
    }

    #[test]
    fn explicit_denial_still_applies_to_wildcard_roles() {
        let mut writer = access(&["document:*"]);
        writer.org_permissions.push(ActionPermission {
            resource: "document".into(),
            action: "create".into(),
            allow: false,
        });
        assert!(require_upload_permission(Some(&writer), 7, ACTOR, BlobPurpose::Document).is_err());
    }

    #[test]
    fn branding_preview_admission_is_bounded_and_receipts_are_company_scoped() {
        assert!(validate_upload_purpose(BlobPurpose::Branding, "image/png", 10, None).is_ok());
        for (mime, size) in [
            ("application/pdf", 10),
            ("image/svg+xml", 10),
            ("image/png", 0),
            ("image/jpeg", 2 * 1024 * 1024 + 1),
        ] {
            assert!(validate_upload_purpose(BlobPurpose::Branding, mime, size, Some(3)).is_err());
        }
        assert!(
            validate_upload_purpose(BlobPurpose::ExpenseReceipt, "application/pdf", 10, None)
                .is_err()
        );
        assert!(validate_upload_purpose(
            BlobPurpose::ExpenseReceipt,
            "application/pdf",
            10,
            Some(3)
        )
        .is_ok());
        assert!(
            validate_upload_purpose(BlobPurpose::Document, "application/pdf", 10, Some(0)).is_err()
        );
    }
}
