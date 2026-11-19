import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('.', import.meta.url))
const sharedPublic = fileURLToPath(new URL('./public', import.meta.url))

export default defineConfig({
  root: appRoot,
  plugins: [react()],
  publicDir: sharedPublic,
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
