export type SourceInterpretation = {
  key: string
  message: string
  original: string
}

/** Explain known source phrases. These hints never edit or confirm a field. */
export function interpretSourceText(original: string): SourceInterpretation[] {
  const text = original
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
  const mentions = (phrase: string) => ` ${text} `.includes(` ${phrase} `)
  const result: SourceInterpretation[] = []
  const add = (key: string, message: string) => result.push({ key, message, original })
  if (["payement cheq", "paiement cheque"].some(mentions))
    add("cheque", "The source mentions a cheque payment. Clearance and payment evidence remain unverified.")
  if (text === "credit")
    add("credit", "The source reports credit terms at that historical date. Today's outstanding balance is unknown.")
  if (mentions("momo"))
    add("mobileMoney", "The source mentions mobile money. An account, transaction reference and verified settlement are still needed.")
  if (mentions("momo hq"))
    add("headOffice", "HQ is a reported settlement destination. Confirm the account and whether this is an internal transfer.")
  if (mentions("inkoko zifite ikibazo"))
    add("stockCondition", "This label appears to describe chickens with an issue. Clarify the stock condition and location. It does not establish a write-off or a pieces-to-kilograms conversion.")
  if (["loyer", "ubukode"].some(mentions))
    add("rent", "This text refers to rent. The location label does not identify the landlord or supplier.")
  return result
}

/** Links are navigation only. The history API resolves current actor/company access. */
export function sourceHistoryLink(companyId: number, batchId?: string): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0)
    throw new Error("Select a valid operating company.")
  if (batchId !== undefined && !/^[1-9]\d*$/.test(batchId))
    throw new Error("Choose a valid source dataset.")
  const params = new URLSearchParams({
    section: "imports",
    historyCompany: String(companyId),
    historyVerified: "true",
  })
  if (batchId !== undefined) params.set("historyBatch", batchId)
  return `/settings?${params}#available-history`
}

/** A link from a previous company cannot carry its filters into the new scope. */
export function sourceHistorySelection(search: string, companyId: number) {
  const params = new URLSearchParams(search)
  if (params.get("historyCompany") !== String(companyId))
    return { batchId: null, verifiedOnly: false }
  const batch = params.get("historyBatch")
  return {
    batchId: batch && /^[1-9]\d*$/.test(batch) ? batch : null,
    verifiedOnly: params.get("historyVerified") === "true",
  }
}
