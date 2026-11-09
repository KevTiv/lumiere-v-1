"use client";

import { useTranslation } from "@lumiere/i18n";
import { Button } from "@lumiere/ui/components/button";
import type { ImportTaskView } from "./import-task-navigation";
import type { ImportCapability, ImportWorkflow } from "./import-workflow";

export function ImportDestinationSupport({
  capabilities,
  failed,
  onRetry,
}: {
  capabilities?: ImportCapability[];
  failed: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const supported = capabilities?.filter(
    (item) => item.readiness !== "evidence_only",
  );
  const evidenceOnly = capabilities?.filter(
    (item) => item.readiness === "evidence_only",
  );

  return (
    <section
      aria-label={t("settings.importWorkflow.destinationSupport", {
        defaultValue: "Import destination support",
      })}
      className="space-y-2 rounded-lg border p-3 text-sm"
    >
      <h3 className="font-semibold">
        {t("settings.importWorkflow.destinationSupport", {
          defaultValue: "Import destination support",
        })}
      </h3>
      {failed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status">
            {t("settings.importWorkflow.destinationUnavailable", {
              defaultValue: "Destination support could not be loaded.",
            })}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            {t("common.retry", { defaultValue: "Try again" })}
          </Button>
        </div>
      ) : !capabilities ? (
        <p role="status" className="text-muted-foreground">
          {t("settings.importWorkflow.destinationLoading", {
            defaultValue: "Checking supported destinations…",
          })}
        </p>
      ) : (
        <>
          <ul className="divide-y">
            {supported?.map((item) => (
              <li
                key={item.key}
                className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3"
              >
                <div>
                  <p className="font-medium">{item.label}</p>
                  <p className="text-muted-foreground">
                    {item.readiness === "task_execution"
                      ? t("settings.importWorkflow.destinationDrafts", {
                          defaultValue: "Draft creation with approval",
                        })
                      : t("settings.importWorkflow.destinationNative", {
                          defaultValue: "Native preview available",
                        })}
                  </p>
                </div>
                {item.requiredFacts.length > 0 && (
                  <p className="text-muted-foreground">
                    {t("settings.importWorkflow.destinationFacts", {
                      defaultValue: "Required facts · {{facts}}",
                      facts: item.requiredFacts.join(", "),
                    })}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {evidenceOnly && evidenceOnly.length > 0 && (
            <details className="border-t pt-2">
              <summary className="cursor-pointer font-medium">
                {t("settings.importWorkflow.destinationEvidence", {
                  defaultValue: "Evidence-only destinations",
                })}
              </summary>
              <dl className="mt-2 divide-y">
                {evidenceOnly.map((item) => (
                  <div
                    key={item.key}
                    className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3"
                  >
                    <dt className="font-medium">{item.label}</dt>
                    <dd className="text-muted-foreground">
                      {item.blockingReason}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export function ImportTaskProgress({
  files,
  rows,
  workflow,
  resultsAvailable,
  onNavigate,
}: {
  files: number;
  rows: { total: number; confirmed: number; pending: number; excluded: number };
  workflow?: ImportWorkflow;
  resultsAvailable: boolean;
  onNavigate: (view: ImportTaskView) => void;
}) {
  const { t } = useTranslation();
  const verifiedDrafts = new Set(
    workflow?.proposals.flatMap((proposal) => proposal.result?.recordIds ?? []),
  ).size;
  const nativeReceipts =
    workflow?.nativeResults.filter((result) => result.receipt !== null)
      .length ?? 0;
  const hasProposalExceptions = workflow?.proposals.some(
    (proposal) => proposal.summary.blockedCount > 0,
  );
  const stages: {
    label: string;
    description: string;
    view: ImportTaskView;
    action: string;
    heldAction?: boolean;
  }[] = [
    {
      label: t("settings.importTask.progressSources", {
        defaultValue: "Source files",
      }),
      description: t("settings.importTask.progressSourceCounts", {
        defaultValue: "{{files}} saved files · {{rows}} rows in review",
        files,
        rows: rows.total,
      }),
      view: "sources",
      action: t("settings.importTask.progressOpenSources", {
        defaultValue: "Inspect files",
      }),
    },
    {
      label: t("settings.importTask.progressConfirmed", {
        defaultValue: "Confirmed facts",
      }),
      description: t("settings.importTask.progressConfirmedCount", {
        defaultValue: "{{count}} confirmed review rows",
        count: rows.confirmed,
      }),
      view: "decisions",
      action: t("settings.importTask.progressOpenDecisions", {
        defaultValue: "Review decisions",
      }),
    },
    {
      label: t("settings.importTask.progressRecords", {
        defaultValue: "ERP records",
      }),
      description: workflow
        ? t("settings.importTask.progressRecordCounts", {
            defaultValue:
              "{{drafts}} verified drafts shown · {{receipts}} native job receipts",
            drafts: verifiedDrafts,
            receipts: nativeReceipts,
          })
        : resultsAvailable
          ? t("settings.importTask.progressResultsPending", {
              defaultValue: "Check ERP results for record counts",
            })
          : t("settings.importTask.progressPreparationRequired", {
              defaultValue: "Available after preparation approval",
            }),
      view: resultsAvailable ? "results" : "sources",
      action: resultsAvailable
        ? t("settings.importTask.progressOpenResults", {
            defaultValue: "Open ERP results",
          })
        : t("settings.importTask.progressOpenPreparation", {
            defaultValue: "Review preparation",
          }),
    },
    {
      label: t("settings.importTask.progressExceptions", {
        defaultValue: "Source exceptions",
      }),
      description: t("settings.importTask.progressExceptionCounts", {
        defaultValue: "{{pending}} need decisions · {{excluded}} excluded",
        pending: rows.pending,
        excluded: rows.excluded,
      }),
      view: "decisions",
      action: t("settings.importTask.progressOpenExceptions", {
        defaultValue: "Review source exceptions",
      }),
      heldAction: hasProposalExceptions && resultsAvailable,
    },
  ];

  return (
    <ol
      aria-label={t("settings.importTask.progressLabel", {
        defaultValue: "Progress from source to ERP",
      })}
      className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2 lg:grid-cols-4"
    >
      {stages.map(({ label, description, view, action, heldAction }) => (
        <li key={label} className="min-w-0">
          <p className="font-medium">{label}</p>
          <p className="text-muted-foreground tabular-nums">{description}</p>
          <button
            type="button"
            className="min-h-8 text-left text-primary underline underline-offset-4"
            onClick={() => onNavigate(view)}
          >
            {action}
          </button>
          {heldAction && (
            <button
              type="button"
              className="block min-h-8 text-left text-primary underline underline-offset-4"
              onClick={() => onNavigate("results")}
            >
              {t("settings.importTask.progressOpenHeld", {
                defaultValue: "Inspect rows held in ERP previews",
              })}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
