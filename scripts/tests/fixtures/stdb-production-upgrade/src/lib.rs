//! Frozen pre-upgrade table layouts. Keep these stable so the upgrade test
//! checks populated tables, instead of only creating an empty database.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PaymentType {
    InBound,
    OutBound,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PartnerType {
    Customer,
    Supplier,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PaymentState {
    NotPaid,
    Paid,
    Partial,
    Reversed,
    InvoicingLegacy,
}

#[spacetimedb::table(
    accessor = account_payment,
    public,
    index(accessor = payment_by_org, btree(columns = [organization_id])),
    index(accessor = payment_by_partner, btree(columns = [partner_id])),
    index(accessor = payment_by_state, btree(columns = [state]))
)]
#[derive(Clone)]
pub struct AccountPayment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: Option<String>,
    pub move_id: Option<u64>,
    pub payment_type: PaymentType,
    pub partner_type: PartnerType,
    pub partner_id: u64,
    pub amount: f64,
    pub currency_id: u64,
    pub date: Timestamp,
    pub journal_id: u64,
    pub ref_: Option<String>,
    pub memo: Option<String>,
    pub reconciled_invoice_ids: Vec<u64>,
    pub reconciled_bill_ids: Vec<u64>,
    pub state: PaymentState,
    pub created_at: Timestamp,
    pub create_uid: Identity,
}

#[spacetimedb::table(
    accessor = ai_provider_attempt,
    index(accessor = ai_provider_attempt_by_org, btree(columns = [organization_id])),
    index(accessor = ai_provider_attempt_by_request, btree(columns = [organization_id, request_key])),
    index(accessor = ai_provider_attempt_by_run, btree(columns = [run_id]))
)]
pub struct AiProviderAttempt {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub run_id: u64,
    pub reservation_id: u64,
    pub request_key: String,
    pub provider: String,
    pub model: String,
    pub status: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub failure_reason: Option<String>,
    pub resolution: Option<String>,
    pub accepted_by: spacetimedb::Identity,
    pub write_uid: spacetimedb::Identity,
    pub created_at: Timestamp,
    pub dispatched_at: Option<Timestamp>,
    pub finished_at: Option<Timestamp>,
    pub write_date: Timestamp,
}

#[spacetimedb::table(
    accessor = country_pack_definition,
    public,
    index(accessor = country_pack_by_organization, btree(columns = [organization_id])),
    index(
        accessor = country_pack_by_pack_key,
        btree(columns = [organization_id, pack_key])
    )
)]
pub struct CountryPackDefinition {
    #[primary_key]
    pub organization_pack_key: String,
    pub organization_id: u64,
    pub pack_key: String,
    pub country_code: String,
    pub name: String,
    pub region: String,
    pub version: String,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = country_pack_tax_rule,
    public,
    index(
        accessor = pack_tax_by_pack,
        btree(columns = [organization_id, pack_key])
    ),
    index(accessor = pack_tax_by_organization, btree(columns = [organization_id]))
)]
pub struct CountryPackTaxRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    #[unique]
    pub organization_pack_code_key: String,
    pub pack_key: String,
    pub code: String,
    pub name: String,
    pub rate: f64,
    pub tax_use: String,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = company_country_pack,
    public,
    index(accessor = company_country_pack_by_org, btree(columns = [organization_id])),
    index(accessor = company_country_pack_by_company, btree(columns = [company_id]))
)]
pub struct CompanyCountryPack {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub pack_key: String,
    pub enabled: bool,
    pub configuration: Option<String>,
    pub activated_at: Timestamp,
    pub updated_at: Timestamp,
    pub updated_by: spacetimedb::Identity,
}

