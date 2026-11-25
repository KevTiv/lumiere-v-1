'use client'

import { Fragment, useState } from 'react'
import { Button } from '@lumiere/ui/components/button'
import { answerRunnerPermission, cancelRunnerTurn, issueRunnerPairing, revokeRunner } from './local-runner-client'
import type { RunnerActivity, RunnerDevice, RunnerFunding, RunnerReceipt } from './local-runner-state'

export const runnerLabels = {
  codex: 'Codex',
  claude: 'Claude Code',
  antigravity: 'Antigravity',
  vibe: 'Mistral Vibe',
} as const

const readiness = {
  missing: 'Not installed',
  signInRequired: 'Sign in on device',
  ready: 'Ready',
  unavailable: 'Unavailable',
  quotaLimited: 'Quota limited',
} as const

const fundingLabels: Record<RunnerFunding, string> = {
  subscription: 'Provider subscription',
  api: 'Provider API billing',
  unknown: 'Billing unavailable',
}

const usageLabels: Record<string, string> = {
  input_tokens: 'input tokens',
  output_tokens: 'output tokens',
  total_tokens: 'tokens',
  context_tokens: 'context tokens',
  limit_percent: 'quota used',
  cost_usd: 'cost',
}

export function localRunnerOptions(devices: RunnerDevice[]) {
  return devices.flatMap(device => device.state !== 'online' ? [] : device.providers.flatMap(provider =>
    provider.state === 'ready' && provider.capabilities.includes('mcp')
      ? [{ value: `local:${provider.provider}:${device.deviceId}`, label: `${runnerLabels[provider.provider]} on ${device.label}`, device, provider }]
      : [],
  ))
}

export interface RunnerView {
  receipt: RunnerReceipt
  activity: RunnerActivity
  reconnecting: boolean
}

interface LocalRunnerControlsProps {
  companyId: number
  devices: RunnerDevice[]
  refresh: () => void
  selectedLabel?: string
  selectedFunding?: RunnerFunding
  view?: RunnerView
  reattach?: () => void
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The local runner request failed.'
}

