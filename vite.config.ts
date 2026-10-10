/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**', '**/target/**', '**/.data/**', '**/.venv-ocr/**'],
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'lucide-react',
      'zustand',
      '@tauri-apps/api/core',
    ],
  },
  esbuild: {
    target: 'es2022'
  },
  worker: {
    format: 'es',
  },
  plugins: [
    react()
  ],
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
        include: ['src/**/*.test.ts'],
      }
    }, {
      extends: true,
      plugins: [
        storybookTest({
          configDir: path.join(dirname, '.storybook')
        })
      ],
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
