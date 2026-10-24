import { defineConfig } from 'vite';

// `npm run site:dev` serves the landing page; `npm run site:build` writes a static site to site/dist
// with relative URLs, so it can be hosted from any path.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5178 },
});
