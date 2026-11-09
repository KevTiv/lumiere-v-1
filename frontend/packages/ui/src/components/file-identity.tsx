"use client"

import { useTranslation } from "@lumiere/i18n"
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Info,
  Presentation,
  type LucideIcon,
} from "lucide-react"
import {
  fileKindLabel,
  fileKindOf,
  formatFileSize,
  splitFileName,
  type FileKind,
} from "../lib/file-kind"
import { cn } from "../lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "./popover"

const FILE_TYPES: Record<FileKind, { icon: LucideIcon; color: string }> = {
  pdf: { icon: FileText, color: "bg-destructive/10 text-destructive" },
  image: { icon: FileImage, color: "bg-category-3/10 text-category-3" },
  spreadsheet: { icon: FileSpreadsheet, color: "bg-success/10 text-success" },
  document: { icon: FileText, color: "bg-info/10 text-info" },
  presentation: { icon: Presentation, color: "bg-warning/15 text-warning" },
  archive: { icon: FileArchive, color: "bg-muted text-muted-foreground" },
  video: { icon: FileVideo, color: "bg-primary/10 text-primary" },
  audio: { icon: FileAudio, color: "bg-primary/10 text-primary" },
  code: { icon: FileCode, color: "bg-muted text-foreground" },
  other: { icon: File, color: "bg-muted text-muted-foreground" },
}

export type FileIdentityProps = {
  fileName: string | null | undefined
  title?: string | null
  mimetype?: string | null
  size?: unknown
  status?: string
  variant?: "row" | "card" | "header"
  /** Place identity under an existing record heading without repeating its title. */
  showTitle?: boolean
  /** Reveal the filename without repeating it under a heading that already shows it. */
  showFileName?: boolean
  className?: string
  onOpen?: () => void
  href?: string
  linkTarget?: "_self" | "_blank"
  linkRel?: string
}

const focusStyle =
  "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

function CompactName({ name }: { name: string }) {
  const { stem, extension } = splitFileName(name)
  return (
    <span className="flex min-w-0">
      <span className="min-w-0 truncate">{stem}</span>
      {extension ? <span className="shrink-0">{extension}</span> : null}
    </span>
  )
}

/** Display metadata only. Callers own access checks, opening and saving. */
export function FileIdentity({
  fileName,
  title,
  mimetype,
  size,
  status,
  variant = "row",
  showTitle = true,
  showFileName = true,
  className,
  onOpen,
  href,
  linkTarget,
  linkRel,
}: FileIdentityProps) {
  const { t } = useTranslation()
  const displayTitle =
    title?.trim() ||
    fileName ||
    t("documents.fileIdentity.untitled", { defaultValue: "Untitled file" })
  const distinctTitle = Boolean(title?.trim() && title.trim() !== fileName)
  const kind = fileKindOf(mimetype, fileName)
  const { icon: Icon, color } = FILE_TYPES[kind]
  const metadata = [
    fileKindLabel(kind, t),
    formatFileSize(size),
    status,
  ].filter((part) => part && part !== "—")
  const actionClass = cn(
    focusStyle,
    "max-w-full min-w-0 text-left font-medium text-primary underline-offset-2 hover:underline [overflow-wrap:anywhere]",
  )
  const boundedTitle = (
    <span
      className={cn(
        "min-w-0 font-medium [overflow-wrap:anywhere]",
        variant === "header" ? "line-clamp-3" : "line-clamp-2",
      )}
    >
      {displayTitle}
    </span>
  )
  const titleContent =
    !distinctTitle && fileName ? <CompactName name={fileName} /> : boundedTitle
  const visibleFilename = Boolean(
    fileName &&
    showFileName &&
    (!showTitle || distinctTitle || (!onOpen && !href)),
  )
  const revealTitle = showTitle && distinctTitle ? displayTitle : undefined
  const iconDisclosure = !visibleFilename && Boolean(fileName || revealTitle)

  return (
    <span
      className={cn(
        "flex min-w-0 items-start gap-2.5",
        variant === "card" && "flex-col items-stretch",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          color,
          variant !== "row" && "size-10",
        )}
      >
        <Icon className="size-[55%]" aria-hidden />
      </span>
      <span className="block min-w-0 flex-1 space-y-0.5">
        <span className="flex min-w-0 items-start gap-1.5">
          {showTitle ? (
            onOpen ? (
              <button
                type="button"
                className={actionClass}
                onClick={onOpen}
                aria-label={displayTitle}
              >
                {titleContent}
              </button>
            ) : href ? (
              <a
                className={actionClass}
                href={href}
                target={linkTarget}
                rel={linkRel}
                aria-label={displayTitle}
              >
                {titleContent}
              </a>
            ) : distinctTitle || !fileName ? (
              boundedTitle
            ) : null
          ) : null}
          {iconDisclosure ? (
            <FileNameDisclosure
              fileName={fileName}
              displayTitle={revealTitle}
              iconOnly
            />
          ) : null}
        </span>
        {visibleFilename ? (
          <FileNameDisclosure fileName={fileName} displayTitle={revealTitle} />
        ) : null}
        <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {metadata.join(" · ")}
        </span>
      </span>
    </span>
  )
}

function FileNameDisclosure({
  fileName,
  displayTitle,
  iconOnly,
}: {
  fileName?: string | null
  displayTitle?: string
  iconOnly?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={
          fileName
            ? t("documents.fileIdentity.reveal", {
                defaultValue: "Show original filename: {{name}}",
                name: fileName,
              })
            : t("documents.fileIdentity.revealTitle", {
                defaultValue: "Show full title: {{name}}",
                name: displayTitle,
              })
        }
        className={cn(
          focusStyle,
          "max-w-full min-w-0 text-left text-xs text-muted-foreground underline-offset-2 hover:underline",
          iconOnly ? "grid size-6 shrink-0 place-items-center" : "block",
        )}
      >
        {iconOnly || !fileName ? (
          <Info className="size-3.5" aria-hidden />
        ) : (
          <CompactName name={fileName} />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[min(20rem,calc(100dvh-2rem))] max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        <PopoverTitle>
          {fileName
            ? t("documents.fileIdentity.original", {
                defaultValue: "Original filename",
              })
            : t("documents.fileIdentity.fullTitle", {
                defaultValue: "Full title",
              })}
        </PopoverTitle>
        {fileName ? (
          <p className="select-all [overflow-wrap:anywhere]">{fileName}</p>
        ) : null}
        {displayTitle ? (
          <p className="select-all [overflow-wrap:anywhere]">
            {fileName ? (
              <span className="block font-medium">
                {t("documents.fileIdentity.displayTitle", {
                  defaultValue: "Display title",
                })}
              </span>
            ) : null}
            {displayTitle}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
