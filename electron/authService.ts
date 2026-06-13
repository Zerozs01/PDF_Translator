import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app, safeStorage } from 'electron';

export type AppMode = 'RELAX' | 'SECURITY';

export interface AuthConfig {
  masterHash: string;
  salt: string;
  emergencyPinHash: string;
  pinSalt: string;
  appMode: AppMode;
  encryptedMaster?: string; // Hex string from safeStorage.encryptString(password)
}

const CONFIG_FILE = 'authConfig.json';

// Get config path in app userData directory
export function getAuthConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

// Generate random salt
function generateSalt(length = 16): string {
  return crypto.randomBytes(length).toString('hex');
}

// PBKDF2 hash password
function hashPassword(password: string, salt: string): string {
  // Why PBKDF2 with 10,000 iterations: Strong enough for local offline auth,
  // fast enough to not cause noticeable lag on desktop startup (~50-100ms).
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

// Read config from disk
export function readAuthConfig(): AuthConfig | null {
  const configPath = getAuthConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(data) as AuthConfig;
  } catch (error) {
    console.error('[AuthService] Failed to read auth config:', error);
    return null;
  }
}

// Write config to disk
export function writeAuthConfig(config: AuthConfig): void {
  const configPath = getAuthConfigPath();
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.error('[AuthService] Failed to write auth config:', error);
    throw error;
  }
}

// Check if setup has been done
export function isSetup(): boolean {
  const config = readAuthConfig();
  return !!(config && config.masterHash && config.emergencyPinHash);
}

// Setup credentials (first time run)
export function setupCredentials(password: string, emergencyPin: string): boolean {
  if (isSetup()) {
    throw new Error('Application has already been configured.');
  }

  // Clear any existing legacy unencrypted database files
  // Why: SQLCipher will throw SQLITE_NOTADB if we try to apply a key to a plaintext database.
  // We must delete the unencrypted database file so SQLCipher can create a fresh encrypted one.
  const dbFile = path.join(app.getPath('userData'), 'pdf_translator.db');
  const dbWal = path.join(app.getPath('userData'), 'pdf_translator.db-wal');
  const dbShm = path.join(app.getPath('userData'), 'pdf_translator.db-shm');
  [dbFile, dbWal, dbShm].forEach((file) => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`[AuthService] Cleaned up legacy unencrypted database file: ${file}`);
      }
    } catch (err) {
      console.error(`[AuthService] Failed to clean up legacy file ${file}:`, err);
    }
  });

  const salt = generateSalt();
  const pinSalt = generateSalt();

  const masterHash = hashPassword(password, salt);
  const emergencyPinHash = hashPassword(emergencyPin, pinSalt);

  const config: AuthConfig = {
    masterHash,
    salt,
    emergencyPinHash,
    pinSalt,
    appMode: 'SECURITY', // Default to SECURITY mode on setup
  };

  writeAuthConfig(config);
  console.log('[AuthService] Credentials setup successfully.');
  return true;
}

// Verify master password
export function verifyMasterPassword(password: string): boolean {
  const config = readAuthConfig();
  if (!config) return false;

  const hash = hashPassword(password, config.salt);
  return hash === config.masterHash;
}

// Verify emergency PIN
export function verifyEmergencyPin(pin: string): boolean {
  const config = readAuthConfig();
  if (!config) return false;

  const hash = hashPassword(pin, config.pinSalt);
  return hash === config.emergencyPinHash;
}

// Get auto-login password if in RELAX mode
export function getAutoLoginPassword(): string | null {
  const config = readAuthConfig();
  if (!config || config.appMode !== 'RELAX' || !config.encryptedMaster) {
    return null;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[AuthService] safeStorage encryption not available on this platform.');
    return null;
  }

  try {
    const encryptedBuffer = Buffer.from(config.encryptedMaster, 'hex');
    return safeStorage.decryptString(encryptedBuffer);
  } catch (error) {
    console.error('[AuthService] Failed to decrypt auto-login password:', error);
    return null;
  }
}

// Set application security mode
export function setAppMode(mode: AppMode, password?: string): boolean {
  const config = readAuthConfig();
  if (!config) {
    throw new Error('Config not found. Please setup credentials first.');
  }

  if (mode === 'RELAX') {
    if (!password) {
      throw new Error('Password is required to switch to RELAX mode.');
    }
    // Verify first before encrypting
    if (!verifyMasterPassword(password)) {
      throw new Error('Invalid master password.');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS secure storage is not available on this platform.');
    }

    const encrypted = safeStorage.encryptString(password);
    config.encryptedMaster = encrypted.toString('hex');
    config.appMode = 'RELAX';
  } else {
    // SECURITY mode: destroy credentials in file
    delete config.encryptedMaster;
    config.appMode = 'SECURITY';
  }

  writeAuthConfig(config);
  console.log(`[AuthService] App mode updated to: ${mode}`);
  return true;
}

// Emergency reset: clean up all databases and configs
export function deleteAppDataFiles(): void {
  const dbFile = path.join(app.getPath('userData'), 'pdf_translator.db');
  const dbWal = path.join(app.getPath('userData'), 'pdf_translator.db-wal');
  const dbShm = path.join(app.getPath('userData'), 'pdf_translator.db-shm');
  const authConfigFile = getAuthConfigPath();
  const secureSettingsDir = path.join(app.getPath('userData'), 'secure-settings');

  const filesToDelete = [dbFile, dbWal, dbShm, authConfigFile];
  filesToDelete.forEach((file) => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`[AuthService] Emergency Reset deleted: ${file}`);
      }
    } catch (err) {
      console.error(`[AuthService] Failed to delete file ${file}:`, err);
    }
  });

  try {
    if (fs.existsSync(secureSettingsDir)) {
      fs.rmSync(secureSettingsDir, { recursive: true, force: true });
      console.log(`[AuthService] Emergency Reset deleted directory: ${secureSettingsDir}`);
    }
  } catch (err) {
    console.error(`[AuthService] Failed to delete directory ${secureSettingsDir}:`, err);
  }
}
