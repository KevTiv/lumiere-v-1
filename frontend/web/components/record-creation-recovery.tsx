'use client';

import { useState } from 'react';
import { useTranslation } from '@lumiere/i18n';
import { Button } from '@lumiere/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@lumiere/ui/components/dialog';
import { useRecordCreationRecovery, type CreationRecoveryAccess } from '@lumiere/query-hooks/hooks/record-creation-recovery';
import type { ConfigurableCreationModel, PendingRecordCreation } from '@lumiere/query-hooks/hooks/record-creation-invocation';
import { moduleTabHref } from '@lumiere/erp-shared/record-links';

function enteredValues(pending: PendingRecordCreation): Array<{ label: string; value: string }> {
  const source: unknown = JSON.parse(pending.payloadJson);
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Retained entries are unavailable');
  const fields: Array<{ label: string; value: string }> = [];
  const append = (key: string, value: unknown) => {
    if (value && typeof value === 'object' && Object.hasOwn(value, 'some')) value = (value as { some: unknown }).some;
    if (value == null || (typeof value === 'object' && Object.hasOwn(value, 'none'))) return;
    const label = key.replace(/^custom:/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    fields.push({ label, value: typeof value === 'string' ? value : JSON.stringify(value) ?? '' });
  };
  for (const [key, value] of Object.entries(source)) {
    if (key === 'metadata') {
      let metadata = value;
      if (metadata && typeof metadata === 'object' && Object.hasOwn(metadata, 'some')) metadata = (metadata as { some: unknown }).some;
      if (typeof metadata === 'string') {
        try {
          const custom: unknown = JSON.parse(metadata);
          if (custom && typeof custom === 'object' && !Array.isArray(custom)) for (const [name, entry] of Object.entries(custom)) if (!name.startsWith('__')) append(name, entry);
        } catch { append(key, metadata); }
      }
    } else if (!['company_id', 'companyId', 'organization_id', 'organizationId'].includes(key)) append(key, value);
  }
  return fields;
}

export function creationResultHref(model: ConfigurableCreationModel, recordId: string): string {
  if (!/^[1-9]\d*$/.test(recordId)) throw new Error('An exact saved record is required');
  if (model === 'sale_order') return `/sales/orders/${recordId}?tab=lines`;
  const tab = model === 'crm_lead' ? 'leads' : model === 'opportunity' ? 'opportunities' : 'contacts';
  return moduleTabHref('crm', tab, { id: recordId });
}

/** Reviewing a retained save never replaces or closes the user's current form. */
export function RecordCreationRecovery({ organizationId, companyId, models, refreshKey }: {
  organizationId: bigint; companyId: bigint; models: readonly CreationRecoveryAccess[]; refreshKey?: string | number | boolean;
}) {
  const { t } = useTranslation();
  const recovery = useRecordCreationRecovery(organizationId, companyId, models, refreshKey);
  const [selected, setSelected] = useState<{ stamp: string; model: ConfigurableCreationModel; operationKey: string }>();
  const active = selected?.stamp === recovery.scopeStamp ? recovery.items.find((item) => item.model === selected.model && item.pending?.operationKey === selected.operationKey) : undefined;
  let fields: Array<{ label: string; value: string }> = [];
  let invalidEntries = false;
  if (active?.pending) {
    try { fields = enteredValues(active.pending); } catch { invalidEntries = true; }
  }
  if (!recovery.items.length) return null;
  return <section className="mx-4 mb-3 space-y-3 rounded-lg border p-4" aria-label={t('common.creationRecovery.title')} data-testid="record-creation-recovery">
    <h2 className="font-medium">{t('common.creationRecovery.title')}</h2>
    <p className="text-sm text-muted-foreground">{t('common.creationRecovery.hint')}</p>
    {recovery.items.map((item) => <div key={item.model} className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <p className="text-sm">{t(`common.creationRecovery.models.${item.model}`)} · {t(`common.creationRecovery.status.${item.status}`)}</p>
      <div className="flex flex-wrap gap-2">
        {item.pending && <Button type="button" variant="outline" disabled={recovery.busy} onClick={() => setSelected({ stamp: recovery.scopeStamp, model: item.model, operationKey: item.pending!.operationKey })}>{t('common.creationRecovery.review')}</Button>}
        <Button type="button" variant="outline" disabled={recovery.busy} onClick={() => { void recovery.check(item.model); }}>{t('common.creationRecovery.check')}</Button>
      </div>
    </div>)}
    <Dialog open={Boolean(active?.pending)} onOpenChange={(open) => { if (!open) setSelected(undefined); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" data-testid="record-creation-review">
        <DialogHeader><DialogTitle>{t('common.creationRecovery.review')}</DialogTitle><DialogDescription>{t('common.creationRecovery.reviewHint')}</DialogDescription></DialogHeader>
        {active && <>
          <p className="font-medium">{t(`common.creationRecovery.models.${active.model}`)}</p>
          <p role="status" className="text-sm">{t(`common.creationRecovery.status.${active.status}`)}</p>
          {invalidEntries ? <p role="alert">{t('common.creationRecovery.entriesUnavailable')}</p> : <dl className="space-y-3 text-sm">{fields.map((field, index) => <div key={`${field.label}:${index}`}><dt className="capitalize text-muted-foreground">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{field.value === '' ? t('common.creationRecovery.emptyValue') : field.value}</dd></div>)}</dl>}
          {active.recordId && <a href={creationResultHref(active.model, active.recordId)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">{t('common.creationRecovery.openSaved')}</a>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSelected(undefined)}>{t('common.close')}</Button>
            <Button type="button" variant="outline" disabled={recovery.busy} onClick={() => { void recovery.check(active.model); }}>{t('common.creationRecovery.check')}</Button>
            {active.recordId && <Button type="button" disabled={recovery.busy} onClick={() => { void recovery.check(active.model, true, active.pending!.operationKey); }}>{t('common.creationRecovery.finish')}</Button>}
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  </section>;
}
