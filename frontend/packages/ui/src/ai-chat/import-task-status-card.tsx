"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  importTaskStatusIsCurrent,
  IMPORT_TASK_STATUS_MAX_AGE_MS,
  type ChatImportTaskStatus,
} from "../lib/import-task-status"

export function ImportTaskStatusCard({
  status,
  companyId,
}: {
  status: ChatImportTaskStatus
  companyId?: number
}) {
  const { t } = useTranslation()
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
  const href = `/settings?section=imports&importTask=${status.taskId}&importCompany=${status.companyId}&importView=results#import-task`
  const nativeResults = status.nativeResults ?? []
  const shownNativeResults = nativeResults.slice(0, 3)
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
  return (
    <section
      className="w-full min-w-0 space-y-2 rounded-lg border bg-muted/20 p-3 text-sm"
      aria-label={t("settings.importTask.cardTitle", {
        defaultValue: "Saved import status",
      })}
    >
      <h3 className="font-medium">{stateLabels[status.preparationStatus]}</h3>
      <p>
        {t("settings.importTask.cardSourceCounts", {
          defaultValue:
            "{{ready}} confirmed source rows · {{held}} need a decision · {{excluded}} excluded",
          ...status.sourceRows,
        })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("settings.importTask.cardReceiptBoundary", {
          defaultValue:
            "Source confirmation does not create ERP records. Accounting draft readback and native job receipts are shown separately.",
        })}
      </p>
      {!!status.proposals.length && (
        <h4 className="font-medium">
          {t("settings.importTask.cardAccountingTitle", {
            defaultValue: "Accounting drafts",
          })}
        </h4>
      )}
      {status.proposals.map((proposal) => (
        <div key={proposal.id} className="rounded-md border bg-background p-2">
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
              <p className="text-xs text-muted-foreground">
                {t("settings.importTask.cardUnposted", {
                  defaultValue:
                    "Created as unposted drafts. Open Accounting to check their current posting state.",
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.importTask.cardVerifiedAt", {
                  defaultValue: "ERP readback {{timestamp}}",
                  timestamp: new Date(
                    proposal.verifiedResult.verifiedAt,
                  ).toLocaleString(),
                })}
              </p>
            </>
          ) : proposal.status === "rolled_back" ? (
            <p>
              {t("settings.importTask.cardRolledBack", { id: proposal.id })}
            </p>
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
      {!status.proposalCount ? (
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
            <div
              key={result.requestId}
              className="space-y-1 rounded-md border bg-background p-2"
            >
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
      <a
        href={href}
        className="inline-flex min-h-8 items-center font-medium underline underline-offset-4"
      >
        {t("settings.importTask.openTask", { defaultValue: "Open saved task" })}
      </a>
    </section>
  )
}
