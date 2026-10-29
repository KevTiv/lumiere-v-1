use super::authoritative::{authoritative_record_sql, AuthoritativeResourceScope};
use super::crm::{filter_direct_crm_company_rows, visible_parent_ids_from_rows};
use super::row_values::{
    optional_u64, row_enum_tag_is, row_id_u64_strict, row_identity_option_is, row_not_soft_deleted,
};
use super::*;
use serde_json::json;
use std::collections::HashSet;

fn authoritative_access(permission: &str) -> FieldAccessContext {
    FieldAccessContext {
        organization_id: 42,
        role_id: 7,
        role_name: "member".into(),
        is_superuser: false,
        role_permissions: vec![permission.into()],
        identity_hex: "actor".into(),
        field_permissions: Vec::new(),
        role_ids: Vec::new(),
        org_permissions: Vec::new(),
    }
}

#[test]
fn runtime_form_metadata_reads_require_the_active_tenant_context_and_honor_denies() {
    let identity = "ab".repeat(32);
    let mut access = authoritative_access("organization:read");
    access.identity_hex = identity.clone();
    for resource in [
        "form-configs",
        "form-config-fields",
        "form-role-configs",
        "form-field-labels",
        "user-custom-fields",
    ] {
        assert!(require_ui_child_read_permission(resource, 42, &identity, Some(&access)).is_ok());
        assert!(require_ui_child_read_permission(resource, 43, &identity, Some(&access)).is_err());
        assert!(require_ui_child_read_permission(resource, 42, &identity, None).is_err());
        let mut denied = access.clone();
        denied.org_permissions.push(stdb_auth::ActionPermission {
            resource: resource.into(),
            action: "read".into(),
            allow: false,
        });
        assert!(require_ui_child_read_permission(resource, 42, &identity, Some(&denied)).is_err());
    }
    assert!(require_ui_child_read_permission("leads", 42, &identity, Some(&access)).is_err());
}

#[test]
fn private_workflow_reads_reuse_canonical_grants_and_preserve_denials_and_scope() {
    let identity = "ab".repeat(32);
    for resource in [
        "workflow-human-tasks-inbox",
        "workflow-human-tasks",
        "workflow-human-task-events",
    ] {
        for grant in ["workflow:read", "module:workflows:read"] {
            let mut access = authoritative_access(grant);
            access.identity_hex = identity.clone();
            assert!(
                require_ui_child_read_permission(resource, 42, &identity, Some(&access)).is_ok()
            );
            assert!(
                require_ui_child_read_permission(resource, 43, &identity, Some(&access)).is_err()
            );
            assert!(require_ui_child_read_permission(
                resource,
                42,
                &"cd".repeat(32),
                Some(&access)
            )
            .is_err());
            assert!(require_ui_child_read_permission(resource, 42, &identity, None).is_err());
            for denied_resource in [resource, "workflow"] {
                let mut denied = access.clone();
                denied.org_permissions.push(stdb_auth::ActionPermission {
                    resource: denied_resource.into(),
                    action: "read".into(),
                    allow: false,
                });
                assert!(
                    require_ui_child_read_permission(resource, 42, &identity, Some(&denied))
                        .is_err(),
                    "{resource}: denied {denied_resource}"
                );
            }
        }
        for grant in ["workflow:write", "purchase_order:read", "organization:read"] {
            let mut access = authoritative_access(grant);
            access.identity_hex = identity.clone();
            assert!(
                require_ui_child_read_permission(resource, 42, &identity, Some(&access)).is_err()
            );
        }
    }
}

#[test]
fn ui_child_reads_reuse_domain_permissions_without_accepting_write_grants() {
    let identity = "ab".repeat(32);
    for (resource, grant) in [
        ("profit-loss-lines", "financial_report:read"),
        ("balance-sheet-lines", "financial_report:read"),
        ("cash-flow-lines", "financial_report:read"),
        (
            "consolidation-company-rates",
            "consolidation_company_rate:read",
        ),
        ("bank-statement-import-lines", "account_bank_statement:read"),
        ("tax-deadline-reminders", "tax_deadline:read"),
        ("hr-leave-allocations", "hr_leave:read"),
        ("hr-offboarding-checklists", "hr_employee:read"),
        ("hr-statutory-ids", "hr_employee:read"),
        ("document-signature-requests", "document:read"),
        ("document-legal-holds", "document:read"),
        ("document-external-refs", "document:read"),
    ] {
        let mut access = authoritative_access(grant);
        access.identity_hex = identity.clone();
        assert!(
            require_ui_child_read_permission(resource, 42, &identity, Some(&access)).is_ok(),
            "{resource}"
        );
        access.role_permissions = vec![grant.replace(":read", ":write")];
        assert!(
            matches!(
                require_ui_child_read_permission(resource, 42, &identity, Some(&access)),
                Err(ApiError::Forbidden(_))
            ),
            "{resource}"
        );
        assert!(require_ui_child_read_permission(resource, 42, &identity, None).is_err());
    }
}

