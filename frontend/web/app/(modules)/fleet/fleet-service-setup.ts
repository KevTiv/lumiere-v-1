import { moduleTabHref } from "@lumiere/erp-shared/record-links";
import { parseStrictU64 } from "@lumiere/erp-shared/u64";
import type { EntityRow } from "@lumiere/ui/lib/entity-view-types";
import { fleetEnumTag } from "./fleet-record";
import { fleetCompanyRows } from "./fleet-workspace";

export const fleetServiceSetupKeys = [
  "serviceType",
  "journal",
  "expenseAccount",
  "offsetAccount",
] as const;

export type FleetServiceSetupKey = (typeof fleetServiceSetupKeys)[number];

type SetupRows = {
  serviceTypes: readonly EntityRow[];
  journals: readonly EntityRow[];
  accounts: readonly EntityRow[];
};

function validId(value: unknown) {
  return (parseStrictU64(value) ?? 0n) > 0n;
}

export function fleetServiceChoices(
  rows: SetupRows,
  organizationId: bigint,
  companyId: bigint | undefined,
): Record<FleetServiceSetupKey, EntityRow[]> {
  const scoped = (input: readonly EntityRow[], organizationWide = false) =>
    fleetCompanyRows(input, organizationId, companyId, organizationWide).filter((row) =>
      validId(row.id),
    );
  const accounts = scoped(rows.accounts).filter(
    (row) => row.deprecated === false,
  );
  const group = (row: EntityRow) =>
    fleetEnumTag(row.internal_group ?? row.internalGroup).toLowerCase();

  return {
    serviceType: scoped(rows.serviceTypes, true).filter(
      (row) => (row.is_active ?? row.isActive) === true,
    ),
    journal: scoped(rows.journals).filter(
      (row) =>
        row.active === true &&
        fleetEnumTag(row.type ?? row.type_).toLowerCase() === "general",
    ),
    expenseAccount: accounts.filter((row) => group(row) === "expense"),
    offsetAccount: accounts.filter((row) => ["asset", "liability"].includes(group(row))),
  };
}

export function missingFleetServiceSetup(
  choices: ReturnType<typeof fleetServiceChoices>,
): FleetServiceSetupKey[] {
  return fleetServiceSetupKeys.filter((key) => choices[key].length === 0);
}

const formField = {
  serviceType: "service_type_id",
  journal: "journal_id",
  expenseAccount: "expense_account_id",
  offsetAccount: "offset_account_id",
} as const;

export function canRecordFleetServiceWith(
  choices: ReturnType<typeof fleetServiceChoices>,
  values: Record<string, unknown>,
): boolean {
  return fleetServiceSetupKeys.every((key) => {
    const id = parseStrictU64(values[formField[key]]);
    return id != null && choices[key].some((row) => parseStrictU64(row.id) === id);
  });
}

export function fleetAccountingSetupHref(
  key: FleetServiceSetupKey,
  allowed: (resource: "account_journal" | "account_account", action: "read" | "create" | "write") => boolean,
): string | undefined {
  if (key === "serviceType") return undefined;
  const journal = key === "journal";
  const resource = journal ? "account_journal" : "account_account";
  if (!allowed(resource, "read") ||
      !(allowed(resource, "create") || allowed(resource, "write"))) return undefined;
  return moduleTabHref("accounting", journal ? "account-journals" : "accounts");
}
