import { useReducer, useEffect } from "react";

export interface IotDevice {
  id: bigint;
  hubId: bigint;
  organizationId: bigint;
  /** "BarcodeScanner" | "WeighingScale" | "ReceiptPrinter" | "LabelPrinter" |
   *  "CashDrawer" | "TemperatureSensor" | "HumiditySensor" | "RfidReader" |
   *  "Camera" | "Plc" | "PaymentTerminal" | "CustomerDisplay" |
   *  "MeasurementTool" | "Footswitch" | "Custom" */
  deviceType: string;
  identifier: string;
  /** "Online" | "Offline" | "Error" | "Pairing" */
  status: string;
  capabilities: string[];
  workcenterId?: bigint;
  stockLocationId?: bigint;
  posConfigId?: bigint;
  qualityCheckId?: bigint;
}

function listReducer<T>(_: T[], next: T[]): T[] { return next; }

/** Live list of devices for a specific hub. */
export function useIotDevices(hubId: bigint): IotDevice[] {
  const [devices, setDevices] = useReducer(listReducer<IotDevice>, []);

  useEffect(() => {
    // TODO: replace with generated bindings
    // import { IotDevice, iot_device } from "../generated";
    //
    // setDevices(IotDevice.filterByHubId(hubId));
    // const u1 = iot_device.onInsert((_ctx, d) => { if (d.hubId === hubId) setDevices(IotDevice.filterByHubId(hubId)); });
    // const u2 = iot_device.onUpdate((_ctx, _o, n) => { if (n.hubId === hubId) setDevices(IotDevice.filterByHubId(hubId)); });
    // return () => { u1(); u2(); };

    void hubId;
    setDevices([]);
  }, [hubId]);

  return devices;
}