#[spacetimedb::table(
    accessor = document,
    public,
    index(accessor = document_by_org, btree(columns = [organization_id])),
    index(name = "by_folder", accessor = document_by_folder, btree(columns = [folder_id])),
    index(accessor = document_by_owner, btree(columns = [owner_id])),
    index(accessor = document_by_company, btree(columns = [company_id]))
)]
pub struct Document {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // Tenant isolation
    pub name: String,
    pub description: Option<String>,
    pub file_name: String,
    pub file_size: u64,
    pub mimetype: String,
    pub checksum: Option<String>,
    /// Legacy wire-compatibility slot. New rows leave this empty; AI text lives
    /// in `ai_evidence_passage`. Retain existing values until an audited retirement.
    pub index_content: Option<String>,
    /// Analyzer/locale hint for FTS (from country pack or explicit index).
    pub index_language: Option<String>,
    pub access_token: Option<String>,
    pub url: Option<String>,
    pub res_model: Option<String>,
    pub res_id: Option<u64>,
    pub res_name: Option<String>,
    pub partner_id: Option<u64>,
    pub owner_id: Identity,
    pub company_id: Option<u64>, // ERP company entity scope (within org)
    pub folder_id: Option<u64>,
    pub tag_ids: Vec<u64>,
    pub is_locked: bool,
    pub locked_by: Option<Identity>,
    pub locked_at: Option<Timestamp>,
    /// When set, lock auto-expires at this timestamp (optional lease TTL).
    pub locked_until: Option<Timestamp>,
    pub is_favorite: bool,
    pub is_shared: bool,
    pub share_link: Option<String>,
    pub share_expires: Option<Timestamp>,
    pub is_deleted: bool,
    pub deleted_at: Option<Timestamp>,
    pub deleted_by: Option<Identity>,
    /// Link to `data_classification` for retention policy.
    pub classification_id: Option<u64>,
    pub retention_days: Option<u32>,
    /// When set and in the past, soft-deleted docs are eligible for hard purge.
    pub purge_after: Option<Timestamp>,
    /// Pack-aware fiscal archive kind (`nfe_xml`, `myinvois_xml`, …).
    pub fiscal_kind: Option<String>,
    /// Object-store residency tag inherited from folder/pack/upload.
    pub residency_region: Option<String>,
    pub version_count: u32,
    pub current_version_id: Option<u64>,
    pub download_count: u32,
    pub last_viewed_at: Option<Timestamp>,
    pub last_viewed_by: Option<Identity>,
    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = search_embedding,
    public,
    index(name = "by_content", accessor = embedding_by_content, btree(columns = [content_type])),
    index(accessor = embedding_by_org, btree(columns = [organization_id])),
    index(accessor = embedding_by_company, btree(columns = [company_id])),
    index(name = "by_sync_status", accessor = embedding_by_sync_status, btree(columns = [sync_status]))
)]
pub struct SearchEmbedding {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // AI-003: Tenant isolation
    pub content_type: String,
    pub content_id: u64,
    /// Legacy wire-compatibility slots. New rows contain no copied text or vectors.
    /// Existing payloads are not used as canonical evidence and require an audited retirement.
    pub text: String,
    pub embedding: Vec<f32>,
    pub embedding_hash: Option<String>,

    // Qdrant sync tracking
    pub sync_status: String, // "pending" | "synced" | "failed" | "deleted"
    pub vector_db_id: Option<String>, // Qdrant point ID (stringified STDB id)
    pub embedding_model: Option<String>, // e.g. "voyage-3", "text-embedding-3-small"
    pub embedding_dim: Option<u32>, // e.g. 1024, 1536 — for model migration tracking
    pub last_synced_at: Option<Timestamp>,
    pub sync_error: Option<String>, // Last sync error message

