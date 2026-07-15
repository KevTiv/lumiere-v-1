//! Country pack activation smoke test (A11).
use spacetimedb::ReducerContext;

use crate::core::country_pack::{
    company_country_pack, country_pack_definition, country_pack_tax_rule,
    set_company_country_pack, SetCompanyCountryPackParams,
};
use crate::core::migrations::apply_pending_global_migrations;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_country_pack_activation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    apply_pending_global_migrations(ctx)?;

    let za = ctx
        .db
        .country_pack_definition()
        .pack_key()
        .find(&"za".to_string())
        .ok_or("ZA pack definition missing")?;

    if !za.is_active {
        return Err("ZA pack should be active".to_string());
    }

    let tax_rules = ctx
        .db
        .country_pack_tax_rule()
        .pack_tax_by_pack()
        .filter(&"za".to_string())
        .count();
    if tax_rules == 0 {
        return Err("ZA pack tax rules missing".to_string());
    }

    let fixture = OrgFixture::seed_minimal(ctx)?;

    set_company_country_pack(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        SetCompanyCountryPackParams {
            pack_key: "za".to_string(),
            enabled: true,
            configuration: Some(r#"{"pilot":true}"#.to_string()),
        },
    )?;

    let activated = ctx
        .db
        .company_country_pack()
        .company_country_pack_by_company()
        .filter(&fixture.company_id)
        .find(|p| p.pack_key == "za" && p.enabled)
        .ok_or("Company country pack not activated")?;

    if activated.organization_id != fixture.organization_id {
        return Err("Country pack org scope mismatch".to_string());
    }

    Ok(())
}
