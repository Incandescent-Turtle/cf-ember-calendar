/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { resolve, normalize, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// Dev only: serve /dev-data/* from the pipeline output (EMBER_DEV_DATA_DIR, default ../data/processed),
// falling back to ./mock-data (scripts/make_mock_data.ts) for files the pipeline hasn't written yet
// (e.g. calibration.json before S3). Not part of the production build — the deployed app is static.
function devData(): Plugin {
  const roots = [
    resolve(process.env.EMBER_DEV_DATA_DIR ?? resolve(import.meta.dirname, '../data/processed')),
    resolve(import.meta.dirname, 'mock-data'),
  ]
  return {
    name: 'ember-dev-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev-data', (req, res) => {
        const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^[\\/]+/, '')
        for (const root of roots) {
          const file = resolve(root, rel)
          if (!file.startsWith(root + sep)) continue
          if (existsSync(file) && statSync(file).isFile()) {
            res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream')
            res.setHeader('Content-Length', String(statSync(file).size))
            res.setHeader('X-Ember-Source', root.endsWith('mock-data') ? 'mock' : 'pipeline')
            createReadStream(file).pipe(res)
            return
          }
        }
        res.statusCode = 404
        res.end('not found')
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devData()],
  worker: { format: 'es' },
  // maplibre-gl 6 loads dist/maplibre-gl-worker.mjs via new URL(…, import.meta.url); pre-bundling breaks that path
  optimizeDeps: { exclude: ['maplibre-gl'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
