import { useReducer, useEffect } from "react";

export interface IotAlert {
  id: bigint;
  deviceId: bigint;
  thresholdId: bigint;
  value: number;
  /** "Warning" | "Critical" */
  severity: string;
  resolved: boolean;
  resolvedAt?: Date;
}

function listReducer<T>(_: T[], next: T[]): T[] { return next; }

/** Live unresolved alerts for an org. */
export function useIotAlerts(orgId: bigint): IotAlert[] {
  const [alerts, setAlerts] = useReducer(listReducer<IotAlert>, []);

  useEffect(() => {
    // TODO: replace with generated bindings
    // import { IotAlert, iot_alert } from "../generated";
    //
    // const refresh = () => setAlerts(IotAlert.filterByOrganizationId(orgId).filter(a => !a.resolved));
    // refresh();
    // const u1 = iot_alert.onInsert((_ctx, a) => { if (a.organizationId === orgId) refresh(); });
    // const u2 = iot_alert.onUpdate((_ctx, _o, _n) => refresh());
    // return () => { u1(); u2(); };

    void orgId;
    setAlerts([]);
  }, [orgId]);

  return alerts;
}
