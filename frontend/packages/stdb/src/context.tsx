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
}

export function StdbConnectionProvider({
  children,
  host,
  moduleName,
  token,
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

    let conn: DbConnection | null = null;

    try {
      conn = DbConnection.builder()
        .withUri(uri)
        .withDatabaseName(mod)
        .withToken(token ?? undefined)
        .onConnect((c, ident, _savedToken) => {
          setStdbConnection(c);
          const identityHex = ident.toHexString();
          setState({ identity: identityHex, connected: false });

          c.subscriptionBuilder()
            .onApplied(() => {
              setState({ identity: identityHex, connected: true });
            })
            .onError((err) => {
              console.error("[stdb] subscription error", err);
            })
            .subscribe(authSubscriptions());
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
