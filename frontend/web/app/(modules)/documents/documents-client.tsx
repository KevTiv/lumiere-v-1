"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newDocumentForm, newKnowledgeArticleForm } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { documentsModuleConfig } from "@/lib/module-dashboard-configs"
import { useDocuments, useKnowledgeArticles, useCreateDocument, useCreateKnowledgeArticle, useStdbConnection, getStdbConnection, documentsSubscriptions } from "@lumiere/stdb"
import type { CreateDocumentParams, CreateKnowledgeArticleParams } from "@lumiere/stdb"

interface DocumentsClientProps {
  initialDocuments?: Record<string, unknown>[]
  initialArticles?: Record<string, unknown>[]
  organizationId?: number
}

export function DocumentsClient({ initialDocuments, initialArticles, organizationId }: DocumentsClientProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => documentsModuleConfig(t), [t])
  const orgId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { connected } = useStdbConnection()

  useEffect(() => {
    const conn = getStdbConnection()
    if (!conn || !connected) return
    conn.subscriptionBuilder()
      .onError((err) => console.error("[stdb] documents subscription error", err))
      .subscribe(documentsSubscriptions(orgId))
  }, [connected, orgId])

  const { data: documents = [] } = useDocuments(orgId, initialDocuments)
  const { data: articles = [] } = useKnowledgeArticles(orgId, initialArticles)
  const createDocument = useCreateDocument(orgId)
  const createKnowledgeArticle = useCreateKnowledgeArticle(orgId, orgId)

  const liveSections = useMemo(() => {
    const shared = documents.filter((d) => d.isShared).length
    const favorites = documents.filter((d) => d.isFavorite).length
    const published = articles.filter((a) => a.isPublished).length

    const dashboardTab = moduleConfig.tabs.find((tab) => tab.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: "Total Documents", value: String(documents.length), icon: "FileText" },
                { label: "Shared", value: String(shared), icon: "Share2" },
                { label: "Favorites", value: String(favorites), icon: "Star" },
                { label: "Published Articles", value: String(published), icon: "BookOpen" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            upload_document: () => setQuickActionForm({ form: newDocumentForm(t), action: "createDocument" }),
            new_article: () => setQuickActionForm({ form: newKnowledgeArticleForm(t), action: "createArticle" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        return w
      }),
    }))
  }, [documents, articles, moduleConfig, t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }),
    [liveSections, moduleConfig],
  )

  const data = useMemo(
    () => ({
      documents: documents as unknown as Record<string, unknown>[],
      "knowledge-base": articles as unknown as Record<string, unknown>[],
    }),
    [documents, articles],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createDocument") {
      createDocument.mutate({
        name: formData.name as string,
        fileName: formData.fileName as string,
        mimetype: formData.mimetype as string | undefined,
        description: formData.description as string | undefined,
        isFavorite: Boolean(formData.isFavorite),
        isShared: Boolean(formData.isShared),
        folderId: undefined,
        url: undefined,
        metadata: undefined,
      } as unknown as CreateDocumentParams)
    } else if (action === "createArticle") {
      createKnowledgeArticle.mutate({
        name: formData.name as string,
        description: formData.description as string | undefined,
        body: formData.body as string | undefined,
        isPublished: Boolean(formData.isPublished),
        parentId: undefined,
        categoryId: undefined,
        coverId: undefined,
        websiteUrl: undefined,
        metadata: undefined,
      } as unknown as CreateKnowledgeArticleParams)
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newDocumentForm(t)}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
