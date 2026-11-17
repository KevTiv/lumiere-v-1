"use client"

import { useQuery } from "@tanstack/react-query"
import { isSavedGuide, type GuideDocument, type GuideDraft } from "@lumiere/ui/lib/assistant-guide-types"
import { moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { assistantGuideHistory } from "./assistant-guides"

export function useAssistantGuideRevisions(document: GuideDraft | GuideDocument | null, scope: string) {
  const guide = document && isSavedGuide(document) ? document : null
  const query = useQuery({
    queryKey: ["assistant-guide-revisions", scope, guide?.guideId, guide?.revision, guide?.headRevision],
    enabled: guide !== null,
    queryFn: ({ signal }) => {
      if (!guide) throw new Error("Open a saved guide to load its revisions.")
      return assistantGuideHistory({ guideId: guide.guideId, revision: guide.revision }, guide.companyId, signal)
    },
    retry: false,
  })
  const historyState = guide ? moduleQueryState(query) : undefined
  return { history: historyState?.status === "ready" ? query.data : undefined, historyState }
}
