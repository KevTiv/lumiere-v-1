"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { EntityView } from "@/components/entity-views/entity-view"
import { budgetsTableConfig } from "@/lib/entity-configs"
import type { EntityTableConfig, EntityViewConfig } from "@/lib/entity-view-types"
import { budgetPostForm, updateBudgetLineActualsForm } from "@/lib/accounting-form-configs"
import { mergeFieldDefaultValues } from "@/lib/form-config-merge"
import { FormModal } from "@/components/forms/form-modal"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function rowState(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

const budgetPostsTableConfig: EntityViewConfig = {
  id: "budget-posts-table",
  title: "",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search budget positions…",
    searchKeys: ["name", "code"],
    columns: [
      { key: "name", label: "Name", width: "min-w-36" },
      { key: "code", label: "Code", width: "min-w-24" },
      {
        key: "isActive",
        label: "Active",
        type: "boolean",
        align: "center",
      },
      {
        key: "accountIds",
        label: "Account IDs",
        width: "min-w-40",
        render: (v) => (
          <span className="text-muted-foreground text-xs font-mono truncate max-w-[12rem] inline-block">
            {Array.isArray(v) ? (v as unknown[]).join(", ") : "—"}
          </span>
        ),
      },
    ],
    emptyMessage: "No budget positions yet.",
  },
}

export interface BudgetsWorkspaceProps {
  budgets: Record<string, unknown>[]
  budgetLines: Record<string, unknown>[]
  budgetPosts: Record<string, unknown>[]
  onConfirmBudget: (budgetId: bigint) => void | Promise<void>
  onValidateBudget: (budgetId: bigint) => void | Promise<void>
  onDoneBudget: (budgetId: bigint) => void | Promise<void>
  onCancelBudget: (budgetId: bigint) => void | Promise<void>
  onDeleteBudgetLine: (lineId: bigint) => void | Promise<void>
  onUpdateLineActuals: (
    lineId: bigint,
    params: { practicalAmount: number; theoreticalAmount: number },
  ) => void | Promise<void>
  onCreateBudgetPost: (params: Record<string, unknown>) => void | Promise<void>
  onUpdateBudgetPost: (postId: bigint, params: Record<string, unknown>) => void | Promise<void>
  workflowPending?: boolean
  linePending?: boolean
  postPending?: boolean
}

