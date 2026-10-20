// PROTOTYPE (throwaway): serves the Mission Control layout prototype (codeious/orca#13). Never built.
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const PAGE = '/mission-control-prototype.html'

const redirectRootToPrototype: Plugin = {
  name: 'mission-control-prototype-root',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/' || req.url?.startsWith('/?')) {
        res.statusCode = 302
        res.setHeader('Location', `${PAGE}${req.url.slice(1)}`)
        res.end()
        return
      }
      next()
    })
  }
}

export default defineConfig({
  root: resolve('src/renderer'),
  plugins: [react(), tailwindcss(), redirectRootToPrototype],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src')
    }
  },
  server: { host: '127.0.0.1', port: 5199 }
})
