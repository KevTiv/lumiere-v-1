'use client';

import { useState } from 'react';
import { useTranslation } from '@lumiere/i18n';
import type { BlockSerialInput } from '@lumiere/erp-workflows';
import type { TFunction } from 'i18next';
import { blockSerialForm, Button, FormModal, formText } from '@lumiere/ui';
import type { EntityDetailConfig, FormConfig } from '@lumiere/ui';
import {
  formatTimestampLike,
  getRowField,
  humanizeEnumValue,
  unwrapEntityValue,
} from '@lumiere/ui/lib/entity-row-values';

/** Retain the existing tracking fields and labels when moving details to a record sheet. */
export function trackingDetailConfig(
  config: FormConfig,
  t: TFunction,
): EntityDetailConfig {
  return {
    mode: 'detail',
    sections: config.sections.map((section) => ({
      id: section.id,
      title: section.title,
      fields: section.fields.map((field) => ({
        key: field.name,
        label: field.label,
        width: field.width,
        render: (_value, record) => {
          const key =
            field.name === 'productId'
              ? 'warehouseProductName'
              : field.name === 'locationId'
                ? 'warehouseLocationName'
                : field.name;
          const raw = unwrapEntityValue(getRowField(record, key));
          if (field.name === 'expirationDate') {
            return formatTimestampLike(raw)?.toLocaleDateString() ?? '—';
          }
          if (typeof raw === 'boolean')
            return t(raw ? 'common.yes' : 'common.no');
          if (
            typeof raw !== 'string' &&
            typeof raw !== 'number' &&
            typeof raw !== 'bigint'
          )
            return '—';
          if (field.name === 'state') return humanizeEnumValue(String(raw));
          return field.name === 'note' ? (
            <span className="whitespace-pre-wrap">{String(raw) || '—'}</span>
          ) : (
            String(raw) || '—'
          );
        },
      })),
    })),
  };
}

export function SerialBlockRecordAction({
  serialId,
  pending,
  block,
  closeRecord,
}: {
  serialId: string;
  pending: boolean;
  block: (input: BlockSerialInput) => Promise<unknown>;
  closeRecord: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        aria-haspopup="dialog"
        data-testid="serial-detail-block-button"
        onClick={() => setOpen(true)}
      >
        {t('inventory.serialActions.block')}
      </Button>
      <FormModal
        open={open}
        onOpenChange={setOpen}
        config={blockSerialForm(t)}
        isPending={pending}
        draft={false}
        onSubmit={async (data) => {
          await block({ serialId, reason: formText(data.reason) });
          closeRecord();
        }}
      />
    </>
  );
}
