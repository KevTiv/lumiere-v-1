import { accountMoveHref, moduleTabHref } from "@lumiere/erp-shared/record-links"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"

interface CostIdentity { readonly organizationId?: bigint; readonly companyId?: bigint; readonly productionId?: bigint }

/** Immutable close snapshot has one exact scoped identity; duplicates are never hidden. */
export function manufacturingCostRecord<Row extends CostIdentity>(rows: readonly Row[], organizationId: bigint, companyId: bigint, productionId: bigint): Row | undefined {
  const matches = rows.filter(row => row.organizationId === organizationId && row.companyId === companyId && row.productionId === productionId)
  if (matches.length > 1) throw new Error("Multiple manufacturing cost snapshots for this order")
  return matches[0]
}

export function manufacturingCostAmount(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en", { maximumFractionDigits: 6 }) : "Unavailable"
}

export function manufacturingCostLinks(snapshot: { readonly outputMoveIds?: readonly bigint[]; readonly accountMoveId?: bigint }) {
  const outputs = (snapshot.outputMoveIds ?? []).flatMap(rawId => {
    const id = parseStrictU64(rawId)
    return id != null && id > 0n ? [{ id: String(id), href: moduleTabHref("inventory", "stock-moves", { id: String(id) }) }] : []
  })
  const accountMoveId = parseStrictU64(snapshot.accountMoveId)
  return { outputs, journal: accountMoveId != null && accountMoveId > 0n ? { id: String(accountMoveId), href: accountMoveHref(accountMoveId) } : undefined }
}
