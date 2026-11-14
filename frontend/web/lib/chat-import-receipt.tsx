"use client"

import { useQueries, useQuery } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { ImportTaskStatusCard } from "@lumiere/ui/ai-chat/import-task-status-card"
import { Button } from "@lumiere/ui/components/button"
import { CurrencyFormatProvider } from "@lumiere/ui"
import type { ChatImportScope } from "./chat-import-task"
import { apiFetch } from "./api-fetch"
import {
  readChatImportPostingStatus,
  readChatImportTaskStatus,
} from "./import-task-status"
import type { ImportTaskView } from "./import-task-navigation"

export function chatImportReceiptKey(scope: ChatImportScope, taskId?: string) {
  const scopeKey = [
    "assistant-import-receipt",
    scope.identity,
    scope.organizationId,
    scope.companyId,
    scope.conversationKey,
  ]
  return taskId ? [...scopeKey, taskId] : scopeKey
}

export function ChatImportReceipt({
  scope,
  taskId,
  onOpen,
}: {
  scope: ChatImportScope
  taskId: string
  onOpen?: (view: ImportTaskView) => void
}) {
  const { t } = useTranslation()
  const currencies = useCurrencies()
  const queryKey = chatImportReceiptKey(scope, taskId)
  const receipt = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      readChatImportTaskStatus(apiFetch, scope, taskId, signal),
    retry: false,
    refetchInterval: 4 * 60_000,
  })
  const status = receipt.isError ? undefined : receipt.data
  const proposals = (status?.proposals ?? []).filter(
    (proposal) => proposal.verifiedResult && proposal.expectedRecords > 0,
  )
  const posting = useQueries({
    queries: proposals.map((proposal) => ({
      queryKey: [...queryKey, "posting", proposal.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readChatImportPostingStatus(
          apiFetch,
          {
            taskId,
            companyId: String(scope.companyId),
            organizationId: String(scope.organizationId),
          },
          proposal,
          signal,
        ),
      retry: false,
      refetchInterval: 4 * 60_000,
    })),
  })
  const refresh = () => {
    void receipt.refetch()
    for (const result of posting) void result.refetch()
  }
  if (receipt.isError)
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <p role="status">
          {t("aiChat.import.receiptUnavailable", {
            defaultValue: "Saved import is unavailable.",
          })}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={receipt.isFetching}
          onClick={refresh}
        >
          {t("common.retry", { defaultValue: "Retry" })}
        </Button>
      </div>
    )
  if (!status)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("aiChat.import.checkingOutcome", {
          defaultValue: "Checking saved import…",
        })}
      </p>
    )
  return (
    <CurrencyFormatProvider currencies={currencies.data}>
      <ImportTaskStatusCard
        status={status}
        companyId={scope.companyId}
        checking={
          receipt.isFetching || posting.some((result) => result.isFetching)
        }
        postingStatuses={posting.flatMap((result) =>
          !result.isFetching && !result.isError && result.data
            ? [result.data]
            : [],
        )}
        onOpen={onOpen}
        onRefresh={refresh}
      />
    </CurrencyFormatProvider>
  )
}
