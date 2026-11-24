import { spawn as spawnChild } from 'node:child_process'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, relative, resolve, sep } from 'node:path'

const executableNames = {
  codex: 'codex',
  claude: 'claude',
  antigravity: 'agy',
  vibe: 'vibe-acp',
}

const preservedEnvironment = [
  'HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TMPDIR', 'TMP', 'TEMP', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  'XDG_STATE_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'VIBE_HOME',
]

export function discoverExecutables(searchPath = process.env.PATH ?? '') {
  const directories = searchPath.split(delimiter).filter(isAbsolute)
  const executables = {}
  for (const [provider, name] of Object.entries(executableNames)) {
    for (const directory of directories) {
      try {
        const executable = realpathSync(resolve(directory, name))
        if (!statSync(executable).isFile()) continue
        accessSync(executable, constants.X_OK)
        executables[provider] = executable
        break
      } catch (error) {
        if (!['ENOENT', 'EACCES', 'ENOTDIR', 'ELOOP'].includes(error.code)) throw error
      }
    }
  }
  return executables
}

function providerEnvironment(source, additions = {}) {
  const environment = {}
  for (const key of preservedEnvironment) {
    if (source[key] !== undefined) environment[key] = source[key]
  }
  for (const [key, value] of Object.entries(additions)) {
    if (key !== 'LUMIERE_MCP_TOKEN' || typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error('invalid provider environment override')
    }
    environment[key] = value
  }
  return environment
}

export function createProcessSupervisor({
  executables,
  workDirectory,
  environment = process.env,
  graceMs = 1_500,
}) {
  const allowed = new Set(Object.values(executables))
  const root = realpathSync(workDirectory)
  const children = new Set()
  const useProcessGroup = process.platform !== 'win32'
  let closing = false

  function signalChild(child, signal) {
    if (child.pid === undefined) return false
    try {
      return useProcessGroup ? process.kill(-child.pid, signal) : child.kill(signal)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
      return false
    }
  }

  function spawn(executable, args, { cwd = root, env, signal } = {}) {
    if (closing) throw new Error('provider supervisor is closing')
    signal?.throwIfAborted()
    if (!isAbsolute(executable) || !allowed.has(executable)) {
      throw new Error('provider executable was not locally discovered')
    }
    if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string' || argument.includes('\0'))) {
      throw new Error('invalid provider arguments')
    }
    const workingDirectory = realpathSync(cwd)
    const localPath = relative(root, workingDirectory)
    if (localPath === '..' || localPath.startsWith(`..${sep}`) || isAbsolute(localPath)) {
      throw new Error('provider working directory is outside the runner workspace')
    }
    const child = spawnChild(executable, args, {
      cwd: workingDirectory,
      detached: useProcessGroup,
      env: providerEnvironment(environment, env),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let killTimer
    let finished = false
    let resolveCompletion
    const completion = new Promise(resolve => { resolveCompletion = resolve })
    const record = { completion, terminate }

    function finish() {
      if (finished) return
      finished = true
      signal?.removeEventListener('abort', terminate)
      children.delete(record)
      resolveCompletion()
    }

    function terminate() {
      if (finished || killTimer) return
      if (!signalChild(child, 'SIGTERM')) return
      killTimer = setTimeout(() => {
        signalChild(child, 'SIGKILL')
        child.unref()
        child.stdin.destroy()
        child.stdout.destroy()
        child.stderr.destroy()
        finish()
      }, graceMs)
    }

    children.add(record)
    child.once('error', () => {
      // Consumers can still observe the native error without an unhandled event.
    })
    child.stdin.on('error', () => {})
    child.stderr.resume()
    if (useProcessGroup) child.once('exit', terminate)
    child.once('close', () => {
      if (!killTimer || !useProcessGroup) {
        clearTimeout(killTimer)
        finish()
      }
    })
    signal?.addEventListener('abort', terminate, { once: true })
    return child
  }

  async function close() {
    closing = true
    const active = [...children]
    for (const child of active) child.terminate()
    await Promise.all(active.map(child => child.completion))
  }

  return { spawn, close }
}
