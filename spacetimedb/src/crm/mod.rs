/// CRM & Contacts Module
///
/// Covers Phase 2 of the SpacetimeDB Migration Plan:
/// - Contacts & Companies (2.1)
/// - Leads & Opportunities (2.2)
/// - Activities & Tasks (2.3)
/// - Segments & Assignment (2.4)
///
/// # Module Structure
///
/// | Module | Tables |
/// |--------|--------|
/// | contacts | Contact, ContactCategory, ContactTag, ContactRelationship |
/// | contact_identities | ContactPhoneIdentity |
/// | contact_roles | ContactRoleAssignment |
/// | leads | Lead, LeadSource, LeadLostReason |
/// | opportunities | Opportunity, OpportunityStage, OpportunityLine |
/// | activities | Activity, ActivityType, CalendarEvent |
/// | segments | ContactSegment, SegmentMember, AssignmentRule |
pub mod activities;
pub mod contact_identities;
pub mod contact_roles;
pub mod contacts;
pub mod duplicate;
pub mod forecast;
pub mod inbox;
pub mod integrity_inventory;
pub mod lead_scoring;
pub mod leads;
pub mod opportunities;
pub mod presence;
pub mod relationship_intel;
pub mod segments;

use spacetimedb::ReducerContext;

use crate::core::organization::{
    company, default_company_id_for_organization, organization_settings,
};

/// Feature flag that opts an organization into multi-company CRM writes.
/// Not granted automatically by `feature_flags_for_plan` — must be set explicitly
/// on `OrganizationSettings.feature_flags` (e.g. via `spacetime sql` or a future
/// dedicated admin reducer).
pub const CRM_MULTI_COMPANY_FLAG: &str = "crm_multi_company";

/// Phase 0 containment guard (see `docs/plans/crm-relational-integrity-remediation-plan.md`,
/// CRM-RI-007/CRM-RI-008). This does NOT implement full company-scoped read/write
/// enforcement — that is tracked separately as a later phase. It only prevents an
/// organization with more than one active company from spreading CRM writes across
/// companies until it has been explicitly opted into `"crm_multi_company"`.
///
/// Organizations with 0 or 1 active company are always allowed (the common case is
/// unaffected). Organizations with more than 1 active company and without the flag
/// may only write CRM records scoped to `None` (unscoped/default) or to their single
/// default company; any other explicit company id is rejected.
pub fn require_single_company_crm_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
) -> Result<(), String> {
    let active_company_count = ctx
        .db
        .company()
        .company_by_org()
        .filter(&organization_id)
        .filter(|c| c.deleted_at.is_none())
        .count();

    if active_company_count <= 1 {
        return Ok(());
    }

    let has_multi_company_flag = ctx
        .db
        .organization_settings()
        .organization_id()
        .find(&organization_id)
        .map(|settings| {
            settings
                .feature_flags
                .iter()
                .any(|flag| flag == CRM_MULTI_COMPANY_FLAG)
        })
        .unwrap_or(false);
    if has_multi_company_flag {
        return Ok(());
    }

    let default_company_id = default_company_id_for_organization(ctx, organization_id)?;
    let is_default_or_unscoped = match company_id {
        None => true,
        Some(cid) => cid == default_company_id,
    };
    if is_default_or_unscoped {
        return Ok(());
    }

    Err(
        "CRM is restricted to a single company for this organization pending multi-company rollout (see CRM-RI-007)"
            .to_string(),
    )
}

