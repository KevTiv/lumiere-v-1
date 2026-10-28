'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CornerUpLeft, ExternalLink, MessagesSquare } from 'lucide-react';
import { useTranslation } from '@lumiere/i18n';
import {
  Button,
  useRBAC,
  EntityDetail,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  FormModal,
  MissingOrganization,
  RecordPage,
  SmartButtons,
  buildModuleTabHref,
  attachmentDocumentIds,
  filesFromFormValue,
  itemsForFiles,
  uploadPendingAttachments,
  useChatterUploader,
  type AttachmentItem,
  type FormConfig,
} from '@lumiere/ui';
import { Badge } from '@lumiere/ui/components/badge';
import { MarkdownView } from '@lumiere/ui/components/markdown-view';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { useUsers } from '@lumiere/query-hooks/hooks/crm';
import {
  useMailFollowers,
  useMailMessages,
  usePostMessage,
  confirmPostedMessage,
  type PostMessageInput,
  useSubscribeToRecord,
  useUnsubscribeFromRecord,
  type MailMessage,
} from '@lumiere/query-hooks/hooks/messages';
import { useErpSession } from '@lumiere/erp-session';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import { useMessagesModuleSubscription } from '@/lib/module-subscription-hooks';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { moduleCollection } from '@lumiere/ui/lib/module-data-state';
import { ModuleDataNotice } from '@lumiere/ui/pages/module-data-notice';
import { UnconfirmedPostedMessageError } from '@lumiere/query-hooks/hooks/mail-message-post';
import { newCorrelationId } from '@lumiere/erp-workflows';
import { sameMessageSource } from '../message-conversations';
import {
  messageAuthorName,
  messageKind,
  messageRecordPageHref,
  messageTitle,
  optionalId,
  repliesTo,
} from '../message-record';

interface MessagePageClientProps {
  messageId: string;
  initialMessages?: MailMessage[];
  organizationId?: number;
}

type Row = Record<string, unknown>;

/** Lowercase hex of a follower identity cell (string or identity object). */
function followerHex(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && typeof (v as { toHexString?: unknown }).toHexString === 'function') {
    return (v as { toHexString: () => string }).toHexString().toLowerCase();
  }
  if (typeof v === 'object' && typeof (v as { toHex?: unknown }).toHex === 'function') {
    return String((v as { toHex: () => unknown }).toHex()).toLowerCase();
  }
  return String(v).toLowerCase();
}

const TAB_IDS = ['overview', 'thread'] as const;
type TabId = (typeof TAB_IDS)[number];

export function MessagePageClient(props: MessagePageClientProps) {
  const session = useErpSession();
  const { currentUser, roles, policies, permissionsReady } = useRBAC();
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  const scopeKey = JSON.stringify({ organizationId: props.organizationId, companyId: session.activeCompanyId, identity: session.identity, currentUser, roles, policies });
  if (permissionsReady === false || session.activeCompanyReady === false) return <Skeleton className="h-64 w-full" />;
  return <MessagePageLoaded key={`${scopeKey}:${props.messageId}`} {...props} scopeKey={scopeKey} organizationId={props.organizationId} />;
}

