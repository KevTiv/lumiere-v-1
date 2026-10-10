'use client';

import { useTranslation } from '@lumiere/i18n';
import { EntityView, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@lumiere/ui';
import type { EntityColumn } from '@lumiere/ui';

interface ReadOnlyRowsProps {
  id: string;
  columns: EntityColumn[];
  rows: ReadonlyArray<object>;
  isLoading: boolean;
  error: unknown;
  emptyMessage: string;
  testId?: string;
}

/** Read-only table for a resource read over the authorized HTTP query path: loading, error and empty states. */
export function ReadOnlyRows({ id, columns, rows, isLoading, error, emptyMessage, testId }: ReadOnlyRowsProps) {
  const { t } = useTranslation();
  if (error && !isLoading) {
    return (
      <Empty data-testid={testId ? `${testId}-error` : undefined}>
        <EmptyHeader>
          <EmptyTitle>{t('common.loadFailed', { defaultValue: 'Could not load this list' })}</EmptyTitle>
          <EmptyDescription>
            {error instanceof Error && error.message
              ? error.message
              : t('common.loadFailedHint', { defaultValue: 'Try again in a moment.' })}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div data-testid={testId}>
      <EntityView
        config={{
          id,
          title: '',
          view: { mode: 'table', rowKey: 'id', columns, emptyMessage },
        }}
        data={rows as Record<string, unknown>[]}
        useCard={false}
        isLoading={isLoading}
      />
    </div>
  );
}
