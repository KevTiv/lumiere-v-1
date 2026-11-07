use super::*;
use serde_json::json;

const ACTOR: &str = "abababababababababababababababababababababababababababababababab";

fn access(grants: &[&str], fields: Option<&[&str]>) -> FieldAccessContext {
    let mut result = FieldAccessContext {
        organization_id: 42,
        identity_hex: ACTOR.into(),
        role_id: 2,
        role_ids: vec![2],
        role_permissions: grants.iter().map(|value| (*value).into()).collect(),
        ..FieldAccessContext::default()
    };
    if let Some(fields) = fields {
        result.field_permissions.push(serde_json::from_value(json!({
            "organizationId":42,"roleId":2,"resource":"sale-orders","action":"read","allowedFields":fields
        })).unwrap());
    }
    result
}

fn evidence(changes: Value) -> Value {
    json!({"id":601,"organization_id":42,"company_id":7,"resource":"sale_order","record_id":9,
        "subject_resource":"sale_order","subject_record_id":9,"operation":"update_sale_order",
        "actor_identity":ACTOR,"occurred_at":1_762_000_000_123_456_i64,"schema_version":1,
        "changes_json":changes.to_string()})
}

#[test]
fn closed_alpha_adapters_use_existing_registry_owners() {
    let adapters = record_adapters();
    let mut tables = HashSet::new();
    for (module, resources) in MODULE_RESOURCES {
        for resource in *resources {
            assert!(
                registry_get(resource).is_some(),
                "missing canonical {module} resource {resource}"
            );
        }
    }
    for adapter in adapters {
        if let Some(entry) = registry_get(adapter.resource) {
            assert_eq!(entry.table, adapter.table);
        } else {
            assert!(SUPPORTING_ADAPTERS
                .iter()
                .any(|source| source.table == adapter.table));
        }
        assert!(
            tables.insert(adapter.table),
            "ambiguous source owner {}",
            adapter.table
        );
        assert_eq!(
            record_adapter(adapter.table).unwrap().resource,
            adapter.resource
        );
    }
    for invalid in [
        "audit_log",
        "business_change",
        "organization_commit",
        "hr_payslip",
        "sale_order' OR 1=1",
        "pos_order",
    ] {
        assert!(record_adapter(invalid).is_err(), "{invalid}");
    }
    for module in [
        "accounting",
        "sales",
        "crm",
        "purchasing",
        "reports",
        "subscriptions",
        "expenses",
        "products",
        "warehouse",
        "fleet",
        "documents",
        "calendar",
        "tasks",
        "settings",
        "approvals",
        "ai-assistant",
    ] {
        assert!(
            record_adapters()
                .iter()
                .any(|adapter| adapter.module == module),
            "{module}"
        );
    }
}

#[test]
fn private_supporting_sources_use_their_owner_permissions_and_fail_closed_field_rules() {
    let task = record_adapter("workflow_human_task").unwrap();
    let context = access(&["business_history:read", "workflow:read"], None);
    assert_eq!(
        visible_fields(&context, &task).unwrap(),
        HashSet::from(["status".into(), "revision".into(), "decision".into()])
    );
    assert!(visible_fields(&access(&["business_history:read"], None), &task).is_err());
    let mut denied = context.clone();
    denied.org_permissions.push(stdb_auth::ActionPermission {
        resource: "workflow-human-tasks".into(),
        action: "read".into(),
        allow: false,
    });
    assert!(visible_fields(&denied, &task).is_err());
    let draft = record_adapter("ai_action_draft").unwrap();
    let mut context = access(&["business_history:read", "ai_action_draft:read"], None);
    let fields = visible_fields(&context, &draft).unwrap();
    assert!(fields.contains("status"));
    assert!(!fields.contains("params_json"));
    context.field_permissions.push(serde_json::from_value(json!({
        "organizationId":42,"roleId":2,"resource":"ai-action-drafts","action":"read","allowedFields":["status"]
    })).unwrap());
    assert!(visible_fields(&context, &draft).unwrap().is_empty());
}

