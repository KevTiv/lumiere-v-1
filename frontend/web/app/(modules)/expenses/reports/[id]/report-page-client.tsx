'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@lumiere/ui/components/alert-dialog';
import { Badge } from '@lumiere/ui/components/badge';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { Textarea } from '@lumiere/ui/components/textarea';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import { useExpenseSheetApprovalTimeline } from '@lumiere/query-hooks/hooks/approvals';
import {
  useApproveExpenseSheet,
  useExpenseSheets,
  useExpenses,
  useRefuseExpenseSheet,
  useSubmitExpenseSheet,
} from '@lumiere/query-hooks/hooks/expenses';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { accountMoveHref } from '@lumiere/erp-shared/record-links';
import { expenseVariantTag, mapExpenseRow, mapExpenseSheetRow } from '@/lib/expense-state';
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
type Confirm = 'submit' | 'approve' | 'refuse';

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

  const { data: sheetsRaw = [], isLoading } = useExpenseSheets(orgId, initialSheets as never);
  const { data: expensesRaw = [] } = useExpenses(orgId, initialExpenses as never);
  const timeline = useExpenseSheetApprovalTimeline(organizationId, sheetId);

  const submitSheet = useSubmitExpenseSheet(orgId, operatingCompanyId);
  const approveSheet = useApproveExpenseSheet(orgId, operatingCompanyId);
  const refuseSheet = useRefuseExpenseSheet(orgId);

  const finance = useExpenseReportFinance(orgId, operatingCompanyId);

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [reason, setReason] = useState('');

  const sheets = useMemo(() => sheetsRaw.map((row) => mapExpenseSheetRow(row as Row)), [sheetsRaw]);
  const sheet = useMemo(() => sheets.find((row) => String(row.id) === sheetId), [sheets, sheetId]);
  const expenses = useMemo(
    () => expensesOfReport(expensesRaw.map((row) => mapExpenseRow(row as Row)), sheetId),
    [expensesRaw, sheetId],
  );

  const navigation = useMemo(() => {
    const sorted = [...sheets].sort((a, b) => Number(BigInt(String(b.id)) - BigInt(String(a.id))));
    const index = sorted.findIndex((row) => String(row.id) === sheetId);
    if (index === -1) return undefined;
    const link = (row: Row | undefined) =>
      row ? { href: `/expenses/reports/${String(row.id)}`, label: String(row.name || row.id) } : undefined;
    return { position: index + 1, total: sorted.length, previous: link(sorted[index - 1]), next: link(sorted[index + 1]) };
  }, [sheets, sheetId]);

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

  const run = useCallback(async (title: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      showWorkflowToast({ kind: 'error', title, description: error instanceof Error ? error.message : String(error) });
    }
  }, []);

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

  const confirmTitle: Record<Confirm, string> = {
    submit: t('expenses.workflow.submitReport'),
    approve: t('expenses.workflow.approveReport'),
    refuse: t('expenses.workflow.refuseReport'),
  };

  const runConfirmed = () => {
    const action = confirm;
    setConfirm(null);
    if (action === 'submit') void run(confirmTitle.submit, () => submitSheet.mutateAsync(sheetId));
    else if (action === 'approve') void run(confirmTitle.approve, () => approveSheet.mutateAsync(sheetId));
    else if (action === 'refuse') {
      const text = reason.trim();
      setReason('');
      void run(confirmTitle.refuse, () => refuseSheet.mutateAsync({ sheetId, params: { reason: text || undefined } }));
    }
  };

  const busy = submitSheet.isPending || approveSheet.isPending || refuseSheet.isPending || finance.isPending;
  const financeKinds = financeKindsFor(sheet.state);

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
              <Button size="sm" disabled={busy} data-testid="expense-report-submit" onClick={() => setConfirm('submit')}>
                {confirmTitle.submit}
              </Button>
            ) : null}
            {state === 'Submitted' ? (
              <>
                <Button size="sm" disabled={busy} data-testid="expense-report-approve" onClick={() => setConfirm('approve')}>
                  {confirmTitle.approve}
                </Button>
                <Button variant="outline" size="sm" disabled={busy} data-testid="expense-report-refuse" onClick={() => setConfirm('refuse')}>
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
            content: (
              <EntityView config={{ ...expensesTableConfig(t), title: '', description: undefined }} data={expenses} useCard={false} />
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
                {!timeline.isLoading && timeline.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('expenses.workflow.noApprovalRequests')}</p>
                ) : null}
                {timeline.rows.map((row) => (
                  <div key={String(row.id)} className="rounded-md border p-3 text-sm space-y-1">
                    <div className="font-medium">{String(row.summary ?? row.action ?? 'Approval')}</div>
                    <div className="text-muted-foreground">
                      {String(row.status ?? 'pending')} · {String(row.action ?? '')}
                    </div>
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

      {finance.modal}

      <AlertDialog open={confirm != null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent data-testid="expense-report-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? confirmTitle[confirm] : ''}</AlertDialogTitle>
            <AlertDialogDescription>{label}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirm === 'refuse' ? (
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('expenses.page.refuseReason', { defaultValue: 'Reason (optional)' })}
              data-testid="expense-report-refuse-reason"
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('erpWorkflow.confirm.dismiss')}</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirmed}>{t('common.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
