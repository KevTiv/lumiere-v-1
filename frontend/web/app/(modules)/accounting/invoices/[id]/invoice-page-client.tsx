'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { BillSourcePreview } from '../../../../../components/finance-source-preview';
import { FinanceReviewWorkspace } from '@lumiere/ui/composed/finance-review-workspace';
import { useResetAccountMoveToDraft } from '@lumiere/query-hooks/hooks/pass9-record-actions';
import { useRBAC } from '@/lib/rbac-context';
import { useUnsavedChangesGuard } from '@lumiere/ui';
import { useConfirmDialog } from '@lumiere/ui/hooks/use-confirm-dialog';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CreditCard, Download, ListOrdered, Mail, MoreHorizontal, Printer, ShoppingCart } from 'lucide-react';
import { useTranslation } from '@lumiere/i18n';
import { useInvoicePersonalization } from '@lumiere/query-hooks/hooks/invoice-personalization';
import { invoiceSellerFromCompany, invoiceSellerCompanyFromQueryRow, isInvoiceSellerIdentityReady } from '@lumiere/erp-shared/invoice-personalization';
import {
  Button,
  PrintableInvoice,
  printInvoice,
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
  AccountMoveChanges,
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
  recordOptions,
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
import { InvoiceDocument, formatInvoiceMoney, readInvoiceDocumentContent, resolveDraftInvoiceDocument } from '../../../../../../packages/ui/src/accounting-components/invoice-document';
import { ModuleDataNotice } from '../../../../../../packages/ui/src/pages/module-data-notice';
import { mergeModuleStates, moduleCollection } from '@lumiere/ui/lib/module-data-state';
import { formatTimestampLike } from '@lumiere/ui/lib/entity-row-values';
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
import { accountingBillCorrectionAvailable } from '@lumiere/stdb/commands';
import { billLineCorrectionSource, billLineCorrectionParams } from '../../bill-line-correction';
import { usePurchaseOrderLines, usePurchaseOrders } from '@lumiere/query-hooks/hooks/purchasing';
import { useSaleOrders } from '@lumiere/query-hooks/hooks/sales';
import { useCompanies } from '@lumiere/query-hooks/hooks/organization-company';
import { useCurrencies } from '@lumiere/query-hooks/hooks/settings';
import {
  downloadDocumentPdf,
} from '@lumiere/query-hooks/hooks/templates';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { toUpdateAccountMoveLineParams, updateAccountMoveLineParamsToJson } from '@lumiere/erp-shared/accounting-create-params';
import { toCreateCreditNoteParams } from '@/lib/accounting-create-params';
import { resolveDefaultCogsInventoryAccountIds } from '@/lib/accounting-post-draft';
import { archiveRenderedPdfAsDocument } from '@/lib/archive-document-pdf';
import { useModuleSubscription } from '@lumiere/stdb/live';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { RecordDocumentAttachments } from '../../../../../components/record-document-attachments';
import { toAddAccountMoveLineParamsFromForm } from '../../account-move-line-forms';
import {
  canCancelMove,
  canResetMove,
  canEditMoveLines,
  canRecomputeInvoiceTotals,
  canReconcilePayment,
  canRegisterPayment,
  reconcilablePaymentMoves,
} from '../../invoice-actions';
import { invoiceKind, invoiceStatus } from '../../invoice-status';
import { RegisterPaymentOnInvoiceDialog } from '../../register-payment-on-invoice-dialog';
import { invoiceDocumentLines, invoiceRecordAmount, invoiceRecordCurrency, invoiceRecordLines, resolveInvoiceRecord, sameCompany } from './invoice-record';
import { InvoiceEmailReviewDialog } from '../../../../../../packages/ui/src/accounting-components/invoice-email-review-dialog';
import { invoiceEmailDocumentKey, invoiceEmailRecordRevision, invoiceEmailScope, type InvoiceEmailDocument } from '../../../../../../packages/ui/src/accounting-components/invoice-email-review';
import { createInvoiceEmailQueueClient, downloadInvoiceReviewPdf, useInvoiceEmailTemplates } from './invoice-email-transport';

interface InvoicePageClientProps {
  moveId: string;
  organizationId?: number;
}

type Row = Record<string, unknown>;
type WorkflowAction = AnyWorkflowAction<RowValueMap>;

const TAB_IDS = ['overview', 'lines', 'discussion', 'changes', 'audit'] as const;
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
  const retainedCompany = useRef(operatingCompanyId);
  if (operatingCompanyId != null) retainedCompany.current = operatingCompanyId;
  if (retainedCompany.current == null) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" role="status">
        Select an active company to open this document.
      </div>
    );
  }
  return <InvoicePageLoaded {...props} operatingCompanyId={retainedCompany.current} companyAvailable={operatingCompanyId != null} />;
}

