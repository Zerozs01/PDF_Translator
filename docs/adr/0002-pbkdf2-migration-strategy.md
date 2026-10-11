# PBKDF2 Iteration Upgrade and Lazy Migration

## Context
`electron/authService.ts` previously hardcoded PBKDF2 iterations to 1,000 using SHA-512, which is significantly below modern OWASP recommendations (100,000+). However, simply bumping the constant would invalidate the credentials of any user with an existing `authConfig.json`.

## Decision
1. Increase default PBKDF2 iterations to `100,000`.
2. Add optional `iterations?: number` and `pinIterations?: number` fields to `AuthConfig` to decouple credential migrations.
3. In `verifyMasterPassword(password)`, check `config.iterations ?? 1000`. If it matches and the iteration is less than `100,000`, immediately re-hash the master password with `100,000` iterations and a new salt, then persist the updated `AuthConfig`.
4. In `verifyEmergencyPin(pin)`, support independent migration: if verification with target iterations fails, fallback to `1,000` iterations. If legacy matches, re-hash with `100,000` iterations and record `config.pinIterations = 100,000`. This prevents lockout if master password was migrated first.
5. Use `crypto.timingSafeEqual` for all hash comparisons to eliminate timing attack vectors.

## Considered Options
1. **Forced Reset on Startup:** Rejected. Destructive to user workflows and requires resetting local databases or re-entering secrets.
2. **Lazy Rehash on Authentication:** Accepted. Seamless upgrade with zero user disruption and zero downtime.

## Consequences
- New setups immediately use 100,000 iterations.
- Existing installations seamlessly upgrade on their first successful login.
- Hash comparisons are constant-time.
