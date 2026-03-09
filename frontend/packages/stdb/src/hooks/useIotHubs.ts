/**
 * Live list of IoT hubs for the given org, kept in sync via SpacetimeDB subscriptions.
 *
 * NOTE: Requires generated bindings from `spacetime generate`.
 *       Import paths reference the `generated/` directory.
 */
import { useReducer, useEffect } from "react";

// ── Type stubs (replaced by generated bindings after `npm run stdb:generate`) ─
export interface IotHub {
  id: bigint;
  organizationId: bigint;
  companyId: bigint;
  name: string;
  serial: string;
  ipAddress?: string;
  firmwareVersion?: string;
  /** "Online" | "Offline" | "Error" | "Pairing" | "ConnectedNoServer" */
  status: string;
  lastHeartbeat?: Date;
  connectivityQuality?: string;
}
// ─────────────────────────────────────────────────────────────────────────────

function listReducer<T>(_: T[], next: T[]): T[] { return next; }

/**
 * Returns a live array of IoT hubs for `orgId`.
 *
 * @example
 * const hubs = useIotHubs(myOrgId);
 */
export function useIotHubs(orgId: bigint): IotHub[] {
  const [hubs, setHubs] = useReducer(listReducer<IotHub>, []);

  useEffect(() => {
    // TODO: replace with generated bindings once `npm run stdb:generate` has run
    // import { IotHub, iot_hub } from "../generated";
    //
    // setHubs(IotHub.filterByOrganizationId(orgId));
    // const u1 = iot_hub.onInsert((_ctx, _hub) => setHubs(IotHub.filterByOrganizationId(orgId)));
    // const u2 = iot_hub.onUpdate((_ctx, _old, _new) => setHubs(IotHub.filterByOrganizationId(orgId)));
    // return () => { u1(); u2(); };

    // Placeholder: no-op until bindings are generated
    void orgId;
    setHubs([]);
  }, [orgId]);

  return hubs;
}
