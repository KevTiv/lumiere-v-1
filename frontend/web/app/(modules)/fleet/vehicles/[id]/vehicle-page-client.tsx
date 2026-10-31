'use client';

import { useCallback, useMemo, useState } from 'react';
import { useErpSession } from '@lumiere/erp-session';
import Link from 'next/link';
import { RecordHeaderActions } from '../../../../../components/record-header-actions';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ClipboardCheck, Wrench } from 'lucide-react';
import { useTranslation } from '@lumiere/i18n';
import {
  Button,
  EntityDetail,
  EntityView,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  FormModal,
  MissingOrganization,
  RecordAuditTab,
  RecordChatter,
  RecordPage,
  SmartButtons,
  assignFleetDriverForm,
  buildModuleTabHref,
  fleetInspectionsTableConfig,
  fleetServiceRecordsTableConfig,
  fleetVehiclesTableConfig,
  mergeFieldDefaultValues,
  recordFleetInspectionForm,
  recordFleetServiceForm,
  type FormConfig,
} from '@lumiere/ui';
import { Badge } from '@lumiere/ui/components/badge';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import { ModuleDataNotice } from '@lumiere/ui/pages/module-data-notice';
import { canUseModuleData } from '@lumiere/ui/lib/module-data-state';
import { useRBAC } from '@lumiere/ui/lib/rbac-context';
import type { FleetVehicle } from '@lumiere/stdb/types';
import { accountAccountRowsToSelectOptions, accountJournalRowsToSelectOptions } from '@/lib/form-lookup';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { useFleetModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId } from '@/lib/org-scoped';
import { VehicleLocationMap } from './vehicle-location-map';
import { useFleetActions } from '../../fleet-actions';
import { fleetEnumTag, rowsOfVehicle } from '../../fleet-record';
import { useFleetWorkspace } from '../../use-fleet-workspace';
import { FleetRecoveryNotice } from '../../fleet-recovery-notice';
import { FleetServiceSetupNotice } from '../../fleet-service-setup-notice';

interface VehiclePageClientProps {
  vehicleId: string;
  initialVehicles?: FleetVehicle[];
  organizationId?: number;
}

type Row = Record<string, unknown>;
type FormKind = 'assign' | 'service' | 'inspection';