#[test]
fn history_and_source_authority_are_both_required() {
    let adapter = record_adapter("sale_order").unwrap();
    for grants in [
        &[][..],
        &["audit_log:read"][..],
        &["sale_order:read"][..],
        &["business_history:read"][..],
    ] {
        assert!(visible_fields(&access(grants, None), &adapter).is_err());
    }
    let mut context = access(&["business_history:read", "sale_order:read"], None);
    assert!(visible_fields(&context, &adapter).is_ok());
    context.org_permissions.push(stdb_auth::ActionPermission {
        resource: "business_history".into(),
        action: "read".into(),
        allow: false,
    });
    assert!(visible_fields(&context, &adapter).is_err());
}

#[test]
fn field_redaction_preserves_exact_values_and_hides_private_only_events() {
    let adapter = record_adapter("sale_order").unwrap();
    let fields = HashSet::from(["name".into()]);
    let row = evidence(json!([
        {"field":"name","before":"OLD","after":"NEW"},
        {"field":"amount_total","before":"9007199254740993.10","after":"9007199254740993.20"},
        {"field":"metadata","before":null,"after":"secret"}
    ]));
    let event = generic_entry(&row, 42, Some(7), &adapter, &fields)
        .unwrap()
        .unwrap();
    let value = serde_json::to_value(event).unwrap();
    assert_eq!(
        value["changes"],
        json!([{"field":"name","before":"OLD","after":"NEW"}])
    );
    assert_eq!(value["resource"], "sale_order");
    assert_eq!(value["recordId"], "9");
    assert!(!value.to_string().contains("secret"));
    assert!(generic_entry(&row, 42, Some(7), &adapter, &HashSet::new())
        .unwrap()
        .is_none());
    let exact = generic_entry(
        &row,
        42,
        Some(7),
        &adapter,
        &HashSet::from(["amount_total".into()]),
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        exact.entry.changes[0].after.as_deref(),
        Some("9007199254740993.20")
    );
}

#[test]
fn summaries_are_explicit_and_malformed_evidence_is_rejected() {
    let adapter = record_adapter("sale_order").unwrap();
    let fields = HashSet::from(["name".into()]);
    let row = evidence(json!([]));
    assert!(generic_entry(&row, 42, Some(7), &adapter, &fields)
        .unwrap()
        .unwrap()
        .entry
        .changes
        .is_empty());
    for (field, replacement) in [
        ("organization_id", json!(43)),
        ("company_id", json!(8)),
        ("schema_version", json!(2)),
        ("subject_resource", json!("contact")),
        ("subject_record_id", json!(10)),
        ("operation", json!("log_audit_event")),
        ("actor_identity", json!("invented")),
    ] {
        let mut changed = row.clone();
        changed[field] = replacement;
        assert!(
            generic_entry(&changed, 42, Some(7), &adapter, &fields).is_err(),
            "{field}"
        );
    }
    for changes in [
        json!([{"field":"name","before":"same","after":"same"}]),
        json!([{"field":"name","before":1,"after":2}]),
        json!([{"field":"name","before":"a","after":"b"},{"field":"name","before":"b","after":"c"}]),
    ] {
        assert!(generic_entry(&evidence(changes), 42, Some(7), &adapter, &fields).is_err());
    }
    for field in [
        "metadata",
        "password_hash",
        "client_secret",
        "access_token",
        "private_key",
    ] {
        assert!(!history_field_allowed(field));
    }
}

#[test]
fn summary_activity_requires_the_normal_material_field_projection() {
    let adapter = record_adapter("sale_order").unwrap();
    let full = access(&["business_history:read", "sale_order:read"], None);
    assert!(summary_allowed(&full, &adapter, &visible_fields(&full, &adapter).unwrap()).unwrap());
    let restricted = access(
        &["business_history:read", "sale_order:read"],
        Some(&["name"]),
    );
    let fields = visible_fields(&restricted, &adapter).unwrap();
    assert!(fields.contains("name"));
    assert!(!summary_allowed(&restricted, &adapter, &fields).unwrap());
}

#[test]
fn cursor_rejects_table_module_company_and_actor_reuse() {
    let query = HistoryQuery {
        company_id: 7,
        cursor: Some("gh1.42.7.sale_order:9.actor.601.9".into()),
        limit: Some(20),
    };
    assert_eq!(
        provider_positions(&query, "gh1.42.7.sale_order:9.actor.").unwrap(),
        (601, 9)
    );
    for prefix in [
        "gh1.42.8.sale_order:9.actor.",
        "gh1.42.7.purchase_order:9.actor.",
        "gh1.42.7.module:sales.actor.",
        "gh1.42.7.sale_order:9.other.",
    ] {
        assert!(provider_positions(&query, prefix).is_err());
    }
}

