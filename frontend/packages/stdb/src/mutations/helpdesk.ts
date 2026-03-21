import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateTicketParams } from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreateTicketParams };

export function useCreateTicket(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateTicketParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createTicket({ organizationId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["helpdeskTickets"] });
    },
  });
}
