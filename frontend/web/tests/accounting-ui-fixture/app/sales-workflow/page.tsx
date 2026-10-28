'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { I18nProvider, useTranslation } from '@lumiere/i18n';
import { Button, CurrencyFormatProvider, EntityDetail, RecordPage, SaleOrderLineGrid, StatusBar } from '@lumiere/ui';
import { RBACProvider } from '@lumiere/ui/lib/rbac-context';
import { ThemeProvider } from '@lumiere/ui/components/theme-provider';
import { SaleOrderNextAction, SaleOrderWorkspace } from '../../../../app/(modules)/sales/sale-order-workspace';
import { saleOrderNextStep } from '../../../../app/(modules)/sales/sale-order-next-step';
import { saleOrderStatusBar } from '../../../../app/(modules)/sales/sale-order-status';
import { saleOrderDetailWithPartners } from '../../../../app/(modules)/sales/sale-order-record';
import { OrderHandoffLinks } from '../../../../components/order-handoff-links';
import type { RowValueMap } from '@lumiere/erp-workflows';

function Fixture() {
  const { t } = useTranslation();
  const search = useSearchParams();
  const baseline = search.get('baseline') === '1';
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [tab, setTab] = useState('overview');
  const [state, setState] = useState('Draft');
  const [signedBy, setSignedBy] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [ready, setReady] = useState(true);
  const [lines, setLines] = useState<RowValueMap[]>([{ id: '1', name: 'Annual service', productId: '1', uomId: '1', productUomQty: 1, priceUnit: 100, priceSubtotal: 100, priceTax: 10, discount: 0 }]);
  const order = { id: '12', partnerId: '3', reference: 'QUO/2026/0012', state, signedBy, amountUntaxed: 100, amountTax: 10, amountTotal: 110, invoicePolicy: 'order' };
  const status = saleOrderStatusBar(order, t);
  const step = saleOrderNextStep(order, lines, ready);
  const labels: Partial<Record<typeof step, string>> = { send: 'Send quotation', accept: 'Record acceptance', confirm: 'Confirm order', invoice: 'Create invoice' };
  const next = <SaleOrderNextAction step={step} actionLabel={labels[step]} blockedReason={blocked ? 'Credit approval is required before continuing.' : undefined} onContinue={step === 'unavailable' ? undefined : () => {
    if (step === 'send') setState('Sent');
    else if (step === 'accept') setSignedBy('Customer');
    else if (step === 'confirm') setState('Sale');
    else if (step === 'add-products') setTab('lines');
  }} />;
  const grid = ready ? <SaleOrderLineGrid lines={lines} products={[{ id: '1', label: 'Annual service', uomId: '1', listPrice: 100 }]} editable={state === 'Draft' || state === 'Sent'}
    onUpdateLine={async (id, patch) => setLines((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))}
    onCreateLine={async (line) => setLines((rows) => [...rows, { id: String(rows.length + 1), ...line, name: 'Annual service', productUomQty: line.quantity }])}
    onDeleteLine={async (id) => setLines((rows) => rows.filter((row) => row.id !== id))} />
    : <p role="status">Order lines are unavailable. Wait for loading to finish or refresh to try again.</p>;
  const handoffs = <OrderHandoffLinks testIdPrefix="sale-order-handoff" handoffs={{ pickings: [{ id: 7n, name: 'Delivery #7', state: 'waiting' }], invoices: [] }} />;
  const details = <EntityDetail config={saleOrderDetailWithPartners(t, new Map([['3', 'Acme Ltd']]))} data={order} />;
  return <ThemeProvider defaultTheme="light"><main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <p className="text-xs text-muted-foreground" data-testid="sales-fixture" data-hydrated={hydrated}>Synthetic sales fixture. Actions update local state; no backend operations.</p>
    <div className="flex flex-wrap gap-2" aria-label="Synthetic scenarios">
      <Button variant="outline" onClick={() => setLines([])}>Empty quotation</Button>
      <Button variant="outline" onClick={() => setReady(false)}>Unreadable lines</Button>
      <Button variant="outline" onClick={() => setBlocked((value) => !value)}>Toggle blocker</Button>
    </div>
    <RecordPage testIdPrefix="sale-order" breadcrumbs={[{ label: 'Sales', href: '/sales' }, { label: 'Quotations & orders' }, { label: order.reference }]}
      title={order.reference} subtitle="Acme Ltd" statusBar={<StatusBar {...status} />}
      actions={baseline ? <div className="flex flex-wrap gap-2"><Button>Confirm</Button><Button>Send quotation</Button><Button variant="outline">Edit order</Button></div> : <Button variant="outline">Edit order</Button>}
      smartButtons={baseline ? undefined : next} activeTab={tab} onTabChange={setTab}
      tabs={[
        { id: 'overview', label: 'Overview', content: baseline ? details : <SaleOrderWorkspace nextAction={null} totals={[{ label: 'Subtotal', value: '$100.00' }, { label: 'Tax', value: '$10.00' }, { label: 'Total', value: '$110.00' }]} lines={grid} handoffs={handoffs} details={details} /> },
        { id: 'lines', label: 'Order lines', content: grid },
        { id: 'handoffs', label: 'Deliveries & invoices', content: handoffs },
      ]} />
  </main></ThemeProvider>;
}

export default function SalesWorkflowFixture() { return <I18nProvider language="en"><RBACProvider useDefaultFixtures><CurrencyFormatProvider defaultCode="USD"><Fixture /></CurrencyFormatProvider></RBACProvider></I18nProvider>; }
