/**
 * React hook that boots the SpacetimeDB connection and tracks ready state.
 *
 * Usage in a layout component:
 *   const { ready, error } = useStdb();
 */
import { useState, useEffect } from "react";
import { initStdb } from "./stdb";

export function useStdb() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    initStdb()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, []);

  return { ready, error };
}
