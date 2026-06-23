import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
  appType: 'spa',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:9300',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:9300',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  define: {
    // Default: empty strings = relative paths (for nginx-proxied production).
    // Override with VITE_API_URL / VITE_WS_URL for local WSL dev.
    __API_URL__: JSON.stringify(env.VITE_API_URL ?? ''),
    __WS_URL__:  JSON.stringify(env.VITE_WS_URL  ?? '/ws'),
  },
};});