export function BudgetsWorkspace({
  budgets,
  budgetLines,
  budgetPosts,
  onConfirmBudget,
  onValidateBudget,
  onDoneBudget,
  onCancelBudget,
  onDeleteBudgetLine,
  onUpdateLineActuals,
  onCreateBudgetPost,
  onUpdateBudgetPost,
  workflowPending,
  linePending,
  postPending,
}: BudgetsWorkspaceProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)

  const [postModalOpen, setPostModalOpen] = useState(false)
  const [postFormKey, setPostFormKey] = useState(0)
  const [postDefaults, setPostDefaults] = useState<Record<string, unknown>>({
    postId: "",
    name: "",
    code: "",
    description: "",
    accountIds: "",
    isActive: true,
  })

  const [actualsModalOpen, setActualsModalOpen] = useState(false)
  const [actualsFormKey, setActualsFormKey] = useState(0)
  const [actualsDefaults, setActualsDefaults] = useState<Record<string, unknown>>({
    lineId: "",
    practicalAmount: 0,
    theoreticalAmount: 0,
  })

  const budgetsNormalized = useMemo(
    () =>
      budgets.map((b) => {
        const r = b as Record<string, unknown>
        return { ...r, state: rowState(r) }
      }),
    [budgets],
  )

  const budgetTableConfig = useMemo((): EntityViewConfig => {
    const view = budgetsTableConfig.view as EntityTableConfig
    return {
      ...budgetsTableConfig,
      title: t("accounting.budgets.workspace.listTitle"),
      description: t("accounting.budgets.workspace.listDescription"),
      view: {
        ...view,
        emptyMessage: t("accounting.budgets.workspace.emptyBudgets"),
      },
    }
  }, [t])

  const postsConfig = useMemo((): EntityViewConfig => {
    const v = budgetPostsTableConfig.view as EntityTableConfig
    return {
      ...budgetPostsTableConfig,
      title: t("accounting.budgets.workspace.postsTitle"),
      description: t("accounting.budgets.workspace.postsDescription"),
      view: {
        ...v,
        searchPlaceholder: t("accounting.budgets.workspace.searchPosts"),
        emptyMessage: t("accounting.budgets.workspace.emptyPosts"),
        columns: v.columns.map((c) =>
          c.key === "name" ? { ...c, label: t("accounting.budgets.workspace.colName") } : c,
        ),
      },
    }
  }, [t])

  const baseBudgetPostForm = useMemo(() => budgetPostForm(t), [t])
  const budgetPostFormConfig = useMemo(() => {
    const merged = mergeFieldDefaultValues(baseBudgetPostForm, postDefaults)
    const isEdit = String(postDefaults.postId ?? "").trim() !== ""
    return {
      ...merged,
      title: isEdit ? t("accounting.forms.budgetPost.editTitle") : t("accounting.forms.budgetPost.title"),
      submitLabel: isEdit ? t("common.save") : t("accounting.forms.budgetPost.submitLabel"),
    }
  }, [t, baseBudgetPostForm, postDefaults])

  const baseActualsForm = useMemo(() => updateBudgetLineActualsForm(t), [t])
  const actualsFormConfig = useMemo(
    () => mergeFieldDefaultValues(baseActualsForm, actualsDefaults),
    [baseActualsForm, actualsDefaults],
  )

  const selectedId = selected?.id != null ? BigInt(String(selected.id)) : null
  const selectedState = selected ? rowState(selected) : ""

  const linesForBudget = useMemo(() => {
    if (selectedId == null) return []
    return budgetLines.filter((l) => BigInt(String(l.generalBudgetId ?? 0)) === selectedId)
  }, [budgetLines, selectedId])

  const openNewPost = () => {
    setPostFormKey((k) => k + 1)
    setPostDefaults({
      postId: "",
      name: "",
      code: "",
      description: "",
      accountIds: "",
      isActive: true,
    })
    setPostModalOpen(true)
  }

  const openEditPost = (row: Record<string, unknown>) => {
    setPostFormKey((k) => k + 1)
    const ids = row.accountIds
    setPostDefaults({
      postId: String(row.id ?? ""),
      name: String(row.name ?? ""),
      code: row.code != null ? String(row.code) : "",
      description: row.description != null ? String(row.description) : "",
      accountIds: Array.isArray(ids) ? (ids as unknown[]).map(String).join(", ") : "",
      isActive: row.isActive !== false,
    })
    setPostModalOpen(true)
  }

  const onSubmitBudgetPost = async (data: Record<string, unknown>) => {
    const postId = String(data.postId ?? "").trim()
    const payload: Record<string, unknown> = {
      name: data.name,
      code: data.code,
      description: data.description,
      accountIds: data.accountIds,
      isActive: data.isActive,
    }
    if (postId) {
      await onUpdateBudgetPost(BigInt(postId), payload)
    } else {
      await onCreateBudgetPost(payload)
    }
  }

  const openActuals = (line: Record<string, unknown>) => {
    setActualsFormKey((k) => k + 1)
    setActualsDefaults({
      lineId: String(line.id ?? ""),
      practicalAmount: Number(line.practicalAmount ?? 0),
      theoreticalAmount: Number(line.theoreticalAmount ?? 0),
    })
    setActualsModalOpen(true)
  }

  const onSubmitActualsForm = async (data: Record<string, unknown>) => {
    const lineId = String(data.lineId ?? "").trim()
    const practicalAmount = Number(data.practicalAmount)
    const theoreticalAmount = Number(data.theoreticalAmount)
    if (!lineId || !Number.isFinite(practicalAmount) || !Number.isFinite(theoreticalAmount)) {
      return
    }
    await onUpdateLineActuals(BigInt(lineId), { practicalAmount, theoreticalAmount })
  }

  return (
    <div className="space-y-8">
      <EntityView
        config={budgetTableConfig}
        data={budgetsNormalized}
        onRowClick={(row: Record<string, unknown>) => setSelected(row)}
      />

      <Card className="bg-card border-border/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{t("accounting.budgets.workspace.postsTitle")}</CardTitle>
            <CardDescription>{t("accounting.budgets.workspace.postsDescription")}</CardDescription>
          </div>
          <Button size="sm" onClick={openNewPost} disabled={postPending}>
            {t("accounting.budgets.workspace.newPost")}
          </Button>
        </CardHeader>
        <CardContent>
          <EntityView
            config={postsConfig}
            data={budgetPosts}
            useCard={false}
            onRowClick={(row: Record<string, unknown>) => openEditPost(row)}
          />
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{String(selected.name ?? t("accounting.budgets.title"))}</SheetTitle>
                <SheetDescription>
                  {t("accounting.budgets.workspace.detailHint")}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{selectedState}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {t("accounting.budgets.planned")}:{" "}
                    {Number(selected.totalPlanned ?? 0).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                    })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedState === "Draft" && (
                    <Button
                      size="sm"
                      disabled={workflowPending}
                      onClick={() => selectedId != null && void onConfirmBudget(selectedId)}
                    >
                      {t("accounting.budgets.workspace.confirm")}
                    </Button>
                  )}
                  {selectedState === "Confirm" && (
                    <Button
                      size="sm"
                      disabled={workflowPending}
                      onClick={() => selectedId != null && void onValidateBudget(selectedId)}
                    >
                      {t("accounting.budgets.workspace.validate")}
                    </Button>
                  )}
                  {selectedState === "Validate" && (
                    <Button
                      size="sm"
                      disabled={workflowPending}
                      onClick={() => selectedId != null && void onDoneBudget(selectedId)}
                    >
                      {t("accounting.budgets.workspace.markDone")}
                    </Button>
                  )}
                  {selectedState !== "Done" && selectedState !== "Cancel" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={workflowPending}
                      onClick={() => selectedId != null && void onCancelBudget(selectedId)}
                    >
                      {t("accounting.budgets.workspace.cancelBudget")}
                    </Button>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-medium mb-2">
                    {t("accounting.budgets.workspace.linesTitle")}
                  </h4>
                  <div className="rounded-md border border-border/50">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-20">ID</TableHead>
                          <TableHead>{t("accounting.budgets.workspace.colAnalytic")}</TableHead>
                          <TableHead className="text-right">
                            {t("accounting.budgets.planned")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("accounting.budgets.practical")}
                          </TableHead>
                          <TableHead className="text-right w-32">
                            {t("accounting.budgets.workspace.actions")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linesForBudget.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="text-center text-muted-foreground py-8 text-sm"
                            >
                              {t("accounting.budgets.workspace.noLines")}
                            </TableCell>
                          </TableRow>
                        ) : (
                          linesForBudget.map((line) => {
                            const lid = line.id != null ? BigInt(String(line.id)) : 0n
                            const canDelete = selectedState === "Draft"
                            const canActuals =
                              selectedState === "Confirm" || selectedState === "Validate"
                            return (
                              <TableRow key={String(line.id ?? "")}>
                                <TableCell className="font-mono text-xs">{String(line.id)}</TableCell>
                                <TableCell className="text-sm">
                                  {line.analyticAccountId != null
                                    ? String(line.analyticAccountId)
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {Number(line.plannedAmount ?? 0).toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {Number(line.practicalAmount ?? 0).toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1 flex-wrap">
                                    {canActuals && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs"
                                        disabled={linePending}
                                        onClick={() => openActuals(line)}
                                      >
                                        {t("accounting.budgets.workspace.actuals")}
                                      </Button>
                                    )}
                                    {canDelete && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 text-xs text-destructive"
                                        disabled={linePending}
                                        onClick={() => lid > 0n && void onDeleteBudgetLine(lid)}
                                      >
                                        {t("accounting.budgets.workspace.deleteLine")}
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <FormModal
        key={`budget-post-${postFormKey}`}
        open={postModalOpen}
        onOpenChange={setPostModalOpen}
        config={budgetPostFormConfig}
        onSubmit={onSubmitBudgetPost}
      />

      <FormModal
        key={`budget-line-actuals-${actualsFormKey}`}
        open={actualsModalOpen}
        onOpenChange={setActualsModalOpen}
        config={actualsFormConfig}
        onSubmit={onSubmitActualsForm}
      />
    </div>
  )
}