    pub company_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = user_profile,
    index(accessor = user_profile_by_organization, btree(columns = [organization_id])),
    index(accessor = user_profile_by_identity, btree(columns = [identity])),
    index(
        accessor = user_profile_by_identity_organization,
        btree(columns = [identity, organization_id])
    ),
    index(
        accessor = user_profile_by_organization_platform_user,
        btree(columns = [organization_id, platform_user_id])
    )
)]
pub struct UserProfile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub identity: Identity,
    pub platform_user_id: String,
    pub organization_id: u64,
    pub email: String,
    pub email_verified: bool,
    pub name: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub avatar_url: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub timezone: String,
    pub language: String,
    pub signature: Option<String>,
    pub notification_preferences: Option<String>, // JSON
    pub ui_preferences: Option<String>,           // JSON
    pub is_active: bool,
    pub is_superuser: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub last_login: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = user_organization,
    public,
    index(accessor = user_org_by_user, btree(columns = [user_identity])),
    index(accessor = user_org_by_org,  btree(columns = [organization_id]))
)]
#[derive(Clone)]
pub struct UserOrganization {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub user_identity: Identity,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub role_id: u64,
    pub department_id: Option<u64>,
    pub job_title: Option<String>,
    pub employee_id: Option<String>,
    pub date_joined: Timestamp,
    pub is_active: bool,
    pub is_default: bool,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill,
    public,
    index(accessor = ai_skill_by_org, btree(columns = [organization_id])),
    index(accessor = ai_skill_by_org_key, btree(columns = [organization_id, skill_key]))
)]
pub struct AiSkill {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub skill_key: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub prompt_template: String,
    pub required_tools: Vec<String>,
    pub optional_tools: Vec<String>,
    pub default_max_steps: u32,
    pub default_max_tool_calls: u32,
    pub output_schema: Option<String>,
    pub config_schema: Option<String>,
    pub dataset_specs: Option<String>,
    pub allowed_action_drafts: Vec<String>,
    pub is_active: bool,
    pub is_system: bool,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill_config,
    public,
    index(accessor = ai_skill_config_by_org, btree(columns = [organization_id])),
    index(
        accessor = ai_skill_config_by_company_skill,
        btree(columns = [company_id, skill_id])
    )
)]
pub struct AiSkillConfig {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub skill_id: u64,
    pub is_enabled: bool,
    pub config_json: String,
    pub custom_instructions: Option<String>,
    pub tool_overrides: Vec<String>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) {
    seed_existing_ai_catalog(ctx);
    ctx.db.account_payment().insert(AccountPayment {
        id: 42,
        organization_id: 42,
        company_id: 42,
        name: Some("legacy-name".to_string()),
        move_id: Some(17),
        payment_type: PaymentType::InBound,
        partner_type: PartnerType::Customer,
        partner_id: 42,
        amount: 125.5,
        currency_id: 42,
        date: ctx.timestamp,
        journal_id: 42,
        ref_: Some("legacy-ref_".to_string()),
        memo: Some("legacy-memo".to_string()),
        reconciled_invoice_ids: vec![12, 13],
        reconciled_bill_ids: vec![12, 13],
        state: PaymentState::Paid,
        created_at: ctx.timestamp,
        create_uid: ctx.sender(),
    });
    ctx.db.ai_provider_attempt().insert(AiProviderAttempt {
        id: 42,
        organization_id: 42,
        company_id: 42,
        agent_id: 42,
        run_id: 42,
        reservation_id: 42,
        request_key: "legacy-request_key".to_string(),
        provider: "legacy-provider".to_string(),
        model: "legacy-model".to_string(),
        status: "legacy-status".to_string(),
        input_tokens: 19,
        output_tokens: 19,
        failure_reason: Some("legacy-failure_reason".to_string()),
        resolution: Some("legacy-resolution".to_string()),
        accepted_by: ctx.sender(),
        write_uid: ctx.sender(),
        created_at: ctx.timestamp,
        dispatched_at: Some(ctx.timestamp),
        finished_at: Some(ctx.timestamp),
        write_date: ctx.timestamp,
    });
    ctx.db
        .country_pack_definition()
        .insert(CountryPackDefinition {
            organization_pack_key: "legacy-organization_pack_key".to_string(),
            organization_id: 42,
            pack_key: "legacy-pack_key".to_string(),
            country_code: "legacy-country_code".to_string(),
            name: "legacy-name".to_string(),
            region: "legacy-region".to_string(),
            version: "legacy-version".to_string(),
            is_active: true,
            metadata: Some("legacy-metadata".to_string()),
        });
    ctx.db.country_pack_tax_rule().insert(CountryPackTaxRule {
        id: 42,
        organization_id: 42,
        organization_pack_code_key: "legacy-organization_pack_code_key".to_string(),
        pack_key: "legacy-pack_key".to_string(),
        code: "legacy-code".to_string(),
        name: "legacy-name".to_string(),
        rate: 125.5,
        tax_use: "legacy-tax_use".to_string(),
        is_active: true,
        metadata: Some("legacy-metadata".to_string()),
    });
    ctx.db.company_country_pack().insert(CompanyCountryPack {
        id: 42,
        organization_id: 42,
        company_id: 42,
        pack_key: "legacy-pack_key".to_string(),
        enabled: true,
        configuration: Some("legacy-configuration".to_string()),
        activated_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
    });

    ctx.db.document().insert(Document {
        id: 42,
        organization_id: 42,
        name: "legacy-name".to_string(),
        description: Some("legacy-description".to_string()),
        file_name: "legacy-file_name".to_string(),
        file_size: 42,
        mimetype: "legacy-mimetype".to_string(),
        checksum: Some("legacy-checksum".to_string()),
        index_content: Some("legacy-index_content".to_string()),
        index_language: Some("legacy-index_language".to_string()),
        access_token: Some("legacy-access_token".to_string()),
        url: Some("legacy-url".to_string()),
        res_model: Some("legacy-res_model".to_string()),
        res_id: Some(17),
        res_name: Some("legacy-res_name".to_string()),
        partner_id: Some(17),
        owner_id: ctx.sender(),
        company_id: Some(17),
        folder_id: Some(17),
        tag_ids: vec![12, 13],
        is_locked: true,
        locked_by: Some(ctx.sender()),
        locked_at: Some(ctx.timestamp),
        locked_until: Some(ctx.timestamp),
        is_favorite: true,
        is_shared: true,
        share_link: Some("legacy-share_link".to_string()),
        share_expires: Some(ctx.timestamp),
        is_deleted: true,
        deleted_at: Some(ctx.timestamp),
        deleted_by: Some(ctx.sender()),
        classification_id: Some(17),
        retention_days: Some(13),
        purge_after: Some(ctx.timestamp),
        fiscal_kind: Some("legacy-fiscal_kind".to_string()),
        residency_region: Some("legacy-residency_region".to_string()),
        version_count: 7,
        current_version_id: Some(17),
        download_count: 7,
        last_viewed_at: Some(ctx.timestamp),
        last_viewed_by: Some(ctx.sender()),
        activity_ids: vec![12, 13],
        message_follower_ids: vec![12, 13],
        message_ids: vec![12, 13],
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some("legacy-metadata".to_string()),
    });
    ctx.db.search_embedding().insert(SearchEmbedding {
        id: 42,
        organization_id: 42,
        content_type: "legacy-content_type".to_string(),
        content_id: 42,
        text: "legacy-text".to_string(),
        embedding: vec![0.125, 0.5],
        embedding_hash: Some("legacy-embedding_hash".to_string()),
        sync_status: "legacy-sync_status".to_string(),
        vector_db_id: Some("legacy-vector_db_id".to_string()),
        embedding_model: Some("legacy-embedding_model".to_string()),
        embedding_dim: Some(13),
        last_synced_at: Some(ctx.timestamp),
        sync_error: Some("legacy-sync_error".to_string()),
        company_id: Some(17),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some("legacy-metadata".to_string()),
    });
}

