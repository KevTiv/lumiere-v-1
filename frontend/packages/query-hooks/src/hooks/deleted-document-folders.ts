import {
  decodeQueryListResponse,
  QueryResponseDecodeError,
} from "@lumiere/api-client"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stdbTimestampToDate } from "@lumiere/erp-shared/timestamp-values"
import { apiFetch } from "../http"

/** HTTP folder trash projection. Field policy may omit everything except the two required IDs. */
export type DeletedDocumentFolder = {
  id: string
  organizationId: string
  companyId?: string | null
  parentId?: string | null
  name?: string
  parentPath?: string
  writeDate?: string
  createDate?: string
  isFavorite?: boolean
  isHidden?: boolean
}

type FolderFields = Partial<Record<keyof DeletedDocumentFolder, unknown>>

export function decodeDeletedDocumentFolders(
  payload: unknown,
  organizationId: bigint,
  companyId: bigint,
): DeletedDocumentFolder[] {
  const ids = new Set<string>()
  return decodeQueryListResponse(payload, (value, index) => {
    const invalid = () =>
      new QueryResponseDecodeError(`Invalid folder trash row at index ${index}`)
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw invalid()
    const row: FolderFields = value
    const positiveId = (value: unknown) => {
      if (
        typeof value !== "number" &&
        (typeof value !== "string" || !/^\d+$/.test(value))
      )
        throw invalid()
      const parsed = parseStrictU64(value)
      if (parsed === undefined || parsed === 0n) throw invalid()
      return String(parsed)
    }
    const optionalId = (value: unknown) =>
      value == null ? value : positiveId(value)
    const optionalString = (value: unknown) => {
      if (value !== undefined && typeof value !== "string") throw invalid()
      return value
    }
    const optionalBoolean = (value: unknown) => {
      if (value !== undefined && typeof value !== "boolean") throw invalid()
      return value
    }
    const optionalDate = (value: unknown) => {
      if (value === undefined) return undefined
      const date = stdbTimestampToDate(value)
      if (!date) throw invalid()
      return date.toISOString()
    }
    const id = positiveId(row.id)
    const rowOrganizationId = positiveId(row.organizationId)
    const rowCompanyId = optionalId(row.companyId)
    if (
      ids.has(id) ||
      rowOrganizationId !== String(organizationId) ||
      (rowCompanyId != null && rowCompanyId !== String(companyId))
    )
      throw invalid()
    ids.add(id)
    return {
      id,
      organizationId: rowOrganizationId,
      companyId: rowCompanyId,
      parentId: optionalId(row.parentId),
      name: optionalString(row.name),
      parentPath: optionalString(row.parentPath),
      writeDate: optionalDate(row.writeDate),
      createDate: optionalDate(row.createDate),
      isFavorite: optionalBoolean(row.isFavorite),
      isHidden: optionalBoolean(row.isHidden),
    }
  })
}

export async function readDeletedDocumentFolders(
  organizationId: bigint,
  companyId: bigint,
) {
  const response = await apiFetch(
    `/api/query/document-folders-deleted?companyId=${companyId}`,
  )
  if (!response.ok)
    throw Object.assign(new Error("Failed to load folder trash"), {
      status: response.status,
    })
  return decodeDeletedDocumentFolders(
    await response.json(),
    organizationId,
    companyId,
  )
}
