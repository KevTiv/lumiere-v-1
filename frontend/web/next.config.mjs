import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Reverse-proxy PostHog ingestion + asset CDN (must match `NEXT_PUBLIC_POSTHOG_HOST` region). */
function posthogRewrites() {
  const apiHost = (
    process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'
  ).replace(/\/$/, '')
  const assetsHost = (
    process.env.NEXT_PUBLIC_POSTHOG_ASSETS_HOST ??
    (apiHost.includes('us.i.posthog')
      ? 'https://us-assets.i.posthog.com'
      : 'https://eu-assets.i.posthog.com')
  ).replace(/\/$/, '')

  return [
    {
      source: '/ingest/static/:path*',
      destination: `${assetsHost}/static/:path*`,
    },
    {
      source: '/ingest/array/:path*',
      destination: `${assetsHost}/array/:path*`,
    },
    {
      source: '/ingest/:path*',
      destination: `${apiHost}/:path*`,
    },
  ]
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Keep workspace packages imported by the web app inside the standalone
  // server bundle. The release workflow copies this traced tree verbatim.
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  skipTrailingSlashRedirect: true,
  async headers() {
    return [{
      source: '/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
    }]
  },
  async rewrites() {
    return posthogRewrites()
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@lumiere/ui", "@lumiere/stdb", "@lumiere/presentation-core"],
  // Next owns React aliases for each rendering layer. Pointing them at the
  // workspace package splits React from Next's server renderer during prerender.
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
}

export default nextConfig
