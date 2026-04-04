import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Timestamp } from "spacetimedb";
import { getStdbConnection } from "../connection";

export interface CreateProposalParams {
  organizationId: bigint;
  title: string;
  clientName: string;
  value: number;
  deadline?: Date;
  description?: string;
  documentFolderId?: bigint;
}

export interface UpdateProposalParams {
  proposalId: bigint;
  title: string;
  clientName: string;
  value: number;
  deadline?: Date;
  description?: string;
}

export interface UpsertProposalSectionParams {
  proposalId: bigint;
  sectionId: bigint;   // 0n = create new
  title: string;
  content: string;
  status: string;
  sequence: number;
  aiSuggestion?: string;
}

export interface SaveProposalVersionParams {
  proposalId: bigint;
  message: string;
  sectionsJson: string;
}

export interface AddProposalSourceDocParams {
  proposalId: bigint;
  name: string;
  content: string;
  docType: string;
  wordCount: number;
}

export interface UpdateProposalSourceDocParams {
  docId: bigint;
  name?: string;
  content?: string;
  docType?: string;
  wordCount?: number;
}

export interface AddProposalLineItemParams {
  proposalId: bigint;
  sectionId?: bigint;
  productId: bigint;
  productName: string;
  quantity: number;
  priceUnit: number;
  discount: number;
  notes?: string;
}

export interface UpdateProposalLineItemParams {
  lineItemId: bigint;
  quantity: number;
  priceUnit: number;
  discount: number;
  notes?: string;
}

export interface UpdateProposalPresenceParams {
  proposalId: bigint;
  sectionId?: bigint;
  userName: string;
}

export interface AddProposalCommentParams {
  proposalId: bigint;
  sectionId: bigint;
  content: string;
  parentId?: bigint;
  authorName: string;
}

export function useCreateProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateProposalParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createProposal({
        organizationId: params.organizationId,
        title: params.title,
        clientName: params.clientName,
        value: params.value,
        deadline: params.deadline ? Timestamp.fromDate(params.deadline) : undefined,
        description: params.description ?? undefined,
        documentFolderId: params.documentFolderId ?? undefined,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useUpdateProposalStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, status }: { proposalId: bigint; status: string }) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.updateProposalStatus({ proposalId, status });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useUpdateProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateProposalParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.updateProposal({
        proposalId: params.proposalId,
        title: params.title,
        clientName: params.clientName,
        value: params.value,
        deadline: params.deadline ? Timestamp.fromDate(params.deadline) : undefined,
        description: params.description ?? undefined,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useUpsertProposalSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpsertProposalSectionParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.upsertProposalSection({
        proposalId: params.proposalId,
        sectionId: params.sectionId,
        title: params.title,
        content: params.content,
        status: params.status,
        sequence: params.sequence,
        aiSuggestion: params.aiSuggestion ?? undefined,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposal-sections"] }),
  });
}

export function useDeleteProposalSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sectionId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.deleteProposalSection({ sectionId });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposal-sections"] }),
  });
}

export function useSaveProposalVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: SaveProposalVersionParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.saveProposalVersion({
        proposalId: params.proposalId,
        message: params.message,
        sectionsJson: params.sectionsJson,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useAddProposalSourceDoc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: AddProposalSourceDocParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.addProposalSourceDoc({
        proposalId: params.proposalId,
        name: params.name,
        content: params.content,
        docType: params.docType,
        wordCount: params.wordCount,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useDeleteProposalSourceDoc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (docId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.deleteProposalSourceDoc({ docId });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useUpdateProposalSourceDoc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateProposalSourceDocParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.updateProposalSourceDoc({
        docId: params.docId,
        params: {
          name: params.name,
          content: params.content,
          docType: params.docType,
          wordCount: params.wordCount,
        },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

// ── Line Item Mutations ────────────────────────────────────────────────────

export function useAddProposalLineItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: AddProposalLineItemParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.addProposalLineItem({
        proposalId: params.proposalId,
        sectionId: params.sectionId ?? undefined,
        productId: params.productId,
        productName: params.productName,
        quantity: params.quantity,
        priceUnit: params.priceUnit,
        discount: params.discount,
        notes: params.notes ?? undefined,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposal-line-items"] }),
  });
}

export function useUpdateProposalLineItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateProposalLineItemParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.updateProposalLineItem({
        lineItemId: params.lineItemId,
        quantity: params.quantity,
        priceUnit: params.priceUnit,
        discount: params.discount,
        notes: params.notes ?? undefined,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposal-line-items"] }),
  });
}

export function useDeleteProposalLineItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lineItemId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.deleteProposalLineItem({ lineItemId });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposal-line-items"] }),
  });
}

export function useReorderProposalLineItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, orderedIds }: { proposalId: bigint; orderedIds: bigint[] }) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.reorderProposalLineItems({ proposalId, orderedIds });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposal-line-items"] }),
  });
}

// ── Presence Mutations ─────────────────────────────────────────────────────

export function useUpdateProposalPresence() {
  return useMutation({
    mutationFn: (params: UpdateProposalPresenceParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.updateProposalPresence({
        proposalId: params.proposalId,
        sectionId: params.sectionId ?? undefined,
        userName: params.userName,
      });
    },
  });
}

export function useClearProposalPresence() {
  return useMutation({
    mutationFn: (proposalId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.clearProposalPresence({ proposalId });
    },
  });
}

// ── Comment Mutations ──────────────────────────────────────────────────────

export function useAddProposalComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: AddProposalCommentParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.addProposalComment({
        proposalId: params.proposalId,
        sectionId: params.sectionId,
        content: params.content,
        parentId: params.parentId ?? undefined,
        authorName: params.authorName,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposal-comments"] }),
  });
}

export function useResolveProposalComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: bigint) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.resolveProposalComment({ commentId });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposal-comments"] }),
  });
}
