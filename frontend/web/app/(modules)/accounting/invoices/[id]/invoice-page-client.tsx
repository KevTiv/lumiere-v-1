'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useResetAccountMoveToDraft } from '@lumiere/query-hooks/hooks/pass9-record-actions';
import { useRBAC } from '@/lib/rbac-context';
import { useUnsavedChangesGuard } from '@lumiere/ui';
import { useConfirmDialog } from '@lumiere/ui/hooks/use-confirm-dialog';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ListOrdered, MoreHorizontal, ShoppingCart } from 'lucide-react';
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
  RecordWorkflowActions,
  SmartButtons,
  StatusBar,
  accountMoveDetailConfig,
  accountMoveLinesTableConfig,
  addAccountMoveLineForm,
  buildModuleTabHref,
  createCreditNoteForm,
  editAccountMoveLineForm,
  formText,
  mergeFieldDefaultValues,
  mergeSelectOptionsForFields,
  useFormDialog,
} from '@lumiere/ui';
import type { EntityAction, EntityTableConfig, FormConfig } from '@lumiere/ui';
import { Badge } from '@lumiere/ui/components/badge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@lumiere/ui/components/dropdown-menu';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import { variantTag, type AnyWorkflowAction, type RowValueMap } from '@lumiere/erp-workflows';
import { buildAccountLabelMap, buildSourceDocumentLabelMap } from '@lumiere/stdb/read-models';
import {
  useAccountAccounts,
  useAddAccountMoveLine,
  useAccountMoveLines,
  useAccountMoves,
  useCancelAccountMove,
  useComputeInvoiceTotals,
  useCreateCreditNoteFromInvoice,
  useDeleteAccountMoveLine,
  useUpdateAccountMoveLine,
} from '@lumiere/query-hooks/hooks/accounting';
import { useInvoiceToPaymentWorkflow } from '@lumiere/query-hooks/hooks/accounting/invoice-workflow';
import { useCreateDocument } from '@lumiere/query-hooks/hooks/documents';
import { usePurchaseOrders } from '@lumiere/query-hooks/hooks/purchasing';
import { useSaleOrders } from '@lumiere/query-hooks/hooks/sales';
import {
  downloadDocumentPdf,
  useDispatchQueuedMail,
  useMailTemplates,
  useQueueMailFromTemplate,
} from '@lumiere/query-hooks/hooks/templates';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { toUpdateAccountMoveLineParams, updateAccountMoveLineParamsToJson } from '@lumiere/erp-shared/accounting-create-params';
import { toCreateCreditNoteParams } from '@/lib/accounting-create-params';
import { resolveDefaultCogsInventoryAccountIds } from '@/lib/accounting-post-draft';
import { archiveRenderedPdfAsDocument } from '@/lib/archive-document-pdf';
import { useAccountingModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { RecordDocumentAttachments } from '../../../../../components/record-document-attachments';
import { toAddAccountMoveLineParamsFromForm } from '../../account-move-line-forms';
import {
  canCancelMove,
  canResetMove,
  canEditMoveLines,
  canRecomputeInvoiceTotals,
  canRegisterPayment,
} from '../../invoice-actions';
import { invoiceKind, invoiceStatus } from '../../invoice-status';
import { RegisterPaymentOnInvoiceDialog } from '../../register-payment-on-invoice-dialog';

interface InvoicePageClientProps {
  moveId: string;
  organizationId?: number;
}

type Row = Record<string, unknown>;
type WorkflowAction = AnyWorkflowAction<RowValueMap>;

const TAB_IDS = ['overview', 'lines', 'discussion', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

/** Which accounting list a kind of document belongs to, and what to call it. */
const KIND_TAB = {
  invoice: { tab: 'invoices', titleKey: 'accounting.tabs.invoices', title: 'Invoices' },
  bill: { tab: 'bills', titleKey: 'accounting.tabs.bills', title: 'Bills' },
  creditNote: { tab: 'journal-entries', titleKey: 'accounting.tabs.journalEntries', title: 'Journal entries' },
  vendorCredit: { tab: 'journal-entries', titleKey: 'accounting.tabs.journalEntries', title: 'Journal entries' },
  entry: { tab: 'journal-entries', titleKey: 'accounting.tabs.journalEntries', title: 'Journal entries' },
} as const;

export function InvoicePageClient(props: InvoicePageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <InvoicePageCompany {...props} organizationId={props.organizationId} />;
}

function InvoicePageCompany(props: InvoicePageClientProps & { organizationId: number }) {
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(props.organizationId);
  if (operatingCompanyId == null) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" role="status">
        Select an active company to open this document.
      </div>
    );
  }
  return <InvoicePageLoaded {...props} operatingCompanyId={operatingCompanyId} />;
}

