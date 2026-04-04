import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryIotActions,
  serverQueryIotDevices,
  serverQueryIotHubs,
  serverQueryIotPairingTokens,
  serverQueryIotTelemetry,
} from "@lumiere/stdb/server"
import { IotClient } from "./iot-client"

export default async function IotPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <IotClient />
  }
  const { organizationId, opts } = session

  const [devices, hubs, pairingTokens, actions, telemetry] = await Promise.all([
    serverQueryIotDevices(organizationId, opts),
    serverQueryIotHubs(organizationId, opts),
    serverQueryIotPairingTokens(organizationId, opts),
    serverQueryIotActions(organizationId, opts),
    serverQueryIotTelemetry(organizationId, opts),
  ]).catch(() => [[], [], [], [], []])

  return (
    <IotClient
      initialDevices={devices as Record<string, unknown>[]}
      initialHubs={hubs as Record<string, unknown>[]}
      initialPairingTokens={pairingTokens as Record<string, unknown>[]}
      initialActions={actions as Record<string, unknown>[]}
      initialTelemetry={telemetry as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
