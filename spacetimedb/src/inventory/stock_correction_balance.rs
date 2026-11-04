//! Pure quantity, reservation, freshness and valuation policy for stock corrections.
pub(crate) fn require_nonnegative_finite(value: f64, name: &str) -> Result<(), String> {
    if !value.is_finite() || value < 0.0 {
        return Err(format!("{name} must be a non-negative finite number"));
    }
    Ok(())
}

pub(crate) fn validate_balance(
    current_quantity: f64,
    reserved: f64,
    cost: f64,
    expected_quantity: f64,
    quantity: f64,
    expected_cost: Option<f64>,
) -> Result<(), String> {
    require_nonnegative_finite(expected_quantity, "expected quantity")?;
    require_nonnegative_finite(quantity, "counted quantity")?;
    require_nonnegative_finite(current_quantity, "current quantity")?;
    require_nonnegative_finite(reserved, "reserved quantity")?;
    require_nonnegative_finite(cost, "stock cost")?;
    if current_quantity != expected_quantity || expected_cost.is_some_and(|value| value != cost) {
        return Err("stock changed since the count was recorded; record a fresh count".to_string());
    }
    if reserved > current_quantity || quantity < reserved {
        return Err(
            "counted quantity cannot be below reserved quantity; resolve reservations first"
                .to_string(),
        );
    }
    require_nonnegative_finite(quantity * cost, "stock value")
}

#[cfg(test)]
mod tests {
    use super::validate_balance;

    #[test]
    fn count_cannot_consume_reserved_stock_or_hide_invalid_reservations() {
        assert!(validate_balance(10.0, 8.0, 2.5, 10.0, 5.0, None).is_err());
        assert!(validate_balance(5.0, 8.0, 2.5, 5.0, 10.0, None).is_err());
        assert!(validate_balance(10.0, 8.0, 2.5, 10.0, 8.0, None).is_ok());
    }

    #[test]
    fn intervening_quantity_or_adjustment_cost_change_requires_a_recount() {
        assert!(validate_balance(11.0, 0.0, 2.5, 10.0, 5.0, None).is_err());
        assert!(validate_balance(10.0, 0.0, 3.0, 10.0, 5.0, Some(2.5)).is_err());
    }

    #[test]
    fn correction_rejects_nonfinite_negative_and_overflowing_values() {
        for value in [-1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(validate_balance(10.0, 0.0, 2.5, 10.0, value, None).is_err());
            assert!(validate_balance(10.0, value, 2.5, 10.0, 5.0, None).is_err());
            assert!(validate_balance(10.0, 0.0, value, 10.0, 5.0, None).is_err());
        }
        assert!(validate_balance(10.0, 0.0, f64::MAX, 10.0, 2.0, None).is_err());
        assert!(validate_balance(0.0, 0.0, 0.0, 0.0, 0.0, Some(0.0)).is_ok());
    }
}
