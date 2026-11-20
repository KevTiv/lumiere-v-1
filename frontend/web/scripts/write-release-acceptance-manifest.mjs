import { writeFile } from 'node:fs/promises'

const [path, sha] = process.argv.slice(2)
if (!path || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
  throw new Error('provide the release manifest path and verified lowercase commit SHA')
}
await writeFile(path, JSON.stringify({ releaseSha: sha, builtAt: new Date().toISOString() }) + '\n')
