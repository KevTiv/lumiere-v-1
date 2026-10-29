"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { calendarModuleConfig } from "@/lib/module-dashboard-configs"
import { useCalendarModuleSubscription } from "@/lib/module-subscription-hooks"
import { toCreateCalendarEventParams } from "@/lib/calendar-create-params"
import { toCreateActivityParams } from "@/lib/crm-create-params"
import { useTranslation } from "@lumiere/i18n"
import { useConfirmDialog } from "@lumiere/ui/hooks/use-confirm-dialog"
import { useCalendarEvents, useCalendarActivities, useCreateCalendarEvent, useUpdateCalendarEvent, useDeleteCalendarEvent } from "@lumiere/query-hooks/hooks/calendar"
import type { CalendarEvent as StdbCalendarEvent } from "@lumiere/query-hooks/hooks/calendar"
import { useCreateActivity } from "@lumiere/query-hooks/hooks/crm"
import type { FormConfig, CalendarEvent as UICalendarEvent } from "@lumiere/ui"
import { FormModal, ModuleView, newCalendarEventForm, newActivityForm, MissingOrganization } from "@lumiere/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useErpSession } from "@lumiere/erp-session"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { calendarDate, calendarDayKey, calendarMode, shiftCalendarDate } from "@lumiere/ui/lib/calendar-dates"
import { moduleCollection } from "@lumiere/ui/lib/module-data-state"
import { CalendarView } from "../../../../packages/ui/src/calendar-components/calendar-view"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { calendarEventCreationDefaults, calendarEventForView, calendarEventHref, eventInputValue, eventStateTag, updateCalendarEventParams } from "./calendar-event"
import { withInlineEdits } from "@lumiere/ui/lib/with-inline-edits"
import { variantTag } from "@lumiere/erp-workflows"
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
  const { t } = useTranslation()
  const session = useErpSession()
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
  const currentDate = calendarDate(params.get("calendarDate"), initialDate)
  const selectedDate = params.has("calendarDay") ? calendarDate(params.get("calendarDay"), currentDate) : null
  const newEventDay = calendarDayKey(selectedDate ?? currentDate)
  const searchTerm = params.get("calendarSearch") ?? ""
  const selectedEventId = params.get("calendarEvent")
  const setSelectedEventId = useCallback((id: string | null) => updateParams({ calendarEvent: id }), [updateParams])
  const scopeKey = JSON.stringify([organizationId, session.organizationId, session.identity, session.activeCompanyId, currentUser, roles, policies])
  const scopeReady = session.organizationId === organizationId && session.activeCompanyReady === true && Boolean(session.identity) && session.identity !== "unknown" && permissionsReady === true && currentUser?.id === session.identity
  const canCreateEvent = scopeReady && checkPermission("calendar_event", "create").allowed
  const canEditEvent = scopeReady && checkPermission("calendar_event", "write").allowed
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
  const eventsRead = moduleCollection({ ...eventsQuery, isLoading: !scopeReady || eventsQuery.isLoading })
  const events = scopeReady && eventsRead.state.status === "ready" ? eventsRead.rows : []
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
            new_event: () => setQuickActionForm({ form: newCalendarEventForm(t, calendarEventCreationDefaults(newEventDay), "create"), action: "createEvent" }),
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
  }, [events, moduleConfig, t, newEventDay])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
        if (tab.id === "activities") {
          return {
            ...tab,
            label: t("calendar.activitiesTab"),
            createForm: newActivityForm(t),
          }
        }
        if (tab.id === "events") {
          return {
            ...tab,
            createForm: newCalendarEventForm(t, calendarEventCreationDefaults(newEventDay), "create"),
            entityConfig: tab.entityConfig
              ? withInlineEdits(tab.entityConfig, {
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
              openHref: calendarEventHref,
              detailConfig: {
                mode: "detail" as const,
                sections: [
                  {
                    id: "event",
                    fields: [
                      { key: "start", label: t("calendar.events.columns.start"), type: "datetime" as const },
                      { key: "stop", label: t("calendar.events.columns.stop"), type: "datetime" as const },
                      { key: "location", label: t("calendar.events.columns.location") },
                      { key: "description", type: "markdown" as const, label: "Description" },
                    ],
                  },
                ],
              },
            },
          }
        }
        if (tab.id === "calendar") {
          const uiEvents = events.map(calendarEventForView).filter((event): event is UICalendarEvent => event != null)
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <CalendarView
                className="my-4"
                events={uiEvents}
                viewMode={viewMode}
                currentDate={currentDate}
                selectedDate={selectedDate}
                searchTerm={searchTerm}
                selectedEventId={selectedEventId}
                onViewModeChange={(mode) => updateParams({ calendarView: mode, calendarDate: calendarDayKey(mode === "day" && selectedDate ? selectedDate : currentDate) })}
                onPrevMonth={() => updateParams({ calendarDate: calendarDayKey(viewMode === "month" ? new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1) : shiftCalendarDate(currentDate, viewMode === "week" ? -7 : viewMode === "day" ? -1 : -30)), calendarDay: null })}
                onNextMonth={() => updateParams({ calendarDate: calendarDayKey(viewMode === "month" ? new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1) : shiftCalendarDate(currentDate, viewMode === "week" ? 7 : viewMode === "day" ? 1 : 30)), calendarDay: null })}
                onToday={() => updateParams({ calendarDate: calendarDayKey(new Date()), calendarDay: calendarDayKey(new Date()) })}
                onSelectDate={(date) => updateParams({ calendarDay: calendarDayKey(date) })}
                onSearchChange={(value) => updateParams({ calendarSearch: value }, true)}
                onSelectEvent={setSelectedEventId}
                onCreateEvent={canCreateEvent ? () => setQuickActionForm({ form: newCalendarEventForm(t, calendarEventCreationDefaults(newEventDay), "create"), action: "createEvent" }) : undefined}
                onEditEvent={canEditEvent ? (eventId) => {
                  const event = events.find((e) => String(e.id) === eventId)
                  if (event) {
                    setQuickActionForm({
                      form: newCalendarEventForm(t, {
                        name: String(event.name ?? ""),
                        start: eventInputValue(event.start),
                        stop: eventInputValue(event.stop),
                        allday: Boolean(event.allday),
                        privacy: variantTag(event.privacy).toLowerCase() || "public",
                        location: event.location ? String(event.location) : "",
                        description: event.description ? String(event.description) : "",
                      }),
                      action: "editEvent",
                      eventId,
                    })
                  }
                } : undefined}
                eventHref={(eventId) => `${calendarEventHref({ id: eventId })}?returnTo=${encodeURIComponent(`${pathname}?${params}`)}`}
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
    [viewMode, selectedEventId, selectedDate, searchTerm, events, currentDate, newEventDay, liveSections, moduleConfig, t, updateCalendarEvent, deleteCalendarEvent, confirmDialog, canCreateEvent, canEditEvent, canDeleteEvent, params, pathname, updateParams, setSelectedEventId],
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
    action === "createActivity" ? activitiesRead.state.status === "ready"
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
    setQuickActionForm({ form: newCalendarEventForm(t, calendarEventCreationDefaults(newEventDay), "create"), action: "createEvent" })
    updateParams({ create: null, tab: "calendar" }, true)
  }, [params, eventsUsable, canCreateEvent, t, updateParams, newEventDay])

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
      const params = toCreateCalendarEventParams(formData)
      if (!params) throw new Error(t("calendar.errors.eventIncomplete", { defaultValue: "Enter an event title and valid times. The end must not be before the start. Your entries are retained." }))
      await createCalendarEvent.mutateAsync(params)
    } else if (action === "editEvent" && quickActionForm?.eventId) {
      const params = updateCalendarEventParams(formData, eventStateTag(events.find((event) => String(event.id) === quickActionForm.eventId) ?? {}))
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
        config={quickActionForm?.form ?? newCalendarEventForm(t)}
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
