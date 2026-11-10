"use client"

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable"
import { useTranslation } from "@lumiere/i18n"
import { PERSONAL_PAGE_MAX_WIDGETS } from "@lumiere/presentation-core/personal-page-layout"
import {
  Check,
  Loader2,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Undo2,
} from "lucide-react"
import { Button } from "../components/button"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"
import { cn } from "../lib/utils"
import {
  createPageCompositionHistory,
  createPageWidgetPlacement,
  findBuiltinPagePlacement,
  includeRequiredPageWidgets,
  insertPageWidget,
  movePageWidget,
  pageCompositionHistoryReducer,
  pageLayoutsEqual,
  pageWidgetKey,
  pageWidgetWidthClasses,
  type PageCompositionRequest,
  type PageCompositionValue,
  type PageWidgetCatalogItem,
  type PageWidgetPlacement,
  type PageWidgetWidth,
} from "../lib/page-composition"
import { PageCompositionGallery } from "./page-composition-gallery"
import {
  PageCompositionSortableWidget,
  PageCompositionWidgetBody,
} from "./page-composition-widget"

export interface PageCompositionProps {
  value: PageCompositionValue
  defaultValue: readonly PageWidgetPlacement[]
  catalog: readonly PageWidgetCatalogItem[]
  revision?: string | null
  onSave: (
    value: PageCompositionValue,
    expectedRevision: string | null,
  ) => Promise<void>
  onCreateWidget?: () => Promise<PageWidgetCatalogItem | null>
  onConfigureWidget?: (
    placement: PageWidgetPlacement,
    item: PageWidgetCatalogItem,
  ) => void | Promise<PageWidgetCatalogItem | null | void>
  onDraftChange?: (value: PageCompositionValue) => void
  request?: PageCompositionRequest | null
  onRequestHandled?: (requestId: string) => void
  canEdit?: boolean
  isLoading?: boolean
  /** The module's unchanged dashboard, rendered while following its default layout. */
  children?: ReactNode
  actionTarget?: HTMLElement | null
  insights?: boolean
  scopeNote?: string
  className?: string
  testId?: string
}

