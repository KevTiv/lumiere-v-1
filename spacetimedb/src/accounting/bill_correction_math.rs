//! Pure invoice-currency arithmetic used by the authoritative draft correction path.
use std::collections::BTreeMap;

#[derive(Clone, Copy)]
pub(crate) struct PercentageTax {
    pub id: u64,
    pub rate: f64,
    pub included: bool,
}

pub(crate) struct Economics {
    pub subtotal: f64,
    pub taxes: BTreeMap<u64, f64>,
    pub total: f64,
}

pub(crate) fn economics(
    quantity: f64,
    price: f64,
    discount: f64,
    taxes: &[PercentageTax],
) -> Result<Economics, String> {
    if !quantity.is_finite()
        || quantity <= 0.0
        || !price.is_finite()
        || price < 0.0
        || !discount.is_finite()
        || !(0.0..=100.0).contains(&discount)
    {
        return Err("Quantity, unit price or existing discount is invalid".into());
    }
    let gross = quantity * price * (1.0 - discount / 100.0);
    let mut included = 0.0;
    let mut ids = std::collections::BTreeSet::new();
    for tax in taxes {
        if !ids.insert(tax.id) || !tax.rate.is_finite() || tax.rate < 0.0 {
            return Err("Duplicate or invalid percentage tax".into());
        }
        if tax.included {
            included += tax.rate / 100.0;
        }
    }
    let subtotal = gross / (1.0 + included);
    let amounts: BTreeMap<_, _> = taxes
        .iter()
        .map(|tax| (tax.id, subtotal * (tax.rate / 100.0)))
        .collect();
    let total = subtotal + amounts.values().sum::<f64>();
    if !gross.is_finite() || !included.is_finite() || !subtotal.is_finite() || !total.is_finite() {
        return Err("Corrected economic amounts are not finite".into());
    }
    Ok(Economics {
        subtotal,
        taxes: amounts,
        total,
    })
}

pub(crate) fn ledger_amount(amount: f64, rate: f64, rounding: Option<f64>) -> Result<f64, String> {
    if !amount.is_finite() || amount < 0.0 || !rate.is_finite() || rate <= 0.0 {
        return Err("Invalid currency amount or exchange rate".into());
    }
    let converted = amount * rate;
    let result = match rounding {
        Some(unit) if unit.is_finite() && unit > 0.0 => (converted / unit).round() * unit,
        Some(_) => return Err("Invalid company currency rounding".into()),
        None => converted,
    };
    if !result.is_finite() {
        return Err("Converted amount is not finite".into());
    }
    Ok(result)
}

/// Verify an explicitly selected rule against the PO's retained aggregate tax.
/// This is a consistency check, not tax identity discovery from an amount.
pub(crate) fn validate_po_tax_evidence(
    ordered_tax: f64,
    ordered_qty: f64,
    billed_qty: f64,
    discount: f64,
    computed_tax: f64,
) -> Result<(), String> {
    if !ordered_tax.is_finite()
        || ordered_tax < 0.0
        || !ordered_qty.is_finite()
        || ordered_qty <= 0.0
        || !billed_qty.is_finite()
        || billed_qty <= 0.0
        || !discount.is_finite()
        || !(0.0..=100.0).contains(&discount)
        || !computed_tax.is_finite()
        || computed_tax < 0.0
    {
        return Err("PO tax evidence or bill quantities are invalid".into());
    }
    let expected = ordered_tax * (billed_qty / ordered_qty) * (1.0 - discount / 100.0);
    if !expected.is_finite() || (expected - computed_tax).abs() > 1e-8 {
        return Err("Selected purchase taxes do not agree with the PO tax amount; review the PO and tax selection".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discount_is_applied_before_exclusive_tax() {
        let e = economics(
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
        assert_eq!((e.subtotal, e.taxes[&1], e.total), (270.0, 54.0, 324.0));
    }
    #[test]
    fn inclusive_and_exclusive_taxes_share_the_net_base() {
        let e = economics(
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
            (e.subtotal, e.taxes[&1], e.taxes[&2], e.total),
            (200.0, 40.0, 20.0, 260.0)
        );
    }
    #[test]
    fn full_discount_retains_quantity_without_value() {
        let e = economics(3.0, 100.0, 100.0, &[]).unwrap();
        assert_eq!((e.subtotal, e.total), (0.0, 0.0));
    }
    #[test]
    fn invalid_discount_tax_and_overflow_are_rejected() {
        for discount in [-1.0, 101.0, f64::NAN, f64::INFINITY] {
            assert!(economics(1.0, 1.0, discount, &[]).is_err());
        }
        assert!(economics(f64::MAX, 2.0, 0.0, &[]).is_err());
        let t = PercentageTax {
            id: 1,
            rate: 20.0,
            included: false,
        };
        assert!(economics(1.0, 1.0, 0.0, &[t, t]).is_err());
        assert!(economics(
            1.0,
            1.0,
            0.0,
            &[PercentageTax {
                rate: f64::NAN,
                ..t
            }]
        )
        .is_err());
    }
    #[test]
    fn partial_and_fractional_receipts_use_exact_ordered_tax_ratio() {
        assert!(validate_po_tax_evidence(200.0, 10.0, 4.0, 0.0, 80.0).is_ok());
        assert!(validate_po_tax_evidence(200.0, 10.0, 6.0, 10.0, 108.0).is_ok());
        assert!(validate_po_tax_evidence(5.0, 0.5, 0.25, 0.0, 2.5).is_ok());
        assert!(validate_po_tax_evidence(20.0, 1.0, 1.0, 0.0, 0.0).is_err());
        assert!(validate_po_tax_evidence(0.0, 1.0, 1.0, 0.0, 20.0).is_err());
        assert!(validate_po_tax_evidence(f64::NAN, 1.0, 1.0, 0.0, 0.0).is_err());
        assert!(validate_po_tax_evidence(20.0, 0.0, 1.0, 0.0, 20.0).is_err());
    }

    #[test]
    fn fx_uses_company_rounding_and_rejects_invalid_rates() {
        assert_eq!(ledger_amount(10.01, 1.25, Some(0.01)).unwrap(), 12.51);
        assert_eq!(ledger_amount(10.01, 1.0, None).unwrap(), 10.01);
        for rate in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(ledger_amount(10.0, rate, None).is_err());
        }
        assert!(ledger_amount(f64::MAX, 2.0, None).is_err());
        assert!(ledger_amount(10.0, 1.0, Some(0.0)).is_err());
    }
}
