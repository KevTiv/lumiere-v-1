'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LumiereApiProvider, createLumiereApiClient } from '@lumiere/api-client';
import { ErpSessionProvider, useErpSession } from '@lumiere/erp-session';
import { I18nProvider } from '@lumiere/i18n';
import { RBACProvider } from '../../../packages/ui/src/lib/rbac-context';
import { ThemeProvider } from '../../../packages/ui/src/components/theme-provider';
import { Toaster } from '../../../packages/ui/src/components/sonner';
import { Button } from '../../../packages/ui/src/components/button';
import { SubscriptionsClient } from '../../app/(modules)/subscriptions/subscriptions-client';
import { SubscriptionPageClient } from '../../app/(modules)/subscriptions/[id]/subscription-page-client';

const fixtureApi = createLumiereApiClient({ baseUrl: '' });
const base = { organizationId: 1n, companyId: 1n };
const data = {
  subscriptions: [
    { ...base, id: 1n, code: 'SUB-DRAFT', state: 'draft', planId: 5n, partnerId: 7n, currencyId: 8n, recurringTotal: 120, recurringNextDate: '2026-10-01', invoiceCount: 0 },
    { ...base, id: 2n, code: 'SUB-ACTIVE', state: 'active', planId: 5n, partnerId: 7n, currencyId: 8n, recurringTotal: 120, recurringNextDate: '2026-10-01', closeDate: null, invoiceCount: 1 },
    { ...base, companyId: 2n, id: 3n, code: 'OTHER-COMPANY', state: 'draft', planId: 9n, partnerId: 7n, currencyId: 8n },
  ],
  'subscription-plans': [{ ...base, id: 5n, name: 'Monthly support', code: 'SUPPORT', active: true, billingPeriod: 'month', billingPeriodUnit: 1, recurringInvoiceDay: 1, paymentMode: 'draft_invoice', currencyId: 8n, journalId: 11n }, { ...base, id: 6n, name: 'Archived plan', active: false }],
  'subscription-lines': [{ ...base, id: 21n, subscriptionId: 1n, name: 'Support service', priceUnit: 120, quantity: 1 }, { ...base, id: 22n, subscriptionId: 2n, name: 'Support service', priceUnit: 120, quantity: 1 }],
  'subscription-billing-runs': [{ ...base, id: 31n, subscriptionId: 2n, invoiceMoveId: 41n }],
  'subscription-amendments': [{ ...base, id: 71n, subscriptionId: 2n, amendmentType: 'renew', version: 2, effectiveDate: '2026-09-01' }, { ...base, companyId: 2n, id: 72n, subscriptionId: 2n, amendmentType: 'renew', version: 9, effectiveDate: '2035-01-01' }],
  'account-moves': [{ ...base, id: 41n, name: 'INV/001', state: { tag: 'Posted' }, moveType: { tag: 'OutInvoice' }, partnerId: 7n, currencyId: 8n, amountTotal: 120, amountResidual: 75 }],
  'account-journals': [{ ...base, id: 11n, name: 'Sales journal', code: 'SAL', active: true, type: { tag: 'Sale' } }, { ...base, id: 12n, name: 'Bank journal', code: 'BNK', active: true, type: { tag: 'Bank' }, defaultAccountId: 51n }],
  'account-accounts': [{ ...base, id: 51n, name: 'Bank account', code: '101', deprecated: false }, { ...base, id: 52n, name: 'Receivable', code: '120', deprecated: false }, { ...base, id: 53n, name: 'Revenue', code: '400', deprecated: false }],
  'sale-orders': [{ ...base, id: 61n, reference: 'SO-CONFIRMED', state: { tag: 'Sale' }, partnerId: 7n, currencyId: 8n, amountTotal: 120 }, { ...base, id: 62n, reference: 'SO-DRAFT', state: { tag: 'Draft' } }],
  contacts: [{ ...base, id: 7n, name: 'Synthetic customer' }],
  companies: [{ ...base, id: 1n, name: 'Synthetic company' }, { ...base, id: 2n, name: 'Other company' }],
};
function Controls({ client }: { client: QueryClient }) {
  const [hydrated, setHydrated] = useState(false);
  const { setActiveCompanyId } = useErpSession();
  useEffect(() => setHydrated(true), []);
  return <div className="space-y-3">
    <p data-testid="subscription-fixture-disclosure" data-hydrated={hydrated} className="text-xs text-muted-foreground">Synthetic subscription UI preview. No authentication or real ERP writes.</p>
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" onClick={() => client.setQueryData(['subscription-plans', '1'], [])}>Remove synthetic plans</Button>
      <Button variant="outline" onClick={() => client.setQueryData(['subscription-plans', '1'], data['subscription-plans'])}>Restore synthetic plans</Button>
      <Button variant="outline" onClick={() => setActiveCompanyId?.(2)}>Switch synthetic company</Button>
      <Button variant="outline" onClick={() => client.getQueryCache().find({ queryKey: ['subscription-past-due', '1'] })?.setState({ status: 'error', error: Object.assign(new Error('Synthetic forbidden'), { status: 403 }) })}>Deny synthetic collections</Button>
      <Button variant="outline" onClick={() => client.getQueryCache().find({ queryKey: ['subscription-amendments', '1'] })?.setState({ status: 'error', error: Object.assign(new Error('Synthetic forbidden'), { status: 403 }) })}>Deny synthetic amendments</Button>
    </div>
  </div>;
}
export function SubscriptionFixture({ id }: { id?: string }) {
  const [client] = useState(() => {
    const value = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false, refetchOnMount: false, refetchOnWindowFocus: false, staleTime: Infinity } } });
    const empty = ['subscription-usage-events', 'subscription-usage-charges', 'subscription-rating-backlog', 'subscription-price-tiers', 'subscription-past-due', 'subscription-due-to-bill', 'subscription-bundles', 'subscription-entitlements', 'subscription-payment-intents', 'deferred-revenue-schedules', 'deferred-revenue-lines', 'revenue-recognition-rules', 'pricelists', 'products', 'product-categories', 'account-payments', 'account-move-lines'];
    for (const [resource, rows] of [...Object.entries(data), ...empty.map((resource) => [resource, []] as const)]) {
      value.setQueryData([resource, '1'], rows);
      value.setQueryData(['stdb', resource, '1'], rows);
      for (const company of [1, 2]) value.setQueryData(['typed-stdb', resource, '1', 'company', company], rows);
    }
    value.setQueryData(['currencies'], [{ id: 8n, code: 'USD', name: 'US Dollar', decimalPlaces: 2 }]);
    return value;
  });
  return <LumiereApiProvider client={fixtureApi}><QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ErpSessionProvider value={{ identity: 'ab'.repeat(32), connected: false, organizationId: 1, companyIds: [1, 2] }}><ThemeProvider defaultTheme="light" storageKey="subscription-preview">
    <main className="mx-auto min-w-0 max-w-7xl space-y-5 p-4 sm:p-6"><Controls client={client} />{id ? <SubscriptionPageClient subscriptionId={id} organizationId={1} /> : <SubscriptionsClient organizationId={1} />}</main><Toaster />
  </ThemeProvider></ErpSessionProvider></RBACProvider></I18nProvider></QueryClientProvider></LumiereApiProvider>;
}
