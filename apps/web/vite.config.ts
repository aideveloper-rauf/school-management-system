import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base lets the static build live in any cPanel folder or subdomain.
  base: './',
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
