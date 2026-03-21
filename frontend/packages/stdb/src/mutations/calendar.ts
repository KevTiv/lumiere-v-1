import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateCalendarEventParams } from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreateCalendarEventParams };

export function useCreateCalendarEvent(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateCalendarEventParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createCalendarEvent({ organizationId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendarEvents"] });
    },
  });
}
