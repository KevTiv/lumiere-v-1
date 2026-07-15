//! Domain test harness — shared fixtures for accounting, inventory, and sales suites.
//!
//! ## Test discovery strategy (Phase 1)
//!
//! We use a **cdylib + in-module harness** hybrid (Approach C variant):
//!
//! - `[lib] crate-type = ["cdylib"]` — required for SpacetimeDB WASM publish. Adding native
//!   `rlib` alongside `cdylib` fails on macOS because SpacetimeDB table code links against
//!   WASM host imports (`datastore_*`, `console_log`, …) unavailable on the host linker.
//! - SpacetimeDB **2.0.1 does not ship** `spacetimedb::testing`, `test_helpers`, or `TestContext`
//!   (confirmed via registry grep). Phase 2 domain suites invoke reducers from **in-module test
//!   reducers** (same pattern as `tests/core/tests/`) using `OrgFixture::seed_minimal(ctx)`.
//! - This file is included as `lumiere_v1::test_harness` from `lib.rs` (always compiled).
//!   Native `cargo test --lib harness_org_fixture` runs the `#[cfg(test)]` smoke test below;
//!   full fixture seeding runs inside the SpacetimeDB runtime when test reducers call `seed_minimal`.
//!
//! ## Usage (Phase 2+)
//!
//! ```ignore
//! #[spacetimedb::reducer]
//! fn test_post_invoice(ctx: &ReducerContext) -> Result<(), String> {
//!     let fixture = OrgFixture::seed_minimal(ctx)?;
//!     // invoke domain reducers with fixture.organization_id / fixture.company_id …
//!     Ok(())
//! }
//! ```

use std::collections::HashMap;
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, create_account_account, create_account_account_type,
    CreateAccountAccountParams, CreateAccountAccountTypeParams,
};
use crate::accounting::fiscal_periods::{
    account_fiscal_year, create_account_period, create_fiscal_year, CreateAccountPeriodParams,
    CreateFiscalYearParams,
};
use crate::core::organization::{
    company, create_company, insert_organization_with_owner, organization, CreateCompanyParams,
    CreateOrganizationParams,
};
use crate::core::reference::{
    create_uom, create_uom_category, uom, uom_cat, CreateUomCategoryParams, CreateUomParams,
};
use crate::core::users::{user_profile, UserProfile};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::inventory::product::{create_product, product, CreateProductParams};
use crate::inventory::product_category::{
    create_product_category, product_category, CreateProductCategoryParams,
};
use crate::inventory::warehouse::{warehouse, Warehouse};
use crate::types::{AccountInternalGroup, AccountTypeInternal, FiscalYearState, PeriodState};

/// Alias for mission docs — domain tests receive a live `ReducerContext` from SpacetimeDB.
pub type TestContext = ReducerContext;

/// Well-known chart account keys populated by [`OrgFixture::seed_minimal`].
pub mod chart_keys {
    pub const AR: &str = "ar";
    pub const AP: &str = "ap";
    pub const REVENUE: &str = "revenue";
}

/// Minimal multi-tenant fixture: org, company, fiscal year, AR/AP/revenue accounts,
/// one customer partner, one storable product, one warehouse.
#[derive(Debug, Clone)]
pub struct OrgFixture {
    pub organization_id: u64,
    pub company_id: u64,
    pub fiscal_year_id: u64,
    pub partner_id: u64,
    pub product_id: u64,
    pub warehouse_id: u64,
    pub chart_account_ids: HashMap<&'static str, u64>,
}

