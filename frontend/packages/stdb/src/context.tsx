"use client";

import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { callEnsureDevAdmin } from "./commands/core";
import { setStdbConnection } from "./connection";
import { DbConnection } from "./generated";
import { createClientSubscriptions } from "./queries/erp-subscriptions";

interface StdbConnectionState {
  identity: string | null;
  connected: boolean;
  /** Active organization from server session (passed to {@link StdbConnectionProvider}). */
  organizationId?: number;
}

const StdbConnectionContext = createContext<StdbConnectionState>({
  identity: null,
  connected: false,
  organizationId: undefined,
});

export function useStdbConnection(): StdbConnectionState {
  return useContext(StdbConnectionContext);
}

interface StdbConnectionProviderProps {
  children: React.ReactNode;
  host?: string;
  moduleName?: string;
  token?: string;
  /**
   * Called after a successful WebSocket connection with the refreshed token
   * and the user's identity hex. Use this to bridge the token to the server
   * (e.g., via a Next.js server action that sets an HTTP-only cookie).
   * Runs AFTER localStorage persistence.
   */
  onTokenPersisted?: (token: string, identityHex: string) => void;
  /**
   * Identity hex pre-resolved by the server (from cookie) on the initial RSC render.
   * Passed to authSubscriptions() to scope profile, memberships, and Casbin rows.
   */
  serverIdentity?: string;
  /**
   * Role names assigned to the server-resolved identity (Casbin `v0` subjects).
   */
  serverRoleNames?: string[];
  /**
   * Active organization (from server session). Required for org-scoped resource keys.
   */
  organizationId?: number;
  /**
   * Company row ids for this org (from RSC). Required for WebSocket SQL on `fixed-assets`,
   * `intercompany-rules`, and `intercompany-transactions` (see {@link SubscriptionQueryContext}).
   */
  companyIds?: readonly number[];
  /**
   * Resource keys to subscribe to (see {@link SUBSCRIPTION_RESOURCE_KEYS}).
   * Pass an empty array for no subscriptions; there is no implicit “subscribe to everything”.
   */
  subscriptionResources: string[];
}

export function StdbConnectionProvider({
  children,
  host,
  moduleName,
  token,
  onTokenPersisted,
  serverIdentity,
  serverRoleNames,
  organizationId,
  companyIds,
  subscriptionResources,
}: StdbConnectionProviderProps) {
  const [state, setState] = useState<Omit<StdbConnectionState, "organizationId">>({
    identity: null,
    connected: false,
  });

  useEffect(() => {
    /** Set during effect cleanup so `onDisconnect` does not clear React state for intentional teardown. */
    let releasedForCleanup = false;

    let uri = host;
    if (!uri) {
      uri =
        process.env.NEXT_PUBLIC_STDB_HOST ||
        "ws://localhost:3000";
    }
    const connectionUri = uri;
    const mod =
      moduleName ||
      process.env.NEXT_PUBLIC_STDB_MODULE ||
      "lumiere-v1-j1uo0";

    // Load persisted token for seamless reconnection (SSR-safe)
    const savedToken =
      token ??
      (typeof window !== "undefined"
        ? (localStorage.getItem("stdb_token") ?? undefined)
        : undefined);

    let conn: DbConnection | null = null;

    try {
      conn = DbConnection.builder()
        .withUri(connectionUri)
        .withDatabaseName(mod)
        .withToken(savedToken)
        .onConnect((c, ident, refreshedToken) => {
          if (releasedForCleanup) {
            try {
              c.disconnect();
            } catch {
              // ignore
            }
            return;
          }

          // Persist token so the identity survives page refreshes
          if (typeof window !== "undefined" && refreshedToken) {
            localStorage.setItem("stdb_token", refreshedToken);
          }
          const identityHex = ident.toHexString();
          // Bridge token + identity to the server (e.g., via server action cookie)
          if (refreshedToken) {
            onTokenPersisted?.(refreshedToken, identityHex);
          }
          setStdbConnection(c);
          setState({ identity: identityHex, connected: false });

          // Dev: auto-provision org admin only when explicitly enabled (avoid blocking first-tenant onboarding).
          if (
            process.env.NEXT_PUBLIC_DEV_ADMIN === "true" &&
            process.env.NEXT_PUBLIC_DEV_ADMIN_AUTO_ORG === "true"
          ) {
            try {
              callEnsureDevAdmin(c, {});
            } catch (e) {
              console.warn("[stdb] ensure_dev_admin failed", e);
            }
          }

          c.subscriptionBuilder()
            .onApplied(() => {
              setState({ identity: identityHex, connected: true });
            })
            .onError((err) => {
              console.error("[stdb] subscription error", err);
            })
            .subscribe(
              createClientSubscriptions(subscriptionResources, {
                identityHex: serverIdentity,
                roleNames: serverRoleNames,
                organizationId,
                companyIds,
              }),
            );
        })
        .onConnectError((_ctx, err) => {
          console.error("[stdb] connection error", err);
        })
        .onDisconnect((_ctx, err) => {
          if (releasedForCleanup) return;
          if (err) console.warn("[stdb] disconnected with error", err);
          setStdbConnection(null);
          setState({ identity: null, connected: false });
        })
        .build();
    } catch (err) {
      console.error("[stdb] failed to build connection", err);
    }

    return () => {
      releasedForCleanup = true;
      setStdbConnection(null);
      try {
        conn?.disconnect();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    host,
    moduleName,
    onTokenPersisted,
    organizationId,
    companyIds,
    subscriptionResources,
    serverIdentity,
    serverRoleNames,
    token,
  ]);

  return (
    <StdbConnectionContext.Provider
      value={{ ...state, organizationId }}
    >
      {children}
    </StdbConnectionContext.Provider>
  );
}
