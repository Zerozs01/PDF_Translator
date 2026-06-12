import { create } from 'zustand';


export interface AuthState {
  isUnlocked: boolean;
  isSetup: boolean;
  appMode: 'RELAX' | 'SECURITY';
  isLoading: boolean;
  error: string | null;
  
  checkStatus: () => Promise<void>;
  setup: (password: string, emergencyPin: string) => Promise<boolean>;
  login: (password: string) => Promise<boolean>;
  autoLogin: () => Promise<boolean>;
  hardReset: (emergencyPin: string) => Promise<boolean>;
  setMode: (mode: 'RELAX' | 'SECURITY', password?: string) => Promise<boolean>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isUnlocked: false,
  isSetup: false,
  appMode: 'SECURITY',
  isLoading: true,
  error: null,

  checkStatus: async () => {
    set({ isLoading: true, error: null });
    try {
      const { isSetup, mode } = await window.electronAPI.auth.checkStatus();
      set({ isSetup, appMode: mode, isLoading: false });
    } catch (err: any) {
      console.error('[AuthStore] checkStatus failed:', err);
      set({ error: 'Failed to communicate with authentication service', isLoading: false });
    }
  },

  setup: async (password: string, emergencyPin: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await window.electronAPI.auth.setup({ password, emergencyPin });
      if (res.success) {
        set({ isUnlocked: true, isSetup: true, appMode: 'SECURITY', isLoading: false });
        return true;
      } else {
        set({ error: res.error || 'Failed to setup credentials', isLoading: false });
        return false;
      }
    } catch (err: any) {
      console.error('[AuthStore] setup failed:', err);
      set({ error: err.message || 'Setup encountered an error', isLoading: false });
      return false;
    }
  },

  login: async (password: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await window.electronAPI.auth.login({ password });
      if (res.success) {
        set({ isUnlocked: true, isLoading: false });
        return true;
      } else {
        set({ error: res.error || 'Invalid master password', isLoading: false });
        return false;
      }
    } catch (err: any) {
      console.error('[AuthStore] login failed:', err);
      set({ error: err.message || 'Login encountered an error', isLoading: false });
      return false;
    }
  },

  autoLogin: async () => {
    // Attempt auto-login if Relax mode is set
    set({ isLoading: true, error: null });
    try {
      const status = await window.electronAPI.auth.checkStatus();
      if (!status.isSetup) {
        set({ isSetup: false, isLoading: false });
        return false;
      }
      
      set({ isSetup: true, appMode: status.mode });
      
      if (status.mode === 'RELAX') {
        const res = await window.electronAPI.auth.autoLogin();
        if (res.success) {
          set({ isUnlocked: true, isLoading: false });
          return true;
        }
      }
      set({ isLoading: false });
      return false;
    } catch (err: any) {
      console.error('[AuthStore] autoLogin failed:', err);
      set({ isLoading: false });
      return false;
    }
  },

  hardReset: async (emergencyPin: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await window.electronAPI.auth.hardReset({ emergencyPin });
      if (res.success) {
        // App will relaunch, so local state will be destroyed anyway
        set({ isUnlocked: false, isSetup: false, isLoading: false });
        return true;
      } else {
        set({ error: res.error || 'Invalid Emergency PIN', isLoading: false });
        return false;
      }
    } catch (err: any) {
      console.error('[AuthStore] hardReset failed:', err);
      set({ error: err.message || 'Hard reset encountered an error', isLoading: false });
      return false;
    }
  },

  setMode: async (mode: 'RELAX' | 'SECURITY', password?: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await window.electronAPI.auth.setMode({ mode, password });
      if (res.success) {
        set({ appMode: mode, isLoading: false });
        return true;
      } else {
        set({ error: res.error || 'Failed to change security mode', isLoading: false });
        return false;
      }
    } catch (err: any) {
      console.error('[AuthStore] setMode failed:', err);
      set({ error: err.message || 'Error changing security mode', isLoading: false });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));
