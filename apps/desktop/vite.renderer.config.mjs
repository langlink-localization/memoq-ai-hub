import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws:"
].join('; ');

// The CSP is injected only into production builds: dev mode relies on the Vite
// dev server origin and React Refresh inline scripts, which a strict CSP breaks.
function productionCspPlugin() {
  return {
    name: 'memoq-renderer-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${RENDERER_CSP}">`
      );
    }
  };
}

export const rendererProductionCsp = {
  pluginName: 'memoq-renderer-production-csp',
  csp: RENDERER_CSP
};

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src', 'renderer'),
  plugins: [react(), productionCspPlugin()],
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
