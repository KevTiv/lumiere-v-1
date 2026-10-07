'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@lumiere/i18n';
import {
  Button,
  EntityDetail,
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
  StatusBar,
  buildModuleTabHref,
  mergeFieldDefaultValues,
  mergeSelectOptionsForFields,
  posFormConfigs,
  type FormConfig,
} from '@lumiere/ui';
import { Badge } from '@lumiere/ui/components/badge';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import {
  useClosePosSession,
  useComputePosSessionTotals,
  useOpenPosSession,
  usePosConfigs,
  usePosSessions,
} from '@lumiere/query-hooks/hooks/pos';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import type { PosConfig, PosSession } from '@lumiere/stdb/types';
import { usePosModuleSubscription } from '@/lib/module-subscription-hooks';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { cashDifference, isPosSessionOpen, posSessionStatusBar } from '../../pos-session';

interface PosSessionPageClientProps {
  sessionId: string;
  initialSessions?: PosSession[];
  initialConfigs?: PosConfig[];
  organizationId?: number;
}

type Row = Record<string, unknown>;

const TAB_IDS = ['overview', 'discussion', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

export function PosSessionPageClient(props: PosSessionPageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <PosSessionPageLoaded {...props} organizationId={props.organizationId} />;
}

function PosSessionPageLoaded({
  sessionId,
  initialSessions,
  initialConfigs,
  organizationId,
}: PosSessionPageClientProps & { organizationId: number }) {
  usePosModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { orgId } = orgBigInts(organizationId);
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? undefined;

  const { data: sessions = [], isLoading } = usePosSessions(orgId, initialSessions);
  const { data: configs = [] } = usePosConfigs(orgId, initialConfigs);
  const closeSession = useClosePosSession(orgId, operatingCompanyId);
  const computeTotals = useComputePosSessionTotals(orgId);
  const openSession = useOpenPosSession(orgId);

  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const session = useMemo(
    () => (sessions as unknown as Row[]).find((row) => String(row.id) === sessionId),
    [sessions, sessionId],
  );
  const configName = useMemo(() => {
    const id = String(session?.configId ?? session?.config_id ?? '');
    const config = (configs as unknown as Row[]).find((row) => String(row.id) === id);
    return config ? String(config.name ?? id) : id;
  }, [configs, session]);

  const navigation = useRecordNavigation<Row>({
    rows: sessions as unknown as Row[],
    currentId: sessionId,
    basePath: '/pos/sessions',
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

  if (!session) {
    if (isLoading) {
      return (
        <div className="space-y-4" data-testid="pos-session-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="pos-session-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('pos.session.notFound', { defaultValue: 'Session not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('pos.session.notFoundHint', { defaultValue: 'It may have been deleted, or belong to another organization.' })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('pos', 'admin')} />} nativeButton={false}>
            {t('pos.session.backToSessions', { defaultValue: 'Back to sessions' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const id = BigInt(sessionId);
  const label = String(session.name || '').trim() || `#${sessionId}`;
  const status = posSessionStatusBar(session, t);
  const open = isPosSessionOpen(session);
  const difference = cashDifference(session);

  const closeForm: FormConfig = {
    id: 'pos-close-session-page',
    title: t('pos.admin.forms.closeSession.title'),
    submitLabel: t('pos.admin.forms.closeSession.submit'),
    sections: [
      {
        id: 'session',
        fields: [
          { id: 'closing-balance', type: 'number', name: 'closingBalance', label: t('pos.admin.forms.fields.closingBalance'), width: 'full' },
        ],
      },
    ],
  };

  const configId = String(session.configId ?? session.config_id ?? '');
  const openForm: FormConfig = mergeFieldDefaultValues(
    mergeSelectOptionsForFields(posFormConfigs(t).openSession, {
      configId: [{ value: configId, label: configName || configId }],
    }),
    { configId },
  );

  const detailConfig = {
    mode: 'detail' as const,
    sections: [
      {
        id: 'session',
        fields: [
          { key: 'configName', label: t('pos.admin.sessions.columns.configId') },
          { key: 'state', label: t('pos.admin.sessions.columns.state') },
          { key: 'orderCount', label: t('pos.admin.sessions.columns.orderCount'), type: 'number' as const },
          { key: 'startAt', label: t('pos.session.startAt', { defaultValue: 'Opened' }), type: 'datetime' as const },
          { key: 'stopAt', label: t('pos.session.stopAt', { defaultValue: 'Closed' }), type: 'datetime' as const },
          { key: 'cashRegisterBalanceStart', label: t('pos.session.cashStart', { defaultValue: 'Opening cash' }), type: 'currency' as const },
          { key: 'cashRegisterBalanceEndReal', label: t('pos.session.cashEnd', { defaultValue: 'Counted cash' }), type: 'currency' as const },
          { key: 'cashDifference', label: t('pos.session.cashDifference', { defaultValue: 'Difference' }), type: 'currency' as const },
        ],
      },
    ],
  };

  return (
    <>
      <RecordPage
        testIdPrefix="pos-session"
        breadcrumbs={[
          { label: t('nav.pos', { defaultValue: 'Point of sale' }), href: '/pos' },
          { label: t('pos.admin.sessions.title'), href: buildModuleTabHref('pos', 'admin') },
          { label },
        ]}
        title={label}
        subtitle={configName || undefined}
        badge={<Badge variant={open ? 'default' : 'secondary'}>{status.steps.find((step) => step.id === status.current)?.label ?? ''}</Badge>}
        statusBar={<StatusBar steps={status.steps} current={status.current} />}
        navigation={navigation}
        actions={
          open ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={computeTotals.isPending}
                data-testid="pos-session-compute-totals"
                onClick={() =>
                  void computeTotals.mutateAsync(id).catch((error: unknown) =>
                    showWorkflowToast({
                      kind: 'error',
                      title: t('pos.admin.forms.computeTotals.title'),
                      description: error instanceof Error ? error.message : String(error),
                    }),
                  )
                }
              >
                {t('pos.admin.forms.computeTotals.title')}
              </Button>
              <Button size="sm" data-testid="pos-session-close" onClick={() => setClosing(true)}>
                {t('pos.admin.forms.closeSession.title')}
              </Button>
            </>
          ) : configId ? (
            <Button variant="outline" size="sm" data-testid="pos-session-open-new" onClick={() => setOpening(true)}>
              {t('pos.session.openNew', { defaultValue: 'Open a new session' })}
            </Button>
          ) : undefined
        }
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'overview',
            label: t('common.overview', { defaultValue: 'Overview' }),
            content: <EntityDetail config={detailConfig} data={{ ...session, configName, cashDifference: difference }} />,
          },
          {
            id: 'discussion',
            label: t('pos.session.discussion', { defaultValue: 'Discussion' }),
            content: (
              <div className="max-w-2xl" data-testid="pos-session-discussion">
                <RecordChatter organizationId={organizationId} resModel="pos_session" resId={id} recordTitle={label} />
              </div>
            ),
          },
          {
            id: 'audit',
            label: t('common.audit', { defaultValue: 'Audit' }),
            content: <RecordAuditTab tableName="pos_session" recordId={sessionId} />,
          },
        ]}
      />

      {opening ? (
        <FormModal
          open
          onOpenChange={(next) => {
            if (!next) {
              setOpening(false);
              setOpenError(null);
            }
          }}
          config={openForm}
          isPending={openSession.isPending}
          closeOnSubmit={false}
          submitError={openError}
          onSubmit={async (formData) => {
            setOpenError(null);
            try {
              await openSession.mutateAsync({ configId, openingBalance: Number(formData.openingBalance) || 0 });
              setOpening(false);
            } catch (error) {
              setOpenError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
      ) : null}

      {closing ? (
        <FormModal
          open
          onOpenChange={(next) => {
            if (!next) {
              setClosing(false);
              setCloseError(null);
            }
          }}
          config={closeForm}
          isPending={closeSession.isPending}
          closeOnSubmit={false}
          submitError={closeError}
          onSubmit={async (formData) => {
            setCloseError(null);
            try {
              await closeSession.mutateAsync({ sessionId: id, closingBalance: Number(formData.closingBalance) || 0 });
              setClosing(false);
            } catch (error) {
              setCloseError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
      ) : null}
    </>
  );
}
