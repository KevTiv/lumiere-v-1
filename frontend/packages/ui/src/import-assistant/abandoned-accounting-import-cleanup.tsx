"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "@lumiere/i18n";
import {
  canCleanupAbandonedAccountMoveImport,
  type ImportJobRow,
} from "@lumiere/query-hooks/hooks/import-jobs";
import { Loader2, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/alert-dialog";
import { Badge } from "../components/badge";
import { Button } from "../components/button";

export type AbandonedAccountingImportCleanupProps = {
  jobs: ImportJobRow[];
  /** Active company used by the eventual scoped cleanup mutation. */
  companyId: bigint | number | string;
  /** Set only after the caller confirms the user has account_move:delete permission. */
  authorized: boolean;
  pendingJobId?: string | null;
  /**
   * Call cleanup_abandoned_account_move_import with the supplied parentJobId and the active
   * companyId. The authenticated operation transport injects organizationId.
   */
  onCleanup: (parentJobId: number) => void | Promise<void>;
};

function jobId(job: ImportJobRow): number | null {
  const value = Number(job.id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function AbandonedAccountingImportCleanup({
  jobs,
  companyId,
  authorized,
  pendingJobId = null,
  onCleanup,
}: AbandonedAccountingImportCleanupProps) {
  const { t } = useTranslation();
  const [confirmingJob, setConfirmingJob] = useState<ImportJobRow | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(
    () =>
      jobs.filter((job) =>
        canCleanupAbandonedAccountMoveImport(job, jobs, companyId),
      ),
    [companyId, jobs],
  );

  if (!authorized || candidates.length === 0) return null;

  const confirmingId = jobId(confirmingJob ?? {});
  const isConfirmingPending =
    confirmingId != null &&
    (pendingJobId === String(confirmingId) ||
      activeJobId === String(confirmingId));

  const runCleanup = async () => {
    if (confirmingId == null) return;
    setError(null);
    setActiveJobId(String(confirmingId));
    try {
      await onCleanup(confirmingId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActiveJobId(null);
      setConfirmingJob(null);
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {t("common.importAssistant.abandonedDraftsTitle", {
            defaultValue: "Abandoned journal import drafts",
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("common.importAssistant.abandonedDraftsDescription", {
            defaultValue:
              "These imports created journal entry headers but did not complete their line phase. Cleanup removes only unchanged, empty drafts; the server refuses entries with lines or accounting activity.",
          })}
        </p>
      </div>

      <ul className="space-y-2">
        {candidates.map((job) => {
          const id = jobId(job);
          if (id == null) return null;
          const isPending =
            pendingJobId === String(id) || activeJobId === String(id);
          return (
            <li
              key={id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  #{id}
                </span>
                <Badge variant="outline">
                  {t("common.importAssistant.parentPhaseOnly", {
                    defaultValue: "Parent phase only",
                  })}
                </Badge>
                {(job.fileName ?? job.file_name) ? (
                  <span className="text-muted-foreground">
                    {job.fileName ?? job.file_name}
                  </span>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  setConfirmingJob(job);
                }}
              >
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                {t("common.importAssistant.cleanupEmptyDrafts", {
                  defaultValue: "Clean up empty drafts",
                })}
              </Button>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("common.importAssistant.cleanupRefused", {
            defaultValue: "Cleanup was refused: {{message}}",
            message: error,
          })}
        </p>
      ) : null}

      <AlertDialog
        open={confirmingJob != null}
        onOpenChange={(open) => {
          if (!open && !isConfirmingPending) setConfirmingJob(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("common.importAssistant.cleanupConfirmTitle", {
                defaultValue: "Clean up empty imported drafts?",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("common.importAssistant.cleanupConfirmDescription", {
                defaultValue:
                  "Import job #{{jobId}} will be checked again before cleanup. Only its original empty draft journal entries can be removed. Any changed, posted, secured, paid, or non-empty entry stops the entire cleanup.",
                jobId: confirmingId ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isConfirmingPending}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isConfirmingPending}
              onClick={() => void runCleanup()}
            >
              {isConfirmingPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("common.importAssistant.cleanupConfirmAction", {
                defaultValue: "Clean up drafts",
              })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
