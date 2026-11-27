import type { ImportPreparationSection } from "./import-preparation"
import { preparationTargetFields } from "./import-preparation-editor"

type ImportGoal = ImportPreparationSection["targetEntity"]

/** A module may suggest a preparation destination. The operator still chooses and saves source rules. */
export function readSavedImportGoal(search: string): ImportGoal | undefined {
  const values = new URLSearchParams(search).getAll("importGoal")
  const value = values.length === 1 ? values[0] : undefined
  return value && Object.hasOwn(preparationTargetFields, value) ? value as ImportGoal : undefined
}

export function savedImportIntakeHref(goal?: ImportGoal): string {
  const params = new URLSearchParams({ section: "imports" })
  if (goal && Object.hasOwn(preparationTargetFields, goal)) params.set("importGoal", goal)
  return "/settings?" + params.toString() + "#start-import"
}
