import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Keep workspace packages imported by the web app inside the standalone
  // server bundle. The release workflow copies this traced tree verbatim.
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  experimental: {
    // Preserve the base64 JSON body of a bounded 20 MB chat import through AuthKit proxying.
    proxyClientMaxBodySize: '28mb',
    // Next 16.1 requires opt-in to write the compiler cache restored by Actions.
    turbopackFileSystemCacheForBuild: process.env.GITHUB_ACTIONS === 'true',
  },
  skipTrailingSlashRedirect: true,
  async headers() {
    return [{
      source: '/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
    }]
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
