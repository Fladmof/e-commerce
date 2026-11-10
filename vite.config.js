import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]

  return {
    base: process.env.GITHUB_ACTIONS === 'true' && repository ? `/${repository}/` : '/',
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: env.API_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true
        },
        '/uploads': {
          target: env.API_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true
        }
      }
    },
    preview: {
      host: '0.0.0.0',
      port: 4173
    }
  }
})
