#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { runDaemon } from '../src/daemon.mjs'
import { openJournal } from '../src/journal.mjs'
import { claimDevice, deviceEndpoint, validatePairing } from '../src/pairing.mjs'
import { lockState, privateDirectory, readPrivateJson, writePrivateJson } from '../src/private-store.mjs'
import { createProcessSupervisor, discoverExecutables } from '../src/provider-process.mjs'

const usage = [
  'Usage',
  '  lumiere-runner pair --gateway <origin> [--label <name>] [--state-dir <path>]',
  '  lumiere-runner run [--state-dir <path>]',
].join('\n')

function defaultStateDirectory() {
  if (process.platform === 'darwin') return join(homedir(), 'Library/Application Support/Lumiere/runner')
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'lumiere-runner')
}

async function askForCode() {
  const lines = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await lines.question('One-time Lumière pairing code: ')
  } finally {
    lines.close()
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.length < 3) {
    console.log(usage)
    return
  }
  const [command] = process.argv.slice(2)
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      gateway: { type: 'string' },
      label: { type: 'string' },
      'state-dir': { type: 'string' },
    },
  })
  if (command !== 'pair' && command !== 'run') throw new Error(usage)

  const directory = privateDirectory(values['state-dir'] ?? defaultStateDirectory())
  const configPath = join(directory, 'pairing.json')
  const unlock = await lockState(directory)
  try {
    if (command === 'pair') {
      if (!values.gateway) throw new Error('set --gateway to the Lumière gateway origin')
      const pairing = await claimDevice({ gateway: values.gateway, label: values.label, code: await askForCode() })
      writePrivateJson(configPath, pairing)
      console.log('Lumière runner paired. Start it with lumiere-runner run.')
      return
    }
    if (values.gateway !== undefined || values.label !== undefined) throw new Error(usage)
    const pairing = validatePairing(readPrivateJson(configPath, 16 * 1024))
    const { createAdapters } = await import('../adapters/index.mjs')
    const workDirectory = privateDirectory(join(directory, 'workspace'))
    const executables = discoverExecutables()
    const supervisor = createProcessSupervisor({ executables, workDirectory })
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      await runDaemon({
        adapters: createAdapters({ executables, workDirectory, spawn: supervisor.spawn }),
        journal: openJournal({ directory, deviceId: pairing.deviceId }),
        url: deviceEndpoint(pairing.gateway),
        credential: pairing.credential,
        deviceId: pairing.deviceId,
        signal: controller.signal,
      })
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      await supervisor.close()
    }
  } finally {
    unlock()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Lumière runner failed')
  process.exitCode = 1
})