const TAB_IDS = ['overview', 'service', 'inspections', 'discussion', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

export function VehiclePageClient(props: VehiclePageClientProps) {
  const { identity, activeCompanyId, activeCompanyReady } = useErpSession();
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <VehiclePageLoaded key={`${identity}:${props.organizationId}:${activeCompanyReady}:${activeCompanyId}:${props.vehicleId}`} {...props} organizationId={props.organizationId} />;
}

function VehiclePageLoaded({
  vehicleId,
  initialVehicles,
  organizationId,
}: VehiclePageClientProps & { organizationId: number }) {
  useFleetModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspace = useFleetWorkspace(organizationId, initialVehicles);
  const { orgId, company, vehicles, serviceRecords, inspections, activeServiceTypes: serviceTypes, employeeChoices: employees, journals, accounts } = workspace;
  const fleetActions = useFleetActions(orgId, company, employees.map((row) => String(row.id)));
  const { checkPermission, permissionsReady } = useRBAC();
  const canWrite = permissionsReady !== false && checkPermission('fleet_vehicle', 'write').allowed;

  const [form, setForm] = useState<FormKind | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const vehicle = useMemo(
    () => (vehicles as unknown as Row[]).find((row) => String(row.id) === vehicleId),
    [vehicles, vehicleId],
  );
  const ownService = useMemo(() => rowsOfVehicle(serviceRecords as unknown as Row[], vehicleId), [serviceRecords, vehicleId]);
  const ownInspections = useMemo(() => rowsOfVehicle(inspections as unknown as Row[], vehicleId), [inspections, vehicleId]);

  const navigation = useRecordNavigation<Row>({
    rows: vehicles as unknown as Row[],
    currentId: vehicleId,
    basePath: '/fleet/vehicles',
    labelOf: (row) => String(row.name || row.id),
  });

  const requestedTab = searchParams.get('tab');
  const activeTab: TabId = (TAB_IDS as readonly string[]).includes(requestedTab ?? '')
    ? (requestedTab as TabId)
    : 'overview';
  const setActiveTab = useCallback(
    (tab: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (tab === 'overview') next.delete('tab');
      else next.set('tab', tab);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  if (workspace.scopeState.status !== 'ready') return workspace.scopeState.status === 'loading'
    ? <p role="status">{t('common.loading', { defaultValue: 'Loading…' })}</p>
    : <ModuleDataNotice state={workspace.scopeState} />;
  if (!canUseModuleData(workspace.states.vehicles)) return <ModuleDataNotice state={workspace.states.vehicles} />;

  if (!vehicle) {
    if (workspace.states.vehicles.status === 'partial') return <ModuleDataNotice state={workspace.states.vehicles} />;
    if (workspace.states.vehicles.status === 'loading') {
      return (
        <div className="space-y-4" data-testid="vehicle-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-full max-w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="vehicle-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('fleet.page.notFound', { defaultValue: 'Vehicle not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('fleet.page.notFoundHint', { defaultValue: 'It may have been deleted, or belong to another company.' })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('fleet', 'fleet-vehicles')} />} nativeButton={false}>
            {t('fleet.page.backToVehicles', { defaultValue: 'Back to vehicles' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const id = BigInt(vehicleId);
  const label = String(vehicle.name || '').trim() || `#${vehicleId}`;
  const status = fleetEnumTag(vehicle.status).toLowerCase();
  const subtitle = [vehicle.license_plate, vehicle.vehicle_type, vehicle.driver_name]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' · ');

  const option = (rows: unknown[], fallback: string) =>
    (rows as Row[]).map((row) => ({ value: String(row.id), label: String(row.name ?? row.display_name ?? row.displayName ?? `${fallback} ${row.id}`) }));
  const thisVehicle = [{ value: vehicleId, label }];
  const forms: Record<FormKind, FormConfig> = {
    assign: mergeFieldDefaultValues(assignFleetDriverForm(t, thisVehicle, option(employees as unknown[], 'Employee')), {
      vehicle_id: vehicleId,
    }),
    service: mergeFieldDefaultValues(
      recordFleetServiceForm(
        t,
        thisVehicle,
        option(serviceTypes as unknown[], 'Service type'),
        accountJournalRowsToSelectOptions(journals as unknown as Row[]),
        accountAccountRowsToSelectOptions(accounts as unknown as Row[]),
      ),
      { vehicle_id: vehicleId },
    ),
    inspection: mergeFieldDefaultValues(recordFleetInspectionForm(t, thisVehicle, option(employees as unknown[], 'Employee')), {
      vehicle_id: vehicleId,
    }),
  };
  const formAction: Record<FormKind, string> = {
    assign: 'assignFleetDriver',
    service: 'recordFleetService',
    inspection: 'recordFleetInspection',
  };

  const table = fleetVehiclesTableConfig(t);
  const columns = table.view.mode === 'table' ? table.view.columns : [];
  const detailConfig = {
    mode: 'detail' as const,
    sections: [{ id: 'vehicle', fields: columns.filter((column) => column.key !== 'id').map(({ width: _width, ...field }) => field) }],
  };

  return (
    <>
      <ModuleDataNotice state={workspace.states.vehicles} />
      <FleetRecoveryNotice key={`${organizationId}:${company}`} actions={fleetActions} />
      {activeTab === 'service' && canWrite ? <FleetServiceSetupNotice workspace={workspace} /> : null}
      <RecordPage
        testIdPrefix="vehicle"
        breadcrumbs={[
          { label: t('nav.fleet', { defaultValue: 'Fleet' }), href: '/fleet' },
          { label: t('fleet.subtitle'), href: buildModuleTabHref('fleet', 'fleet-vehicles') },
          { label },
        ]}
        title={label}
        subtitle={subtitle || undefined}
        badge={status ? <Badge variant="secondary">{status}</Badge> : undefined}
        navigation={navigation}
        smartButtons={
          <SmartButtons
            testIdPrefix="vehicle"
            buttons={[
              ...(workspace.states.service.status === 'ready' ? [{
                id: 'service',
                label: t('fleet.lifecycle.service.title'),
                count: ownService.length,
                icon: <Wrench className="h-4 w-4" />,
                onClick: () => setActiveTab('service'),
              }] : []),
              ...(workspace.states.inspections.status === 'ready' ? [{
                id: 'inspections',
                label: t('fleet.lifecycle.inspections.title'),
                count: ownInspections.length,
                icon: <ClipboardCheck className="h-4 w-4" />,
                onClick: () => setActiveTab('inspections'),
              }] : []),
            ]}
          />
        }
        actions={
          <>
            {workspace.states.vehicles.status === 'ready' ? <RecordHeaderActions key={`${company}:${vehicleId}`} model="vehicle" record={vehicle} organizationId={orgId} companyId={company} /> : null}
            {canWrite ? <Button size="sm" disabled={!workspace.serviceReady || fleetActions.isPending} data-testid="vehicle-action-service" onClick={() => setForm('service')}>
              {t('fleet.lifecycle.service.action')}
            </Button> : null}
            {canWrite ? <Button variant="outline" size="sm" disabled={!workspace.inspectionReady || fleetActions.isPending} data-testid="vehicle-action-inspection" onClick={() => setForm('inspection')}>
              {t('fleet.lifecycle.inspections.action')}
            </Button> : null}
            {canWrite ? <Button variant="outline" size="sm" disabled={!workspace.assignmentReady || fleetActions.isPending} data-testid="vehicle-action-assign" onClick={() => setForm('assign')}>
              {t('fleet.lifecycle.assignments.action')}
            </Button> : null}
          </>
        }
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'overview',
            label: t('common.overview', { defaultValue: 'Overview' }),
            content: (
              <div className="space-y-6">
                <EntityDetail config={detailConfig} data={vehicle} />
                <VehicleLocationMap vehicle={vehicle as unknown as Row} />
              </div>
            ),
          },
          {
            id: 'service',
            label: t('fleet.lifecycle.service.title'),
            content: (
              <>
                <ModuleDataNotice state={workspace.states.service} />
                {canUseModuleData(workspace.states.service) ? <EntityView config={{ ...fleetServiceRecordsTableConfig(t), title: '', description: undefined }} data={ownService} isLoading={workspace.states.service.status === 'loading'} useCard={false} /> : null}
              </>
            ),
          },
          {
            id: 'inspections',
            label: t('fleet.lifecycle.inspections.title'),
            content: (
              <>
                <ModuleDataNotice state={workspace.states.inspections} />
                {canUseModuleData(workspace.states.inspections) ? <EntityView config={{ ...fleetInspectionsTableConfig(t), title: '', description: undefined }} data={ownInspections} isLoading={workspace.states.inspections.status === 'loading'} useCard={false} /> : null}
              </>
            ),
          },
          {
            id: 'discussion',
            label: t('fleet.page.discussion', { defaultValue: 'Discussion' }),
            content: (
              <div className="max-w-2xl" data-testid="vehicle-discussion">
                <RecordChatter organizationId={organizationId} resModel="fleet_vehicle" resId={id} recordTitle={label} />
              </div>
            ),
          },
          {
            id: 'audit',
            label: t('common.audit', { defaultValue: 'Audit' }),
            content: <RecordAuditTab tableName="fleet_vehicle" recordId={vehicleId} />,
          },
        ]}
      />

      {form && canWrite && workspace.states.vehicles.status === 'ready' && (form === 'service' ? workspace.serviceReady : form === 'inspection' ? workspace.inspectionReady : workspace.assignmentReady) ? (
        <FormModal
          key={`${company}:${vehicleId}:${form}`}
          open
          onOpenChange={(open) => {
            if (!open) {
              setForm(null);
              setFormError(null);
            }
          }}
          config={forms[form]}
          isPending={fleetActions.isPending}
          closeOnSubmit={false}
          submitError={formError}
          onSubmit={async (formData) => {
            setFormError(null);
            try {
              await fleetActions.submit(formAction[form], formData);
              showWorkflowToast({ kind: 'success', title: forms[form].title, description: label });
              setForm(null);
            } catch (error) {
              setFormError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
      ) : null}
    </>
  );
}
