/// Privacy Module Tests
///
/// Test reducers for DataClassification, DataClassificationRule, and PrivacyConsent tables.
use spacetimedb::{ReducerContext, Table};

use crate::core::privacy::{
    data_classification, data_classification_rule, privacy_consent,
    create_data_classification, create_data_classification_rule, record_privacy_consent,
};
use crate::core::organization::{organization, create_organization};

/// Test privacy system lifecycle
#[spacetimedb::reducer]
pub fn test_privacy_system(ctx: &ReducerContext) -> Result<(), String> {
    // Test 1: Create test organization
    log::info!("TEST: Creating test organization...");
    create_organization(
        ctx,
        "Privacy Test Org".to_string(),
        "PRIVORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "PRIVORG")
        .ok_or("Test org not found")?;

    let org_id = org.id;
    log::info!("✓ Test organization created");

    // Test 2: Create data classifications
    log::info!("TEST: Creating data classifications...");
    create_data_classification(
        ctx,
        org_id,
        "Public".to_string(),
        1,
        Some("Data that can be freely shared".to_string()),
        None,
        false,
    )?;

    create_data_classification(
        ctx,
        org_id,
        "Internal".to_string(),
        2,
        Some("Data for internal use only".to_string()),
        Some(365), // 1 year retention
        false,
    )?;

    create_data_classification(
        ctx,
        org_id,
        "Confidential".to_string(),
        3,
        Some("Sensitive data requiring protection".to_string()),
        Some(90), // 90 days retention
        true, // encryption required
    )?;

    create_data_classification(
        ctx,
        org_id,
        "Restricted".to_string(),
        4,
        Some("Highly sensitive data".to_string()),
        Some(30), // 30 days retention
        true,
    )?;

    let classifications: Vec<_> = ctx.db.data_classification()
        .data_class_by_org()
        .filter(&org_id)
        .collect();

    assert_eq!(classifications.len(), 4);

    let public = classifications.iter()
        .find(|c| c.name == "Public")
        .ok_or("Public classification not found")?;
    assert_eq!(public.level, 1);
    assert!(!public.encryption_required);

    let restricted = classifications.iter()
        .find(|c| c.name == "Restricted")
        .ok_or("Restricted classification not found")?;
    assert_eq!(restricted.level, 4);
    assert!(restricted.encryption_required);
    log::info!("✓ Data classifications created");

    // Test 3: Create data classification rules
    log::info!("TEST: Creating data classification rules...");
    let conf_id = classifications.iter()
        .find(|c| c.name == "Confidential")
        .ok_or("Confidential not found")?
        .id;

    create_data_classification_rule(
        ctx,
        org_id,
        "user_profile".to_string(),
        Some("ssn".to_string()),
        conf_id,
        "all".to_string(),
    )?;

    create_data_classification_rule(
        ctx,
        org_id,
        "user_profile".to_string(),
        Some("salary".to_string()),
        conf_id,
        "all".to_string(),
    )?;

    create_data_classification_rule(
        ctx,
        org_id,
        "contact".to_string(),
        None, // applies to whole table
        classifications.iter().find(|c| c.name == "Internal").ok_or("Internal not found")?.id,
        "all".to_string(),
    )?;

    let rules: Vec<_> = ctx.db.data_classification_rule()
        .class_rule_by_org()
        .filter(&org_id)
        .collect();

    assert_eq!(rules.len(), 3);

    let ssn_rule = rules.iter()
        .find(|r| r.table_name == "user_profile" && r.column_name == Some("ssn".to_string()))
        .ok_or("SSN rule not found")?;
    assert_eq!(ssn_rule.classification_id, conf_id);
    log::info!("✓ Data classification rules created");

    // Test 4: Record privacy consent - grant
    log::info!("TEST: Recording privacy consent (grant)...");
    record_privacy_consent(
        ctx,
        org_id,
        1, // contact_id
        "email_marketing".to_string(),
        true, // granted
        Some("192.168.1.1".to_string()),
        Some("Mozilla/5.0".to_string()),
    )?;

    let consents: Vec<_> = ctx.db.privacy_consent()
        .consent_by_contact()
        .filter(&1u64)
        .collect();

    assert!(!consents.is_empty());

    let email_consent = consents.iter()
        .find(|c| c.consent_type == "email_marketing")
        .ok_or("Email marketing consent not found")?;
    assert!(email_consent.granted);
    assert!(email_consent.granted_at.is_some());
    assert!(email_consent.revoked_at.is_none());
    log::info!("✓ Privacy consent granted");

    // Test 5: Record privacy consent - revoke
    log::info!("TEST: Recording privacy consent (revoke)...");
    record_privacy_consent(
        ctx,
        org_id,
        1, // same contact
        "email_marketing".to_string(),
        false, // revoked
        Some("192.168.1.1".to_string()),
        Some("Mozilla/5.0".to_string()),
    )?;

    let revoked_consents: Vec<_> = ctx.db.privacy_consent()
        .consent_by_contact()
        .filter(&1u64)
        .collect();

    assert_eq!(revoked_consents.len(), 2); // Two records: grant and revoke

    let revoke_record = revoked_consents.iter()
        .find(|c| !c.granted)
        .ok_or("Revoke record not found")?;
    assert!(!revoke_record.granted);
    assert!(revoke_record.granted_at.is_none());
    assert!(revoke_record.revoked_at.is_some());
    log::info!("✓ Privacy consent revoked");

    // Test 6: Multiple consent types
    log::info!("TEST: Multiple consent types...");
    record_privacy_consent(
        ctx,
        org_id,
        1,
        "sms_marketing".to_string(),
        true,
        None,
        None,
    )?;

    record_privacy_consent(
        ctx,
        org_id,
        1,
        "data_processing".to_string(),
        true,
        None,
        None,
    )?;

    record_privacy_consent(
        ctx,
        org_id,
        2, // different contact
        "email_marketing".to_string(),
        true,
        None,
        None,
    )?;

    let all_consents: Vec<_> = ctx.db.privacy_consent()
        .consent_by_org()
        .filter(&org_id)
        .collect();

    assert!(all_consents.len() >= 4);
    log::info!("✓ Multiple consent types created");

    // Test 7: Query consents by contact
    log::info!("TEST: Querying consents by contact...");
    let contact1_consents: Vec<_> = ctx.db.privacy_consent()
        .consent_by_contact()
        .filter(&1u64)
        .collect();

    assert!(!contact1_consents.is_empty());
    log::info!("✓ Consents query by contact works");

    // Test 8: Query consents by organization
    log::info!("TEST: Querying consents by organization...");
    let org_consents: Vec<_> = ctx.db.privacy_consent()
        .consent_by_org()
        .filter(&org_id)
        .collect();

    assert!(!org_consents.is_empty());
    log::info!("✓ Consents query by organization works");

    // Test 9: Verify timestamps
    log::info!("TEST: Verifying timestamps...");
    let consent = &all_consents[0];
    assert!(consent.granted_at.is_some() || consent.revoked_at.is_some());
    log::info!("✓ Timestamps verified");

    log::info!("✅ All privacy system tests passed!");
    Ok(())
}

/// Test classification level validation
#[spacetimedb::reducer]
pub fn test_classification_level_validation(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    create_organization(
        ctx,
        "Classification Val Org".to_string(),
        "CVALORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "CVALORG")
        .ok_or("Test org not found")?;

    // Test 1: Invalid level 0
    log::info!("TEST: Invalid level 0...");
    let result = create_data_classification(
        ctx,
        org.id,
        "Invalid".to_string(),
        0,
        None,
        None,
        false,
    );
    assert!(result.is_err());
    log::info!("✓ Level 0 rejected");

    // Test 2: Invalid level 5
    log::info!("TEST: Invalid level 5...");
    let result = create_data_classification(
        ctx,
        org.id,
        "Invalid".to_string(),
        5,
        None,
        None,
        false,
    );
    assert!(result.is_err());
    log::info!("✓ Level 5 rejected");

    // Test 3: Valid levels 1-4
    log::info!("TEST: Valid levels 1-4...");
    for level in 1..=4 {
        create_data_classification(
            ctx,
            org.id,
            format!("Level {}", level),
            level,
            None,
            None,
            false,
        )?;
    }

    let classifications: Vec<_> = ctx.db.data_classification()
        .data_class_by_org()
        .filter(&org.id)
        .collect();

    assert_eq!(classifications.len(), 4);
    log::info!("✓ Valid levels 1-4 accepted");

    // Test 4: Verify level ordering
    log::info!("TEST: Classification level ordering...");
    let levels: Vec<u8> = classifications.iter().map(|c| c.level).collect();
    for (i, &level) in levels.iter().enumerate() {
        assert_eq!(level, (i + 1) as u8);
    }
    log::info!("✓ Level ordering correct");

    log::info!("✅ Classification level validation tests passed!");
    Ok(())
}

/// Test privacy consent edge cases
#[spacetimedb::reducer]
pub fn test_privacy_consent_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    create_organization(
        ctx,
        "Consent Edge Org".to_string(),
        "CONEDGEORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "CONEDGEORG")
        .ok_or("Test org not found")?;

    // Test 1: Consent without IP/user agent
    log::info!("TEST: Consent without tracking data...");
    record_privacy_consent(
        ctx,
        org.id,
        1,
        "minimal_consent".to_string(),
        true,
        None,
        None,
    )?;

    let minimal = ctx.db.privacy_consent()
        .iter()
        .find(|c| c.consent_type == "minimal_consent")
        .ok_or("Minimal consent not found")?;

    assert!(minimal.ip_address.is_none());
    assert!(minimal.user_agent.is_none());
    assert!(minimal.granted);
    log::info!("✓ Minimal consent recorded");

    // Test 2: Long consent type name
    log::info!("TEST: Long consent type name...");
    let long_type = "a".repeat(100);
    record_privacy_consent(
        ctx,
        org.id,
        1,
        long_type.clone(),
        true,
        None,
        None,
    )?;

    let long_consent = ctx.db.privacy_consent()
        .iter()
        .find(|c| c.consent_type == long_type)
        .ok_or("Long consent not found")?;

    assert_eq!(long_consent.consent_type.len(), 100);
    log::info!("✓ Long consent type handled");

    // Test 3: Special characters in consent type
    log::info!("TEST: Special characters in consent type...");
    record_privacy_consent(
        ctx,
        org.id,
        1,
        "consent-with_underscore.and.dot".to_string(),
        true,
        None,
        None,
    )?;

    let special = ctx.db.privacy_consent()
        .iter()
        .find(|c| c.consent_type == "consent-with_underscore.and.dot")
        .ok_or("Special consent not found")?;

    assert!(special.granted);
    log::info!("✓ Special characters handled");

    // Test 4: Multiple grants (should create new records)
    log::info!("TEST: Multiple grants for same type...");
    for i in 0..3 {
        record_privacy_consent(
            ctx,
            org.id,
            2,
            "repeated_consent".to_string(),
            true,
            Some(format!("192.168.1.{}", i)),
            None,
        )?;
    }

    let repeated: Vec<_> = ctx.db.privacy_consent()
        .iter()
        .filter(|c| c.contact_id == 2 && c.consent_type == "repeated_consent")
        .collect();

    assert_eq!(repeated.len(), 3);
    log::info!("✓ Multiple grants recorded");

    // Test 5: Grant-revoke-grant cycle
    log::info!("TEST: Grant-revoke-grant cycle...");

    // Grant
    record_privacy_consent(
        ctx,
        org.id,
        3,
        "cyclic_consent".to_string(),
        true,
        None,
        None,
    )?;

    // Revoke
    record_privacy_consent(
        ctx,
        org.id,
        3,
        "cyclic_consent".to_string(),
        false,
        None,
        None,
    )?;

    // Grant again
    record_privacy_consent(
        ctx,
        org.id,
        3,
        "cyclic_consent".to_string(),
        true,
        None,
        None,
    )?;

    let cyclic: Vec<_> = ctx.db.privacy_consent()
        .iter()
        .filter(|c| c.contact_id == 3 && c.consent_type == "cyclic_consent")
        .collect();

    assert_eq!(cyclic.len(), 3);

    // Last one should be grant
    let last = cyclic.last().ok_or("No cyclic records")?;
    assert!(last.granted);
    log::info!("✓ Grant-revoke-grant cycle recorded");

    log::info!("✅ Privacy consent edge case tests passed!");
    Ok(())
}

/// Test data classification rule edge cases
#[spacetimedb::reducer]
pub fn test_classification_rule_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    create_organization(
        ctx,
        "Rule Edge Org".to_string(),
        "RULEEDGEORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "RULEEDGEORG")
        .ok_or("Test org not found")?;

    // Create classification
    create_data_classification(
        ctx,
        org.id,
        "Test Class".to_string(),
        2,
        None,
        None,
        false,
    )?;

    let class = ctx.db.data_classification()
        .iter()
        .find(|c| c.name == "Test Class")
        .ok_or("Classification not found")?;

    // Test 1: Rule for whole table (no column)
    log::info!("TEST: Rule for whole table...");
    create_data_classification_rule(
        ctx,
        org.id,
        "whole_table".to_string(),
        None, // No column = whole table
        class.id,
        "all".to_string(),
    )?;

    let whole_rule = ctx.db.data_classification_rule()
        .iter()
        .find(|r| r.table_name == "whole_table")
        .ok_or("Whole table rule not found")?;

    assert!(whole_rule.column_name.is_none());
    log::info!("✓ Whole table rule created");

    // Test 2: Rule with filter expression
    log::info!("TEST: Rule with filter expression...");
    create_data_classification_rule(
        ctx,
        org.id,
        "filtered_table".to_string(),
        Some("notes".to_string()),
        class.id,
        "department == 'hr'".to_string(), // Filter expression
    )?;

    let filtered = ctx.db.data_classification_rule()
        .iter()
        .find(|r| r.table_name == "filtered_table")
        .ok_or("Filtered rule not found")?;

    assert_eq!(filtered.applies_to, "department == 'hr'");
    log::info!("✓ Rule with filter created");

    // Test 3: Multiple rules for same table
    log::info!("TEST: Multiple rules for same table...");
    create_data_classification_rule(
        ctx,
        org.id,
        "multi_column".to_string(),
        Some("col1".to_string()),
        class.id,
        "all".to_string(),
    )?;

    create_data_classification_rule(
        ctx,
        org.id,
        "multi_column".to_string(),
        Some("col2".to_string()),
        class.id,
        "all".to_string(),
    )?;

    create_data_classification_rule(
        ctx,
        org.id,
        "multi_column".to_string(),
        Some("col3".to_string()),
        class.id,
        "all".to_string(),
    )?;

    let multi_rules: Vec<_> = ctx.db.data_classification_rule()
        .iter()
        .filter(|r| r.table_name == "multi_column")
        .collect();

    assert_eq!(multi_rules.len(), 3);
    log::info!("✓ Multiple rules for same table created");

    // Test 4: Rule with long table/column names
    log::info!("TEST: Rule with long names...");
    let long_table = "a".repeat(50);
    let long_column = "b".repeat(50);

    create_data_classification_rule(
        ctx,
        org.id,
        long_table.clone(),
        Some(long_column.clone()),
        class.id,
        "all".to_string(),
    )?;

    let long_rule = ctx.db.data_classification_rule()
        .iter()
        .find(|r| r.table_name == long_table)
        .ok_or("Long name rule not found")?;

    assert_eq!(long_rule.table_name.len(), 50);
    assert_eq!(long_rule.column_name.as_ref().unwrap().len(), 50);
    log::info!("✓ Long names handled");

    // Test 5: Verify timestamps
    log::info!("TEST: Verify timestamps...");
    let rule = ctx.db.data_classification_rule()
        .iter()
        .find(|r| r.table_name == "multi_column")
        .ok_or("Rule not found")?;

    assert!(rule.created_at.to_micros_since_unix_epoch() > 0);
    log::info!("✓ Timestamps verified");

    log::info!("✅ Classification rule edge case tests passed!");
    Ok(())
}

/// Test data retention and encryption requirements
#[spacetimedb::reducer]
pub fn test_data_protection_settings(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    create_organization(
        ctx,
        "Protection Org".to_string(),
        "PROTORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "PROTORG")
        .ok_or("Test org not found")?;

    // Test 1: Classification without retention
    log::info!("TEST: Classification without retention...");
    create_data_classification(
        ctx,
        org.id,
        "No Retention".to_string(),
        1,
        None,
        None, // No retention limit
        false,
    )?;

    let no_ret = ctx.db.data_classification()
        .iter()
        .find(|c| c.name == "No Retention")
        .ok_or("No retention class not found")?;

    assert!(no_ret.retention_days.is_none());
    log::info!("✓ Classification without retention created");

    // Test 2: Classification with various retention periods
    log::info!("TEST: Various retention periods...");
    let retention_periods = vec![
        (30, "30 Days"),
        (90, "90 Days"),
        (365, "1 Year"),
        (2555, "7 Years"), // Long retention for compliance
    ];

    for (days, name) in retention_periods {
        create_data_classification(
            ctx,
            org.id,
            name.to_string(),
            2,
            None,
            Some(days),
            false,
        )?;
    }

    let with_retention: Vec<_> = ctx.db.data_classification()
        .iter()
        .filter(|c| c.retention_days.is_some())
        .collect();

    assert_eq!(with_retention.len(), 4);
    log::info!("✓ Various retention periods created");

    // Test 3: Encryption requirements
    log::info!("TEST: Encryption requirements...");
    create_data_classification(
        ctx,
        org.id,
        "Encrypted".to_string(),
        3,
        None,
        None,
        true, // Encryption required
    )?;

    create_data_classification(
        ctx,
        org.id,
        "Not Encrypted".to_string(),
        2,
        None,
        None,
        false, // No encryption
    )?;

    let encrypted = ctx.db.data_classification()
        .iter()
        .find(|c| c.name == "Encrypted")
        .ok_or("Encrypted class not found")?;

    let not_encrypted = ctx.db.data_classification()
        .iter()
        .find(|c| c.name == "Not Encrypted")
        .ok_or("Not encrypted class not found")?;

    assert!(encrypted.encryption_required);
    assert!(!not_encrypted.encryption_required);
    log::info!("✓ Encryption requirements set");

    // Test 4: Verify high-level classifications require encryption
    log::info!("TEST: High-level classification encryption...");
    create_data_classification(
        ctx,
        org.id,
        "Critical".to_string(),
        4,
        None,
        Some(7), // Short retention
        true, // Must be encrypted
    )?;

    let critical = ctx.db.data_classification()
        .iter()
        .find(|c| c.name == "Critical")
        .ok_or("Critical class not found")?;

    assert_eq!(critical.level, 4);
    assert!(critical.encryption_required);
    assert_eq!(critical.retention_days, Some(7));
    log::info!("✓ High-level classification with encryption");

    log::info!("✅ Data protection settings tests passed!");
    Ok(())
}
