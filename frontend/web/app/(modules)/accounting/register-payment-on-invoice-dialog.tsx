'use client';

import { useTranslation } from '@lumiere/i18n';
import { useAccountPayments } from '@lumiere/query-hooks/hooks/accounting';
import type { useInvoiceToPaymentWorkflow } from '@lumiere/query-hooks/hooks/accounting/invoice-workflow';
import { ApplyPostedPaymentDialog } from '@lumiere/ui/accounting-components/apply-posted-payment-dialog';
import { moduleCollection } from '@lumiere/ui/lib/module-data-state';
import { canRegisterPayment, paymentOptionLabel, registrablePayments } from './invoice-actions';

type Row = Record<string, unknown>;

interface RegisterPaymentOnInvoiceDialogProps {
  organizationId: bigint;
  move: Row;
  isBill: boolean;
  registerPayment: ReturnType<typeof useInvoiceToPaymentWorkflow>['registerPayment'];
  isPending: boolean;
  canApply: boolean;
  onClose: () => void;
}

/** Uses the same registration transition and canonical readback as the Payments workspace. */
export function RegisterPaymentOnInvoiceDialog({ organizationId, move, isBill, registerPayment, isPending, canApply, onClose }: RegisterPaymentOnInvoiceDialogProps) {
  const { t } = useTranslation();
  const payments = moduleCollection(useAccountPayments(organizationId, { enabled: true }));
  const rows = payments.state.status === 'ready' ? registrablePayments(payments.rows, move) : [];
  const allowed = canApply && canRegisterPayment(move, isBill ? 'bill' : 'invoice');
  return <ApplyPostedPaymentDialog
    options={rows.map((row) => ({ value: String(row.id), label: paymentOptionLabel(row) }))}
    sourceState={payments.state}
    canApply={allowed}
    isPending={isPending}
    onClose={onClose}
    onApply={async (paymentId) => {
      if (!allowed || payments.state.status !== 'ready' || !rows.some((row) => String(row.id) === paymentId)) throw new Error(t('accounting.applyPayment.changed'));
      await registerPayment({ paymentId: BigInt(paymentId), invoiceIds: [BigInt(String(move.id))], isBill });
    }}
  />;
}