#[test]
fn organization_scope_matches_the_canonical_storage_policy() {
    let policies: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../lumiere-codegen/storage-policy-manifest.json"
    )))
    .unwrap();
    for adapter in record_adapters() {
        let policy = policies["policies"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["table"] == adapter.table)
            .unwrap();
        let expected =
            policy["company_ownership"] == "none" || policy["company_column_nullable"] == true;
        assert_eq!(organization_scope(&adapter), expected, "{}", adapter.table);
    }
}

#[test]
fn organization_evidence_has_distinct_identity_and_no_invented_company() {
    let adapter = record_adapter("product").unwrap();
    let mut row = evidence(json!([{"field":"name","before":"Old","after":"New"}]));
    row["resource"] = json!("product");
    row["subject_resource"] = json!("product");
    row.as_object_mut().unwrap().remove("company_id");
    let fields = HashSet::from(["name".into()]);
    let entry = generic_entry(&row, 42, None, &adapter, &fields)
        .unwrap()
        .unwrap();
    assert_eq!(entry.entry.id, "org:601");
    assert!(generic_entry(&row, 42, Some(7), &adapter, &fields).is_err());
    assert!(generic_entry(&row, 42, None, &adapter, &HashSet::new())
        .unwrap()
        .is_none());
}

#[test]
fn legacy_expense_evidence_binds_to_the_canonical_current_sheet() {
    let adapter = record_adapter("hr_expense_sheet").unwrap();
    assert_eq!(adapter.table, "expense_sheet");
    let mut row = evidence(json!([{"field":"state","before":"draft","after":"submitted"}]));
    row["resource"] = json!("hr_expense_sheet");
    row["subject_resource"] = json!("hr_expense_sheet");
    let event = generic_entry(
        &row,
        42,
        Some(7),
        &adapter,
        &HashSet::from(["state".into()]),
    )
    .unwrap()
    .unwrap();
    assert_eq!(event.resource, "expense_sheet");
    assert_eq!(event.entry.changed_resource, "expense-sheets");
}

#[test]
fn legacy_document_evidence_uses_only_verified_native_aliases() {
    for (alias, canonical, resource) in [
        ("document_folder", "doc_folder", "document-folders"),
        (
            "knowledge_article_category",
            "kb_category",
            "knowledge-categories",
        ),
    ] {
        let adapter = record_adapter(alias).unwrap();
        assert_eq!(adapter.table, canonical);
        let predicate = resource_predicate(&adapter);
        assert!(predicate.contains(&format!("resource = '{alias}'")));
        assert!(predicate.contains(&format!("resource = '{canonical}'")));
        let mut row = evidence(json!([{"field":"name","before":"Old","after":"New"}]));
        row["resource"] = json!(alias);
        row["subject_resource"] = json!(alias);
        row.as_object_mut().unwrap().remove("company_id");
        let event = generic_entry(&row, 42, None, &adapter, &HashSet::from(["name".into()]))
            .unwrap()
            .unwrap();
        assert_eq!(event.resource, canonical);
        assert_eq!(event.entry.changed_resource, resource);
    }
    assert!(record_adapter("document_category").is_err());
}

