import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const webRoot = path.resolve(import.meta.dirname, '..')

const files = execSync('git ls-files', { cwd: webRoot, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((f) => /\.(ts|tsx)$/.test(f))

for (const rel of files) {
  const file = path.join(webRoot, rel)
  if (!fs.existsSync(file)) continue
  let s = fs.readFileSync(file, 'utf8')
  if (!s.includes('apiFetch(')) continue

  if (/from ['"]\.?\.\/api-fetch['"]/.test(s)) continue

  if (
    /import\s*\{[^}]*\bapiFetch\b[^}]*\}\s*from\s*['"]@\/lib\/(api-fetch|query-fetch)['"]/.test(
      s,
    )
  ) {
    continue
  }

  const qfImport = s.match(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/query-fetch['"]/)
  if (qfImport && !/\bapiFetch\b/.test(qfImport[1])) {
    const inner = qfImport[1].trim().replace(/\s+/g, ' ')
    s = s.replace(qfImport[0], `import { apiFetch, ${inner} } from '@/lib/query-fetch'`)
    fs.writeFileSync(file, s)
    console.log('extended query-fetch import', rel)
    continue
  }

  const lines = s.split('\n')
  let insertAt = 0
  if (lines[0] === '"use client"' || lines[0] === "'use client'") {
    insertAt = 1
    if (lines[insertAt] === '') insertAt = 2
  }
  lines.splice(insertAt, 0, "import { apiFetch } from '@/lib/api-fetch'")
  fs.writeFileSync(file, lines.join('\n'))
  console.log('added api-fetch import', rel)
}
