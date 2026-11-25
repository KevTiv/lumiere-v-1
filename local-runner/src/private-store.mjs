import { randomUUID } from 'node:crypto'
import {
  closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

export function privateDirectory(path) {
  const directory = resolve(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const status = lstatSync(directory)
  if (!status.isDirectory() || !isPrivate(status)) {
    throw new Error('runner state directory must be private and owned by the current user')
  }
  return directory
}

function isPrivate(status) {
  return process.platform === 'win32' ||
    ((status.mode & 0o077) === 0 && status.uid === process.getuid())
}

export function readPrivateJson(path, maxBytes) {
  let status
  try {
    status = lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
  if (!status.isFile() || !isPrivate(status) || status.size > maxBytes) {
    throw new Error('invalid runner state file')
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error('invalid runner state file')
  }
}

export function writePrivateJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    try {
      writeFileSync(fd, JSON.stringify(value))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, path)
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(path), 'r')
      try {
        fsyncSync(directory)
      } catch (error) {
        // Some filesystems support file fsync but refuse to sync directories.
        if (!['EINVAL', 'ENOTSUP'].includes(error.code)) throw error
      } finally {
        closeSync(directory)
      }
    }
  } finally {
    rmSync(temporary, { force: true })
  }
}

export async function lockState(directory) {
  const { DatabaseSync } = await import('node:sqlite')
  const database = new DatabaseSync(resolve(directory, 'runner-lock.sqlite'))
  try {
    // The operating system releases this SQLite lock after a crash or shutdown.
    database.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE')
  } catch (error) {
    database.close()
    if (error.errcode === 5) throw new Error('the runner state directory is already in use')
    throw error
  }
  return () => database.close()
}
