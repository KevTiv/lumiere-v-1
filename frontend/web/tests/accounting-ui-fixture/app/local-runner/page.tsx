'use client'

import { useCallback, useEffect, useState } from 'react'
import { discoverRunners, followRunnerTurn, startRunnerTurn } from '../../../../lib/local-runner-client'
import { localRunnerOptions, LocalRunnerControls, type RunnerView } from '../../../../lib/local-runner-controls'
import { readRunnerReceipt, type RunnerDevice, type RunnerReceipt } from '../../../../lib/local-runner-state'

const companyId = 4097
const receiptKey = 'lumiere:local-runner:fixture-receipt'
const prompt = 'Why is this item low on stock?'

/** The test intercepts the gateway requests and drives the real browser controls and client. */
export default function LocalRunnerFixture() {
  const [devices, setDevices] = useState<RunnerDevice[]>([])
  const [receipt, setReceipt] = useState<RunnerReceipt>()
  const [view, setView] = useState<RunnerView>()
  const [error, setError] = useState<string>()

  const refresh = useCallback(async (signal = new AbortController().signal) => {
    try {
      const discovery = await discoverRunners(companyId, signal)
      setDevices(discovery.devices)
    } catch {
      if (!signal.aborted) setError('Fixture discovery failed')
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    setReceipt(readRunnerReceipt(sessionStorage, receiptKey))
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    if (!receipt) return
    const controller = new AbortController()
    void followRunnerTurn(companyId, receipt, controller.signal, (activity, reconnecting) => {
      setView({ receipt, activity, reconnecting })
    }).catch(() => {
      if (!controller.signal.aborted) setError('Fixture stream failed')
    })
    return () => controller.abort()
  }, [receipt])

  const choice = localRunnerOptions(devices)[0]
  async function start() {
    if (!choice) return
    try {
      const run = await startRunnerTurn({
        companyId,
        conversationId: 'fixture-thread',
        requestId: 'fixture-request',
        deviceId: choice.device.deviceId,
        provider: choice.provider.provider,
        prompt,
      }, new AbortController().signal)
      const saved = { ...run, turnId: 'fixture-turn', prompt, label: choice.label, funding: choice.provider.funding }
      sessionStorage.setItem(receiptKey, JSON.stringify(saved))
      setReceipt(saved)
    } catch {
      setError('Fixture dispatch failed')
    }
  }

  return (
    <main className="m-4 max-w-lg">
      <LocalRunnerControls companyId={companyId} devices={devices} refresh={refresh}
        selectedLabel={choice?.label} selectedFunding={choice?.provider.funding} view={view} />
      {choice && !receipt ? <button type="button" onClick={() => void start()}>Start fixture run</button> : null}
      {view?.activity.terminal?.type === 'verified' ? <p>{view.activity.terminal.answer}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </main>
  )
}
