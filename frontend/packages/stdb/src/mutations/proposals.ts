import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getStdbConnection } from "../connection";

export interface CreateProposalParams {
  organizationId: bigint;
  title: string;
  clientName: string;
  value: number;
  deadline?: Date;
  description?: string;
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
  sectionId: bigint;   // 0 = create new
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

export function useCreateProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateProposalParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (conn.reducers as any).createProposal(
        params.organizationId,
        params.title,
        params.clientName,
        params.value,
        params.deadline ?? null,
        params.description ?? null,
      );
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (conn.reducers as any).updateProposalStatus(proposalId, status);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (conn.reducers as any).updateProposal(
        params.proposalId,
        params.title,
        params.clientName,
        params.value,
        params.deadline ?? null,
        params.description ?? null,
      );
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (conn.reducers as any).upsertProposalSection(
        params.proposalId,
        params.sectionId,
        params.title,
        params.content,
        params.status,
        params.sequence,
        params.aiSuggestion ?? null,
      );
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (conn.reducers as any).deleteProposalSection(sectionId);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (conn.reducers as any).saveProposalVersion(
        params.proposalId,
        params.message,
        params.sectionsJson,
      );
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (conn.reducers as any).addProposalSourceDoc(
        params.proposalId,
        params.name,
        params.content,
        params.docType,
        params.wordCount,
      );
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (conn.reducers as any).deleteProposalSourceDoc(docId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals"] }),
  });
}
