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
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::fiscal_periods::{
    account_fiscal_year, account_period, create_account_period, create_fiscal_year,
    open_account_period, open_fiscal_year, CreateAccountPeriodParams, CreateFiscalYearParams,
};
use crate::core::organization::{
    company, create_company, insert_organization_with_owner, organization, organization_settings,
    CreateCompanyParams, CreateOrganizationParams, OrganizationSettings,
};
use crate::core::reference::{
    create_currency, create_uom, create_uom_category, currency, seed_currency_for_organization,
    uom, uom_cat, CreateCurrencyParams, CreateUomCategoryParams, CreateUomParams,
};
use crate::core::users::{find_user_profile_for_identity, user_profile, UserProfile};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::crm::CRM_MULTI_COMPANY_FLAG;
use crate::inventory::product::{create_product, product, CreateProductParams};
use crate::inventory::product_category::{
    create_product_category, product_category, CreateProductCategoryParams,
};
use crate::inventory::stock::{create_stock_picking, stock_picking, CreateStockPickingParams};
use crate::inventory::stock::{stock_quant, StockQuant};
use crate::inventory::warehouse::{stock_location, warehouse, StockLocation, Warehouse};
use crate::types::{AccountInternalGroup, AccountTypeInternal, JournalType};

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
    /// Real `stock_location` row (internal, org-scoped) backing `warehouse_id`'s
    /// `lot_stock_id`. Use this — never `warehouse_id` — wherever a reducer
    /// expects a `location_id`/`location_dest_id`: the two tables have
    /// independently incrementing primary keys, so `warehouse_id` is only a
    /// valid `stock_location` id by coincidence on the very first fixture call.
    pub location_id: u64,
    /// Real `stock_location` row with `usage = "customer"`. Use this — never
    /// `partner_id` — wherever a reducer expects an outbound `location_dest_id`:
    /// a Contact id is not a StockLocation id.
    pub customer_location_id: u64,
    /// Real `stock_location` row with `usage = "supplier"`. Use this — never
    /// `partner_id` — wherever a reducer expects an inbound source `location_id`.
    pub supplier_location_id: u64,
    pub chart_account_ids: HashMap<&'static str, u64>,
}

