# SQLCipher Key Application via Native Buffer API

## Context
In `electron/db.ts`, the database encryption key was applied via PRAGMA string interpolation (`db.pragma("key = '${escapedKey}'")`). This pattern carries risk of string escaping bugs, null-byte truncation, and SQL injection edge cases.

## Decision
We pass the passphrase directly as a UTF-8 Buffer to the native `db.key(Buffer.from(key, 'utf8'))` method provided by `better-sqlite3-multiple-ciphers`.

## Considered Options
1. **Hex PRAGMA (`PRAGMA key = "x'...'"`):** Rejected. In SQLCipher, the `x'...'` literal specifies a raw 256-bit binary AES key, bypassing SQLCipher's internal PBKDF2 passphrase derivation. Switching to raw hex would make all existing user databases unreadable.
2. **`db.key(Buffer.from(key, 'utf8'))`:** Accepted. Directly invokes the underlying C API `sqlite3_key(db, buf, len)` with zero string escaping or SQL parsing, while retaining standard SQLCipher PBKDF2 passphrase derivation.

## Consequences
- 100% immune to SQL injection and string escaping anomalies.
- Full backward compatibility with existing encrypted databases.
