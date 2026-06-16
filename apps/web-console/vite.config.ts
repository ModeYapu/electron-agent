import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
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
    __API_URL__: JSON.stringify(env.VITE_API_URL || ''),
    __WS_URL__: JSON.stringify(env.VITE_WS_URL || ''),
  },
};});
