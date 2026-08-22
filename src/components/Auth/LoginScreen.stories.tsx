import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { LoginScreen } from './LoginScreen';

const meta = {
  title: 'Auth/LoginScreen',
  component: LoginScreen,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof LoginScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <LoginScreen />,
};
