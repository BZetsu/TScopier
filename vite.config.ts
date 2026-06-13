import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'charts'
          }
          if (id.includes('node_modules/@supabase')) {
            return 'supabase'
          }
          if (
            id.includes('node_modules/react-dom')
            || id.includes('node_modules/react-router')
            || id.includes('node_modules/react/')
          ) {
            return 'vendor'
          }
        },
      },
    },
  },
})
