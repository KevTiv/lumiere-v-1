"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64 } from "@lumiere/erp-shared/u64"


export function useHrIntegrationIntentsPending(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-integration-intents-pending', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/hr-integration-intents',
        'Failed to fetch HR integration intents',
      ),
    staleTime: 15_000,
    initialData,
  })
}

export function useCreateHrIntegrationIntent(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      intentKind: string
      idempotencyKey: string
      payload: string
      payslipId?: number
      exportIntentId?: number
      metadata?: string
    }
  >({
    mutationFn: async ({
      intentKind,
      idempotencyKey,
      payload,
      payslipId,
      exportIntentId,
      metadata,
    }) => {
      const { urlPath, init } = stdbBffCommandPost("create_hr_integration_intent", { params: stdbParamsToJson(
          {
            companyId,
            intentKind,
            idempotencyKey,
            payslipId: payslipId != null ? toScalarU64(payslipId) : undefined,
            exportIntentId:
              exportIntentId != null ? toScalarU64(exportIntentId) : undefined,
            payload,
            metadata,
          },
          'CreateHrIntegrationIntentParams',
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create HR integration intent')
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['hr-integration-intents-pending', rqBigIntKey(organizationId)],
      })
    },
  })
}