function InvoicePageLoaded({
  moveId,
  organizationId,
  operatingCompanyId,
  companyAvailable,
}: InvoicePageClientProps & { organizationId: number; operatingCompanyId: bigint; companyAvailable: boolean }) {
  useModuleSubscription(['account-moves', 'account-move-lines', 'account-accounts', 'sale-orders', 'purchase-orders', 'purchase-order-lines', 'companies', 'currencies']);
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { askForm, formDialog } = useFormDialog();
  const { orgId } = orgBigInts(organizationId);
  const { checkPermission } = useRBAC();
  const queryClient = useQueryClient();
  const [emailReview, setEmailReview] = useState<{ key: string; document: InvoiceEmailDocument; purpose: 'invoice' | 'reminder' } | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const emailClient = useMemo(() => createInvoiceEmailQueueClient(), []);
  const emailScopeRef = useRef({ scope: '', documentKey: null as string | null, canQueue: false, canCheck: false, canDispatch: false });
  const autoReviewSeen = useRef('');
  const resetMove = useResetAccountMoveToDraft(orgId);
  const resetPendingGuard = useUnsavedChangesGuard(false, resetMove.isPending);
  const { confirm: confirmReset, dialog: resetDialog } = useConfirmDialog();

  const movesRead = moduleCollection(useAccountMoves(orgId, { enabled: true }));
  const linesRead = moduleCollection(useAccountMoveLines(orgId, { enabled: true }));
  const accountsRead = moduleCollection(useAccountAccounts(orgId, { enabled: true }));
  const salesRead = moduleCollection(useSaleOrders(orgId));
  const purchasesRead = moduleCollection(usePurchaseOrders(orgId));
  const purchaseLinesRead = moduleCollection(usePurchaseOrderLines(orgId));
  const companiesRead = moduleCollection(useCompanies(organizationId, true));
  const currenciesRead = moduleCollection(useCurrencies());
  const moves = movesRead.rows;
  const moveLines = linesRead.rows;
  const accounts = accountsRead.rows;
  const saleOrders = salesRead.rows;
  const purchaseOrders = purchasesRead.rows;
  const purchaseLines = purchaseLinesRead.rows;

  const emailTemplatesRead = moduleCollection(useInvoiceEmailTemplates(organizationId, emailReview !== null && checkPermission('mail_template', 'read').allowed));
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
  const [docBusy, setDocBusy] = useState<'download' | 'archive' | null>(null);

  const move = useMemo(
    () => resolveInvoiceRecord(moves as unknown as Row[], moveId, operatingCompanyId),
    [moves, moveId, operatingCompanyId],
  );
  const outgoingDraft = variantTag(move?.state) === 'Draft' && ['OutInvoice', 'OutRefund'].includes(variantTag(move?.moveType ?? move?.move_type));
  const invoicePersonalization = useInvoicePersonalization({ organizationId, companyId: operatingCompanyId, enabled: outgoingDraft });
  const lines = useMemo(
    () => invoiceRecordLines(moveLines as unknown as Row[], moveId, operatingCompanyId),
    [moveLines, moveId, operatingCompanyId],
  );
  const emailDocument = useMemo((): InvoiceEmailDocument | null => {
    if (!move) return null;
    const canonicalMove = moves.find((row) => String(row.id) === moveId && row.companyId === operatingCompanyId);
    if (!canonicalMove) return null;
    const company = companiesRead.rows.find((row) => String(row.id) === String(operatingCompanyId));
    const reference = String(move.name || '').trim() || t('accounting.invoices.draftName', { defaultValue: 'Draft' });
    const partner = String(move.invoicePartnerDisplayName ?? move.invoice_partner_display_name ?? '').trim();
    const total = invoiceRecordAmount(move.amountTotal ?? move.amount_total);
    const currency = invoiceRecordCurrency(move, currenciesRead.rows);
    const state = variantTag(move.state);
    return {
      organizationId: orgId, companyId: operatingCompanyId, moveId: BigInt(moveId), reference,
      partner: partner || 'Customer identity unavailable', companyName: company?.name || `Company #${operatingCompanyId}`,
      totalLabel: formatInvoiceMoney(total, currency), pdfFilename: `account-move-${moveId}.pdf`,
      posted: state === 'Posted' && ['invoice', 'creditNote'].includes(invoiceKind(move)),
      revision: invoiceEmailRecordRevision(canonicalMove),
    };
  }, [move, moves, moveId, operatingCompanyId, orgId, companiesRead.rows, currenciesRead.rows, t]);
  const emailRecordReady = companyAvailable && movesRead.state.status === 'ready' && linesRead.state.status === 'ready'
    && currenciesRead.state.status === 'ready' && Boolean(emailDocument?.posted)
    && invoiceRecordAmount(move?.amountTotal ?? move?.amount_total) !== null
    && !readInvoiceDocumentContent(move?.metadata, organizationId, true).personalizationError;
  const hasQueueEmailPermission = checkPermission('mail_template', 'read').allowed && checkPermission('mail_template', 'write').allowed
    && checkPermission('mail_message', 'read').allowed;
  const canQueueEmail = hasQueueEmailPermission && emailRecordReady;
  const currentEmailScope = companyAvailable ? `${orgId}:${operatingCompanyId}:${moveId}` : 'no-active-company';
  const currentEmailDocumentKey = emailRecordReady && emailDocument ? invoiceEmailDocumentKey(emailDocument) : null;
  emailScopeRef.current = { scope: currentEmailScope, documentKey: currentEmailDocumentKey, canQueue: canQueueEmail, canCheck: checkPermission('mail_message', 'read').allowed, canDispatch: canQueueEmail && checkPermission('mail_message', 'write').allowed };
  const openEmailReview = () => {
    if (emailReview) { setEmailOpen(true); return; }
    if (!emailDocument) return;
    setEmailReview((current) => current ?? { key: crypto.randomUUID(), document: { ...emailDocument }, purpose: searchParams.get('reminder') === '1' ? 'reminder' : 'invoice' });
    setEmailOpen(true);
  };
  useEffect(() => {
    if ((searchParams.get('review') !== 'email' && searchParams.get('reminder') !== '1') || !emailDocument || !canQueueEmail || autoReviewSeen.current === currentEmailScope) return;
    autoReviewSeen.current = currentEmailScope;
    setEmailReview((current) => current ?? { key: crypto.randomUUID(), document: { ...emailDocument }, purpose: searchParams.get('reminder') === '1' ? 'reminder' : 'invoice' });
    setEmailOpen(true);
  }, [searchParams, currentEmailScope, emailDocument, canQueueEmail]);
  const emailDialog = emailReview ? <InvoiceEmailReviewDialog
    key={emailReview.key}
    open={emailOpen}
    purpose={emailReview.purpose}
    document={emailReview.document}
    currentScopeKey={currentEmailScope}
    currentDocumentKey={currentEmailDocumentKey}
    templates={emailTemplatesRead.rows}
    templateState={emailTemplatesRead.state}
    canQueue={hasQueueEmailPermission}
    canCheck={emailScopeRef.current.canCheck}
    onQueue={async (submission, mayDispatch) => {
      const result = await emailClient.queue(submission, () => mayDispatch() && emailScopeRef.current.canQueue
        && emailScopeRef.current.scope === invoiceEmailScope(submission.document)
        && emailScopeRef.current.documentKey === invoiceEmailDocumentKey(submission.document));
      if (result.status === 'queued' || result.status === 'dispatched') void queryClient.invalidateQueries({ queryKey: ['mail-messages'] });
      return result;
    }}
    onCheck={(submission) => emailClient.check(submission, () => emailScopeRef.current.canCheck && emailScopeRef.current.scope === invoiceEmailScope(submission.document))}
    onDispatch={checkPermission('mail_message', 'write').allowed ? async (submission, messageId, mayDispatch) => {
      const result = await emailClient.dispatch(submission, messageId, () => mayDispatch() && emailScopeRef.current.canDispatch
        && emailScopeRef.current.scope === invoiceEmailScope(submission.document)
        && emailScopeRef.current.documentKey === invoiceEmailDocumentKey(submission.document));
      void queryClient.invalidateQueries({ queryKey: ['mail-messages'] });
      return result;
    } : undefined}
    onReviewPdf={async (document) => {
      if (emailScopeRef.current.scope !== invoiceEmailScope(document) || emailScopeRef.current.documentKey !== invoiceEmailDocumentKey(document)) throw new Error('The active company or invoice changed. Return to the original review before opening its PDF.');
      await downloadInvoiceReviewPdf(document);
    }}
    onReloadTemplates={() => { void queryClient.invalidateQueries({ queryKey: ['invoice-email-review-templates', String(organizationId)] }); }}
    onRefreshDocument={canQueueEmail && emailDocument ? () => {
      setEmailReview({ key: crypto.randomUUID(), document: { ...emailDocument }, purpose: searchParams.get('reminder') === '1' ? 'reminder' : 'invoice' });
      setEmailOpen(true);
    } : undefined}
    onClose={() => setEmailOpen(false)}
  /> : null;
  const emailRecoveryButton = emailReview && !emailOpen ? <Button variant="outline" className="min-h-11" onClick={() => setEmailOpen(true)}>Review original email request</Button> : null;
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
    () => (move ? (moves as unknown as Row[]).filter((row) => sameCompany(row, operatingCompanyId) && invoiceKind(row) === kind) : []),
    [moves, move, kind, operatingCompanyId],
  );
  const navigation = useRecordNavigation<Row>({
    rows: siblings,
    currentId: moveId,
    basePath: '/accounting/invoices',
    labelOf: (row) => String(row.name || row.id),
  });

  if (!companyAvailable) return <>{emailDialog}{emailRecoveryButton}<div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" role="status">Select an active company to open this document. Any original email queue review has been retained.</div></>;
  if (!move) {
    if (movesRead.state.status !== 'ready' && movesRead.state.status !== 'loading') {
      return <>{emailDialog}{emailRecoveryButton}<ModuleDataNotice state={movesRead.state} /></>;
    }
    if (movesRead.state.status === 'loading') {
      return (
        <>{emailDialog}{emailRecoveryButton}<div className="space-y-4" data-testid="invoice-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-full max-w-96" />
          <Skeleton className="h-64 w-full" />
        </div></>
      );
    }
    return (
      <>{emailDialog}{emailRecoveryButton}<Empty data-testid="invoice-page-not-found">
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
      </Empty></>
    );
  }

  const record = move as RowValueMap;
  const state = variantTag(move.state);
  const isDraft = state === 'Draft';
  const label = String(move.name || '').trim() || t('accounting.invoices.draftName', { defaultValue: 'Draft' });
  const status = invoiceStatus(move, t);
  const listTab = KIND_TAB[kind];
  const partner = String(move.invoicePartnerDisplayName ?? move.invoice_partner_display_name ?? '').trim();
  const company = invoiceSellerCompanyFromQueryRow(companiesRead.rows.find((row) => String(row.id) === String(operatingCompanyId)));
  const capturedContent = readInvoiceDocumentContent(move.metadata, organizationId, kind === 'invoice' || kind === 'creditNote');
  const identityReady = isInvoiceSellerIdentityReady(company, operatingCompanyId, organizationId);
  const identityState = companiesRead.state.status === 'ready' && !identityReady ? { status: 'error' as const, message: 'The selected company identity is unavailable. Refresh before posting this invoice.' } : companiesRead.state;
  const currentDraftContent = outgoingDraft && invoicePersonalization.profile && identityReady
    ? resolveDraftInvoiceDocument(move.metadata, invoicePersonalization.profile, invoicePersonalization.profileVersionIds, invoiceSellerFromCompany(company, invoicePersonalization.profile))
    : null;
  const draftReviewState = outgoingDraft ? mergeModuleStates([identityState, invoicePersonalization.state]) : undefined;
  const draftContentError = currentDraftContent?.personalizationError ?? capturedContent.personalizationError;
  const draftReady = !outgoingDraft || draftReviewState?.status === 'ready' && Boolean(currentDraftContent?.personalization) && !draftContentError;
  const postingActions = headerActions.map((action) => outgoingDraft && !draftReady ? {
    ...action,
    blockedReason: () => draftContentError || 'Invoice settings must be available before posting. Refresh and review the current document.',
  } : action);
  const currency = invoiceRecordCurrency(move, currenciesRead.rows);
  const money = (value: unknown) => formatInvoiceMoney(invoiceRecordAmount(value), currency);
  const dateLabel = (value: unknown) => formatTimestampLike(value)?.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' }) ?? '—';
  const total = invoiceRecordAmount(move.amountTotal ?? move.amount_total);
  const residual = invoiceRecordAmount(move.amountResidual ?? move.amount_residual);
  const documentTitle = kind === 'bill' ? t('accounting.manualInvoice.billTitle', { defaultValue: 'Vendor bill' })
    : kind === 'invoice' ? t('accounting.manualInvoice.invoiceTitle', { defaultValue: 'Customer invoice' })
      : kind === 'creditNote' || kind === 'vendorCredit' ? t('accounting.invoices.creditNote', { defaultValue: 'Credit note' })
        : t('accounting.tabs.journalEntries', { defaultValue: 'Journal entry' });
  const detailBase = accountMoveDetailConfig(t);
  const detailConfig = {
    ...detailBase,
    sections: detailBase.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => ({
        ...field,
        width: 'full' as const,
        ...(field.type === 'currency' ? { render: (value: unknown) => money(value) } : {}),
      })),
    })),
  };

  const reviewedDocument = (
    <InvoiceDocument
                        title={documentTitle}
                        reference={label}
                        personalization={outgoingDraft ? currentDraftContent?.personalization : capturedContent.personalization}
                        notes={capturedContent.notes}
                        personalizationError={outgoingDraft ? draftContentError : capturedContent.personalizationError}
                        partnerLabel={kind === 'bill' || kind === 'vendorCredit' ? t('accounting.invoices.vendor', { defaultValue: 'Vendor' }) : t('accounting.invoices.customer', { defaultValue: 'Customer' })}
                        partner={partner || undefined}
                        date={dateLabel(move.invoiceDate ?? move.invoice_date ?? move.date)}
                        dueDate={dateLabel(move.invoiceDateDue ?? move.invoice_date_due)}
                        currency={currency}
                        lines={kind === 'entry' ? undefined : invoiceDocumentLines(lines)}
                        subtotal={invoiceRecordAmount(move.amountUntaxed ?? move.amount_untaxed)}
                        tax={invoiceRecordAmount(move.amountTax ?? move.amount_tax)}
                        total={total}
                        draft={isDraft}
                      />
  );
  const printReady = linesRead.state.status === 'ready' && companiesRead.state.status === 'ready' && currenciesRead.state.status === 'ready' && draftReady && !draftContentError;

  const saleOrderId = move.saleOrderId ?? move.sale_order_id;
  const purchaseOrder = (purchaseOrders as unknown as Row[]).find((order) =>
    sameCompany(order, operatingCompanyId) && Array.isArray(order.invoiceIds ?? order.invoice_ids)
      ? ((order.invoiceIds ?? order.invoice_ids) as unknown[]).map(String).includes(moveId)
      : false,
  );

  const withBusy = async (which: 'download' | 'archive', title: string, work: () => Promise<void>) => {
    try {
      setDocBusy(which);
      await work();
    } catch (error) {
      report(error, title);
    } finally {
      setDocBusy(null);
    }
  };

  const reconcilePayment = async () => {
    const candidates = reconcilablePaymentMoves(moves as unknown as Row[], move);
    const title = t('accounting.invoices.invoiceActions.reconcilePayment', { defaultValue: 'Reconcile payment' });
    const values = await askForm({
      title,
      description: t('accounting.invoices.reconcilePaymentHint', {
        defaultValue: 'Match a posted payment entry to this document. The lesser of the two open balances is applied.',
      }),
      fields: [
        {
          id: 'paymentMoveId',
          name: 'paymentMoveId',
          label: t('accounting.invoices.payment', { defaultValue: 'Payment' }),
          type: 'select',
          required: true,
          options: candidates.length > 0
            ? recordOptions(candidates, (row) => String(row.name || `#${row.id}`))
            : [{ value: '', disabled: true, label: t('accounting.invoices.noReconcilablePayments', { defaultValue: 'No posted payments available' }) }],
        },
      ],
    });
    const raw = formText(values?.paymentMoveId);
    if (raw == null) return;
    try {
      await workflow.reconcilePayment({ paymentMoveId: BigInt(raw), invoiceMoveId: BigInt(moveId) });
      showWorkflowToast({ kind: 'success', title, description: label });
    } catch (error) {
      report(error, title);
    }
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
      id: 'reconcile-payment',
      label: t('accounting.invoices.invoiceActions.reconcilePayment', { defaultValue: 'Reconcile payment' }),
      show: canReconcilePayment(move, kind) && checkPermission('account_move', 'write').allowed,
      run: reconcilePayment,
    },
    {
      id: 'cancel',
      label: t('accounting.invoices.invoiceActions.cancel', { defaultValue: 'Cancel document' }),
      show: canCancelMove(move),
      run: () => setCancelOpen(true),
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
  ].filter((action) => action.show);

  const canCreditNote = kind === 'invoice' && state === 'Posted';
  const linesBase = accountMoveLinesTableConfig(t, { accountLabelMap, sourceDocumentLabelMap });

  // Lines of a draft are editable; the totals are recomputed through the same command as "Recalculate totals".
  const refreshTotals = async () => {
    await queryClient.invalidateQueries({ queryKey: ['account-move-history', String(organizationId)] });
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
          id: 'bill-line-correct-economics',
          label: t('accounting.billCorrection.action'),
          requiresSelection: true,
          selection: 'single',
          isApplicable: (rows) => accountingBillCorrectionAvailable() && rows.length === 1 && checkPermission('account_move_line', 'write').allowed && checkPermission('account_move', 'write').allowed && billLineCorrectionSource(move as Row, rows[0], purchaseOrders as unknown as Row[], purchaseLines as unknown as Row[]) != null,
          onClick: async (rows) => {
            const line = rows[0];
            if (!line?.id) return;
            const source = billLineCorrectionSource(move as Row, line, purchaseOrders as unknown as Row[], purchaseLines as unknown as Row[]);
            if (!source) throw new Error(t('accounting.billCorrection.unavailable'));
            const values = await askForm({
              id: 'correct-po-bill-line',
              title: t('accounting.billCorrection.action'),
              description: t('accounting.billCorrection.description', { price: String(source.priceUnit ?? source.price_unit), received: String(source.qtyReceived ?? source.qty_received) }),
              fields: [
                { id: 'quantity', name: 'quantity', type: 'number', label: t('accounting.billCorrection.quantity'), required: true, defaultValue: Number(line.quantity) },
                { id: 'priceUnit', name: 'priceUnit', type: 'number', label: t('accounting.billCorrection.price'), required: true, defaultValue: Number(line.priceUnit ?? line.price_unit) },
              ],
            });
            if (!values) return;
            await updateLine.mutateAsync({ lineId: BigInt(String(line.id)), params: updateAccountMoveLineParamsToJson(billLineCorrectionParams(line, values, operatingCompanyId)) });
          },
        } satisfies EntityAction,
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
  const linesConfig = {
    ...linesBase,
    view: {
      ...linesView,
      columns: linesView.columns.map((column) => column.type === 'currency' ? {
        ...column,
        render: (value: unknown, row: Row) => formatInvoiceMoney(invoiceRecordAmount(value), invoiceRecordCurrency({
          currencyId: row.companyCurrencyId ?? row.company_currency_id,
        }, currenciesRead.rows)),
      } : column),
      actions: [...(linesView.actions ?? []), ...lineActions],
    },
  };

  return (
    <>
      {emailDialog}
      <ModuleDataNotice state={movesRead.state} />
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
            {canRegisterPayment(move, kind) ? (
              <Button size="sm" disabled={workflow.isPending} onClick={() => setRegisterOpen(true)} data-testid="invoice-action-register-payment">
                <CreditCard className="mr-1 h-4 w-4" />
                {t('accounting.invoices.invoiceActions.registerPayment', { defaultValue: 'Register payment' })}
              </Button>
            ) : null}
            <RecordWorkflowActions
              actions={postingActions}
              record={record}
              onRun={(action, row) => { if (outgoingDraft && !draftReady) return; void action.execute(action.prepare?.(row)).catch(() => undefined); }}
              primaryActionIds={new Set(['accounting.invoice.post'])}
              pendingActionIds={workflow.isPending ? new Set(headerActions.map((action) => action.id)) : undefined}
            />
            {kind === 'invoice' || kind === 'creditNote' ? <Button variant="outline" className="min-h-11" onClick={openEmailReview} disabled={!emailReview && !canQueueEmail} data-testid="invoice-action-send-email"><Mail className="mr-2 size-4" />Review email</Button> : null}
            <Button
              variant="outline"
              size="sm"
              disabled={docBusy != null}
              data-testid="invoice-action-download-pdf"
              onClick={() => void withBusy('download', t('accounting.invoices.invoiceActions.download'), () => downloadDocumentPdf('account-move', Number(moveId)))}
            >
              <Download className="mr-1 h-4 w-4" />
              {t('accounting.invoices.invoiceActions.download')}
            </Button>
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
            content: (
              <div className="space-y-6" data-testid="invoice-financial-overview">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: t('accounting.invoices.total', { defaultValue: 'Document total' }), value: money(total) },
                    { label: t('accounting.invoices.amountDue', { defaultValue: 'Amount due' }), value: money(residual) },
                    { label: t('accounting.invoices.dueDate', { defaultValue: 'Due date' }), value: dateLabel(move.invoiceDateDue ?? move.invoice_date_due) },
                  ].map((metric) => (
                    <div key={metric.label} className="min-w-0 rounded-xl border bg-card p-4">
                      <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                      <p className="mt-2 break-words text-xl font-semibold tracking-tight tabular-nums">{metric.value}</p>
                    </div>
                  ))}
                </div>
                <ModuleDataNotice state={currenciesRead.state} />
                <ModuleDataNotice state={companiesRead.state} />
                {outgoingDraft ? <><ModuleDataNotice state={draftReviewState} /><p className="text-xs text-muted-foreground">Customer billing details were captured when this draft was created; posting refreshes them from the linked customer. Posting also captures the latest company invoice settings shown in this review.</p></> : null}
                <FinanceReviewWorkspace
                  editorLabel={t('financeReview.savedDetails', { defaultValue: 'Saved details' })}
                  previewLabel={t('financeReview.sourceTitle', { defaultValue: 'Source document' })}
                  editor={<div className="min-w-0 space-y-6">
                  <div className="min-w-0 space-y-4 rounded-xl bg-muted/40 p-3 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                      <h2 className="text-sm font-medium">{t('accounting.invoices.documentPreview', { defaultValue: 'Document preview' })}</h2>
                      <span className="text-xs text-muted-foreground">{t('accounting.invoices.pdfHint', { defaultValue: 'Download PDF for the printable document' })}</span>
                    </div>
                    <ModuleDataNotice state={linesRead.state} />
                    {linesRead.state.status === 'loading' ? <Skeleton className="h-96 w-full" /> : null}
                    {linesRead.state.status === 'ready' || linesRead.state.status === 'partial' ? reviewedDocument : null}
                  </div>
                  <aside className="min-w-0 rounded-xl border bg-card p-4" aria-label={t('accounting.invoices.recordDetails', { defaultValue: 'Record details' })}>
                    <h2 className="mb-4 text-sm font-semibold">{t('accounting.invoices.recordDetails', { defaultValue: 'Record details' })}</h2>
                    <EntityDetail config={detailConfig} data={move} />
                  </aside>
                  </div>}
                  preview={<BillSourcePreview organizationId={orgId} companyId={operatingCompanyId} recordId={moveId} />}
                />
              </div>
            ),
          },
          {
            id: 'preview',
            label: t('accounting.invoices.preview', { defaultValue: 'Preview' }),
            content: (
              <div className="space-y-4" data-testid="invoice-preview-tab">
                <div className="flex justify-end"><Button variant="outline" size="sm" disabled={!printReady} onClick={printInvoice} data-testid="invoice-preview-print"><Printer className="mr-1 size-4" />{t('accounting.invoices.invoiceActions.print')}</Button></div>
                {reviewedDocument}
                {printReady ? <PrintableInvoice>{reviewedDocument}</PrintableInvoice> : null}
              </div>
            ),
          },
          {
            id: 'lines',
            label: t('accounting.tabs.moveLines'),
            content: (
              <div className="space-y-4">
                <ModuleDataNotice state={linesRead.state} />
                <ModuleDataNotice state={accountsRead.state} />
                {linesRead.state.status === 'loading' ? <Skeleton className="h-64 w-full" /> : null}
                {linesRead.state.status === 'ready' || linesRead.state.status === 'partial' ? (
                  <EntityView config={{ ...linesConfig, title: '', description: undefined }} data={lines} useCard={false} />
                ) : null}
              </div>
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
            id: 'changes',
            label: t('recordChanges.title'),
            content: <AccountMoveChanges organizationId={organizationId} companyId={operatingCompanyId} recordId={moveId} />,
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