function MessagePageLoaded({
  messageId,
  organizationId,
  scopeKey,
}: MessagePageClientProps & { organizationId: number; scopeKey: string }) {
  useMessagesModuleSubscription();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { orgId } = orgBigInts(organizationId);

  const messagesQuery = useMailMessages(orgId, undefined, scopeKey);
  const messagesRead = moduleCollection(messagesQuery);
  const messages = messagesRead.rows;
  const isLoading = messagesRead.state.status === 'loading';
  const { checkPermission } = useRBAC();
  const { data: users = [] } = useUsers(orgId);
  const postMessage = usePostMessage(orgId);
  const { identity } = useErpSession();
  const { data: followers = [] } = useMailFollowers(orgId, undefined, scopeKey);
  const subscribeToRecord = useSubscribeToRecord(orgId);
  const unsubscribeFromRecord = useUnsubscribeFromRecord(orgId);

  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [pendingReply, setPendingReply] = useState<PostMessageInput | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const replyUpload = useChatterUploader(organizationId);
  const replyAttempt = useRef<AttachmentItem[]>([]);
  useEffect(() => {
    if (messagesRead.state.status !== 'ready') {
      setReplying(false);
      setReplyError(null);
      setPendingReply((previous) => messagesRead.state.status === 'denied' ? null : previous ? { ...previous, body: '', attachmentIds: [] } : null);
      replyAttempt.current = [];
    }
  }, [messagesRead.state.status]);

  const rows = messages as unknown as Row[];
  const message = useMemo(() => rows.find((row) => String(row.id) === messageId), [rows, messageId]);
  const replies = useMemo(() => repliesTo(rows, messageId), [rows, messageId]);

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

  const navigation = useRecordNavigation<Row>({
    rows: rows as unknown as Row[],
    currentId: messageId,
    basePath: '/messages',
    labelOf: (row) => messageTitle(row, 40),
  });

  if (messagesRead.state.status !== 'ready' && !isLoading) return <ModuleDataNotice state={messagesRead.state} />;

  if (!message) {
    if (isLoading) {
      return (
        <div className="space-y-4" data-testid="message-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="message-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('messages.page.notFound', { defaultValue: 'Message not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('messages.page.notFoundHint', { defaultValue: 'It may have been deleted, or belong to another organization.' })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('messages', 'messages')} />} nativeButton={false}>
            {t('messages.page.backToMessages', { defaultValue: 'Back to messages' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const title = messageTitle(message);
  const kind = messageKind(message);
  const authorOf = (row: Row) => messageAuthorName(row, users as unknown as Row[]);
  const author = authorOf(message);
  const claimedParentId = optionalId(message.parentId ?? message.parent_id);
  const parentId = rows.some((row) => String(row.id) === claimedParentId && sameMessageSource(row, message)) ? claimedParentId : undefined;
  const recordHref = messageRecordPageHref(message);
  const when = new Date(Number(message.date ?? 0) / 1000).toLocaleString(i18n.language);
  const model = String(message.model ?? '');
  const resId = String(message.resId ?? message.res_id ?? '');

  const recordTarget = model && /^\d+$/.test(resId) ? { resModel: model, resId: BigInt(resId) } : null;
  const me = identity?.toLowerCase();
  const following =
    !!me &&
    !!recordTarget &&
    (followers as unknown as Row[]).some(
      (f) =>
        String(f.resModel) === model &&
        String(f.resId) === resId &&
        followerHex(f.partnerId) === me,
    );
  const toggleFollow = async () => {
    if (!recordTarget) return;
    try {
      if (following) await unsubscribeFromRecord.mutateAsync(recordTarget);
      else await subscribeToRecord.mutateAsync({ ...recordTarget, subtypes: ['comment', 'note'] });
    } catch (error) {
      showWorkflowToast({
        kind: 'error',
        title: t('crm.chatter.follow', { defaultValue: 'Follow' }),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const replyForm: FormConfig = {
    id: 'reply-message',
    title: t('messages.page.reply', { defaultValue: 'Reply' }),
    submitLabel: pendingReply ? t('messages.workspace.checkOutcome', { defaultValue: 'Check outcome' }) : t('messages.page.reply', { defaultValue: 'Reply' }),
    sections: [
      {
        id: 'reply',
        fields: [
          { id: 'body', name: 'body', type: 'textarea', label: t('messages.messages.columns.body'), required: true, rows: 5, width: 'full' },
          ...(replyUpload
            ? [{ id: 'attachments', name: 'attachments', type: 'file' as const, label: t('crm.chatter.attachFiles', { defaultValue: 'Attach files' }), multiple: true, width: 'full' as const }]
            : []),
        ],
      },
    ],
  };

  if (pendingReply) replyForm.sections = replyForm.sections.map((section) => ({ ...section, fields: section.fields.map((field) => ({ ...field, disabled: true, required: false })) }));

  const detailConfig = {
    mode: 'detail' as const,
    sections: [
      {
        id: 'message',
        fields: [
          { key: 'body', label: t('messages.messages.columns.body') },
          { key: 'model', label: t('messages.messages.columns.model') },
          { key: 'resId', label: t('messages.messages.columns.resId') },
          { key: 'subtype', label: t('messages.messages.columns.subtype') },
          { key: 'date', label: t('messages.messages.columns.date'), type: 'datetime' as const },
        ],
      },
    ],
  };

  return (
    <>
      <RecordPage
        testIdPrefix="message"
        breadcrumbs={[
          { label: t('nav.messages', { defaultValue: 'Messages' }), href: `/messages?tab=messages&message=${messageId}` },
          { label: t('messages.messages.title'), href: buildModuleTabHref('messages', 'messages') },
          { label: title },
        ]}
        title={title}
        subtitle={[author, when, `${model} #${resId}`].filter(Boolean).join(' · ')}
        badge={<Badge variant="secondary">{kind}</Badge>}
        navigation={navigation}
        smartButtons={
          <SmartButtons
            testIdPrefix="message"
            buttons={[
              {
                id: 'replies',
                label: t('messages.page.replies', { defaultValue: 'Replies' }),
                count: replies.length,
                icon: <MessagesSquare className="h-4 w-4" />,
                onClick: () => setActiveTab('thread'),
              },
              ...(parentId
                ? [
                    {
                      id: 'parent',
                      label: t('messages.page.inReplyTo', { defaultValue: 'In reply to' }),
                      count: 1,
                      icon: <CornerUpLeft className="h-4 w-4" />,
                      href: `/messages/${parentId}`,
                    },
                  ]
                : []),
              ...(recordHref
                ? [
                    {
                      id: 'record',
                      label: t('messages.page.filedOn', { defaultValue: 'Filed on' }),
                      count: 1,
                      icon: <ExternalLink className="h-4 w-4" />,
                      href: recordHref,
                    },
                  ]
                : []),
            ]}
          />
        }
        actions={
          <>
            {recordTarget ? (
              <Button
                size="sm"
                variant="outline"
                data-testid="message-follow"
                disabled={!identity || subscribeToRecord.isPending || unsubscribeFromRecord.isPending}
                onClick={toggleFollow}
              >
                {following
                  ? t('crm.chatter.unfollow', { defaultValue: 'Unfollow' })
                  : t('crm.chatter.follow', { defaultValue: 'Follow' })}
              </Button>
            ) : null}
            <Button size="sm" data-testid="message-reply" disabled={!checkPermission("mail_message", "create").allowed || !recordTarget} onClick={() => setReplying(true)}>
              {t('messages.page.reply', { defaultValue: 'Reply' })}
            </Button>
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
                <div className="max-w-3xl" data-testid="message-body">
                  <MarkdownView value={String(message.body ?? '')} />
                </div>
                <EntityDetail config={detailConfig} data={message} />
              </div>
            ),
          },
          {
            id: 'thread',
            label: t('messages.page.thread', { defaultValue: 'Replies' }),
            content:
              replies.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="message-no-replies">
                  {t('messages.page.noReplies', { defaultValue: 'No replies yet.' })}
                </p>
              ) : (
                <ul className="max-w-3xl space-y-3" data-testid="message-replies">
                  {replies.map((reply) => (
                    <li key={String(reply.id)} className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          {[authorOf(reply), messageKind(reply)].filter(Boolean).join(' · ')}
                        </span>
                        <span>{new Date(Number(reply.date ?? 0) / 1000).toLocaleString(i18n.language)}</span>
                      </div>
                      <MarkdownView value={String(reply.body ?? '')} />
                      <Link className="mt-1 inline-block text-xs text-primary hover:underline" href={`/messages/${String(reply.id)}`}>
                        {t('messages.page.openReply', { defaultValue: 'Open' })}
                      </Link>
                    </li>
                  ))}
                </ul>
              ),
          },
        ]}
      />

      {replying ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setReplying(false);
              setReplyError(null);
            }
          }}
          config={replyForm}
          isPending={postMessage.isPending}
          closeOnSubmit={false}
          submitError={replyError}
          onSubmit={async (formData) => {
            setReplyError(null);
            if (pendingReply) {
              try {
                const effect = await confirmPostedMessage(orgId, { idempotencyKey: pendingReply.idempotencyKey!, model: pendingReply.model, resId: BigInt(pendingReply.resId) });
                if (!active.current) return;
                if (!effect) { setReplyError(t('messages.workspace.unconfirmed', { defaultValue: 'The message outcome is still unconfirmed. Check again without posting another message.' })); return; }
                await messagesQuery.refetch();
                if (!active.current) return;
                setPendingReply(null); setReplying(false); setActiveTab('thread');
              } catch (error) { if (active.current) setReplyError(error instanceof Error ? error.message : String(error)); }
              return;
            }
            const body = String(formData.body ?? '').trim();
            if (!body) {
              setReplyError(t('common.validation.required'));
              return;
            }
            try {
              let attachmentIds: bigint[] = [];
              const files = filesFromFormValue(formData.attachments);
              if (files.length > 0) {
                if (!replyUpload) {
                  setReplyError(t('crm.chatter.attachmentsFailed', { defaultValue: 'Some files failed to upload. Remove them or retry.' }));
                  return;
                }
                const result = await uploadPendingAttachments(
                  itemsForFiles(files, replyAttempt.current),
                  replyUpload,
                  { resModel: model, resId: BigInt(resId) },
                  () => undefined,
                );
                replyAttempt.current = result;
                const failed = result.filter((item) => item.status === 'error');
                if (failed.length > 0) {
                  setReplyError(failed.map((item) => `${item.file.name}: ${item.error ?? ''}`).join('; '));
                  return;
                }
                attachmentIds = attachmentDocumentIds(result);
              }
              const attempt = { model, resId, body, messageType: 'comment', parentId: messageId, attachmentIds, idempotencyKey: newCorrelationId() };
              try { await postMessage.mutateAsync(attempt); }
              catch (error) { if (error instanceof UnconfirmedPostedMessageError && active.current) setPendingReply(attempt); throw error; }
              if (!active.current) return;
              replyAttempt.current = [];
              setReplying(false);
              setActiveTab('thread');
            } catch (error) {
              setReplyError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
      ) : null}
    </>
  );
}
