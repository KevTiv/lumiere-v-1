/**
 * First-tenant bootstrap: calls `bootstrap_new_tenant` with the caller's SpacetimeDB token.
 * Unlike `/api/call/*`, this route does not require an existing `organizationId`.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveApiSession } from '@/lib/api-session'
import { callReducer } from '@/lib/stdb-reducer'

const settingsSchema = z.object({
  moduleConfig: z.string().optional().nullable(),
  featureFlags: z.array(z.string()),
  integrationKeys: z.string().optional().nullable(),
  metadata: z.string().optional().nullable(),
})

const organizationSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  timezone: z.string().min(1),
  dateFormat: z.string().min(1),
  language: z.string().min(1),
  isActive: z.boolean(),
  description: z.string().optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  currencyId: z.number().optional().nullable(),
  metadata: z.string().optional().nullable(),
})

const bodySchema = z.object({
  organization: organizationSchema,
  defaultCompanyName: z.string().min(1),
  defaultCompanyCode: z.string().min(1),
  /** ISO 4217; must exist in global `currency` table. */
  defaultCompanyCurrencyCode: z.string().min(3).max(3),
  fiscalYearEndMonth: z.number().int().min(1).max(12),
  fiscalYearEndDay: z.number().int().min(1).max(31),
  seedFormConfigs: z.boolean(),
  settings: settingsSchema,
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await resolveApiSession(request)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.identityHex === 'unknown') {
    return NextResponse.json({ error: 'Identity not resolved' }, { status: 401 })
  }
  if (session.organizationId != null) {
    return NextResponse.json(
      { error: 'Already belongs to an organization' },
      { status: 409 },
    )
  }

  let parsed: z.infer<typeof bodySchema>
  try {
    const json = await request.json()
    parsed = bodySchema.parse(json)
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors[0]?.message ?? 'Invalid body' : 'Invalid JSON'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const args = [
    {
      organization: parsed.organization,
      defaultCompanyName: parsed.defaultCompanyName,
      defaultCompanyCode: parsed.defaultCompanyCode,
      defaultCompanyCurrencyCode: parsed.defaultCompanyCurrencyCode.toUpperCase(),
      fiscalYearEndMonth: parsed.fiscalYearEndMonth,
      fiscalYearEndDay: parsed.fiscalYearEndDay,
      seedFormConfigs: parsed.seedFormConfigs,
      settings: {
        moduleConfig: parsed.settings.moduleConfig ?? null,
        featureFlags: parsed.settings.featureFlags,
        integrationKeys: parsed.settings.integrationKeys ?? null,
        metadata: parsed.settings.metadata ?? null,
      },
    },
  ]

  const moduleName =
    process.env.STDB_MODULE ?? process.env.NEXT_PUBLIC_STDB_MODULE ?? 'lumiere-v1-j1uo0'
  const hostRaw = process.env.STDB_HOST ?? process.env.NEXT_PUBLIC_STDB_HOST

  try {
    await callReducer('bootstrap_new_tenant', args, {
      ...session.opts,
      module: moduleName,
      ...(hostRaw ? { host: hostRaw } : {}),
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bootstrap failed'
    console.error('[bootstrap/tenant]', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
