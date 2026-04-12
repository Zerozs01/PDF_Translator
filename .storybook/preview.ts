import type { Preview } from '@storybook/react-vite'

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