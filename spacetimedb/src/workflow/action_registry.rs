//! Closed, versioned registry for transactional workflow domain actions.
//!
//! A human-task decision snapshots a material domain record before approval and
//! passes that revision back to [`execute_guarded_action`]. Execution checks the
//! revision immediately before calling the existing in-process domain adapter.
//! The receipt is inserted in the same reducer transaction as the domain write,
//! so a failed adapter cannot consume an idempotency key.

use sha2::{Digest, Sha256};
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::{account_move, account_move_line, post_account_move_impl};
use crate::accounting::payments::{account_payment, post_payment_impl};
use crate::ai::action_drafts::{ai_action_draft, approve_ai_action_draft_core};
use crate::core::organization::require_company_in_organization;
use crate::core::reference::legacy_currency_code_for_id;
use crate::expenses::expenses::{approve_expense_sheet_impl, expense_sheet, hr_expense};
use crate::purchasing::purchase_orders::{
    confirm_purchase_order_impl, purchase_order, purchase_order_line, send_purchase_order_impl,
};
use crate::sales::sales_core::{confirm_sales_order_impl, sale_order, sale_order_line};
use crate::workflow::definitions::{ConditionValue, FixedPointDecimal, MoneyValue};
use crate::workflow::evaluator::{
    canonical_condition_snapshot_hash, ConditionSnapshot, ConditionSnapshotField,
};

pub const GUARDED_ACTION_SCHEMA_VERSION: u32 = 1;

/// The complete in-process action allowlist for the pilot.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum GuardedActionKey {
    ConfirmPurchaseOrder,
    SendPurchaseOrder,
    ConfirmSalesOrder,
    PostAccountMove,
    PostPayment,
    ApproveExpenseSheet,
    ApproveAiActionDraft,
}

impl GuardedActionKey {
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ConfirmPurchaseOrder => "confirm_purchase_order",
            Self::SendPurchaseOrder => "send_purchase_order",
            Self::ConfirmSalesOrder => "confirm_sales_order",
            Self::PostAccountMove => "post_account_move",
            Self::PostPayment => "post_payment",
            Self::ApproveExpenseSheet => "approve_expense_sheet",
            Self::ApproveAiActionDraft => "approve_ai_action_draft",
        }
    }
}

/// Typed action inputs. There is no arbitrary JSON or reducer-name escape hatch.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum GuardedActionInput {
    ConfirmPurchaseOrder { order_id: u64 },
    SendPurchaseOrder { order_id: u64 },
    ConfirmSalesOrder { order_id: u64 },
    PostAccountMove { move_id: u64 },
    PostPayment { payment_id: u64 },
    ApproveExpenseSheet { sheet_id: u64 },
    ApproveAiActionDraft { draft_id: u64 },
}

impl GuardedActionInput {
    /// Construct the sole valid input shape for an action and subject ID.
    #[must_use]
    pub fn for_subject(action: &GuardedActionKey, subject_id: u64) -> Self {
        match action {
            GuardedActionKey::ConfirmPurchaseOrder => Self::ConfirmPurchaseOrder {
                order_id: subject_id,
            },
            GuardedActionKey::SendPurchaseOrder => Self::SendPurchaseOrder {
                order_id: subject_id,
            },
            GuardedActionKey::ConfirmSalesOrder => Self::ConfirmSalesOrder {
                order_id: subject_id,
            },
            GuardedActionKey::PostAccountMove => Self::PostAccountMove {
                move_id: subject_id,
            },
            GuardedActionKey::PostPayment => Self::PostPayment {
                payment_id: subject_id,
            },
            GuardedActionKey::ApproveExpenseSheet => Self::ApproveExpenseSheet {
                sheet_id: subject_id,
            },
            GuardedActionKey::ApproveAiActionDraft => Self::ApproveAiActionDraft {
                draft_id: subject_id,
            },
        }
    }
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum GuardedActionSubjectKind {
    PurchaseOrder,
    SalesOrder,
    AccountMove,
    AccountPayment,
    ExpenseSheet,
    AiActionDraft,
}

impl GuardedActionSubjectKind {
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PurchaseOrder => "purchase_order",
            Self::SalesOrder => "sale_order",
            Self::AccountMove => "account_move",
            Self::AccountPayment => "account_payment",
            Self::ExpenseSheet => "hr_expense_sheet",
            Self::AiActionDraft => "ai_action_draft",
        }
    }
}

/// Immutable pre-execution evidence presented to the human-task engine.
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct GuardedActionSnapshot {
    pub organization_id: u64,
    pub company_id: u64,
    pub subject_kind: GuardedActionSubjectKind,
    pub subject_id: u64,
    pub action: GuardedActionKey,
    pub action_version: u32,
    pub input_hash: String,
    /// Evaluator-ready allowlisted values. Its revision hash is canonical for
    /// the condition fields; `subject_revision_hash` below binds all material
    /// header and child fields used by the domain adapter.
    pub condition_snapshot: ConditionSnapshot,
    pub subject_revision_hash: String,
    pub amount: Option<MoneyValue>,
    pub percentage: Option<FixedPointDecimal>,
}

