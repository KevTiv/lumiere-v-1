import { queryKnowledgeArticles, type KnowledgeArticle } from "../queries/documents";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { KnowledgeArticle };

export function useKnowledgeArticles(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["knowledge-articles", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.knowledge_article.onInsert((_ctx, _row) => reload());
    conn.db.knowledge_article.onUpdate((_ctx, _old, _new) => reload());
    conn.db.knowledge_article.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryKnowledgeArticles,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}
