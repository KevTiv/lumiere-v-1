export interface SessionConnectionViewInput {
  identityHex: string | null;
  connected: boolean;
  organizationId?: number;
}

/** Compact UI-facing snapshot derived from connection context (no SpacetimeDB imports). */
export interface SessionConnectionView {
  identityPrefix: string | null;
  isConnected: boolean;
  hasOrganizationScope: boolean;
}

export function getSessionConnectionView(
  input: SessionConnectionViewInput,
): SessionConnectionView {
  const id = input.identityHex;
  const identityPrefix =
    id && id.length > 8 ? `${id.slice(0, 8)}…` : id;
  const org = input.organizationId;
  const hasOrganizationScope =
    org !== undefined &&
    org !== null &&
    Number.isFinite(Number(org)) &&
    Number(org) > 0;

  return {
    identityPrefix,
    isConnected: input.connected,
    hasOrganizationScope,
  };
}
