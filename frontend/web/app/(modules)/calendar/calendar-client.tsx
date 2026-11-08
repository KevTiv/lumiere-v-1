"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { calendarModuleConfig } from "@/lib/module-dashboard-configs"
import { useCalendarModuleSubscription } from "@/lib/module-subscription-hooks"
import { toCreateCalendarEventParams } from "@/lib/calendar-create-params"
import { toCreateActivityParams } from "@/lib/crm-create-params"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { Plus } from "lucide-react"
import { useConfirmDialog } from "@lumiere/ui/hooks/use-confirm-dialog"
import { useCalendarEvents, useCalendarActivities, useCalendarContacts, useCreateCalendarEvent, useUpdateCalendarEvent, useDeleteCalendarEvent } from "@lumiere/query-hooks/hooks/calendar"
import type { CalendarEvent as StdbCalendarEvent } from "@lumiere/query-hooks/hooks/calendar"
import { useCreateActivity } from "@lumiere/query-hooks/hooks/crm"
import type { FormConfig, CalendarEvent as UICalendarEvent } from "@lumiere/ui"
import { FormModal, ModuleView, newCalendarEventForm, newActivityForm, MissingOrganization } from "@lumiere/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useErpSession } from "@lumiere/erp-session"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { calendarDate, calendarDayKey, calendarMode, shiftCalendarDate, shiftCalendarMonth } from "@lumiere/ui/lib/calendar-dates"
import { moduleCollection } from "@lumiere/ui/lib/module-data-state"
import type { EntityColumn, EntityRow } from "@lumiere/ui/lib/entity-view-types"
import { CalendarView } from "../../../../packages/ui/src/calendar-components/calendar-view"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { calendarEventCreationDefaults, calendarEventForView, calendarEventHref, eventAttendees, eventBoundaryLabel, eventInputValue, eventStateTag, eventText, updateCalendarEventParams } from "./calendar-event"
import { withInlineEdits } from "@lumiere/ui/lib/with-inline-edits"
import { variantTag } from "@lumiere/erp-workflows"
import { useCalendarTimezone } from "@/lib/use-calendar-timezone"
import { requiredInlineText } from "@/lib/inline-edit-params"

interface CalendarClientProps {
  initialEvents?: StdbCalendarEvent[]
  organizationId?: number
}

type CalendarClientLoadedProps = Omit<CalendarClientProps, "organizationId"> & {
  organizationId: number
}

export function CalendarClient(props: CalendarClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <CalendarClientLoaded {...props} organizationId={props.organizationId} />
}