impl OrgFixture {
    /// Seed org-scoped baseline data via domain reducers (plus one warehouse row aligned with `seed.rs`).
    pub fn seed_minimal(ctx: &ReducerContext) -> Result<Self, String> {
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
        // Organization creation establishes the caller's membership and
        // organization-owned profile. Promote only after that profile exists;
        // fresh C0 databases intentionally have no global/sentinel profile.
        ensure_test_superuser(ctx)?;
        // Canonical reference rows are tenant-owned. Seed them only after the
        // organization exists so tests never depend on global/sentinel rows.
        seed_currency_for_organization(ctx, organization_id, "USD")?;
        seed_currency_for_organization(ctx, organization_id, "EUR")?;
        let currency_id = create_currency(
            ctx,
            organization_id,
            format!("T{suffix}"),
            CreateCurrencyParams {
                name: "Harness currency".to_string(),
                symbol: "¤".to_string(),
                decimal_places: 2,
                rounding_factor: 0.01,
                position: "before".to_string(),
                active: true,
                metadata: Some(r#"{"harness":"minimal"}"#.to_string()),
            },
        )
        .and_then(|_| {
            ctx.db
                .currency()
                .iter()
                .find(|currency| {
                    currency.organization_id == organization_id
                        && currency.code == format!("T{suffix}")
                })
                .map(|currency| currency.id)
                .ok_or_else(|| "Harness: currency not found after create".to_string())
        })?;

        create_company(
            ctx,
            organization_id,
            CreateCompanyParams {
                name: format!("Test Company {suffix}"),
                code: company_code.clone(),
                currency_id,
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
                is_adjustment: false,
                notes: None,
                metadata: None,
            },
        )?;
        let period_id = ctx
            .db
            .account_period()
            .period_by_fiscal_year()
            .filter(&fiscal_year_id)
            .find(|period| period.code == format!("OP{suffix}"))
            .map(|period| period.id)
            .ok_or("Harness: accounting period not found after create")?;
        open_fiscal_year(ctx, organization_id, company_id, fiscal_year_id)?;
        open_account_period(ctx, organization_id, company_id, period_id)?;

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
                currency_id,
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

        let loc_stock = ctx.db.stock_location().insert(StockLocation {
            id: 0,
            organization_id,
            name: format!("Harness Stock {suffix}"),
            complete_name: Some(format!("WH{suffix}/Stock")),
            location_id: None,
            parent_path: "".to_string(),
            child_ids: vec![],
            child_left: 0,
            child_right: 0,
            usage: "internal".to_string(),
            company_id: Some(company_id),
            scrap_location: false,
            return_location: false,
            valuation_in_account_id: None,
            valuation_out_account_id: None,
            active: true,
            comment: None,
            posx: 0.0,
            posy: 0.0,
            posz: 0.0,
            barcode: None,
            cyclic_inventory_frequency: 0,
            last_inventory_date: None,
            next_inventory_date: None,
            location_category: "internal".to_string(),
            is_active: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: None,
        });
        let loc_supplier = ctx.db.stock_location().insert(StockLocation {
            id: 0,
            name: format!("Harness Supplier {suffix}"),
            complete_name: Some(format!("WH{suffix}/Supplier")),
            usage: "supplier".to_string(),
            location_category: "supplier".to_string(),
            ..loc_stock.clone()
        });
        let loc_customer = ctx.db.stock_location().insert(StockLocation {
            id: 0,
            name: format!("Harness Customer {suffix}"),
            complete_name: Some(format!("WH{suffix}/Customer")),
            usage: "customer".to_string(),
            location_category: "customer".to_string(),
            ..loc_stock.clone()
        });

        ctx.db.warehouse().id().update(Warehouse {
            lot_stock_id: loc_stock.id,
            ..wh
        });

        ctx.db.stock_quant().insert(StockQuant {
            id: 0,
            organization_id,
            product_id,
            product_variant_id: None,
            location_id: loc_stock.id,
            lot_id: None,
            package_id: None,
            owner_id: None,
            company_id,
            quantity: 100.0,
            reserved_quantity: 0.0,
            available_quantity: 100.0,
            in_date: Some(ctx.timestamp),
            inventory_quantity: 100.0,
            inventory_diff_quantity: 0.0,
            inventory_quantity_set: true,
            is_outdated: false,
            user_id: Some(ctx.sender()),
            inventory_date: Some(ctx.timestamp),
            cost: 10.0,
            value: 1_000.0,
            cost_method: Some("standard".to_string()),
            accounting_date: None,
            currency_id: None,
            accounting_entry_ids: vec![],
            metadata: Some(r#"{"harness":"minimal"}"#.to_string()),
        });

        Ok(Self {
            organization_id,
            company_id,
            fiscal_year_id,
            partner_id,
            product_id,
            warehouse_id: wh.id,
            location_id: loc_stock.id,
            customer_location_id: loc_customer.id,
            supplier_location_id: loc_supplier.id,
            chart_account_ids,
        })
    }
}

/// A complete purchasing relation scope with deliberately distinctive records.
///
/// Use this instead of numeric literals in purchasing integrity tests. Every ID
/// comes from a persisted row and may therefore catch accidental `1`/`0`
/// fallbacks or lookups that escape the intended organization or company.
#[derive(Debug, Clone)]
pub struct PurchasingIntegrityScope {
    pub organization_id: u64,
    pub company_id: u64,
    pub currency_id: u64,
    pub journal_id: u64,
    pub expense_account_id: u64,
    pub payable_account_id: u64,
    pub vendor_id: u64,
    pub product_id: u64,
    pub uom_id: u64,
    pub warehouse_id: u64,
    pub picking_id: u64,
}

/// Representative persisted data for Phase 0 purchasing characterization.
///
/// `primary` is the valid submit scope. `cross_company_id` belongs to the same
/// organization but not `primary.company_id`; `foreign` contains equivalent
/// records in a separate organization. Tests can use these values directly for
/// company- and organization-boundary negative cases without relying on seeded
/// demo IDs.
#[derive(Debug, Clone)]
pub struct PurchasingIntegrityFixture {
    pub primary: PurchasingIntegrityScope,
    pub cross_company_id: u64,
    pub foreign: PurchasingIntegrityScope,
}

impl PurchasingIntegrityFixture {
    /// Seeds primary, same-organization foreign-company, and foreign-organization
    /// data with non-default business values, then proves the rows persisted in
    /// their expected scopes.
    pub fn seed(ctx: &ReducerContext) -> Result<Self, String> {
        ensure_test_superuser(ctx)?;

        // OrgFixture provides the fiscal and permission baseline required by the
        // accounting and inventory reducers. The purchasing scope below creates
        // a distinct legal entity rather than reusing its default company.
        let suffix = unique_suffix(ctx);
        let primary_base = OrgFixture::seed_minimal(ctx)?;
        let currency_id = seed_distinctive_currency(ctx, primary_base.organization_id, suffix)?;
        let primary = seed_purchasing_integrity_scope(
            ctx,
            primary_base.organization_id,
            currency_id,
            &format!("PRI-{suffix}"),
        )?;
        let cross_company_id = seed_integrity_company(
            ctx,
            primary.organization_id,
            currency_id,
            &format!("XCO-{suffix}"),
        )?;

        let foreign_base = OrgFixture::seed_minimal(ctx)?;
        let foreign = seed_purchasing_integrity_scope(
            ctx,
            foreign_base.organization_id,
            currency_id,
            &format!("FOR-{suffix}"),
        )?;

        let fixture = Self {
            primary,
            cross_company_id,
            foreign,
        };
        fixture.assert_persisted(ctx)?;
        Ok(fixture)
    }

    /// Confirms the fixture is useful evidence: every relation exists in its
    /// expected scope, and the two diagnostic boundaries are genuinely distinct.
    pub fn assert_persisted(&self, ctx: &ReducerContext) -> Result<(), String> {
        if self.primary.organization_id == self.foreign.organization_id {
            return Err("Harness: purchasing fixture organizations must differ".into());
        }
        if self.primary.company_id == self.cross_company_id {
            return Err("Harness: cross-company ID must differ from primary company".into());
        }
        let cross_company = ctx
            .db
            .company()
            .id()
            .find(&self.cross_company_id)
            .ok_or("Harness: cross-company row missing")?;
        if cross_company.organization_id != self.primary.organization_id {
            return Err("Harness: cross-company row is outside primary organization".into());
        }

        assert_purchasing_scope_persisted(ctx, &self.primary)?;
        assert_purchasing_scope_persisted(ctx, &self.foreign)?;
        Ok(())
    }
}

fn seed_distinctive_currency(
    ctx: &ReducerContext,
    organization_id: u64,
    suffix: u64,
) -> Result<u64, String> {
    const CURRENCY_CODE_SPACE: u64 = 26 * 26 * 26;

    fn currency_code(index: u64) -> String {
        let mut value = index % CURRENCY_CODE_SPACE;
        let mut bytes = [b'A'; 3];
        for byte in bytes.iter_mut().rev() {
            *byte += (value % 26) as u8;
            value /= 26;
        }
        bytes.into_iter().map(char::from).collect()
    }

    // Guarded workflow snapshots require three-letter uppercase currency codes.
    // Select two currently unused codes so repeated persisted-data runs remain
    // distinctive without colliding with canonical or earlier fixture currencies.
    let mut codes = Vec::with_capacity(2);
    for offset in 0..CURRENCY_CODE_SPACE {
        let code = currency_code(suffix.wrapping_add(offset));
        if ctx
            .db
            .currency()
            .iter()
            .all(|currency| currency.organization_id != organization_id || currency.code != code)
        {
            codes.push(code);
            if codes.len() == 2 {
                break;
            }
        }
    }
    if codes.len() != 2 {
        return Err("Harness: no unused three-letter currency codes remain".to_string());
    }

    // A first catalog row guarantees the currency consumed by purchasing tests
    // is never the implicit first/global default in an otherwise empty runtime.
    for (code, name) in [
        (codes[0].clone(), "Harness control currency"),
        (codes[1].clone(), "Harness purchasing currency"),
    ] {
        create_currency(
            ctx,
            organization_id,
            code.clone(),
            CreateCurrencyParams {
                name: name.to_string(),
                symbol: "¤".to_string(),
                decimal_places: 2,
                rounding_factor: 0.01,
                position: "before".to_string(),
                active: true,
                metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
            },
        )?;
    }

    ctx.db
        .currency()
        .iter()
        .find(|currency| currency.organization_id == organization_id && currency.code == codes[1])
        .map(|row| row.id)
        .ok_or("Harness: purchasing currency missing after create".into())
}

fn seed_integrity_company(
    ctx: &ReducerContext,
    organization_id: u64,
    currency_id: u64,
    marker: &str,
) -> Result<u64, String> {
    let code = format!("{marker}-CO");
    create_company(
        ctx,
        organization_id,
        CreateCompanyParams {
            name: format!("Purchasing Integrity Company {marker}"),
            code: code.clone(),
            currency_id,
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
            metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
        },
    )?;
    ctx.db
        .company()
        .company_by_org()
        .filter(&organization_id)
        .find(|company| company.code == code)
        .map(|company| company.id)
        .ok_or_else(|| format!("Harness: company {code} missing after create"))
}

fn seed_purchasing_integrity_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    currency_id: u64,
    marker: &str,
) -> Result<PurchasingIntegrityScope, String> {
    let company_id = seed_integrity_company(ctx, organization_id, currency_id, marker)?;
    let account_type_id = seed_account_type(
        ctx,
        organization_id,
        company_id,
        &format!("Purchasing Expense {marker}"),
        "expense",
        AccountInternalGroup::Expense,
        false,
    )?;
    let account_code = format!("62{marker}");
    create_account_account(
        ctx,
        organization_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: account_code.clone(),
            name: format!("Landed Cost Expense {marker}"),
            user_type_id: account_type_id,
            currency_id: Some(currency_id),
            internal_type: Some(AccountTypeInternal::Expense),
            internal_group: Some(AccountInternalGroup::Expense),
            group_id: None,
            reconcile: false,
            tax_ids: vec![],
            note: None,
            opening_debit: 0.0,
            opening_credit: 0.0,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_off_balance: false,
            metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
        },
    )?;
    let expense_account_id = find_account_id(ctx, organization_id, company_id, &account_code)?;
    let payable_type_id = seed_account_type(
        ctx,
        organization_id,
        company_id,
        &format!("Purchasing Payable {marker}"),
        "payable",
        AccountInternalGroup::Liability,
        true,
    )?;
    let payable_code = format!("21{marker}");
    create_account_account(
        ctx,
        organization_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: payable_code.clone(),
            name: format!("Accounts Payable {marker}"),
            user_type_id: payable_type_id,
            currency_id: Some(currency_id),
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
            metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
        },
    )?;
    let payable_account_id = find_account_id(ctx, organization_id, company_id, &payable_code)?;

    let journal_code = format!("LC{marker}");
    create_account_journal(
        ctx,
        organization_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: format!("Landed Cost Journal {marker}"),
            code: journal_code.clone(),
            type_: JournalType::Purchase,
            currency_id: Some(currency_id),
            default_account_id: Some(expense_account_id),
            suspense_account_id: None,
            loss_account_id: None,
            profit_account_id: None,
            bank_account_id: None,
            payment_credit_account_id: None,
            payment_debit_account_id: None,
            invoice_reference_type: None,
            invoice_reference_model: None,
            sequence_id: None,
            refund_sequence_id: None,
            sequence_override_regex: None,
            secure_sequence_id: None,
            alias_name: None,
            alias_domain: None,
            sale_activity_type_id: None,
            sale_activity_user_id: None,
            sale_activity_note: None,
            sale_activity_date_deadline: None,
            restrict_mode_hash_table: false,
            active: true,
            at_least_one_inbound: false,
            at_least_one_outbound: true,
            dedicated_payment_method_ids: vec![],
            sale_activity_done: false,
            metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
        },
    )?;
    let journal_id = ctx
        .db
        .account_journal()
        .iter()
        .find(|journal| {
            journal.organization_id == organization_id
                && journal.company_id == company_id
                && journal.code == journal_code
        })
        .map(|journal| journal.id)
        .ok_or("Harness: purchasing journal missing after create")?;

    create_uom_category(
        ctx,
        organization_id,
        CreateUomCategoryParams {
            name: format!("Purchasing Units {marker}"),
            description: None,
            sequence: 17,
            metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
        },
    )?;
    let uom_category_id = ctx
        .db
        .uom_cat()
        .uom_cat_by_org()
        .filter(&organization_id)
        .find(|category| category.name == format!("Purchasing Units {marker}"))
        .map(|category| category.id)
        .ok_or("Harness: purchasing UoM category missing after create")?;
    create_uom(
        ctx,
        organization_id,
        CreateUomParams {
            category_id: uom_category_id,
            name: format!("Carton {marker}"),
            symbol: "CTN".to_string(),
            factor: 12.0,
            rounding: 0.01,
            times_bigger: 12.0,
            is_reference_unit: true,
            is_active: true,
            metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
        },
    )?;
    let uom_id = ctx
        .db
        .uom()
        .iter()
        .find(|uom| uom.category_id == uom_category_id && uom.name == format!("Carton {marker}"))
        .map(|uom| uom.id)
        .ok_or("Harness: purchasing UoM missing after create")?;

    create_product_category(
        ctx,
        organization_id,
        CreateProductCategoryParams {
            name: format!("Purchasing Goods {marker}"),
            parent_id: None,
            sequence: 17,
            company_id: Some(company_id),
            metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
        },
    )?;
    let category_id = ctx
        .db
        .product_category()
        .iter()
        .find(|category| {
            category.organization_id == organization_id
                && category.company_id == Some(company_id)
                && category.name == format!("Purchasing Goods {marker}")
        })
        .map(|category| category.id)
        .ok_or("Harness: purchasing product category missing after create")?;
    let product_code = format!("LC-{marker}");
    create_product(
        ctx,
        organization_id,
        CreateProductParams {
            name: format!("Landed Cost Product {marker}"),
            categ_id: category_id,
            type_: "storable".to_string(),
            uom_id,
            uom_po_id: uom_id,
            standard_price: 37.25,
            list_price: 59.75,
            currency_id,
            default_code: Some(product_code.clone()),
            barcode: None,
            description: Some(format!("Distinctive purchasing fixture product {marker}")),
            sale_ok: Some(false),
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
            description_purchase: Some(format!("Supplier carton {marker}")),
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
            property_account_income_id: None,
            property_account_expense_id: Some(expense_account_id),
            variant_attribute_ids: None,
            attribute_line_ids: None,
            metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
        },
    )?;
    let product_id = ctx
        .db
        .product()
        .product_by_org()
        .filter(&organization_id)
        .find(|product| product.default_code == Some(product_code.clone()))
        .map(|product| product.id)
        .ok_or("Harness: purchasing product missing after create")?;

    // The fixture creates a second company in an org that already has one
    // (from OrgFixture::seed_minimal), making it a multi-company org.  The
    // CRM guard (CRM-RI-007) rejects contacts scoped to a non-default
    // company unless the org has opted in via the crm_multi_company flag.
    // Enable that flag here so the vendor contact can be company-scoped
    // for cross-company boundary assertions without hitting the guard.
    //
    // Note: seed_minimal uses insert_organization_with_owner which does NOT
    // create an OrganizationSettings row (only bootstrap_new_tenant does),
    // so we must handle both the insert and update paths.
    match ctx
        .db
        .organization_settings()
        .organization_id()
        .find(&organization_id)
    {
        Some(settings) => {
            let mut flags = settings.feature_flags.clone();
            if !flags.iter().any(|f| f == CRM_MULTI_COMPANY_FLAG) {
                flags.push(CRM_MULTI_COMPANY_FLAG.to_string());
            }
            ctx.db
                .organization_settings()
                .organization_id()
                .update(OrganizationSettings {
                    feature_flags: flags,
                    updated_at: ctx.timestamp,
                    ..settings
                });
        }
        None => {
            ctx.db.organization_settings().insert(OrganizationSettings {
                organization_id,
                module_config: None,
                feature_flags: vec![CRM_MULTI_COMPANY_FLAG.to_string()],
                integration_keys: None,
                updated_at: ctx.timestamp,
                metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
            });
        }
    }

    let vendor_email = format!("vendor-{marker}@harness.test");
    create_contact(
        ctx,
        organization_id,
        CreateContactParams {
            name: format!("Landed Cost Vendor {marker}"),
            type_: "contact".to_string(),
            email: Some(vendor_email.clone()),
            phone: None,
            mobile: None,
            company_id: Some(company_id),
            is_customer: false,
            is_vendor: true,
            is_employee: false,
            is_prospect: false,
            is_partner: false,
            customer_rank: 0,
            supplier_rank: 17,
            display_name: Some(format!("Landed Cost Vendor {marker}")),
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
            metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
        },
    )?;
    let vendor_id = ctx
        .db
        .contact()
        .contact_by_org()
        .filter(&organization_id)
        .find(|contact| contact.email == Some(vendor_email.clone()))
        .map(|contact| contact.id)
        .ok_or("Harness: purchasing vendor missing after create")?;

    let warehouse_id =
        seed_integrity_warehouse(ctx, organization_id, company_id, vendor_id, marker)?;
    let warehouse = ctx
        .db
        .warehouse()
        .id()
        .find(&warehouse_id)
        .ok_or("Harness: purchasing warehouse missing after create")?;
    let picking_name = format!("LC-IN-{marker}");
    create_stock_picking(
        ctx,
        organization_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: picking_name.clone(),
            // Warehouse fixture rows intentionally do not depend on operational
            // picking-type scaffolding; this non-zero stable ID is sufficient for
            // a representative incoming picking used by landed-cost tests.
            picking_type_id: warehouse_id,
            location_id: warehouse.lot_stock_id,
            location_dest_id: warehouse.lot_stock_id,
            move_type: "direct".to_string(),
            priority: "2".to_string(),
            partner_id: Some(vendor_id),
            contact_id: Some(vendor_id),
            scheduled_date: Some(ctx.timestamp),
            origin: Some(format!("Landed cost fixture {marker}")),
            note: None,
            user_id: Some(ctx.sender()),
            sale_id: None,
            purchase_id: None,
            group_id: None,
            is_locked: false,
            immediate_transfer: false,
            is_printed: false,
            is_return: false,
            has_scrap_move: false,
            has_tracking: false,
            date: Some(ctx.timestamp),
            date_done: None,
            backorder_id: None,
            backorder_ids: vec![],
            show_operations: true,
            show_lots_text: false,
            show_reserved: false,
            show_check_availability: true,
            show_validate: true,
            show_mark_as_todo: false,
            show_set_qty_button: false,
            show_clear_qty_button: false,
            show_lots_m2o: false,
            product_id: Some(product_id),
            lot_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            display_lot_id: None,
            location_id_name: Some(format!("Integrity Stock {marker}")),
            location_dest_id_name: Some(format!("Integrity Stock {marker}")),
            picking_code: Some("incoming".to_string()),
            product_tracking: None,
            product_barcode: None,
            move_line_exist: false,
            has_packages: false,
            has_move_lines: false,
            has_package: false,
            has_lot: false,
            has_owner: false,
            has_entire_package_src: false,
            has_entire_package_dest: false,
            package_level_ids: vec![],
            batch_id: None,
            metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
        },
    )?;
    let picking_id = ctx
        .db
        .stock_picking()
        .iter()
        .find(|picking| {
            picking.organization_id == organization_id
                && picking.company_id == company_id
                && picking.name == picking_name
        })
        .map(|picking| picking.id)
        .ok_or("Harness: purchasing picking missing after create")?;

    Ok(PurchasingIntegrityScope {
        organization_id,
        company_id,
        currency_id,
        journal_id,
        expense_account_id,
        payable_account_id,
        vendor_id,
        product_id,
        uom_id,
        warehouse_id,
        picking_id,
    })
}

