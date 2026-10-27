"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { Input } from "../components/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../components/dropdown-menu"
import { workspaceStyles } from "../lib/workspace-styles"
import { toggleHiddenColumn } from "../lib/entity-table-view"
import type { EntityColumn } from "../lib/entity-view-types"
import type { AccountingListDisplayProps } from "./accounting-list-display"
import {
  WORKLIST_COLUMNS,
  type AccountingWorklistView,
  type NamedAccountingWorklist,
} from "./accounting-worklist-model"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select"

interface AccountingWorklistToolbarProps extends Pick<
  AccountingListDisplayProps,
  "initialFilters" | "onInitialFilterClear"
> {
  value: AccountingWorklistView
  onChange: (value: AccountingWorklistView) => void
  saved: NamedAccountingWorklist[]
  onSave: (name: string) => void
  onRemove: (name: string) => void
  columns: EntityColumn[]
  currencies: readonly { value: string; label: string }[]
  statuses: readonly { value: string; label: string }[]
  persistent: boolean
  selectedCount: number
  onExport?: () => void
  onClearSelection: () => void
}

const selectClass =
  "h-11 min-h-11 w-full min-w-0"

export function AccountingWorklistToolbar({
  value,
  onChange,
  saved,
  onSave,
  onRemove,
  columns,
  currencies,
  statuses,
  persistent,
  initialFilters = {},
  onInitialFilterClear,
  selectedCount,
  onExport,
  onClearSelection,
}: AccountingWorklistToolbarProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [chosenView, setChosenView] = useState("")
  const updateFilter = (
    key: keyof AccountingWorklistView["filters"],
    next: string
  ) => onChange({ ...value, filters: { ...value.filters, [key]: next } })
  return (
    <div
      className="min-w-0 space-y-3"
      data-testid="accounting-worklist-toolbar"
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0 space-y-1 text-xs font-medium">
          <span>{t("common.search", { defaultValue: "Search" })}</span>
          <Input
            className="h-11 min-h-11"
            value={initialFilters.search ?? value.search}
            disabled={initialFilters.search !== undefined}
            maxLength={200}
            onChange={(event) =>
              onChange({ ...value, search: event.target.value })
            }
            placeholder={t("accounting.worklists.search", {
              defaultValue: "Document or partner",
            })}
          />
        </label>
        <label className="min-w-0 space-y-1 text-xs font-medium">
          <span>{t("accounting.journalEntries.state")}</span>
          <Select
            value={String(initialFilters.status ?? value.filters.status ?? "") || "__none__"}
            onValueChange={(selectValue) => {
              const nextValue = selectValue === "__none__" ? "" : selectValue
              updateFilter("status", nextValue)
            }}
            disabled={Boolean(initialFilters.status)}
          >
            <SelectTrigger className={selectClass} aria-label={t("accounting.journalEntries.state")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={"__none__"}>{t("accounting.invoices.allStatus")}</SelectItem>
              {statuses.map((status) => (
                <SelectItem key={status.value} value={String(status.value)}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="min-w-0 space-y-1 text-xs font-medium">
          <span>
            {t("accounting.worklists.currency", { defaultValue: "Currency" })}
          </span>
          <Select
            value={String(initialFilters.currencyId ?? value.filters.currencyId ?? "") || "__none__"}
            onValueChange={(selectValue) => {
              const nextValue = selectValue === "__none__" ? "" : selectValue
              updateFilter("currencyId", nextValue)
            }}
            disabled={Boolean(initialFilters.currencyId)}
          >
            <SelectTrigger
              className={selectClass}
              aria-label={t("accounting.worklists.currency", { defaultValue: "Currency" })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={"__none__"}>
                {t("accounting.worklists.allCurrencies", {
                  defaultValue: "All currencies",
                })}
              </SelectItem>
              {currencies.map((currency) => (
                <SelectItem key={currency.value} value={String(currency.value)}>
                  {currency.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="min-w-0 space-y-1 text-xs font-medium">
          <span>
            {t("accounting.worklists.queue", { defaultValue: "Balance queue" })}
          </span>
          <Select
            value={String(initialFilters.queue ?? value.filters.queue ?? "") || "__none__"}
            onValueChange={(selectValue) => {
              const nextValue = selectValue === "__none__" ? "" : selectValue
              updateFilter("queue", nextValue)
            }}
            disabled={Boolean(initialFilters.queue)}
          >
            <SelectTrigger
              className={selectClass}
              aria-label={t("accounting.worklists.queue", { defaultValue: "Balance queue" })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={"__none__"}>
                {t("accounting.worklists.allBalances", {
                  defaultValue: "All balances",
                })}
              </SelectItem>
              <SelectItem value={"open"}>
                {t("accounting.worklists.open", {
                  defaultValue: "Posted · balance due",
                })}
              </SelectItem>
              <SelectItem value={"overdue"}>{t("accounting.states.overdue")}</SelectItem>
              {value.filters.queue === "pending" && (
                <SelectItem value={"pending"}>{t("accounting.states.pending")}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </label>
      </div>
      {Object.keys(initialFilters).length > 0 && (
        <div className="space-y-2">
          <div
            className="flex min-w-0 flex-wrap gap-2"
            aria-label="Linked record filters"
          >
            {Object.entries(initialFilters).map(([key, filterValue]) => (
              <span
                key={key}
                className="inline-flex min-w-0 max-w-full items-center rounded-md border bg-muted/30 pl-3 text-xs"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {key}: {filterValue}
                </span>
                {onInitialFilterClear && (
                  <Button
                    className="min-h-11 min-w-11 shrink-0"
                    variant="ghost"
                    aria-label={`Clear ${key} filter`}
                    onClick={() => onInitialFilterClear(key)}
                  >
                    ×
                  </Button>
                )}
              </span>
            ))}
          </div>
          <p className={workspaceStyles.sectionDescription}>
            {t("accounting.worklists.linkedFilters", {
              defaultValue:
                "Linked filters remain active when you apply a saved view. Clear a linked filter to change it.",
            })}
          </p>
        </div>
      )}
      <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="min-w-0 space-y-1 text-xs font-medium">
          <span>
            {t("accounting.worklists.savedViews", {
              defaultValue: "Saved views",
            })}
          </span>
          <Select
            value={chosenView === "" ? "__none__" : `saved:${chosenView}`}
            onValueChange={(selectValue) => {
              const nextValue = selectValue === "__none__" ? "" : selectValue.slice(6)
              setChosenView(nextValue)
              const view = saved.find((item) => item.name === nextValue)
              if (view)
                onChange({
                  search: view.search,
                  filters: { ...view.filters },
                  hiddenColumns: [...view.hiddenColumns],
                })
            }}
          >
            <SelectTrigger
              className={selectClass}
              aria-label={t("accounting.worklists.savedViews", { defaultValue: "Saved views" })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={"__none__"}>
                {t("accounting.worklists.chooseView", {
                  defaultValue: "Choose a saved view",
                })}
              </SelectItem>
              {saved.map((view) => (
                <SelectItem key={view.name} value={`saved:${view.name}`}>
                  {view.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="min-w-0 space-y-1 text-xs font-medium">
          <span>
            {t("accounting.worklists.viewName", { defaultValue: "View name" })}
          </span>
          <Input
            className="h-11 min-h-11"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("accounting.worklists.viewNamePlaceholder", {
              defaultValue: "e.g. Overdue customers",
            })}
          />
        </label>
        <div className={workspaceStyles.actions}>
          <Button
            className="min-h-11"
            variant="outline"
            disabled={!name.trim()}
            onClick={() => {
              onSave(name)
              setChosenView(name.trim())
              setName("")
            }}
          >
            {t("accounting.worklists.saveView", { defaultValue: "Save view" })}
          </Button>
          {chosenView && saved.some((view) => view.name === chosenView) && (
            <Button
              className="min-h-11"
              variant="ghost"
              onClick={() => {
                onRemove(chosenView)
                setChosenView("")
              }}
            >
              {t("common.delete", { defaultValue: "Delete" })}
            </Button>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className={workspaceStyles.sectionDescription}>
          {persistent
            ? t("accounting.worklists.savedLocally", {
                defaultValue:
                  "Views are saved in this browser for your account and company.",
              })
            : t("accounting.worklists.sessionOnly", {
                defaultValue:
                  "Views are available for this session only; browser persistence is unavailable.",
              })}
        </p>
        <div className={workspaceStyles.actions}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="min-h-11" variant="outline">
                {t("accounting.worklists.columns", { defaultValue: "Columns" })}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-[min(70vh,28rem)] overflow-y-auto"
            >
              {columns.map((column) => (
                <DropdownMenuCheckboxItem
                  className="min-h-11"
                  key={column.key}
                  checked={!value.hiddenColumns.includes(column.key)}
                  disabled={column.key === "name"}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() =>
                    onChange({
                      ...value,
                      hiddenColumns: toggleHiddenColumn(
                        value.hiddenColumns,
                        column.key,
                        WORKLIST_COLUMNS
                      ),
                    })
                  }
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            className="min-h-11"
            variant="ghost"
            onClick={() => {
              onChange({
                search: "",
                filters: { status: "", currencyId: "", queue: "" },
                hiddenColumns: value.hiddenColumns,
              })
              onInitialFilterClear?.("*")
            }}
          >
            {t("common.entityView.noResults.clear", {
              defaultValue: "Clear filters",
            })}
          </Button>
          {selectedCount > 0 && (
            <Button
              className="min-h-11"
              variant="ghost"
              onClick={onClearSelection}
            >
              {t("accounting.worklists.clearSelection", {
                defaultValue: "Clear selection",
              })}{" "}
              ({selectedCount})
            </Button>
          )}
          {onExport && (
            <Button className="min-h-11" variant="outline" onClick={onExport}>
              {selectedCount > 0
                ? t("accounting.worklists.exportSelected", {
                    defaultValue: "Export selected",
                  })
                : t("accounting.worklists.exportCsv", {
                    defaultValue: "Export CSV",
                  })}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
