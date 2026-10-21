//! Shared pilot money-admission boundary for accounting workflows.
//!
//! Operational accounting amounts are still persisted as `f64`. Pre-tenant
//! certification proves the current reconciliation rule against an exact
//! minor-unit model within this bounded pilot envelope. Values outside it must
//! fail before they can create or mutate payment/import economic state.

pub(crate) const PILOT_MAX_MAJOR_UNITS: f64 = 1_000_000_000.0;

pub(crate) fn validate_pilot_money_amount(label: &str, amount: f64) -> Result<(), String> {
    if !amount.is_finite() {
        return Err(format!("{label} must be finite"));
    }
    if amount.abs() > PILOT_MAX_MAJOR_UNITS {
        return Err(format!(
            "{label} exceeds pilot monetary limit of {PILOT_MAX_MAJOR_UNITS:.0} major units"
        ));
    }
    Ok(())
}

/// Convert supported currency values to exact minor units before comparing money.
pub(crate) fn pilot_money_minor_units(value: f64, decimals: u8) -> Result<i64, String> {
    validate_pilot_money_amount("accounting amount", value)?;
    if decimals > 6 {
        return Err("unsupported accounting currency precision".to_string());
    }
    let scaled = value * 10_f64.powi(i32::from(decimals));
    let rounded = scaled.round();
    if rounded.abs() > 9_007_199_254_740_991.0
        // Subtraction of prior allocations leaves bounded binary cancellation
        // noise (100 - 99.99). Never widen this to a meaningful currency unit.
        || (scaled - rounded).abs() > 0.000001
    {
        return Err("accounting amount is not exact at currency precision".to_string());
    }
    Ok(rounded as i64)
}

#[cfg(test)]
mod tests {
    use super::{pilot_money_minor_units, validate_pilot_money_amount, PILOT_MAX_MAJOR_UNITS};

    #[test]
    fn residual_minor_units_allow_binary_cancellation_but_reject_fractional_currency() {
        assert_eq!(pilot_money_minor_units(100.0 - 99.99, 2), Ok(1));
        assert_eq!(pilot_money_minor_units(-0.01, 2), Ok(-1));
        assert!(pilot_money_minor_units(0.001, 2).is_err());
        assert!(pilot_money_minor_units(f64::NAN, 2).is_err());
        assert!(pilot_money_minor_units(0.01, 0).is_err());
    }

    #[test]
    fn pilot_money_boundary_accepts_finite_values_inside_limit() {
        for amount in [
            -PILOT_MAX_MAJOR_UNITS,
            -0.01,
            0.0,
            0.01,
            PILOT_MAX_MAJOR_UNITS,
        ] {
            validate_pilot_money_amount("amount", amount)
                .unwrap_or_else(|error| panic!("unexpected rejection for {amount}: {error}"));
        }
    }

    #[test]
    fn pilot_money_boundary_rejects_non_finite_and_oversized_values() {
        for amount in [
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            PILOT_MAX_MAJOR_UNITS + 0.01,
            -(PILOT_MAX_MAJOR_UNITS + 0.01),
        ] {
            assert!(
                validate_pilot_money_amount("amount", amount).is_err(),
                "expected {amount} to be rejected"
            );
        }
    }
}
