"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../http"
import { csvImportInvalidatesQuery, fetchCsvImportReceipt, type CsvImportReceipt, type CsvImportRequest } from "./csv-import-request"

export function useTrackedCsvImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (request: CsvImportRequest) => fetchCsvImportReceipt(request, apiFetch),
    retry: false,
    onSuccess: (receipt, request) => {
      qc.setQueryData(["csv-import-request", request.organizationId, request.entity, request.requestId, request.companyId, request.currencyId], receipt)
      void qc.invalidateQueries({ predicate: (query) => csvImportInvalidatesQuery(query.queryKey, request) })
    },
  })
}
export function useCsvImportReceipt(request: CsvImportRequest, enabled = true) {
  const qc = useQueryClient()
  return useQuery<CsvImportReceipt>({
    queryKey: ["csv-import-request", request.organizationId, request.entity, request.requestId, request.companyId, request.currencyId],
    queryFn: async () => {
      const receipt = await fetchCsvImportReceipt(request, apiFetch, true)
      void qc.invalidateQueries({ predicate: (query) => csvImportInvalidatesQuery(query.queryKey, request) })
      return receipt
    },
    enabled,
    retry: false,
    // Unknown requests need an explicit safe retry; terminal receipts stop polling.
    refetchInterval: (query) => query.state.data?.status === "pending" ? 2000 : false,
  })
}
