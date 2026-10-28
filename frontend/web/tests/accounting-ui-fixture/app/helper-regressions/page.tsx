'use client';

import { useEffect, useMemo, useState } from 'react';
import { I18nProvider, useTranslation } from '@lumiere/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RBACProvider } from '@lumiere/ui/lib/rbac-context';
import { ThemeProvider } from '@lumiere/ui/components/theme-provider';
import { Button } from '@lumiere/ui/components/button';
import { FormModal } from '@lumiere/ui/forms/form-modal';
import { postExpenseReportForm } from '@lumiere/ui/lib/expenses-form-configs';
import { newMailMessageForm } from '@lumiere/ui/lib/messages-form-configs';
import { newSaleOrderForm } from '@lumiere/ui/lib/sales-form-configs';
import type { FormConfig } from '@lumiere/ui/lib/form-types';

function Fixture() {
  const { t } = useTranslation();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'quotation' | 'posting' | 'message'>('quotation');
  const [saved, setSaved] = useState('');
  const config = useMemo<FormConfig>(() => {
    const base = mode === 'quotation' ? newSaleOrderForm(t) : mode === 'posting' ? postExpenseReportForm(t) : newMailMessageForm(t);
    const accountOptions = [{ value: '1168', label: '2000 — Accounts Payable' }, ...Array.from({ length: 100 }, (_, i) => ({ value: String(i + 1), label: `${4000 + i} — Expense account ${i + 1}` }))];
    const options = {
      partnerId: [{ value: '217', label: 'Acme Corporation' }, { value: '223', label: 'Acme Corporation' }],
      pricelistId: [{ value: '1', label: 'Price list · USD' }],
      warehouseId: [{ value: '1', label: 'Warehouse' }],
      journalId: [{ value: '1', label: 'Purchase journal' }],
      defaultExpenseAccountId: accountOptions,
      payableAccountId: accountOptions,
    };
    return { ...base, sections: base.sections.map((section) => ({ ...section, fields: section.fields.map((field) => {
      const choices = options[field.name as keyof typeof options];
      return choices ? { ...field, options: choices } : field;
    }) })) };
  }, [mode, t]);
  return <main className="space-y-4 p-4">
    <p data-testid="helper-fixture" data-hydrated={hydrated}>Synthetic production-form regression fixture. No ERP operations.</p>
    <Button onClick={() => { setMode('quotation'); setOpen(true); }}>Quotation</Button>
    <Button onClick={() => { setMode('posting'); setOpen(true); }}>Post expense report</Button>
    <Button onClick={() => { setMode('message'); setOpen(true); }}>Message</Button>
    <output data-testid="saved-fixture">{saved}</output>
    <FormModal config={config} open={open} onOpenChange={setOpen} draft={false}
      onSubmit={async (data) => setSaved(JSON.stringify(data))} />
  </main>;
}

export default function Page() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ThemeProvider defaultTheme="light"><Fixture /></ThemeProvider></RBACProvider></I18nProvider></QueryClientProvider>;
}
