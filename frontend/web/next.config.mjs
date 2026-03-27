import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
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
      react: './node_modules/react',
      'react-dom': './node_modules/react-dom',
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
