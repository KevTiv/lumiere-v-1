import { type NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Only allow in dev environment
function isDev(req: NextRequest): boolean {
  const host = req.headers.get('host') ?? ''
  return (
    process.env.NODE_ENV === 'development' ||
    host.includes('localhost') ||
    host.includes('127.0.0.1')
  )
}

export async function GET(req: NextRequest) {
  if (!isDev(req)) {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const module = searchParams.get('module')
  const tail = Math.min(Number(searchParams.get('tail') ?? 50), 500)

  if (!module) {
    return NextResponse.json({ error: 'module param required' }, { status: 400 })
  }

  // Sanitize module name — only alphanumeric, hyphens, underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(module)) {
    return NextResponse.json({ error: 'Invalid module name' }, { status: 400 })
  }

  try {
    const { stdout, stderr } = await execAsync(
      `spacetime logs ${module} --num-lines ${tail}`,
      { timeout: 10_000 }
    )
    const raw = stdout || stderr
    const lines = raw.split('\n').filter(Boolean)
    return NextResponse.json({ lines, module, tail })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to run spacetime logs'
    // If spacetime is not found or the module doesn't exist, return a helpful error
    const lines = msg.split('\n').filter(Boolean)
    return NextResponse.json(
      { error: 'spacetime logs failed', details: msg, lines },
      { status: 502 }
    )
  }
}
