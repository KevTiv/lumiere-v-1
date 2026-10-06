'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, Layers, Link2 } from 'lucide-react';
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
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import { optionalBigIntU64 } from '@lumiere/erp-shared/form-coercion';
import {
  useAddDocumentVersion,
  useDeleteDocument,
  useDeletedDocuments,
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
import { formatFileSize, linkedRecordHref } from '../document-record';

interface DocumentPageClientProps {
  documentId: string;
  initialDocuments?: unknown[];
  initialDeleted?: unknown[];
  initialVersions?: unknown[];
  organizationId?: number;
}

type Row = Record<string, unknown>;
type FormAction = 'edit' | 'uploadVersion' | 'setRetention';

const TAB_IDS = ['overview', 'versions', 'discussion', 'audit'] as const;
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
  const { data: versions = [] } = useDocumentVersions(orgId, initialVersions as never);

  const lockDocument = useLockDocument(orgId);
  const unlockDocument = useUnlockDocument(orgId);
  const updateDocument = useUpdateDocument(orgId);
  const deleteDocument = useDeleteDocument(orgId);
  const restoreDocument = useRestoreDocument(orgId);
  const addVersion = useAddDocumentVersion(orgId);
  const ingestEvidence = useIngestDocumentEvidence(orgId);
  const setRetention = useSetDocumentRetention(orgId);

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

  const formConfig: FormConfig | null =
    formAction === 'edit'
      ? editDocumentForm(document)
      : formAction === 'uploadVersion'
        ? uploadDocumentVersionForm(t)
        : formAction === 'setRetention'
          ? setDocumentRetentionForm(t)
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
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
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
            content: <EntityDetail config={detailConfig} data={document} />,
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
          isPending={addVersion.isPending || updateDocument.isPending || setRetention.isPending}
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
