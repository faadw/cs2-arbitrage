import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy the serverless function endpoints in dev — mimics how Vercel runs them in production
      '/api/steam-search': {
        target: 'https://steamcommunity.com',
        changeOrigin: true,
        rewrite: (path) => {
          const url = new URL(path, 'http://localhost');
          const query = url.searchParams.get('query') || '';
          return `/market/search/render/?query=${query}&start=0&count=5&search_descriptions=0&sort_column=popular&sort_dir=desc&appid=730&norender=1`;
        },
      },
      '/api/steam-price': {
        target: 'https://steamcommunity.com',
        changeOrigin: true,
        rewrite: (path) => {
          const url = new URL(path, 'http://localhost');
          const hashName = url.searchParams.get('hash_name') || '';
          return `/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(hashName)}`;
        },
      },
    },
  },
})