#[test]
fn ui_child_reads_reject_mismatched_actor_or_organization_even_for_superusers() {
    let identity = "ab".repeat(32);
    let mut access = authoritative_access("*:*");
    access.identity_hex = identity.clone();
    access.is_superuser = true;
    for resource in [
        "profit-loss-lines",
        "hr-statutory-ids",
        "document-legal-holds",
    ] {
        assert!(require_ui_child_read_permission(resource, 42, &identity, Some(&access)).is_ok());
        for organization_id in [0, 43] {
            assert!(require_ui_child_read_permission(
                resource,
                organization_id,
                &identity,
                Some(&access)
            )
            .is_err());
        }
        for actor in ["invalid".to_owned(), "cd".repeat(32)] {
            assert!(require_ui_child_read_permission(resource, 42, &actor, Some(&access)).is_err());
        }
    }
    assert!(require_ui_child_read_permission("products", 42, &identity, None).is_err());
}

#[tokio::test]
async fn ui_child_dispatcher_denies_unscoped_reads_before_database_access() {
    let client = StdbClient::new("http://127.0.0.1:9".into(), "test".into(), "test".into());
    let identity = "ab".repeat(32);
    for resource in [
        "profit-loss-lines",
        "balance-sheet-lines",
        "cash-flow-lines",
        "bank-statement-import-lines",
        "tax-deadline-reminders",
        "consolidation-company-rates",
        "hr-leave-allocations",
        "hr-offboarding-checklists",
        "hr-statutory-ids",
        "document-signature-requests",
        "document-legal-holds",
        "document-external-refs",
    ] {
        assert!(
            matches!(
                execute_resource_query_for_company(&client, resource, 42, &identity, None, Some(7))
                    .await,
                Err(ApiError::Forbidden(_))
            ),
            "{resource}"
        );
    }
}

#[test]
fn authoritative_company_sql_is_bounded_by_scope_and_id() {
    let access = authoritative_access("sale_order:read");
    let (sql, scope) =
        authoritative_record_sql("sale-orders", 42, 7, 99, Some(&access)).expect("authorized SQL");
    assert_eq!(scope, AuthoritativeResourceScope::OrganizationAndCompany);
    assert!(sql.contains("organization_id = 42"));
    assert!(sql.contains("company_id = 7"));
    assert!(sql.contains("id = 99"));
    assert!(!sql.contains("LIMIT"));
}

#[test]
fn authoritative_sql_fails_closed_without_read_permission() {
    let access = authoritative_access("sale_order:write");
    assert!(authoritative_record_sql("sale-orders", 42, 7, 99, Some(&access)).is_err());
    assert!(authoritative_record_sql("sale-orders", 42, 7, 99, None).is_err());
    assert!(authoritative_record_sql("unknown", 42, 7, 99, Some(&access)).is_err());
}

#[test]
fn authoritative_read_rejects_zero_or_forged_scope_ids() {
    let access = authoritative_access("sale_order:read");
    for (organization_id, company_id, record_id) in [(0, 7, 99), (42, 0, 99), (42, 7, 0)] {
        assert!(
            authoritative_record_sql(
                "sale-orders",
                organization_id,
                company_id,
                record_id,
                Some(&access),
            )
            .is_err(),
            "invalid scope tuple must fail closed: {organization_id}/{company_id}/{record_id}"
        );
    }
}

#[test]
fn company_bound_actor_cannot_request_another_company() {
    assert!(enforce_requested_company(7, Some(8), "cross-company").is_err());
    assert_eq!(
        enforce_requested_company(7, Some(7), "cross-company").expect("same company"),
        7
    );
}

#[test]
fn enum_post_filter_matches_only_expected_sats_tags() {
    assert!(row_enum_tag_is(
        &json!({ "state": "ToApprove" }),
        "state",
        &["ToApprove"]
    ));
    assert!(row_enum_tag_is(
        &json!({ "state": "ValidatedOne" }),
        "state",
        &["Confirm", "ValidatedOne"]
    ));
    assert!(!row_enum_tag_is(
        &json!({ "state": "Approved" }),
        "state",
        &["ToApprove"]
    ));
}