/// Internal transactional execution request used by human-task completion.
#[derive(SpacetimeType, Clone, Debug)]
pub struct ExecuteGuardedActionParams {
    pub organization_id: u64,
    pub company_id: u64,
    pub action: GuardedActionKey,
    pub action_version: u32,
    pub input: GuardedActionInput,
    pub expected_subject_revision_hash: String,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct GuardedActionExecutionResult {
    pub receipt_id: String,
    pub effect_hash: String,
    pub result_subject_revision_hash: String,
    pub replayed: bool,
}

/// A committed effect receipt. The primary key scopes an idempotency key to an
/// organization and company, while the invocation hash detects any changed use.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = guarded_action_receipt,
    index(accessor = guarded_action_receipt_by_org, btree(columns = [organization_id])),
    index(accessor = guarded_action_receipt_by_company, btree(columns = [company_id])),
    index(accessor = guarded_action_receipt_by_subject, btree(columns = [subject_id]))
)]
pub struct GuardedActionReceipt {
    #[primary_key]
    pub id: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub subject_kind: GuardedActionSubjectKind,
    pub subject_id: u64,
    pub action: GuardedActionKey,
    pub action_version: u32,
    pub input_hash: String,
    pub expected_subject_revision_hash: String,
    pub result_subject_revision_hash: String,
    pub invocation_hash: String,
    pub effect_hash: String,
    pub idempotency_key: String,
    pub executed_at: Timestamp,
}

/// Resolve an external definition key to the closed typed registry.
pub fn resolve_guarded_action(key: &str, version: u32) -> Result<GuardedActionKey, String> {
    if version != GUARDED_ACTION_SCHEMA_VERSION {
        return Err(format!(
            "unsupported guarded action version {version}; expected {GUARDED_ACTION_SCHEMA_VERSION}"
        ));
    }
    match key {
        "confirm_purchase_order" => Ok(GuardedActionKey::ConfirmPurchaseOrder),
        "send_purchase_order" => Ok(GuardedActionKey::SendPurchaseOrder),
        "confirm_sales_order" => Ok(GuardedActionKey::ConfirmSalesOrder),
        "post_account_move" => Ok(GuardedActionKey::PostAccountMove),
        "post_payment" => Ok(GuardedActionKey::PostPayment),
        "approve_expense_sheet" => Ok(GuardedActionKey::ApproveExpenseSheet),
        "approve_ai_action_draft" => Ok(GuardedActionKey::ApproveAiActionDraft),
        _ => Err(format!("unregistered guarded action: {key}")),
    }
}

/// Build the material record snapshot used by both task creation and execution.
pub fn snapshot_guarded_action(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    action: GuardedActionKey,
    action_version: u32,
    input: GuardedActionInput,
) -> Result<GuardedActionSnapshot, String> {
    validate_action_version(action_version)?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    validate_input_matches_action(&action, &input)?;

    let input_hash = canonical_input_hash(&action, action_version, &input);
    let material = material_snapshot(ctx, organization_id, company_id, &action, &input)?;
    let mut condition_snapshot = ConditionSnapshot {
        subject_model: material.subject_kind.as_str().to_string(),
        subject_id: material.subject_id,
        subject_revision_hash: String::new(),
        fields: material.condition_fields,
    };
    condition_snapshot.subject_revision_hash =
        canonical_condition_snapshot_hash(&condition_snapshot)
            .map_err(|error| format!("guarded action condition snapshot is invalid: {error}"))?;
    Ok(GuardedActionSnapshot {
        organization_id,
        company_id,
        subject_kind: material.subject_kind,
        subject_id: material.subject_id,
        action,
        action_version,
        input_hash,
        condition_snapshot,
        subject_revision_hash: material.revision_hash,
        amount: material.amount,
        percentage: material.percentage,
    })
}

