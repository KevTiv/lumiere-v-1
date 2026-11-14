'use client';

import { AskAboutRecordButton } from '@/components/ask-about-record-button';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useErpSession } from '@lumiere/erp-session';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Eye, Layers, MoreHorizontal, PenLine } from 'lucide-react';
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
  useRBAC,
  setDocumentRetentionForm,
  uploadDocumentVersionForm,
  type FormConfig,
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
import { FileIdentity } from '@lumiere/ui/components/file-identity';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@lumiere/ui/components/dropdown-menu';
import { moduleQueryState } from '@lumiere/ui/lib/module-data-state';
import { ModuleDataNotice } from '@lumiere/ui/pages/module-data-notice';
import { formatTimestampLike } from '@lumiere/ui/lib/entity-row-values';
import { Textarea } from '@lumiere/ui/components/textarea';
import { useConfirmDialog } from '@lumiere/ui/hooks/use-confirm-dialog';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import { optionalBigIntU64 } from '@lumiere/erp-shared/form-coercion';
import {
  useDeleteDocument,
  useApplyDocumentLegalHold,
  useCreateDocumentSignatureRequest,
  useDeletedDocuments,
  useDocumentExternalRefs,
  useDocumentLegalHolds,
  useDocumentSignatureRequests,
  useReleaseDocumentLegalHold,
  useDocumentFolders,
  useDocumentVersions,
  useDocuments,
  useLockDocument,
  useRestoreDocument,
  useSetDocumentRetention,
  useUnlockDocument,
  useUpdateDocument,
} from '@lumiere/query-hooks/hooks/documents';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { useDocumentLocationMutation } from '@lumiere/query-hooks/hooks/document-locations';
import { firstFileFromFormValue } from '@/lib/document-blob-upload';
import { useManagedDocumentUpload } from '@/lib/use-managed-document-upload';
import { DocumentUploadReceipts } from '../../../../components/document-upload-receipts';
import { DocumentViewerDialog } from '../../../../components/document-viewer-dialog';
import { toSetDocumentRetentionParams } from '@/lib/documents-create-params';
import { useDocumentsModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { documentFolderRowsToSelectOptions } from '@/lib/form-lookup';
import {
  activeLegalHold,
  externalRefRows,
  legalHoldReason,
  linkedRecordHref,
  moveDocumentParams,
  rowsForDocument,
  signatureRequestRows,
} from '../document-record';
import { documentAttachmentLabel, documentFileIdentity } from '../document-presentation';
import { canRequestSignature, toSignatureRequestParams } from '../signature-request';
import { documentBrowserReturnHref } from '../document-browser-navigation';

interface DocumentPageClientProps {
  documentId: string;
  initialDocuments?: unknown[];
  initialDeleted?: unknown[];
  initialVersions?: unknown[];
  organizationId?: number;
}

type Row = Record<string, unknown>;
type FormAction = 'edit' | 'uploadVersion' | 'setRetention' | 'move' | 'legalHold' | 'requestSignature';

const TAB_IDS = ['overview', 'versions', 'signatures', 'externalRefs', 'discussion', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

export function DocumentPageClient(props: DocumentPageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <DocumentPageLoaded {...props} organizationId={props.organizationId} />;
}

function editDocumentForm(row: Row): FormConfig {
  return {
    id: 'edit-document',
    title: 'Update document',
    submitLabel: 'Update document',
    sections: [
      {
        id: 'document',
        fields: [
          { id: 'doc-name', name: 'name', type: 'text', label: 'Name', required: true, defaultValue: String(row.name ?? ''), width: 'full' },
          { id: 'doc-description', name: 'description', type: 'textarea', label: 'Description', defaultValue: String(row.description ?? ''), rows: 3, width: 'full' },
          { id: 'doc-favorite', name: 'isFavorite', type: 'checkbox', label: 'Favorite', defaultValue: Boolean(row.isFavorite), width: '1/2' },
        ],
      },
    ],
  };
}

function moveDocumentForm(row: Row, folders: Array<{ value: string; label: string }>, rootLabel: string): FormConfig {
  return {
    id: 'move-document',
    title: 'Move to folder',
    submitLabel: 'Move',
    sections: [
      {
        id: 'move',
        fields: [
          {
            id: 'doc-folder',
            name: 'folderId',
            type: 'select',
            label: 'Folder',
            required: true,
            defaultValue: row.folderId == null ? '__root__' : String(row.folderId),
            options: [{ value: '__root__', label: rootLabel }, ...folders],
            width: 'full',
          },
        ],
      },
    ],
  };
}

function legalHoldForm(): FormConfig {
  return {
    id: 'document-legal-hold',
    title: 'Apply legal hold',
    submitLabel: 'Apply hold',
    sections: [
      {
        id: 'hold',
        fields: [{ id: 'hold-reason', name: 'reason', type: 'textarea', label: 'Reason', required: true, rows: 3, width: 'full' }],
      },
    ],
  };
}

function requestSignatureForm(t: ReturnType<typeof useTranslation>['t']): FormConfig {
  return {
    id: 'document-request-signature',
    title: t('documents.page.requestSignatureTitle', { defaultValue: 'Request signature' }),
    description: t('documents.page.requestSignatureHint', {
      defaultValue: 'Record the e-signature envelope created with your provider for this document.',
    }),
    submitLabel: t('documents.page.requestSignature', { defaultValue: 'Request signature' }),
    sections: [
      {
        id: 'signature',
        fields: [
          {
            id: 'sig-provider',
            name: 'provider',
            type: 'text',
            label: t('documents.page.signatureProvider', { defaultValue: 'Provider' }),
            placeholder: 'DocuSign',
            required: true,
            width: '1/2',
          },
          {
            id: 'sig-envelope',
            name: 'externalEnvelopeId',
            type: 'text',
            label: t('documents.page.signatureEnvelope', { defaultValue: 'Envelope ID' }),
            required: true,
            width: '1/2',
          },
          {
            id: 'sig-signers',
            name: 'signers',
            type: 'textarea',
            label: t('documents.page.signatureSigners', { defaultValue: 'Signers (optional)' }),
            description: t('documents.page.signatureSignersHint', {
              defaultValue: 'One e-mail address per line.',
            }),
            rows: 3,
            width: 'full',
          },
        ],
      },
    ],
  };
}

function DocumentPageLoaded({
  documentId,
  initialDocuments,
  initialDeleted,
  initialVersions,
  organizationId,
}: DocumentPageClientProps & { organizationId: number }) {
  useDocumentsModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filesHref = documentBrowserReturnHref(searchParams.get('returnTo'));
  const { orgId } = orgBigInts(organizationId);
  const session = useErpSession();
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n;

  const documentsQuery = useDocuments(orgId, initialDocuments as never);
  const deletedQuery = useDeletedDocuments(orgId, initialDeleted as never);
  const { data: documents = [], isLoading } = documentsQuery;
  const { data: deleted = [] } = deletedQuery;
  const { data: folders = [] } = useDocumentFolders(orgId);
  const versionsQuery = useDocumentVersions(orgId, initialVersions as never);
  const { data: versions = [] } = versionsQuery;
  const holdsQuery = useDocumentLegalHolds(orgId);
  const signaturesQuery = useDocumentSignatureRequests(orgId);
  const externalRefsQuery = useDocumentExternalRefs(orgId);

  const lockDocument = useLockDocument(orgId);
  const unlockDocument = useUnlockDocument(orgId);
  const updateDocument = useUpdateDocument(orgId);
  const deleteDocument = useDeleteDocument(orgId);
  const restoreDocument = useRestoreDocument(orgId);
  const setRetention = useSetDocumentRetention(orgId);
  const applyLegalHold = useApplyDocumentLegalHold(orgId);
  const releaseLegalHold = useReleaseDocumentLegalHold(orgId);
  const createSignatureRequest = useCreateDocumentSignatureRequest(orgId);
  const { checkPermission, permissionsReady, currentUser } = useRBAC();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const releaseNoteRef = useRef<HTMLTextAreaElement | null>(null);

  const [formAction, setFormAction] = useState<FormAction | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [preview, setPreview] = useState<{ versionId?: string } | null>(null);

  const document = useMemo(
    () =>
      ([...(documents as unknown as Row[]), ...(deleted as unknown as Row[])]).find(
        (row) => String(row.id) === documentId,
      ),
    [documents, deleted, documentId],
  );
  const documentVersions = useMemo(
    () =>
      (versions as unknown as Row[])
        .filter((row) => String(row.documentId ?? row.document_id ?? '') === documentId)
        .sort((a, b) => Number(b.versionNumber ?? 0) - Number(a.versionNumber ?? 0)),
    [versions, documentId],
  );

  const uploads = useManagedDocumentUpload(orgId, operatingCompanyId, { enabled: Boolean(document) && document?.isDeleted !== true, contextKey: documentId });
  const versionReceipts = uploads.rows.filter(({ receipt, pointer }) => (receipt?.registration ?? pointer.target)?.versionDocumentId === documentId);
  const moveDocument = useDocumentLocationMutation(orgId, operatingCompanyId, (action) => {
    uploads.assertCurrent('version');
    if (action.kind !== 'moveDocument' || String(action.id) !== documentId ||
      String(document?.organizationId) !== String(orgId) ||
      (document?.companyId != null && String(document.companyId) !== String(operatingCompanyId))) {
      throw new Error('The document workspace changed. Reopen this action.');
    }
  });
  useEffect(() => {
    setFormAction(null);
    setFormError(null);
    setPreview(null);
  }, [orgId, operatingCompanyId, documentId, session.identity, uploads.canVersion]);

  const activeHold = useMemo(
    () => activeLegalHold((holdsQuery.data ?? []) as unknown as Row[], documentId),
    [holdsQuery.data, documentId],
  );
  const signatures = useMemo(
    () => signatureRequestRows(rowsForDocument((signaturesQuery.data ?? []) as unknown as Row[], documentId)),
    [signaturesQuery.data, documentId],
  );
  const externalRefs = useMemo(
    () => externalRefRows(rowsForDocument((externalRefsQuery.data ?? []) as unknown as Row[], documentId)),
    [externalRefsQuery.data, documentId],
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

  const run = useCallback(async (title: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      showWorkflowToast({
        kind: 'error',
        title,
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  if (!document) {
    if (isLoading || deletedQuery.isLoading) {
      return (
        <div className="space-y-4" data-testid="document-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96 max-w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    if (documentsQuery.isError || deletedQuery.isError) {
      return <ModuleDataNotice state={moduleQueryState(documentsQuery.isError ? documentsQuery : deletedQuery)} />;
    }
    return (
      <Empty data-testid="document-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('documents.notFound', { defaultValue: 'Document not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('documents.notFoundHint', { defaultValue: 'It may have been purged, or belong to another organization.' })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={filesHref} />} nativeButton={false}>
            {t('documents.backToDocuments', { defaultValue: 'Back to documents' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const id = BigInt(documentId);
  const isDeleted = document.isDeleted === true;
  const isLocked = document.isLocked === true;
  const url = typeof document.url === 'string' && document.url ? document.url : undefined;
  const file = documentFileIdentity(document);
  const label = file.title || file.fileName || `#${documentId}`;
  const linkedHref = linkedRecordHref(document);
  const relatedLabel = documentAttachmentLabel(document, t);
  const folderName = folders.find((folder) => String(folder.id) === String(document.folderId))?.name;
  const locationLabel = document.folderId == null
    ? t('documents.fileManagement.root', { defaultValue: 'Root folder' })
    : folderName ?? t('documents.page.folderUnavailable', { defaultValue: 'Folder unavailable' });
  const detailConfig = {
    mode: 'detail' as const,
    sections: [
      {
        id: 'document',
        fields: [
          { key: 'resName', label: t('documents.documents.columns.resName', { defaultValue: 'Attached to' }), render: () => linkedHref
            ? <Link className="text-primary underline underline-offset-2" href={linkedHref}>{relatedLabel}</Link>
            : relatedLabel },
          { key: 'folderId', label: t('documents.page.folder', { defaultValue: 'Folder' }), render: () => locationLabel },
          { key: 'createDate', label: t('documents.documents.columns.createDate'), type: 'date' as const },
          { key: 'retentionDays', label: t('documents.documents.columns.retentionDays'), type: 'number' as const },
          { key: 'fiscalKind', label: t('documents.documents.columns.fiscalKind') },
          { key: 'residencyRegion', label: t('documents.documents.columns.residencyRegion') },
          { key: 'description', width: 'full' as const, type: 'markdown' as const, label: t('documents.documents.columns.description', { defaultValue: 'Description' }) },
        ],
      },
    ],
  };

  const isHeld = Boolean(activeHold);
  const holdReason = activeHold && typeof activeHold.reason === 'string' ? activeHold.reason : undefined;
  const holdDate = activeHold?.heldAt ?? activeHold?.held_at;

  const releaseHold = async () => {
    if (!activeHold) return;
    const ok = await confirm({
      title: t('documents.page.releaseHoldTitle', { defaultValue: 'Release legal hold?' }),
      description: (
        <span className="block space-y-2">
          <span className="block">
            {t('documents.page.releaseHoldHint', {
              defaultValue: 'The document can be changed, deleted or purged again once the hold is released.',
            })}
          </span>
          <Textarea
            ref={releaseNoteRef}
            rows={2}
            defaultValue=""
            placeholder={t('documents.page.releaseNote', { defaultValue: 'Note (optional)' })}
            data-testid="document-release-hold-note"
          />
        </span>
      ),
      confirmLabel: t('documents.page.releaseHold', { defaultValue: 'Release hold' }),
    });
    const note = releaseNoteRef.current?.value.trim();
    if (!ok) return;
    await run('Release legal hold', async () => {
      await releaseLegalHold.mutateAsync({ holdId: activeHold.id as bigint | number | string, metadata: note || undefined });
      showWorkflowToast({ kind: 'success', title: 'Legal hold released', description: label });
    });
  };

  const formConfig: FormConfig | null =
    formAction === 'edit'
      ? editDocumentForm(document)
      : formAction === 'uploadVersion'
        ? uploadDocumentVersionForm(t)
        : formAction === 'setRetention'
          ? setDocumentRetentionForm(t)
          : formAction === 'move'
            ? moveDocumentForm(document, documentFolderRowsToSelectOptions(folders as unknown as Row[]), t('documents.fileManagement.root', { defaultValue: 'Root folder' }))
            : formAction === 'legalHold'
              ? legalHoldForm()
              : formAction === 'requestSignature'
                ? requestSignatureForm(t)
                : null;

  const submitForm = async (formData: Record<string, unknown>) => {
    setFormError(null);
    try {
      if (formAction === 'edit') {
        await updateDocument.mutateAsync({
          documentId: id,
          params: {
            name: formData.name,
            description: formData.description,
            isFavorite: Boolean(formData.isFavorite),
            folderId: optionalBigIntU64(document.folderId),
          },
        });
      } else if (formAction === 'uploadVersion') {
        const file = firstFileFromFormValue(formData.file);
        if (!file) throw new Error('Select a file to upload');
        const residency = typeof document.residencyRegion === 'string' ? document.residencyRegion : undefined;
        uploads.assertCurrent("version");
        const receipt = await uploads.submit(file, {
          name: file.name, tagIds: [], isFavorite: false, versionDocumentId: String(id),
          changesDescription: typeof formData.changesDescription === "string" ? formData.changesDescription.trim() || undefined : undefined,
        }, residency);
        if (formData.unlockAfter !== false) await uploads.releaseVersionLock(receipt);
      } else if (formAction === 'setRetention') {
        await setRetention.mutateAsync({ documentId: id, params: toSetDocumentRetentionParams(formData) });
      } else if (formAction === 'move') {
        const params = moveDocumentParams(formData.folderId);
        if (!params) throw new Error('Select a folder');
        if (params.folderId !== null && !folders.some((folder) => String(folder.id) === params.folderId)) throw new Error('Select an available folder');
        await moveDocument.mutateAsync({ kind: 'moveDocument', id, folderId: params.folderId });
      } else if (formAction === 'legalHold') {
        const reason = legalHoldReason(formData.reason);
        if (!reason) throw new Error('A reason is required');
        await applyLegalHold.mutateAsync({ documentId: id, reason });
        showWorkflowToast({ kind: 'success', title: 'Legal hold', description: label });
      } else if (formAction === 'requestSignature') {
        const result = toSignatureRequestParams(formData);
        if (!result.ok) {
          throw new Error(
            result.reason === 'provider'
              ? t('documents.page.signatureProviderRequired', { defaultValue: 'A provider is required' })
              : result.reason === 'envelope'
                ? t('documents.page.signatureEnvelopeRequired', { defaultValue: 'An envelope ID is required' })
                : t('documents.page.signatureSignersInvalid', { defaultValue: 'Enter valid e-mail addresses, one per line' }),
          );
        }
        // The hook types the options as plain strings; the params struct needs explicit SATS options.
        await createSignatureRequest.mutateAsync({
          documentId: id,
          params: result.params as unknown as Parameters<typeof createSignatureRequest.mutateAsync>[0]['params'],
        });
        showWorkflowToast({
          kind: 'success',
          title: t('documents.page.requestSignatureDone', { defaultValue: 'Signature requested' }),
          description: label,
        });
      }
      setFormAction(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const busy =
    lockDocument.isPending || unlockDocument.isPending || deleteDocument.isPending || restoreDocument.isPending;

  return (
    <>
      <DocumentUploadReceipts rows={versionReceipts} error={uploads.error} onResume={uploads.resume} />
      <DocumentViewerDialog organizationId={orgId} documentId={preview ? documentId : null} versionId={preview?.versionId} onOpenChange={(open) => { if (!open) setPreview(null); }} />
      <RecordPage
        testIdPrefix="document"
        breadcrumbs={[
          { label: t('nav.documents', { defaultValue: 'Documents' }), href: '/documents' },
          { label: t('documents.documents.title'), href: filesHref },
          { label },
        ]}
        title={label}
        subtitle={
          <FileIdentity
            {...file}
            showTitle={false}
            showFileName={file.fileName !== label}
            status={!url ? t('documents.attachments.unavailable', { defaultValue: 'File unavailable' }) : undefined}
          />
        }
        badge={
          <span className="flex flex-wrap items-center gap-1.5">
            {isDeleted ? <Badge variant="destructive">{t('documents.page.deleted', { defaultValue: 'In recycle bin' })}</Badge> : null}
            {isHeld ? <Badge variant="destructive" data-testid="document-legal-hold-badge">{t('documents.page.legalHoldBadge', { defaultValue: 'Legal hold' })}</Badge> : null}
            {isLocked ? <Badge variant="outline">{t('documents.page.locked', { defaultValue: 'Locked' })}</Badge> : null}
            {document.isShared === true ? <Badge variant="secondary">{t('documents.page.shared', { defaultValue: 'Shared' })}</Badge> : null}
            {document.isFavorite === true ? <Badge variant="secondary">{t('documents.page.favorite', { defaultValue: 'Favorite' })}</Badge> : null}
          </span>
        }
        smartButtons={
          <SmartButtons
            testIdPrefix="document"
            buttons={[
              {
                id: 'versions',
                label: t('documents.page.versions', { defaultValue: 'Versions' }),
                count: documentVersions.length,
                icon: <Layers className="h-4 w-4" />,
                onClick: () => setActiveTab('versions'),
              },
              ...(signatures.length > 0
                ? [
                    {
                      id: 'signatures',
                      label: t('documents.page.signatures', { defaultValue: 'Signatures' }),
                      count: signatures.length,
                      icon: <PenLine className="h-4 w-4" />,
                      onClick: () => setActiveTab('signatures'),
                    },
                  ]
                : []),
            ]}
          />
        }
        actions={
          <>
            {!isDeleted && !documentsQuery.isError && permissionsReady === true
              && session.activeCompanyReady && session.organizationId === organizationId
              && Boolean(session.identity) && currentUser?.id === session.identity
              && checkPermission('document', 'read').allowed ? (
                <AskAboutRecordButton entityType="document" recordId={documentId} label={label} activeTab={activeTab} />
              ) : null}
            {url ? (
              <Button
                size="sm"
                onClick={() => setPreview({})}
                data-testid="document-action-open"
              >
                <Eye className="mr-1 h-4 w-4" aria-hidden />
                {t('documents.viewer.open', { defaultValue: 'Preview file' })}
              </Button>
            ) : null}
            {isDeleted ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                data-testid="document-action-restore"
                onClick={() => void run('Restore', () => restoreDocument.mutateAsync(id))}
              >
                {t('documents.page.restore', { defaultValue: 'Restore' })}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!uploads.canVersion || uploads.pending}
                  data-testid="document-action-upload-version"
                  onClick={() => setFormAction('uploadVersion')}
                >
                  {t('documents.page.uploadVersion', { defaultValue: 'Upload version' })}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <MoreHorizontal className="size-4" aria-hidden />
                      {t('documents.page.manage', { defaultValue: 'Manage' })}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
                    <DropdownMenuItem data-testid="document-action-edit" onSelect={() => setFormAction('edit')}>
                      {t('documents.page.edit', { defaultValue: 'Edit details' })}
                    </DropdownMenuItem>
                    <DropdownMenuItem data-testid="document-action-move" onSelect={() => setFormAction('move')}>
                      {t('documents.page.move', { defaultValue: 'Move to folder' })}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy}
                      data-testid={isLocked ? 'document-action-unlock' : 'document-action-lock'}
                      onSelect={() => void run(isLocked ? 'Unlock' : 'Lock', () =>
                        isLocked ? unlockDocument.mutateAsync(id) : lockDocument.mutateAsync(id),
                      )}
                    >
                      {isLocked ? t('documents.page.unlock', { defaultValue: 'Unlock' }) : t('documents.page.lock', { defaultValue: 'Lock' })}
                    </DropdownMenuItem>
                    <DropdownMenuItem data-testid="document-action-retention" onSelect={() => setFormAction('setRetention')}>
                      {t('documents.page.setRetention', { defaultValue: 'Set retention' })}
                    </DropdownMenuItem>
                    {isHeld ? (
                      <DropdownMenuItem
                        disabled={releaseLegalHold.isPending}
                        data-testid="document-action-release-hold"
                        onSelect={() => void releaseHold()}
                      >
                        {t('documents.page.releaseHold', { defaultValue: 'Release hold' })}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem data-testid="document-action-legal-hold" onSelect={() => setFormAction('legalHold')}>
                        {t('documents.page.legalHold', { defaultValue: 'Legal hold' })}
                      </DropdownMenuItem>
                    )}
                    {canRequestSignature(document) && checkPermission('document', 'write').allowed ? (
                      <DropdownMenuItem data-testid="document-action-request-signature" onSelect={() => setFormAction('requestSignature')}>
                        {t('documents.page.requestSignature', { defaultValue: 'Request signature' })}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      disabled={busy || isHeld}
                      data-testid="document-action-delete"
                      onSelect={() => setConfirmDelete(true)}
                    >
                      {t('documents.page.deleteAction', { defaultValue: 'Move to recycle bin' })}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </>
        }
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'overview',
            label: t('common.overview', { defaultValue: 'Overview' }),
            content: (
              <div className="space-y-4">
                {isHeld ? (
                  <div className="rounded-md border p-3 text-sm" data-testid="document-legal-hold-row">
                    <p className="font-medium">{t('documents.page.legalHoldActive', { defaultValue: 'Legal hold' })}</p>
                    {holdReason ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{t('documents.page.holdReason', { defaultValue: 'Reason' })}: {holdReason}</p> : null}
                    {holdDate != null ? (
                      <p>{t('documents.page.holdDate', { defaultValue: 'Held since' })}: {formatHoldDate(holdDate)}</p>
                    ) : null}
                    <p className="mt-2 text-muted-foreground">{t('documents.page.heldHint', { defaultValue: 'Release the legal hold before moving this file to the recycle bin.' })}</p>
                  </div>
                ) : null}
                <EntityDetail config={detailConfig} data={document} />
              </div>
            ),
          },
          {
            id: 'versions',
            label: t('documents.page.versions', { defaultValue: 'Versions' }),
            content: versionsQuery.isLoading
              ? <p role="status" className="text-sm text-muted-foreground">{t('common.loading', { defaultValue: 'Loading…' })}</p>
              : versionsQuery.isError
                ? <ModuleDataNotice state={moduleQueryState(versionsQuery)} />
                : (
              <EntityView
                config={{
                  id: 'document-versions-table',
                  title: '',
                  view: {
                    mode: 'table',
                    rowKey: 'id',
                    columns: [
                      { key: 'versionNumber', label: '#', type: 'number', align: 'right' },
                      { key: 'fileName', label: t('documents.documents.columns.fileName'), layout: { min: 16, preferred: 23, grow: 2 }, render: (value: unknown, row: Row) => (
                        <FileIdentity
                          fileName={typeof value === 'string' ? value : undefined}
                          mimetype={typeof row.mimetype === 'string' ? row.mimetype : undefined}
                          size={row.fileSize}
                          status={row.isCurrent === true ? t('documents.viewer.currentVersion', { defaultValue: 'Current version' }) : undefined}
                          onOpen={() => setPreview({ versionId: String(row.id) })}
                        />
                      ) },
                      { key: 'changesDescription', label: t('documents.page.versionChanges', { defaultValue: 'Changes' }), layout: { min: 12, preferred: 18, grow: 1, wrap: 3 } },
                      { key: 'createdAt', label: 'Created', type: 'date' },
                    ],
                    emptyMessage: t('documents.page.noVersions', { defaultValue: 'No versions yet' }),
                  },
                }}
                data={documentVersions}
                useCard={false}
              />
            ),
          },
          {
            id: 'signatures',
            label: t('documents.page.signatures', { defaultValue: 'Signatures' }),
            content: (
              <DocumentRowsTab
                loading={signaturesQuery.isLoading}
                error={signaturesQuery.isError}
                id="document-signatures-table"
                rows={signatures}
                emptyMessage={t('documents.page.noSignatures', { defaultValue: 'No signature requests' })}
                errorMessage={t('documents.page.loadError', { defaultValue: 'Could not load this data.' })}
                columns={[
                  { key: 'status', label: t('documents.page.signatureStatus', { defaultValue: 'Status' }) },
                  { key: 'requestedAt', label: t('documents.page.signatureRequested', { defaultValue: 'Requested' }), type: 'date' },
                  { key: 'completedAt', label: t('documents.page.signatureCompleted', { defaultValue: 'Completed' }), type: 'date' },
                  { key: 'signerCount', label: t('documents.page.signerCount', { defaultValue: 'Signers' }), type: 'number', align: 'right' },
                ]}
              />
            ),
          },
          {
            id: 'externalRefs',
            label: t('documents.page.externalRefs', { defaultValue: 'External references' }),
            content: (
              <DocumentRowsTab
                loading={externalRefsQuery.isLoading}
                error={externalRefsQuery.isError}
                id="document-external-refs-table"
                rows={externalRefs}
                emptyMessage={t('documents.page.noExternalRefs', { defaultValue: 'No external references' })}
                errorMessage={t('documents.page.loadError', { defaultValue: 'Could not load this data.' })}
                columns={[
                  { key: 'provider', label: t('documents.page.refSystem', { defaultValue: 'System' }) },
                  { key: 'externalId', label: t('documents.page.refExternalId', { defaultValue: 'External ID' }) },
                  { key: 'lastDirection', label: t('documents.page.refDirection', { defaultValue: 'Last sync direction' }) },
                  { key: 'lastSyncAt', label: t('documents.page.refLastSync', { defaultValue: 'Last synced' }), type: 'date' },
                ]}
              />
            ),
          },
          {
            id: 'discussion',
            label: t('documents.page.discussion', { defaultValue: 'Discussion' }),
            content: (
              <div className="max-w-2xl" data-testid="document-discussion">
                <RecordChatter organizationId={organizationId} resModel="document" resId={id} recordTitle={label} />
              </div>
            ),
          },
          {
            id: 'audit',
            label: t('businessHistory.title', { defaultValue: 'History & sources' }),
            content: <RecordAuditTab tableName="document" recordId={documentId} />,
          },
        ]}
      />

      {formConfig ? (
        <FormModal
          key={formAction}
          open
          onOpenChange={(open) => {
            if (!open) {
              setFormAction(null);
              setFormError(null);
            }
          }}
          config={formConfig}
          isPending={uploads.pending || moveDocument.isPending || updateDocument.isPending || setRetention.isPending || applyLegalHold.isPending || createSignatureRequest.isPending}
          closeOnSubmit={false}
          submitError={formError}
          onSubmit={submitForm}
        />
      ) : null}

      {confirmDialog}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid="document-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('documents.page.deleteTitle', { defaultValue: 'Move to recycle bin?' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('documents.page.deleteHint', { defaultValue: 'You can restore it from the recycle bin.' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('erpWorkflow.confirm.dismiss')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDelete(false);
                void run('Delete', () => deleteDocument.mutateAsync(id));
              }}
            >
              {t('documents.page.delete', { defaultValue: 'Delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function formatHoldDate(value: unknown): string {
  return formatTimestampLike(value)?.toLocaleDateString() ?? '';
}

function DocumentRowsTab({
  loading,
  error,
  id,
  rows,
  columns,
  emptyMessage,
  errorMessage,
}: {
  loading: boolean;
  error: boolean;
  id: string;
  rows: Row[];
  columns: Array<{ key: string; label: string; type?: 'date' | 'number'; align?: 'right' }>;
  emptyMessage: string;
  errorMessage: string;
}) {
  if (loading) return <Skeleton className="h-24 w-full" data-testid={`${id}-loading`} />;
  if (error) return <p className="text-sm text-destructive" data-testid={`${id}-error`}>{errorMessage}</p>;
  return (
    <EntityView
      config={{ id, title: '', view: { mode: 'table', rowKey: 'id', columns, emptyMessage } }}
      data={rows}
      useCard={false}
    />
  );
}
