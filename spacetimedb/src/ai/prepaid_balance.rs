//! Checked arithmetic for the canonical prepaid projection. No monetary state lives here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CreditBalance {
    pub funded: u64,
    pub reversed: u64,
    pub debited: u64,
    pub held: u64,
}
impl CreditBalance {
    pub(crate) fn available(self) -> Result<u64, String> {
        self.funded
            .checked_sub(self.reversed)
            .and_then(|value| value.checked_sub(self.debited))
            .and_then(|value| value.checked_sub(self.held))
            .ok_or_else(|| "prepaid credit has a deficit".into())
    }
    pub(crate) fn require(self, units: u64) -> Result<(), String> {
        if self.available()? < units {
            return Err("prepaid credit is insufficient".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn funding_does_not_change_monthly_allowance() {
        let credit = CreditBalance {
            funded: 20_000_000,
            reversed: 0,
            debited: 0,
            held: 0,
        };
        assert_eq!(credit.available().unwrap(), 20_000_000);
        assert_eq!(credit.available().unwrap().min(10_000_000), 10_000_000);
    }
    #[test]
    fn settled_and_unknown_holds_are_both_committed() {
        let credit = CreditBalance {
            funded: 100,
            reversed: 0,
            debited: 20,
            held: 70,
        };
        assert_eq!(credit.available().unwrap(), 10);
        assert!(credit.require(11).is_err());
        assert!(credit.require(10).is_ok());
    }
    #[test]
    fn reversals_expose_deficits_without_erasing_them() {
        let credit = CreditBalance {
            funded: 100,
            reversed: 90,
            debited: 20,
            held: 0,
        };
        assert!(credit.available().is_err());
        assert!(credit.require(0).is_err());
    }
    #[test]
    fn unused_allowance_restores_available_credit() {
        let before = CreditBalance {
            funded: 100,
            reversed: 0,
            debited: 10,
            held: 40,
        };
        let settled = CreditBalance {
            debited: 35,
            held: 0,
            ..before
        };
        assert_eq!(before.available().unwrap(), 50);
        assert_eq!(settled.available().unwrap(), 65);
        assert_eq!(CreditBalance { held: 0, ..before }.available().unwrap(), 90);
    }
    #[test]
    fn arithmetic_does_not_wrap_near_the_currency_limit() {
        assert_eq!(
            CreditBalance {
                funded: u64::MAX,
                reversed: u64::MAX,
                debited: 0,
                held: 0
            }
            .available()
            .unwrap(),
            0
        );
        assert!(CreditBalance {
            funded: u64::MAX,
            reversed: 1,
            debited: u64::MAX,
            held: 1
        }
        .available()
        .is_err());
    }
}
