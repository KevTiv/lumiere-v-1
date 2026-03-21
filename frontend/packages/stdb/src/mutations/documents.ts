import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateDocumentParams, CreateKnowledgeArticleParams } from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreateDocumentParams, CreateKnowledgeArticleParams };

export function useCreateDocument(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateDocumentParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createDocument({ organizationId, companyId: undefined, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useCreateKnowledgeArticle(organizationId: bigint, companyId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateKnowledgeArticleParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createKnowledgeArticle({ organizationId, companyId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledgeArticles"] });
    },
  });
}
