import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: path.resolve(__dirname, 'src', 'renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src', 'renderer', 'src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '.vite', 'renderer', 'main_window'),
    emptyOutDir: true,
  },
});