fn seed_existing_ai_catalog(ctx: &ReducerContext) {
    ctx.db.user_profile().insert(UserProfile {
        id: 42,
        identity: ctx.sender(),
        platform_user_id: "upgrade-fixture-owner".into(),
        organization_id: 42,
        email: "publisher@example.test".into(),
        email_verified: true,
        name: "Fixture publisher".into(),
        first_name: None,
        last_name: None,
        avatar_url: None,
        phone: None,
        mobile: None,
        timezone: "UTC".into(),
        language: "en".into(),
        signature: None,
        notification_preferences: None,
        ui_preferences: None,
        is_active: true,
        is_superuser: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        last_login: None,
        metadata: None,
    });
    ctx.db.user_organization().insert(UserOrganization {
        id: 42,
        user_identity: ctx.sender(),
        organization_id: 42,
        company_id: Some(42),
        role_id: 42,
        department_id: None,
        job_title: None,
        employee_id: None,
        date_joined: ctx.timestamp,
        is_active: true,
        is_default: true,
        metadata: None,
    });
    ctx.db.ai_skill().insert(AiSkill {
        id: 42,
        organization_id: 0,
        skill_key: "report_composer".into(),
        name: "Existing Report Composer".into(),
        description: None,
        category: "reports".into(),
        prompt_template: "Existing prompt".into(),
        required_tools: vec![],
        optional_tools: vec![],
        default_max_steps: 1,
        default_max_tool_calls: 1,
        output_schema: None,
        config_schema: None,
        dataset_specs: None,
        allowed_action_drafts: vec![],
        is_active: true,
        is_system: true,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: None,
    });
    ctx.db.ai_skill_config().insert(AiSkillConfig {
        id: 42,
        organization_id: 42,
        company_id: Some(42),
        skill_id: 42,
        is_enabled: false,
        config_json: "{}".into(),
        custom_instructions: None,
        tool_overrides: vec![],
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: None,
    });
}
