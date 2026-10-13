'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '@lumiere/i18n';
import { FormModal, type FormConfig } from '@lumiere/ui';
import { useAccountPayments } from '@lumiere/query-hooks/hooks/accounting';
import { useInvoiceToPaymentWorkflow } from '@lumiere/query-hooks/hooks/accounting/invoice-workflow';
import { paymentOptionLabel, registrablePayments } from './invoice-actions';

type Row = Record<string, unknown>;

interface RegisterPaymentOnInvoiceDialogProps {
  organizationId: bigint;
  move: Row;
  isBill: boolean;
  /** The page's workflow, so the same registration transition (and its readback) runs as on the Payments tab. */
  registerPayment: ReturnType<typeof useInvoiceToPaymentWorkflow>['registerPayment'];
  isPending: boolean;
  onClose: () => void;
}

/**
 * Apply a posted payment to the open invoice or bill. The Payments tab does the inverse (pick a
 * payment, then its invoices); both end in `registerPayment` of `useInvoiceToPaymentWorkflow`.
 */
export function RegisterPaymentOnInvoiceDialog({
  organizationId,
  move,
  isBill,
  registerPayment,
  isPending,
  onClose,
}: RegisterPaymentOnInvoiceDialogProps) {
  const { t } = useTranslation();
  const { data: payments = [] } = useAccountPayments(organizationId, { enabled: true });
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => {
    const rows = registrablePayments(payments as unknown as Row[], move);
    return rows.length > 0
      ? rows.map((row) => ({ value: String(row.id), label: paymentOptionLabel(row) }))
      : [
          {
            value: '',
            label: t('accounting.invoices.noRegistrablePayments', { defaultValue: 'No posted payments available' }),
            disabled: true,
          },
        ];
  }, [payments, move, t]);

  const config = useMemo(
    (): FormConfig => ({
      id: 'register-payment-on-invoice',
      title: t('accounting.invoices.invoiceActions.registerPayment', { defaultValue: 'Register payment' }),
      description: t('accounting.invoices.registerPaymentHint', {
        defaultValue: 'Apply a posted payment to this document.',
      }),
      submitLabel: t('accounting.forms.registerPaymentInvoices.submitLabel'),
      cancelLabel: t('common.cancel'),
      sections: [
        {
          id: 'main',
          title: t('accounting.forms.registerPaymentInvoices.sections.main'),
          fields: [
            {
              id: 'paymentId',
              name: 'paymentId',
              type: 'select',
              label: t('accounting.invoices.payment', { defaultValue: 'Payment' }),
              required: true,
              width: 'full',
              options,
            },
          ],
        },
      ],
    }),
    [options, t],
  );

  return (
    <FormModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      config={config}
      closeOnSubmit={false}
      submitError={error}
      isPending={isPending}
      onSubmit={async (values) => {
        setError(null);
        const raw = String(values.paymentId ?? '').trim();
        if (raw === '') {
          setError(t('common.validation.required'));
          return;
        }
        try {
          await registerPayment({ paymentId: BigInt(raw), invoiceIds: [BigInt(String(move.id))], isBill });
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }}
    />
  );
}
