'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, Layers, Link2, PenLine } from 'lucide-react';
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
  buildModuleTabHref,
  documentsTableConfig,
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
import { formatTimestampLike } from '@lumiere/ui/lib/entity-row-values';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import { optionalBigIntU64 } from '@lumiere/erp-shared/form-coercion';
import {
  useAddDocumentVersion,
  useDeleteDocument,
  useApplyDocumentLegalHold,
  useDeletedDocuments,
  useDocumentExternalRefs,
  useDocumentLegalHolds,
  useDocumentSignatureRequests,
  useDocumentFolders,
  useDocumentVersions,
  useDocuments,
  useIngestDocumentEvidence,
  useLockDocument,
  useRestoreDocument,
  useSetDocumentRetention,
  useUnlockDocument,
  useUpdateDocument,
} from '@lumiere/query-hooks/hooks/documents';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { firstFileFromFormValue, uploadDocumentBlob } from '@/lib/document-blob-upload';
import { toAddDocumentVersionParams, toSetDocumentRetentionParams } from '@/lib/documents-create-params';
import { useDocumentsModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { documentFolderRowsToSelectOptions } from '@/lib/form-lookup';
import {
  activeLegalHold,
  externalRefRows,
  formatFileSize,
  legalHoldReason,
  linkedRecordHref,
  moveDocumentParams,
  rowsForDocument,
  signatureRequestRows,
} from '../document-record';

interface DocumentPageClientProps {
  documentId: string;
  initialDocuments?: unknown[];
  initialDeleted?: unknown[];
  initialVersions?: unknown[];
  organizationId?: number;
}

type Row = Record<string, unknown>;
type FormAction = 'edit' | 'uploadVersion' | 'setRetention' | 'move' | 'legalHold';

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

function moveDocumentForm(row: Row, folders: Array<{ value: string; label: string }>): FormConfig {
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
            defaultValue: row.folderId == null ? '' : String(row.folderId),
            options: folders,
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
  const { orgId } = orgBigInts(organizationId);
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n;

  const { data: documents = [], isLoading } = useDocuments(orgId, initialDocuments as never);
  const { data: deleted = [] } = useDeletedDocuments(orgId, initialDeleted as never);
  const { data: folders = [] } = useDocumentFolders(orgId);
  const { data: versions = [] } = useDocumentVersions(orgId, initialVersions as never);
  const holdsQuery = useDocumentLegalHolds(orgId);
  const signaturesQuery = useDocumentSignatureRequests(orgId);
  const externalRefsQuery = useDocumentExternalRefs(orgId);

  const lockDocument = useLockDocument(orgId);
  const unlockDocument = useUnlockDocument(orgId);
  const updateDocument = useUpdateDocument(orgId);
  const deleteDocument = useDeleteDocument(orgId);
  const restoreDocument = useRestoreDocument(orgId);
  const addVersion = useAddDocumentVersion(orgId);
  const ingestEvidence = useIngestDocumentEvidence(orgId);
  const setRetention = useSetDocumentRetention(orgId);
  const applyLegalHold = useApplyDocumentLegalHold(orgId);

  const [formAction, setFormAction] = useState<FormAction | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    if (isLoading) {
      return (
        <div className="space-y-4" data-testid="document-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
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
          <Button variant="outline" render={<Link href={buildModuleTabHref('documents', 'documents')} />} nativeButton={false}>
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
  const label = String(document.name || document.fileName || `#${documentId}`);
  const linkedHref = linkedRecordHref(document);

  const table = documentsTableConfig(t);
  const columns = table.view.mode === 'table' ? table.view.columns : [];
  const detailConfig = {
    mode: 'detail' as const,
    sections: [
      {
        id: 'document',
        fields: [
          ...columns.map(({ width: _width, ...field }) =>
            field.key === 'fileSize' ? { ...field, render: (value: unknown) => formatFileSize(value) } : field,
          ),
          { key: 'resName', label: t('documents.documents.columns.resName', { defaultValue: 'Attached to' }) },
          { key: 'description', label: t('documents.documents.columns.description', { defaultValue: 'Description' }) },
        ],
      },
    ],
  };

  const isHeld = Boolean(activeHold);
  const holdReason = activeHold && typeof activeHold.reason === 'string' ? activeHold.reason : undefined;
  const holdDate = activeHold?.heldAt ?? activeHold?.held_at;
  const heldTitle = t('documents.page.heldHint', {
    defaultValue: 'Not allowed while a legal hold is active. Release the hold first.',
  });

  const formConfig: FormConfig | null =
    formAction === 'edit'
      ? editDocumentForm(document)
      : formAction === 'uploadVersion'
        ? uploadDocumentVersionForm(t)
        : formAction === 'setRetention'
          ? setDocumentRetentionForm(t)
          : formAction === 'move'
            ? moveDocumentForm(document, documentFolderRowsToSelectOptions(folders as unknown as Row[]))
            : formAction === 'legalHold'
              ? legalHoldForm()
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
        const uploaded = await uploadDocumentBlob({ file, companyId: operatingCompanyId, residency });
        const params = toAddDocumentVersionParams({
          ...formData,
          fileName: uploaded.fileName,
          fileSize: uploaded.fileSize,
          mimetype: uploaded.mimetype,
          url: uploaded.url,
          checksum: uploaded.checksum,
        });
        if (!params) throw new Error('Version params incomplete after upload');
        await addVersion.mutateAsync({ documentId: id, params });
        await ingestEvidence.mutateAsync({
          companyId: operatingCompanyId,
          documentId: id,
          language: typeof formData.language === 'string' ? formData.language : undefined,
        });
        // unlock_document rejects an already-unlocked document, so only release a lock held now.
        if (formData.unlockAfter !== false && isLocked) await unlockDocument.mutateAsync(id);
      } else if (formAction === 'setRetention') {
        await setRetention.mutateAsync({ documentId: id, params: toSetDocumentRetentionParams(formData) });
      } else if (formAction === 'move') {
        const params = moveDocumentParams(formData.folderId);
        if (!params) throw new Error('Select a folder');
        await updateDocument.mutateAsync({ documentId: id, params: { folderId: optionalBigIntU64(params.folderId) } });
      } else if (formAction === 'legalHold') {
        const reason = legalHoldReason(formData.reason);
        if (!reason) throw new Error('A reason is required');
        await applyLegalHold.mutateAsync({ documentId: id, reason });
        showWorkflowToast({ kind: 'success', title: 'Legal hold', description: label });
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
      <RecordPage
        testIdPrefix="document"
        breadcrumbs={[
          { label: t('nav.documents', { defaultValue: 'Documents' }), href: '/documents' },
          { label: t('documents.documents.title'), href: buildModuleTabHref('documents', 'documents') },
          { label },
        ]}
        title={label}
        subtitle={[String(document.fileName ?? ''), String(document.mimetype ?? ''), formatFileSize(document.fileSize)]
          .filter((part) => part && part !== '—')
          .join(' · ')}
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
              ...(linkedHref
                ? [
                    {
                      id: 'linked',
                      label: String(document.resName || t('documents.page.linkedRecord', { defaultValue: 'Attached record' })),
                      count: 1,
                      icon: <Link2 className="h-4 w-4" />,
                      href: linkedHref,
                    },
                  ]
                : []),
            ]}
          />
        }
        actions={
          <>
            {url ? (
              <Button
                size="sm"
                nativeButton={false}
                render={<a href={url} target="_blank" rel="noreferrer" />}
                data-testid="document-action-open"
              >
                <ExternalLink className="mr-1 h-4 w-4" />
                {t('documents.page.openFile', { defaultValue: 'Open file' })}
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
                <Button variant="outline" size="sm" data-testid="document-action-edit" onClick={() => setFormAction('edit')}>
                  {t('documents.page.edit', { defaultValue: 'Edit' })}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="document-action-upload-version"
                  onClick={() => setFormAction('uploadVersion')}
                >
                  {t('documents.page.uploadVersion', { defaultValue: 'Upload version' })}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  data-testid={isLocked ? 'document-action-unlock' : 'document-action-lock'}
                  onClick={() =>
                    void run(isLocked ? 'Unlock' : 'Lock', () =>
                      isLocked ? unlockDocument.mutateAsync(id) : lockDocument.mutateAsync(id),
                    )
                  }
                >
                  {isLocked
                    ? t('documents.page.unlock', { defaultValue: 'Unlock' })
                    : t('documents.page.lock', { defaultValue: 'Lock' })}
                </Button>
                <Button variant="outline" size="sm" data-testid="document-action-retention" onClick={() => setFormAction('setRetention')}>
                  {t('documents.page.setRetention', { defaultValue: 'Set retention' })}
                </Button>
                <Button variant="outline" size="sm" data-testid="document-action-move" onClick={() => setFormAction('move')}>
                  {t('documents.page.move', { defaultValue: 'Move to folder' })}
                </Button>
                {!isHeld && (
                  <Button variant="outline" size="sm" data-testid="document-action-legal-hold" onClick={() => setFormAction('legalHold')}>
                    {t('documents.page.legalHold', { defaultValue: 'Legal hold' })}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || isHeld}
                  title={isHeld ? heldTitle : undefined}
                  data-testid="document-action-delete"
                  onClick={() => setConfirmDelete(true)}
                >
                  {t('documents.page.delete', { defaultValue: 'Delete' })}
                </Button>
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
                    {holdReason ? <p>{t('documents.page.holdReason', { defaultValue: 'Reason' })}: {holdReason}</p> : null}
                    {holdDate != null ? (
                      <p>{t('documents.page.holdDate', { defaultValue: 'Held since' })}: {formatHoldDate(holdDate)}</p>
                    ) : null}
                  </div>
                ) : null}
                <EntityDetail config={detailConfig} data={document} />
              </div>
            ),
          },
          {
            id: 'versions',
            label: t('documents.page.versions', { defaultValue: 'Versions' }),
            content: (
              <EntityView
                config={{
                  id: 'document-versions-table',
                  title: '',
                  view: {
                    mode: 'table',
                    rowKey: 'id',
                    columns: [
                      { key: 'versionNumber', label: '#', type: 'number', align: 'right' },
                      { key: 'fileName', label: 'File name' },
                      { key: 'fileSize', label: 'Size', align: 'right', render: (value: unknown) => formatFileSize(value) },
                      { key: 'changesDescription', label: 'Changes' },
                      { key: 'isCurrent', label: 'Current', type: 'boolean' },
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
            label: t('common.audit', { defaultValue: 'Audit' }),
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
          isPending={addVersion.isPending || updateDocument.isPending || setRetention.isPending || applyLegalHold.isPending}
          closeOnSubmit={false}
          submitError={formError}
          onSubmit={submitForm}
        />
      ) : null}


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