#[test]
fn provider_merge_keeps_unconsumed_positions_and_distinct_ids() {
    let adapter = record_adapter("product").unwrap();
    let fields = HashSet::from(["name".into()]);
    let mut company = ProviderPage {
        entries: VecDeque::new(),
        after: 10,
        more: false,
    };
    let mut organization = ProviderPage {
        entries: VecDeque::new(),
        after: 20,
        more: false,
    };
    for (id, micros) in [
        (1, 1_762_000_000_000_000_i64),
        (10, 1_762_000_000_000_020_i64),
    ] {
        let mut row = evidence(json!([{"field":"name","before":"a","after":"b"}]));
        row["id"] = json!(id);
        row["resource"] = json!("product");
        row["subject_resource"] = json!("product");
        row["occurred_at"] = json!(micros);
        company.entries.push_back(
            generic_entry(&row, 42, Some(7), &adapter, &fields)
                .unwrap()
                .unwrap(),
        );
    }
    for (id, micros) in [
        (1, 1_762_000_000_000_010_i64),
        (20, 1_762_000_000_000_030_i64),
    ] {
        let mut row = evidence(json!([{"field":"name","before":"a","after":"b"}]));
        row["id"] = json!(id);
        row["resource"] = json!("product");
        row["subject_resource"] = json!("product");
        row["occurred_at"] = json!(micros);
        row.as_object_mut().unwrap().remove("company_id");
        organization.entries.push_back(
            generic_entry(&row, 42, None, &adapter, &fields)
                .unwrap()
                .unwrap(),
        );
    }
    let (first, positions, more) =
        merge_providers(&mut company, &mut organization, (0, 0), 2).unwrap();
    assert_eq!(
        first
            .iter()
            .map(|row| row.entry.id.as_str())
            .collect::<Vec<_>>(),
        ["1", "org:1"]
    );
    assert_eq!(positions, (1, 1));
    assert!(more);
    let (second, positions, more) =
        merge_providers(&mut company, &mut organization, positions, 2).unwrap();
    assert_eq!(
        second
            .iter()
            .map(|row| row.entry.id.as_str())
            .collect::<Vec<_>>(),
        ["10", "org:20"]
    );
    assert_eq!(positions, (10, 20));
    assert!(!more);
}

