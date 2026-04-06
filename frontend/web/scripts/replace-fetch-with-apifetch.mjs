import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const webRoot = path.resolve(import.meta.dirname, '..')

/** Paths under frontend/web tracked by git */
const tracked = execSync('git ls-files', {
  cwd: webRoot,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((f) => /\.(ts|tsx)$/.test(f))

const replacers = [
  [/\bfetch\s*\(\s*'\/api\//g, "apiFetch('/api/"],
  [/\bfetch\s*\(\s*"\/api\//g, 'apiFetch("/api/'],
  [/\bfetch\s*\(\s*`\/api\//g, 'apiFetch(`/api/'],
]

for (const rel of tracked) {
  const file = path.join(webRoot, rel)
  if (!fs.existsSync(file)) continue
  let s = fs.readFileSync(file, 'utf8')
  if (!s.includes('/api/')) continue
  let n = s
  for (const [re, to] of replacers) {
    n = n.replace(re, to)
  }
  if (n !== s) {
    fs.writeFileSync(file, n)
    console.log('patched', rel)
  }
}