/// Execute a registered action once, or return the original committed receipt.
///
/// # Errors
///
/// Returns an error for an unregistered version/input pairing, invalid scope,
/// changed idempotency-key reuse, a stale material revision, or any guarded
/// domain validation failure. Reducer rollback keeps the receipt and effect
/// atomic when an error is returned.
pub fn execute_guarded_action(
    ctx: &ReducerContext,
    params: ExecuteGuardedActionParams,
) -> Result<GuardedActionExecutionResult, String> {
    validate_action_version(params.action_version)?;
    validate_idempotency_key(&params.idempotency_key)?;
    validate_revision_hash(&params.expected_subject_revision_hash)?;
    validate_input_matches_action(&params.action, &params.input)?;

    let receipt_id = receipt_scope_id(
        params.organization_id,
        params.company_id,
        &params.idempotency_key,
    );
    let input_hash = canonical_input_hash(&params.action, params.action_version, &params.input);
    let (subject_kind, subject_id) = subject_for_input(&params.input);
    let invocation_hash = invocation_hash(
        params.organization_id,
        params.company_id,
        &subject_kind,
        subject_id,
        &params.action,
        params.action_version,
        &input_hash,
        &params.expected_subject_revision_hash,
    );

    if let Some(receipt) = ctx.db.guarded_action_receipt().id().find(&receipt_id) {
        if receipt.invocation_hash != invocation_hash {
            return Err(
                "guarded action idempotency key was already used with different input or revision"
                    .to_string(),
            );
        }
        return Ok(GuardedActionExecutionResult {
            receipt_id: receipt.id,
            effect_hash: receipt.effect_hash,
            result_subject_revision_hash: receipt.result_subject_revision_hash,
            replayed: true,
        });
    }

    // This is intentionally the last read before the guarded domain adapter.
    let before = snapshot_guarded_action(
        ctx,
        params.organization_id,
        params.company_id,
        params.action.clone(),
        params.action_version,
        params.input.clone(),
    )?;
    if before.subject_revision_hash != params.expected_subject_revision_hash {
        return Err("guarded action subject changed after approval was requested".to_string());
    }

    execute_adapter(
        ctx,
        params.organization_id,
        params.company_id,
        &params.input,
    )?;

    let after = snapshot_guarded_action(
        ctx,
        params.organization_id,
        params.company_id,
        params.action.clone(),
        params.action_version,
        params.input.clone(),
    )?;
    let effect_hash = effect_hash(&invocation_hash, &after.subject_revision_hash);
    ctx.db
        .guarded_action_receipt()
        .insert(GuardedActionReceipt {
            id: receipt_id.clone(),
            organization_id: params.organization_id,
            company_id: params.company_id,
            subject_kind,
            subject_id,
            action: params.action,
            action_version: params.action_version,
            input_hash,
            expected_subject_revision_hash: params.expected_subject_revision_hash,
            result_subject_revision_hash: after.subject_revision_hash.clone(),
            invocation_hash,
            effect_hash: effect_hash.clone(),
            idempotency_key: params.idempotency_key,
            executed_at: ctx.timestamp,
        });

    Ok(GuardedActionExecutionResult {
        receipt_id,
        effect_hash,
        result_subject_revision_hash: after.subject_revision_hash,
        replayed: false,
    })
}

#[derive(Debug)]
struct MaterialSnapshot {
    subject_kind: GuardedActionSubjectKind,
    subject_id: u64,
    revision_hash: String,
    amount: Option<MoneyValue>,
    percentage: Option<FixedPointDecimal>,
    condition_fields: Vec<ConditionSnapshotField>,
}

fn material_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    action: &GuardedActionKey,
    input: &GuardedActionInput,
) -> Result<MaterialSnapshot, String> {
    match (action, input) {
        (
            GuardedActionKey::ConfirmPurchaseOrder,
            GuardedActionInput::ConfirmPurchaseOrder { order_id },
        )
        | (
            GuardedActionKey::SendPurchaseOrder,
            GuardedActionInput::SendPurchaseOrder { order_id },
        ) => purchase_order_snapshot(ctx, organization_id, company_id, *order_id),
        (
            GuardedActionKey::ConfirmSalesOrder,
            GuardedActionInput::ConfirmSalesOrder { order_id },
        ) => sales_order_snapshot(ctx, organization_id, company_id, *order_id),
        (GuardedActionKey::PostAccountMove, GuardedActionInput::PostAccountMove { move_id }) => {
            account_move_snapshot(ctx, organization_id, company_id, *move_id)
        }
        (GuardedActionKey::PostPayment, GuardedActionInput::PostPayment { payment_id }) => {
            payment_snapshot(ctx, organization_id, company_id, *payment_id)
        }
        (
            GuardedActionKey::ApproveExpenseSheet,
            GuardedActionInput::ApproveExpenseSheet { sheet_id },
        ) => expense_sheet_snapshot(ctx, organization_id, company_id, *sheet_id),
        (
            GuardedActionKey::ApproveAiActionDraft,
            GuardedActionInput::ApproveAiActionDraft { draft_id },
        ) => ai_draft_snapshot(ctx, organization_id, company_id, *draft_id),
        _ => Err("guarded action input does not match its registered action".to_string()),
    }
}