// Re-export key types for convenience
pub use activities::{
    complete_activity, create_activity, create_calendar_event, delete_calendar_event,
    update_calendar_event, Activity, ActivityType, CalendarEvent, CreateActivityParams,
    CrmActivityTarget, UpdateCalendarEventParams,
};
pub use contact_identities::{
    archive_contact_identity, configure_contact_identity_verification_authority,
    contact_identity_evidence_hash, create_contact_identity, find_identity_by_normalized,
    mask_e164, normalize_phone, record_contact_identity_verification_proof,
    update_contact_identity, verify_contact_identity, ContactIdentityVerificationAuthority,
    ContactIdentityVerificationProof, ContactPhoneIdentity, CreateContactIdentityParams,
    RecordContactIdentityVerificationProofParams, UpdateContactIdentityParams,
};
pub use contact_roles::{
    active_roles_for_contact, assign_contact_role, end_contact_role, AssignContactRoleParams,
    ContactRoleAssignment, EndContactRoleParams,
};
pub use contacts::{
    assign_tag_to_contact, create_contact, create_contact_relationship, create_contact_tag,
    delete_contact, end_contact_relationship, update_contact, update_contact_address,
    update_contact_business, update_contact_details, update_contact_parent, Contact,
    ContactCategory, ContactCategoryAssignment, ContactRelationship, ContactTag,
    ContactTagAssignment, CreateContactRelationshipParams,
};
pub use duplicate::{
    find_duplicate_contacts, merge_contacts, ContactDuplicateCandidate, MergeContactsParams,
};
pub use forecast::{
    create_forecast_snapshot, CreateCrmForecastSnapshotParams, CrmForecastSnapshot,
};
pub use inbox::{
    append_crm_conversation_message, open_crm_conversation, receive_crm_provider_message,
    record_crm_provider_delivery, register_crm_provider_principal, update_crm_conversation,
    AppendCrmConversationMessageParams, CrmConversation, CrmConversationMessage,
    CrmProviderEventReceipt, CrmProviderPrincipal, OpenCrmConversationParams,
    ReceiveCrmProviderMessageParams, RecordCrmProviderDeliveryParams,
    RegisterCrmProviderPrincipalParams, UpdateCrmConversationParams,
};
pub use lead_scoring::{
    recompute_lead_score, LeadScore, LeadScoreFactor, LEAD_SCORE_FORMULA_VERSION,
};
pub use leads::{
    convert_lead_to_customer, create_lead, create_lead_lost_reason, create_lead_source,
    update_lead, update_lead_address, update_lead_details, update_lead_lost_reason,
    update_lead_revenue, update_lead_source, CreateLeadLostReasonParams, CreateLeadSourceParams,
    CrmTeam, Lead, LeadLostReason, LeadSource, UpdateLeadLostReasonParams, UpdateLeadParams,
    UpdateLeadSourceParams,
};
pub use opportunities::{
    convert_opportunity_to_sale_order, create_opportunity, create_opportunity_stage,
    update_opportunity, update_opportunity_stage, CreateOpportunityStageParams, Opportunity,
    OpportunityLine, OpportunityStage, UpdateOpportunityParams, UpdateOpportunityStageParams,
};
pub use presence::{clear_opportunity_presence, update_opportunity_presence, OpportunityPresence};
pub use relationship_intel::{recompute_relationship_insights, ContactRelationshipInsight};
pub use segments::{
    add_contact_to_segment, create_assignment_rule, create_contact_segment,
    evaluate_dynamic_segment, set_contact_segment_rules, update_assignment_rule, AssignmentRule,
    ContactSegment, ContactSegmentRule, CreateAssignmentRuleParams, SegmentMember,
    SegmentRuleClause, SegmentRuleField, SegmentRuleOp, SetContactSegmentRulesParams,
    UpdateAssignmentRuleParams,
};

#[cfg(test)]
mod privacy_tests {
    fn assert_private_table(source: &str, accessor: &str) {
        let comma_marker = format!("accessor = {accessor},");
        let closing_marker = format!("accessor = {accessor})");
        let accessor_pos = source
            .find(&comma_marker)
            .or_else(|| source.find(&closing_marker))
            .expect("table accessor must exist");
        let attribute_start = source[..accessor_pos]
            .rfind("#[spacetimedb::table")
            .expect("table attribute must exist");
        let attribute_end = source[accessor_pos..]
            .find(")]")
            .map(|offset| accessor_pos + offset)
            .expect("table attribute must terminate");
        let attribute = &source[attribute_start..attribute_end];
        assert!(
            !attribute.split(',').any(|part| part.trim() == "public"),
            "{accessor} must remain private"
        );
    }

    #[test]
    fn all_crm_storage_tables_are_private() {
        let files = [
            include_str!("activities.rs"),
            include_str!("contact_identities.rs"),
            include_str!("contact_roles.rs"),
            include_str!("contacts.rs"),
            include_str!("duplicate.rs"),
            include_str!("forecast.rs"),
            include_str!("inbox.rs"),
            include_str!("lead_scoring.rs"),
            include_str!("leads.rs"),
            include_str!("opportunities.rs"),
            include_str!("presence.rs"),
            include_str!("relationship_intel.rs"),
            include_str!("segments.rs"),
        ];
        let accessors = [
            "activity",
            "activity_type",
            "calendar_event",
            "contact_phone_identity",
            "contact_identity_verification_proof",
            "contact_identity_verification_authority",
            "contact_role_assignment",
            "contact",
            "contact_category",
            "contact_category_assignment",
            "contact_relationship",
            "contact_tag",
            "contact_tag_assignment",
            "contact_duplicate_candidate",
            "crm_forecast_snapshot",
            "crm_conversation",
            "crm_conversation_message",
            "crm_provider_principal",
            "crm_provider_event_receipt",
            "lead_score",
            "lead_score_factor",
            "lead",
            "lead_source",
            "lead_lost_reason",
            "opportunity",
            "opp_stage",
            "opportunity_line",
            "opportunity_presence",
            "contact_relationship_insight",
            "contact_segment",
            "segment_member",
            "assignment_rule",
            "contact_segment_rule",
        ];

        for accessor in accessors {
            let source = files
                .iter()
                .find(|source| {
                    source.contains(&format!("accessor = {accessor},"))
                        || source.contains(&format!("accessor = {accessor})"))
                })
                .expect("CRM table source must exist");
            assert_private_table(source, accessor);
        }

        assert_private_table(include_str!("../core/privacy.rs"), "privacy_consent");
        assert_private_table(
            include_str!("../core/operational_messaging.rs"),
            "contact_communication_preference",
        );
        for accessor in ["utm_campaign", "utm_medium", "utm_source"] {
            assert_private_table(include_str!("../core/utm.rs"), accessor);
        }
    }
}
