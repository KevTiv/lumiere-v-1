import { makeAdapter } from './adapter.mjs'
import { acpProtocol } from './acp.mjs'
import { claudeProtocol } from './claude.mjs'
import { codexProtocol } from './codex.mjs'

const protocols = {
  codex: codexProtocol,
  claude: claudeProtocol,
  antigravity: acpProtocol('antigravity', ['acp']),
  vibe: acpProtocol('vibe', [])
}

export function createAdapters({ executables, workDirectory, spawn, isolatedProviders = [] }) {
  return Object.fromEntries(Object.entries(protocols).map(([provider, protocol]) => [
    provider,
    makeAdapter({
      provider, protocol, workDirectory, spawn, executable: executables[provider],
      isolated: isolatedProviders.includes(provider)
    })
  ]))
}
