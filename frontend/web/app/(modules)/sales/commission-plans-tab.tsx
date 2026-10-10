'use client';

import { useMemo } from 'react';
import { useTranslation } from '@lumiere/i18n';
import { useSaleCommissionPlanSplits, useSaleCommissionPlans } from '@lumiere/query-hooks/hooks/sales';
import { ReadOnlyRows } from '../../../components/read-only-rows';
import { commissionPlanRows, commissionSplitListRows } from './commission-plans';

type Row = Record<string, unknown>;

/** Read-only list of commission plans, with their splits in a second table. */
export function CommissionPlansTab({
  orgId,
  partnerNameById,
}: {
  orgId: bigint;
  partnerNameById: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation();
  const plans = useSaleCommissionPlans(orgId);
  const splits = useSaleCommissionPlanSplits(orgId);
  const planRows = useMemo(
    () => commissionPlanRows((plans.data ?? []) as Row[], (splits.data ?? []) as Row[], partnerNameById),
    [plans.data, splits.data, partnerNameById],
  );
  const splitRows = useMemo(() => commissionSplitListRows(planRows), [planRows]);
  return (
    <div className="space-y-6" data-testid="sales-commission-plans">
      <ReadOnlyRows
        id="sale-commission-plans-read"
        testId="sales-commission-plans-table"
        isLoading={plans.isLoading || splits.isLoading}
        error={plans.error ?? splits.error}
        rows={planRows}
        emptyMessage={t('sales.commissionPlans.empty', { defaultValue: 'No commission plans yet.' })}
        columns={[
          { key: 'name', label: t('sales.commissionPlans.name', { defaultValue: 'Plan' }), width: 'min-w-48' },
          { key: 'isActive', label: t('sales.commissionPlans.active', { defaultValue: 'Active' }), type: 'boolean' },
          { key: 'defaultRatePercent', label: t('sales.commissionPlans.defaultRate', { defaultValue: 'Default rate %' }), type: 'number', align: 'right' },
          { key: 'splitCount', label: t('sales.commissionPlans.splitCount', { defaultValue: 'Splits' }), type: 'number', align: 'right' },
          { key: 'splitTotalPercent', label: t('sales.commissionPlans.splitTotal', { defaultValue: 'Total share %' }), type: 'number', align: 'right' },
        ]}
      />
      {splitRows.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('sales.commissionPlans.splitsTitle', { defaultValue: 'Commission splits' })}</h3>
          <ReadOnlyRows
            id="sale-commission-plan-splits-read"
            testId="sales-commission-splits-table"
            isLoading={false}
            error={null}
            rows={splitRows}
            emptyMessage=""
            columns={[
              { key: 'plan', label: t('sales.commissionPlans.name', { defaultValue: 'Plan' }), width: 'min-w-48' },
              { key: 'partner', label: t('sales.commissionPlans.partner', { defaultValue: 'Partner' }), width: 'min-w-40' },
              { key: 'sharePercent', label: t('sales.commissionPlans.share', { defaultValue: 'Share %' }), type: 'number', align: 'right' },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