/** A draft editor over the shared widget renderer. Its host owns data access and persistence. */
export function PageComposition({
  value,
  defaultValue,
  catalog,
  revision = null,
  onSave,
  onCreateWidget,
  onConfigureWidget,
  onDraftChange,
  request,
  onRequestHandled,
  canEdit = true,
  isLoading = false,
  children,
  actionTarget,
  insights = false,
  scopeNote,
  className,
  testId = "page-composition",
}: PageCompositionProps) {
  const { t } = useTranslation()
  const dndId = useId()
  const [editing, setEditing] = useState(false)
  const [history, dispatch] = useReducer(
    pageCompositionHistoryReducer,
    null,
    createPageCompositionHistory,
  )
  const [baseline, setBaseline] = useState<{
    value: PageCompositionValue
    revision: string | null
  }>({ value: null, revision: null })
  const [localCatalog, setLocalCatalog] = useState<
    readonly PageWidgetCatalogItem[]
  >([])
  const [gallery, setGallery] = useState<{
    prompt?: string
    afterId?: string
  } | null>(null)
  const [operation, setOperation] = useState<
    "save" | "create" | "configure" | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const focusEditor = useRef(false)
  const restoreLauncher = useRef(false)
  useEffect(() => {
    if (editing && focusEditor.current) {
      focusEditor.current = false
      const editor = rootRef.current
      // A page can put its insights in a collapsed native disclosure. The header
      // launcher and assistant requests must reveal it before moving focus.
      for (
        let ancestor = editor?.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
      }
      editor?.focus()
    } else if (!editing && restoreLauncher.current) {
      restoreLauncher.current = false
      launcherRef.current?.focus()
    }
  }, [editing])
  const pending = useRef(false)
  const mounted = useRef(true)
  const handledRequest = useRef<string | null>(null)
  const lastNotified = useRef<{
    value: PageCompositionValue
    callback: typeof onDraftChange
  } | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // A newly created widget is available immediately; subscribed catalog data wins once received.
  const items = useMemo(
    () =>
      Array.from(
        new Map(
          [...localCatalog, ...catalog].map((item) => [
            pageWidgetKey(item),
            item,
          ]),
        ).values(),
      ),
    [catalog, localCatalog],
  )
  const itemsByKey = useMemo(
    () => new Map(items.map((item) => [pageWidgetKey(item), item])),
    [items],
  )
  const visibleValue = editing ? history.present : value
  const widgets = useMemo(
    () =>
      includeRequiredPageWidgets(
        visibleValue ?? defaultValue,
        defaultValue,
        items,
      ),
    [visibleValue, defaultValue, items],
  )
  const atCapacity = widgets.length >= PERSONAL_PAGE_MAX_WIDGETS
  const capacityMessage = t("pageComposition.capacity", {
    defaultValue:
      "This page supports up to {{count}} widgets. Remove a widget before adding another.",
    count: PERSONAL_PAGE_MAX_WIDGETS,
  })
  const dirty = editing && !pageLayoutsEqual(history.present, baseline.value)
  const conflict =
    editing &&
    (revision !== baseline.revision || !pageLayoutsEqual(value, baseline.value))
  const busy = operation !== null
  const controlsDisabled = busy || !canEdit || conflict
  const guard = useUnsavedChangesGuard(dirty, busy)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const focusExisting = useCallback(
    (placement: PageWidgetPlacement, item: PageWidgetCatalogItem) => {
      setFocusRequest({ id: placement.id })
      setGallery(null)
      setAnnouncement(
        t("pageComposition.alreadyAdded", {
          defaultValue:
            "{{title}} is already on this page. You can move or resize it in the editor.",
          title: item.title,
        }),
      )
    },
    [t],
  )

  useEffect(() => {
    if (!editing || !focusRequest || busy || !canEdit) return
    const placement = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>("[data-placement-id]") ??
        [],
    ).find((element) => element.dataset.placementId === focusRequest.id)
    placement
      ?.querySelector<HTMLButtonElement>("[data-page-composition-drag-handle]")
      ?.focus()
  }, [busy, canEdit, editing, focusRequest])

  useEffect(() => {
    if (!onDraftChange) return
    if (
      lastNotified.current?.callback === onDraftChange &&
      pageLayoutsEqual(lastNotified.current.value, visibleValue)
    )
      return
    lastNotified.current = { value: visibleValue, callback: onDraftChange }
    onDraftChange(visibleValue)
  }, [onDraftChange, visibleValue])

  const startEditing = useCallback(() => {
    if (!canEdit || pending.current || isLoading) return false
    if (!editing) {
      focusEditor.current = true
      dispatch({ type: "start", value })
      setBaseline({ value, revision })
      setEditing(true)
      setError(null)
      setFocusRequest(null)
    }
    return true
  }, [canEdit, editing, isLoading, revision, value])

  useEffect(() => {
    if (
      !request ||
      handledRequest.current === request.id ||
      conflict ||
      !startEditing()
    )
      return
    handledRequest.current = request.id
    if (request.kind === "add_widget") {
      const item = request.widgetKey
        ? itemsByKey.get(request.widgetKey)
        : undefined
      const existing = item
        ? findBuiltinPagePlacement(widgets, item)
        : undefined
      if (existing && item) {
        focusExisting(existing, item)
      } else if (atCapacity) {
        setAnnouncement(capacityMessage)
      } else if (item) {
        dispatch({
          type: "change",
          value: [...widgets, createPageWidgetPlacement(item)],
        })
        setGallery(null)
        setAnnouncement(
          t("pageComposition.added", {
            defaultValue: "Added {{title}} to the page.",
            title: item.title,
          }),
        )
      } else {
        setGallery({ prompt: request.prompt })
      }
    }
    onRequestHandled?.(request.id)
  }, [
    atCapacity,
    capacityMessage,
    conflict,
    focusExisting,
    itemsByKey,
    onRequestHandled,
    request,
    startEditing,
    t,
    widgets,
  ])

  const change = (next: PageCompositionValue) => {
    if (controlsDisabled || pending.current) return
    dispatch({ type: "change", value: next })
    setError(null)
  }

  const add = (item: PageWidgetCatalogItem, width: PageWidgetWidth) => {
    if (controlsDisabled || pending.current || atCapacity) return
    const existing = findBuiltinPagePlacement(widgets, item)
    if (existing) {
      focusExisting(existing, item)
      return
    }
    change(
      insertPageWidget(
        widgets,
        { ...createPageWidgetPlacement(item), width },
        gallery?.afterId,
      ),
    )
    setGallery(null)
    setAnnouncement(
      t("pageComposition.added", {
        defaultValue: "Added {{title}} to the page.",
        title: item.title,
      }),
    )
  }

  const move = (id: string, targetId: string) => {
    if (controlsDisabled || pending.current) return
    const next = movePageWidget(widgets, id, targetId)
    change(next)
    const placement = next.find((widget) => widget.id === id)
    if (placement && next !== widgets) {
      setAnnouncement(
        t("pageComposition.moved", {
          defaultValue:
            "Moved {{title}} to position {{position}} of {{count}}.",
          title:
            itemsByKey.get(pageWidgetKey(placement))?.title ??
            placement.widgetId,
          position: next.indexOf(placement) + 1,
          count: next.length,
        }),
      )
    }
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over) move(String(active.id), String(over.id))
  }

  const remember = (item: PageWidgetCatalogItem) =>
    setLocalCatalog((current) => [
      ...current.filter(
        (existing) => pageWidgetKey(existing) !== pageWidgetKey(item),
      ),
      item,
    ])

  const create = async () => {
    if (!onCreateWidget || controlsDisabled || pending.current || atCapacity)
      return
    const afterId = gallery?.afterId
    setGallery(null)
    pending.current = true
    setOperation("create")
    setError(null)
    try {
      const item = await onCreateWidget()
      if (item && mounted.current) {
        const existing = findBuiltinPagePlacement(widgets, item)
        if (existing) {
          focusExisting(existing, item)
          return
        }
        remember(item)
        dispatch({
          type: "change",
          value: insertPageWidget(
            widgets,
            createPageWidgetPlacement(item),
            afterId,
          ),
        })
        setAnnouncement(
          t("pageComposition.added", {
            defaultValue: "Added {{title}} to the page.",
            title: item.title,
          }),
        )
      }
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : t("pageComposition.createFailed", {
                defaultValue: "Could not create the widget. Please try again.",
              }),
        )
    } finally {
      pending.current = false
      if (mounted.current) setOperation(null)
    }
  }

  const configure = async (
    placement: PageWidgetPlacement,
    item: PageWidgetCatalogItem,
  ) => {
    if (!onConfigureWidget || controlsDisabled || pending.current) return
    pending.current = true
    setOperation("configure")
    setError(null)
    try {
      const replacement = await onConfigureWidget(placement, item)
      if (replacement && mounted.current) {
        const existing = findBuiltinPagePlacement(widgets, replacement)
        if (existing && existing.id !== placement.id) {
          focusExisting(existing, replacement)
          return
        }
        remember(replacement)
        dispatch({
          type: "change",
          value: widgets.map((widget) =>
            widget.id === placement.id
              ? {
                  ...widget,
                  source: replacement.source,
                  widgetId: replacement.widgetId,
                }
              : widget,
          ),
        })
      }
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : t("pageComposition.configureFailed", {
                defaultValue:
                  "Could not configure the widget. Please try again.",
              }),
        )
    } finally {
      pending.current = false
      if (mounted.current) setOperation(null)
    }
  }

  const cancel = () => {
    if (pending.current) return
    setEditing(false)
    setGallery(null)
    setError(null)
    setFocusRequest(null)
  }

  const save = async () => {
    if (!editing || controlsDisabled || pending.current) return
    if (!dirty) {
      cancel()
      return
    }
    pending.current = true
    setOperation("save")
    setError(null)
    try {
      await onSave(history.present, baseline.revision)
      if (mounted.current) {
        setEditing(false)
        setGallery(null)
        setFocusRequest(null)
        setAnnouncement(
          t("pageComposition.saved", { defaultValue: "Page layout saved." }),
        )
      }
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : t("pageComposition.saveFailed", {
                defaultValue:
                  "Could not save this page. Your changes are still here; please try again.",
              }),
        )
    } finally {
      pending.current = false
      if (mounted.current) setOperation(null)
    }
  }

  const editLabel = insights
    ? t("pageComposition.editInsights", { defaultValue: "Customize insights" })
    : t("pageComposition.edit", { defaultValue: "Edit page" })
  const launcher =
    canEdit && !editing ? (
      <Button
        ref={launcherRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={isLoading}
        onClick={() => {
          if (startEditing()) {
            restoreLauncher.current = true
          }
        }}
      >
        <Pencil aria-hidden="true" />
        {editLabel}
      </Button>
    ) : null
  const headerAction =
    actionTarget && launcher ? createPortal(launcher, actionTarget) : null
  if (
    insights &&
    !editing &&
    widgets.length === 0 &&
    actionTarget !== undefined
  ) {
    return (
      <>
        {headerAction}
        <span role="status" className="sr-only">
          {announcement}
        </span>
      </>
    )
  }
  const showScopeNote =
    scopeNote &&
    (editing || widgets.some((widget) => widget.source === "saved"))

  return (
    <div
      ref={rootRef}
      className={cn("space-y-4", className)}
      data-testid={testId}
      data-editing={editing || undefined}
      tabIndex={editing ? -1 : undefined}
      role={insights ? "region" : undefined}
      aria-label={
        insights
          ? t("pageComposition.insights", { defaultValue: "Page insights" })
          : undefined
      }
    >
      {headerAction}
      {insights ? (
        <h2 className="text-lg font-semibold">
          {t("pageComposition.insights", { defaultValue: "Page insights" })}
        </h2>
      ) : null}
      {showScopeNote ? (
        <p className="text-sm text-muted-foreground">{scopeNote}</p>
      ) : null}
      {editing || (launcher && actionTarget === undefined) ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3",
            editing && "rounded-xl border bg-muted/20 p-3",
          )}
        >
          {editing ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setGallery({})}
                  disabled={controlsDisabled || atCapacity}
                >
                  <Plus aria-hidden="true" />
                  {t("pageComposition.add", { defaultValue: "Add widget" })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("pageComposition.undo", {
                    defaultValue: "Undo",
                  })}
                  title={t("pageComposition.undo", { defaultValue: "Undo" })}
                  disabled={controlsDisabled || history.past.length === 0}
                  onClick={() => dispatch({ type: "undo" })}
                >
                  <Undo2 aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("pageComposition.redo", {
                    defaultValue: "Redo",
                  })}
                  title={t("pageComposition.redo", { defaultValue: "Redo" })}
                  disabled={controlsDisabled || history.future.length === 0}
                  onClick={() => dispatch({ type: "redo" })}
                >
                  <Redo2 aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={controlsDisabled || history.present === null}
                  onClick={() => change(null)}
                >
                  <RotateCcw aria-hidden="true" />
                  {t("pageComposition.reset", {
                    defaultValue: "Reset to default",
                  })}
                </Button>
                {dirty ? (
                  <span className="text-xs text-muted-foreground">
                    {t("pageComposition.unsaved", {
                      defaultValue: "Unsaved changes",
                    })}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={cancel}
                >
                  {t("common.cancel", { defaultValue: "Cancel" })}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={controlsDisabled}
                  onClick={() => void save()}
                >
                  {operation === "save" ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Check aria-hidden="true" />
                  )}
                  {operation === "save"
                    ? t("pageComposition.saving", { defaultValue: "Saving…" })
                    : t("pageComposition.done", { defaultValue: "Done" })}
                </Button>
              </div>
              <p className="w-full text-xs text-muted-foreground">
                {t("pageComposition.instructions", {
                  defaultValue:
                    "Drag widgets or use the move buttons. Choose a width, then select Done.",
                })}
              </p>
            </>
          ) : (
            <div className="ml-auto">{launcher}</div>
          )}
        </div>
      ) : null}
      {conflict ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
        >
          {t("pageComposition.conflict", {
            defaultValue:
              "This page changed while you were editing. Cancel and reopen the editor to start from the latest layout.",
          })}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {editing && atCapacity ? (
        <p
          role="status"
          className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground"
        >
          {capacityMessage}
        </p>
      ) : null}
      {operation === "create" || operation === "configure" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("pageComposition.waitingForWidget", {
            defaultValue:
              "Finish configuring the widget to return to your page.",
          })}
        </p>
      ) : null}
      {!editing && value === null && children !== undefined ? (
        children
      ) : widgets.length > 0 ? (
        editing ? (
          <DndContext
            id={dndId}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={widgets.map((widget) => widget.id)}
              strategy={rectSortingStrategy}
            >
              <div
                className="grid grid-cols-12 items-stretch gap-4"
                data-testid={`${testId}-grid`}
              >
                {widgets.map((placement, index) => {
                  const item = itemsByKey.get(pageWidgetKey(placement))
                  return (
                    <PageCompositionSortableWidget
                      key={placement.id}
                      placement={placement}
                      item={item}
                      index={index}
                      count={widgets.length}
                      disabled={controlsDisabled}
                      isLoading={isLoading}
                      testId={`${testId}-widget-${placement.id}`}
                      onMove={(direction) => {
                        const target = widgets[index + direction]
                        if (target) move(placement.id, target.id)
                      }}
                      onResize={(width) =>
                        change(
                          widgets.map((widget) =>
                            widget.id === placement.id
                              ? { ...widget, width }
                              : widget,
                          ),
                        )
                      }
                      onRemove={() =>
                        change(
                          widgets.filter(
                            (widget) => widget.id !== placement.id,
                          ),
                        )
                      }
                      onAddBelow={() => setGallery({ afterId: placement.id })}
                      canAdd={!atCapacity}
                      onConfigure={
                        onConfigureWidget &&
                        item &&
                        (item.configurable ?? item.source === "saved")
                          ? () => {
                              void configure(placement, item)
                            }
                          : undefined
                      }
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div
            className="grid grid-cols-12 items-stretch gap-4"
            data-testid={`${testId}-grid`}
          >
            {widgets.map((placement) => (
              <div
                key={placement.id}
                className={cn(
                  "min-w-0",
                  pageWidgetWidthClasses[placement.width],
                )}
                data-placement-id={placement.id}
              >
                <PageCompositionWidgetBody
                  item={itemsByKey.get(pageWidgetKey(placement))}
                  isLoading={isLoading}
                  testId={`${testId}-widget-${placement.id}`}
                />
              </div>
            ))}
          </div>
        )
      ) : editing ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t("pageComposition.empty", {
              defaultValue:
                "Add widgets to bring the metrics you need into this page.",
            })}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={controlsDisabled}
            onClick={() => setGallery({})}
          >
            <Plus aria-hidden="true" />
            {t("pageComposition.addFirst", {
              defaultValue: "Add your first widget",
            })}
          </Button>
        </div>
      ) : null}
      {gallery ? (
        <PageCompositionGallery
          catalog={items}
          placements={widgets}
          prompt={gallery.prompt}
          disabled={controlsDisabled || atCapacity}
          onClose={() => setGallery(null)}
          onAdd={add}
          onCreate={
            onCreateWidget
              ? () => {
                  void create()
                }
              : undefined
          }
        />
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {guard}
    </div>
  )
}