#[test]
fn identity_post_filter_accepts_sats_option_encodings() {
    let target = "abcdef";
    for row in [
        json!({ "userId": ["0xABCDEF"] }),
        json!({ "user_id": { "some": ["0xabcdef"] } }),
        json!({ "userId": "ABCDEF" }),
    ] {
        assert!(row_identity_option_is(&row, "userId", "user_id", target));
    }
    assert!(!row_identity_option_is(
        &json!({ "userId": { "none": [] } }),
        "userId",
        "user_id",
        target
    ));
    assert!(!row_identity_option_is(
        &json!({ "userId": ["0x123456"] }),
        "userId",
        "user_id",
        target
    ));
}

#[test]
fn row_not_soft_deleted_treats_missing_and_null_as_live() {
    assert!(row_not_soft_deleted(&json!({ "id": 1 })));
    assert!(row_not_soft_deleted(&json!({ "id": 1, "deletedAt": null })));
    assert!(row_not_soft_deleted(
        &json!({ "id": 1, "deleted_at": { "none": [] } })
    ));
}

#[test]
fn row_not_soft_deleted_rejects_timestamp() {
    assert!(!row_not_soft_deleted(&json!({
        "id": 1,
        "deletedAt": { "__timestamp_micros_since_unix_epoch__": 1 }
    })));
}

#[test]
fn filter_and_strip_soft_deleted_removes_deleted_rows_and_field() {
    let mut rows = vec![
        json!({ "id": 1, "deletedAt": null }),
        json!({ "id": 2, "deletedAt": { "__timestamp_micros_since_unix_epoch__": 1 } }),
    ];
    filter_and_strip_soft_deleted(&mut rows);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("id").and_then(|v| v.as_u64()), Some(1));
    assert!(rows[0].get("deletedAt").is_none());
}

#[test]
fn crm_company_match_distinguishes_owned_shared_and_cross_company_rows() {
    let owned = json!({ "companyId": 7 });
    let shared = json!({ "companyId": null });
    let tagged = json!({ "company_id": { "some": [7] } });

    assert!(row_company_matches(&owned, 7, false));
    assert!(row_company_matches(&tagged, 7, false));
    assert!(!row_company_matches(&owned, 8, true));
    assert!(row_company_matches(&shared, 7, true));
    assert!(!row_company_matches(&shared, 7, false));
}

#[test]
fn direct_company_owned_crm_resources_exclude_null_and_cross_company_rows() {
    for resource in [
        "contacts",
        "opportunities",
        "contact-phone-identities",
        "contact-role-assignments",
        "contact-communication-preferences",
    ] {
        let mut rows = vec![
            json!({ "id": 1, "companyId": 7 }),
            json!({ "id": 2, "companyId": null }),
            json!({ "id": 3, "companyId": 8 }),
        ];

        assert!(filter_direct_crm_company_rows(resource, 7, &mut rows));
        assert_eq!(rows, vec![json!({ "id": 1, "companyId": 7 })]);
    }
}

#[test]
fn parent_visibility_excludes_null_cross_company_and_deleted_rows() {
    let rows = vec![
        json!({ "id": 1, "companyId": 7, "deletedAt": null }),
        json!({ "id": 2, "companyId": null, "deletedAt": null }),
        json!({ "id": 3, "companyId": 8, "deletedAt": null }),
        json!({ "id": 4, "companyId": 7, "deletedAt": { "some": [1] } }),
    ];

    assert_eq!(visible_parent_ids_from_rows(&rows, 7), HashSet::from([1]));
}

#[test]
fn explicitly_organization_shared_resources_are_not_direct_company_filtered() {
    let mut rows = vec![json!({ "id": 1, "organizationId": 9 })];

    assert!(!filter_direct_crm_company_rows(
        "contact-tags",
        7,
        &mut rows
    ));
    assert_eq!(rows, vec![json!({ "id": 1, "organizationId": 9 })]);

    let mut rows = vec![json!({ "id": 1, "organizationId": 9 })];
    assert!(!filter_direct_crm_company_rows(
        "contact-categories",
        7,
        &mut rows
    ));
    assert_eq!(rows, vec![json!({ "id": 1, "organizationId": 9 })]);
}

