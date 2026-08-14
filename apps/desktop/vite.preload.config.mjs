import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

export default defineConfig({
  build: {
    rolldownOptions: {
      external: ['electron', ...builtinModules],
    },
  },
});
