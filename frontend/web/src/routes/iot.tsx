/**
 * IoT layout route — wraps all /iot/* pages.
 * Boots the SpacetimeDB connection and shows a loading/error state.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useStdb } from "../lib/useStdb";

export const Route = createFileRoute("/iot")({
  component: IotLayout,
});

function IotLayout() {
  const { ready, error } = useStdb();

  if (error) {
    return (
      <div className="p-8 text-red-500">
        <p className="font-semibold">Failed to connect to SpacetimeDB</p>
        <pre className="mt-2 text-sm">{error.message}</pre>
      </div>
    );
  }

  if (!ready) {
    return <div className="p-8 text-gray-400 animate-pulse">Connecting to SpacetimeDB…</div>;
  }

  return <Outlet />;
}
