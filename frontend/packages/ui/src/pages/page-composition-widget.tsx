"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useTranslation } from "@lumiere/i18n"
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  LayoutDashboard,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react"
import { Button } from "../components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select"
import { cn } from "../lib/utils"
import {
  PAGE_WIDGET_WIDTHS,
  pageWidgetWidthClasses,
  type PageWidgetCatalogItem,
  type PageWidgetPlacement,
  type PageWidgetWidth,
} from "../lib/page-composition"
import { DashboardWidgetRenderer } from "./dashboard-widget-renderer"

interface WidgetBodyProps {
  item?: PageWidgetCatalogItem
  isLoading?: boolean
  testId?: string
  preview?: boolean
}

export function PageCompositionWidgetBody({
  item,
  isLoading,
  testId,
  preview,
}: WidgetBodyProps) {
  const { t } = useTranslation()
  if (preview && item?.widget?.type === "custom") {
    return (
      <div className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
        <LayoutDashboard aria-hidden="true" className="size-8" />
        <p>
          {t("pageComposition.gallery.pageBlock", {
            defaultValue: "This page block becomes available in the layout.",
          })}
        </p>
      </div>
    )
  }
  if (!item?.widget || item.unavailableReason) {
    return (
      <div
        className="flex h-full min-h-28 flex-col justify-center gap-2 rounded-xl border border-dashed p-4"
        data-testid={testId}
      >
        <h3 className="text-sm font-medium">
          {item?.title ??
            t("pageComposition.unavailable.title", {
              defaultValue: "Widget unavailable",
            })}
        </h3>
        <p className="text-sm text-muted-foreground">
          {item?.unavailableReason ??
            (preview && item
              ? t("pageComposition.gallery.loadPreview", {
                  defaultValue:
                    "Live data loads when you add this widget to the page.",
                })
              : t("pageComposition.unavailable.description", {
                  defaultValue:
                    "Data for this widget is unavailable. You can keep its place or edit the page to choose another widget.",
                }))}
        </p>
      </div>
    )
  }
  return (
    <DashboardWidgetRenderer
      widget={item.widget}
      widthClass="h-full min-w-0"
      isLoading={isLoading}
      testId={testId}
      exportProvenance={item.exportProvenance}
    />
  )
}

export function PageWidgetWidthSelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: PageWidgetWidth
  onChange: (value: PageWidgetWidth) => void
  label: string
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const labels: Record<PageWidgetWidth, string> = {
    3: t("pageComposition.width.quarter", { defaultValue: "Quarter width" }),
    4: t("pageComposition.width.third", { defaultValue: "Third width" }),
    6: t("pageComposition.width.half", { defaultValue: "Half width" }),
    8: t("pageComposition.width.wide", { defaultValue: "Wide" }),
    12: t("pageComposition.width.full", { defaultValue: "Full width" }),
  }
  return (
    <Select
      value={String(value)}
      disabled={disabled}
      onValueChange={(next) => {
        const width = Number(next)
        const allowed = PAGE_WIDGET_WIDTHS.find(
          (candidate) => candidate === width,
        )
        if (allowed !== undefined) onChange(allowed)
      }}
    >
      <SelectTrigger
        aria-label={label}
        className="h-8 w-auto gap-2 px-2 text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PAGE_WIDGET_WIDTHS.map((width) => (
          <SelectItem key={width} value={String(width)}>
            {labels[width]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface SortableWidgetProps extends WidgetBodyProps {
  placement: PageWidgetPlacement
  index: number
  count: number
  disabled?: boolean
  onMove: (direction: -1 | 1) => void
  onResize: (width: PageWidgetWidth) => void
  onRemove: () => void
  onConfigure?: () => void
  onAddBelow: () => void
  canAdd: boolean
}

export function PageCompositionSortableWidget({
  placement,
  item,
  index,
  count,
  disabled,
  isLoading,
  testId,
  onMove,
  onResize,
  onRemove,
  onConfigure,
  onAddBelow,
  canAdd,
}: SortableWidgetProps) {
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: placement.id,
    disabled,
  })
  const title =
    item?.title ??
    t("pageComposition.unavailable.title", {
      defaultValue: "Widget unavailable",
    })
  const label = (action: string, fallback: string) =>
    t(`pageComposition.${action}`, { defaultValue: fallback, title })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-primary/40 bg-muted/20 p-2",
        pageWidgetWidthClasses[placement.width],
        isDragging && "z-20 border-primary bg-background shadow-xl",
      )}
      data-testid={testId}
      data-placement-id={placement.id}
      data-widget-key={`${placement.source}:${placement.widgetId}`}
    >
      <div
        role="group"
        aria-label={label("controls", "{{title}} controls")}
        className="flex flex-wrap items-center gap-1"
      >
        <Button
          ref={setActivatorNodeRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          className="touch-none cursor-grab active:cursor-grabbing"
          data-page-composition-drag-handle
          {...attributes}
          {...listeners}
          aria-label={label("drag", "Drag {{title}}")}
          title={label("drag", "Drag {{title}}")}
          disabled={disabled}
        >
          <GripVertical aria-hidden="true" />
        </Button>
        {item?.widget?.type === "custom" && !item.widget.title ? (
          <span
            className="min-w-0 flex-1 truncate text-sm font-medium"
            title={title}
          >
            {title}
          </span>
        ) : null}
        <PageWidgetWidthSelect
          value={placement.width}
          onChange={onResize}
          label={label("resize", "Width of {{title}}")}
          disabled={disabled}
        />
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label("moveEarlier", "Move {{title}} earlier")}
            title={label("moveEarlier", "Move {{title}} earlier")}
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label("moveLater", "Move {{title}} later")}
            title={label("moveLater", "Move {{title}} later")}
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          {onConfigure ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={label("configure", "Configure {{title}}")}
              title={label("configure", "Configure {{title}}")}
              disabled={disabled || Boolean(item?.unavailableReason)}
              onClick={onConfigure}
            >
              <Settings2 aria-hidden="true" />
            </Button>
          ) : null}
          {!item?.required && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              aria-label={label("remove", "Remove {{title}}")}
              title={label("remove", "Remove {{title}}")}
              disabled={disabled}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1" inert>
        <PageCompositionWidgetBody
          item={item}
          isLoading={isLoading}
          testId={testId ? `${testId}-content` : undefined}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={disabled || !canAdd}
        onClick={onAddBelow}
        aria-label={label("addBelowNamed", "Add widget below {{title}}")}
      >
        <Plus aria-hidden="true" />
        {t("pageComposition.addBelow", { defaultValue: "Add widget below" })}
      </Button>
    </div>
  )
}
