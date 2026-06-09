import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // better-sqlite3 / xlsx are native or node-only and must stay external
    plugins: [externalizeDepsPlugin()],
    build: {
      watch: {}
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      watch: {}
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: false,
      hmr: {
        protocol: 'ws',
        host: '127.0.0.1'
      }
    }
  }
})
