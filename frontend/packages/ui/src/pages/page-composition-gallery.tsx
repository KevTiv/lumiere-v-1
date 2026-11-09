"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  BarChart3,
  Bookmark,
  Hash,
  LayoutDashboard,
  Plus,
  Search,
  Table2,
} from "lucide-react"
import { Button } from "../components/button"
import { Input } from "../components/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/dialog"
import { cn } from "../lib/utils"
import {
  defaultPageWidgetWidth,
  findBuiltinPagePlacement,
  pageWidgetKey,
  type PageWidgetCatalogItem,
  type PageWidgetPlacement,
  type PageWidgetWidth,
} from "../lib/page-composition"
import {
  PageCompositionWidgetBody,
  PageWidgetWidthSelect,
} from "./page-composition-widget"

interface PageCompositionGalleryProps {
  catalog: readonly PageWidgetCatalogItem[]
  placements: readonly PageWidgetPlacement[]
  initialSearch?: string
  prompt?: string
  disabled?: boolean
  onClose: () => void
  onAdd: (item: PageWidgetCatalogItem, width: PageWidgetWidth) => void
  onCreate?: () => void
}

function widgetIcon(item: PageWidgetCatalogItem) {
  switch (item.widget?.type) {
    case "kpi":
    case "stat-cards":
    case "metrics":
      return Hash
    case "table":
    case "tabbed-table":
      return Table2
    case "custom":
    case "quick-actions":
      return LayoutDashboard
    default:
      return BarChart3
  }
}

export function PageCompositionGallery({
  catalog,
  placements,
  initialSearch = "",
  prompt,
  disabled,
  onClose,
  onAdd,
  onCreate,
}: PageCompositionGalleryProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState(initialSearch)
  const [source, setSource] = useState<"all" | PageWidgetPlacement["source"]>(
    "all",
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [width, setWidth] = useState<PageWidgetWidth | null>(null)
  const query = search.trim().toLocaleLowerCase()
  const filtered = catalog.filter(
    (item) =>
      (source === "all" || item.source === source) &&
      [item.title, item.description, item.category, item.widget?.type].some(
        (value) => value?.toLocaleLowerCase().includes(query),
      ),
  )
  const selected =
    filtered.find((item) => pageWidgetKey(item) === selectedKey) ?? filtered[0]
  const selectedWidth =
    width ?? (selected ? defaultPageWidgetWidth(selected) : 6)
  const onPage = new Set(placements.map(pageWidgetKey))
  const alreadyPlaced = selected
    ? findBuiltinPagePlacement(placements, selected)
    : undefined
  const tabs = [
    {
      value: "all" as const,
      label: t("pageComposition.gallery.all", { defaultValue: "All widgets" }),
    },
    {
      value: "builtin" as const,
      label: t("pageComposition.gallery.builtin", {
        defaultValue: "Page widgets",
      }),
    },
    {
      value: "saved" as const,
      label: t("pageComposition.gallery.saved", {
        defaultValue: "Saved widgets",
      }),
    },
  ]

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        size="review"
        className="gap-5"
        data-testid="page-composition-gallery"
      >
        <DialogHeader>
          <DialogTitle>
            {t("pageComposition.add", { defaultValue: "Add widget" })}
          </DialogTitle>
          <DialogDescription>
            {t("pageComposition.gallery.description", {
              defaultValue:
                "Choose a page widget or a saved chart. Create a new widget to choose its data source and metrics.",
            })}
          </DialogDescription>
          {prompt ? (
            <p className="text-sm">
              {t("pageComposition.gallery.request", {
                defaultValue: "Requested widget: {{prompt}}",
                prompt,
              })}
            </p>
          ) : null}
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
            />
            <Input
              aria-label={t("pageComposition.gallery.search", {
                defaultValue: "Search widgets",
              })}
              placeholder={t("pageComposition.gallery.search", {
                defaultValue: "Search widgets",
              })}
              className="pl-9"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setWidth(null)
              }}
            />
          </div>
          {onCreate ? (
            <Button
              type="button"
              variant="outline"
              onClick={onCreate}
              disabled={disabled}
            >
              <Plus aria-hidden="true" />
              {t("pageComposition.gallery.create", {
                defaultValue: "Create new widget",
              })}
            </Button>
          ) : null}
        </div>
        <div
          role="group"
          aria-label={t("pageComposition.gallery.sources", {
            defaultValue: "Widget sources",
          })}
          className="flex flex-wrap gap-1"
        >
          {tabs.map((tab) => (
            <Button
              key={tab.value}
              type="button"
              size="sm"
              variant={source === tab.value ? "secondary" : "ghost"}
              aria-pressed={source === tab.value}
              onClick={() => {
                setSource(tab.value)
                setWidth(null)
              }}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="grid min-h-56 gap-5 md:grid-cols-2">
          <div className="max-h-96 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t("pageComposition.gallery.empty", {
                  defaultValue:
                    "No widgets match your search. Try another name or create a new widget.",
                })}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
                {filtered.map((item) => {
                  const key = pageWidgetKey(item)
                  const Icon = widgetIcon(item)
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={
                        selected !== undefined &&
                        pageWidgetKey(selected) === key
                      }
                      className={cn(
                        "flex min-w-0 flex-col items-start gap-2 rounded-xl border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected !== undefined &&
                          pageWidgetKey(selected) === key
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50",
                      )}
                      onClick={() => {
                        setSelectedKey(key)
                        setWidth(null)
                      }}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <Icon
                          aria-hidden="true"
                          className="size-5 text-primary"
                        />
                        {item.source === "saved" ? (
                          <Bookmark
                            aria-hidden="true"
                            className="size-3.5 text-muted-foreground"
                          />
                        ) : null}
                      </div>
                      <span className="font-medium">{item.title}</span>
                      {item.category ? (
                        <span className="text-xs text-muted-foreground">
                          {item.category}
                        </span>
                      ) : null}
                      {item.unavailableReason ? (
                        <span className="text-xs text-muted-foreground">
                          {item.unavailableReason}
                        </span>
                      ) : null}
                      {onPage.has(key) ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {t("pageComposition.gallery.onPage", {
                            defaultValue: "On this page",
                          })}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {selected ? (
            <section
              className="min-w-0 space-y-3 rounded-xl border bg-muted/20 p-3"
              aria-label={t("pageComposition.gallery.preview", {
                defaultValue: "Widget preview",
              })}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("pageComposition.gallery.preview", {
                    defaultValue: "Widget preview",
                  })}
                </h3>
                <PageWidgetWidthSelect
                  value={selectedWidth}
                  onChange={setWidth}
                  label={t("pageComposition.gallery.width", {
                    defaultValue: "New widget width",
                  })}
                />
              </div>
              <div inert aria-hidden="true">
                <PageCompositionWidgetBody item={selected} preview />
              </div>
              <p className="text-sm font-medium">{selected.title}</p>
              {selected.description ? (
                <p className="text-sm text-muted-foreground">
                  {selected.description}
                </p>
              ) : null}
              {alreadyPlaced ? (
                <p className="text-sm text-muted-foreground">
                  {t("pageComposition.gallery.alreadyAdded", {
                    defaultValue:
                      "This page widget is already on your page. Close the gallery to move or resize it.",
                  })}
                </p>
              ) : null}
            </section>
          ) : (
            <div aria-hidden="true" />
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            type="button"
            disabled={disabled || !selected || Boolean(alreadyPlaced)}
            onClick={() => {
              if (selected) onAdd(selected, selectedWidth)
            }}
          >
            <Plus aria-hidden="true" />
            {t("pageComposition.gallery.addToPage", {
              defaultValue: "Add to page",
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
