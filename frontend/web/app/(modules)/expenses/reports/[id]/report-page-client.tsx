'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { FinanceReviewWorkspace } from '@lumiere/ui/composed/finance-review-workspace';
import { ExpenseSourcePreview } from '../../../../../components/finance-source-preview';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FileText, ListOrdered } from 'lucide-react';
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
  EntityRecordSheet,
  MissingOrganization,
  RecordAuditTab,
  RecordChatter,
  RecordPage,
  SmartButtons,
  StatusBar,
  buildModuleTabHref,
  expenseSheetsTableConfig,
  expensesTableConfig,
} from '@lumiere/ui';
import { Badge } from '@lumiere/ui/components/badge';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { useExpenseReportDecision, type ExpenseReportDecision } from '../../expense-report-decision';
import { moduleCollection } from '@lumiere/ui/lib/module-data-state';
import { ModuleDataNotice } from '@lumiere/ui/pages/module-data-notice';
import { useExpenseSheetApprovalTimeline } from '@lumiere/query-hooks/hooks/approvals';
import {
  useExpenseSheets,
  useExpenses,
} from '@lumiere/query-hooks/hooks/expenses';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { accountMoveHref } from '@lumiere/erp-shared/record-links';
import { expenseVariantTag, mapExpenseRow, mapExpenseSheetRow } from '@/lib/expense-state';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { useExpensesModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { financeKindsFor } from '../../expense-report-finance';
import { useExpenseReportFinance } from '../../expense-report-finance-dialogs';
import { expenseReportStatusBar, expensesOfReport, reportMoveIds } from '../../expense-report';

interface ExpenseReportPageClientProps {
  sheetId: string;
  initialExpenses?: unknown[];
  initialSheets?: unknown[];
  organizationId?: number;
}

type Row = Record<string, unknown>;

const TAB_IDS = ['overview', 'expenses', 'approvals', 'discussion', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

const MOVE_LABEL = { post: 'Journal entry', reimbursement: 'Reimbursement', rebill: 'Rebill' } as const;

export function ExpenseReportPageClient(props: ExpenseReportPageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <ExpenseReportPageLoaded {...props} organizationId={props.organizationId} />;
}

function ExpenseReportPageLoaded({
  sheetId,
  initialExpenses,
  initialSheets,
  organizationId,
}: ExpenseReportPageClientProps & { organizationId: number }) {
  useExpensesModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { orgId } = orgBigInts(organizationId);
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n;

  const sheetsRead = moduleCollection(useExpenseSheets(orgId, initialSheets as never));
  const expensesRead = moduleCollection(useExpenses(orgId, initialExpenses as never));
  const sheetsRaw = sheetsRead.rows;
  const expensesRaw = expensesRead.rows;
  const isLoading = sheetsRead.state.status === 'loading';
  const sourcesReady = sheetsRead.state.status === 'ready';
  const timeline = useExpenseSheetApprovalTimeline(organizationId, sheetId);

  const finance = useExpenseReportFinance(orgId, operatingCompanyId, sourcesReady);
  const decision = useExpenseReportDecision(orgId, operatingCompanyId, sourcesReady);

  const [selectedLine, setSelectedLine] = useState<Row | null>(null);

  const sheets = useMemo(() => sheetsRaw.map((row) => mapExpenseSheetRow(row as Row)), [sheetsRaw]);
  const sheet = useMemo(() => sheets.find((row) => String(row.id) === sheetId), [sheets, sheetId]);
  const expenses = useMemo(
    () => expensesOfReport(expensesRaw.map((row) => mapExpenseRow(row as Row)), sheetId),
    [expensesRaw, sheetId],
  );

  const navigation = useRecordNavigation<Row>({
    rows: sheets as unknown as Row[],
    currentId: sheetId,
    basePath: '/expenses/reports',
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

  if (!sourcesReady && !isLoading) return <ModuleDataNotice state={sheetsRead.state} />;

  if (!sheet) {
    if (isLoading) {
      return (
        <div className="space-y-4" data-testid="expense-report-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="expense-report-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('expenses.page.notFound', { defaultValue: 'Expense report not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('expenses.page.notFoundHint', { defaultValue: 'It may have been deleted, or belong to another organization.' })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('expenses', 'expense-sheets')} />} nativeButton={false}>
            {t('expenses.page.backToReports', { defaultValue: 'Back to expense reports' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const id = BigInt(sheetId);
  const state = expenseVariantTag(sheet.state);
  const label = String(sheet.name || '').trim() || `#${sheetId}`;
  const status = expenseReportStatusBar(sheet, t);
  const moves = reportMoveIds(sheet);

  const sheetTable = expenseSheetsTableConfig(t);
  const sheetColumns = sheetTable.view.mode === 'table' ? sheetTable.view.columns : [];
  const detailConfig = {
    mode: 'detail' as const,
    sections: [{ id: 'report', fields: sheetColumns.filter((column) => column.key !== 'name').map(({ width: _width, ...field }) => field) }],
  };

  const confirmTitle: Record<ExpenseReportDecision, string> = {
    submit: t('expenses.workflow.submitReport'),
    approve: t('expenses.workflow.approveReport'),
    refuse: t('expenses.workflow.refuseReport'),
  };

  const busy = decision.isPending || finance.isPending;
  const financeKinds = financeKindsFor(sheet.state);

  const lineTable = expensesTableConfig(t);
  const lineColumns = lineTable.view.mode === 'table' ? lineTable.view.columns : [];

  return (
    <>
      <RecordPage
        testIdPrefix="expense-report"
        breadcrumbs={[
          { label: t('nav.expenses', { defaultValue: 'Expenses' }), href: '/expenses' },
          { label: t('expenses.expenseReports.title'), href: buildModuleTabHref('expenses', 'expense-sheets') },
          { label },
        ]}
        title={label}
        subtitle={String(sheet.employeeName ?? '').trim() || undefined}
        badge={
          <Badge variant={status.terminal ? 'destructive' : 'secondary'}>
            {status.terminal?.label ?? status.steps.find((step) => step.id === status.current)?.label ?? state}
          </Badge>
        }
        statusBar={<StatusBar steps={status.steps} current={status.current} terminal={status.terminal} />}
        navigation={navigation}
        smartButtons={
          <SmartButtons
            testIdPrefix="expense-report"
            buttons={[
              {
                id: 'expenses',
                label: t('expenses.expenses.title', { defaultValue: 'Expenses' }),
                count: expenses.length,
                icon: <ListOrdered className="h-4 w-4" />,
                onClick: () => setActiveTab('expenses'),
              },
              ...moves.map((move) => ({
                id: `move-${move.key}`,
                label: MOVE_LABEL[move.key],
                count: 1,
                icon: <FileText className="h-4 w-4" />,
                href: accountMoveHref(move.id),
              })),
            ]}
          />
        }
        actions={
          <>
            {state === 'Draft' ? (
              <Button size="sm" disabled={busy || !decision.can("submit")} data-testid="expense-report-submit" onClick={() => decision.open('submit', sheet)}>
                {confirmTitle.submit}
              </Button>
            ) : null}
            {state === 'Submitted' ? (
              <>
                <Button size="sm" disabled={busy || !decision.can("approve")} data-testid="expense-report-approve" onClick={() => decision.open('approve', sheet)}>
                  {confirmTitle.approve}
                </Button>
                <Button variant="outline" size="sm" disabled={busy || !decision.can("refuse")} data-testid="expense-report-refuse" onClick={() => decision.open('refuse', sheet)}>
                  {confirmTitle.refuse}
                </Button>
              </>
            ) : null}
            {financeKinds.map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant={kind === 'projectRebill' ? 'outline' : 'default'}
                disabled={busy}
                data-testid={`expense-report-${kind === 'postReport' ? 'post' : kind === 'reimburseReport' ? 'reimburse' : 'rebill'}`}
                onClick={() => finance.open(kind, sheet)}
              >
                {t(`expenses.workflow.${kind}`)}
              </Button>
            ))}
          </>
        }
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'overview',
            label: t('common.overview', { defaultValue: 'Overview' }),
            content: <EntityDetail config={detailConfig} data={sheet} />,
          },
          {
            id: 'expenses',
            label: t('expenses.expenses.title', { defaultValue: 'Expenses' }),
            content: expensesRead.state.status !== 'ready' ? <ModuleDataNotice state={expensesRead.state} /> : (
              <EntityView
                config={{ ...expensesTableConfig(t), title: '', description: undefined }}
                data={expenses}
                useCard={false}
                onRowClick={(row) => setSelectedLine(row)}
              />
            ),
          },
          {
            id: 'approvals',
            label: t('expenses.workflow.approvalTimeline'),
            content: (
              <div className="max-w-2xl space-y-3" data-testid="expense-report-approvals">
                <div className="rounded-md border p-3 text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">{t('expenses.workflow.timelineSubmittedBy')}: </span>
                    {String(sheet.submittedBy ?? sheet.submitted_by ?? '—')}
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('expenses.workflow.timelineApprover')}: </span>
                    {String(sheet.approverId ?? sheet.approver_id ?? '—')}
                  </div>
                </div>
                {timeline.isLoading ? <p className="text-sm text-muted-foreground">{t('common.loading')}</p> : null}
                {timeline.isError ? <div role="alert" className="space-y-2">
                  <p>{t('expenses.workflow.timelineUnavailable')}</p>
                  <Button variant="outline" size="sm" onClick={() => { void timeline.refetch() }} disabled={timeline.isFetching}>{t('common.retry')}</Button>
                </div> : null}
                {!timeline.isLoading && !timeline.isError && timeline.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('expenses.workflow.noApprovalRequests')}</p>
                ) : null}
                {!timeline.isError && timeline.rows.map((row) => (
                  <div key={String(row.id)} className="rounded-md border p-3 text-sm space-y-1">
                    <div className="font-medium">{String(row.summary ?? row.action ?? 'Approval')}</div>
                    <div className="text-muted-foreground">
                      {String(row.status ?? 'pending')} · {String(row.action ?? '')}
                    </div>
                    {row.rejectReason || row.reject_reason || row.decisionComment || row.decision_comment ?
                      <p className="text-destructive">{String(row.rejectReason ?? row.reject_reason ?? row.decisionComment ?? row.decision_comment)}</p> : null}
                  </div>
                ))}
              </div>
            ),
          },
          {
            id: 'discussion',
            label: t('expenses.page.discussion', { defaultValue: 'Discussion' }),
            content: (
              <div className="max-w-2xl" data-testid="expense-report-discussion">
                <RecordChatter organizationId={organizationId} resModel="hr_expense_sheet" resId={id} recordTitle={label} />
              </div>
            ),
          },
          {
            id: 'audit',
            label: t('common.audit', { defaultValue: 'Audit' }),
            content: <RecordAuditTab tableName="hr_expense_sheet" recordId={sheetId} />,
          },
        ]}
      />

      <EntityRecordSheet
        open={selectedLine != null}
        onOpenChange={(open) => !open && setSelectedLine(null)}
        record={selectedLine}
        config={{
          titleKey: 'name',
          statusKey: 'state',
          wide: true,
          overviewContent: (record) => <FinanceReviewWorkspace editorLabel={t('financeReview.savedDetails', { defaultValue: 'Saved details' })}
            editor={<EntityDetail config={{ mode: "detail", sections: [{ id: "line", fields: lineColumns.filter((column) => column.key !== "name").map(({ width: _width, ...field }) => field) }] }} data={record} />}
            preview={<ExpenseSourcePreview organizationId={orgId} companyId={operatingCompanyId} record={record} />} />,
          detailConfig: {
            mode: 'detail',
            sections: [
              {
                id: 'line',
                fields: lineColumns
                  .filter((column) => column.key !== 'name')
                  .map(({ width: _width, ...field }) => field),
              },
            ],
          },
          auditTableName: 'hr_expense',
          discussion: { resModel: 'hr_expense' },
        }}
      />

      {finance.modal}

      {decision.error && <p role="alert" className="text-sm text-destructive">{decision.error}</p>}
      {decision.modal}

    </>
  );
}
