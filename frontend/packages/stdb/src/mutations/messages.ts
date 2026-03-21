import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getStdbConnection } from "../connection";

export interface PostMessageParams {
  model: string;
  resId: bigint;
  body: string;
  parentId?: bigint;
  attachmentIds?: bigint[];
}

export function usePostMessage(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: PostMessageParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.postMessage({
        organizationId,
        model: params.model,
        resId: params.resId,
        body: params.body,
        parentId: params.parentId ?? undefined,
        attachmentIds: params.attachmentIds ?? [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailMessages"] });
    },
  });
}
