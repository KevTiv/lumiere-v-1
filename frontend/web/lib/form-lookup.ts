/**
 * Build `<select>` options from `/api/query` rows for modular forms.
 */

import { expenseVariantTag } from './expense-state'
/** Chart of accounts — code + name for GL pickers. */
export function accountAccountRowsToSelectOptions(
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
  return rows
    .filter((r) => r.deletedAt == null)
    .map((row) => ({
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

/** Purchase orders — optional filter to draft-only (for adding lines). */
export function purchaseOrderRowsToSelectOptions(
  rows: Record<string, unknown>[],
  opts?: { draftOnly?: boolean },
): Array<{ value: string; label: string }> {
  const list =
    opts?.draftOnly === true
      ? rows.filter((r) => String(r.state ?? "") === "Draft")
      : rows
  return list.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? `PO ${row.id}`),
  }))
}

export function partnerBankRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => {
    const acct = row.sanitizedAccNumber != null ? String(row.sanitizedAccNumber) : "—"
    return {
      value: String(row.id),
      label: `#${row.id} · ${acct}`,
    }
  })
}

export function loyaltyProgramRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? `Program ${row.id}`),
  }))
}

/** Draft PO lines (for editing qty/price before confirmation). */
export function purchaseOrderLineRowsToEditOptions(
  lines: Record<string, unknown>[],
  productLabel?: (productId: string) => string,
): Array<{ value: string; label: string }> {
  return lines
    .filter((l) => {
      const s = l.state
      const st =
        s != null && typeof s === "object" && "tag" in s ? String((s as { tag: string }).tag) : String(s ?? "")
      return st === "Draft"
    })
    .map((l) => {
      const id = String(l.id)
      const pid = String(l.productId ?? "")
      const pname = productLabel?.(pid) ?? `Product ${pid}`
      return {
        value: id,
        label: `PO ${l.orderId} — ${pname}`,
      }
    })
}

/** PO lines with remaining qty to receive (goods receipt). */
export function purchaseOrderLineRowsToReceiveOptions(
  lines: Record<string, unknown>[],
  productLabel?: (productId: string) => string,
): Array<{ value: string; label: string }> {
  return lines
    .filter((l) => {
      const pq = Number(l.productQty ?? 0)
      const qr = Number(l.qtyReceived ?? 0)
      return pq > qr
    })
    .map((l) => {
      const id = String(l.id)
      const pid = String(l.productId ?? "")
      const pname = productLabel?.(pid) ?? `Product ${pid}`
      const left = Math.max(0, Number(l.productQty ?? 0) - Number(l.qtyReceived ?? 0))
      return {
        value: id,
        label: `PO ${l.orderId} — ${pname} (${left} left)`,
      }
    })
}

/** PO lines with qty left to invoice (vendor bill / accrual). */
export function purchaseOrderLineRowsToInvoiceOptions(
  lines: Record<string, unknown>[],
  productLabel?: (productId: string) => string,
): Array<{ value: string; label: string }> {
  return lines
    .filter((l) => {
      const qr = Number(l.qtyReceived ?? 0)
      const qi = Number(l.qtyInvoiced ?? 0)
      return qr > qi
    })
    .map((l) => {
      const id = String(l.id)
      const pid = String(l.productId ?? "")
      const pname = productLabel?.(pid) ?? `Product ${pid}`
      const left = Math.max(0, Number(l.qtyReceived ?? 0) - Number(l.qtyInvoiced ?? 0))
      return {
        value: id,
        label: `PO ${l.orderId} — ${pname} (${left} to bill)`,
      }
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

/** Leave types from hr_leave_type table (preferred over inferring from requests). */
export function leaveTypeRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows
    .filter((r) => r.active !== false && r.active !== 0)
    .map((row) => ({
      value: String(row.id),
      label: String(row.name ?? row.displayName ?? row.code ?? row.id),
    }))
}

/** Payroll structures for payslip structId picker. */
export function payrollStructureRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows
    .filter((r) => r.isActive !== false && r.isActive !== 0)
    .map((row) => ({
      value: String(row.id),
      label: String(row.name ?? row.id),
    }))
}

export function projectRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.id),
  }))
}

export function taskRowsToSelectOptions(
  rows: Record<string, unknown>[],
  projectId?: string | number,
): Array<{ value: string; label: string }> {
  let filtered = rows
  if (projectId != null) {
    filtered = rows.filter((r) => String(r.projectId) === String(projectId))
  }
  return filtered.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.id),
  }))
}

export function userRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.email ?? row.id),
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

/** Stage options with team name prefix when `teams` is provided. */
export function helpdeskStageRowsToSelectOptionsWithTeams(
  stages: Record<string, unknown>[],
  teams: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  const teamName = (teamId: unknown): string => {
    if (teamId == null || teamId === "") return "—"
    const t = teams.find((x) => String(x.id) === String(teamId))
    return t != null ? String(t.name ?? teamId) : String(teamId)
  }
  return stages.map((row) => {
    const tid = row.teamId
    const prefix = tid != null && tid !== "" ? `${teamName(tid)} · ` : ""
    return {
      value: String(row.id),
      label: `${prefix}${String(row.name ?? row.sequence ?? row.id)}`,
    }
  })
}

export function helpdeskSlaRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.id),
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

export function posTerminalRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.locationLabel ?? row.id),
  }))
}

export function posConfigRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.id),
  }))
}

export function posSessionRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => {
    const state = row.state != null ? String(row.state) : ""
    const name = String(row.name ?? `Session ${row.id}`)
    return {
      value: String(row.id),
      label: state ? `${name} (${state})` : name,
    }
  })
}

export function fleetVehicleRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.licensePlate ?? row.id),
  }))
}

/** Draft expense reports only; optionally filter to the same employee as the expense line. */
export function expenseSheetRowsToDraftSelectOptions(
  rows: Record<string, unknown>[],
  employeeId?: string,
): Array<{ value: string; label: string }> {
  let list = rows.filter((r) => expenseVariantTag(r.state) === 'Draft')
  if (employeeId != null && employeeId !== '') {
    list = list.filter(
      (r) => String(r.employeeId ?? (r as { employee_id?: unknown }).employee_id) === employeeId,
    )
  }
  return list.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.id),
  }))
}
