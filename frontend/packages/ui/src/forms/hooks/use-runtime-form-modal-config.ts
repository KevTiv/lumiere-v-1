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
  /**
   * When true, pass preferStdbVisibility into merge (CRM/sales dual-path collapse).
   * Labels/disabled state from STDB win on matched fields; custom fields are appended.
   */
  preferStdbVisibility?: boolean
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
  /** True when a SpacetimeDB form_config row exists (id > 0). */
  runtimeFromDatabase: boolean
} {
  const {
    staticConfig,
    moduleId,
    organizationId,
    roleId,
    userId,
    preferStdbVisibility = false,
  } = options
  const formId = options.formId ?? staticConfig.id

  const { config: runtime, isLoading, error, dbConfigurationId } = useFormConfiguration({
    moduleId,
    formId,
    organizationId,
    roleId,
    userId,
    useDefaultIfMissing: true,
  })

  const runtimeFromDatabase = dbConfigurationId > 0

  const merged = useMemo(
    () =>
      mergeRuntimeFormConfig(staticConfig, runtime, {
        preferStdbVisibility,
        runtimeFromDatabase,
      }),
    [staticConfig, runtime, preferStdbVisibility, runtimeFromDatabase],
  )

  return {
    config: merged.config,
    isLoading,
    error,
    customFieldIds: merged.customFieldIds,
    runtimeFromDatabase,
  }
}
