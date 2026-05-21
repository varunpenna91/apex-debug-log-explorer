import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          graph: ['@xyflow/react', '@dagrejs/dagre'],
          export: ['html-to-image'],
          icons: ['lucide-react']
        }
      }
    }
  },
  server: {
    port: 5173
  }
});