export function LocalRunnerControls(props: LocalRunnerControlsProps) {
  const { companyId, devices, refresh, selectedLabel, selectedFunding, view, reattach } = props
  const [pairing, setPairing] = useState<Awaited<ReturnType<typeof issueRunnerPairing>>>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function manage(task: () => Promise<unknown>) {
    setBusy(true)
    setError(undefined)
    try {
      await task()
      refresh()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-2 space-y-2" data-testid="assistant-local-runner">
      <details className="rounded-lg border bg-card px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring">Local agents</summary>
        <div className="mt-2 space-y-2">
          <ul className="space-y-2">
            {devices.map(device => (
              <li key={device.deviceId} className="flex items-start justify-between gap-2">
                <div className="min-w-0 break-words">
                  <p>{device.label} · {device.state === 'online' ? 'Online' : 'Offline'}</p>
                  {device.providers.length > 0 && (
                    <p className="text-muted-foreground">{device.providers.map(provider =>
                      `${runnerLabels[provider.provider]} · ${readiness[provider.state]}`).join(' / ')}</p>
                  )}
                </div>
                <Button variant="ghost" type="button" size="sm" disabled={busy} aria-label={`Revoke ${device.label}`}
                  onClick={() => void manage(() => revokeRunner(companyId, device.deviceId))}>Revoke</Button>
              </li>
            ))}
          </ul>
          <Button variant="outline" type="button" size="sm" disabled={busy}
            onClick={() => void manage(async () => setPairing(await issueRunnerPairing(companyId)))}>Pair a device</Button>
          {pairing && Date.parse(pairing.expiresAt) > Date.now() ? (
            <div className="space-y-1 rounded-md bg-muted p-2 text-muted-foreground" role="status">
              <p>Run <code className="break-all">lumiere-runner pair --gateway {pairing.gatewayOrigin ?? window.location.origin}</code> on your device.</p>
              <p>Enter the pairing code <strong className="text-foreground">{pairing.code}</strong>, then run <code>lumiere-runner run</code>.</p>
            </div>
          ) : null}
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        </div>
      </details>
      {selectedLabel && (!view || view.activity.terminal) ? (
        <p className="px-1 text-xs text-muted-foreground">{selectedLabel} · {fundingLabels[selectedFunding ?? 'unknown']}</p>
      ) : null}
      {view ? <RunnerTimeline key={view.receipt.attemptId} view={view} companyId={companyId} reattach={reattach} /> : null}
    </div>
  )
}

function RunnerTimeline({ view, companyId, reattach }: { view: RunnerView; companyId: number; reattach?: () => void }) {
  const { activity, receipt, reconnecting } = view
  const [error, setError] = useState<string>()
  const [cancelRequested, setCancelRequested] = useState(false)
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set())
  const status = activity.terminal?.type === 'verified' ? 'Answer verified'
    : activity.terminal?.type === 'cancelled' ? 'Cancelled'
      : activity.terminal?.type === 'failed' ? 'Run failed'
        : cancelRequested ? 'Cancellation requested'
          : reconnecting ? 'Reconnecting to runner'
            : activity.message ?? 'Waiting for runner activity'

  async function cancel() {
    setCancelRequested(true)
    setError(undefined)
    try {
      await cancelRunnerTurn(companyId, receipt.runId)
    } catch (error) {
      setCancelRequested(false)
      setError(errorMessage(error))
    }
  }

  async function answer(permissionId: string, decision: 'approve' | 'deny') {
    setResolved(previous => new Set([...previous, permissionId]))
    setError(undefined)
    try {
      await answerRunnerPermission(companyId, receipt.runId, permissionId, decision)
    } catch (error) {
      setResolved(previous => new Set([...previous].filter(id => id !== permissionId)))
      setError(errorMessage(error))
    }
  }

  return (
    <section aria-label="Local runner activity" className="max-h-[22dvh] space-y-2 overflow-y-auto rounded-lg border bg-card px-3 py-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 break-words">
          <p className="font-medium">{receipt.label} · {fundingLabels[receipt.funding ?? 'unknown']}</p>
          <p role="status" className="text-muted-foreground">{status}</p>
        </div>
        {!activity.terminal ? <Button type="button" variant="ghost" size="sm" disabled={cancelRequested}
          onClick={() => void cancel()}>Cancel run</Button> : null}
      </div>
      {activity.tools.length > 0 ? <ul className="space-y-1 text-muted-foreground">
        {activity.tools.map(tool => <li key={tool.toolId} className="break-words">{tool.name} · {tool.status}</li>)}
      </ul> : null}
      {activity.permissions.map(permission => (
        <div key={permission.permissionId} className="space-y-1 rounded-md border px-2 py-1.5">
          <p className="break-words">Runtime permission requested · {permission.label}</p>
          <div className="flex flex-wrap gap-1">
            <Button type="button" variant="outline" size="sm" disabled={resolved.has(permission.permissionId)}
              onClick={() => void answer(permission.permissionId, 'deny')}>Deny</Button>
            <Button type="button" variant="outline" size="sm" disabled={resolved.has(permission.permissionId)}
              onClick={() => void answer(permission.permissionId, 'approve')}>Allow</Button>
          </div>
        </div>
      ))}
      <p className="break-words text-muted-foreground">
        {activity.usage.length ? activity.usage.map((usage, index) => (
          <Fragment key={usage.scope + ':' + usage.metric}>
            {index > 0 ? ' · ' : ''}{usage.estimated ? 'Est. ' : ''}{usage.scope} {usage.metric === 'cost_usd'
              ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(usage.value)
              : `${new Intl.NumberFormat().format(usage.value)}${usage.metric === 'limit_percent' ? '%' : ''}`} {usageLabels[usage.metric]}
          </Fragment>
        )) : 'Usage unavailable'}
      </p>
      {reattach ? <Button variant="outline" size="sm" type="button" onClick={reattach}>Reconnect to run</Button> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </section>
  )
}
