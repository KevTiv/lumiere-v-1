//! Deterministic seeded state-machine certification (Phase 6).
//!
//! Each machine replays random operation sequences from `money::CERT_SEEDS` against real
//! reducers and checks invariants after every step. Failures always report
//! `seed=<n> step=<n>` so a sequence can be reproduced exactly.

use spacetimedb::{ReducerContext, Table};

use super::communications_cert::{
    deliver, fingerprint, outbound, provider_scenario, receipts, state,
};
use super::money::{from_minor, to_minor, SeededRng, CERT_SEEDS};
use super::payments_cert::{
    allocate, invoice, invoice_residual, net_allocated_minor, posted_receipt, wallet,
};
use super::{run_cases, setup, CertCase};
use crate::accounting::payment_management::{
    allocate_payment_transaction, payment_reconciliation, reverse_payment_transaction_impl,
    AllocatePaymentParams, ReversePaymentTransactionParams,
};
use crate::crm::inbox::{
    crm_conversation_message, record_crm_provider_delivery, RecordCrmProviderDeliveryParams,
};
use crate::test_harness::OrgFixture;
use crate::types::OperationalMessageStatus;

const CENTS: u32 = 2;

pub const COMMUNICATION_CASES: &[CertCase] = &[("SM-01", sm_01_provider_delivery_machine)];
pub const PAYMENT_CASES: &[CertCase] = &[("SM-02", sm_02_payment_allocation_machine)];

pub fn run_communications_state_machine(ctx: &ReducerContext) -> Result<(), String> {
    run_cases(ctx, "communications state machine", COMMUNICATION_CASES)
}

pub fn run_payments_state_machine(ctx: &ReducerContext) -> Result<(), String> {
    run_cases(ctx, "payments state machine", PAYMENT_CASES)
}

fn rank(status: &str) -> u8 {
    match status {
        "sent" => 1,
        "delivered" | "failed" => 2,
        _ => 0,
    }
}

fn operational_matches(status: &str, operational: &OperationalMessageStatus) -> bool {
    matches!(
        (status, operational),
        ("queued", OperationalMessageStatus::Queued)
            | ("sent", OperationalMessageStatus::Sent)
            | ("delivered", OperationalMessageStatus::Delivered)
            | ("failed", OperationalMessageStatus::Failed)
    )
}

