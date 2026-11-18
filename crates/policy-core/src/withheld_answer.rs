//! The user-facing notice an AI answer carries when the evidence gate withheld
//! it. One source of truth for the gateway (which writes the notice), the
//! history reader (which reclassifies old rows saved as completed) and the
//! platform-operator run correction. The browser mirrors it from
//! `frontend/packages/erp-shared/src/ai-withheld-notice.ts`; a test keeps the
//! two equal.

/// Every withheld notice starts with this text, with or without a reason.
pub const WITHHELD_ANSWER_NOTICE: &str = "This answer could not be verified and was withheld";

/// Verification outcomes that mean an answer was not released.
pub const WITHHELD_VERIFICATION_OUTCOMES: [&str; 2] = ["blocked", "requires_review"];

/// Notice shown for a withheld answer, with the generic reason when one exists.
pub fn withheld_answer_notice(reason: Option<&str>) -> String {
    match reason {
        Some(reason) => format!("{WITHHELD_ANSWER_NOTICE}: {reason}"),
        None => format!("{WITHHELD_ANSWER_NOTICE}."),
    }
}

/// True when text is a withheld notice. Leading whitespace is ignored.
pub fn is_withheld_answer_notice(text: &str) -> bool {
    text.trim_start().starts_with(WITHHELD_ANSWER_NOTICE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notice_wording_is_unchanged() {
        assert_eq!(
            withheld_answer_notice(None),
            "This answer could not be verified and was withheld."
        );
        assert_eq!(
            withheld_answer_notice(Some("why")),
            "This answer could not be verified and was withheld: why"
        );
        assert!(is_withheld_answer_notice(&withheld_answer_notice(Some(
            "x"
        ))));
        assert!(is_withheld_answer_notice(
            "  This answer could not be verified and was withheld."
        ));
        assert!(!is_withheld_answer_notice(
            "Totals: This answer could not be verified and was withheld"
        ));
    }
}
