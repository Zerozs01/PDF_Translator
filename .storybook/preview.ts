import type { Preview } from '@storybook/react-vite'

// Provide a minimal Electron preload API stub for Storybook (browser environment)
declare global {
  interface Window {
    electronAPI?: any
  }
}

if (typeof window !== 'undefined' && !(window as any).electronAPI) {
  (window as any).electronAPI = {
    // common minimal stubs used by components during render
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    readFile: async (_path: string) => null,
    writeFile: async (_path: string, _data: any) => true,
    getAppPath: () => '/',
    // extend as-needed when runtime errors point to missing methods
  }
}

import '../src/index.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo'
    },

    backgrounds: {
      default: 'workspace-shell',
      values: [
        { name: 'home-shell', value: '#17181b' },
        { name: 'workspace-shell', value: '#0b0f16' },
        { name: 'canvas-mid', value: '#313741' },
      ],
    },
  },
};

export default preview;