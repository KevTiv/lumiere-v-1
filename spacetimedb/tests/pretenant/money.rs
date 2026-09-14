//! Exact minor-unit reference model and deterministic generator for certification.
//!
//! Operational money is persisted as `f64` and admitted with an absolute
//! `RECONCILIATION_EPSILON` (`accounting/payment_management.rs`). Certification
//! assertions never reuse that tolerance: they compare integer minor units, so a
//! case can only pass when the ledger reconciles to the smallest currency unit.

pub fn to_minor(amount: f64, decimals: u32) -> i128 {
    (amount * 10f64.powi(decimals as i32)).round() as i128
}

pub fn from_minor(minor: i128, decimals: u32) -> f64 {
    minor as f64 / 10f64.powi(decimals as i32)
}

pub fn require_minor_eq(
    label: &str,
    actual: f64,
    expected_minor: i128,
    decimals: u32,
) -> Result<(), String> {
    let actual_minor = to_minor(actual, decimals);
    if actual_minor != expected_minor {
        return Err(format!(
            "{label}: expected {expected_minor} minor units, got {actual} ({actual_minor})"
        ));
    }
    Ok(())
}

/// Deterministic xorshift64* generator. Every failure message must include `seed`.
pub struct SeededRng {
    state: u64,
    pub seed: u64,
}

impl SeededRng {
    pub fn new(seed: u64) -> Self {
        let state = seed ^ 0x9E37_79B9_7F4A_7C15;
        Self {
            state: if state == 0 { 1 } else { state },
            seed,
        }
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform-ish value in `lo..=hi`.
    pub fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next_u64() % (hi - lo + 1)
    }
}

/// Fixed seeds shared by the in-module state machines and native property tests.
pub const CERT_SEEDS: &[u64] = &[1, 42, 1337, 20_260_912, 0xDEAD_BEEF];

#[cfg(test)]
mod tests {
    use super::*;

    /// Mirror of the private production constant; the source check below keeps it honest.
    const RECONCILIATION_EPSILON: f64 = 0.000_001;
    const PAYMENT_MANAGEMENT_SOURCE: &str =
        include_str!("../../src/accounting/payment_management.rs");

    fn ulp(value: f64) -> f64 {
        f64::from_bits(value.to_bits() + 1) - value
    }

    #[test]
    fn epsilon_mirror_matches_production_source() {
        assert!(PAYMENT_MANAGEMENT_SOURCE.contains("const RECONCILIATION_EPSILON: f64 = 0.000_001;"));
    }

    #[test]
    fn f64_accumulation_requires_minor_unit_rounding() {
        let mut sum = 0.0_f64;
        for _ in 0..100 {
            sum += 0.01;
        }
        assert_ne!(sum, 1.0, "f64 accumulation of 100 x 0.01 is not exactly 1.0");
        assert_eq!(to_minor(sum, 2), 100);
        assert_ne!(0.1 + 0.2, 0.3);
        assert_eq!(to_minor(0.1 + 0.2, 2), to_minor(0.3, 2));
    }

    /// Characterises the pre-tenant blocker documented as MONEY-PRECISION in the plan:
    /// from ~1e10 major units the absolute epsilon is below f64 resolution, so admission
    /// comparisons silently become exact float comparisons.
    #[test]
    fn reconciliation_epsilon_is_below_f64_resolution_from_ten_billion() {
        assert!(ulp(1.0e9) < RECONCILIATION_EPSILON);
        assert!(ulp(1.0e10) > RECONCILIATION_EPSILON);
    }

    #[derive(Default)]
    struct Divergence {
        trials: u64,
        diverged: u64,
        first: Option<String>,
    }

    /// Replays the production admission rule (`amount <= max(settlement - sum, 0) + EPS`)
    /// against exact minor units for one generated allocation sequence.
    fn simulate(rng: &mut SeededRng, decimals: u32, max_major: u64, out: &mut Divergence) {
        let scale = 10u64.pow(decimals);
        let settlement_minor = rng.range(1, max_major.saturating_mul(scale).max(1)) as i128;
        let steps = rng.range(1, 40);
        let mut accepted_f64 = 0.0_f64;
        let mut accepted_minor = 0_i128;
        out.trials += 1;
        for step in 0..steps {
            let remaining = settlement_minor - accepted_minor;
            // Bias towards exact remainders, the case that matters when settling in full.
            let amount_minor = match rng.range(0, 3) {
                0 => remaining.max(1),
                1 => remaining + 1,
                _ => rng.range(1, (settlement_minor as u64).max(1)) as i128,
            };
            let amount = from_minor(amount_minor, decimals);
            let available = (from_minor(settlement_minor, decimals) - accepted_f64).max(0.0);
            let float_accepts = amount <= available + RECONCILIATION_EPSILON;
            let exact_accepts = amount_minor <= remaining;
            if float_accepts != exact_accepts {
                out.diverged += 1;
                out.first.get_or_insert_with(|| {
                    format!(
                        "seed={} decimals={decimals} settlement_minor={settlement_minor} step={step} amount_minor={amount_minor} remaining_minor={remaining} float_accepts={float_accepts}",
                        rng.seed
                    )
                });
                return;
            }
            if exact_accepts {
                accepted_f64 += amount;
                accepted_minor += amount_minor;
            }
        }
    }

    fn run_envelope(decimals: u32, max_major: u64, trials_per_seed: u64) -> Divergence {
        let mut out = Divergence::default();
        for &seed in CERT_SEEDS {
            let mut rng = SeededRng::new(seed ^ ((decimals as u64) << 32) ^ max_major);
            for _ in 0..trials_per_seed {
                simulate(&mut rng, decimals, max_major, &mut out);
            }
        }
        out
    }

    /// Safe envelope: zero-, two- and three-decimal currencies up to 1e8 major units.
    #[test]
    fn f64_admission_matches_exact_minor_units_inside_safe_envelope() {
        for decimals in [0, 2, 3] {
            let result = run_envelope(decimals, 100_000_000, 2_000);
            assert_eq!(
                result.diverged,
                0,
                "f64 admission diverged from exact minor units inside the safe envelope: {:?} ({} trials)",
                result.first,
                result.trials
            );
        }
    }

    /// Outside the envelope the representation is not exact. This test asserts the
    /// divergence exists so the plan's blocker cannot silently go stale; when money moves
    /// to integer minor units / decimals, invert it into a blocking exactness test.
    #[test]
    fn f64_admission_diverges_beyond_ten_billion_major_units() {
        let result = run_envelope(2, 1_000_000_000_000, 2_000);
        assert!(
            result.diverged > 0,
            "expected MONEY-PRECISION divergence beyond 1e10 major units; representation may have changed"
        );
        eprintln!(
            "MONEY-PRECISION divergence: {}/{} trials, first counterexample: {:?}",
            result.diverged, result.trials, result.first
        );
    }
}