fn purchase_order_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    order_id: u64,
) -> Result<MaterialSnapshot, String> {
    let order = ctx
        .db
        .purchase_order()
        .id()
        .find(&order_id)
        .ok_or("Purchase order not found")?;
    require_scope(
        "Purchase order",
        order.organization_id,
        order.company_id,
        organization_id,
        company_id,
    )?;
    let mut fields = vec![
        field("id", order.id),
        field("organization_id", order.organization_id),
        field("company_id", order.company_id),
        debug_field("state", &order.state),
        field("partner_id", order.partner_id),
        field("currency_id", order.currency_id),
        float_field("amount_untaxed", order.amount_untaxed),
        float_field("amount_tax", order.amount_tax),
        float_field("amount_total", order.amount_total),
        field("payment_term_id", option_u64(order.payment_term_id)),
        field("fiscal_position_id", option_u64(order.fiscal_position_id)),
        field("date_order", order.date_order.to_micros_since_unix_epoch()),
        field("date_planned", option_timestamp(order.date_planned)),
        field("is_locked", order.is_locked),
    ];
    let mut lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order_id)
        .collect();
    lines.sort_by_key(|line| line.id);
    for line in lines {
        require_scope(
            "Purchase order line",
            line.organization_id,
            line.company_id,
            organization_id,
            company_id,
        )?;
        fields.extend([
            field("line.id", line.id),
            field("line.sequence", line.sequence),
            field("line.product_id", line.product_id),
            field("line.product_uom", line.product_uom),
            float_field("line.product_qty", line.product_qty),
            float_field("line.price_unit", line.price_unit),
            float_field("line.price_subtotal", line.price_subtotal),
            float_field("line.price_tax", line.price_tax),
            float_field("line.price_total", line.price_total),
            field("line.currency_id", line.currency_id),
            debug_field("line.state", &line.state),
            field(
                "line.display_type",
                option_string(line.display_type.as_deref()),
            ),
        ]);
        let mut tax_ids = line.analytic_tag_ids;
        tax_ids.sort_unstable();
        fields.push(field("line.analytic_tag_ids", joined_ids(&tax_ids)));
    }
    let amount = money_value(order.amount_total, order.currency_id)?;
    Ok(material(
        GuardedActionSubjectKind::PurchaseOrder,
        order.id,
        fields,
        Some(amount.clone()),
        None,
        vec![
            condition_field("amount_total", ConditionValue::Money(amount)),
            condition_field("state", ConditionValue::Code(format!("{:?}", order.state))),
        ],
    ))
}

fn sales_order_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    order_id: u64,
) -> Result<MaterialSnapshot, String> {
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;
    require_scope(
        "Sale order",
        order.organization_id,
        order.company_id,
        organization_id,
        company_id,
    )?;
    let mut fields = vec![
        field("id", order.id),
        field("organization_id", order.organization_id),
        field("company_id", order.company_id),
        debug_field("state", &order.state),
        field("partner_id", order.partner_id),
        field("partner_invoice_id", order.partner_invoice_id),
        field("partner_shipping_id", order.partner_shipping_id),
        field("currency_id", order.currency_id),
        field("pricelist_id", order.pricelist_id),
        field("warehouse_id", order.warehouse_id),
        float_field("amount_untaxed", order.amount_untaxed),
        float_field("amount_tax", order.amount_tax),
        float_field("amount_total", order.amount_total),
        field("validity_date", option_timestamp(order.validity_date)),
        field("is_expired", order.is_expired),
        field("is_locked", order.is_locked),
    ];
    let mut lines: Vec<_> = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .collect();
    lines.sort_by_key(|line| line.id);
    for line in lines {
        require_scope(
            "Sale order line",
            line.organization_id,
            line.company_id,
            organization_id,
            company_id,
        )?;
        let mut tax_ids = line.tax_id;
        tax_ids.sort_unstable();
        fields.extend([
            field("line.id", line.id),
            field("line.sequence", line.sequence),
            field("line.product_id", line.product_id),
            field("line.product_uom", line.product_uom),
            float_field("line.product_uom_qty", line.product_uom_qty),
            float_field("line.price_unit", line.price_unit),
            float_field("line.discount", line.discount),
            float_field("line.price_subtotal", line.price_subtotal),
            float_field("line.price_tax", line.price_tax),
            float_field("line.price_total", line.price_total),
            field("line.currency_id", line.currency_id),
            debug_field("line.state", &line.state),
            field(
                "line.display_type",
                option_string(line.display_type.as_deref()),
            ),
            field("line.tax_ids", joined_ids(&tax_ids)),
        ]);
    }
    let max_discount = lines_max_discount(ctx, order_id)?;
    let amount = money_value(order.amount_total, order.currency_id)?;
    let percentage = fixed_decimal(max_discount, 4)?;
    Ok(material(
        GuardedActionSubjectKind::SalesOrder,
        order.id,
        fields,
        Some(amount.clone()),
        Some(percentage.clone()),
        vec![
            condition_field("amount_total", ConditionValue::Money(amount)),
            condition_field("max_discount_percent", ConditionValue::Decimal(percentage)),
            condition_field("state", ConditionValue::Code(format!("{:?}", order.state))),
        ],
    ))
}