#[test]
fn realtime_exact_company_resources_project_company_id() {
    for resource in [
        "contacts",
        "opportunities",
        "opportunity-lines",
        "opportunity-presence",
        "contact-phone-identities",
        "contact-role-assignments",
        "contact-communication-preferences",
        "contact-tag-assignments",
        "contact-category-assignments",
        "segment-members",
        "privacy-consent",
        "contact-relationship-insights",
        "contact-relationships",
        "contact-duplicate-candidates",
        "crm-forecast-snapshots",
        "crm-conversations",
        "crm-conversation-messages",
    ] {
        let entry = registry_get(resource).expect("CRM resource must be registered");
        assert!(
            entry.mandatory.iter().any(|field| field == "company_id"),
            "{resource} must project company_id for exact realtime filtering"
        );
    }

    for resource in [
        "leads",
        "activity-types",
        "lead-sources",
        "lead-lost-reasons",
        "opportunity-stages",
        "contact-tags",
        "contact-categories",
        "contact-segments",
        "assignment-rules",
        "activities",
        "calendar-events",
        "utm-campaigns",
        "utm-media",
        "utm-sources",
        "lead-scores",
        "lead-score-factors",
        "contact-segment-rules",
    ] {
        let entry = registry_get(resource).expect("shared CRM resource must be registered");
        assert!(
            !entry.mandatory.iter().any(|field| field == "company_id"),
            "{resource} is explicitly organization-shared"
        );
    }
}

#[test]
fn crm_resource_classification_is_narrow() {
    assert!(crm_resource("contacts"));
    assert!(crm_resource("crm-conversation-messages"));
    assert!(!crm_resource("account-moves"));
}

#[test]
fn row_id_u64_strict_roundtrips_boundary_values() {
    // 2^53 — largest JS-safe integer
    let at_boundary = json!({ "id": "9007199254740992" });
    assert_eq!(
        row_id_u64_strict(&at_boundary).unwrap(),
        9007199254740992u64
    );

    // 2^53 + 1 — first value that JS Number silently truncates
    let above_boundary = json!({ "id": "9007199254740993" });
    assert_eq!(
        row_id_u64_strict(&above_boundary).unwrap(),
        9007199254740993u64
    );

    // near u64::MAX
    let near_max = json!({ "id": "18446744073709551614" });
    assert_eq!(
        row_id_u64_strict(&near_max).unwrap(),
        18446744073709551614u64
    );

    // numeric form also accepted
    let numeric = json!({ "id": 42u64 });
    assert_eq!(row_id_u64_strict(&numeric).unwrap(), 42u64);
}

#[test]
fn row_id_u64_strict_rejects_bad_inputs() {
    assert!(row_id_u64_strict(&json!({})).is_err(), "missing id field");
    assert!(
        row_id_u64_strict(&json!({ "id": null })).is_err(),
        "null id"
    );
    assert!(
        row_id_u64_strict(&json!({ "id": "" })).is_err(),
        "empty string"
    );
    assert!(
        row_id_u64_strict(&json!({ "id": "-1" })).is_err(),
        "negative string"
    );
    assert!(
        row_id_u64_strict(&json!({ "id": "3.14" })).is_err(),
        "float string"
    );
    assert!(
        row_id_u64_strict(&json!({ "id": "not_a_number" })).is_err(),
        "non-numeric string"
    );
}

#[test]
fn optional_u64_returns_ok_none_for_absent_and_null() {
    assert_eq!(optional_u64(None).unwrap(), None);
    assert_eq!(optional_u64(Some(&json!(null))).unwrap(), None);
    assert_eq!(optional_u64(Some(&json!({ "none": [] }))).unwrap(), None);
}

#[test]
fn optional_u64_parses_string_at_boundary_values() {
    let v = json!("9007199254740993");
    assert_eq!(optional_u64(Some(&v)).unwrap(), Some(9007199254740993u64));

    let v2 = json!({ "some": ["18446744073709551614"] });
    assert_eq!(
        optional_u64(Some(&v2)).unwrap(),
        Some(18446744073709551614u64)
    );
}

#[test]
fn optional_u64_errors_on_present_but_unparseable_value() {
    assert!(
        optional_u64(Some(&json!("not_a_number"))).is_err(),
        "non-numeric string should be an error"
    );
    assert!(
        optional_u64(Some(&json!("-5"))).is_err(),
        "negative string should be an error"
    );
    assert!(
        optional_u64(Some(&json!({ "some": ["bad"] }))).is_err(),
        "invalid some value should be an error"
    );
}

