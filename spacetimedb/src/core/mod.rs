pub mod audit;
pub mod auth;
/// `core` — Foundation & Infrastructure
///
/// Covers the SpacetimeDB Migration Plan Phase 1 (Weeks 1–4).
/// Every other domain module depends on tables defined here.
///
/// Sub-modules
/// -----------
/// | File             | Tables                                              |
/// |------------------|-----------------------------------------------------|
/// | organization     | Organization · OrganizationSettings · Company       |
/// | users            | UserProfile · UserOrganization · UserSession        |
/// | permissions      | Role · OrgPermission · FieldPermission · …         |
/// | reference        | Country · Currency · CurrencyRate · UOM · …        |
/// | audit            | AuditLog · AuditRule                                |
/// | queue            | QueueJob · QueueWorker                              |
/// | privacy          | DataClassification · … · PrivacyConsent             |
/// | messaging        | MailMessage · MailFollower                          |
/// | utm              | UtmCampaign · UtmMedium · UtmSource                 |
pub mod billing;
pub mod cold_tier;
pub mod cold_tier_identity;
pub mod country_pack;
pub mod messaging;
pub mod migrations;
pub mod operational_messaging;
pub mod organization;
pub mod permissions;
pub mod persistence;
pub mod privacy;
pub mod queue;
pub mod reconstruction;
pub mod reference;
pub mod users;
pub mod utm;