impl OrgFixture {
    /// Seed org-scoped baseline data via domain reducers (plus one warehouse row aligned with `seed.rs`).
    pub fn seed_minimal(ctx: &ReducerContext) -> Result<Self, String> {
        ensure_test_superuser(ctx)?;

        let suffix = unique_suffix(ctx);
        let org_code = format!("T{suffix}");
        let company_code = format!("C{suffix}");

        // Use insert path directly — org `code` is not unique, so find-by-code can return
        // a prior fixture when suffix values collide inside one reducer invocation.
        let (org, _owner_role) = insert_organization_with_owner(
            ctx,
            CreateOrganizationParams {
                name: format!("Test Org {suffix}"),
                code: org_code.clone(),
                timezone: "UTC".to_string(),
                date_format: "YYYY-MM-DD".to_string(),
                language: "en".to_string(),
                is_active: true,
                description: None,
                logo_url: None,
                website: None,
                email: None,
                phone: None,
                currency_id: None,
                metadata: Some(r#"{"harness":"minimal"}"#.to_string()),
            },
        )?;
        let organization_id = org.id;

        create_company(
            ctx,
            organization_id,
            CreateCompanyParams {
                name: format!("Test Company {suffix}"),
                code: company_code.clone(),
                currency_id: 1,
                fiscal_year_end_month: 12,
                fiscal_year_end_day: 31,
                is_parent: false,
                parent_id: None,
                tax_id: None,
                company_registry: None,
                address_street: None,
                address_city: None,
                address_zip: None,
                address_country_code: None,
                metadata: Some(r#"{"harness":"minimal"}"#.to_string()),
            },
        )?;

        let company_id = ctx
            .db
            .company()
            .company_by_org()
            .filter(&organization_id)
            .map(|c| c.id)
            .max()
            .ok_or("Harness: company not found after create")?;

        let year_start = ctx.timestamp - Duration::from_secs(180 * 86400);
        let year_end = ctx.timestamp + Duration::from_secs(180 * 86400);
        create_fiscal_year(
            ctx,
            organization_id,
            company_id,
            CreateFiscalYearParams {
                name: format!("FY-{suffix}"),
                date_from: year_start,
                date_to: year_end,
                type_: "standard".to_string(),
                state: FiscalYearState::Running,
                carry_over_accounts: vec![],
                closing_move_id: None,
                opening_move_id: None,
                is_adjustment: false,
                notes: None,
                metadata: None,
            },
        )?;

        let fiscal_year_id = ctx
            .db
            .account_fiscal_year()
            .fiscal_year_by_company()
            .filter(&company_id)
            .find(|fy| fy.name.contains(&suffix.to_string()))
            .map(|fy| fy.id)
            .ok_or("Harness: fiscal year not found after create")?;

        create_account_period(
            ctx,
            organization_id,
            company_id,
            CreateAccountPeriodParams {
                name: format!("Open-{suffix}"),
                code: format!("OP{suffix}"),
                date_from: year_start,
                date_to: year_end,
                fiscal_year_id,
                state: PeriodState::Open,
                is_adjustment: false,
                notes: None,
                metadata: None,
            },
        )?;

        let at_receivable = seed_account_type(
            ctx,
            organization_id,
            company_id,
            "Receivable",
            "receivable",
            AccountInternalGroup::Asset,
            true,
        )?;
        let at_payable = seed_account_type(
            ctx,
            organization_id,
            company_id,
            "Payable",
            "payable",
            AccountInternalGroup::Liability,
            true,
        )?;
        let at_income = seed_account_type(
            ctx,
            organization_id,
            company_id,
            "Income",
            "other",
            AccountInternalGroup::Income,
            false,
        )?;

        let ar_code = format!("1200{suffix}");
        create_account_account(
            ctx,
            organization_id,
            CreateAccountAccountParams {
                company_id: Some(company_id),
                code: ar_code.clone(),
                name: "Accounts Receivable".to_string(),
                user_type_id: at_receivable,
                currency_id: None,
                internal_type: Some(AccountTypeInternal::Receivable),
                internal_group: Some(AccountInternalGroup::Asset),
                group_id: None,
                reconcile: true,
                tax_ids: vec![],
                note: None,
                opening_debit: 0.0,
                opening_credit: 0.0,
                allowed_journal_ids: vec![],
                non_trade: false,
                is_off_balance: false,
                metadata: None,
            },
        )?;

        let ap_code = format!("2100{suffix}");
        create_account_account(
            ctx,
            organization_id,
            CreateAccountAccountParams {
                company_id: Some(company_id),
                code: ap_code.clone(),
                name: "Accounts Payable".to_string(),
                user_type_id: at_payable,
                currency_id: None,
                internal_type: Some(AccountTypeInternal::Payable),
                internal_group: Some(AccountInternalGroup::Liability),
                group_id: None,
                reconcile: true,
                tax_ids: vec![],
                note: None,
                opening_debit: 0.0,
                opening_credit: 0.0,
                allowed_journal_ids: vec![],
                non_trade: false,
                is_off_balance: false,
                metadata: None,
            },
        )?;

        let rev_code = format!("4000{suffix}");
        create_account_account(
            ctx,
            organization_id,
            CreateAccountAccountParams {
                company_id: Some(company_id),
                code: rev_code.clone(),
                name: "Product Sales".to_string(),
                user_type_id: at_income,
                currency_id: None,
                internal_type: None,
                internal_group: Some(AccountInternalGroup::Income),
                group_id: None,
                reconcile: false,
                tax_ids: vec![],
                note: None,
                opening_debit: 0.0,
                opening_credit: 0.0,
                allowed_journal_ids: vec![],
                non_trade: false,
                is_off_balance: false,
                metadata: None,
            },
        )?;

        let mut chart_account_ids = HashMap::new();
        chart_account_ids.insert(
            chart_keys::AR,
            find_account_id(ctx, organization_id, company_id, &ar_code)?,
        );
        chart_account_ids.insert(
            chart_keys::AP,
            find_account_id(ctx, organization_id, company_id, &ap_code)?,
        );
        chart_account_ids.insert(
            chart_keys::REVENUE,
            find_account_id(ctx, organization_id, company_id, &rev_code)?,
        );

        create_uom_category(
            ctx,
            organization_id,
            CreateUomCategoryParams {
                name: format!("Units-{suffix}"),
                description: None,
                sequence: 1,
                metadata: None,
            },
        )?;
        let uom_category_id = ctx
            .db
            .uom_cat()
            .uom_cat_by_org()
            .filter(&organization_id)
            .find(|c| c.name == format!("Units-{suffix}"))
            .map(|c| c.id)
            .ok_or("Harness: UOM category not found")?;

        create_uom(
            ctx,
            organization_id,
            CreateUomParams {
                category_id: uom_category_id,
                name: "Unit".to_string(),
                symbol: "U".to_string(),
                factor: 1.0,
                rounding: 0.01,
                times_bigger: 1.0,
                is_reference_unit: true,
                is_active: true,
                metadata: None,
            },
        )?;
        let uom_id = ctx
            .db
            .uom()
            .iter()
            .find(|u| u.name == "Unit" && u.category_id == uom_category_id)
            .map(|u| u.id)
            .ok_or("Harness: UOM not found")?;

        create_product_category(
            ctx,
            organization_id,
            CreateProductCategoryParams {
                name: format!("Harness Goods {suffix}"),
                parent_id: None,
                sequence: 1,
                company_id: Some(company_id),
                metadata: None,
            },
        )?;
        let categ_id = ctx
            .db
            .product_category()
            .iter()
            .find(|c| {
                c.organization_id == organization_id && c.name == format!("Harness Goods {suffix}")
            })
            .map(|c| c.id)
            .ok_or("Harness: product category not found")?;

        create_product(
            ctx,
            organization_id,
            CreateProductParams {
                name: format!("Harness Product {suffix}"),
                categ_id,
                type_: "storable".to_string(),
                uom_id,
                uom_po_id: uom_id,
                standard_price: 10.0,
                list_price: 20.0,
                currency_id: 1,
                default_code: Some(format!("HP-{suffix}")),
                barcode: None,
                description: None,
                sale_ok: Some(true),
                purchase_ok: Some(true),
                display_name: None,
                cost_method: None,
                valuation: None,
                volume: None,
                weight: None,
                can_be_expensed: None,
                available_in_pos: None,
                invoicing_policy: None,
                expense_policy: None,
                priority: None,
                is_published: None,
                description_purchase: None,
                description_sale: None,
                service_type: None,
                service_tracking: None,
                image_1920_url: None,
                image_128_url: None,
                color: None,
                responsible_id: None,
                pricelist_id: None,
                description_picking: None,
                description_pickingout: None,
                description_pickingin: None,
                location_id: None,
                warehouse_id: None,
                tracking: None,
                has_configurable_attributes: None,
                taxes_id: None,
                supplier_taxes_id: None,
                route_ids: None,
                route_from_categ_ids: None,
                property_account_income_id: Some(chart_account_ids[chart_keys::REVENUE]),
                property_account_expense_id: None,
                variant_attribute_ids: None,
                attribute_line_ids: None,
                metadata: Some(r#"{"harness":"minimal"}"#.to_string()),
            },
        )?;
        let product_id = ctx
            .db
            .product()
            .product_by_org()
            .filter(&organization_id)
            .find(|p| p.default_code == Some(format!("HP-{suffix}")))
            .map(|p| p.id)
            .ok_or("Harness: product not found")?;

        create_contact(
            ctx,
            organization_id,
            CreateContactParams {
                name: format!("Harness Customer {suffix}"),
                type_: "contact".to_string(),
                email: Some(format!("customer-{suffix}@harness.test")),
                phone: None,
                mobile: None,
                company_id: Some(company_id),
                is_customer: true,
                is_vendor: false,
                is_employee: false,
                is_prospect: false,
                is_partner: false,
                customer_rank: 1,
                supplier_rank: 0,
                display_name: None,
                first_name: None,
                last_name: None,
                title: None,
                email_secondary: None,
                fax: None,
                website: None,
                street: None,
                street2: None,
                city: None,
                state_code: None,
                zip: None,
                country_code: None,
                tax_id: None,
                company_registry: None,
                industry: None,
                employees_count: None,
                annual_revenue: None,
                description: None,
                salesperson_id: None,
                assigned_user_id: None,
                parent_id: None,
                user_id: None,
                color: None,
                metadata: None,
            },
        )?;
        let partner_id = ctx
            .db
            .contact()
            .contact_by_org()
            .filter(&organization_id)
            .find(|c| c.email == Some(format!("customer-{suffix}@harness.test")))
            .map(|c| c.id)
            .ok_or("Harness: partner contact not found")?;

        // `create_warehouse` requires picking-type FK scaffolding not seeded here; mirror `seed.rs`.
        let wh = ctx.db.warehouse().insert(Warehouse {
            id: 0,
            organization_id,
            name: format!("Harness WH {suffix}"),
            code: format!("WH{suffix}"),
            active: true,
            company_id,
            partner_id: Some(partner_id),
            lot_stock_id: 0,
            wh_input_stock_loc_id: None,
            wh_pack_stock_loc_id: None,
            wh_output_stock_loc_id: None,
            wh_qc_stock_loc_id: None,
            wh_scrap_loc_id: None,
            in_type_id: 0,
            out_type_id: 0,
            int_type_id: 0,
            pack_type_id: 0,
            pick_type_id: 0,
            qc_type_id: None,
            return_type_id: None,
            crossdock: false,
            reception_steps: "one_step".to_string(),
            delivery_steps: "one_step".to_string(),
            resupply_wh_ids: vec![],
            resupply_from_ids: vec![],
            buy_to_resupply: true,
            manufacture_to_resupply: false,
            manufacture_steps: "mrp_one_step".to_string(),
            resupply_subcontractor_on_order: false,
            subcontracting_to_resupply: false,
            view_location_id: None,
            mto_pull_id: None,
            buy_pull_id: None,
            pbh_dpm_ids: vec![],
            sequence: 1,
            is_active: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: Some(r#"{"harness":"minimal"}"#.to_string()),
        });

        Ok(Self {
            organization_id,
            company_id,
            fiscal_year_id,
            partner_id,
            product_id,
            warehouse_id: wh.id,
            chart_account_ids,
        })
    }
}

/// Elevate the caller to superuser so harness reducers pass permission checks.
pub fn ensure_test_superuser(ctx: &ReducerContext) -> Result<(), String> {
    if let Some(profile) = ctx.db.user_profile().identity().find(ctx.sender()) {
        ctx.db.user_profile().identity().update(UserProfile {
            is_superuser: true,
            ..profile
        });
    } else {
        ctx.db.user_profile().insert(UserProfile {
            identity: ctx.sender(),
            email: "harness@test.local".to_string(),
            email_verified: false,
            name: "Harness Tester".to_string(),
            first_name: Some("Harness".to_string()),
            last_name: Some("Tester".to_string()),
            avatar_url: None,
            phone: None,
            mobile: None,
            timezone: "UTC".to_string(),
            language: "en".to_string(),
            signature: None,
            notification_preferences: None,
            ui_preferences: None,
            is_active: true,
            is_superuser: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            last_login: Some(ctx.timestamp),
            metadata: Some(r#"{"harness":true}"#.to_string()),
        });
    }
    Ok(())
}

fn unique_suffix(ctx: &ReducerContext) -> u64 {
    use spacetimedb::rand::Rng;

    let micros = ctx
        .timestamp
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as u64;
    // Timestamp alone collides when several harness seeds run in one reducer
    // invocation (domain suites). Mix org count + deterministic rng for uniqueness.
    // Do not truncate with modulo — org codes are not unique and collisions reuse companies.
    let seq = ctx.db.organization().iter().count() as u64;
    let nonce = ctx.rng().gen::<u64>();
    micros
        .wrapping_mul(1_000_003)
        .wrapping_add(seq.wrapping_mul(1_000_033))
        .wrapping_add(nonce)
}

fn seed_account_type(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: &str,
    type_: &str,
    internal_group: AccountInternalGroup,
    include_initial_balance: bool,
) -> Result<u64, String> {
    create_account_account_type(
        ctx,
        organization_id,
        CreateAccountAccountTypeParams {
            name: name.to_string(),
            type_: type_.to_string(),
            internal_group,
            include_initial_balance,
            company_id: Some(company_id),
            metadata: None,
        },
    )?;
    ctx.db
        .account_account_type()
        .iter()
        .find(|t| t.name == name && t.organization_id == organization_id)
        .map(|t| t.id)
        .ok_or_else(|| format!("Harness: account type {name} not found"))
}

fn find_account_id(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    code: &str,
) -> Result<u64, String> {
    ctx.db
        .account_account()
        .iter()
        .find(|a| {
            a.organization_id == organization_id && a.company_id == company_id && a.code == code
        })
        .map(|a| a.id)
        .ok_or_else(|| format!("Harness: account {code} not found"))
}

#[cfg(test)]
mod smoke {
    use super::{chart_keys, OrgFixture};
    use std::collections::HashMap;

    #[test]
    fn harness_org_fixture_type_smoke() {
        let mut chart_account_ids = HashMap::new();
        chart_account_ids.insert(chart_keys::AR, 101);
        chart_account_ids.insert(chart_keys::AP, 102);
        chart_account_ids.insert(chart_keys::REVENUE, 103);

        let fixture = OrgFixture {
            organization_id: 1,
            company_id: 2,
            fiscal_year_id: 3,
            partner_id: 4,
            product_id: 5,
            warehouse_id: 6,
            chart_account_ids,
        };

        assert_eq!(fixture.organization_id, 1);
        assert_eq!(fixture.chart_account_ids[chart_keys::REVENUE], 103);
    }
}
