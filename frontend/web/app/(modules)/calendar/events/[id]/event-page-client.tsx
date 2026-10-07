'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
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
  type FormConfig,
  MissingOrganization,
  RecordAuditTab,
  RecordChatter,
  RecordPage,
  StatusBar,
  buildModuleTabHref,
  newCalendarEventForm,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@lumiere/ui/components/dropdown-menu';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import {
  useCalendarEvents,
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
  useUpdateCalendarEvent,
  type CalendarEvent,
} from '@lumiere/query-hooks/hooks/calendar';
import { toCreateCalendarEventParams } from '@/lib/calendar-create-params';
import { duplicateName } from '@/lib/record-standard-actions';
import { useCalendarModuleSubscription } from '@/lib/module-subscription-hooks';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { useContacts } from '@lumiere/query-hooks/hooks/crm';
import {
  eventAttendees,
  eventInputValue,
  eventMicros,
  eventStateActions,
  eventStateParams,
  eventStateTag,
  eventStatusBar,
  recurrenceParams,
  updateCalendarEventParams,
} from '../../calendar-event';

interface CalendarEventPageClientProps {
  eventId: string;
  initialEvents?: CalendarEvent[];
  organizationId?: number;
}

type Row = Record<string, unknown>;

const TAB_IDS = ['overview', 'discussion', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

export function CalendarEventPageClient(props: CalendarEventPageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <CalendarEventPageLoaded {...props} organizationId={props.organizationId} />;
}

function CalendarEventPageLoaded({
  eventId,
  initialEvents,
  organizationId,
}: CalendarEventPageClientProps & { organizationId: number }) {
  useCalendarModuleSubscription();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { orgId } = orgBigInts(organizationId);

  const { data: events = [], isLoading } = useCalendarEvents(orgId, initialEvents);
  const { data: contacts = [] } = useContacts(orgId);
  const updateEvent = useUpdateCalendarEvent(orgId);
  const deleteEvent = useDeleteCalendarEvent(orgId);
  const createEvent = useCreateCalendarEvent(orgId);

  const [editing, setEditing] = useState(false);
  const [editingRecurrence, setEditingRecurrence] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const event = useMemo(
    () => (events as unknown as Row[]).find((row) => String(row.id) === eventId),
    [events, eventId],
  );

  const navigation = useRecordNavigation<Row>({
    rows: events as unknown as Row[],
    currentId: eventId,
    basePath: '/calendar/events',
    labelOf: (row) => String(row.name || row.id),
    compare: (a, b) => eventMicros(a.start) - eventMicros(b.start),
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

  if (!event) {
    if (isLoading) {
      return (
        <div className="space-y-4" data-testid="calendar-event-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="calendar-event-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('calendar.page.notFound', { defaultValue: 'Event not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('calendar.page.notFoundHint', { defaultValue: 'It may have been deleted, or belong to another organization.' })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('calendar', 'calendar')} />} nativeButton={false}>
            {t('calendar.page.backToCalendar', { defaultValue: 'Back to calendar' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const id = BigInt(eventId);
  const label = String(event.name || '').trim() || `#${eventId}`;
  const status = eventStatusBar(event, t);
  const stateActions = eventStateActions(event);
  const attendees = eventAttendees(event, contacts as unknown as Row[]);
  const changeState = (state: 'confirmed' | 'cancelled', title: string) =>
    updateEvent.mutate(
      { eventId: id, params: eventStateParams(state) },
      {
        onSuccess: () => showWorkflowToast({ kind: 'success', title, description: label }),
        onError: (error) => showWorkflowToast({ kind: 'error', title, description: error.message }),
      },
    );
  const when = (value: unknown) => new Date(eventMicros(value) / 1000).toLocaleString(i18n.language);
  const subtitle = event.allday
    ? `${new Date(eventMicros(event.start) / 1000).toLocaleDateString(i18n.language)} · ${t('calendar.events.columns.allday')}`
    : `${when(event.start)} — ${when(event.stop)}`;

  const detailConfig = {
    mode: 'detail' as const,
    sections: [
      {
        id: 'event',
        fields: [
          { key: 'start', label: t('calendar.events.columns.start'), type: 'datetime' as const },
          { key: 'stop', label: t('calendar.events.columns.stop'), type: 'datetime' as const },
          { key: 'location', label: t('calendar.events.columns.location') },
          { key: 'allday', label: t('calendar.events.columns.allday'), type: 'boolean' as const },
          { key: 'privacy', label: t('calendar.events.columns.privacy') },
          { key: 'recurrency', label: t('calendar.events.columns.recurrency'), type: 'boolean' as const },
          { key: 'rrule', label: t('calendar.eventDetail.rrule', { defaultValue: 'Recurrence rule' }) },
          { key: 'rruleType', label: t('calendar.eventDetail.rruleType', { defaultValue: 'Recurrence type' }) },
          { key: 'description', label: t('calendar.forms.newEvent.fields.description', { defaultValue: 'Description' }) },
        ],
      },
    ],
  };

  const recurrenceForm: FormConfig = {
    id: 'edit-calendar-event-recurrence',
    title: t('calendar.eventDetail.editRecurrence', { defaultValue: 'Edit recurrence' }),
    submitLabel: t('common.save', { defaultValue: 'Save' }),
    sections: [
      {
        id: 'recurrence',
        fields: [
          {
            id: 'recurrency',
            name: 'recurrency',
            type: 'checkbox',
            label: t('calendar.events.columns.recurrency'),
            width: 'full',
            defaultValue: Boolean(event.recurrency),
          },
          {
            id: 'rrule',
            name: 'rrule',
            type: 'text',
            label: t('calendar.eventDetail.rrule', { defaultValue: 'Recurrence rule' }),
            placeholder: 'FREQ=WEEKLY;BYDAY=MO',
            width: 'full',
            defaultValue: String(event.rrule ?? ''),
          },
          {
            id: 'rruleType',
            name: 'rruleType',
            type: 'text',
            label: t('calendar.eventDetail.rruleType', { defaultValue: 'Recurrence type' }),
            width: 'full',
            defaultValue: String(event.rruleType ?? event.rrule_type ?? ''),
          },
        ],
      },
    ],
  };

  return (
    <>
      <RecordPage
        testIdPrefix="calendar-event"
        breadcrumbs={[
          { label: t('nav.calendar', { defaultValue: 'Calendar' }), href: '/calendar' },
          { label: t('calendar.events.title'), href: buildModuleTabHref('calendar', 'events') },
          { label },
        ]}
        title={label}
        subtitle={subtitle}
        badge={
          <Badge variant={status.terminal ? 'destructive' : 'secondary'}>
            {status.terminal?.label ?? status.steps.find((step) => step.id === status.current)?.label ?? ''}
          </Badge>
        }
        statusBar={<StatusBar steps={status.steps} current={status.current} terminal={status.terminal} />}
        navigation={navigation}
        actions={
          <>
            {stateActions.confirm ? (
              <Button
                size="sm"
                disabled={updateEvent.isPending}
                data-testid="calendar-event-confirm"
                onClick={() => changeState('confirmed', t('calendar.eventDetail.confirm', { defaultValue: 'Confirm event' }))}
              >
                {t('calendar.eventDetail.confirm', { defaultValue: 'Confirm event' })}
              </Button>
            ) : null}
            <Button variant={stateActions.confirm ? 'outline' : 'default'} size="sm" data-testid="calendar-event-edit" onClick={() => setEditing(true)}>
              {t('calendar.eventDetail.edit')}
            </Button>
            <Button variant="outline" size="sm" data-testid="calendar-event-recurrence" onClick={() => setEditingRecurrence(true)}>
              {t('calendar.eventDetail.editRecurrence', { defaultValue: 'Edit recurrence' })}
            </Button>
            {stateActions.cancel ? (
              <Button
                variant="outline"
                size="sm"
                disabled={updateEvent.isPending}
                data-testid="calendar-event-cancel"
                onClick={() => setConfirmCancel(true)}
              >
                {t('calendar.eventDetail.cancel', { defaultValue: 'Cancel event' })}
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="calendar-event-more-actions">
                  <MoreHorizontal className="mr-1 h-4 w-4" />
                  {t('calendar.eventDetail.moreActions', { defaultValue: 'More' })}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="calendar-event-action-duplicate" onSelect={() => setDuplicating(true)}>
                  {t('calendar.eventDetail.duplicate', { defaultValue: 'Duplicate' })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              disabled={deleteEvent.isPending}
              data-testid="calendar-event-delete"
              onClick={() => setConfirmDelete(true)}
            >
              {t('calendar.eventDetail.delete')}
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
                <EntityDetail config={detailConfig} data={event} />
                <section data-testid="calendar-event-attendees" className="space-y-2">
                  <h3 className="text-sm font-medium">{t('calendar.eventDetail.attendees', { defaultValue: 'Attendees' })}</h3>
                  {attendees.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('calendar.eventDetail.noAttendees', { defaultValue: 'No attendees' })}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {attendees.map((attendee) => (
                        <Badge key={attendee.id} variant="secondary">
                          {attendee.label}
                        </Badge>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ),
          },
          {
            id: 'discussion',
            label: t('calendar.page.discussion', { defaultValue: 'Discussion' }),
            content: (
              <div className="max-w-2xl" data-testid="calendar-event-discussion">
                <RecordChatter organizationId={organizationId} resModel="calendar_event" resId={id} recordTitle={label} />
              </div>
            ),
          },
          {
            id: 'audit',
            label: t('common.audit', { defaultValue: 'Audit' }),
            content: <RecordAuditTab tableName="calendar_event" recordId={eventId} />,
          },
        ]}
      />

      {editing ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditing(false);
              setEditError(null);
            }
          }}
          config={newCalendarEventForm(t, {
            name: String(event.name ?? ''),
            start: eventInputValue(event.start),
            stop: eventInputValue(event.stop),
            allday: Boolean(event.allday),
            privacy: String(event.privacy ?? 'public'),
            location: event.location ? String(event.location) : '',
            description: event.description ? String(event.description) : '',
          })}
          isPending={updateEvent.isPending}
          closeOnSubmit={false}
          submitError={editError}
          onSubmit={async (formData) => {
            setEditError(null);
            const params = updateCalendarEventParams(formData, eventStateTag(event) || 'confirmed');
            if (!params) {
              setEditError(t('common.validation.required'));
              return;
            }
            try {
              await updateEvent.mutateAsync({ eventId: id, params });
              setEditing(false);
            } catch (error) {
              setEditError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
      ) : null}

      {duplicating ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setDuplicating(false);
              setDuplicateError(null);
            }
          }}
          config={newCalendarEventForm(t, {
            name: duplicateName('calendar.events', event.name),
            start: eventInputValue(event.start),
            stop: eventInputValue(event.stop),
            allday: Boolean(event.allday),
            privacy: String(event.privacy ?? 'public'),
            location: event.location ? String(event.location) : '',
            description: event.description ? String(event.description) : '',
          })}
          isPending={createEvent.isPending}
          closeOnSubmit={false}
          submitError={duplicateError}
          onSubmit={async (formData) => {
            setDuplicateError(null);
            const params = toCreateCalendarEventParams(formData);
            if (!params) {
              setDuplicateError(t('common.validation.required'));
              return;
            }
            try {
              await createEvent.mutateAsync(params);
              setDuplicating(false);
              showWorkflowToast({
                kind: 'success',
                title: t('calendar.eventDetail.duplicated', { defaultValue: 'Event duplicated' }),
                description: String(formData.name ?? ''),
              });
            } catch (error) {
              setDuplicateError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
      ) : null}

      {editingRecurrence ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setEditingRecurrence(false)}
          config={recurrenceForm}
          isPending={updateEvent.isPending}
          onSubmit={(formData) => {
            updateEvent.mutate(
              { eventId: id, params: recurrenceParams(formData) },
              {
                onSuccess: () =>
                  showWorkflowToast({
                    kind: 'success',
                    title: t('common.actionCompleted', {
                      action: t('calendar.eventDetail.editRecurrence', { defaultValue: 'Edit recurrence' }),
                    }),
                    description: label,
                  }),
                onError: (error) =>
                  showWorkflowToast({ kind: 'error', title: t('common.error.title'), description: error.message }),
              },
            );
            setEditingRecurrence(false);
          }}
        />
      ) : null}

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent data-testid="calendar-event-cancel-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('calendar.eventDetail.cancelConfirm', { defaultValue: 'Cancel this event?' })}</AlertDialogTitle>
            <AlertDialogDescription>{label}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('erpWorkflow.confirm.dismiss')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmCancel(false);
                changeState('cancelled', t('calendar.eventDetail.cancel', { defaultValue: 'Cancel event' }));
              }}
            >
              {t('calendar.eventDetail.cancel', { defaultValue: 'Cancel event' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid="calendar-event-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('calendar.confirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>{label}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('erpWorkflow.confirm.dismiss')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDelete(false);
                deleteEvent.mutate(id, {
                  onSuccess: () => router.push(buildModuleTabHref('calendar', 'calendar')),
                  onError: (error) =>
                    showWorkflowToast({ kind: 'error', title: t('calendar.eventDetail.delete'), description: error.message }),
                });
              }}
            >
              {t('calendar.eventDetail.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