fn seed_integrity_warehouse(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    vendor_id: u64,
    marker: &str,
) -> Result<u64, String> {
    let warehouse = ctx.db.warehouse().insert(Warehouse {
        id: 0,
        organization_id,
        name: format!("Integrity Warehouse {marker}"),
        code: format!("IW{marker}"),
        active: true,
        company_id,
        partner_id: Some(vendor_id),
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
        sequence: 17,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
    });
    let location = ctx.db.stock_location().insert(StockLocation {
        id: 0,
        organization_id,
        name: format!("Integrity Stock {marker}"),
        complete_name: Some(format!("IW{marker}/Stock")),
        location_id: None,
        parent_path: "".to_string(),
        child_ids: vec![],
        child_left: 0,
        child_right: 0,
        usage: "internal".to_string(),
        company_id: Some(company_id),
        scrap_location: false,
        return_location: false,
        valuation_in_account_id: None,
        valuation_out_account_id: None,
        active: true,
        comment: None,
        posx: 0.0,
        posy: 0.0,
        posz: 0.0,
        barcode: None,
        cyclic_inventory_frequency: 0,
        last_inventory_date: None,
        next_inventory_date: None,
        location_category: "internal".to_string(),
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: Some(r#"{"harness":"purchasing-integrity"}"#.to_string()),
    });
    ctx.db.stock_location().insert(StockLocation {
        id: 0,
        name: format!("Integrity Supplier {marker}"),
        complete_name: Some(format!("IW{marker}/Supplier")),
        usage: "supplier".to_string(),
        location_category: "supplier".to_string(),
        ..location.clone()
    });
    ctx.db.warehouse().id().update(Warehouse {
        lot_stock_id: location.id,
        ..warehouse
    });
    Ok(warehouse.id)
}

fn assert_purchasing_scope_persisted(
    ctx: &ReducerContext,
    scope: &PurchasingIntegrityScope,
) -> Result<(), String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&scope.company_id)
        .ok_or("Harness: purchasing company row missing")?;
    if company.organization_id != scope.organization_id || company.currency_id != scope.currency_id
    {
        return Err("Harness: purchasing company scope/currency mismatch".into());
    }
    if ctx.db.currency().id().find(&scope.currency_id).is_none() {
        return Err("Harness: purchasing currency row missing".into());
    }
    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&scope.journal_id)
        .ok_or("Harness: purchasing journal row missing")?;
    if journal.organization_id != scope.organization_id
        || journal.company_id != scope.company_id
        || journal.currency_id != Some(scope.currency_id)
        || journal.default_account_id != Some(scope.expense_account_id)
    {
        return Err("Harness: purchasing journal relation mismatch".into());
    }
    let account = ctx
        .db
        .account_account()
        .id()
        .find(&scope.expense_account_id)
        .ok_or("Harness: purchasing account row missing")?;
    if account.organization_id != scope.organization_id || account.company_id != scope.company_id {
        return Err("Harness: purchasing account scope mismatch".into());
    }
    let payable = ctx
        .db
        .account_account()
        .id()
        .find(&scope.payable_account_id)
        .ok_or("Harness: purchasing payable account row missing")?;
    if payable.organization_id != scope.organization_id
        || payable.company_id != scope.company_id
        || payable.internal_type != Some(AccountTypeInternal::Payable)
    {
        return Err("Harness: purchasing payable account scope/role mismatch".into());
    }
    let vendor = ctx
        .db
        .contact()
        .id()
        .find(&scope.vendor_id)
        .ok_or("Harness: purchasing vendor row missing")?;
    if vendor.organization_id != scope.organization_id
        || vendor.company_id != Some(scope.company_id)
        || !vendor.is_vendor
    {
        return Err("Harness: purchasing vendor scope/role mismatch".into());
    }
    let product = ctx
        .db
        .product()
        .id()
        .find(&scope.product_id)
        .ok_or("Harness: purchasing product row missing")?;
    if product.organization_id != scope.organization_id
        || product.uom_id != scope.uom_id
        || product.uom_po_id != scope.uom_id
        || product.currency_id != scope.currency_id
    {
        return Err("Harness: purchasing product relation mismatch".into());
    }
    let uom = ctx
        .db
        .uom()
        .id()
        .find(&scope.uom_id)
        .ok_or("Harness: purchasing UoM row missing")?;
    if uom.organization_id != scope.organization_id || !uom.is_active {
        return Err("Harness: purchasing UoM scope/lifecycle mismatch".into());
    }
    let warehouse = ctx
        .db
        .warehouse()
        .id()
        .find(&scope.warehouse_id)
        .ok_or("Harness: purchasing warehouse row missing")?;
    if warehouse.organization_id != scope.organization_id
        || warehouse.company_id != scope.company_id
    {
        return Err("Harness: purchasing warehouse scope mismatch".into());
    }
    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&scope.picking_id)
        .ok_or("Harness: purchasing picking row missing")?;
    if picking.organization_id != scope.organization_id
        || picking.company_id != scope.company_id
        || picking.partner_id != Some(scope.vendor_id)
        || picking.product_id != Some(scope.product_id)
        || picking.picking_code.as_deref() != Some("incoming")
    {
        return Err("Harness: purchasing picking relation mismatch".into());
    }
    Ok(())
}

/// Elevate the caller to superuser so harness reducers pass permission checks.
pub fn ensure_test_superuser(ctx: &ReducerContext) -> Result<(), String> {
    if let Some(profile) = find_user_profile_for_identity(ctx, ctx.sender()) {
        ctx.db.user_profile().id().update(UserProfile {
            is_superuser: true,
            ..profile
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
            location_id: 7,
            customer_location_id: 8,
            supplier_location_id: 9,
            chart_account_ids,
        };

        assert_eq!(fixture.organization_id, 1);
        assert_eq!(fixture.chart_account_ids[chart_keys::REVENUE], 103);
    }
}
