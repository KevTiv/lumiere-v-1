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
/// | leads | Lead, LeadSource, LeadLostReason |
/// | opportunities | Opportunity, OpportunityStage, OpportunityLine |
/// | activities | Activity, ActivityType, CalendarEvent |
/// | segments | ContactSegment, SegmentMember, AssignmentRule |
pub mod activities;
pub mod contacts;
pub mod duplicate;
pub mod leads;
pub mod opportunities;
pub mod segments;

// Re-export key types for convenience
pub use activities::{
    complete_activity, create_activity, create_calendar_event, delete_calendar_event,
    update_calendar_event, Activity, ActivityType, CalendarEvent, UpdateCalendarEventParams,
};
pub use contacts::{
    assign_tag_to_contact, create_contact, create_contact_tag, delete_contact, update_contact,
    update_contact_address, update_contact_business, update_contact_details, Contact,
    ContactCategory, ContactCategoryAssignment, ContactRelationship, ContactTag,
    ContactTagAssignment,
};
pub use duplicate::{
    find_duplicate_contacts, merge_contacts, ContactDuplicateCandidate, MergeContactsParams,
};
pub use leads::{
    convert_lead_to_customer, create_lead, update_lead_address, update_lead_details,
    update_lead_revenue, Lead, LeadLostReason, LeadSource,
};
pub use opportunities::{
    convert_opportunity_to_sale_order, create_opportunity, update_opportunity, Opportunity,
    OpportunityLine, OpportunityStage, UpdateOpportunityParams,
};
pub use segments::{
    add_contact_to_segment, create_contact_segment, AssignmentRule, ContactSegment, SegmentMember,
};
