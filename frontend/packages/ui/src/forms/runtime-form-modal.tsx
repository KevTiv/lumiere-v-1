"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import type { FormConfig } from "../lib/form-types"
import { FormModal } from "./form-modal"
import { useRuntimeFormModalConfig } from "./hooks/use-runtime-form-modal-config"
import { metadataFromCustomFields } from "./utils/metadata-defaults"
import { useTranslation } from "@lumiere/i18n"
import { customFieldCreateReasonMessages, resolvedCustomFieldCreateIssues } from "./custom-field-create-admission"

export interface RuntimeFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staticConfig: FormConfig
  moduleId: string
  formId?: string
  organizationId: number
  roleId?: string
  userId?: string
  /** Prefer STDB labels/visibility on matched fields (CRM/sales dual-path collapse). */
  preferStdbVisibility?: boolean
  /** Applied after runtime merge (e.g. select options, default values). */
  transformConfig?: (config: FormConfig) => FormConfig
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>
  className?: string
  closeOnSubmit?: boolean
  showSubmitSuccessToast?: boolean
  submitSuccessMessage?: string
  submitError?: string | null
  formLeadingActions?: React.ReactNode
  isPending?: boolean
  /** When true, `custom:*` keys are folded into a `metadata` JSON string on submit. */
  foldCustomFieldsIntoMetadata?: boolean
  /**
   * `block` is the safe default. Use `use-static` only when the form owner has
   * classified runtime fields, visibility, and relation policy as optional.
   */
  runtimeConfigFailureMode?: "block" | "use-static"
  aiAssist?: React.ComponentProps<typeof FormModal>["aiAssist"]
  renderPreview?: React.ComponentProps<typeof FormModal>["renderPreview"]
  onValuesChange?: React.ComponentProps<typeof FormModal>["onValuesChange"]
  submissionDisabled?: boolean
  draft?: React.ComponentProps<typeof FormModal>["draft"]
  /** Pass the edited record's id so its draft is kept apart from other records. */
  draftKey?: React.ComponentProps<typeof FormModal>["draftKey"]
}

export function RuntimeFormModal({
  open,
  onOpenChange,
  staticConfig,
  moduleId,
  formId,
  organizationId,
  roleId,
  userId,
  preferStdbVisibility = false,
  transformConfig,
  onSubmit,
  foldCustomFieldsIntoMetadata = true,
  runtimeConfigFailureMode = "block",
  submitError,
  submissionDisabled = false,
  ...rest
}: RuntimeFormModalProps) {
  const { t } = useTranslation()
  const { config, isLoading, error, customFieldIds, customFieldCreateIssues = [] } = useRuntimeFormModalConfig({
    staticConfig,
    moduleId,
    formId,
    organizationId,
    roleId,
    userId,
    preferStdbVisibility,
  })

  const resolvedConfig = React.useMemo(() => {
    return transformConfig ? transformConfig(config) : config
  }, [config, transformConfig])

  const atomicCreate = staticConfig.customFieldCreateCapability === "atomic-configured-v1"
  const admissionIssues = atomicCreate ? [...customFieldCreateIssues, ...resolvedCustomFieldCreateIssues(resolvedConfig)]
    .filter((issue, index, all) => all.findIndex((other) => other.fieldId === issue.fieldId && other.reason === issue.reason) === index) : []
  // Legacy owners still block every custom field until their canonical create
  // operation can commit it atomically. Admitted owners block only unsupported definitions.
  const legacyCustomFieldCreationBlocked = Boolean(staticConfig.customFieldCreateUnavailableMessage)
    && resolvedConfig.sections.some((section) => section.fields.some((field) =>
      field.name.startsWith("custom:") || field.id.startsWith("custom:"),
    ))
  const customFieldCreationBlocked = legacyCustomFieldCreationBlocked || admissionIssues.length > 0
  const admissionError = admissionIssues.length ? t("common.customFieldCreateAdmission.blocked", {
    defaultValue: "This form cannot create a record with these configured fields yet: {{fields}}. Ask an administrator to review them. No record has been created. Your entries are retained.",
    fields: admissionIssues.map((issue) => `${issue.label} (${t(`common.customFieldCreateAdmission.reasons.${issue.reason}`, { defaultValue: customFieldCreateReasonMessages[issue.reason] })})`).join(", "),
  }) : undefined

  const handleSubmit = React.useCallback(
    async (data: Record<string, unknown>) => {
      if (!onSubmit || customFieldCreationBlocked) return
      if (foldCustomFieldsIntoMetadata && customFieldIds.length > 0) {
        const metadata = metadataFromCustomFields(data, customFieldIds)
        const core = { ...data }
        for (const id of customFieldIds) {
          delete core[id]
        }
        await onSubmit({ ...core, metadata })
        return
      }
      await onSubmit(data)
    },
    [onSubmit, foldCustomFieldsIntoMetadata, customFieldIds, customFieldCreationBlocked],
  )

  if (open && isLoading) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
        data-testid={`runtime-form-modal-loading-${staticConfig.id}`}
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const runtimeConfigFailed = error != null
  const submissionBlocked = runtimeConfigFailed && (runtimeConfigFailureMode === "block" || atomicCreate)
  const runtimeConfigError = submissionBlocked
    ? `Runtime form configuration is unavailable. Submission is disabled. ${error}`
    : customFieldCreationBlocked
      ? [admissionError ?? staticConfig.customFieldCreateUnavailableMessage, submitError].filter(Boolean).join(" ")
      : submitError
  const displayConfig = runtimeConfigFailed ? staticConfig : resolvedConfig
  const admittedConfig = atomicCreate && (submissionBlocked || customFieldCreationBlocked)
    ? { ...displayConfig, sections: displayConfig.sections.map((section) => ({ ...section, fields: section.fields.map((field) => ({ ...field, disabled: true })) })) }
    : displayConfig

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      config={admittedConfig}
      onSubmit={submissionBlocked || customFieldCreationBlocked ? undefined : runtimeConfigFailed ? onSubmit : handleSubmit}
      submissionDisabled={submissionBlocked || customFieldCreationBlocked || submissionDisabled}
      submitError={runtimeConfigError}
      {...rest}
    />
  )
}