fn account_move_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    move_id: u64,
) -> Result<MaterialSnapshot, String> {
    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;
    require_scope(
        "Move",
        move_record.organization_id,
        move_record.company_id,
        organization_id,
        company_id,
    )?;
    let mut fields = vec![
        field("id", move_record.id),
        field("organization_id", move_record.organization_id),
        field("company_id", move_record.company_id),
        debug_field("state", &move_record.state),
        debug_field("move_type", &move_record.move_type),
        field("date", move_record.date.to_micros_since_unix_epoch()),
        field("journal_id", move_record.journal_id),
        field("currency_id", move_record.currency_id),
        field("company_currency_id", move_record.company_currency_id),
        field("partner_id", option_u64(move_record.partner_id)),
        float_field("amount_untaxed", move_record.amount_untaxed),
        float_field("amount_tax", move_record.amount_tax),
        float_field("amount_total", move_record.amount_total),
        field("to_check", move_record.to_check),
        field("auto_post", move_record.auto_post),
    ];
    let mut lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();
    lines.sort_by_key(|line| line.id);
    for line in lines {
        require_scope(
            "Move line",
            line.organization_id,
            line.company_id,
            organization_id,
            company_id,
        )?;
        let mut tax_ids = line.tax_ids;
        tax_ids.sort_unstable();
        fields.extend([
            field("line.id", line.id),
            field("line.sequence", line.sequence),
            field("line.account_id", line.account_id),
            field("line.partner_id", option_u64(line.partner_id)),
            field("line.currency_id", line.currency_id),
            field("line.company_currency_id", line.company_currency_id),
            float_field("line.debit", line.debit),
            float_field("line.credit", line.credit),
            float_field("line.balance", line.balance),
            float_field("line.amount_currency", line.amount_currency),
            field("line.tax_ids", joined_ids(&tax_ids)),
            field("line.tax_line_id", option_u64(line.tax_line_id)),
            field("line.blocked", line.blocked),
            field(
                "line.display_type",
                option_string(line.display_type.as_deref()),
            ),
        ]);
    }
    let amount = money_value(move_record.amount_total, move_record.currency_id)?;
    Ok(material(
        GuardedActionSubjectKind::AccountMove,
        move_record.id,
        fields,
        Some(amount.clone()),
        None,
        vec![
            condition_field("amount_total", ConditionValue::Money(amount)),
            condition_field(
                "move_type",
                ConditionValue::Code(format!("{:?}", move_record.move_type)),
            ),
            condition_field(
                "state",
                ConditionValue::Code(format!("{:?}", move_record.state)),
            ),
        ],
    ))
}

fn payment_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payment_id: u64,
) -> Result<MaterialSnapshot, String> {
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment not found")?;
    require_scope(
        "Payment",
        payment.organization_id,
        payment.company_id,
        organization_id,
        company_id,
    )?;
    let mut invoice_ids = payment.reconciled_invoice_ids.clone();
    invoice_ids.sort_unstable();
    let mut bill_ids = payment.reconciled_bill_ids.clone();
    bill_ids.sort_unstable();
    let fields = vec![
        field("id", payment.id),
        field("organization_id", payment.organization_id),
        field("company_id", payment.company_id),
        debug_field("state", &payment.state),
        debug_field("payment_type", &payment.payment_type),
        debug_field("partner_type", &payment.partner_type),
        field("partner_id", payment.partner_id),
        float_field("amount", payment.amount),
        field("currency_id", payment.currency_id),
        field("date", payment.date.to_micros_since_unix_epoch()),
        field("journal_id", payment.journal_id),
        field("reconciled_invoice_ids", joined_ids(&invoice_ids)),
        field("reconciled_bill_ids", joined_ids(&bill_ids)),
    ];
    let amount = money_value(payment.amount, payment.currency_id)?;
    Ok(material(
        GuardedActionSubjectKind::AccountPayment,
        payment.id,
        fields,
        Some(amount.clone()),
        None,
        vec![
            condition_field("amount", ConditionValue::Money(amount)),
            condition_field(
                "payment_type",
                ConditionValue::Code(format!("{:?}", payment.payment_type)),
            ),
            condition_field(
                "state",
                ConditionValue::Code(format!("{:?}", payment.state)),
            ),
        ],
    ))
}

