import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run app:dev` serves the inbox on Vite and forwards API calls to the Seyrin server.
const SERVER = 'http://127.0.0.1:4477';

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5177,
    proxy: {
      '/v1': { target: SERVER, changeOrigin: true },
      '/health': { target: SERVER, changeOrigin: true },
      '/d': { target: SERVER, changeOrigin: true },
    },
  },
});
