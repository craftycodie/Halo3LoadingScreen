import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages project site: set BASE_PATH=/RepoName/ in CI.
  base: process.env.BASE_PATH || '/',
  root: '.',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2022',
  },
});
