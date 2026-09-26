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

#[cfg(test)]
mod tests {
    use super::{validate_pilot_money_amount, PILOT_MAX_MAJOR_UNITS};

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
