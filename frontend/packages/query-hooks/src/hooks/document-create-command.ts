import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { encodeOptionalU64, stdbParamsToJson } from "@lumiere/stdb/stdb-params-json"
import { scalarToU64, type ScalarId } from "@lumiere/erp-shared/u64"
import type { CreateDocumentFolderParams } from "@lumiere/stdb/types"

export type DocumentFolderCreateInput = CreateDocumentFolderParams & { companyId?: ScalarId | null }

export function documentCreateCommand(companyId: bigint, params: object) {
  return stdbBffCommandPost("create_document", {
    companyId: encodeOptionalU64(companyId),
    params: stdbParamsToJson(params, "CreateDocumentParams"),
  })
}

export function documentFolderCreateCommand(input: DocumentFolderCreateInput) {
  const { companyId, ...params } = input
  return stdbBffCommandPost("create_document_folder", {
    companyId: encodeOptionalU64(companyId == null ? undefined : scalarToU64(companyId)),
    params: stdbParamsToJson(params, "CreateDocumentFolderParams"),
  })
}
