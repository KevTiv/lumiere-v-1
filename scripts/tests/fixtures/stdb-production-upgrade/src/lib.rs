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

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) {
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
}