function InvoicePageLoaded({
  moveId,
  organizationId,
  operatingCompanyId,
}: InvoicePageClientProps & { organizationId: number; operatingCompanyId: bigint }) {
  useAccountingModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { askForm, formDialog } = useFormDialog();
  const { orgId } = orgBigInts(organizationId);
  const { checkPermission } = useRBAC();
  const resetMove = useResetAccountMoveToDraft(orgId);
  const resetPendingGuard = useUnsavedChangesGuard(false, resetMove.isPending);
  const { confirm: confirmReset, dialog: resetDialog } = useConfirmDialog();

  const { data: moves = [], isLoading: movesLoading } = useAccountMoves(orgId, { enabled: true });
  const { data: moveLines = [] } = useAccountMoveLines(orgId, { enabled: true });
  const { data: accounts = [] } = useAccountAccounts(orgId, { enabled: true });
  const { data: saleOrders = [] } = useSaleOrders(orgId);
  const { data: purchaseOrders = [] } = usePurchaseOrders(orgId);

  const mailTemplates = useMailTemplates(organizationId, true);
  const queueMail = useQueueMailFromTemplate(organizationId, Number(operatingCompanyId));
  const dispatchMail = useDispatchQueuedMail();
  const createDocument = useCreateDocument(orgId, operatingCompanyId);
  const createCreditNote = useCreateCreditNoteFromInvoice(organizationId);
  const cancelMove = useCancelAccountMove(organizationId);
  const computeTotals = useComputeInvoiceTotals(organizationId, operatingCompanyId);
  const addLine = useAddAccountMoveLine(organizationId);
  const updateLine = useUpdateAccountMoveLine(organizationId, operatingCompanyId);
  const deleteLine = useDeleteAccountMoveLine(organizationId);

  const workflowSurface = useWorkflowSurface({ organizationId });
  const resolvePostingAccounts = useCallback(() => {
    const resolved = resolveDefaultCogsInventoryAccountIds(accounts as readonly Row[]);
    return resolved
      ? { cogsAccountId: BigInt(resolved.cogsAccountId), inventoryAccountId: BigInt(resolved.inventoryAccountId) }
      : undefined;
  }, [accounts]);
  const workflow = useInvoiceToPaymentWorkflow(
    orgId,
    {
      labels: {
        postInvoice: t('accounting.invoices.invoiceActions.postDraft'),
        postPayment: t('accounting.entities.payments.actions.postSelected'),
      },
      resolvePostingAccounts,
      missingAccountsMessage: t('accounting.invoices.postMissingCogsAccounts'),
    },
    { navigate: workflowSurface.navigate, record: workflowSurface.record, notify: workflowSurface.notify },
  );

  const [creditNoteOpen, setCreditNoteOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [docBusy, setDocBusy] = useState<'download' | 'archive' | 'send' | null>(null);

  const move = useMemo(
    () => (moves as unknown as Row[]).find((row) => String(row.id) === moveId),
    [moves, moveId],
  );
  const lines = useMemo(
    () => (moveLines as unknown as Row[]).filter((line) => String(line.moveId ?? line.move_id ?? '') === moveId),
    [moveLines, moveId],
  );
  const accountLabelMap = useMemo(() => buildAccountLabelMap(accounts as Row[]), [accounts]);
  const sourceDocumentLabelMap = useMemo(
    () => buildSourceDocumentLabelMap([...(moves as unknown as Row[]), ...(saleOrders as unknown as Row[])]),
    [moves, saleOrders],
  );

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

  const report = useCallback((error: unknown, title: string) => {
    showWorkflowToast({
      kind: 'error',
      title,
      description: error instanceof Error ? error.message : String(error),
    });
  }, []);

  const headerActions = useMemo((): WorkflowAction[] => [workflow.postInvoice], [workflow.postInvoice]);

  // Previous / next follow the list the document was opened from, else its own kind, newest first.
  const kind = move ? invoiceKind(move) : 'entry';
  const siblings = useMemo(
    () => (move ? (moves as unknown as Row[]).filter((row) => invoiceKind(row) === kind) : []),
    [moves, move, kind],
  );
  const navigation = useRecordNavigation<Row>({
    rows: siblings,
    currentId: moveId,
    basePath: '/accounting/invoices',
    labelOf: (row) => String(row.name || row.id),
  });

  if (!move) {
    if (movesLoading) {
      return (
        <div className="space-y-4" data-testid="invoice-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="invoice-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('accounting.invoices.notFound', { defaultValue: 'Document not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('accounting.invoices.notFoundHint', {
              defaultValue: 'It may have been deleted, or belong to another company.',
            })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('accounting', 'invoices')} />} nativeButton={false}>
            {t('accounting.invoices.backToInvoices', { defaultValue: 'Back to invoices' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const record = move as RowValueMap;
  const state = variantTag(move.state);
  const isDraft = state === 'Draft';
  const label = String(move.name || '').trim() || t('accounting.invoices.draftName', { defaultValue: 'Draft' });
  const status = invoiceStatus(move, t);
  const listTab = KIND_TAB[kind];
  const partner = String(move.invoicePartnerDisplayName ?? move.invoice_partner_display_name ?? '').trim();

  const saleOrderId = move.saleOrderId ?? move.sale_order_id;
  const purchaseOrder = (purchaseOrders as unknown as Row[]).find((order) =>
    Array.isArray(order.invoiceIds ?? order.invoice_ids)
      ? ((order.invoiceIds ?? order.invoice_ids) as unknown[]).map(String).includes(moveId)
      : false,
  );

  const withBusy = async (which: 'download' | 'archive' | 'send', title: string, work: () => Promise<void>) => {
    try {
      setDocBusy(which);
      await work();
    } catch (error) {
      report(error, title);
    } finally {
      setDocBusy(null);
    }
  };

  const sendEmail = async () => {
    const values = await askForm({
      title: t('accounting.invoices.invoiceActions.send'),
      fields: [
        { id: 'recipient', name: 'recipient', label: 'Recipient email address', type: 'email', required: true },
      ],
    });
    const recipient = formText(values?.recipient);
    if (recipient == null) return;
    const template = (mailTemplates.data ?? []).find(
      (row) => (row.model ?? '') === 'account_move' && (row.isActive ?? row.is_active) !== false,
    );
    if (!template?.id) {
      report(
        new Error('No active mail template for account_move. Create one in settings first.'),
        t('accounting.invoices.invoiceActions.send'),
      );
      return;
    }
    await withBusy('send', t('accounting.invoices.invoiceActions.send'), async () => {
      await queueMail.mutateAsync({
        templateId: Number(template.id),
        model: 'account_move',
        resId: Number(moveId),
        recipientEmail: recipient,
      });
      const result = await dispatchMail.mutateAsync();
      showWorkflowToast({
        kind: 'success',
        title: t('accounting.invoices.invoiceActions.send'),
        description: `Queued and dispatched ${result.sent ?? 0} email(s).`,
      });
    });
  };

  const moreActions: Array<{ id: string; label: string; show: boolean; run: () => Promise<void> | void }> = [
    {
      id: 'reset-to-draft',
      label: t('recordHeader.reset'),
      show: canResetMove(move) && checkPermission('account_move', 'write').allowed,
      run: async () => {
        if (resetMove.isPending) return;
        if (!await confirmReset({ title: t('recordHeader.reset'), description: t('recordHeader.resetDescription') })) return;
        await resetMove.mutateAsync(BigInt(moveId));
        showWorkflowToast({ kind: 'success', title: t('recordHeader.reset') });
      },
    },
    {
      id: 'recalculate',
      label: t('accounting.invoices.invoiceActions.recalculate', { defaultValue: 'Recalculate totals' }),
      show: isDraft,
      run: async () => {
        await computeTotals.mutateAsync(moveId);
      },
    },
    {
      id: 'register-payment',
      label: t('accounting.invoices.invoiceActions.registerPayment', { defaultValue: 'Register payment' }),
      show: canRegisterPayment(move, kind),
      run: () => setRegisterOpen(true),
    },
    {
      id: 'cancel',
      label: t('accounting.invoices.invoiceActions.cancel', { defaultValue: 'Cancel document' }),
      show: canCancelMove(move),
      run: () => setCancelOpen(true),
    },
    {
      id: 'download-pdf',
      label: t('accounting.invoices.invoiceActions.download'),
      show: true,
      run: () =>
        withBusy('download', t('accounting.invoices.invoiceActions.download'), () =>
          downloadDocumentPdf('account-move', Number(moveId)),
        ),
    },
    {
      id: 'archive-pdf',
      label: t('accounting.invoices.invoiceActions.archive', { defaultValue: 'Archive PDF to Documents' }),
      show: true,
      run: () =>
        withBusy('archive', 'Archive PDF', async () => {
          const params = await archiveRenderedPdfAsDocument({
            kind: 'account-move',
            recordId: Number(moveId),
            companyId: operatingCompanyId,
            name: String(move.name || `Invoice ${moveId}`),
          });
          await createDocument.mutateAsync(params);
          showWorkflowToast({
            kind: 'success',
            title: 'Archived to Documents',
            description: 'PDF stored as a linked document version.',
          });
        }),
    },
    {
      id: 'send-email',
      label: t('accounting.invoices.invoiceActions.send'),
      show: true,
      run: sendEmail,
    },
  ].filter((action) => action.show);

  const canCreditNote = kind === 'invoice' && state === 'Posted';
  const linesBase = accountMoveLinesTableConfig(t, { accountLabelMap, sourceDocumentLabelMap });

  // Lines of a draft are editable; the totals are recomputed through the same command as "Recalculate totals".
  const refreshTotals = async () => {
    if (canRecomputeInvoiceTotals(kind)) await computeTotals.mutateAsync(moveId);
  };
  const fieldsOf = (config: FormConfig) => config.sections.flatMap((section) => section.fields);
  const accountOptions = (accounts as unknown as Row[]).map((account) => ({
    value: String(account.id ?? ''),
    label: `${String(account.code ?? '')} — ${String(account.name ?? account.id ?? '')}`,
  }));
  const lineActions: EntityAction[] = canEditMoveLines(move)
    ? [
        {
          id: 'move-line-add',
          label: t('accounting.actions.addMoveLine'),
          onClick: async () => {
            const base = mergeSelectOptionsForFields(addAccountMoveLineForm(t), {
              accountId:
                accountOptions.length > 0
                  ? accountOptions
                  : [{ value: '', label: t('common.noData'), disabled: true }],
            });
            const form = { ...base, sections: base.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.name !== 'moveId') })) };
            const values = await askForm({
              id: form.id,
              title: form.title ?? '',
              description: form.description,
              submitLabel: form.submitLabel,
              fields: fieldsOf(form),
            });
            if (!values) return;
            const parsed = toAddAccountMoveLineParamsFromForm({ ...values, moveId });
            if (!parsed) throw new Error(t('common.validation.required'));
            await addLine.mutateAsync(parsed);
            await refreshTotals();
          },
        } satisfies EntityAction,
        {
          id: 'move-line-edit',
          label: t('common.edit'),
          requiresSelection: true,
          isApplicable: (rows) => rows.length === 1,
          onClick: async (rows) => {
            const line = rows[0] as Row | undefined;
            if (!line?.id) return;
            const form = mergeFieldDefaultValues(editAccountMoveLineForm(t), {
              name: String(line.name ?? ''),
              debit: Number(line.debit ?? 0),
              credit: Number(line.credit ?? 0),
            });
            const values = await askForm({
              id: form.id,
              title: form.title ?? '',
              description: form.description,
              submitLabel: form.submitLabel,
              fields: fieldsOf(form),
            });
            if (!values) return;
            await updateLine.mutateAsync({
              lineId: BigInt(String(line.id)),
              params: updateAccountMoveLineParamsToJson(
                toUpdateAccountMoveLineParams({ ...values, companyId: operatingCompanyId }),
              ),
            });
            await refreshTotals();
          },
        } satisfies EntityAction,
        {
          id: 'move-line-delete',
          label: t('common.delete'),
          requiresSelection: true,
          selection: 'multiple',
          variant: 'destructive',
          confirm: {
            title: t('accounting.invoices.removeLinesTitle', { defaultValue: 'Delete the selected lines?' }),
            description: t('accounting.invoices.removeLinesDescription', {
              defaultValue: 'The lines are deleted from this draft and its totals are recomputed.',
            }),
            confirmLabel: t('common.delete'),
            cancelLabel: t('erpWorkflow.confirm.dismiss'),
          },
          successMessage: t('common.actionCompleted', { action: t('common.delete') }),
          onClick: async (rows) => {
            for (const row of rows) {
              await deleteLine.mutateAsync({
                lineId: BigInt(String(row.id)),
                params: { companyId: operatingCompanyId },
              });
            }
            await refreshTotals();
          },
        } satisfies EntityAction,
      ]
    : [];
  const linesView = linesBase.view as EntityTableConfig;
  const linesConfig = { ...linesBase, view: { ...linesView, actions: [...(linesView.actions ?? []), ...lineActions] } };

  return (
    <>
      <RecordPage
        testIdPrefix="invoice"
        breadcrumbs={[
          { label: t('nav.accounting', { defaultValue: 'Accounting' }), href: '/accounting' },
          { label: t(listTab.titleKey, { defaultValue: listTab.title }), href: buildModuleTabHref('accounting', listTab.tab) },
          { label },
        ]}
        title={label}
        subtitle={partner || undefined}
        badge={<Badge variant={status.badge.variant}>{status.badge.label}</Badge>}
        statusBar={<StatusBar steps={status.steps} current={status.current} terminal={status.terminal} />}
        navigation={navigation}
        smartButtons={
          <SmartButtons
            testIdPrefix="invoice"
            buttons={[
              {
                id: 'lines',
                label: t('accounting.tabs.moveLines'),
                count: lines.length,
                icon: <ListOrdered className="h-4 w-4" />,
                onClick: () => setActiveTab('lines'),
              },
              ...(saleOrderId != null
                ? [
                    {
                      id: 'sale-order',
                      label: t('accounting.invoices.saleOrder', { defaultValue: 'Sales order' }),
                      count: 1,
                      icon: <ShoppingCart className="h-4 w-4" />,
                      href: `/sales/orders/${String(saleOrderId)}`,
                    },
                  ]
                : []),
              ...(purchaseOrder
                ? [
                    {
                      id: 'purchase-order',
                      label: t('accounting.invoices.purchaseOrder', { defaultValue: 'Purchase order' }),
                      count: 1,
                      icon: <ShoppingCart className="h-4 w-4" />,
                      href: `/purchasing/orders/${String(purchaseOrder.id)}`,
                    },
                  ]
                : []),
            ]}
          />
        }
        actions={
          <>
            <RecordWorkflowActions
              actions={headerActions}
              record={record}
              onRun={(action, row) => void action.execute(action.prepare?.(row)).catch(() => undefined)}
              primaryActionIds={new Set(['accounting.invoice.post'])}
              pendingActionIds={workflow.isPending ? new Set(headerActions.map((action) => action.id)) : undefined}
            />
            {canCreditNote ? (
              <Button variant="outline" size="sm" onClick={() => setCreditNoteOpen(true)} data-testid="invoice-credit-note">
                {t('accounting.forms.createCreditNote.title')}
              </Button>
            ) : null}
            {moreActions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={docBusy != null} data-testid="invoice-more-actions">
                    <MoreHorizontal className="mr-1 h-4 w-4" />
                    {t('accounting.invoices.moreActions', { defaultValue: 'More' })}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {moreActions.map((action) => (
                    <DropdownMenuItem
                      key={action.id}
                      data-testid={`invoice-action-${action.id}`}
                      onSelect={() => {
                        void Promise.resolve(action.run()).catch((error: unknown) => report(error, action.label));
                      }}
                    >
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'overview',
            label: t('common.overview', { defaultValue: 'Overview' }),
            content: <EntityDetail config={accountMoveDetailConfig(t)} data={move} />,
          },
          {
            id: 'lines',
            label: t('accounting.tabs.moveLines'),
            content: (
              <EntityView config={{ ...linesConfig, title: '', description: undefined }} data={lines} useCard={false} />
            ),
          },
          {
            id: 'discussion',
            label: t('accounting.invoices.discussion', { defaultValue: 'Discussion' }),
            content: (
              <div className="grid gap-6 lg:grid-cols-2" data-testid="invoice-discussion">
                <RecordChatter
                  organizationId={organizationId}
                  resModel="account_move"
                  resId={BigInt(moveId)}
                  recordTitle={label}
                />
                <RecordDocumentAttachments
                  organizationId={orgId}
                  resModel="account_move"
                  resId={BigInt(moveId)}
                  title={t('accounting.invoices.attachments', { defaultValue: 'Attachments' })}
                />
              </div>
            ),
          },
          {
            id: 'audit',
            label: t('common.audit', { defaultValue: 'Audit' }),
            content: <RecordAuditTab tableName="account_move" recordId={moveId} />,
          },
        ]}
      />

      {creditNoteOpen ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) setCreditNoteOpen(false);
          }}
          config={mergeFieldDefaultValues(createCreditNoteForm(t), { invoiceId: moveId })}
          isPending={createCreditNote.isPending}
          onSubmit={async (data) => {
            await createCreditNote.mutateAsync({
              companyId: operatingCompanyId,
              invoiceId: BigInt(moveId),
              params: toCreateCreditNoteParams(data),
            });
            showWorkflowToast({
              kind: 'success',
              title: t('accounting.forms.createCreditNote.title'),
              description: t('accounting.forms.createCreditNote.description'),
            });
            setCreditNoteOpen(false);
          }}
        />
      ) : null}
      {registerOpen ? (
        <RegisterPaymentOnInvoiceDialog
          organizationId={orgId}
          move={move}
          isBill={kind === 'bill'}
          registerPayment={workflow.registerPayment}
          isPending={workflow.isPending}
          onClose={() => setRegisterOpen(false)}
        />
      ) : null}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent data-testid="invoice-cancel-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('accounting.invoices.invoiceActions.cancel', { defaultValue: 'Cancel document' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('accounting.invoices.cancelConfirm', {
                defaultValue: 'This cancels the document and its lines. This cannot be undone.',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('erpWorkflow.confirm.dismiss')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelMove.isPending}
              onClick={() => {
                setCancelOpen(false);
                void cancelMove
                  .mutateAsync(BigInt(moveId))
                  .then(() =>
                    showWorkflowToast({
                      kind: 'success',
                      title: t('accounting.invoices.invoiceActions.cancel', { defaultValue: 'Cancel document' }),
                      description: label,
                    }),
                  )
                  .catch((error: unknown) =>
                    report(error, t('accounting.invoices.invoiceActions.cancel', { defaultValue: 'Cancel document' })),
                  );
              }}
            >
              {t('erpWorkflow.confirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {formDialog}
      {resetDialog}
      {resetPendingGuard}
    </>
  );
}
