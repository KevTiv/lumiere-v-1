"use client"

import { useMemo } from "react"
import type { FormConfig } from "../../lib/form-types"
import { mergeRuntimeFormConfig } from "../../lib/runtime-form-config"
import { useFormConfiguration } from "./use-form-config"

export interface UseRuntimeFormModalConfigOptions {
  staticConfig: FormConfig
  moduleId: string
  /** Defaults to `staticConfig.id` when omitted. */
  formId?: string
  organizationId: number
  roleId?: string
  userId?: string
}

/**
 * Loads STDB form configuration and merges it with a static module form config
 * for use in {@link RuntimeFormModal} / {@link FormModal}.
 */
export function useRuntimeFormModalConfig(options: UseRuntimeFormModalConfigOptions): {
  config: FormConfig
  isLoading: boolean
  error: string | null
  customFieldIds: string[]
} {
  const { staticConfig, moduleId, organizationId, roleId, userId } = options
  const formId = options.formId ?? staticConfig.id

  const { config: runtime, isLoading, error } = useFormConfiguration({
    moduleId,
    formId,
    organizationId,
    roleId,
    userId,
    useDefaultIfMissing: true,
  })

  const merged = useMemo(
    () => mergeRuntimeFormConfig(staticConfig, runtime),
    [staticConfig, runtime],
  )

  return {
    config: merged.config,
    isLoading,
    error,
    customFieldIds: merged.customFieldIds,
  }
}
