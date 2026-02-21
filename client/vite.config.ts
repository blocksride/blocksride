import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    exclude: ['@phosphor-icons/webcomponents'],
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      external: [/^@phosphor-icons\/webcomponents/],
      output: {





      },
    },
  },
  plugins: [
    react(),
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
  ],
  server: {
    proxy: {
      '/coingecko': {
        target: 'https://api.coingecko.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/coingecko/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: 'buffer/',
    },
  },
})
