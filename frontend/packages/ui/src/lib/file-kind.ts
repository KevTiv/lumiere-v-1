import type { TFunction } from "i18next"

/** What sort of file a document is, for its icon and colour; from its MIME type, else its extension. */
export type FileKind = "pdf" | "image" | "spreadsheet" | "document" | "presentation" | "archive" | "video" | "audio" | "code" | "other"

const EXTENSION_KINDS: ReadonlyArray<readonly [FileKind, readonly string[]]> = [
  ["pdf", ["pdf"]],
  ["image", ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "bmp", "tiff"]],
  ["spreadsheet", ["xls", "xlsx", "csv", "ods", "numbers"]],
  ["document", ["doc", "docx", "odt", "rtf", "txt", "md", "pages"]],
  ["presentation", ["ppt", "pptx", "odp", "key"]],
  ["archive", ["zip", "rar", "7z", "tar", "gz", "tgz"]],
  ["video", ["mp4", "mov", "avi", "mkv", "webm"]],
  ["audio", ["mp3", "wav", "ogg", "m4a", "flac"]],
  ["code", ["json", "xml", "html", "js", "ts", "py", "sql", "yaml", "yml"]],
]

export function fileKindOf(mimetype: string | null | undefined, fileName: string | null | undefined): FileKind {
  const mime = (mimetype ?? "").toLowerCase()
  if (mime === "application/pdf") return "pdf"
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return "spreadsheet"
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "presentation"
  if (mime.includes("wordprocessing") || mime.includes("msword") || mime === "text/plain" || mime === "text/markdown") return "document"
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) return "archive"
  if (mime === "application/json" || mime.includes("xml") || mime === "text/html") return "code"

  const extension = fileName ? splitFileName(fileName).extension.slice(1).toLowerCase() : ""
  if (!extension) return "other"
  return EXTENSION_KINDS.find(([, extensions]) => extensions.includes(extension))?.[0] ?? "other"
}

const FILE_KIND_LABELS: Record<FileKind, string> = {
  pdf: "PDF",
  image: "Image",
  spreadsheet: "Spreadsheet",
  document: "Document",
  presentation: "Presentation",
  archive: "Archive",
  video: "Video",
  audio: "Audio",
  code: "Code or data",
  other: "File",
}

export function fileKindLabel(kind: FileKind, t: TFunction): string {
  return t(`documents.fileIdentity.kind.${kind}`, { defaultValue: FILE_KIND_LABELS[kind] })
}

/** Keep the original extension visible when the filename stem needs truncation. */
export function splitFileName(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".")
  const separator = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"))
  if (dot <= separator + 1 || dot === name.length - 1 || name.length - dot > 16) {
    return { stem: name, extension: "" }
  }
  return { stem: name.slice(0, dot), extension: name.slice(dot) }
}

/** Plain-language size: 1536 → "1.5 KB". */
export function formatFileSize(bytes: unknown): string {
  if (bytes == null || bytes === "" || !["number", "bigint", "string"].includes(typeof bytes)) return "—"
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return "—"
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}
