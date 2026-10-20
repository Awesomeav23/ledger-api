import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // A fixed port, so this app never collides with other Vite projects
    // (Vite's default is 5173). strictPort stops with an error instead of
    // silently switching to another port.
    port: 5180,
    strictPort: true,
    proxy: {
      // Forward /api/... requests to the local ledger API, removing the
      // /api prefix. For example, /api/accounts becomes
      // http://localhost:3010/accounts.
      '/api': {
        target: 'http://localhost:3010',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
