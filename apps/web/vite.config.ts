/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// The triple-slash reference directive at the top enables type-checking for
// the `test` key (added by Vitest's ambient module augmentation) while avoiding
// import conflicts between vitest's bundled vite@5 and this workspace's vite@8.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
  },
})