#[test]
fn inventory_resource_classification_covers_expected_resources() {
    assert!(inventory_resource("stock-quants"));
    assert!(inventory_resource("stock-pickings"));
    assert!(inventory_resource("warehouses"));
    assert!(inventory_resource("quality-checks"));
    assert!(!inventory_resource("quality-teams"));
    assert!(inventory_resource("replenishment-rules"));
    assert!(inventory_resource("picking-batches"));
    assert!(!inventory_resource("account-moves"));
    assert!(!inventory_resource("contacts"));
}

#[test]
fn accounting_resource_classification_covers_company_scoped_tables() {
    for resource in [
        "account-accounts",
        "account-assets",
        "account-groups",
        "account-journals",
        "account-move-lines",
        "account-moves",
        "account-payments",
        "account-periods",
        "account-reconciliation-widgets",
        "account-taxes",
        "amortization-lines",
        "amortization-schedules",
        "analytic-accounts",
        "analytic-distribution-models",
        "analytic-lines",
        "bank-statements",
        "budgets",
        "budget-lines",
        "budget-posts",
        "consolidation-elimination-entries",
        "depreciation-lines",
        "fiscal-years",
        "fixed-assets",
        "fx-revaluation-runs",
        "partner-credit-controls",
        "partner-credit-holds",
        "payment-accounts",
        "payment-fees",
        "payment-reconciliations",
        "payment-reversals",
        "payment-transactions",
        "saved-reports",
        "tax-deadlines",
        "tax-groups",
        "tax-schedules",
    ] {
        assert!(
            accounting_resource(resource),
            "{resource} backs a required company_id column and must be scoped"
        );
    }
}

#[test]
fn accounting_resource_distinguishes_optional_company_and_org_wide_tables() {
    assert!(!accounting_resource("account-account-types"));
    assert!(optional_company_accounting_resource(
        "account-account-types"
    ));
    // These tables carry no company_id column and remain org-wide.
    assert!(!accounting_resource("account-payment-terms"));
    assert!(!accounting_resource("account-payment-term-lines"));
    assert!(!optional_company_accounting_resource(
        "account-payment-terms"
    ));
    // Sanity: not misclassified as another domain's resource.
    assert!(!accounting_resource("contacts"));
    assert!(!accounting_resource("stock-quants"));
    assert!(!crm_resource("account-accounts"));
    assert!(!inventory_resource("account-journals"));
    assert!(!purchasing_resource("account-moves"));
}

#[test]
fn accounting_resources_project_company_id_for_row_filtering() {
    for resource in [
        "account-accounts",
        "account-assets",
        "account-groups",
        "account-journals",
        "account-move-lines",
        "account-moves",
        "account-payments",
        "account-periods",
        "account-reconciliation-widgets",
        "account-taxes",
        "amortization-lines",
        "amortization-schedules",
        "analytic-accounts",
        "analytic-distribution-models",
        "analytic-lines",
        "bank-statements",
        "budgets",
        "budget-lines",
        "budget-posts",
        "consolidation-elimination-entries",
        "depreciation-lines",
        "fiscal-years",
        "fixed-assets",
        "fx-revaluation-runs",
        "partner-credit-controls",
        "partner-credit-holds",
        "payment-accounts",
        "payment-fees",
        "payment-reconciliations",
        "payment-reversals",
        "payment-transactions",
        "tax-deadlines",
        "tax-groups",
        "tax-schedules",
    ] {
        let entry = registry_get(resource).expect("accounting resource must be registered");
        let projects_company_id = entry.mandatory.iter().any(|f| f == "company_id")
            || entry.default_restricted.iter().any(|f| f == "company_id");
        assert!(
            projects_company_id,
            "{resource} must project company_id by default for row_company_matches to work"
        );
    }
}

#[test]
fn accounting_company_scoped_rows_filtered_strictly_no_shared_fallback() {
    let mut rows = vec![
        json!({ "id": 1, "companyId": 7 }),
        json!({ "id": 2, "companyId": null }),
        json!({ "id": 3, "companyId": 8 }),
    ];
    rows.retain(|row| row_company_matches(row, 7, false));
    assert_eq!(rows, vec![json!({ "id": 1, "companyId": 7 })]);
}

#[test]
fn malformed_company_fields_fail_closed_even_for_shared_scope() {
    for row in [
        json!({ "companyId": "not-a-number" }),
        json!({ "companyId": -1 }),
    ] {
        assert!(!row_company_matches(&row, 7, true));
    }
    assert!(row_company_matches(&json!({ "companyId": null }), 7, true));
}