function CalendarClientLoaded({ initialEvents, organizationId }: CalendarClientLoadedProps) {
  useCalendarModuleSubscription()
  const { t, i18n } = useTranslation()
  const session = useErpSession()
  const calendarTimezone = useCalendarTimezone()
  const { timeZone } = calendarTimezone
  const { checkPermission, currentUser, roles, policies, permissionsReady } = useRBAC()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [initialDate] = useState(() => new Date())
  const updateParams = useCallback((values: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(values)) {
      if (value == null || value === "") next.delete(key)
      else next.set(key, value)
    }
    const href = `${pathname}?${next}`
    // Next observes native history updates. Presentation-only replacements must
    // not make a controlled search input wait for an RSC navigation per key.
    if (replace) window.history.replaceState(window.history.state, "", href)
    else router.push(href, { scroll: false })
  }, [params, pathname, router])
  const viewMode = calendarMode(params.get("calendarView"))
  const currentDate = calendarDate(params.get("calendarDate"), initialDate, timeZone)
  const selectedDate = params.has("calendarDay") ? calendarDate(params.get("calendarDay"), currentDate, timeZone) : null
  const newEventDay = calendarDayKey(selectedDate ?? currentDate, timeZone)
  const searchTerm = params.get("calendarSearch") ?? ""
  const selectedEventId = params.get("calendarEvent")
  const setSelectedEventId = useCallback((id: string | null) => updateParams({ calendarEvent: id }), [updateParams])
  const scopeKey = JSON.stringify([organizationId, session.organizationId, session.identity, session.activeCompanyId, currentUser, roles, policies])
  const scopeReady = session.organizationId === organizationId && session.activeCompanyReady === true && Boolean(session.identity) && session.identity !== "unknown" && permissionsReady === true && currentUser?.id === session.identity
  const canCreateEvent = scopeReady && calendarTimezone.ready && checkPermission("calendar_event", "create").allowed
  const canEditEvent = scopeReady && calendarTimezone.ready && checkPermission("calendar_event", "write").allowed
  const canDeleteEvent = scopeReady && checkPermission("calendar_event", "delete").allowed
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog()
  const moduleConfig = useMemo(() => calendarModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string; eventId?: string } | null>(null)
  const [formModalKey, setFormModalKey] = useState(0)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (quickActionForm != null) {
      setFormModalKey((k) => k + 1)
    }
  }, [quickActionForm])
  const readScope = { key: scopeKey, enabled: scopeReady }
  const eventsQuery = useCalendarEvents(orgId, initialEvents, readScope)
  const activitiesQuery = useCalendarActivities(orgId, readScope)
  const eventsRead = moduleCollection({ ...eventsQuery, isLoading: !scopeReady || !calendarTimezone.ready || eventsQuery.isLoading })
  const events = scopeReady && eventsRead.state.status === "ready" ? eventsRead.rows : []
  const eventRecordsTab = params.get("tab") === "events"
  const contactsQuery = useCalendarContacts(orgId, {
    ...readScope,
    enabled: scopeReady && eventsRead.state.status === "ready" && (eventRecordsTab || selectedEventId != null),
  })
  const contactsRead = moduleCollection(contactsQuery)
  const contacts = useMemo(() => scopeReady && contactsRead.state.status === "ready"
    ? contactsRead.rows.map((contact) => ({
        id: contact.id,
        name: contact.name,
        displayName: "displayName" in contact ? contact.displayName : undefined,
        display_name: "display_name" in contact ? contact.display_name : undefined,
      }))
    : [], [scopeReady, contactsRead.state.status, contactsRead.rows])
  const returnContext = params.size ? `${pathname}?${params}` : pathname
  const openNewEvent = useCallback(() => setQuickActionForm({
    form: newCalendarEventForm(t, calendarEventCreationDefaults(newEventDay), "create", timeZone),
    action: "createEvent",
  }), [newEventDay, t, timeZone])
  const activitiesRead = moduleCollection({ ...activitiesQuery, isLoading: !scopeReady || activitiesQuery.isLoading })
  const activities = scopeReady && activitiesRead.state.status === "ready" ? activitiesRead.rows : []
  const createCalendarEvent = useCreateCalendarEvent(orgId)
  const updateCalendarEvent = useUpdateCalendarEvent(orgId)
  const deleteCalendarEvent = useDeleteCalendarEvent(orgId)
  const createActivity = useCreateActivity(orgId)

  const liveSections = useMemo(() => {
    const confirmed = events?.filter((e) => eventStateTag(e) === "confirmed").length
    const drafts = events.filter((event) => eventStateTag(event) === "draft").length
    const allDay = events?.filter((e) => e.allday).length

    return mapDashboardWidgets(moduleConfig, (w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: t("calendar.dashboard.totalEvents"), value: String(events.length), icon: "Calendar" },
                { label: t("calendar.dashboard.confirmed"), value: String(confirmed), icon: "CheckCircle" },
                { label: t("calendar.dashboard.allDayEvents"), value: String(allDay), icon: "Sun" },
                { label: t("calendar.dashboard.draftEvents"), value: String(drafts), icon: "Clock" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_event: () => setQuickActionForm({ form: newCalendarEventForm(t, calendarEventCreationDefaults(newEventDay), "create", timeZone), action: "createEvent" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        return w
          })
  }, [events, moduleConfig, t, newEventDay, timeZone])

  const renderEventBoundary = useCallback(
    (boundary: "start" | "stop"): NonNullable<EntityColumn["render"]> =>
      (_value, row) => eventBoundaryLabel({ start: row.start, stop: row.stop, allday: row.allday }, boundary, i18n.language, timeZone),
    [i18n.language, timeZone],
  )

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
        if (tab.id === "activities") {
          return {
            ...tab,
            label: t("calendar.activitiesTab"),
            createForm: newActivityForm(t),
            createPermission: { resource: "activity", action: "create" as const },
          }
        }
        if (tab.id === "events") {
          return {
            ...tab,
            description: t("calendar.workspace.listTimezone", { defaultValue: "Event times use {{timezone}}. All-day events display dates.", timezone: timeZone }),
            createForm: newCalendarEventForm(t, calendarEventCreationDefaults(newEventDay), "create", timeZone),
            createPermission: { resource: "calendar_event", action: "create" as const },
            entityConfig: tab.entityConfig
              ? withInlineEdits({ ...tab.entityConfig, view: "columns" in tab.entityConfig.view ? { ...tab.entityConfig.view, columns: tab.entityConfig.view.columns.map((column) => column.key === "start" || column.key === "stop" ? { ...column, render: renderEventBoundary(column.key) } : column) } : tab.entityConfig.view }, {
                  name: {
                    kind: "text",
                    save: async (row, value) => {
                      const name = requiredInlineText(
                        value,
                        t("calendar.inlineEdit.nameRequired", { defaultValue: "An event needs a title" }),
                      )
                      await updateCalendarEvent.mutateAsync({ eventId: row.id as string | number, params: { name } })
                    },
                  },
                })
              : tab.entityConfig,
            recordSheet: {
              titleKey: "name",
              auditTableName: "calendar_event",
              discussion: {},
              openHref: (row: EntityRow) => calendarEventHref({ id: row.id }, returnContext),
              detailConfig: {
                mode: "detail" as const,
                sections: [
                  {
                    id: "event",
                    fields: [
                      { key: "start", label: t("calendar.events.columns.start"), type: "datetime" as const, render: renderEventBoundary("start") },
                      { key: "stop", label: t("calendar.events.columns.stop"), type: "datetime" as const, render: renderEventBoundary("stop") },
                      { key: "location", label: t("calendar.events.columns.location"), render: (value: unknown) => eventText(value) ?? "—" },
                      { key: "partnerIds", label: t("calendar.eventDetail.attendees", { defaultValue: "Attendees" }), render: (_: unknown, row: EntityRow) =>
                        <span className="[overflow-wrap:anywhere]">{eventAttendees({ partner_ids: row.partner_ids, partnerIds: row.partnerIds }, contacts).map(({ label }) => label).join(", ") || t("calendar.eventDetail.noAttendees", { defaultValue: "No attendees" })}</span> },
                      { key: "description", type: "markdown" as const, label: t("calendar.forms.newEvent.fields.description", { defaultValue: "Description" }) },
                    ],
                  },
                ],
              },
            },
          }
        }
        if (tab.id === "calendar") {
          const uiEvents = events.map((event) => calendarEventForView({
            id: event.id,
            name: event.name,
            description: event.description,
            location: event.location,
            start: event.start,
            stop: event.stop,
            allday: event.allday,
            state: event.state,
            privacy: event.privacy,
            partnerIds: "partnerIds" in event ? event.partnerIds : undefined,
            partner_ids: "partner_ids" in event ? event.partner_ids : undefined,
          }, contacts)).filter((event): event is UICalendarEvent => event != null)
          return {
            ...tab,
            type: "custom" as const,
            primaryAction: canCreateEvent && eventsRead.state.status === "ready" ? (
              <Button onClick={openNewEvent} disabled={createCalendarEvent.isPending}>
                <Plus aria-hidden="true" />
                {t("calendar.view.newEvent")}
              </Button>
            ) : undefined,
            customContent: (
              <CalendarView
                timeZone={timeZone}
                timezoneSource={calendarTimezone.source}
                timezoneReady={calendarTimezone.ready}
                timezoneNotice={calendarTimezone.fallbackReason ? t(`calendar.workspace.timezoneFallback.${calendarTimezone.fallbackReason}`, { defaultValue: "The account timezone is unavailable. The labelled fallback timezone is in use." }) : undefined}
                events={uiEvents}
                viewMode={viewMode}
                currentDate={currentDate}
                selectedDate={selectedDate}
                searchTerm={searchTerm}
                selectedEventId={selectedEventId}
                onViewModeChange={(mode) => updateParams({ calendarView: mode, calendarDate: calendarDayKey(mode === "day" && selectedDate ? selectedDate : currentDate, timeZone) })}
                onPrevMonth={() => updateParams({ calendarDate: calendarDayKey(viewMode === "month" ? shiftCalendarMonth(currentDate, -1, timeZone) : shiftCalendarDate(currentDate, viewMode === "week" ? -7 : viewMode === "day" ? -1 : -30, timeZone), timeZone), calendarDay: null })}
                onNextMonth={() => updateParams({ calendarDate: calendarDayKey(viewMode === "month" ? shiftCalendarMonth(currentDate, 1, timeZone) : shiftCalendarDate(currentDate, viewMode === "week" ? 7 : viewMode === "day" ? 1 : 30, timeZone), timeZone), calendarDay: null })}
                onToday={() => updateParams({ calendarDate: calendarDayKey(new Date(), timeZone), calendarDay: calendarDayKey(new Date(), timeZone) })}
                onSelectDate={(date) => updateParams({ calendarDay: calendarDayKey(date, timeZone) })}
                onSearchChange={(value) => updateParams({ calendarSearch: value }, true)}
                onSelectEvent={setSelectedEventId}
                onEditEvent={canEditEvent ? (eventId) => {
                  const event = events.find((e) => String(e.id) === eventId)
                  if (event) {
                    setQuickActionForm({
                      form: newCalendarEventForm(t, {
                        name: eventText(event.name) ?? "",
                        start: eventInputValue(event.start, timeZone),
                        stop: eventInputValue(event.stop, timeZone),
                        allday: Boolean(event.allday),
                        privacy: variantTag(event.privacy).toLowerCase() || "public",
                        location: eventText(event.location) ?? "",
                        description: eventText(event.description) ?? "",
                      }, "edit", timeZone),
                      action: "editEvent",
                      eventId,
                    })
                  }
                } : undefined}
                eventHref={(eventId) => calendarEventHref({ id: eventId }, returnContext)}
                onDeleteEvent={canDeleteEvent ? async (eventId) => {
                  if (await confirmDialog({ description: t("calendar.confirmDelete") })) {
                    setActionError(null)
                    try {
                      await deleteCalendarEvent.mutateAsync(eventId)
                      setSelectedEventId(null)
                    } catch (cause) {
                      setActionError(cause instanceof Error ? cause.message : t("calendar.errors.deleteFailed", { defaultValue: "The event could not be deleted. It is still selected." }))
                    }
                  }
                } : undefined}
              />
            ),
          }
        }
        return tab
      }),
    }),
    [viewMode, selectedEventId, selectedDate, searchTerm, events, currentDate, newEventDay, liveSections, moduleConfig, t, updateCalendarEvent, deleteCalendarEvent, confirmDialog, canCreateEvent, canEditEvent, canDeleteEvent, contacts, returnContext, openNewEvent, createCalendarEvent.isPending, eventsRead.state.status, updateParams, setSelectedEventId, timeZone, renderEventBoundary, calendarTimezone.source, calendarTimezone.ready, calendarTimezone.fallbackReason],
  )

  const data = useMemo(
    () => ({
      events: events as unknown as Record<string, unknown>[],
      activities: activities as unknown as Record<string, unknown>[],
    }),
    [events, activities],
  )

  const dataState = {
    dashboard: eventsRead.state,
    calendar: eventsRead.state,
    events: eventsRead.state,
    activities: activitiesRead.state,
  }
  const eventsUsable = scopeReady && eventsRead.state.status === "ready"
  const actionUsable = (action: string) => scopeReady && (
    action === "createActivity" ? activitiesRead.state.status === "ready" && checkPermission("activity", "create").allowed
      : eventsUsable && (action === "createEvent" ? canCreateEvent : canEditEvent)
  )
  const quickActionUsable = quickActionForm == null || actionUsable(quickActionForm.action)
  useEffect(() => {
    // Event dialogs and selection must not outlive a denied or failed events read.
    if (!quickActionUsable) setQuickActionForm(null)
    if (["error", "denied", "partial"].includes(eventsRead.state.status) && selectedEventId) updateParams({ calendarEvent: null }, true)
  }, [quickActionUsable, eventsRead.state.status, selectedEventId, updateParams])
  const previousScope = useRef(scopeKey)
  useEffect(() => {
    if (previousScope.current === scopeKey) return
    previousScope.current = scopeKey
    setQuickActionForm(null)
    if (selectedEventId) updateParams({ calendarEvent: null }, true)
  }, [scopeKey, selectedEventId, updateParams])
  const createIntentOpened = useRef(false)
  useEffect(() => {
    if (params.get("create") !== "event") {
      createIntentOpened.current = false
      return
    }
    if (!eventsUsable || !canCreateEvent || createIntentOpened.current) return
    createIntentOpened.current = true
    setQuickActionForm({ form: newCalendarEventForm(t, calendarEventCreationDefaults(newEventDay), "create", timeZone), action: "createEvent" })
    updateParams({ create: null, tab: "calendar" }, true)
  }, [params, eventsUsable, canCreateEvent, t, updateParams, newEventDay, timeZone])

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (!actionUsable(action)) throw new Error("Required data is unavailable. Refresh and try again.")
    if (action === "createActivity") {
      const p = toCreateActivityParams(formData)
      if (!p) throw new Error(t("calendar.errors.activityIncomplete", { defaultValue: "Complete the activity details before saving. Your entries are retained." }))
      await createActivity.mutateAsync(p)
      void activitiesQuery.refetch()
      return
    }
    if (action === "createEvent") {
      const params = toCreateCalendarEventParams(formData, timeZone)
      if (!params) throw new Error(t("calendar.errors.eventIncomplete", { defaultValue: "Enter an event title and valid times. The end must not be before the start. Your entries are retained." }))
      await createCalendarEvent.mutateAsync(params)
    } else if (action === "editEvent" && quickActionForm?.eventId) {
      const event = events.find((event) => String(event.id) === quickActionForm.eventId)
      const params = updateCalendarEventParams(formData, eventStateTag(event ?? {}), timeZone, event ? { start: event.start, stop: event.stop } : undefined)
      if (!params) throw new Error(t("calendar.errors.eventIncomplete", { defaultValue: "Enter an event title and valid times. The end must not be before the start. Your entries are retained." }))
      await updateCalendarEvent.mutateAsync({ eventId: quickActionForm.eventId, params })
    }
  }

  const isPending =
    createCalendarEvent.isPending ||
    updateCalendarEvent.isPending ||
    deleteCalendarEvent.isPending ||
    createActivity.isPending

  return (
    <>
      {actionError ? <p role="alert" className="mb-3 break-words text-sm text-destructive">{actionError}</p> : null}
      <ModuleView
        assistantFormBlocked={quickActionForm !== null}
        config={config}
        data={data}
        dataState={dataState}
        onFormSubmit={handleFormSubmit}
        isPending={isPending}
      />

      <FormModal
        key={formModalKey}
        open={quickActionForm !== null && quickActionUsable}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newCalendarEventForm(t, undefined, "create", timeZone)}
        isPending={isPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      {confirmDialogNode}
    </>
  )
}
