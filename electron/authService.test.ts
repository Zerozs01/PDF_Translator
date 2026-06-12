import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock electron before importing authService
vi.mock('electron', () => {
  const mockPath = path.resolve('./scratch/test-userData-dir');
  return {
    app: {
      getPath: vi.fn(() => mockPath),
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((str) => Buffer.from(`enc:${str}`)),
      decryptString: vi.fn((buf) => buf.toString().replace('enc:', '')),
    }
  };
});

import * as authService from './authService';

describe('AuthService Tests', () => {
  const testDir = path.resolve('./scratch/test-userData-dir');

  beforeEach(() => {
    // Ensure test directory exists
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory files
    try {
      const configPath = path.join(testDir, 'authConfig.json');
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (err) {
      // Ignore cleanup issues
    }
  });

  it('should report isSetup as false initially', () => {
    expect(authService.isSetup()).toBe(false);
  });

  it('should setup credentials successfully', () => {
    const success = authService.setupCredentials('mySecurePassword123', '9999');
    expect(success).toBe(true);
    expect(authService.isSetup()).toBe(true);
  });

  it('should verify master password correctly', () => {
    authService.setupCredentials('passwordA', '1234');
    expect(authService.verifyMasterPassword('passwordA')).toBe(true);
    expect(authService.verifyMasterPassword('passwordB')).toBe(false);
  });

  it('should verify emergency PIN correctly', () => {
    authService.setupCredentials('passwordA', '1234');
    expect(authService.verifyEmergencyPin('1234')).toBe(true);
    expect(authService.verifyEmergencyPin('9999')).toBe(false);
  });

  it('should handle Relax/Security mode toggle and auto-login', () => {
    authService.setupCredentials('passwordA', '1234');
    
    // Default mode should be SECURITY
    const config = authService.readAuthConfig();
    expect(config?.appMode).toBe('SECURITY');
    expect(authService.getAutoLoginPassword()).toBeNull();

    // Switch to RELAX mode (requires password)
    authService.setAppMode('RELAX', 'passwordA');
    const relaxConfig = authService.readAuthConfig();
    expect(relaxConfig?.appMode).toBe('RELAX');
    expect(relaxConfig?.encryptedMaster).toBeDefined();

    // Verify auto-login retrieves original password
    expect(authService.getAutoLoginPassword()).toBe('passwordA');

    // Switch back to SECURITY mode
    authService.setAppMode('SECURITY');
    const secConfig = authService.readAuthConfig();
    expect(secConfig?.appMode).toBe('SECURITY');
    expect(secConfig?.encryptedMaster).toBeUndefined();
    expect(authService.getAutoLoginPassword()).toBeNull();
  });
});
