'use client';

import { useTranslation } from '@lumiere/i18n';
import { Button } from '@lumiere/ui';
import type { WarehouseSetupStatus } from './warehouse-setup';

export function WarehouseSetupNotice({ status, canManage, onLocations, onRetry }: {
  status: WarehouseSetupStatus;
  canManage: boolean;
  onLocations?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  if (status === 'ready') return null;
  return (
    <section role="status" aria-live="polite" className="mx-4 mt-4 rounded-lg border border-border bg-muted/30 p-4" data-testid="warehouse-setup-notice">
      <h2 className="text-sm font-semibold">{t('inventory.warehouseSetup.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t(`inventory.warehouseSetup.${status}`)}</p>
      {(status === 'locations-required' || status === 'assisted-setup') && (
        <p className="mt-1 text-sm text-muted-foreground">{t(canManage ? 'inventory.warehouseSetup.managerNext' : 'inventory.warehouseSetup.operatorNext')}</p>
      )}
      {status === 'locations-required' && onLocations && <Button variant="outline" size="sm" className="mt-3" onClick={onLocations}>{t('inventory.warehouseSetup.locations')}</Button>}
      {status === 'unavailable' && onRetry && <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>{t('common.retry')}</Button>}
    </section>
  );
}
