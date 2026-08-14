import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src', 'renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src', 'renderer', 'src'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '.vite', 'renderer', 'main_window'),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'ui-vendor',
              test: /node_modules[\\/](?:@ant-design[\\/]icons|antd|dayjs|react|react-dom)(?:[\\/]|$)/,
            },
          ],
        },
      }
    }
  },
});
