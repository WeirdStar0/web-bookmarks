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

Both v3 and v4 parsers reject stored hashes claiming more than 100,000
iterations — the workerd derivation limit — so such hashes fail as a clean 401
instead of a 500 from `deriveBits`.

Derivation for v4 is PBKDF2-SHA256 over an HMAC-SHA-256 prehash —
`prehash = HMAC-SHA-256(key = pepperMaterial, message = password)`, then
`hash = PBKDF2-SHA256(prehash, salt, iterations)` with a fresh 16-byte salt and
a 256-bit output. Using the pepper as the HMAC key gives unambiguous domain
separation (no delimiter collisions — both passwords and pepper material may
contain `:`) and a fixed-size PBKDF2 input. An interop test re-derives a hash
with raw Web Crypto calls to pin the construction.

### Work factor

Fresh hashes use `resolvePasswordIterations(env)`: the `PASSWORD_HASH_ITERATIONS`
variable, bounded to 25,000–100,000, defaulting to **25,000**.

The Workers Free plan enforces a 10 ms CPU budget per HTTP invocation, and a
migration login can run two derivations (verify at the stored factor plus the
re-hash), plus the HMAC prehash. 25,000 is therefore the lowest-risk default:
it matches the previous release's login cost, where a v1 migration performed a
SHA-256 verification plus a single 25,000-iteration derivation. Real
production Free-plan CPU accounting has not been benchmarked, and Cloudflare
notes that sustained limit collisions terminate the Worker. Measured workerd
timings (vitest-pool-workers, reference dev machine) are 25k = 5 ms,
50k = 11 ms, 90k = 15 ms, 100k = 17 ms; they are reference data, not proof
about production CPU accounting. Deployments on Paid plans — or that have
verified their own budget — can opt into up to 100,000 (workerd rejects
derivations above 100k, cloudflare/workerd#1346, and the parsers reject stored
hashes claiming more). Malformed or out-of-range values fall back to the
default. Stored hashes keep their own iteration count — and upgrades never
lower a stored factor — so changing the variable migrates hashes lazily on
login; login remains a rate-limited, per-attempt cost.

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

A malformed value behaves differently per path, and the distinction is
deliberate: the **verification path** treats it as unavailable (a stored v4
whose id resolves nowhere fails closed; a v3 hash keeps verifying), while the
**password write path** fails closed with a 500 — silently falling back to an
unpeppered v3 on every future write would downgrade security without the
operator noticing. Either way a `console.warn` names the malformed secret.

### Verification and rotation

To verify a stored v4 hash, the id is resolved against `PASSWORD_PEPPER` first,
then `PASSWORD_PEPPER_PREVIOUS`. An id that resolves to neither makes
verification fail closed — the login returns 401 like a wrong password. There
is no fallback: correctness of the supplied password cannot be established
without its pepper.

Rotation procedure (single-admin deployment, zero downtime). `wrangler secret
put` creates and deploys a new Worker version immediately, and secret values
can never be read back afterwards, so the order below — `PREVIOUS` first — is
what keeps every stored hash verifiable at every moment:

0. Keep the **current full pepper value** (`k1:...`) in a password manager or
   secret manager. Without it rotation is impossible, and losing a pepper means
   losing the password.
1. Generate a fresh id and material: `k2:$(openssl rand -base64 32)`.
2. `npx wrangler secret put PASSWORD_PEPPER_PREVIOUS` → the **old** full value
   (`k1:...`). From this moment every stored `v4:k1` hash also verifies through
   `PREVIOUS`; nothing is disrupted.
3. `npx wrangler secret put PASSWORD_PEPPER` → the **new** full value (`k2:...`).
4. Log in once. The successful login re-hashes the stored hash to `k2`.
5. Confirm the re-hash actually landed — the migration write fails silently by
   design, and removing `PREVIOUS` before the new id is stored would lock the
   account. Query only the pepper id, never the hash:
   `SELECT CASE WHEN value LIKE 'v4:k2:%' THEN 'migrated' ELSE 'not-migrated'
   END AS state FROM settings WHERE key = 'password';` Retry the login until
   it reports `migrated`.
6. Remove `PASSWORD_PEPPER_PREVIOUS`.

Setting `PASSWORD_PEPPER` first (the intuitive order) would leave stored
`v4:k1` hashes with no resolvable pepper between the two commands, rejecting
logins until `PREVIOUS` is set.

Rules that keep this safe:

- Never reuse an id, and never change a pepper's material while keeping an id.
- Hard invariant: the system never rewrites a v4 hash as v3. A verified v4 is
  re-hashed only while a valid current pepper exists; with the pepper absent or
  malformed the stored hash is left untouched.
- A configured-but-malformed pepper is distinct from an unset one: unset keeps
  producing (unpeppered) v3 hashes, malformed fails closed on password writes
  (500) and offers no upgrade target, so the misconfiguration cannot silently
  downgrade security.
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

| Current pepper | Stored hash | Upgrade target |
|---|---|---|
| valid | v4 (current id, configured factor) | none — already current |
| valid | v4 (old id) / v3 / v2 / v1 | `v4:<current id>:<configured factor>:...` |
| absent | v3 @ configured factor | none — already current |
| absent | v3 @ other factor / v2 / v1 | `v3:<configured factor>:...` |
| malformed | any | none — verification still works (v4 via `PREVIOUS`), writes fail closed |

The upgrade is a single conditional write,
`UPDATE settings SET value = ? WHERE key = 'password' AND value = <expected>`,
so a concurrent credential change (or a concurrent migration) is detected by
`changes = 0` and never overwritten.

Second hard invariant: **a lazy upgrade never lowers the existing work
factor.** The target factor is `max(stored factor, configured factor)`, so
removing or lowering `PASSWORD_HASH_ITERATIONS` leaves higher-factor hashes
untouched instead of re-writing them weaker. v3 and v4 carry their factor
explicitly; v2's implicit 100,000 is preserved the same way. Only v1 — a bare
digest with no factor — targets the configured factor, matching the pre-v4
migration path. Outcomes are handled per format:

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
the configured work factor (benchmarks above) and is skipped entirely on
already-current hashes.

## Create paths

Every path that writes a fresh hash uses one helper,
`createPasswordHash(env, password)`: v4 with the current pepper when configured,
otherwise v3 at the current work factor. Covered paths: initial admin creation
(init middleware), initial password creation inside the login handler, legacy
default-password replacement (init middleware), and `PUT /api/settings`.

## Test coverage

- v4 format parse/format/validation, pepper resolution, invalid-value handling,
  and the 100k parser ceiling (`100001 → fail closed`) for v3 and v4
- login with pepper creates v4; wrong pepper id fails closed; rotation via
  `PASSWORD_PEPPER_PREVIOUS` verifies and re-hashes to the current id
- downgrade protection: `PREVIOUS`-only verification and malformed-current
  verification keep the v4 hash byte-for-byte; malformed current fails
  password writes closed
- factor preservation: 90k v4 and v3 hashes survive a drop back to the default
  configured factor, a 90k v3 → v4 migration keeps 90k, and a v2 migration
  keeps its implicit 100k (v3 or v4)
- HMAC prehash construction pinned by an interop test using raw Web Crypto
- v3 → v4 login migration (`migrated: true`), v3 → v3 at a configured higher
  factor, and no-op when the stored hash is already current
- v1/v2 legacy migrations keep their concurrency-abort semantics
- storage failure during the migration write does not fail the login
- settings change and initial admin creation honor the pepper configuration
- work factor: fresh hashes use the Free-safe default and honor an in-range
  `PASSWORD_HASH_ITERATIONS` (falling back out of range)