fn expense_sheet_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    sheet_id: u64,
) -> Result<MaterialSnapshot, String> {
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    require_scope(
        "Expense sheet",
        sheet.organization_id,
        sheet.company_id,
        organization_id,
        company_id,
    )?;
    let mut fields = vec![
        field("id", sheet.id),
        field("organization_id", sheet.organization_id),
        field("company_id", sheet.company_id),
        debug_field("state", &sheet.state),
        field("employee_id", sheet.employee_id),
        float_field("total_amount", sheet.total_amount),
        field("currency_id", sheet.currency_id),
        field("company_currency_id", sheet.company_currency_id),
        float_field("currency_rate", sheet.currency_rate),
        field("accounting_date", option_timestamp(sheet.accounting_date)),
        field("submitted_by", option_debug(sheet.submitted_by.as_ref())),
    ];
    let mut lines: Vec<_> = ctx
        .db
        .hr_expense()
        .iter()
        .filter(|line| line.sheet_id == Some(sheet_id))
        .collect();
    lines.sort_by_key(|line| line.id);
    for line in lines {
        require_scope(
            "Expense line",
            line.organization_id,
            line.company_id,
            organization_id,
            company_id,
        )?;
        let mut tax_ids = line.tax_ids;
        tax_ids.sort_unstable();
        let mut attachment_ids = line.attachment_ids;
        attachment_ids.sort_unstable();
        fields.extend([
            field("line.id", line.id),
            field("line.employee_id", line.employee_id),
            field("line.product_id", option_u64(line.product_id)),
            field("line.date", line.date.to_micros_since_unix_epoch()),
            float_field("line.total_amount", line.total_amount),
            field("line.currency_id", line.currency_id),
            debug_field("line.kind", &line.line_kind),
            debug_field("line.state", &line.state),
            field("line.tax_ids", joined_ids(&tax_ids)),
            field("line.attachment_ids", joined_ids(&attachment_ids)),
            field("line.has_receipt", line.has_receipt),
            field("line.fraud_hold", line.fraud_hold),
            field("line.policy_hold", line.policy_hold),
        ]);
    }
    let amount = money_value(sheet.total_amount, sheet.currency_id)?;
    Ok(material(
        GuardedActionSubjectKind::ExpenseSheet,
        sheet.id,
        fields,
        Some(amount.clone()),
        None,
        vec![
            condition_field("amount_total", ConditionValue::Money(amount)),
            condition_field("state", ConditionValue::Code(format!("{:?}", sheet.state))),
        ],
    ))
}

fn ai_draft_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    draft_id: u64,
) -> Result<MaterialSnapshot, String> {
    let draft = ctx
        .db
        .ai_action_draft()
        .id()
        .find(&draft_id)
        .ok_or("AI action draft not found")?;
    require_scope(
        "AI action draft",
        draft.organization_id,
        draft.company_id,
        organization_id,
        company_id,
    )?;
    let fields = vec![
        field("id", draft.id),
        field("organization_id", draft.organization_id),
        field("company_id", draft.company_id),
        field("status", &draft.status),
        field("reducer_name", &draft.reducer_name),
        field("params_json", canonical_json_or_raw(&draft.params_json)),
        field("summary", &draft.summary),
        float_field("confidence", draft.confidence),
        field("elevated", draft.elevated),
        field(
            "warnings_json",
            option_canonical_json(draft.warnings_json.as_deref()),
        ),
        field("proposed_by", format!("{:?}", draft.proposed_by)),
        field("expires_at", option_timestamp(draft.expires_at)),
    ];
    Ok(material(
        GuardedActionSubjectKind::AiActionDraft,
        draft.id,
        fields,
        None,
        None,
        vec![
            condition_field("params_json", ConditionValue::Text(draft.params_json)),
            condition_field("reducer_name", ConditionValue::Code(draft.reducer_name)),
            condition_field("summary", ConditionValue::Text(draft.summary)),
        ],
    ))
}

fn execute_adapter(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    input: &GuardedActionInput,
) -> Result<(), String> {
    match input {
        GuardedActionInput::ConfirmPurchaseOrder { order_id } => {
            confirm_purchase_order_impl(ctx, organization_id, *order_id, true)
        }
        GuardedActionInput::SendPurchaseOrder { order_id } => {
            send_purchase_order_impl(ctx, organization_id, *order_id, true)
        }
        GuardedActionInput::ConfirmSalesOrder { order_id } => {
            confirm_sales_order_impl(ctx, organization_id, *order_id, true)
        }
        GuardedActionInput::PostAccountMove { move_id } => {
            post_account_move_impl(ctx, organization_id, *move_id, true)
        }
        GuardedActionInput::PostPayment { payment_id } => {
            post_payment_impl(ctx, organization_id, *payment_id, true)
        }
        GuardedActionInput::ApproveExpenseSheet { sheet_id } => {
            approve_expense_sheet_impl(ctx, organization_id, *sheet_id, true)
        }
        GuardedActionInput::ApproveAiActionDraft { draft_id } => {
            approve_ai_action_draft_core(ctx, organization_id, company_id, *draft_id)
        }
    }
}

fn validate_action_version(version: u32) -> Result<(), String> {
    if version == GUARDED_ACTION_SCHEMA_VERSION {
        Ok(())
    } else {
        Err(format!(
            "unsupported guarded action version {version}; expected {GUARDED_ACTION_SCHEMA_VERSION}"
        ))
    }
}

