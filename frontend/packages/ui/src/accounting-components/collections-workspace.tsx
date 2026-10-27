'use client';

import { useState } from 'react';
import type { AccountMove } from '../lib/accounting-types';
import { stbEnumTag } from '../lib/accounting-move-utils';
import type { ModuleDataState } from '../lib/module-data-state';
import { Button } from '../components/button';
import { Input } from '../components/input';
import { ModuleDataNotice } from '../pages/module-data-notice';
import { formatInvoiceMoney } from './invoice-document';
import { accountingCurrencySummaries, accountingListMoney, type AccountingListCurrencyOption } from './accounting-list-display';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select"

export type CollectionsAge = 'all' | '1-30' | '31-60' | '61-90' | '90+';
export interface CollectionInvoice { invoice: AccountMove; daysOverdue: number; dueDate: string; age: Exclude<CollectionsAge, 'all'> }
export interface CollectionsScope { organizationId: bigint | number | string; companyId: bigint | number | string }

/** Only canonical scoped, posted customer invoices with a usable residual and due date are actionable. */
export function collectionInvoices(invoices: readonly AccountMove[], scope: CollectionsScope, now = new Date()): CollectionInvoice[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return invoices.flatMap((invoice): CollectionInvoice[] => {
    if (String(invoice.organizationId ?? '') !== String(scope.organizationId) || String(invoice.companyId ?? '') !== String(scope.companyId)
      || stbEnumTag(invoice.state) !== 'Posted' || stbEnumTag(invoice.moveType) !== 'OutInvoice'
      || typeof invoice.amountResidual !== 'number' || !Number.isFinite(invoice.amountResidual) || invoice.amountResidual <= 0) return [];
    const raw = invoice.invoiceDateDue?.microsSinceUnixEpoch;
    if (raw === undefined || raw === null) return [];
    let due: Date;
    try { const micros = BigInt(raw); if (micros === 0n) return []; due = new Date(Number(micros / 1000n)); } catch { return []; }
    if (!Number.isFinite(due.getTime())) return [];
    const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
    const daysOverdue = Math.floor((today - dueDay) / 86_400_000);
    if (daysOverdue <= 0) return [];
    return [{ invoice, daysOverdue, dueDate: due.toISOString().slice(0, 10), age: daysOverdue <= 30 ? '1-30' : daysOverdue <= 60 ? '31-60' : daysOverdue <= 90 ? '61-90' : '90+' }];
  }).sort((left, right) => right.daysOverdue - left.daysOverdue || String(left.invoice.id).localeCompare(String(right.invoice.id)));
}

export interface CollectionsWorkspaceProps {
  invoices: readonly AccountMove[];
  scope: CollectionsScope;
  currencyOptions?: readonly AccountingListCurrencyOption[];
  dataState: ModuleDataState;
  canReview: boolean;
  onReviewReminder: (invoice: AccountMove) => void;
  now?: Date;
}

/** A collection action always enters the exact invoice's reviewed single-message queue flow. */
export function CollectionsWorkspace({ invoices, scope, currencyOptions = [], dataState, canReview, onReviewReminder, now }: CollectionsWorkspaceProps) {
  const [search, setSearch] = useState('');
  const [age, setAge] = useState<CollectionsAge>('all');
  const ready = dataState.status === 'ready';
  // Stale data cannot supply collection actions or imply that the collection list is complete.
  const rows = ready ? collectionInvoices(invoices, scope, now) : [];
  const visible = rows.filter((row) => (age === 'all' || row.age === age)
    && `${row.invoice.name ?? ''} ${row.invoice.invoicePartnerDisplayName ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const summaries = accountingCurrencySummaries(visible.map((row) => row.invoice), currencyOptions);
  return <section className="space-y-4" aria-label="Collections workspace">
    <div><h2 className="text-lg font-semibold">Collections</h2><p className="mt-1 text-sm text-muted-foreground">Review overdue customer invoices and prepare one reminder at a time. Each reminder requires a recipient and an exact message review before queueing.</p></div>
    <ModuleDataNotice state={dataState} />
    {dataState.status === 'loading' ? <p role="status">Loading overdue invoices…</p> : null}
    {ready ? <>
      <div className="flex flex-wrap gap-3"><Input aria-label="Search collections" placeholder="Search invoice or customer" className="min-h-11 sm:max-w-sm" value={search} onChange={(event) => setSearch(event.target.value)} /><Select
        value={String(age ?? "")}
        onValueChange={(nextValue) => setAge(nextValue as CollectionsAge)}
      >
        {" "}
        <SelectTrigger
          aria-label="Days overdue"
          className="min-h-11 rounded-md border bg-background px-3 text-sm"
        >
          <SelectValue />
        </SelectTrigger>{" "}
        <SelectContent>
          <SelectItem value={"all"}>All overdue</SelectItem>
          <SelectItem value={"1-30"}>1–30 days</SelectItem>
          <SelectItem value={"31-60"}>31–60 days</SelectItem>
          <SelectItem value={"61-90"}>61–90 days</SelectItem>
          <SelectItem value={"90+"}>Over 90 days</SelectItem>
        </SelectContent>{" "}
      </Select></div>
      <div className="flex flex-wrap gap-3" aria-label="Overdue balance by currency">{summaries.map((group) => <div key={group.key} className="rounded-lg border p-3 text-sm"><p className="text-muted-foreground">{group.label}</p><p className="mt-1 font-medium">{group.residual === null ? 'Balance unavailable' : formatInvoiceMoney(group.residual, group.currency)} outstanding</p></div>)}</div>
      <p className="text-sm text-muted-foreground">{visible.length} overdue invoice{visible.length === 1 ? '' : 's'}. Balances remain separate by currency.</p>
      {!canReview ? <p role="status" className="text-sm">Invoice and email review access is required to prepare reminders.</p> : null}
      {visible.length === 0 ? <p className="rounded-lg border p-5 text-sm">No overdue invoices match this view.</p> : <ul className="space-y-3">{visible.map(({ invoice, daysOverdue, dueDate }) => <li key={String(invoice.id)} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"><div className="min-w-0"><p className="font-medium break-words">{invoice.name || `Invoice #${invoice.id}`}</p><p className="break-words text-sm text-muted-foreground">{invoice.invoicePartnerDisplayName || 'Customer unavailable'}</p><p className="mt-1 text-sm">Due {dueDate} · {daysOverdue} day{daysOverdue === 1 ? '' : 's'} overdue · {accountingListMoney(invoice.amountResidual, invoice, currencyOptions)} outstanding</p></div><Button variant="outline" className="min-h-11" disabled={!canReview} onClick={() => onReviewReminder(invoice)}>Review reminder<span className="sr-only"> for {invoice.name || `invoice ${invoice.id}`}</span></Button></li>)}</ul>}
    </> : null}
  </section>;
}
