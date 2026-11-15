import { farmDate, type FarmEventKind } from "./farm-batch-model"

export type FarmPrefill = Partial<{
  businessDate: string
  count: number
  sampleCount: number
  totalWeightKg: number
  feedProduct: string
  quantityKg: number
  liveWeightKg: number
  sellableWeightKg: number
}>

function onlyMatch(prompt: string, pattern: RegExp) {
  const matches = [...new Set(Array.from(prompt.matchAll(pattern), (match) => match[1]))]
  return matches.length === 1 ? matches[0] : undefined
}

function positiveValue(raw: string | undefined) {
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** Only explicit values become editable defaults; native form saves own the actual operation. */
export function farmEventPrefill(kind: FarmEventKind, prompt: string): FarmPrefill {
  const businessDate = farmDate(onlyMatch(prompt, /\b([1-9]\d{3}-\d{2}-\d{2})\b/g) ?? null)
  const animals = positiveValue(
    onlyMatch(prompt, /(?<![\w.,+-])([1-9]\d{0,8})\s+(?:birds?|chickens?|animals?|head)\b/gi),
  )
  const date = businessDate ? { businessDate } : {}
  switch (kind) {
    case "weighIn":
      return {
        ...date,
        sampleCount: animals,
        totalWeightKg: positiveValue(
          onlyMatch(
            prompt,
            /\btotal\s+(?:sample(?:d)?\s+)?weight\s*(?::|was|of)?\s*([0-9]+(?:\.\d+)?)\s*kg\b/gi,
          ),
        ),
      }
    case "feedUsage":
      return {
        ...date,
        feedProduct: onlyMatch(prompt, /\bfeed\s+(?:product\s+)?["“]([^"”\r\n]{1,120})["”]/gi),
        quantityKg: positiveValue(
          onlyMatch(
            prompt,
            /\bfeed\s+(?:consumed\s+)?(?:quantity\s+)?(?::|of)?\s*([0-9]+(?:\.\d+)?)\s*kg\b/gi,
          ),
        ),
      }
    case "processing":
      return {
        ...date,
        count: animals,
        liveWeightKg: positiveValue(
          onlyMatch(
            prompt,
            /\blive\s+(?:input\s+)?weight\s*(?::|was|of)?\s*([0-9]+(?:\.\d+)?)\s*kg\b/gi,
          ),
        ),
        sellableWeightKg: positiveValue(
          onlyMatch(
            prompt,
            /\bsellable\s+(?:output\s+)?weight\s*(?::|was|of)?\s*([0-9]+(?:\.\d+)?)\s*kg\b/gi,
          ),
        ),
      }
    case "feedCoverage":
      return date
    default:
      return { ...date, count: animals }
  }
}
