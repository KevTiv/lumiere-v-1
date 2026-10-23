import { z } from "zod"

const transportSchema = z.object({
  state: z.enum([
    "not_attempted",
    "not_linked",
    "prepared",
    "attempted",
    "accepted",
    "rejected",
    "unknown",
  ]),
  providerAccepted: z.boolean(),
})

const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string(),
  body: z.string(),
  parameterCount: z.number().int().min(0).max(20),
})

export const whatsappOptionsSchema = z.object({
  messageId: z.string(),
  body: z.string(),
  senderName: z.string(),
  recipient: z.string(),
  replyWindowOpen: z.boolean(),
  optedOut: z.boolean(),
  quietHoursAllow: z.boolean(),
  templates: z.array(templateSchema),
  transport: transportSchema,
  dailyLimit: z.number().int(),
})

export const whatsappReviewSchema = z.object({
  reviewId: z.string().regex(/^[a-f0-9]{64}$/),
  messageId: z.string(),
  senderName: z.string(),
  recipient: z.string(),
  body: z.string(),
  expiresInSeconds: z.number().positive(),
})

export const whatsappStatusSchema = z.object({
  messageId: z.string(),
  deliveryState: z.string(),
  transport: transportSchema,
})

export const whatsappSendSchema = z.object({
  state: z.enum(["accepted", "rejected", "already_attempted", "unknown"]),
  messageId: z.string(),
  canAutomaticallyRetry: z.literal(false),
})

export type WhatsAppChoice =
  | { mode: "reply" }
  | { mode: "template"; templateId: string; parameters: string[] }
export type WhatsAppOptions = z.infer<typeof whatsappOptionsSchema>
export type WhatsAppReview = z.infer<typeof whatsappReviewSchema>
export type WhatsAppStatus = z.infer<typeof whatsappStatusSchema>

export async function whatsappRequest<T>(
  url: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init.headers },
  })
  const payload: unknown = await response.json()
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(payload)
    throw new Error(error.success ? error.data.error : "WhatsApp request could not be confirmed")
  }
  return schema.parse(payload)
}

/** Parameters are inserted once and are never interpreted as placeholders. */
export function renderWhatsAppTemplate(body: string, parameters: readonly string[]): string | null {
  let invalid = false
  const rendered = body.replace(/\{\{([^}]*)\}\}/g, (_match: string, index: string) => {
    if (!/^[1-9][0-9]*$/.test(index)) {
      invalid = true
      return ""
    }
    const value = parameters[Number(index) - 1]
    if (value === undefined) {
      invalid = true
      return ""
    }
    return value
  })
  return invalid || !rendered.trim() || new TextEncoder().encode(rendered).length > 4000
    ? null
    : rendered
}

export function canReviewWhatsApp(options: WhatsAppOptions): boolean {
  return options.transport.state === "not_attempted" && !options.optedOut && options.quietHoursAllow
}
