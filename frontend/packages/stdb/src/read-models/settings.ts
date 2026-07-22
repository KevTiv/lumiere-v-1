/** Loose row shape for organization / settings records. */
export type SettingsQueryRow = Record<string, unknown>;

/** Primary label for organization rows in settings UI. */
export function organizationPrimaryLabel(row: SettingsQueryRow): string {
  return primaryLabel([row.name, row.organizationName, row.displayName], row.id);
}
import { primaryLabel } from "./primary-label";
