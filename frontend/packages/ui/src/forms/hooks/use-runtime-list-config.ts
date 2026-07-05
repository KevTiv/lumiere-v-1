"use client"

import { useMemo } from "react"
import type { EntityTableConfig } from "../../lib/entity-view-types"
import { mergeRuntimeListConfig, runtimeListFiltersFromFields } from "../../lib/runtime-list-config"
import { useFormConfiguration } from "./use-form-config"

export interface UseRuntimeListConfigOptions {
  base: EntityTableConfig
  moduleId: string
  formId: string
  organizationId: number
  roleId?: string
  /** localStorage key for saved filter state */
  listViewKey?: string
}

export function useRuntimeListConfig(options: UseRuntimeListConfigOptions): EntityTableConfig {
  const { base, moduleId, formId, organizationId, roleId, listViewKey } = options

  const { config: runtime, isLoading } = useFormConfiguration({
    moduleId,
    formId,
    organizationId,
    roleId,
    useDefaultIfMissing: true,
  })

  return useMemo(() => {
    if (isLoading) return { ...base, listViewKey }
    const merged = mergeRuntimeListConfig(base, runtime)
    const extraFilters = runtimeListFiltersFromFields(runtime)
    const filters = [...(base.filters ?? []), ...extraFilters]
    return {
      ...merged,
      filters: filters.length > 0 ? filters : undefined,
      listViewKey,
    }
  }, [base, runtime, isLoading, listViewKey])
}
