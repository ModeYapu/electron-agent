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
    // Prefer VITE_API_URL / VITE_WS_URL env vars, but fall back to the WSL
    // host IP so the browser (running on Windows) can reach the relay-server
    // inside WSL.  "localhost" in the browser means Windows, not WSL.
    __API_URL__: JSON.stringify(env.VITE_API_URL || 'http://10.10.1.167:9300'),
    __WS_URL__:  JSON.stringify(env.VITE_WS_URL  || 'ws://10.10.1.167:9300/ws'),
  },
};});
