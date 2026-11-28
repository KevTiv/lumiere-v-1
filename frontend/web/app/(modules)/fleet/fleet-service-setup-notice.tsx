"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useTranslation } from "@lumiere/i18n";
import { useCreateCompanyFleetServiceType } from "@lumiere/query-hooks/hooks/fleet";
import { Button, buttonVariants } from "@lumiere/ui/components/button";
import { Input } from "@lumiere/ui/components/input";
import { useRBAC } from "@lumiere/ui/lib/rbac-context";
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice";
import { mergeModuleStates } from "@lumiere/ui/lib/module-data-state";
import { fleetAccountingSetupHref } from "./fleet-service-setup";
import type { useFleetWorkspace } from "./use-fleet-workspace";

export function FleetServiceSetupNotice({
  workspace,
}: {
  workspace: ReturnType<typeof useFleetWorkspace>;
}) {
  const { t } = useTranslation();
  const { checkPermission, permissionsReady } = useRBAC();
  const { company, orgId, missingServiceSetup, refreshServiceSetup } = workspace;
  const creation = useCreateCompanyFleetServiceType(orgId, company);
  const inputId = useId();
  const [name, setName] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const state = mergeModuleStates([
    workspace.states.serviceTypes,
    workspace.states.journals,
    workspace.states.accounts,
  ]);
  const canCreateType =
    company != null &&
    permissionsReady !== false &&
    checkPermission("fleet_vehicle_service_type", "create").allowed;
  const canOpenAccounting = permissionsReady !== false;
  const setupLinks = missingServiceSetup.map((key) => ({
    key,
    href: canOpenAccounting
      ? fleetAccountingSetupHref(
          key,
          (resource, action) => checkPermission(resource, action).allowed,
        )
      : undefined,
  }));
  const canRefreshOnReturn = setupLinks.some(({ href }) => href);

  useEffect(() => {
    if (!canRefreshOnReturn) return;
    const refresh = () => {
      void refreshServiceSetup();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [canRefreshOnReturn, refreshServiceSetup]);

  const lookupNotice =
    state.status === "loading" ? (
      <p role="status" className="text-muted-foreground">
        {t("fleet.workspace.loadingSetup")}
      </p>
    ) : (
      <ModuleDataNotice state={state} />
    );
  if (missingServiceSetup.length === 0) return lookupNotice;

  return (
    <section
      aria-label={t("fleet.workspace.setupTitle")}
      className="space-y-3 rounded-md border p-4 text-sm"
      data-testid="fleet-service-setup"
    >
      <p className="font-medium">{t("fleet.workspace.setupTitle")}</p>
      {lookupNotice}
      <ul className="space-y-3">
        {setupLinks.map(({ key, href }) => (
          <li key={key} className="space-y-2">
            <p>{t(`fleet.workspace.recovery.${key}`)}</p>
            {key === "serviceType" && canCreateType ? (
              <div className="space-y-2">
                <label htmlFor={inputId}>{t("fleet.workspace.recovery.typeName")}</label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id={inputId}
                    className="max-w-60"
                    value={name}
                    disabled={creation.isPending}
                    onChange={(event) => {
                      setName(event.target.value);
                      creation.reset();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.preventDefault();
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!name.trim() || creation.isPending}
                    onClick={() => creation.mutate(name, { onSuccess: () => setName("") })}
                  >
                    {t("fleet.workspace.recovery.createType")}
                  </Button>
                </div>
                {creation.isError ? (
                  <p role="alert">{t("fleet.workspace.recovery.createTypeFailed")}</p>
                ) : null}
              </div>
            ) : href ? (
              <Link
                href={href}
                target="_blank"
                rel="noopener"
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                {t(
                  key === "journal"
                    ? "fleet.workspace.recovery.openJournals"
                    : "fleet.workspace.recovery.openAccounts",
                )}
              </Link>
            ) : (
              <p className="text-muted-foreground">{t("fleet.workspace.recovery.askAdmin")}</p>
            )}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={refreshing}
        onClick={async () => {
          setRefreshing(true);
          try {
            await refreshServiceSetup();
          } finally {
            setRefreshing(false);
          }
        }}
      >
        {t("fleet.workspace.recovery.refresh")}
      </Button>
    </section>
  );
}
