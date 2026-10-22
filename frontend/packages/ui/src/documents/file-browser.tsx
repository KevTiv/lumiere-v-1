"use client"

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ChevronRight,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  Presentation,
  Search,
  Share2,
  Star,
  Upload,
  type LucideIcon,
} from "lucide-react"
import { cn } from "../lib/utils"
import { fileKindOf, formatFileSize, type FileKind } from "../lib/file-kind"
import { Button } from "../components/button"
import { Input } from "../components/input"
import { EmptyStateCard } from "../components/empty-state-card"

export interface FileBrowserFolder {
  id: string
  name: string
  /** Parent in the actor-visible folder projection; null for a visible root. */
  parentId: string | null
  fileCount: number
  /** Bytes in the folder's files. */
  totalSize: number
  /** Epoch ms of the latest change to the folder or a file in it. */
  updatedAt: number | null
  isFavorite?: boolean
}

export interface FileBrowserFile {
  id: string
  name: string
  fileName: string
  mimetype: string
  size: number
  folderId: string | null
  /** Epoch ms. */
  updatedAt: number | null
  /** Display name of whoever last changed the file. */
  modifiedBy: string
  isShared?: boolean
  isLocked?: boolean
  isFavorite?: boolean
}

export type FileBrowserLayout = "grid" | "list"

export interface FileBrowserProps {
  folders: FileBrowserFolder[]
  files: FileBrowserFile[]
  /** Uploads into the open folder (null: no folder). Omitted hides the upload button. */
  onUpload?: (files: File[], folderId: string | null) => Promise<void>
  /** Creates inside the open folder. Omitted hides the new-folder button. */
  onCreateFolder?: (parentId: string | null) => void
  onOpenFile?: (fileId: string) => void
  /** Remembers the grid/list choice under this key. */
  storageKey?: string
  className?: string
}

const KIND_STYLE: Record<FileKind, { icon: LucideIcon; tile: string }> = {
  pdf: { icon: FileText, tile: "bg-destructive/10 text-destructive" },
  image: { icon: FileImage, tile: "bg-category-3/10 text-category-3" },
  spreadsheet: { icon: FileSpreadsheet, tile: "bg-success/10 text-success" },
  document: { icon: FileText, tile: "bg-info/10 text-info" },
  presentation: { icon: Presentation, tile: "bg-warning/15 text-warning" },
  archive: { icon: FileArchive, tile: "bg-muted text-muted-foreground" },
  video: { icon: FileVideo, tile: "bg-primary/10 text-primary" },
  audio: { icon: FileAudio, tile: "bg-primary/10 text-primary" },
  code: { icon: FileCode, tile: "bg-muted text-foreground" },
  other: { icon: File, tile: "bg-muted text-muted-foreground" },
}

const FOLDER_TILES = [
  "bg-info/10 text-info",
  "bg-warning/15 text-warning",
  "bg-success/10 text-success",
  "bg-category-3/10 text-category-3",
  "bg-destructive/10 text-destructive",
  "bg-primary/10 text-primary",
] as const

export function FileTypeIcon({ mimetype, fileName, className }: { mimetype: string; fileName: string; className?: string }) {
  const style = KIND_STYLE[fileKindOf(mimetype, fileName)]
  const Icon = style.icon
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-lg", style.tile, className ?? "h-9 w-9")}>
      <Icon className="h-[55%] w-[55%]" aria-hidden />
    </span>
  )
}

function readLayout(key: string | undefined): FileBrowserLayout | null {
  if (!key) return null
  try {
    const stored = window.localStorage.getItem(key)
    return stored === "grid" || stored === "list" ? stored : null
  } catch {
    return null
  }
}

/** Only supplied folders participate in navigation; missing ancestors never become labels. */
function folderNavigation(folders: readonly FileBrowserFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const parents = new Map(folders.map((folder) => [
    folder.id,
    folder.parentId && byId.has(folder.parentId) ? folder.parentId : null,
  ]))
  const visited = new Set<string>()
  for (const folder of folders) {
    const path: string[] = []
    const positions = new Map<string, number>()
    let id: string | null = folder.id
    while (id !== null && !visited.has(id)) {
      const cycleStart = positions.get(id)
      if (cycleStart !== undefined) {
        // Corrupt ancestry must neither trap navigation nor make visible folders unreachable.
        for (const cyclicId of path.slice(cycleStart)) parents.set(cyclicId, null)
        break
      }
      positions.set(id, path.length)
      path.push(id)
      id = parents.get(id) ?? null
    }
    for (const pathId of path) visited.add(pathId)
  }
  return { byId, parents }
}

