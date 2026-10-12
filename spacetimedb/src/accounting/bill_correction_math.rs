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