fn validate_input_matches_action(
    action: &GuardedActionKey,
    input: &GuardedActionInput,
) -> Result<(), String> {
    let matches = matches!(
        (action, input),
        (
            GuardedActionKey::ConfirmPurchaseOrder,
            GuardedActionInput::ConfirmPurchaseOrder { .. }
        ) | (
            GuardedActionKey::SendPurchaseOrder,
            GuardedActionInput::SendPurchaseOrder { .. }
        ) | (
            GuardedActionKey::ConfirmSalesOrder,
            GuardedActionInput::ConfirmSalesOrder { .. }
        ) | (
            GuardedActionKey::PostAccountMove,
            GuardedActionInput::PostAccountMove { .. }
        ) | (
            GuardedActionKey::PostPayment,
            GuardedActionInput::PostPayment { .. }
        ) | (
            GuardedActionKey::ApproveExpenseSheet,
            GuardedActionInput::ApproveExpenseSheet { .. }
        ) | (
            GuardedActionKey::ApproveAiActionDraft,
            GuardedActionInput::ApproveAiActionDraft { .. }
        )
    );
    if matches {
        Ok(())
    } else {
        Err("guarded action input does not match its registered action".to_string())
    }
}

fn subject_for_input(input: &GuardedActionInput) -> (GuardedActionSubjectKind, u64) {
    match input {
        GuardedActionInput::ConfirmPurchaseOrder { order_id }
        | GuardedActionInput::SendPurchaseOrder { order_id } => {
            (GuardedActionSubjectKind::PurchaseOrder, *order_id)
        }
        GuardedActionInput::ConfirmSalesOrder { order_id } => {
            (GuardedActionSubjectKind::SalesOrder, *order_id)
        }
        GuardedActionInput::PostAccountMove { move_id } => {
            (GuardedActionSubjectKind::AccountMove, *move_id)
        }
        GuardedActionInput::PostPayment { payment_id } => {
            (GuardedActionSubjectKind::AccountPayment, *payment_id)
        }
        GuardedActionInput::ApproveExpenseSheet { sheet_id } => {
            (GuardedActionSubjectKind::ExpenseSheet, *sheet_id)
        }
        GuardedActionInput::ApproveAiActionDraft { draft_id } => {
            (GuardedActionSubjectKind::AiActionDraft, *draft_id)
        }
    }
}

fn require_scope(
    label: &str,
    actual_organization_id: u64,
    actual_company_id: u64,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    if actual_organization_id != organization_id {
        return Err(format!("{label} belongs to a different organization"));
    }
    if actual_company_id != company_id {
        return Err(format!("{label} belongs to a different company"));
    }
    Ok(())
}

fn validate_idempotency_key(key: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("guarded action idempotency key is required".to_string());
    }
    if trimmed != key || key.len() > 256 {
        return Err(
            "guarded action idempotency key must be trimmed and at most 256 bytes".to_string(),
        );
    }
    Ok(())
}

fn validate_revision_hash(hash: &str) -> Result<(), String> {
    let Some(hex) = hash.strip_prefix("sha256:") else {
        return Err("guarded action revision hash must use the sha256: prefix".to_string());
    };
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("guarded action revision hash must be lowercase SHA-256".to_string());
    }
    Ok(())
}

fn canonical_input_hash(
    action: &GuardedActionKey,
    version: u32,
    input: &GuardedActionInput,
) -> String {
    let (_, subject_id) = subject_for_input(input);
    canonical_hash(&[
        action.as_str().to_string(),
        version.to_string(),
        subject_id.to_string(),
    ])
}

fn receipt_scope_id(organization_id: u64, company_id: u64, idempotency_key: &str) -> String {
    canonical_hash(&[
        "guarded-action-receipt".to_string(),
        organization_id.to_string(),
        company_id.to_string(),
        idempotency_key.to_string(),
    ])
}

#[allow(clippy::too_many_arguments)]
fn invocation_hash(
    organization_id: u64,
    company_id: u64,
    subject_kind: &GuardedActionSubjectKind,
    subject_id: u64,
    action: &GuardedActionKey,
    action_version: u32,
    input_hash: &str,
    expected_revision_hash: &str,
) -> String {
    canonical_hash(&[
        organization_id.to_string(),
        company_id.to_string(),
        subject_kind.as_str().to_string(),
        subject_id.to_string(),
        action.as_str().to_string(),
        action_version.to_string(),
        input_hash.to_string(),
        expected_revision_hash.to_string(),
    ])
}

fn effect_hash(invocation_hash: &str, result_revision_hash: &str) -> String {
    canonical_hash(&[
        "guarded-action-effect".to_string(),
        invocation_hash.to_string(),
        result_revision_hash.to_string(),
    ])
}

fn material(
    subject_kind: GuardedActionSubjectKind,
    subject_id: u64,
    fields: Vec<String>,
    amount: Option<MoneyValue>,
    percentage: Option<FixedPointDecimal>,
    condition_fields: Vec<ConditionSnapshotField>,
) -> MaterialSnapshot {
    MaterialSnapshot {
        subject_kind,
        subject_id,
        revision_hash: canonical_hash(&fields),
        amount,
        percentage,
        condition_fields,
    }
}

fn canonical_hash(fields: &[String]) -> String {
    let mut hasher = Sha256::new();
    for value in fields {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value.as_bytes());
    }
    format!("sha256:{:x}", hasher.finalize())
}

