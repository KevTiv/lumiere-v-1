/**
 * Build `<select>` options from `/api/query` rows for modular forms.
 */
export function accountJournalRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => {
    const id = row.id
    const code = String(row.code ?? "")
    const name = String(row.name ?? "")
    const label =
      code && name ? `${code} — ${name}` : name || code || (id != null ? String(id) : "?")
    return { value: String(id), label }
  })
}

/** CRM contacts — `Contact.id` is used as sale `partnerId` in this schema. */
export function contactRowsToPartnerSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  const customers = rows.filter((r) => r.isCustomer === true || r.isCustomer === 1)
  const list = customers.length > 0 ? customers : rows
  return list.map((row) => {
    const id = row.id
    const display = String(row.displayName ?? row.name ?? "")
    const email = row.email != null ? String(row.email) : ""
    const label = email ? `${display} (${email})` : display || String(id)
    return { value: String(id), label }
  })
}

export function pricelistRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows
    .filter((r) => r.isActive !== false && r.isActive !== 0)
    .map((row) => ({
      value: String(row.id),
      label: String(row.name ?? row.id),
    }))
}

export function warehouseRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows
    .filter((r) => r.active !== false && r.active !== 0)
    .map((row) => {
      const code = String(row.code ?? "")
      const name = String(row.name ?? "")
      const label = code && name ? `${code} — ${name}` : name || code || String(row.id)
      return { value: String(row.id), label }
    })
}

/** Purchasing — vendors from CRM contacts. */
export function contactRowsToVendorSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  const vendors = rows.filter(
    (r) =>
      r.isVendor === true ||
      r.isVendor === 1 ||
      (r.supplierRank != null && Number(r.supplierRank) > 0),
  )
  const list = vendors.length > 0 ? vendors : rows
  return list.map((row) => ({
    value: String(row.id),
    label: String(row.displayName ?? row.name ?? row.id),
  }))
}

export function productRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.displayName ?? row.name ?? row.defaultCode ?? row.code ?? row.id),
  }))
}

export function productCategoryRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.id),
  }))
}

export function uomRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows
    .filter((r) => r.isActive !== false && r.isActive !== 0)
    .map((row) => {
      const name = String(row.name ?? row.id)
      const sym = row.symbol != null ? String(row.symbol) : ""
      const label = sym ? `${name} (${sym})` : name
      return { value: String(row.id), label }
    })
}

export function pickingTypeOptionsFromTransfers(
  transfers: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  const map = new Map<string, string>()
  for (const tr of transfers) {
    const pid = tr.pickingTypeId
    if (pid != null && !map.has(String(pid))) {
      map.set(String(pid), `Type ${String(pid)}`)
    }
  }
  return [...map.entries()].map(([value, label]) => ({ value, label }))
}

export function saleOrderRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => {
    const id = row.id
    const ref = String(row.reference ?? row.clientOrderRef ?? row.origin ?? "").trim()
    const label = ref ? ref : `SO ${String(id ?? "")}`
    return { value: String(id), label }
  })
}

export function subscriptionPlanRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.code ?? row.id),
  }))
}

export function employeeRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.workEmail ?? row.workPhone ?? row.id),
  }))
}

export function departmentRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.code ?? row.id),
  }))
}

/** Distinct leave types seen on existing requests (no dedicated leave_type query yet). */
export function leaveTypeOptionsFromLeaveRequests(
  leaves: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>()
  for (const row of leaves) {
    const id = row.leaveTypeId
    if (id == null) continue
    const key = String(id)
    if (!seen.has(key)) seen.set(key, `Type ${key.slice(-8)}`)
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }))
}

export function projectRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.id),
  }))
}

/**
 * Distinct (projectId, stageId) pairs from existing tasks — value is `projectId:stageId`
 * so the UI can show project context; submit should verify the chosen project matches `projectId`.
 */
export function taskStagePairOptionsFromTasks(
  tasks: Record<string, unknown>[],
  projects: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  const seen = new Set<string>()
  const out: Array<{ value: string; label: string }> = []
  for (const row of tasks) {
    const sid = row.stageId
    const pid = row.projectId
    if (sid == null || pid == null) continue
    const key = `${pid}:${sid}`
    if (seen.has(key)) continue
    seen.add(key)
    const proj = projects.find((p) => String(p.id) === String(pid))
    const pname =
      proj != null ? String(proj.name ?? proj.id ?? "") : `Project ${String(pid).slice(-6)}`
    out.push({
      value: key,
      label: `${pname} — stage ${String(sid).slice(-8)}`,
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

export function helpdeskTeamRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.id),
  }))
}

export function helpdeskStageRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.sequence ?? row.id),
  }))
}

export function mrpBomRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: `BOM ${String(row.id)} — product ${String(row.productId ?? row.productTmplId ?? "?")}`,
  }))
}

export function locationOptionsFromQuantsAndTransfers(
  stockQuants: Record<string, unknown>[],
  transfers: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  const map = new Map<string, string>()
  for (const q of stockQuants) {
    const lid = q.locationId
    if (lid != null && !map.has(String(lid))) {
      map.set(String(lid), `Location ${String(lid).slice(-8)}`)
    }
  }
  for (const tr of transfers) {
    const a = tr.locationId
    const b = tr.locationDestId
    if (a != null && !map.has(String(a))) map.set(String(a), `Loc ${String(a).slice(-8)} (src)`)
    if (b != null && !map.has(String(b))) map.set(String(b), `Loc ${String(b).slice(-8)} (dest)`)
  }
  return [...map.entries()].map(([value, label]) => ({ value, label }))
}