#[test]
fn accounting_optional_company_rows_include_selected_and_shared_only() {
    let entry = registry_get("account-account-types")
        .expect("optional-company accounting resource must be registered");
    assert!(entry
        .default_restricted
        .iter()
        .any(|field| field == "company_id"));

    let mut rows = vec![
        json!({ "id": 1, "companyId": 7 }),
        json!({ "id": 2, "companyId": null }),
        json!({ "id": 3, "companyId": 8 }),
    ];
    rows.retain(|row| row_company_matches(row, 7, true));
    assert_eq!(
        rows,
        vec![
            json!({ "id": 1, "companyId": 7 }),
            json!({ "id": 2, "companyId": null }),
        ]
    );
}

#[test]
fn iot_resource_classification_covers_every_company_owned_table() {
    for resource in [
        "iot-actions",
        "iot-alerts",
        "iot-devices",
        "iot-hubs",
        "iot-pairing-tokens",
        "iot-telemetry",
        "iot-thresholds",
    ] {
        assert!(iot_resource(resource), "{resource} must be company-scoped");
    }
    assert!(!iot_resource("contacts"));
    assert!(!iot_resource("pos-configs"));
}

#[test]
fn iot_read_permission_accepts_module_and_resource_permissions() {
    let module_reader = authoritative_access("module:iot:read");
    for resource in [
        "iot-actions",
        "iot-alerts",
        "iot-devices",
        "iot-hubs",
        "iot-pairing-tokens",
        "iot-telemetry",
        "iot-thresholds",
    ] {
        assert!(
            has_iot_read_permission(Some(&module_reader), resource),
            "{resource} must accept the checked-in Manager module permission"
        );
    }

    let resource_reader = authoritative_access("iot_hub:read");
    assert!(has_iot_read_permission(Some(&resource_reader), "iot-hubs"));

    let writer = authoritative_access("module:iot:write");
    assert!(!has_iot_read_permission(Some(&writer), "iot-hubs"));
    assert!(!has_iot_read_permission(None, "iot-hubs"));
}

#[test]
fn iot_resources_project_company_id_for_defense_in_depth() {
    for resource in [
        "iot-actions",
        "iot-alerts",
        "iot-devices",
        "iot-hubs",
        "iot-pairing-tokens",
        "iot-telemetry",
        "iot-thresholds",
    ] {
        let columns = resolve_http_sql_columns(resource, None).expect("IoT HTTP projection");
        assert!(
            columns.iter().any(|column| column == "company_id"),
            "{resource} must project company_id for post-fetch verification"
        );
    }
}

#[test]
fn iot_company_scoped_rows_exclude_null_and_cross_company_values() {
    let mut rows = vec![
        json!({ "id": 1, "companyId": 7 }),
        json!({ "id": 2, "companyId": null }),
        json!({ "id": 3, "companyId": 8 }),
    ];
    rows.retain(|row| row_company_matches(row, 7, false));
    assert_eq!(rows, vec![json!({ "id": 1, "companyId": 7 })]);
}

#[test]
fn domain_postfilters_preserve_shared_and_projected_company_contracts() {
    let input = vec![
        json!({"id": 1, "companyId": 7}),
        json!({"id": 2, "company_id": {"none": []}}),
        json!({"id": 3, "companyId": 8}),
        json!({"id": 4, "companyId": "invalid"}),
    ];
    let expected_shared = vec![input[0].clone(), input[1].clone()];
    let expected_owned = vec![input[0].clone()];
    for (resource, expected) in [
        ("product-categories", &expected_shared),
        ("stock-locations", &expected_owned),
    ] {
        let mut rows = input.clone();
        inventory::filter_inventory_company_rows(resource, 7, &mut rows);
        assert_eq!(&rows, expected, "{resource}");
    }
    for (resource, expected) in [
        ("account-account-types", &expected_shared),
        ("account-moves", &expected_owned),
    ] {
        let mut rows = input.clone();
        accounting::filter_accounting_company_rows(resource, 7, &mut rows);
        assert_eq!(&rows, expected, "{resource}");
    }
    // Saved-report SQL already bounds the company; restricted result fields
    // intentionally omit company_id and must survive the later row check.
    let mut reports = vec![json!({"id": 5, "name": "Balance sheet"})];
    accounting::filter_accounting_company_rows("saved-reports", 7, &mut reports);
    assert_eq!(reports, vec![json!({"id": 5, "name": "Balance sheet"})]);
}
