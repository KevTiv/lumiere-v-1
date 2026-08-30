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

/**
 * Local/dev fallback for Rust-owned generic ERP APIs. Production ingress sends
 * these prefixes directly to api-server, so they do not need Next route files.
 */
function rustApiRewrites() {
  const raw = process.env.LUMIERE_API_SERVER_URL?.trim() ?? ''
  if (!raw || raw === 'false' || raw === 'off') return []
  const base = raw.replace(/\/$/, '')
  return [
    {
      source: '/api/query/:path*',
      destination: `${base}/v1/query/:path*`,
    },
    {
      source: '/api/call/:path*',
      destination: `${base}/v1/call/:path*`,
    },
    {
      source: '/api/compat/reducer/:path*',
      destination: `${base}/v1/compat/reducer/:path*`,
    },
    {
      source: '/api/operations/:path*',
      destination: `${base}/v1/operations/:path*`,
    },
  ]
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [...rustApiRewrites(), ...posthogRewrites()]
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@lumiere/ui", "@lumiere/stdb"],
  // Force a single React instance across all workspace packages.
  // @react-three/fiber inside @lumiere/ui would otherwise resolve React from
  // packages/ui/node_modules, causing "ReactCurrentOwner" undefined errors.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    }
    return config
  },
  turbopack: {
    root: path.resolve(__dirname, '../..'),
    resolveAlias: {
      react: './frontend/web/node_modules/react',
      'react-dom': './frontend/web/node_modules/react-dom',
    },
  },
}

export default nextConfig