/// Random callbacks, exact replays and tampered replays over three outbound messages.
fn sm_01_provider_delivery_machine(ctx: &ReducerContext) -> Result<(), String> {
    const STATUSES: [&str; 3] = ["sent", "delivered", "failed"];
    for &seed in CERT_SEEDS {
        let mut rng = SeededRng::new(seed);
        let s = setup("provider scenario", provider_scenario(ctx, "sm01"))?;
        let mut messages = Vec::new();
        for index in 0..3 {
            messages.push(setup("outbound", outbound(ctx, &s, &format!("seed{seed}-{index}")))?);
        }
        let wamid = |index: usize| format!("sm01-{seed}-wamid-{index}");
        let timeline = |ctx: &ReducerContext| {
            ctx.db
                .crm_conversation_message()
                .crm_conversation_message_by_conversation()
                .filter(&s.conversation_id)
                .count()
        };
        let timeline_size = timeline(ctx);
        let mut accepted: Vec<(String, usize, &'static str)> = Vec::new();

        for step in 0..18 {
            let at = |detail: String| format!("seed={seed} step={step}: {detail}");
            let op = rng.range(0, 9);
            let (index, before) = if op >= 6 && !accepted.is_empty() {
                let pick = accepted[rng.range(0, accepted.len() as u64 - 1) as usize].clone();
                let before = state(ctx, messages[pick.1])?;
                if op <= 7 {
                    deliver(ctx, &s, messages[pick.1], &pick.0, &wamid(pick.1), pick.2)
                        .map_err(|e| at(format!("exact replay of {} rejected: {e}", pick.0)))?;
                } else {
                    let tampered = record_crm_provider_delivery(
                        ctx,
                        s.org,
                        RecordCrmProviderDeliveryParams {
                            provider_account_id: s.account_id,
                            event_fingerprint: fingerprint(&format!("{}-tampered", pick.0)),
                            conversation_id: s.conversation_id,
                            conversation_message_id: messages[pick.1].0,
                            provider_event_id: pick.0.clone(),
                            provider_message_id: wamid(pick.1),
                            operational_message_id: messages[pick.1].1,
                            status: "delivered".to_string(),
                            failure_reason: None,
                        },
                    );
                    if tampered.is_ok() {
                        return Err(at(format!("tampered replay of {} accepted", pick.0)));
                    }
                }
                (pick.1, before)
            } else {
                let index = rng.range(0, 2) as usize;
                let status = STATUSES[rng.range(0, 2) as usize];
                let event = format!("sm01-{seed}-{step}");
                let before = state(ctx, messages[index])?;
                if deliver(ctx, &s, messages[index], &event, &wamid(index), status).is_ok() {
                    accepted.push((event, index, status));
                }
                (index, before)
            };

            let after = state(ctx, messages[index])?;
            if rank(&after.0) < rank(&before.0) || (rank(&before.0) == 2 && after.0 != before.0) {
                return Err(at(format!("message {index} regressed {} -> {}", before.0, after.0)));
            }
            for &ids in &messages {
                let (status, operational) = state(ctx, ids)?;
                if !operational_matches(&status, &operational) {
                    return Err(at(format!("timeline {status} disagrees with intent {operational:?}")));
                }
            }
            if timeline(ctx) != timeline_size {
                return Err(at("callbacks changed the conversation timeline size".to_string()));
            }
            if let Some((event, ..)) = accepted.iter().find(|(event, ..)| receipts(ctx, &s, event) != 1) {
                return Err(at(format!("accepted event {event} does not have exactly one receipt")));
            }
        }
    }
    Ok(())
}

/// Random allocations, idempotent replays, foreign-tenant attempts and a reversal, checked
/// against an exact minor-unit model after every step.
fn sm_02_payment_allocation_machine(ctx: &ReducerContext) -> Result<(), String> {
    for &seed in CERT_SEEDS {
        let mut rng = SeededRng::new(seed ^ 0x5302);
        let w = setup("wallet", wallet(ctx, &format!("sm02-{seed}")))?;
        let foreign = setup("foreign fixture", OrgFixture::seed_minimal(ctx))?;
        let mut invoices = Vec::new();
        for _ in 0..4 {
            let original = rng.range(100, 20_000) as i128;
            let (invoice_id, line_id) = setup("invoice", invoice(ctx, &w, from_minor(original, CENTS)))?;
            invoices.push((invoice_id, line_id, original));
        }
        let settlement = rng.range(500, 60_000) as i128;
        let payment = setup(
            "receipt",
            posted_receipt(ctx, &w, &format!("SM02-{seed}"), from_minor(settlement, CENTS)),
        )?;
        let mut model = [0_i128; 4];
        let mut keys: Vec<(String, usize, i128)> = Vec::new();
        let mut reversed = false;

        for step in 0..16 {
            let at = |detail: String| format!("seed={seed} step={step}: {detail}");
            match rng.range(0, 9) {
                0..=4 => {
                    let index = rng.range(0, 3) as usize;
                    let remaining = settlement - model.iter().sum::<i128>();
                    let residual = invoices[index].2 - model[index];
                    let amount = match rng.range(0, 2) {
                        0 => remaining.max(1),
                        1 => residual.max(1),
                        _ => rng.range(1, 15_000) as i128,
                    };
                    let expected = !reversed
                        && if model[index] > 0 {
                            amount == model[index]
                        } else {
                            amount <= remaining && amount <= invoices[index].2
                        };
                    let key = format!("sm02-{seed}-{step}");
                    let result = allocate(ctx, &w, payment, invoices[index].1, from_minor(amount, CENTS), &key);
                    if result.is_ok() != expected {
                        return Err(at(format!(
                            "allocate {amount} to invoice {index}: reducer={result:?} model_accepts={expected} remaining={remaining} residual={residual}"
                        )));
                    }
                    if result.is_ok() {
                        model[index] = amount;
                        keys.push((key, index, amount));
                    }
                }
                5..=6 if !keys.is_empty() => {
                    let (key, index, amount) = keys[rng.range(0, keys.len() as u64 - 1) as usize].clone();
                    allocate(ctx, &w, payment, invoices[index].1, from_minor(amount, CENTS), &key)
                        .map_err(|e| at(format!("exact replay of {key} rejected: {e}")))?;
                }
                7 => {
                    let forged = allocate_payment_transaction(
                        ctx,
                        foreign.organization_id,
                        AllocatePaymentParams {
                            idempotency_key: format!("sm02-{seed}-{step}-forged"),
                            company_id: foreign.company_id,
                            payment_transaction_id: payment,
                            allocated_move_line_id: invoices[0].1,
                            allocated_amount: 0.01,
                            currency_id: w.currency_id,
                            write_off_amount: 0.0,
                            write_off_account_id: None,
                            metadata: None,
                        },
                    );
                    if forged.is_ok() {
                        return Err(at("foreign organization allocated the payment".to_string()));
                    }
                }
                8 if !reversed => {
                    reverse_payment_transaction_impl(
                        ctx,
                        w.org(),
                        payment,
                        ReversePaymentTransactionParams {
                            company_id: w.company(),
                            reason: Some(format!("sm02 seed {seed}")),
                            metadata: None,
                        },
                        true,
                    )
                    .map_err(|e| at(format!("reversal rejected: {e}")))?;
                    reversed = true;
                    model = [0; 4];
                }
                _ => {}
            }

            let allocated = net_allocated_minor(ctx, payment);
            if allocated != model.iter().sum::<i128>() {
                return Err(at(format!("net allocated {allocated} != model {}", model.iter().sum::<i128>())));
            }
            if allocated > settlement {
                return Err(at(format!("allocated {allocated} exceeds settlement {settlement}")));
            }
            for (index, (invoice_id, _, original)) in invoices.iter().enumerate() {
                let residual = to_minor(invoice_residual(ctx, *invoice_id)?, CENTS);
                if residual < 0 || residual != original - model[index] {
                    return Err(at(format!(
                        "invoice {index} residual {residual} != {} (original {original})",
                        original - model[index]
                    )));
                }
            }
            if ctx
                .db
                .payment_reconciliation()
                .iter()
                .filter(|r| r.payment_transaction_id == payment)
                .any(|r| r.organization_id != w.org() || r.company_id != w.company())
            {
                return Err(at("reconciliation row escaped the payment's tenant scope".to_string()));
            }
        }
    }
    Ok(())
}
