import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { IotClient } from "./iot-client"

const SSR_RESOURCES = [
  "iot-devices",
  "iot-hubs",
  "iot-pairing-tokens",
  "iot-actions",
  "iot-telemetry",
  "iot-alerts",
  "iot-thresholds",
] as const

export default async function IotPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <IotClient />
  }

  const [devices, hubs, pairingTokens, actions, telemetry, alerts, thresholds] =
    await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <IotClient
      initialDevices={devices}
      initialHubs={hubs}
      initialPairingTokens={pairingTokens}
      initialActions={actions}
      initialTelemetry={telemetry}
      initialAlerts={alerts}
      initialThresholds={thresholds}
      organizationId={session.organizationId}
    />
  )
}
