# Password Hashing v4 — Design

Status: implemented in this branch. This document is the reference for the
format, the pepper rotation procedure, and the migration semantics that the
code and tests encode.

## Goals and threat model

The deployment stores the password hash, the session version, and (historically)
the session secret in the same D1 database. PBKDF2 protects the hash from
offline cracking, but a D1-only leak still lets an attacker attack the password
at the stored work factor. A **pepper** — a secret held in Workers Secrets, never
in D1 — removes that path: without it, the leaked hash cannot be verified at
all, regardless of password strength or work factor.

Secondary goal: raise the PBKDF2 work factor from 25,000 toward the workerd
hard limit.

## Formats

| Version | Value | Notes |
|---|---|---|
| v1 | bare SHA-256 hex | legacy; verify only, migrate on login |
| v2 | `v2:<saltHex32>:<hashHex64>` | legacy PBKDF2@100,000; verify only, migrate on login |
| v3 | `v3:<iterations>:<saltHex32>:<hashHex64>` | current stored format since 1.1.0 |
| v4 | `v4:<pepperId>:<iterations>:<saltHex32>:<hashHex64>` | this change |

Derivation for v4 is PBKDF2-SHA256 over `<password>:<pepperMaterial>` with a
fresh 16-byte salt and a 256-bit output — the same primitive as v3, with the
pepper appended to the key material. The colon separator prevents ambiguity
between password and pepper.

### Work factor

All new hashes (v3 and v4) use `PASSWORD_HASH_ITERATIONS = 90,000`.

Measured in workerd via vitest-pool-workers on the reference dev machine:
25k = 5 ms, 50k = 11 ms, 90k = 15 ms, 100k = 17 ms. Production workerd already
ran 100,000 iterations at every login for the v2 era, so 90,000 is a proven
operating point, and it keeps 10% headroom below the workerd rejection limit
(cloudflare/workerd#1346). Login is a rate-limited, per-attempt cost (5/min/IP),
not a hot path. The constant is safe to raise in a future release without a
migration: the format stores explicit iterations and verification uses the
stored value.

## Pepper secrets

| Secret | Meaning |
|---|---|
| `PASSWORD_PEPPER` | current pepper; all new v4 hashes reference its id |
| `PASSWORD_PEPPER_PREVIOUS` | optional; lets logins verify hashes written before a rotation until they are re-hashed |

A pepper secret value is `<id>:<material>` (split on the **first** colon):

- `id`: 1–16 characters, `[A-Za-z0-9]`. Must be **unique per rotation**. It is
  stored inside every v4 hash in D1 (ids are not secret).
- `material`: at least 32 characters of entropy, recommend
  `openssl rand -base64 32`. Never stored in D1.

Example: `PASSWORD_PEPPER=k1:hfG3...base64...=`.

A malformed value (no colon, bad id, short material) is treated as absent, with
a `console.warn` at use time. We deliberately do not 500 on a bad pepper: the
operator keeps a working (v3) login path and sees the warning, instead of
losing the admin session to a typo.

### Verification and rotation

To verify a stored v4 hash, the id is resolved against `PASSWORD_PEPPER` first,
then `PASSWORD_PEPPER_PREVIOUS`. An id that resolves to neither makes
verification fail closed — the login returns 401 like a wrong password. There
is no fallback: correctness of the supplied password cannot be established
without its pepper.

Rotation procedure (single-admin deployment, zero downtime):

1. Generate a fresh id and material: `k2:$(openssl rand -base64 32)`.
2. `npx wrangler secret put PASSWORD_PEPPER` → the new full value.
3. `npx wrangler secret put PASSWORD_PEPPER_PREVIOUS` → the **previous** full
   value (`k1:...`).
4. Log in once. The successful login re-hashes the stored hash to `k2`.
5. After that login, `PASSWORD_PEPPER_PREVIOUS` can be removed.

Rules that keep this safe:

- Never change the material while keeping an id, and never reuse an id.
- Removing `PASSWORD_PEPPER` while v4 hashes exist locks the account (fail
  closed); recovery is the documented password reset path (delete the
  `password` settings row, redeploy with `INITIAL_ADMIN_PASSWORD`).
- If the pepper material is ever lost without rotation, that password is lost:
  the reset path above is the only recovery. This is the trade that makes D1-only
  leaks useless to an attacker.

## Login-time migration

On **successful** verification only (a failed attempt never rewrites anything),
the stored hash is upgraded to the best available format for the current
configuration:

| Configured pepper | Stored hash | Upgrade target |
|---|---|---|
| yes | v4 (current id, current iterations) | none — already current |
| yes | v4 (old id) / v3 / v2 / v1 | `v4:<current id>:<90k>:...` |
| no | v3 @ 90,000 | none — already current |
| no | v3 @ lower / v2 / v1 | `v3:90000:...` |

The upgrade is a single conditional write,
`UPDATE settings SET value = ? WHERE key = 'password' AND value = <expected>`,
so a concurrent credential change (or a concurrent migration) is detected by
`changes = 0` and never overwritten. Outcomes are handled per format:

- `changes = 0` on a **v1/v2** login aborts the login with 401. For legacy
  formats the conditional write doubles as the concurrent-credential check;
  this preserves the established behavior tested in `password2.suite.ts`.
- `changes = 0` on a **v3/v4** login is ignored for the session decision — the
  credential was verified against the value read at the start of the request,
  and real credential changes also rotate the session version, which
  `setAuthCookie` re-checks.
- A storage error during the upgrade write is logged and swallowed on every
  format: the login proceeds with the old hash retained and the next login
  retries the upgrade. A migration must never be the reason a correct password
  is rejected.

The order inside the login handler is: verify → (if needed) conditional upgrade
→ issue cookie. The upgrade derive therefore happens before the cookie is
issued, exactly like the legacy v1/v2 path it replaces; its cost is bounded by
the 90k benchmark above and is skipped entirely on already-current hashes.

## Create paths

Every path that writes a fresh hash uses one helper,
`createPasswordHash(env, password)`: v4 with the current pepper when configured,
otherwise v3 at the current work factor. Covered paths: initial admin creation
(init middleware), initial password creation inside the login handler, legacy
default-password replacement (init middleware), and `PUT /api/settings`.

## Test coverage

- v4 format parse/format/validation, pepper resolution and invalid-value handling
- login with pepper creates v4; wrong pepper id fails closed; rotation via
  `PASSWORD_PEPPER_PREVIOUS` verifies and re-hashes to the current id
- v3 → v4 login migration (hash replaced, `migrated: true`), v3 → v3@90k when
  no pepper is configured
- v1/v2 legacy migrations keep their concurrency-abort semantics
- storage failure during the migration write does not fail the login
- settings change and initial admin creation honor the pepper configuration
- budget: fresh hashes derive at the configured work factor
