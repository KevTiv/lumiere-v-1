'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CornerUpLeft, ExternalLink, MessagesSquare } from 'lucide-react';
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
  RecordPage,
  SmartButtons,
  buildModuleTabHref,
  type FormConfig,
} from '@lumiere/ui';
import { Badge } from '@lumiere/ui/components/badge';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { useMailMessages, usePostMessage, type MailMessage } from '@lumiere/query-hooks/hooks/messages';
import { useMessagesModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import {
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

const TAB_IDS = ['overview', 'thread'] as const;
type TabId = (typeof TAB_IDS)[number];

export function MessagePageClient(props: MessagePageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <MessagePageLoaded {...props} organizationId={props.organizationId} />;
}

function MessagePageLoaded({
  messageId,
  initialMessages,
  organizationId,
}: MessagePageClientProps & { organizationId: number }) {
  useMessagesModuleSubscription();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { orgId } = orgBigInts(organizationId);

  const { data: messages = [], isLoading } = useMailMessages(orgId, initialMessages);
  const postMessage = usePostMessage(orgId);

  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

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

  const navigation = useMemo(() => {
    const sorted = [...rows].sort((a, b) => Number(BigInt(String(b.id)) - BigInt(String(a.id))));
    const index = sorted.findIndex((row) => String(row.id) === messageId);
    if (index === -1) return undefined;
    const link = (row: Row | undefined) =>
      row ? { href: `/messages/${String(row.id)}`, label: messageTitle(row, 40) } : undefined;
    return { position: index + 1, total: sorted.length, previous: link(sorted[index - 1]), next: link(sorted[index + 1]) };
  }, [rows, messageId]);

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
  const parentId = optionalId(message.parentId ?? message.parent_id);
  const recordHref = messageRecordPageHref(message);
  const when = new Date(Number(message.date ?? 0) / 1000).toLocaleString(i18n.language);
  const model = String(message.model ?? '');
  const resId = String(message.resId ?? message.res_id ?? '');

  const replyForm: FormConfig = {
    id: 'reply-message',
    title: t('messages.page.reply', { defaultValue: 'Reply' }),
    submitLabel: t('messages.page.reply', { defaultValue: 'Reply' }),
    sections: [
      {
        id: 'reply',
        fields: [
          { id: 'body', name: 'body', type: 'textarea', label: t('messages.messages.columns.body'), required: true, rows: 5, width: 'full' },
        ],
      },
    ],
  };

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
          { label: t('nav.messages', { defaultValue: 'Messages' }), href: '/messages' },
          { label: t('messages.messages.title'), href: buildModuleTabHref('messages', 'messages') },
          { label: title },
        ]}
        title={title}
        subtitle={`${when} · ${model} #${resId}`}
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
          <Button size="sm" data-testid="message-reply" onClick={() => setReplying(true)}>
            {t('messages.page.reply', { defaultValue: 'Reply' })}
          </Button>
        }
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'overview',
            label: t('common.overview', { defaultValue: 'Overview' }),
            content: (
              <div className="space-y-6">
                <p className="max-w-3xl whitespace-pre-wrap break-words text-sm" data-testid="message-body">
                  {String(message.body ?? '')}
                </p>
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
                        <span className="uppercase">{messageKind(reply)}</span>
                        <span>{new Date(Number(reply.date ?? 0) / 1000).toLocaleString(i18n.language)}</span>
                      </div>
                      <p className="whitespace-pre-wrap break-words">{String(reply.body ?? '')}</p>
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
            const body = String(formData.body ?? '').trim();
            if (!body) {
              setReplyError(t('common.validation.required'));
              return;
            }
            try {
              await postMessage.mutateAsync({
                model,
                resId,
                body,
                messageType: 'comment',
                parentId: messageId,
                attachmentIds: [],
              });
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