#[tokio::test]
async fn generalized_record_reader_keeps_exact_source_and_field_authority() {
    use super::super::tests as fixture;
    let server = fixture::server(
        vec![fixture::evidence(
            601,
            json!([
                {"field":"debit","before":"0","after":"9007199254740993.20"},
                {"field":"name","before":"PRIVATE","after":"PRIVATE-UPDATED"}
            ]),
        )],
        Some(&["debit"]),
        true,
        true,
        false,
    )
    .await;
    let context = fixture::context(
        &server,
        fixture::access(
            &[
                "business_history:read",
                "account_move:read",
                "account_move_line:read",
            ],
            Some(&["debit"]),
        ),
    );
    let page = read_general(
        &server.owner,
        &context,
        &[record_adapter("account_move").unwrap()],
        Some(9),
        None,
        &fixture::request(None, 10),
    )
    .await
    .unwrap();
    assert_eq!(page.data.len(), 1);
    assert_eq!(page.data[0].entry.id, "601");
    assert_eq!(page.data[0].entry.changes.len(), 1);
    assert_eq!(page.data[0].entry.changes[0].field, "debit");
    assert!(!serde_json::to_string(&page).unwrap().contains("PRIVATE"));
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn generic_pagination_reaches_sparse_history_beyond_organization_latest_500() {
    use super::super::tests as fixture;
    let events = [1, 601, 1_000_000_000]
        .into_iter()
        .map(|id| fixture::evidence(id, json!([{"field":"debit","before":"0","after":"1"}])))
        .collect();
    let server = fixture::server(events, None, true, true, false).await;
    let context = fixture::context(
        &server,
        fixture::access(
            &[
                "business_history:read",
                "account_move:read",
                "account_move_line:read",
            ],
            None,
        ),
    );
    let mut cursor = None;
    let mut ids = Vec::new();
    for _ in 0..12 {
        let page = read_general(
            &server.owner,
            &context,
            &[record_adapter("account_move").unwrap()],
            Some(9),
            None,
            &fixture::request(cursor, 1),
        )
        .await
        .unwrap();
        ids.extend(page.data.into_iter().map(|event| event.entry.id));
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(ids, ["1", "601", "1000000000"]);
    assert!(cursor.is_none());
}

#[tokio::test]
async fn generic_history_revocation_discards_loaded_private_evidence() {
    use super::super::tests as fixture;
    let server = fixture::server(
        vec![fixture::evidence(
            601,
            json!([{"field":"debit","before":"0","after":"10"}]),
        )],
        None,
        true,
        true,
        true,
    )
    .await;
    let context = fixture::context(
        &server,
        fixture::access(
            &[
                "business_history:read",
                "account_move:read",
                "account_move_line:read",
            ],
            None,
        ),
    );
    assert!(matches!(
        read_general(
            &server.owner,
            &context,
            &[record_adapter("account_move").unwrap()],
            Some(9),
            None,
            &fixture::request(None, 10)
        )
        .await,
        Err(ApiError::Forbidden(_))
    ));
}

#[tokio::test]
async fn summary_is_withheld_when_material_field_access_is_revoked_during_the_read() {
    use super::super::tests as fixture;
    let mut row = fixture::evidence(601, json!([]));
    row["subject_resource"] = json!("account_move");
    row["subject_record_id"] = json!(9);
    row["operation"] = json!("post_account_move");
    let server = fixture::server(vec![row], None, true, true, false).await;
    fixture::restrict_fields_after_evidence(&server);
    let context = fixture::context(
        &server,
        fixture::access(
            &[
                "business_history:read",
                "account_move:read",
                "account_move_line:read",
            ],
            None,
        ),
    );
    let page = read_general(
        &server.owner,
        &context,
        &[record_adapter("account_move").unwrap()],
        Some(9),
        None,
        &fixture::request(None, 10),
    )
    .await
    .unwrap();
    assert!(page.data.is_empty());
}

#[tokio::test]
async fn generic_record_admission_denies_a_missing_current_source() {
    use super::super::tests as fixture;
    let server = fixture::server(vec![], None, false, true, false).await;
    let context = fixture::context(
        &server,
        fixture::access(
            &[
                "business_history:read",
                "account_move:read",
                "account_move_line:read",
            ],
            None,
        ),
    );
    assert!(matches!(
        read_general(
            &server.owner,
            &context,
            &[record_adapter("account_move").unwrap()],
            Some(9),
            None,
            &fixture::request(None, 10)
        )
        .await,
        Err(ApiError::NotFound(_))
    ));
}

#[tokio::test]
async fn http_reader_queries_legacy_expense_alias_under_the_canonical_source_owner() {
    use super::super::tests as fixture;
    let mut row = evidence(json!([{"field":"state","before":"draft","after":"submitted"}]));
    row["resource"] = json!("hr_expense_sheet");
    row["subject_resource"] = json!("hr_expense_sheet");
    let server = fixture::server(vec![row], None, true, true, false).await;
    let context = fixture::context(
        &server,
        fixture::access(&["business_history:read", "expense_sheet:read"], None),
    );
    let page = read_general(
        &server.owner,
        &context,
        &[record_adapter("expense_sheet").unwrap()],
        Some(9),
        None,
        &fixture::request(None, 10),
    )
    .await
    .unwrap();
    assert_eq!(page.data.len(), 1);
    assert_eq!(page.data[0].resource, "expense_sheet");
    assert_eq!(page.data[0].entry.changes[0].field, "state");
}

#[tokio::test]
async fn http_reader_merges_company_and_organization_evidence_without_skipping_a_provider() {
    use super::super::tests as fixture;
    let mut events = Vec::new();
    for (id, micros, organization) in [
        (1, 1_762_000_000_000_000_i64, false),
        (1, 1_762_000_000_000_010_i64, true),
        (601, 1_762_000_000_000_020_i64, false),
        (901, 1_762_000_000_000_030_i64, true),
    ] {
        let mut row = evidence(json!([{"field":"name","before":"before","after":"after"}]));
        row["id"] = json!(id);
        row["resource"] = json!("product");
        row["subject_resource"] = json!("product");
        row["occurred_at"] = json!(micros);
        if organization {
            row.as_object_mut().unwrap().remove("company_id");
        }
        events.push(row);
    }
    let server = fixture::server(events, None, true, true, false).await;
    let context = fixture::context(
        &server,
        fixture::access(&["business_history:read", "product:read"], None),
    );
    let mut cursor = None;
    let mut ids = Vec::new();
    for _ in 0..10 {
        let page = read_general(
            &server.owner,
            &context,
            &[record_adapter("product").unwrap()],
            Some(9),
            None,
            &fixture::request(cursor, 1),
        )
        .await
        .unwrap();
        ids.extend(page.data.into_iter().map(|event| event.entry.id));
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(ids, ["1", "org:1", "601", "org:901"]);
    assert!(cursor.is_none());
}
