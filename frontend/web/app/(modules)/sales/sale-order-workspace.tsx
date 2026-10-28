'use client';

import type { ReactNode } from 'react';
import { useTranslation } from '@lumiere/i18n';
import { Button } from '@lumiere/ui';
import type { SaleOrderNextStep } from './sale-order-next-step';

const guidance: Record<SaleOrderNextStep, [string, string, string?]> = {
  'add-products': ['Add products to this quotation', 'Choose products and quantities, then review prices and totals before sending.', 'Add products'],
  send: ['Review and send the quotation', 'Check products, prices and delivery details before marking the quotation as sent.'],
  accept: ['Record the customer’s acceptance', 'Record who accepted the quotation, then confirm the order.'],
  confirm: ['Confirm the sales order', 'Confirmation checks availability and credit rules. An approval may be required.'],
  approval: ['Awaiting approval', 'Review the approval request before continuing with this order.', 'View approvals'],
  invoice: ['Create the customer invoice', 'Review the quantities to invoice and the required accounting choices.'],
  delivery: ['Complete delivery before invoicing', 'This order invoices delivered quantities. Open its delivery to continue.', 'View deliveries'],
  review: ['Review deliveries and invoices', 'Follow the linked records for delivery progress, invoice status and payments.', 'View linked records'],
  cancelled: ['This order is cancelled', 'Review its history and linked records for earlier activity.'],
  locked: ['This order is locked', 'Unlock the order before making changes, if your role permits it.'],
  unavailable: ['Order lines are unavailable', 'Wait for loading to finish or refresh before continuing.'],
};

export function SaleOrderNextAction({ step, actionLabel, blockedReason, pending, onContinue, error }: {
  step: SaleOrderNextStep; error?: string; actionLabel?: string; blockedReason?: string; pending?: boolean; onContinue?: () => void;
}) {
  const { t } = useTranslation();
  const [title, description, defaultAction] = guidance[step];
  return <section aria-labelledby="sale-order-next-step-title" className="rounded-lg border bg-card p-4" data-testid="sale-order-next-step">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{t('sales.workspace.nextStep', { defaultValue: 'Next step' })}</p>
        <h2 id="sale-order-next-step-title" className="mt-1 font-semibold">{t(`sales.workspace.steps.${step}.title`, { defaultValue: title })}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(`sales.workspace.steps.${step}.description`, { defaultValue: description })}</p>
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        {blockedReason && <p role="status" className="mt-2 text-sm text-destructive">{blockedReason}</p>}
      </div>
      {onContinue && <Button disabled={pending || !!blockedReason} onClick={onContinue} data-testid="sale-order-next-action">
        {actionLabel ?? t(`sales.workspace.steps.${step}.action`, { defaultValue: defaultAction ?? title })}
      </Button>}
    </div>
  </section>;
}

export function SaleOrderWorkspace({ nextAction, lines, handoffs, details, totals }: {
  nextAction: ReactNode; lines: ReactNode; handoffs: ReactNode; details: ReactNode;
  totals: readonly { label: string; value: string }[];
}) {
  const { t } = useTranslation();
  return <div className="space-y-5" data-testid="sale-order-workspace">
    {nextAction}
    <dl className="grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-3" data-testid="sale-order-totals">
      {totals.map((total) => <div key={total.label}><dt className="text-sm text-muted-foreground">{total.label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{total.value}</dd></div>)}
    </dl>
    <section className="min-w-0 space-y-3"><h2 className="font-semibold">{t('sales.workspace.products', { defaultValue: 'Products' })}</h2>{lines}</section>
    <section className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold">{t('sales.workspace.linkedRecords', { defaultValue: 'Deliveries, invoices and payments' })}</h2>{handoffs}</section>
    <section className="space-y-3"><h2 className="font-semibold">{t('sales.workspace.orderDetails', { defaultValue: 'Order details' })}</h2>{details}</section>
  </div>;
}
