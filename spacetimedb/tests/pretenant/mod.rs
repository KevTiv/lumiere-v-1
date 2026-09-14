//! Pre-tenant adversarial certification — in-module layer.
//!
//! See `docs/plans/pre-tenant-adversarial-certification.md` for the invariant
//! catalogue, layer ownership and promotion policy.
//!
//! ## Why there are no new reducers here
//!
//! Every `#[spacetimedb::reducer]` (test reducers included) is part of the pinned
//! generated contract (`lumiere-codegen/contract-operation-ids.json`,
//! `crates/stdb-client/src/generated_reducer_contract.rs`). Adding reducers would
//! require a contract release, so certification cases are plain functions invoked
//! from the existing domain test reducers (`run_core_operational_messaging_test`,
//! `run_accounting_payment_management_test`). Only reducer *bodies* change.
//!
//! ## Strict expected-failure registry
//!
//! Cases encode the *correct* invariant. Where `main` is known to violate it, the
//! case id is listed in [`KNOWN_DEFECTS`] with its blocker summary:
//!
//! - a known defect that still fails is logged as `KNOWN-DEFECT` (pre-tenant blocker);
//! - a known defect that now passes fails the run until it is removed from the
//!   registry (so the fix becomes permanently blocking);
//! - a known defect whose *setup* fails (error prefixed `SETUP`) fails the run, so
//!   fixture drift can never hide behind the registry;
//! - any other failure fails the run.

pub mod communications_cert;
pub mod money;
pub mod payments_cert;
pub mod state_machine_cert;

use spacetimedb::ReducerContext;

pub type CertCase = (&'static str, fn(&ReducerContext) -> Result<(), String>);

/// Case id → pre-tenant blocker. Every entry must be documented in the plan's
/// "Known defects" table (enforced by a native unit test below).
pub const KNOWN_DEFECTS: &[(&str, &str)] = &[
    (
        "COMM-05",
        "stale-but-valid provider status callback is rejected with an error instead of being absorbed; the webhook returns non-2xx and the provider retries",
    ),
    (
        "COMM-06",
        "message batch approval does not revalidate consent; a contact who opted out after preview remains an approved recipient",
    ),
    (
        "COMM-07",
        "message batch approval does not revalidate the snapshotted phone identity; an archived recipient identity remains approved",
    ),
    (
        "COMM-09",
        "contact message batches are approved without rendered content, so approved content is not immutable",
    ),
    (
        "COMM-11",
        "message batch creator can satisfy their own approval; no independent-approval rule",
    ),
    (
        "COMM-13",
        "create_message_batch does not scope candidate contacts or phone identities to the calling organization",
    ),
    (
        "COMM-14",
        "a number change under the same phone identity id silently redirects an approved recipient",
    ),
    (
        "PAY-03",
        "post_payment_transaction retry after a committed post returns an error instead of an idempotent success",
    ),
    (
        "PAY-05",
        "reverse_payment_transaction retry after a committed reversal returns an error instead of an idempotent success",
    ),
    (
        "PAY-11B",
        "stage_bank_statement_import silently accepts a replayed idempotency key with a different payload instead of failing closed",
    ),
];

pub fn setup<T>(what: &str, result: Result<T, String>) -> Result<T, String> {
    result.map_err(|error| format!("SETUP {what}: {error}"))
}

pub fn run_cases(ctx: &ReducerContext, suite: &str, cases: &[CertCase]) -> Result<(), String> {
    let mut unexpected = Vec::new();
    for (id, case) in cases {
        let known = KNOWN_DEFECTS.iter().find(|(defect, _)| defect == id);
        match (case(ctx), known) {
            (Ok(()), None) => log::info!("[pretenant] PASS {id}"),
            (Ok(()), Some(_)) => unexpected.push(format!(
                "{id} is registered in KNOWN_DEFECTS but now passes; remove it so the invariant becomes blocking"
            )),
            (Err(error), Some((_, blocker))) if !error.starts_with("SETUP") => {
                log::warn!("[pretenant] KNOWN-DEFECT {id}: {error} (blocker: {blocker})")
            }
            (Err(error), _) => {
                log::error!("[pretenant] FAIL {id}: {error}");
                unexpected.push(format!("{id}: {error}"));
            }
        }
    }
    if unexpected.is_empty() {
        log::info!("✅ pretenant {suite} certification complete");
        Ok(())
    } else {
        Err(format!("pretenant {suite}: {}", unexpected.join("; ")))
    }
}

#[cfg(test)]
mod tests {
    use super::KNOWN_DEFECTS;

    const PLAN: &str =
        include_str!("../../../docs/plans/pre-tenant-adversarial-certification.md");

    #[test]
    fn known_defects_are_unique_and_documented_in_the_plan() {
        let mut ids: Vec<_> = KNOWN_DEFECTS.iter().map(|(id, _)| *id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), KNOWN_DEFECTS.len(), "duplicate known-defect id");
        for (id, _) in KNOWN_DEFECTS {
            assert!(
                PLAN.contains(&format!("| `{id}` |")),
                "{id} is missing from the plan's known-defects table"
            );
        }
    }
}
