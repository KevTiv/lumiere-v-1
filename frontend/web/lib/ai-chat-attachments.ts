import { CHAT_FILE_ERROR, CHAT_FILE_LIMIT, isChatAttachment, isChatAttachmentFile, type AiChatAttachment } from "@lumiere/erp-shared/ai-chat-attachments"

/** File contents are user-supplied context for this chat turn. */
export async function readChatAttachments(files: readonly File[] = []): Promise<AiChatAttachment[]> {
  if (files.length > CHAT_FILE_LIMIT || files.some(file => !isChatAttachmentFile(file.name, file.size))) {
    // Validate size before reading any file into memory.
    throw new Error(CHAT_FILE_ERROR)
  }
  return Promise.all(files.map(async (file) => {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())
      const attachment = { name: file.name, text }
      if (isChatAttachment(attachment)) return attachment
    } catch {
      // File reads and invalid UTF-8 use the same recovery message.
    }
    throw new Error(`Could not read ${file.name}. Choose a non-empty UTF-8 text file.`)
  }))
}

export function readStoredChatAttachmentNames(metadata?: string | null): string[] | undefined {
  if (!metadata) return undefined
  try {
    const names: unknown = JSON.parse(metadata)?.attachmentNames
    return Array.isArray(names) ? names.filter((name): name is string =>
      typeof name === "string" && isChatAttachmentFile(name, 1)).slice(0, CHAT_FILE_LIMIT) : undefined
  } catch {
    return undefined
  }
}
