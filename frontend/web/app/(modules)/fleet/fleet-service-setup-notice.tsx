"use client";

import { useTranslation } from "@lumiere/i18n";
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice";
import { mergeModuleStates } from "@lumiere/ui/lib/module-data-state";
import type { useFleetWorkspace } from "./use-fleet-workspace";

export function FleetServiceSetupNotice({
  workspace,
}: {
  workspace: ReturnType<typeof useFleetWorkspace>;
}) {
  const { t } = useTranslation();
  const state = mergeModuleStates([
    workspace.states.serviceTypes,
    workspace.states.journals,
    workspace.states.accounts,
  ]);
  if (state.status !== "ready")
    return state.status === "loading" ? (
      <p role="status" className="text-sm text-muted-foreground">
        {t("fleet.workspace.loadingSetup", {
          defaultValue: "Loading service and accounting choices…",
        })}
      </p>
    ) : (
      <ModuleDataNotice state={state} />
    );
  if (
    workspace.activeServiceTypes.length > 0 &&
    workspace.journals.length > 0 &&
    workspace.accounts.length >= 2
  )
    return null;
  return (
    <div
      role="status"
      className="space-y-2 rounded-md border p-4"
      data-testid="fleet-service-setup"
    >
      <p className="text-sm font-medium">
        {t("fleet.workspace.setupTitle", {
          defaultValue: "Set up service cost recording",
        })}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("fleet.workspace.setupHint", {
          defaultValue:
            "An administrator must configure an active service type, a company journal, and expense and offset accounts before you can record a garage intervention and its cost.",
        })}
      </p>
    </div>
  );
}
