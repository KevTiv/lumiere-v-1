"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { accountMoveBatchHref } from "@lumiere/erp-shared/record-links"
import { Button, buttonVariants } from "../components/button"
import { useCurrencyFormat } from "../lib/currency-context"
import { AssistantActionCard } from "./assistant-action-card"
import {
  importTaskStatusIsCurrent,
  IMPORT_TASK_STATUS_MAX_AGE_MS,
  type ChatImportPostingStatus,
  type ChatImportTaskStatus,
} from "../lib/import-task-status"

function formatAmount(amount: string, locale?: string) {
  const [integer, decimals] = amount.split(".")
  const formatted = Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(BigInt(integer!))
  const separator =
    Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value ?? "."
  return formatted + (decimals ? separator + decimals : "")
}

export function ImportTaskStatusCard({
  status,
  companyId,
  postingStatuses = [],
  checking = false,
  onOpen,
  onRefresh,
}: {
  status: ChatImportTaskStatus
  companyId?: number
  postingStatuses?: ChatImportPostingStatus[]
  checking?: boolean
  onOpen?: (view: "sources" | "decisions" | "preview" | "results") => void
  onRefresh?: () => void
}) {
  const { t } = useTranslation()
  const { codeFor, locale } = useCurrencyFormat()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const expiresIn =
      Date.parse(status.readAt) + IMPORT_TASK_STATUS_MAX_AGE_MS - Date.now()
    if (expiresIn <= 0 || !Number.isFinite(expiresIn)) return
    const timer = setTimeout(() => setNow(Date.now()), expiresIn + 1)
    return () => clearTimeout(timer)
  }, [status.readAt])
  if (!importTaskStatusIsCurrent(status, companyId, now)) return null
  const nativeResults = status.nativeResults ?? []
  const shownNativeResults = nativeResults.slice(0, 3)
  const verifiedProposals = status.proposals.filter(
    (proposal) => proposal.verifiedResult,
  )
  const proposalSummary =
    verifiedProposals.length === 1 ? verifiedProposals[0] : undefined
  const result = proposalSummary?.verifiedResult
  const recordIds = [
    ...new Set(
      verifiedProposals.flatMap(
        (proposal) =>
          proposal.verifiedResult?.records?.map((record) => record.id) ?? [],
      ),
    ),
  ]
  const hasBatchLink = recordIds.length > 0 && recordIds.length <= 200
  const hasResults = status.proposals.length > 0 || nativeResults.length > 0
  const view = hasResults
    ? "results"
    : status.preparationStatus === "needs_review"
      ? "decisions"
      : "sources"
  const href = `/settings?section=imports&importTask=${status.taskId}&importCompany=${status.companyId}&importView=${view}#import-task`
  const taskActionLabel =
    hasResults || status.preparationStatus !== "needs_review"
      ? t("settings.importTask.openTask", { defaultValue: "Open saved task" })
      : t("settings.importTask.openSourceReview", {
          defaultValue: "Review source rows",
        })
  const taskAction = onOpen ? (
    <Button
      size="sm"
      variant="outline"
      type="button"
      onClick={() => onOpen(view)}
    >
      {taskActionLabel}
    </Button>
  ) : (
    <a
      href={href}
      className={buttonVariants({ size: "sm", variant: "outline" })}
    >
      {taskActionLabel}
    </a>
  )
  const current = postingStatuses.find(
    (posting) => posting.proposalId === proposalSummary?.id,
  )
  const blocked = status.proposals.some((item) => item.status === "blocked")
  const partial =
    verifiedProposals.length > 0 &&
    (status.sourceRows.held > 0 ||
      status.sourceRows.excluded > 0 ||
      Boolean(proposalSummary?.heldRecords))
  const allPosted = Boolean(
    current &&
    current.postedCount === current.recordCount &&
    current.recordCount,
  )
  const currency = result && codeFor(result.currencyId)
  const nativeEntities = {
    product: t("settings.importTask.nativeEntity.product", {
      defaultValue: "Products",
    }),
    contact: t("settings.importTask.nativeEntity.contact", {
      defaultValue: "Contacts",
    }),
    stock_location: t("settings.importTask.nativeEntity.stock_location", {
      defaultValue: "Locations",
    }),
  }
  const nativeStates = {
    pending: t("settings.importTask.nativeJobStatus.pending", {
      defaultValue: "Pending",
    }),
    success: t("settings.importTask.nativeJobStatus.success", {
      defaultValue: "Success",
    }),
    partial: t("settings.importTask.nativeJobStatus.partial", {
      defaultValue: "Partial",
    }),
    failed: t("settings.importTask.nativeJobStatus.failed", {
      defaultValue: "Failed",
    }),
    rolled_back: t("settings.importTask.nativeJobStatus.rolled_back", {
      defaultValue: "Rolled back",
    }),
  }
  const stateLabels = {
    awaiting_decision: t("settings.importTask.cardAwaiting", {
      defaultValue: "Files saved · choose how to use them",
    }),
    saved: t("settings.importTask.cardSaved", {
      defaultValue: "Files saved · preparation can resume",
    }),
    needs_review: t("settings.importTask.cardReview", {
      defaultValue: "Source review prepared",
    }),
    inspection_ready: t("settings.importTask.cardInspection", {
      defaultValue: "Inspection ready",
    }),
    failed: t("settings.importTask.cardFailed", {
      defaultValue: "Preparation needs attention",
    }),
  }
  const nativeResult = nativeResults.length === 1 ? nativeResults[0] : undefined
  const nativeLabel = nativeResult?.receipt
    ? nativeStates[nativeResult.receipt.status]
    : t("settings.importTask.cardNativePending", {
        defaultValue: "Awaiting job receipt",
      })
  const title = result
    ? allPosted
      ? t("settings.importTask.cardPostedTitle", {
          defaultValue: "{{count}} journal entries posted",
          count: result.recordCount,
        })
      : t("settings.importTask.cardDraftTitle", {
          defaultValue: "{{count}} journal drafts saved",
          count: result.recordCount,
        })
    : verifiedProposals.length > 0
      ? t("settings.importTask.cardAccountingTitle", {
          defaultValue: "Accounting drafts",
        })
      : nativeResults.length === 1 && nativeResult
        ? t("settings.importTask.cardNativeResultTitle", {
            defaultValue: "{{entity}} import · {{state}}",
            entity: nativeEntities[nativeResult.entity],
            state: nativeLabel,
          })
        : nativeResults.length > 0
          ? t("settings.importTask.cardNativeTitle", {
              defaultValue: "Native import job receipts",
            })
          : stateLabels[status.preparationStatus]
  const summary =
    result && currency
      ? t("settings.importTask.cardDraftTotals", {
          defaultValue: "{{currency}} {{amount}} · {{lines}} balanced lines",
          currency,
          amount: formatAmount(result.totalDebit, locale),
          lines: result.lineCount,
        })
      : undefined
  const executing = status.proposals.some(
    (proposal) => proposal.status === "executing",
  )
  return (
    <AssistantActionCard
      title={title}
      busy={checking}
      ariaLabel={t("settings.importTask.cardTitle", {
        defaultValue: "Saved import status",
      })}
      description={
        status.fileNames?.length || summary ? (
          <div className="space-y-1">
            {status.fileNames?.length ? (
              <p>{status.fileNames.join(", ")}</p>
            ) : null}
            {summary ? <p className="tabular-nums">{summary}</p> : null}
          </div>
        ) : undefined
      }
      status={
        blocked || executing
          ? {
              label: blocked
                ? t("settings.importTask.cardNeedsOutcome", {
                    defaultValue: "Needs attention",
                  })
                : t("settings.importTask.cardExecutionStarted", {
                    defaultValue: "Execution started",
                  }),
              tone: "warning",
            }
          : partial
            ? {
                label: t("settings.importTask.cardPartiallySaved", {
                  defaultValue: "Partially saved",
                }),
                tone: "warning",
              }
            : undefined
      }
      primaryAction={
        hasBatchLink && companyId ? (
          <a
            href={accountMoveBatchHref(recordIds, companyId)}
            className={buttonVariants({ size: "sm" })}
          >
            {t("settings.importTask.cardOpenEntries", {
              defaultValue: "View journal entries",
            })}
          </a>
        ) : (
          taskAction
        )
      }
    >
      <p>
        {t("settings.importTask.cardSourceCounts", {
          defaultValue:
            "{{ready}} confirmed source rows · {{held}} need a decision · {{excluded}} excluded",
          ...status.sourceRows,
        })}
      </p>
      {!result ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.importTask.cardReceiptBoundary", {
            defaultValue:
              "Source confirmation does not create ERP records. Accounting draft readback and native job receipts are shown separately.",
          })}
        </p>
      ) : null}
      {status.proposals.map((proposal) => (
        <div key={proposal.id} className="space-y-1 border-t pt-2 text-sm">
          {proposal.verifiedResult ? (
            <>
              <p className="font-medium">
                {t("settings.importTask.cardVerified", {
                  defaultValue:
                    "{{records}} verified draft journal entries · {{lines}} lines",
                  records: proposal.verifiedResult.recordCount,
                  lines: proposal.verifiedResult.lineCount,
                })}
              </p>
              <p>
                {t("settings.importTask.cardTotals", {
                  defaultValue:
                    "Debit {{debit}} · credit {{credit}} · currency #{{currency}}",
                  debit: proposal.verifiedResult.totalDebit,
                  credit: proposal.verifiedResult.totalCredit,
                  currency: proposal.verifiedResult.currencyId,
                })}
              </p>
              {!postingStatuses.some(
                (posting) => posting.proposalId === proposal.id,
              ) ? (
                <p className="text-xs text-muted-foreground">
                  {t("settings.importTask.cardUnposted", {
                    defaultValue:
                      "Created as unposted drafts. Open Accounting to check their current posting state.",
                  })}
                </p>
              ) : null}
              {postingStatuses
                .filter((posting) => posting.proposalId === proposal.id)
                .map((posting) => (
                  <p
                    key={posting.proposalId}
                    className="text-sm text-muted-foreground"
                  >
                    {t("settings.importTask.cardCurrentPosting", {
                      defaultValue:
                        "Current state · {{postedCount}} posted · {{draftCount}} draft · {{otherCount}} other · {{unavailableCount}} unavailable",
                      ...posting,
                    })}
                  </p>
                ))}
              {proposal.verifiedResult.records?.length && companyId ? (
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    {t("settings.importTask.cardRecordLinks", {
                      defaultValue: "Journal entry references",
                    })}
                  </summary>
                  <ul className="space-y-1 py-2">
                    {proposal.verifiedResult.records.map((record) => (
                      <li key={record.id}>
                        <a
                          href={accountMoveBatchHref([record.id], companyId)}
                          className="text-primary underline underline-offset-4"
                        >
                          {record.reference}
                        </a>
                      </li>
                    ))}
                  </ul>
                  {!hasBatchLink ? (
                    <a
                      href={accountMoveBatchHref(
                        proposal.verifiedResult.records.map(
                          (record) => record.id,
                        ),
                        companyId,
                      )}
                      className="text-primary underline underline-offset-4"
                    >
                      {t("settings.importTask.cardOpenEntries", {
                        defaultValue: "View journal entries",
                      })}
                    </a>
                  ) : null}
                </details>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {t("settings.importTask.cardVerifiedAt", {
                  defaultValue: "ERP readback {{timestamp}}",
                  timestamp: new Date(
                    proposal.verifiedResult.verifiedAt,
                  ).toLocaleString(),
                })}
              </p>
            </>
          ) : (
            <p>
              {t("settings.importTask.cardPendingProposal", {
                defaultValue:
                  "Proposal #{{id}}: {{state}} · {{records}} expected entries · no verified result yet",
                id: proposal.id,
                state: t(
                  `settings.importTask.proposalState.${proposal.status}`,
                  { defaultValue: proposal.status },
                ),
                records: proposal.expectedRecords,
              })}
            </p>
          )}
        </div>
      ))}
      {!status.proposalCount && !nativeResults.length ? (
        <p>
          {t("settings.importTask.cardNoAccountingProposal", {
            defaultValue: "No saved Accounting draft proposal yet.",
          })}
        </p>
      ) : null}
      {status.proposalCount > status.proposals.length ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.importTask.cardMore", {
            defaultValue: "Open the task to review all {{count}} proposals.",
            count: status.proposalCount,
          })}
        </p>
      ) : null}
      {(nativeResults.length > 0 || status.nativeResultsMore) && (
        <section
          className="space-y-2"
          aria-label={t("settings.importTask.cardNativeTitle", {
            defaultValue: "Native import job receipts",
          })}
        >
          <h4 className="font-medium">
            {t("settings.importTask.cardNativeTitle", {
              defaultValue: "Native import job receipts",
            })}
          </h4>
          <p className="text-xs text-muted-foreground">
            {t("settings.importTask.cardNativeBoundary", {
              defaultValue:
                "These counts come from native import jobs. They do not verify the current product, contact or location records.",
            })}
          </p>
          {shownNativeResults.map((result) => (
            <div key={result.requestId} className="space-y-1 border-t pt-2">
              <p className="font-medium">{nativeEntities[result.entity]}</p>
              {result.receipt ? (
                <>
                  <p>
                    {t("settings.importTask.cardNativeJob", {
                      defaultValue: "Job #{{job}} · {{state}}",
                      job: result.receipt.jobId,
                      state: nativeStates[result.receipt.status],
                    })}
                  </p>
                  <p>
                    {t("settings.importTask.cardNativeCounts", {
                      defaultValue:
                        "Job reports {{imported}} of {{total}} rows imported · {{errors}} row errors",
                      imported: result.receipt.rowsImported,
                      total: result.receipt.totalRows,
                      errors: result.receipt.errorRows,
                    })}
                  </p>
                </>
              ) : (
                <p>
                  {t("settings.importTask.cardNativeAwaiting", {
                    defaultValue:
                      "Request saved; the native job receipt is not available yet.",
                  })}
                </p>
              )}
            </div>
          ))}
          {(nativeResults.length > shownNativeResults.length ||
            status.nativeResultsMore) && (
            <p className="text-xs text-muted-foreground">
              {t("settings.importTask.cardMoreNative", {
                defaultValue:
                  "Native requests shown: {{shown}}. Open task Results for more saved receipts and row errors.",
                shown: shownNativeResults.length,
              })}
            </p>
          )}
        </section>
      )}
      <p className="text-xs text-muted-foreground">
        {t("settings.importTask.cardChecked", {
          defaultValue: "Checked {{timestamp}}",
          timestamp: new Date(status.readAt).toLocaleString(),
        })}
      </p>
      {hasBatchLink || onRefresh ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasBatchLink ? taskAction : null}
          {onRefresh ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={checking}
              onClick={onRefresh}
            >
              {checking
                ? t("aiChat.import.checkingOutcome", {
                    defaultValue: "Checking saved import…",
                  })
                : t("settings.importTask.cardCheck", {
                    defaultValue: "Check outcome",
                  })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </AssistantActionCard>
  )
}
