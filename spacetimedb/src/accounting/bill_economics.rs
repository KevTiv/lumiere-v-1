//! Pure invoice-currency arithmetic for purchase-order vendor bills.

use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy)]
pub(crate) struct PercentageTax {
    pub id: u64,
    pub rate: f64,
    pub included: bool,
}

/// Compute non-compounding percentage taxes from a gross amount. Both PO entry
/// and vendor-bill creation use this function so inclusive/exclusive composition
/// cannot drift between source evidence and the accounting document.
pub(crate) fn percentage_tax_amounts(
    gross: f64,
    taxes: &[PercentageTax],
) -> Result<BillEconomics, String> {
    if !gross.is_finite() || gross < 0.0 {
        return Err("gross amount is invalid".into());
    }
    let mut included_rate = 0.0;
    let mut ids = BTreeSet::new();
    for tax in taxes {
        if !ids.insert(tax.id) || !tax.rate.is_finite() || tax.rate < 0.0 {
            return Err("duplicate or invalid percentage tax".into());
        }
        if tax.included {
            included_rate += tax.rate / 100.0;
        }
    }

    let subtotal = gross / (1.0 + included_rate);
    let amounts: BTreeMap<_, _> = taxes
        .iter()
        .map(|tax| (tax.id, subtotal * (tax.rate / 100.0)))
        .collect();
    let total = subtotal + amounts.values().sum::<f64>();
    if !included_rate.is_finite() || !subtotal.is_finite() || !total.is_finite() {
        return Err("bill economic amounts are not finite".into());
    }
    Ok(BillEconomics {
        subtotal,
        taxes: amounts,
        total,
    })
}

pub(crate) struct BillEconomics {
    pub subtotal: f64,
    pub taxes: BTreeMap<u64, f64>,
    pub total: f64,
}

pub(crate) fn calculate(
    quantity: f64,
    price: f64,
    discount: f64,
    taxes: &[PercentageTax],
) -> Result<BillEconomics, String> {
    if !quantity.is_finite()
        || quantity <= 0.0
        || !price.is_finite()
        || price < 0.0
        || !discount.is_finite()
        || !(0.0..=100.0).contains(&discount)
    {
        return Err("bill quantity, unit price, or discount is invalid".into());
    }

    percentage_tax_amounts(quantity * price * (1.0 - discount / 100.0), taxes)
}

/// Verify an explicitly selected rule against the PO's retained aggregate tax.
/// This checks consistency; it does not infer a tax identity from an amount.
pub(crate) fn validate_po_tax_evidence(
    ordered_tax: f64,
    ordered_quantity: f64,
    billed_quantity: f64,
    discount: f64,
    computed_tax: f64,
) -> Result<(), String> {
    if !ordered_tax.is_finite()
        || ordered_tax < 0.0
        || !ordered_quantity.is_finite()
        || ordered_quantity <= 0.0
        || !billed_quantity.is_finite()
        || billed_quantity <= 0.0
        || !discount.is_finite()
        || !(0.0..=100.0).contains(&discount)
        || !computed_tax.is_finite()
        || computed_tax < 0.0
    {
        return Err("PO tax evidence or bill quantities are invalid".into());
    }

    let expected = ordered_tax * (billed_quantity / ordered_quantity) * (1.0 - discount / 100.0);
    if !expected.is_finite() || (expected - computed_tax).abs() > 1e-8 {
        return Err(
            "selected purchase taxes do not agree with the PO tax amount; review the PO and tax selection"
                .into(),
        );
    }
    Ok(())
}

pub(crate) fn ledger_amount(amount: f64, rate: f64, rounding: Option<f64>) -> Result<f64, String> {
    if !amount.is_finite() || amount < 0.0 || !rate.is_finite() || rate <= 0.0 {
        return Err("invalid currency amount or exchange rate".into());
    }
    let converted = amount * rate;
    let result = match rounding {
        Some(unit) if unit.is_finite() && unit > 0.0 => (converted / unit).round() * unit,
        Some(_) => return Err("invalid company currency rounding".into()),
        None => converted,
    };
    if !result.is_finite() {
        return Err("converted amount is not finite".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discount_is_applied_before_exclusive_tax() {
        let values = calculate(
            3.0,
            100.0,
            10.0,
            &[PercentageTax {
                id: 1,
                rate: 20.0,
                included: false,
            }],
        )
        .unwrap();
        assert_eq!(
            (values.subtotal, values.taxes[&1], values.total),
            (270.0, 54.0, 324.0)
        );
    }

    #[test]
    fn inclusive_and_exclusive_taxes_share_the_net_base() {
        let values = calculate(
            2.0,
            120.0,
            0.0,
            &[
                PercentageTax {
                    id: 1,
                    rate: 20.0,
                    included: true,
                },
                PercentageTax {
                    id: 2,
                    rate: 10.0,
                    included: false,
                },
            ],
        )
        .unwrap();
        assert_eq!(
            (
                values.subtotal,
                values.taxes[&1],
                values.taxes[&2],
                values.total,
            ),
            (200.0, 40.0, 20.0, 260.0)
        );
    }

    #[test]
    fn po_source_tax_total_uses_the_same_inclusive_exclusive_composition() {
        let values = percentage_tax_amounts(
            120.0,
            &[
                PercentageTax {
                    id: 1,
                    rate: 20.0,
                    included: true,
                },
                PercentageTax {
                    id: 2,
                    rate: 10.0,
                    included: false,
                },
            ],
        )
        .unwrap();
        assert_eq!(values.subtotal, 100.0);
        assert_eq!(values.taxes.values().sum::<f64>(), 30.0);
        assert_eq!(values.total, 130.0);
    }

    #[test]
    fn invalid_inputs_and_duplicate_taxes_are_rejected() {
        let tax = PercentageTax {
            id: 1,
            rate: 20.0,
            included: false,
        };
        assert!(calculate(1.0, 1.0, -1.0, &[]).is_err());
        assert!(calculate(f64::MAX, 2.0, 0.0, &[]).is_err());
        assert!(calculate(1.0, 1.0, 0.0, &[tax, tax]).is_err());
    }

    #[test]
    fn partial_receipts_use_the_exact_ordered_tax_ratio() {
        assert!(validate_po_tax_evidence(200.0, 10.0, 4.0, 0.0, 80.0).is_ok());
        assert!(validate_po_tax_evidence(200.0, 10.0, 6.0, 10.0, 108.0).is_ok());
        assert!(validate_po_tax_evidence(20.0, 1.0, 1.0, 0.0, 0.0).is_err());
    }

    #[test]
    fn fx_uses_company_rounding_and_rejects_invalid_rates() {
        assert_eq!(ledger_amount(10.01, 1.25, Some(0.01)).unwrap(), 12.51);
        assert_eq!(ledger_amount(10.01, 1.0, None).unwrap(), 10.01);
        assert!(ledger_amount(10.0, 0.0, None).is_err());
        assert!(ledger_amount(10.0, 1.0, Some(0.0)).is_err());
    }
}
