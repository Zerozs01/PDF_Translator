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
  iterations?: number;
  pinIterations?: number;
}

const CONFIG_FILE = 'authConfig.json';
export const DEFAULT_PBKDF2_ITERATIONS = 100_000;
export const LEGACY_PBKDF2_ITERATIONS = 1_000;

// Get config path in app userData directory
export function getAuthConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

// Generate random salt
function generateSalt(length = 16): string {
  return crypto.randomBytes(length).toString('hex');
}

// PBKDF2 hash password with configurable iterations
function hashPassword(password: string, salt: string, iterations: number = DEFAULT_PBKDF2_ITERATIONS): string {
  // Why PBKDF2 with 100,000 iterations: Complies with OWASP security guidelines while
  // remaining fast on modern desktop CPUs (~30-60ms) without noticeable startup lag.
  return crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
}

// Constant-time hex string comparison to eliminate timing attacks
function safeCompareHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
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

  const masterHash = hashPassword(password, salt, DEFAULT_PBKDF2_ITERATIONS);
  const emergencyPinHash = hashPassword(emergencyPin, pinSalt, DEFAULT_PBKDF2_ITERATIONS);

  const config: AuthConfig = {
    masterHash,
    salt,
    emergencyPinHash,
    pinSalt,
    appMode: 'SECURITY', // Default to SECURITY mode on setup
    iterations: DEFAULT_PBKDF2_ITERATIONS,
    pinIterations: DEFAULT_PBKDF2_ITERATIONS,
  };

  writeAuthConfig(config);
  console.log('[AuthService] Credentials setup successfully.');
  return true;
}

// Verify master password with lazy upgrade migration
export function verifyMasterPassword(password: string): boolean {
  const config = readAuthConfig();
  if (!config) return false;

  const currentIterations = config.iterations ?? LEGACY_PBKDF2_ITERATIONS;
  const hash = hashPassword(password, config.salt, currentIterations);
  const isValid = safeCompareHex(hash, config.masterHash);

  // Lazy migration: if authenticating with legacy iterations (<100,000), upgrade immediately
  if (isValid && currentIterations < DEFAULT_PBKDF2_ITERATIONS) {
    try {
      const newSalt = generateSalt();
      config.salt = newSalt;
      config.masterHash = hashPassword(password, newSalt, DEFAULT_PBKDF2_ITERATIONS);
      config.iterations = DEFAULT_PBKDF2_ITERATIONS;
      writeAuthConfig(config);
      console.log(`[AuthService] Successfully migrated master password to ${DEFAULT_PBKDF2_ITERATIONS} iterations.`);
    } catch (migErr) {
      console.error('[AuthService] Failed to auto-migrate master password hash:', migErr);
    }
  }

  return isValid;
}

// Verify emergency PIN with constant-time comparison, legacy fallback, and lazy upgrade migration
export function verifyEmergencyPin(pin: string): boolean {
  const config = readAuthConfig();
  if (!config) return false;

  // Why separate pinIterations: Master password and emergency PIN are migrated independently.
  // If master password migrated first, config.iterations becomes 100k while emergencyPinHash is still legacy 1k.
  const targetIterations = config.pinIterations ?? (config.iterations === DEFAULT_PBKDF2_ITERATIONS ? undefined : config.iterations) ?? DEFAULT_PBKDF2_ITERATIONS;
  let hash = hashPassword(pin, config.pinSalt, targetIterations);
  let isValid = safeCompareHex(hash, config.emergencyPinHash);

  // Fallback: If verification failed with targetIterations and target wasn't already legacy, test legacy iterations
  let matchedLegacy = false;
  if (!isValid && targetIterations !== LEGACY_PBKDF2_ITERATIONS) {
    const legacyHash = hashPassword(pin, config.pinSalt, LEGACY_PBKDF2_ITERATIONS);
    if (safeCompareHex(legacyHash, config.emergencyPinHash)) {
      isValid = true;
      matchedLegacy = true;
    }
  }

  // Lazy migration for emergency PIN
  if (isValid && (matchedLegacy || (config.pinIterations ?? LEGACY_PBKDF2_ITERATIONS) < DEFAULT_PBKDF2_ITERATIONS)) {
    try {
      const newPinSalt = generateSalt();
      config.pinSalt = newPinSalt;
      config.emergencyPinHash = hashPassword(pin, newPinSalt, DEFAULT_PBKDF2_ITERATIONS);
      config.pinIterations = DEFAULT_PBKDF2_ITERATIONS;
      writeAuthConfig(config);
      console.log(`[AuthService] Successfully migrated emergency PIN to ${DEFAULT_PBKDF2_ITERATIONS} iterations.`);
    } catch (migErr) {
      console.error('[AuthService] Failed to auto-migrate emergency PIN hash:', migErr);
    }
  }

  return isValid;
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