export function FileBrowser({
  folders,
  files,
  onUpload,
  onCreateFolder,
  onOpenFile,
  storageKey,
  className,
}: FileBrowserProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const [layout, setLayout] = useState<FileBrowserLayout>("grid")
  const [folderId, setFolderId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const stored = readLayout(storageKey)
    if (stored) setLayout(stored)
  }, [storageKey])

  const changeLayout = (next: FileBrowserLayout) => {
    setLayout(next)
    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, next)
    } catch {
      /* not remembered */
    }
  }

  const navigation = useMemo(() => folderNavigation(folders), [folders])
  const openFolder = folderId ? navigation.byId.get(folderId) ?? null : null
  // Use the resolved folder immediately, before the effect clears obsolete selection state.
  const activeFolderId = openFolder?.id ?? null
  // A folder deleted while open falls back to all files.
  useEffect(() => {
    if (folderId && !openFolder) setFolderId(null)
  }, [folderId, openFolder])

  const childFolders = useMemo(
    () => folders.filter((folder) => navigation.parents.get(folder.id) === activeFolderId),
    [folders, navigation, activeFolderId],
  )
  const breadcrumbs = useMemo(() => {
    const path: FileBrowserFolder[] = []
    let id = activeFolderId
    const seen = new Set<string>()
    while (id !== null && !seen.has(id)) {
      seen.add(id)
      const folder = navigation.byId.get(id)
      if (!folder) break
      path.unshift(folder)
      id = navigation.parents.get(id) ?? null
    }
    return path
  }, [activeFolderId, navigation])

  const visibleFiles = useMemo(() => {
    const q = search.trim().toLowerCase()
    return files
      .filter((file) => (activeFolderId ? file.folderId === activeFolderId : true))
      .filter(
        (file) => !q || file.name.toLowerCase().includes(q) || file.fileName.toLowerCase().includes(q),
      )
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }, [files, activeFolderId, search])

  const formatDate = (ms: number | null) =>
    ms == null ? "—" : new Date(ms).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })

  const upload = async (picked: File[]) => {
    if (!onUpload || picked.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      await onUpload(picked, activeFolderId)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploading(false)
    }
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    void upload(Array.from(event.dataTransfer.files))
  }

  const sectionTitle = openFolder ? openFolder.name : t("documents.browser.allFiles")

  return (
    <div className={cn("space-y-6", className)} data-testid="file-browser">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("documents.browser.search")}
            aria-label={t("documents.browser.search")}
            className="pl-9"
          />
        </div>
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          {onCreateFolder ? (
            <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => onCreateFolder(activeFolderId)} data-testid="file-browser-new-folder">
              <FolderPlus className="mr-2 h-4 w-4" />
              {t("documents.browser.newFolder")}
            </Button>
          ) : null}
          {onUpload ? (
            <>
              <Button
                size="sm"
                className="flex-1 sm:flex-none"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
                data-testid="file-browser-upload"
              >
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {uploading ? t("documents.browser.uploading") : t("documents.browser.upload")}
              </Button>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                data-testid="file-browser-input"
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? [])
                  event.target.value = ""
                  void upload(picked)
                }}
              />
            </>
          ) : null}
        </div>
      </div>
      {uploadError ? (
        <p className="text-sm text-destructive" role="alert">
          {uploadError}
        </p>
      ) : null}

      <nav aria-label={t("documents.browser.folders")}>
        <ol className="flex flex-wrap items-center gap-1 text-sm">
          <li>
            {openFolder ? (
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setFolderId(null)} data-testid="file-browser-root">
                {t("documents.browser.allFiles")}
              </button>
            ) : (
              <span aria-current="page">{t("documents.browser.allFiles")}</span>
            )}
          </li>
          {breadcrumbs.map((folder) => (
            <li key={folder.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              {folder.id === activeFolderId ? (
                <span className="truncate font-medium" aria-current="page">{folder.name}</span>
              ) : (
                <button type="button" className="truncate text-muted-foreground hover:text-foreground" onClick={() => setFolderId(folder.id)}>
                  {folder.name}
                </button>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <section className="space-y-3" aria-labelledby="file-browser-folders">
        <h3 id="file-browser-folders" className="text-sm font-semibold text-foreground">
          {t("documents.browser.folders")}
        </h3>
        {childFolders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("documents.browser.noFolders")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
            {childFolders.map((folder, index) => {
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setFolderId(folder.id)}
                  data-testid={`file-browser-folder-${folder.id}`}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", FOLDER_TILES[index % FOLDER_TILES.length])}>
                      <Folder className="h-5 w-5" aria-hidden />
                    </span>
                    {folder.isFavorite ? <Star className="h-4 w-4 fill-warning text-warning" aria-label="Favorite" /> : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{folder.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("documents.browser.fileCount", { count: folder.fileCount })} · {formatFileSize(folder.totalSize)}
                    </p>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {t("documents.browser.updated", { date: formatDate(folder.updatedAt) })}
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section
        className={cn("space-y-3 rounded-xl transition-colors", dragging && "bg-primary/5 ring-2 ring-dashed ring-primary/40")}
        aria-labelledby="file-browser-files"
        onDragOver={
          onUpload
            ? (event) => {
                event.preventDefault()
                setDragging(true)
              }
            : undefined
        }
        onDragLeave={onUpload ? () => setDragging(false) : undefined}
        onDrop={onUpload ? onDrop : undefined}
      >
        <div className="flex items-center gap-2">
          <h3 id="file-browser-files" className="flex min-w-0 items-center gap-1 text-sm font-semibold">
            <span className="truncate">{sectionTitle}</span>
            <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal tabular-nums text-muted-foreground">
              {visibleFiles.length}
            </span>
          </h3>
          <div className="ml-auto flex items-center rounded-lg border border-border p-1" role="group" aria-label={t("documents.browser.layout")}>
            <Button
              variant={layout === "grid" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              aria-pressed={layout === "grid"}
              aria-label={t("documents.browser.grid")}
              onClick={() => changeLayout("grid")}
              data-testid="file-browser-layout-grid"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={layout === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              aria-pressed={layout === "list"}
              aria-label={t("documents.browser.list")}
              onClick={() => changeLayout("list")}
              data-testid="file-browser-layout-list"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {visibleFiles.length === 0 ? (
          <EmptyStateCard
            icon={<Upload />}
            title={search ? t("documents.browser.noMatches") : t("documents.browser.empty")}
            description={onUpload && !search ? t("documents.browser.dropHint") : undefined}
          />
        ) : layout === "grid" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="file-browser-grid">
            {visibleFiles.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={onOpenFile ? () => onOpenFile(file.id) : undefined}
                className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-xs transition-colors hover:border-primary/40"
                data-testid={`file-browser-file-${file.id}`}
              >
                <div className="flex items-start justify-between">
                  <FileTypeIcon mimetype={file.mimetype} fileName={file.fileName} className="h-10 w-10" />
                  <FileFlags file={file} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={file.name}>
                    {file.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatFileSize(file.size)} · {formatDate(file.updatedAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card" data-testid="file-browser-list">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-muted/25 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("documents.browser.name")}</th>
                  <th className="px-3 py-2 font-medium">{t("documents.browser.size")}</th>
                  <th className="px-3 py-2 font-medium">{t("documents.browser.modifiedBy")}</th>
                  <th className="px-3 py-2 font-medium">{t("documents.browser.modified")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleFiles.map((file) => (
                  <tr
                    key={file.id}
                    className={cn(onOpenFile && "cursor-pointer hover:bg-muted/40")}
                    onClick={onOpenFile ? () => onOpenFile(file.id) : undefined}
                    data-testid={`file-browser-row-${file.id}`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileTypeIcon mimetype={file.mimetype} fileName={file.fileName} className="h-8 w-8" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{file.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{file.fileName}</p>
                        </div>
                        <FileFlags file={file} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{formatFileSize(file.size)}</td>
                    <td className="truncate px-3 py-2 text-muted-foreground">{file.modifiedBy}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDate(file.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function FileFlags({ file }: { file: FileBrowserFile }) {
  if (!file.isLocked && !file.isShared && !file.isFavorite) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
      {file.isFavorite ? <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-label="Favorite" /> : null}
      {file.isShared ? <Share2 className="h-3.5 w-3.5" aria-label="Shared" /> : null}
      {file.isLocked ? <Lock className="h-3.5 w-3.5" aria-label="Locked" /> : null}
    </span>
  )
}
