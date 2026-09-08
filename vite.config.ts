/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import electron from 'vite-plugin-electron';

// https://vitejs.dev/config/
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  esbuild: {
    target: 'es2022'
  },
  worker: {
    format: 'es',
  },
  plugins: [react(), electron([{
    entry: 'electron/main.ts',
    vite: {
      define: {
        __DEV_PROJECT_ROOT__: JSON.stringify(dirname),
      },
      build: {
        rollupOptions: {
          external: ['better-sqlite3-multiple-ciphers']
        }
      }
    },
    onstart(options) {
      options.startup();
    }
  }, {
    entry: 'electron/preload.ts',
    onstart(options) {
      options.reload();
    }
  }])],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: path.resolve(dirname, 'index.html'),
        exportPrint: path.resolve(dirname, 'export-print.html'),
      },
      output: {
        manualChunks: {
          pdf: ['react-pdf', 'pdf-lib'],
          ui: ['lucide-react', 'zustand']
        }
      }
    }
  },
  test: {
    projects: [{
      extends: true,
      test: {
        name: 'unit',
        environment: 'node',
        include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
      }
    }, {
      extends: true,
      plugins: [
      // The plugin will run tests for the stories defined in your Storybook config
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook')
      })],
      test: {
        name: 'storybook',
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({}),
          instances: [{
            browser: 'chromium'
          }]
        },
        setupFiles: ['.storybook/vitest.setup.ts']
      }
    }],
    teardownTimeout: 10000,
    hookTimeout: 10000,
  }
});

