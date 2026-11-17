'use client';

import { useTranslation } from '@lumiere/i18n';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../lib/utils';

export type HistoryDiffValue =
  | { kind: 'value'; value: string | null }
  | { kind: 'unavailable' }
  | { kind: 'restricted' }
  | { kind: 'absent' };

export interface HistoryFieldDiffRow {
  id: string;
  label: string;
  before: HistoryDiffValue;
  after: HistoryDiffValue;
}

interface HistoryFieldDiffProps {
  fields: readonly HistoryFieldDiffRow[];
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
  valueTestIdPrefix?: string;
}

interface DiffValueCellProps {
  label: string;
  value: HistoryDiffValue;
  mark: 'added' | 'removed' | null;
  testId?: string;
}

function DiffValueCell({ label, value, mark, testId }: DiffValueCellProps) {
  const { t } = useTranslation();
  let text: string;
  switch (value.kind) {
    case 'value':
      text =
        value.value === ''
          ? t('recordChanges.emptyText')
          : (value.value ?? t('recordChanges.noValue'));
      break;
    case 'absent':
      text = t('recordChanges.valueAbsent', { defaultValue: 'Field absent' });
      break;
    case 'restricted':
      text = t('recordChanges.valueRestricted', { defaultValue: 'Restricted' });
      break;
    case 'unavailable':
      text = t('recordChanges.valueUnavailable', {
        defaultValue: 'Value not recorded',
      });
      break;
  }

  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 px-3 py-2',
        mark === 'added' && 'bg-success/10 dark:bg-success/15',
        mark === 'removed' && 'bg-destructive/10 dark:bg-destructive/15',
      )}
      data-diff-mark={mark ?? undefined}
      data-value-kind={value.kind}
    >
      <div aria-hidden="true" className="mt-0.5">
        {mark === 'added' && <Plus className="size-4 text-success" />}
        {mark === 'removed' && <Minus className="size-4 text-destructive" />}
      </div>
      <div className="min-w-0 space-y-0.5">
        <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {label}
        </span>
        <span
          className={cn(
            'block whitespace-pre-wrap text-sm tabular-nums [overflow-wrap:anywhere]',
            (value.kind !== 'value' ||
              value.value === null ||
              value.value === '') &&
              'text-muted-foreground',
          )}
          data-testid={testId}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

/** Renders captured values without assigning a change to an unavailable side. */
export function HistoryFieldDiff({
  fields,
  beforeLabel,
  afterLabel,
  className,
  valueTestIdPrefix,
}: HistoryFieldDiffProps) {
  const { t } = useTranslation();
  if (!fields.length) return null;
  return (
    <dl
      className={cn(
        '@container/history-diff min-w-0 overflow-hidden rounded-md border border-border divide-y divide-border',
        className,
      )}
      data-testid="history-field-diff"
    >
      {fields.map(({ id, label, before, after }) => {
        const changed =
          before.kind === 'value' &&
          after.kind === 'value' &&
          before.value !== after.value;
        const removed =
          before.kind === 'value' && (changed || after.kind === 'absent');
        const added =
          after.kind === 'value' && (changed || before.kind === 'absent');
        return (
          <div key={id} className="min-w-0">
            <dt className="border-b border-border bg-muted/50 px-3 py-1.5 text-xs font-medium [overflow-wrap:anywhere]">
              {label}
            </dt>
            <dd className="grid min-w-0 grid-cols-1 divide-y divide-border @min-[35rem]/history-diff:grid-cols-2 @min-[35rem]/history-diff:divide-x @min-[35rem]/history-diff:divide-y-0">
              <DiffValueCell
                label={beforeLabel ?? t('recordChanges.beforeThisSave')}
                value={before}
                mark={removed ? 'removed' : null}
                testId={valueTestIdPrefix && `${valueTestIdPrefix}-before`}
              />
              <DiffValueCell
                label={afterLabel ?? t('recordChanges.afterThisSave')}
                value={after}
                mark={added ? 'added' : null}
                testId={valueTestIdPrefix && `${valueTestIdPrefix}-after`}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
