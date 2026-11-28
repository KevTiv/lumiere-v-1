'use client';

import { useTranslation } from '@lumiere/i18n';
import { Button } from '@lumiere/ui';
import type { WarehouseSetupStatus } from './warehouse-setup';

export function WarehouseSetupNotice({ status, canManage, canCreateLocation, needsCustomerLocation, onLocations, onRetry }: {
  status: WarehouseSetupStatus;
  canManage: boolean;
  canCreateLocation?: boolean;
  needsCustomerLocation?: boolean;
  onLocations?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  if (status === 'ready' && !needsCustomerLocation) return null;
  const needsLocation = status === 'locations-required' || needsCustomerLocation;
  return (
    <section role="status" aria-live="polite" className="mx-4 mt-4 rounded-lg border border-border bg-muted/30 p-4" data-testid="warehouse-setup-notice">
      <h2 className="text-sm font-semibold">{t('inventory.warehouseSetup.title')}</h2>
      {status !== 'ready' && <p className="mt-1 text-sm text-muted-foreground">{t(`inventory.warehouseSetup.${status}`)}</p>}
      {status === 'assisted-setup' && canManage && <p className="mt-1 text-sm text-muted-foreground">{t('inventory.warehouseSetup.managerNext')}</p>}
      {(status === 'first-warehouse' || status === 'assisted-setup') && !canManage && (
        <p className="mt-1 text-sm text-muted-foreground">{t('inventory.warehouseSetup.operatorNext')}</p>
      )}
      {needsCustomerLocation && <p className="mt-1 text-sm text-muted-foreground">{t('inventory.warehouseSetup.customerLocation')}</p>}
      {needsLocation && !canCreateLocation && <p className="mt-1 text-sm text-muted-foreground">{t('inventory.warehouseSetup.locationPermission')}</p>}
      {needsLocation && onLocations && <Button variant="outline" size="sm" className="mt-3" onClick={onLocations}>{t('inventory.warehouseSetup.locations')}</Button>}
      {status === 'unavailable' && onRetry && <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>{t('common.retry')}</Button>}
    </section>
  );
}
