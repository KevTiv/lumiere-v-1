//! Finite manufacturing cost arithmetic, independent of the database.

/// Allocate actual production value by BOM percentage; primary receives the remainder.
pub(crate) fn allocate_output_cost(total: f64, shares: &[f64]) -> Result<(f64, Vec<f64>), String> {
    validate_cost(total, "production cost")?;
    let mut total_share = 0.0;
    for share in shares {
        validate_cost(*share, "byproduct cost share")?;
        if *share > 100.0 {
            return Err("byproduct cost share exceeds 100 percent".to_string());
        }
        total_share += share;
    }
    if !total_share.is_finite() || total_share > 100.0 {
        return Err("total byproduct cost share exceeds 100 percent".to_string());
    }
    let values: Vec<_> = shares.iter().map(|share| total * (share / 100.0)).collect();
    let allocated: f64 = values.iter().sum();
    validate_cost(allocated, "allocated byproduct cost")?;
    let primary = total - allocated;
    // Subtraction places floating point residue on the primary output, preserving total.
    if primary < -f64::EPSILON * total.max(1.0) * shares.len().max(1) as f64 {
        return Err("allocated byproduct cost exceeds production cost".to_string());
    }
    Ok((primary.max(0.0), values))
}

pub(crate) fn validate_cost(value: f64, label: &str) -> Result<(), String> {
    if !value.is_finite() || value < 0.0 {
        return Err(format!("{label} must be finite and nonnegative"));
    }
    Ok(())
}

/// Productivity durations are measured in minutes and rates in company currency/hour.
pub(crate) fn operation_cost(minutes: f64, hourly_rate: f64) -> Result<f64, String> {
    validate_cost(minutes, "operation duration")?;
    validate_cost(hourly_rate, "hourly rate")?;
    let cost = (minutes / 60.0) * hourly_rate;
    validate_cost(cost, "operation cost")?;
    Ok(cost)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_retains_remainder_and_zero_shares_do_not_invent_cost() {
        assert_eq!(
            allocate_output_cost(150.0, &[20.0, 30.0]).unwrap(),
            (75.0, vec![30.0, 45.0])
        );
        assert_eq!(
            allocate_output_cost(0.0, &[100.0]).unwrap(),
            (0.0, vec![0.0])
        );
        let (primary, others) = allocate_output_cost(17.0, &[33.333, 33.333]).unwrap();
        assert!((primary + others.iter().sum::<f64>() - 17.0).abs() < 1e-12);
    }

    #[test]
    fn rejects_nonfinite_negative_and_overallocated_inputs() {
        for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0] {
            assert!(allocate_output_cost(invalid, &[]).is_err());
            assert!(allocate_output_cost(1.0, &[invalid]).is_err());
            assert!(operation_cost(1.0, invalid).is_err());
        }
        assert!(allocate_output_cost(1.0, &[60.0, 50.0]).is_err());
        assert!(operation_cost(f64::MAX, f64::MAX).is_err());
    }

    #[test]
    fn actual_minutes_convert_to_hourly_cost() {
        assert_eq!(operation_cost(90.0, 20.0).unwrap(), 30.0);
        assert_eq!(operation_cost(15.0, 0.0).unwrap(), 0.0);
    }
}
