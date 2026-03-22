"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { DbConnection } from "./generated";
import { setStdbConnection } from "./connection";
import { authSubscriptions } from "./queries/auth";

interface StdbConnectionState {
  identity: string | null;
  connected: boolean;
}

const StdbConnectionContext = createContext<StdbConnectionState>({
  identity: null,
  connected: false,
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
   * Passed to authSubscriptions() to narrow the casbin_rule subscription to only
   * this user's rules — preventing the full permission matrix from being broadcast.
   */
  serverIdentity?: string;
  /**
   * Role names assigned to the server-resolved identity.
   * Combined with serverIdentity to build the casbin_rule WHERE IN filter.
   */
  serverRoleNames?: string[];
}

export function StdbConnectionProvider({
  children,
  host,
  moduleName,
  token,
  onTokenPersisted,
  serverIdentity,
  serverRoleNames,
}: StdbConnectionProviderProps) {
  const [state, setState] = useState<StdbConnectionState>({
    identity: null,
    connected: false,
  });

  useEffect(() => {
    const uri =
      host ??
      process.env.NEXT_PUBLIC_STDB_HOST ??
      "ws://localhost:3000";
    const mod =
      moduleName ??
      process.env.NEXT_PUBLIC_STDB_MODULE ??
      "lumiere-v1";

    // Load persisted token for seamless reconnection (SSR-safe)
    const savedToken =
      token ??
      (typeof window !== "undefined"
        ? (localStorage.getItem("stdb_token") ?? undefined)
        : undefined);

    let conn: DbConnection | null = null;

    try {
      conn = DbConnection.builder()
        .withUri(uri)
        .withDatabaseName(mod)
        .withToken(savedToken)
        .onConnect((c, ident, refreshedToken) => {
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

          // Dev mode: automatically provision this identity as org admin
          if (process.env.NEXT_PUBLIC_DEV_ADMIN === "true") {
            try {
              c.reducers.ensureDevAdmin();
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
            .subscribe(authSubscriptions(serverIdentity, serverRoleNames));
        })
        .onConnectError((_ctx, err) => {
          console.error("[stdb] connection error", err);
        })
        .onDisconnect((_ctx, err) => {
          if (err) console.warn("[stdb] disconnected with error", err);
          setState({ identity: null, connected: false });
        })
        .build();
    } catch (err) {
      console.error("[stdb] failed to build connection", err);
    }

    return () => {
      try {
        conn?.disconnect();
      } catch {
        // ignore
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <StdbConnectionContext.Provider value={state}>
      {children}
    </StdbConnectionContext.Provider>
  );
}
