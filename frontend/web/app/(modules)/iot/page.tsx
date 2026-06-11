import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryIotActions,
  serverQueryIotAlerts,
  serverQueryIotDevices,
  serverQueryIotHubs,
  serverQueryIotPairingTokens,
  serverQueryIotTelemetry,
  serverQueryIotThresholds,
} from "@lumiere/stdb/server"
import { IotClient } from "./iot-client"

export default async function IotPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <IotClient />
  }
  const { organizationId, opts } = session

  const [devices, hubs, pairingTokens, actions, telemetry, alerts, thresholds] = await Promise.all([
    serverQueryIotDevices(organizationId, opts),
    serverQueryIotHubs(organizationId, opts),
    serverQueryIotPairingTokens(organizationId, opts),
    serverQueryIotActions(organizationId, opts),
    serverQueryIotTelemetry(organizationId, opts),
    serverQueryIotAlerts(organizationId, opts),
    serverQueryIotThresholds(organizationId, opts),
  ]).catch(() => [[], [], [], [], [], [], []])

  return (
    <IotClient
      initialDevices={devices as Record<string, unknown>[]}
      initialHubs={hubs as Record<string, unknown>[]}
      initialPairingTokens={pairingTokens as Record<string, unknown>[]}
      initialActions={actions as Record<string, unknown>[]}
      initialTelemetry={telemetry as Record<string, unknown>[]}
      initialAlerts={alerts as Record<string, unknown>[]}
      initialThresholds={thresholds as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
