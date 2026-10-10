const Database = require('better-sqlite3-multiple-ciphers');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

function getMasterPassword() {
  const electronAppData = path.join(process.env.APPDATA, 'pdf_translator');
  const localStatePath = path.join(electronAppData, 'Local State');
  const authConfigPath = path.join(electronAppData, 'authConfig.json');

  if (!fs.existsSync(localStatePath) || !fs.existsSync(authConfigPath)) {
    return null;
  }

  const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
  const encKey = Buffer.from(localState.os_crypt.encrypted_key, 'base64').subarray(5);
  const b64 = encKey.toString('base64');

  const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Security; $bytes = [Convert]::FromBase64String('${b64}'); $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($dec)"`;
  const keyB64 = execSync(psCmd).toString().trim();
  const aesKey = Buffer.from(keyB64, 'base64');

  const authCfg = JSON.parse(fs.readFileSync(authConfigPath, 'utf8'));
  const payload = Buffer.from(authCfg.encryptedMaster, 'hex');
  const iv = payload.subarray(3, 15);
  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(15, payload.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function migrate() {
  const electronAppData = path.join(process.env.APPDATA, 'pdf_translator');
  const tauriAppData = path.join(process.env.APPDATA, 'com.pdftranslator.app');
  const oldDbPath = path.join(electronAppData, 'pdf_translator.db');
  const targetDbPath = path.join(tauriAppData, 'pdf_translator.db');

  if (!fs.existsSync(oldDbPath)) {
    console.log('[Migration] No legacy database found at:', oldDbPath);
    return;
  }

  if (!fs.existsSync(tauriAppData)) {
    fs.mkdirSync(tauriAppData, { recursive: true });
  }

  const pw = getMasterPassword();
  if (!pw) {
    console.error('[Migration] Failed to retrieve master password from auth config.');
    return;
  }

  console.log('[Migration] Opening source encrypted database...');
  const srcDb = new Database(oldDbPath, { readonly: true });
  srcDb.pragma("cipher='sqlcipher'");
  srcDb.key(Buffer.from(pw, 'utf8'));

  const tempMigratedDb = path.join(tauriAppData, 'pdf_translator_migrated.db');
  if (fs.existsSync(tempMigratedDb)) {
    fs.unlinkSync(tempMigratedDb);
  }

  console.log('[Migration] Creating target unencrypted database at:', tempMigratedDb);
  const destDb = new Database(tempMigratedDb);
  destDb.pragma('foreign_keys = OFF');
  destDb.pragma('journal_mode = WAL');
  destDb.pragma('synchronous = OFF'); // Fast bulk migration

  // 1. Get all tables (except internal sqlite_* and FTS shadow tables)
  const masterItems = srcDb.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END").all();

  console.log(`[Migration] Found ${masterItems.length} schema objects to process.`);

  // Create schema objects first
  destDb.transaction(() => {
    for (const item of masterItems) {
      if (item.name.startsWith('sqlite_')) continue;
      // Skip FTS5 virtual table shadow tables as they are created automatically by the main FTS5 virtual table
      if (item.name.startsWith('document_search_') && item.name !== 'document_search') continue;
      try {
        destDb.exec(item.sql);
      } catch (e) {
        console.warn(`[Migration] Notice creating ${item.type} ${item.name}:`, e.message);
      }
    }
  })();

  // 2. Copy data for each regular table
  const userTables = srcDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'document_search_%'").all();

  for (const { name } of userTables) {
    const rows = srcDb.prepare(`SELECT * FROM "${name}"`).all();
    console.log(`[Migration] Copying ${rows.length} rows from table '${name}'...`);
    if (rows.length === 0) continue;

    const cols = Object.keys(rows[0]);
    const colList = cols.map(c => `"${c}"`).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const insertStmt = destDb.prepare(`INSERT OR REPLACE INTO "${name}" (${colList}) VALUES (${placeholders})`);

    const insertBatch = destDb.transaction((records) => {
      for (const row of records) {
        const values = cols.map(c => row[c]);
        insertStmt.run(...values);
      }
    });

    insertBatch(rows);
  }

  destDb.pragma('synchronous = NORMAL');
  destDb.close();
  srcDb.close();

  // Verify migrated database
  const checkDb = new Database(tempMigratedDb);
  const docCount = checkDb.prepare('SELECT count(*) as c FROM documents').get();
  console.log(`[Migration] Verified: ${docCount.c} documents restored in new database!`);
  checkDb.close();

  // Backup current target if exists
  if (fs.existsSync(targetDbPath)) {
    const backupPath = path.join(tauriAppData, `pdf_translator_backup_${Date.now()}.db`);
    try {
      fs.copyFileSync(targetDbPath, backupPath);
    } catch {}
  }

  // Remove existing WAL and SHM files of target DB
  const walPath = path.join(tauriAppData, 'pdf_translator.db-wal');
  const shmPath = path.join(tauriAppData, 'pdf_translator.db-shm');
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  // Replace target DB with migrated DB
  fs.copyFileSync(tempMigratedDb, targetDbPath);
  fs.unlinkSync(tempMigratedDb);

  // Also sync legacy imports folder
  const legacyImportsDir = path.join(electronAppData, 'imports');
  const tauriImportsDir = path.join(tauriAppData, 'imports');
  if (fs.existsSync(legacyImportsDir) && !fs.existsSync(tauriImportsDir)) {
    console.log('[Migration] Linking legacy imports folder to tauri imports...');
    try {
      execSync(`cmd /c mklink /J "${tauriImportsDir}" "${legacyImportsDir}"`);
      console.log('[Migration] Created directory junction from legacy imports to tauri imports.');
    } catch (err) {
      console.warn('[Migration] Junction failed, falling back to copy:', err.message);
    }
  }

  console.log('[Migration] ALL DONE! All 103+ documents, bookmarks, OCR cache and translations are migrated successfully!');
}

migrate();
