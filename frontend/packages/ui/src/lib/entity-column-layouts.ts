import type { EntityColumnLayout } from "./entity-view-types"

/** Readable starting allocations for common business fields. Override for actual record content. */
export const entityColumnLayouts = {
  identity: { min: 12, preferred: 17, max: 32, grow: 3, wrap: 2 },
  description: { min: 14, preferred: 20, max: 36, grow: 3, wrap: 2 },
  reference: { min: 7, preferred: 10, max: 14, grow: 1, wrap: 1 },
  location: { min: 10, preferred: 14, max: 22, grow: 2, wrap: 2 },
  status: { min: 6.5, preferred: 8, max: 10, wrap: "wrap" },
  date: { min: 7.5, preferred: 9, max: 11, wrap: "wrap" },
  amount: { min: 9, preferred: 11, max: 14, wrap: "wrap" },
  quantity: { min: 6, preferred: 8, max: 10, wrap: "wrap" },
  unit: { min: 4.5, preferred: 6, max: 8, wrap: "wrap" },
  flag: { min: 4.75, preferred: 5.5, max: 6.5, wrap: "wrap" },
} as const satisfies Record<string, EntityColumnLayout>
