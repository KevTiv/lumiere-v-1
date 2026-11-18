export const CHAT_FILE_LIMIT = 3
export const CHAT_FILE_BYTES = 4 * 1024
export const CHAT_FILE_ERROR = "Choose up to 3 non-empty UTF-8 text files (.txt, .md, .csv, .tsv, .json), up to 4 KB each."

export const CHAT_FILE_ACCEPT = ".txt,.md,.csv,.tsv,.json"
const textFileExtensions = CHAT_FILE_ACCEPT.split(",")

export interface AiChatAttachment {
  name: string
  text: string
}

export function isChatAttachmentFile(name: string, bytes: number): boolean {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase()
  return new TextEncoder().encode(name).length <= 255 && !/[\x00-\x1f\x7f-\x9f/\\]/.test(name)
    && textFileExtensions.includes(extension) && Number.isInteger(bytes) && bytes > 0 && bytes <= CHAT_FILE_BYTES
}

export function isChatAttachment(value: unknown): value is AiChatAttachment {
  if (value == null || typeof value !== "object") return false
  const { name, text } = value as Partial<AiChatAttachment>
  return typeof name === "string" && typeof text === "string"
    && text.length <= CHAT_FILE_BYTES && !!text.trim() && !text.includes("\0")
    && isChatAttachmentFile(name, new TextEncoder().encode(text).length)
}

/** Shared browser/BFF boundary. Never silently discard an invalid attachment. */
export function parseChatAttachments(value: unknown): AiChatAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > CHAT_FILE_LIMIT || !value.every(isChatAttachment)) {
    throw new Error(CHAT_FILE_ERROR)
  }
  return value.map(({ name, text }) => ({ name, text }))
}
