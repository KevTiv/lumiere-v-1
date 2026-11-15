//! Bounded actual live-lot consumption using the native Manufacturing workflow.

use serde::Deserialize;
use spacetimedb::ReducerContext;

use crate::core::{organization::company_vertical_pack, reference::uom};
use crate::helpers::check_permission;
use crate::inventory::stock::{ensure_lot_for_product, stock_move};
use crate::inventory::tracking::stock_production_lot;

use super::manufacturing_orders::MrpProduction;

const CONFIG_KEY: &str = "farm_processing_v1";

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FarmProcessingInput {
    live_lot_id: String,
    output_lot_id: String,
    farm_event_id: String,
    pub headcount: u32,
}

impl FarmProcessingInput {
    fn parse(metadata: Option<&str>) -> Result<Option<Self>, String> {
        let Some(metadata) = metadata else {
            return Ok(None);
        };
        let Ok(document) = serde_json::from_str::<serde_json::Value>(metadata) else {
            // Existing MO metadata can be arbitrary text.
            return Ok(None);
        };
        document
            .get(CONFIG_KEY)
            .map(|value| {
                let input: Self = serde_json::from_value(value.clone())
                    .map_err(|_| "Invalid farm processing configuration".to_string())?;
                if input.headcount == 0
                    || parse_id(&input.farm_event_id).is_none()
                    || input.lot_id()? == input.output_lot_id()?
                {
                    return Err("Farm processing requires a farm event, positive headcount and distinct lots".into());
                }
                Ok(input)
            })
            .transpose()
    }

    pub(super) fn for_order(
        ctx: &ReducerContext,
        mo: &MrpProduction,
    ) -> Result<Option<Self>, String> {
        let Some(input) = Self::parse(mo.metadata.as_deref())? else {
            return Ok(None);
        };
        check_permission(ctx, mo.organization_id, "farm_batch", "write")?;
        check_permission(ctx, mo.organization_id, "stock_move", "create")?;
        check_permission(ctx, mo.organization_id, "stock_move", "write")?;
        let pack_enabled = ctx
            .db
            .company_vertical_pack()
            .company_pack_by_company()
            .filter(&mo.company_id)
            .any(|pack| {
                pack.organization_id == mo.organization_id
                    && pack.pack_key == "farm_operations"
                    && pack.enabled
            });
        if !pack_enabled {
            return Err("Farm Operations is unavailable for this company".into());
        }
        let output_uom = ctx
            .db
            .uom()
            .id()
            .find(&mo.product_uom_id)
            .ok_or("Farm processing output unit is missing")?;
        if mo.bom_id.is_none()
            || mo.product_tracking != "lot"
            || output_uom.organization_id != mo.organization_id
            || !output_uom.is_active
            || !output_uom.symbol.trim().eq_ignore_ascii_case("kg")
        {
            return Err(
                "Farm processing requires a BOM and a lot-tracked output measured in kilograms"
                    .into(),
            );
        }
        Ok(Some(input))
    }

    pub(super) fn lot_id(&self) -> Result<u64, String> {
        parse_id(&self.live_lot_id).ok_or_else(|| "Invalid farm processing live lot".into())
    }

    pub(super) fn output_lot_id(&self) -> Result<u64, String> {
        parse_id(&self.output_lot_id).ok_or_else(|| "Invalid farm processing output lot".into())
    }

    pub(super) fn material_lot(
        &self,
        ctx: &ReducerContext,
        mo: &MrpProduction,
        product_id: u64,
        product_uom_id: u64,
        tracking: &str,
    ) -> Result<u64, String> {
        let unit = ctx
            .db
            .uom()
            .id()
            .find(&product_uom_id)
            .ok_or("Farm processing live input unit is missing")?;
        let count_unit = matches!(
            unit.symbol.trim().to_ascii_lowercase().as_str(),
            "ea" | "u" | "unit" | "units" | "pc" | "pcs" | "head" | "piece" | "pieces"
        );
        if product_id == mo.product_id
            || tracking != "lot"
            || unit.organization_id != mo.organization_id
            || !unit.is_active
            || !unit.is_reference_unit
            || !count_unit
        {
            return Err(
                "Farm processing needs a distinct lot-tracked live product measured in headcount"
                    .into(),
            );
        }
        let lot = self.lot_id()?;
        ensure_lot_for_product(ctx, mo.organization_id, mo.company_id, product_id, lot)?;
        let row = ctx
            .db
            .stock_production_lot()
            .id()
            .find(&lot)
            .ok_or("Farm processing live lot is unavailable")?;
        if row.product_variant_id.is_some()
            || row.package_id.is_some()
            || row.owner_id.is_some()
            || row.is_scrap
        {
            return Err("Farm processing requires an unpackaged, unowned, usable live lot".into());
        }
        Ok(lot)
    }

    pub(super) fn require_completed_consumption(
        &self,
        ctx: &ReducerContext,
        mo: &MrpProduction,
    ) -> Result<(), String> {
        let [move_id] = mo.move_raw_ids.as_slice() else {
            return Err("Farm processing requires one exact raw consumption move".into());
        };
        let movement = ctx
            .db
            .stock_move()
            .id()
            .find(move_id)
            .ok_or("Farm processing raw move is unavailable")?;
        if movement.organization_id != mo.organization_id
            || movement.company_id != mo.company_id
            || movement.raw_material_production_id != Some(mo.id)
            || movement.production_id != Some(mo.id)
            || movement.state != "done"
            || !movement.is_done
            || movement.scrapped
            || movement.lot_id != Some(self.lot_id()?)
            || movement.quantity_done != f64::from(self.headcount)
        {
            return Err("Raw consumption does not match approved farm processing input".into());
        }
        Ok(())
    }
}

fn parse_id(value: &str) -> Option<u64> {
    if !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse().ok().filter(|id| *id > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn farm_processing_uses_an_explicit_exact_lot_and_independent_actual_count() {
        let input = FarmProcessingInput::parse(Some(
            r#"{"farm_processing_v1":{"liveLotId":"9007199254740993","outputLotId":"20","farmEventId":"21","headcount":80},"other":"retained"}"#,
        )).unwrap().unwrap();
        assert_eq!(input.lot_id().unwrap(), 9_007_199_254_740_993);
        assert_eq!(input.headcount, 80);
        assert!(FarmProcessingInput::parse(Some("legacy memo"))
            .unwrap()
            .is_none());
        assert!(FarmProcessingInput::parse(Some(r#"{"other":12}"#))
            .unwrap()
            .is_none());
        for invalid in [
            r#"{"farm_processing_v1":{"liveLotId":"0","outputLotId":"20","farmEventId":"21","headcount":80}}"#,
            r#"{"farm_processing_v1":{"liveLotId":"9","outputLotId":"20","farmEventId":"21","headcount":0}}"#,
            r#"{"farm_processing_v1":{"liveLotId":"9","outputLotId":"20","farmEventId":"21","headcount":1.5}}"#,
            r#"{"farm_processing_v1":{"liveLotId":9,"outputLotId":"20","farmEventId":"21","headcount":80}}"#,
            r#"{"farm_processing_v1":{"liveLotId":"9","outputLotId":"20","farmEventId":"21","headcount":80,"skipInventory":true}}"#,
        ] {
            assert!(
                FarmProcessingInput::parse(Some(invalid)).is_err(),
                "{invalid}"
            );
        }
    }
}
