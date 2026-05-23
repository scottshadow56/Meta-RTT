import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    base: process.env.BASE_PATH || './',
    server: {
      host: '0.0.0.0', // This is often necessary for Replit to work correctly
      allowedHosts: [
        context-rrt-production.up.railway.app,
      ]
    },
  };
});
