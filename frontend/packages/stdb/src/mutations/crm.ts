import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateLeadParams,
  CreateOpportunityParams,
  CreateContactParams,
  CreateUtmCampaignParams,
  UpdateUtmCampaignParams,
  CreateUtmMediumParams,
  UpdateUtmMediumParams,
  CreateUtmSourceParams,
  UpdateUtmSourceParams,
} from "../generated/types";
import { getStdbConnection } from "../connection";

export type {
  CreateLeadParams,
  CreateOpportunityParams,
  CreateContactParams,
  CreateUtmCampaignParams,
  UpdateUtmCampaignParams,
  CreateUtmMediumParams,
  UpdateUtmMediumParams,
  CreateUtmSourceParams,
  UpdateUtmSourceParams,
};

// ── UTM (marketing attribution) ──────────────────────────────────────────────

export function createUtmCampaign(organizationId: bigint, params: CreateUtmCampaignParams) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected");
  return conn.reducers.createUtmCampaign({ organizationId, params });
}

export function updateUtmCampaign(
  organizationId: bigint,
  campaignId: bigint,
  params: UpdateUtmCampaignParams,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected");
  return conn.reducers.updateUtmCampaign({ organizationId, campaignId, params });
}

export function createUtmMedium(organizationId: bigint, params: CreateUtmMediumParams) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected");
  return conn.reducers.createUtmMedium({ organizationId, params });
}

export function updateUtmMedium(
  organizationId: bigint,
  mediumId: bigint,
  params: UpdateUtmMediumParams,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected");
  return conn.reducers.updateUtmMedium({ organizationId, mediumId, params });
}

export function createUtmSource(organizationId: bigint, params: CreateUtmSourceParams) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected");
  return conn.reducers.createUtmSource({ organizationId, params });
}

export function updateUtmSource(
  organizationId: bigint,
  sourceId: bigint,
  params: UpdateUtmSourceParams,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected");
  return conn.reducers.updateUtmSource({ organizationId, sourceId, params });
}

// ── Chatter / followers ──────────────────────────────────────────────────────

export function postInternalNote(
  organizationId: bigint,
  model: string,
  resId: bigint,
  body: string,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected");
  return conn.reducers.postInternalNote({ organizationId, model, resId, body });
}

export function subscribeToRecord(
  organizationId: bigint,
  resModel: string,
  resId: bigint,
  subtypes: string[],
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected");
  return conn.reducers.subscribeToRecord({ organizationId, resModel, resId, subtypes });
}

export function unsubscribeFromRecord(organizationId: bigint, resModel: string, resId: bigint) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected");
  return conn.reducers.unsubscribeFromRecord({ organizationId, resModel, resId });
}

export function useCreateLead(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateLeadParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createLead({ organizationId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useCreateOpportunity(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateOpportunityParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createOpportunity({ organizationId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    },
  });
}

export function useCreateContact(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateContactParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createContact({ organizationId, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