fn field(name: &str, value: impl ToString) -> String {
    format!("{name}={}", value.to_string())
}

fn condition_field(field_key: &str, value: ConditionValue) -> ConditionSnapshotField {
    ConditionSnapshotField {
        field_key: field_key.to_string(),
        value,
    }
}

fn lines_max_discount(ctx: &ReducerContext, order_id: u64) -> Result<f64, String> {
    let mut max_discount = 0.0_f64;
    for line in ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .filter(|line| line.display_type.is_none())
    {
        if !line.discount.is_finite() {
            return Err("sale order discount must be finite".to_string());
        }
        max_discount = max_discount.max(line.discount);
    }
    Ok(max_discount)
}

fn debug_field(name: &str, value: &impl std::fmt::Debug) -> String {
    field(name, format!("{value:?}"))
}

fn float_field(name: &str, value: f64) -> String {
    field(name, format!("{:016x}", value.to_bits()))
}

fn option_u64(value: Option<u64>) -> String {
    value.map_or_else(|| "null".to_string(), |value| value.to_string())
}

fn option_timestamp(value: Option<Timestamp>) -> String {
    value.map_or_else(
        || "null".to_string(),
        |value| value.to_micros_since_unix_epoch().to_string(),
    )
}

fn option_string(value: Option<&str>) -> String {
    value.unwrap_or("<null>").to_string()
}

fn option_debug(value: Option<&impl std::fmt::Debug>) -> String {
    value.map_or_else(|| "null".to_string(), |value| format!("{value:?}"))
}

fn joined_ids(ids: &[u64]) -> String {
    ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",")
}

fn canonical_json_or_raw(value: &str) -> String {
    serde_json::from_str::<serde_json::Value>(value)
        .ok()
        .and_then(|parsed| serde_json::to_string(&parsed).ok())
        .unwrap_or_else(|| value.to_string())
}

fn option_canonical_json(value: Option<&str>) -> String {
    value.map_or_else(|| "null".to_string(), canonical_json_or_raw)
}

fn money_value(value: f64, currency_id: u64) -> Result<MoneyValue, String> {
    let currency = legacy_currency_code_for_id(currency_id);
    let scale = if currency == "JPY" { 0 } else { 2 };
    let minor_units = exact_scaled_integer(value, scale, "guarded action amount")?;
    Ok(MoneyValue {
        minor_units,
        currency: currency.to_string(),
    })
}

fn fixed_decimal(value: f64, scale: u32) -> Result<FixedPointDecimal, String> {
    Ok(FixedPointDecimal {
        coefficient: exact_scaled_integer(value, scale, "guarded action percentage")?,
        scale,
    })
}

fn exact_scaled_integer(value: f64, scale: u32, label: &str) -> Result<i64, String> {
    if !value.is_finite() {
        return Err(format!("{label} must be finite"));
    }
    let multiplier = 10_u64
        .checked_pow(scale)
        .ok_or_else(|| format!("{label} scale is outside fixed-point range"))?;
    let scaled = value * multiplier as f64;
    if scaled < i64::MIN as f64 || scaled > i64::MAX as f64 {
        return Err(format!("{label} is outside fixed-point range"));
    }
    let rounded = scaled.round();
    let tolerance = f64::EPSILON * scaled.abs().max(1.0) * 4.0;
    if (scaled - rounded).abs() > tolerance {
        return Err(format!("{label} is not exact at scale {scale}"));
    }
    Ok(rounded as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_is_closed_and_versioned() {
        for key in [
            "confirm_purchase_order",
            "send_purchase_order",
            "confirm_sales_order",
            "post_account_move",
            "post_payment",
            "approve_expense_sheet",
            "approve_ai_action_draft",
        ] {
            assert!(resolve_guarded_action(key, 1).is_ok());
        }
        assert!(resolve_guarded_action("approve_leave", 1).is_err());
        assert!(resolve_guarded_action("post_payment", 2).is_err());
    }

    #[test]
    fn input_hash_is_typed_and_stable() {
        let action = GuardedActionKey::PostPayment;
        let input = GuardedActionInput::PostPayment { payment_id: 42 };
        assert_eq!(
            canonical_input_hash(&action, 1, &input),
            canonical_input_hash(&action, 1, &input)
        );
        assert_ne!(
            canonical_input_hash(&action, 1, &input),
            canonical_input_hash(
                &GuardedActionKey::PostAccountMove,
                1,
                &GuardedActionInput::PostAccountMove { move_id: 42 }
            )
        );
    }

    #[test]
    fn fixed_point_boundaries_reject_lossy_values() {
        assert_eq!(money_value(12.34, 1).unwrap().minor_units, 1_234);
        assert_eq!(money_value(12.0, 6).unwrap().minor_units, 12);
        assert!(money_value(12.345, 1).is_err());
        assert!(money_value(12.5, 6).is_err());
        assert!(money_value(f64::NAN, 1).is_err());
        assert!(fixed_decimal(2.12345, 4).is_err());
    }
}
