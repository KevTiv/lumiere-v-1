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
pub mod lead_scoring;
pub mod leads;
pub mod opportunities;
pub mod presence;
pub mod relationship_intel;
pub mod segments;

// Re-export key types for convenience
pub use activities::{
    complete_activity, create_activity, create_calendar_event, delete_calendar_event,
    update_calendar_event, Activity, ActivityType, CalendarEvent, UpdateCalendarEventParams,
};
pub use contact_identities::{
    archive_contact_identity, create_contact_identity, find_identity_by_normalized,
    mask_e164, normalize_phone, update_contact_identity, verify_contact_identity,
    ContactPhoneIdentity, CreateContactIdentityParams, UpdateContactIdentityParams,
};
pub use contact_roles::{
    active_roles_for_contact, assign_contact_role, end_contact_role, ContactRoleAssignment,
    AssignContactRoleParams, EndContactRoleParams,
};
pub use contacts::{
    assign_tag_to_contact, create_contact, create_contact_relationship, create_contact_tag,
    delete_contact, end_contact_relationship, update_contact, update_contact_address,
    update_contact_business, update_contact_details, update_contact_parent, Contact,
    ContactCategory, ContactCategoryAssignment, ContactRelationship,
    CreateContactRelationshipParams, ContactTag, ContactTagAssignment,
};
pub use duplicate::{
    find_duplicate_contacts, merge_contacts, ContactDuplicateCandidate, MergeContactsParams,
};
pub use forecast::{create_forecast_snapshot, CreateCrmForecastSnapshotParams, CrmForecastSnapshot};
pub use inbox::{
    append_crm_conversation_message, open_crm_conversation, update_crm_conversation,
    AppendCrmConversationMessageParams, CrmConversation, CrmConversationMessage,
    OpenCrmConversationParams, UpdateCrmConversationParams,
};
pub use lead_scoring::{
    recompute_lead_score, LeadScore, LeadScoreFactor, LEAD_SCORE_FORMULA_VERSION,
};
pub use leads::{
    convert_lead_to_customer, create_lead, create_lead_lost_reason, create_lead_source,
    update_lead_address, update_lead_details, update_lead_lost_reason, update_lead_revenue,
    update_lead_source, CreateLeadLostReasonParams, CreateLeadSourceParams, Lead, LeadLostReason,
    LeadSource, UpdateLeadLostReasonParams, UpdateLeadSourceParams,
};
pub use opportunities::{
    convert_opportunity_to_sale_order, create_opportunity, create_opportunity_stage,
    update_opportunity, update_opportunity_stage, CreateOpportunityStageParams, Opportunity,
    OpportunityLine, OpportunityStage, UpdateOpportunityParams, UpdateOpportunityStageParams,
};
pub use presence::{
    clear_opportunity_presence, update_opportunity_presence, OpportunityPresence,
};
pub use relationship_intel::{
    recompute_relationship_insights, ContactRelationshipInsight,
};
pub use segments::{
    add_contact_to_segment, create_assignment_rule, create_contact_segment,
    evaluate_dynamic_segment, set_contact_segment_rules, update_assignment_rule, AssignmentRule,
    ContactSegment, ContactSegmentRule, CreateAssignmentRuleParams, SegmentMember,
    SegmentRuleClause, SegmentRuleField, SegmentRuleOp, SetContactSegmentRulesParams,
    UpdateAssignmentRuleParams,
};
