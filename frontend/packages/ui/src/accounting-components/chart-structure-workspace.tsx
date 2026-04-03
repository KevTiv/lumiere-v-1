"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { EntityView } from "@/components/entity-views/entity-view"
import type { EntityTableConfig, EntityViewConfig } from "@/lib/entity-view-types"
import { accountAccountTypeForm, accountGroupForm } from "@/lib/accounting-form-configs"
import { mergeFieldDefaultValues, mergeSelectOptionsByFieldName } from "@/lib/form-config-merge"
import { FormModal } from "@/components/forms/form-modal"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function enumTag(v: unknown): string {
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function internalGroupFormValue(v: unknown): string {
  const tag = enumTag(v)
  if (!tag) return "asset"
  return tag.charAt(0).toLowerCase() + tag.slice(1)
}

export interface ChartStructureWorkspaceProps {
  accountTypes: Record<string, unknown>[]
  accountGroups: Record<string, unknown>[]
  onCreateAccountType: (params: Record<string, unknown>) => void | Promise<void>
  onUpdateAccountType: (typeId: bigint, params: Record<string, unknown>) => void | Promise<void>
  onCreateAccountGroup: (params: Record<string, unknown>) => void | Promise<void>
  onUpdateAccountGroup: (groupId: bigint, params: Record<string, unknown>) => void | Promise<void>
}

export function ChartStructureWorkspace({
  accountTypes,
  accountGroups,
  onCreateAccountType,
  onUpdateAccountType,
  onCreateAccountGroup,
  onUpdateAccountGroup,
}: ChartStructureWorkspaceProps) {
  const { t } = useTranslation()

  const parentGroupOptions = useMemo(
    () => [
      { value: "", label: t("accounting.forms.accountGroup.noParent") },
      ...accountGroups.map((g) => ({
        value: String(g.id ?? ""),
        label: String(g.name ?? g.id ?? ""),
      })),
    ],
    [accountGroups, t],
  )

  const typesView = useMemo((): EntityViewConfig => {
    const view: EntityTableConfig = {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("accounting.chartStructure.searchTypes"),
      searchKeys: ["name", "type"],
      columns: [
        { key: "name", label: t("accounting.chartStructure.colName"), width: "min-w-36" },
        { key: "type", label: t("accounting.chartStructure.colTypeKey"), width: "min-w-24" },
        {
          key: "internalGroup",
          label: t("accounting.chartStructure.colGroup"),
          width: "min-w-28",
          render: (v) => <span className="text-sm">{enumTag(v)}</span>,
        },
        {
          key: "includeInitialBalance",
          label: t("accounting.chartStructure.colOpening"),
          type: "boolean",
          align: "center",
        },
        {
          key: "isDeprecated",
          label: t("accounting.chartStructure.colDeprecated"),
          type: "boolean",
          align: "center",
        },
      ],
      emptyMessage: t("accounting.chartStructure.emptyTypes"),
    }
    return {
      id: "account-types-structure",
      title: "",
      view,
    }
  }, [t])

  const groupsView = useMemo((): EntityViewConfig => {
    const view: EntityTableConfig = {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("accounting.chartStructure.searchGroups"),
      searchKeys: ["name", "codePrefixStart", "codePrefixEnd"],
      columns: [
        { key: "name", label: t("accounting.chartStructure.colName"), width: "min-w-36" },
        { key: "level", label: t("accounting.chartStructure.colLevel"), width: "min-w-16" },
        {
          key: "parentId",
          label: t("accounting.chartStructure.colParent"),
          width: "min-w-24",
          render: (v) => {
            if (v == null || v === "") return "—"
            const id = String(v)
            const row = accountGroups.find((g) => String(g.id) === id)
            return row ? String(row.name ?? id) : id
          },
        },
        { key: "codePrefixStart", label: t("accounting.chartStructure.colPrefixStart"), width: "min-w-24" },
        { key: "codePrefixEnd", label: t("accounting.chartStructure.colPrefixEnd"), width: "min-w-24" },
      ],
      emptyMessage: t("accounting.chartStructure.emptyGroups"),
    }
    return {
      id: "account-groups-structure",
      title: "",
      view,
    }
  }, [t, accountGroups])

  const [typeModalOpen, setTypeModalOpen] = useState(false)
  const [typeFormKey, setTypeFormKey] = useState(0)
  const [typeDefaults, setTypeDefaults] = useState<Record<string, unknown>>({
    typeId: "",
    name: "",
    type: "",
    internalGroup: "asset",
    includeInitialBalance: false,
    isDeprecated: false,
    metadata: "",
  })

  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [groupFormKey, setGroupFormKey] = useState(0)
  const [groupDefaults, setGroupDefaults] = useState<Record<string, unknown>>({
    groupId: "",
    name: "",
    level: 0,
    codePrefixStart: "",
    codePrefixEnd: "",
    parentId: "",
    metadata: "",
  })

  const baseTypeForm = useMemo(() => accountAccountTypeForm(t), [t])
  const typeFormConfig = useMemo(() => {
    const merged = mergeFieldDefaultValues(baseTypeForm, typeDefaults)
    const isEdit = String(typeDefaults.typeId ?? "").trim() !== ""
    return {
      ...merged,
      title: isEdit
        ? t("accounting.forms.accountAccountType.editTitle")
        : t("accounting.forms.accountAccountType.title"),
      submitLabel: isEdit ? t("common.save") : t("accounting.forms.accountAccountType.submitLabel"),
    }
  }, [t, baseTypeForm, typeDefaults])

  const baseGroupForm = useMemo(() => {
    const f = accountGroupForm(t)
    return mergeSelectOptionsByFieldName(f, "parentId", parentGroupOptions)
  }, [t, parentGroupOptions])

  const groupFormConfig = useMemo(() => {
    const merged = mergeFieldDefaultValues(baseGroupForm, groupDefaults)
    const isEdit = String(groupDefaults.groupId ?? "").trim() !== ""
    return {
      ...merged,
      title: isEdit ? t("accounting.forms.accountGroup.editTitle") : t("accounting.forms.accountGroup.title"),
      submitLabel: isEdit ? t("common.save") : t("accounting.forms.accountGroup.submitLabel"),
    }
  }, [t, baseGroupForm, groupDefaults])

  const typesTitleBlock = useMemo(
    () => ({
      ...typesView,
      title: t("accounting.chartStructure.typesTitle"),
      description: t("accounting.chartStructure.typesDescription"),
    }),
    [typesView, t],
  )

  const groupsTitleBlock = useMemo(
    () => ({
      ...groupsView,
      title: t("accounting.chartStructure.groupsTitle"),
      description: t("accounting.chartStructure.groupsDescription"),
    }),
    [groupsView, t],
  )

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>{t("accounting.chartStructure.typesTitle")}</CardTitle>
            <CardDescription>{t("accounting.chartStructure.typesDescription")}</CardDescription>
          </div>
          <Button
            type="button"
            onClick={() => {
              setTypeDefaults({
                typeId: "",
                name: "",
                type: "",
                internalGroup: "asset",
                includeInitialBalance: false,
                isDeprecated: false,
                metadata: "",
              })
              setTypeFormKey((k) => k + 1)
              setTypeModalOpen(true)
            }}
          >
            {t("accounting.chartStructure.newType")}
          </Button>
        </CardHeader>
        <CardContent>
          <EntityView
            config={typesTitleBlock}
            data={accountTypes}
            onRowClick={(row) => {
              const r = row as Record<string, unknown>
              setTypeDefaults({
                typeId: String(r.id ?? ""),
                name: String(r.name ?? ""),
                type: String(r.type ?? ""),
                internalGroup: internalGroupFormValue(r.internalGroup),
                includeInitialBalance: Boolean(r.includeInitialBalance),
                isDeprecated: Boolean(r.isDeprecated),
                metadata: r.metadata != null ? String(r.metadata) : "",
              })
              setTypeFormKey((k) => k + 1)
              setTypeModalOpen(true)
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>{t("accounting.chartStructure.groupsTitle")}</CardTitle>
            <CardDescription>{t("accounting.chartStructure.groupsDescription")}</CardDescription>
          </div>
          <Button
            type="button"
            onClick={() => {
              setGroupDefaults({
                groupId: "",
                name: "",
                level: 0,
                codePrefixStart: "",
                codePrefixEnd: "",
                parentId: "",
                metadata: "",
              })
              setGroupFormKey((k) => k + 1)
              setGroupModalOpen(true)
            }}
          >
            {t("accounting.chartStructure.newGroup")}
          </Button>
        </CardHeader>
        <CardContent>
          <EntityView
            config={groupsTitleBlock}
            data={accountGroups}
            onRowClick={(row) => {
              const r = row as Record<string, unknown>
              setGroupDefaults({
                groupId: String(r.id ?? ""),
                name: String(r.name ?? ""),
                level: r.level != null ? Number(r.level) : 0,
                codePrefixStart: r.codePrefixStart != null ? String(r.codePrefixStart) : "",
                codePrefixEnd: r.codePrefixEnd != null ? String(r.codePrefixEnd) : "",
                parentId: r.parentId != null ? String(r.parentId) : "",
                metadata: r.metadata != null ? String(r.metadata) : "",
              })
              setGroupFormKey((k) => k + 1)
              setGroupModalOpen(true)
            }}
          />
        </CardContent>
      </Card>

      <FormModal
        key={`account-type-${typeFormKey}`}
        open={typeModalOpen}
        onOpenChange={setTypeModalOpen}
        config={typeFormConfig}
        onSubmit={async (formData) => {
          const fd = formData as Record<string, unknown>
          const tid = String(fd.typeId ?? "").trim()
          if (!tid) {
            await onCreateAccountType(fd)
          } else {
            await onUpdateAccountType(BigInt(tid), fd)
          }
        }}
      />

      <FormModal
        key={`account-group-${groupFormKey}`}
        open={groupModalOpen}
        onOpenChange={setGroupModalOpen}
        config={groupFormConfig}
        onSubmit={async (formData) => {
          const fd = formData as Record<string, unknown>
          const gid = String(fd.groupId ?? "").trim()
          if (!gid) {
            await onCreateAccountGroup(fd)
          } else {
            await onUpdateAccountGroup(BigInt(gid), fd)
          }
        }}
      />
    </div>
  )
}
