"use client";

import { useState } from "react";
import { useTranslation } from "@lumiere/i18n";
import { Button } from "@lumiere/ui/components/button";
import type { useFleetActions } from "./fleet-actions";

export function FleetRecoveryNotice({
  actions,
}: {
  actions: ReturnType<typeof useFleetActions>;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const attempt = actions.recovery;
  if (!attempt && !actions.recoveryError) return null;
  return (
    <div
      role="status"
      className="space-y-3 rounded-md border p-4"
      data-testid="fleet-save-recovery"
    >
      <p className="text-sm font-medium">
        {attempt
          ? t("fleet.workspace.savedRequest", {
              defaultValue: "A fleet save is waiting for confirmation.",
            })
          : actions.recoveryError}
      </p>
      {attempt ? (
        <p className="text-sm text-muted-foreground">
          {t("fleet.workspace.retryOriginal", {
            defaultValue:
              "Retry uses the original values and request identity, including after a reload.",
          })}
        </p>
      ) : null}
      {attempt && actions.canRecover ? (
        <Button
          variant="outline"
          disabled={actions.isPending}
          onClick={async () => {
            setError(null);
            try {
              await actions.submit(attempt.action, attempt.values);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          {t("fleet.workspace.retrySavedRequest", {
            defaultValue: "Retry saved request",
          })}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
