# Security

Authentication, authorization (RBAC), and the audit trail for `apps/api`.
This document is the security-design counterpart to `docs/METHODOLOGY.md`
(which covers the risk/vulnerability/suitability models) — read both
alongside `CLAUDE.md`'s "Auth Conventions" section, which states the
repo-wide rule this design exists to enforce: **every state-changing
route must be wrapped in `requirePermission` + `requireScope`.**

---

## 1. Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client (web app)
    participant A as apps/api
    participant DB as MongoDB

    C->>A: POST /api/v1/auth/login {email, password}
    A->>DB: findOne(email) + verify bcrypt hash (cost 12)
    alt account locked (>=10 failed attempts)
        A-->>C: 423 Locked
    else wrong password
        A->>DB: failedLoginAttempts++ (lock if now >=10)
        A->>DB: audit LOGIN_FAILURE / ACCOUNT_LOCKED
        A-->>C: 401
    else success
        A->>DB: reset failedLoginAttempts, lastLoginAt
        A->>A: sign access JWT (15m) + refresh JWT (7d, new family)
        A->>DB: store sha256(refreshToken), family, expiresAt
        A->>DB: audit LOGIN_SUCCESS
        A-->>C: 200 {accessToken} + Set-Cookie refreshToken (httpOnly, SameSite=Strict)
    end

    C->>A: GET /api/v1/... Authorization: Bearer accessToken
    A->>A: verify signature+exp, load user, check tokenVersion match
    A-->>C: 200 (or 401 if tokenVersion mismatch -> forced logout)

    Note over C,A: ~15 minutes later, access token expires
    C->>A: POST /api/v1/auth/refresh (cookie only, no body)
    A->>DB: findOne(tokenHash) by sha256(cookie value)
    alt token already revoked (reuse!)
        A->>DB: revoke entire family, tokenVersion++
        A->>DB: audit TOKEN_REUSE_DETECTED (CRITICAL)
        A-->>C: 401 + clear cookie
    else valid
        A->>DB: revoke old token, replacedBy = new token id
        A->>A: sign new access+refresh pair (same family)
        A->>DB: store new hashed refresh token
        A->>DB: audit TOKEN_ROTATED
        A-->>C: 200 {accessToken} + Set-Cookie (new refreshToken)
    end

    C->>A: POST /api/v1/auth/logout (cookie)
    A->>DB: revoke that one refresh token
    A-->>C: 200, cookie cleared

    C->>A: POST /api/v1/auth/logout-all (Bearer token)
    A->>DB: revoke ALL refresh tokens for user, tokenVersion++
    A-->>C: 200 — every device's access token now fails on next check
```

## 2. Tokens

|                     | Access token                                          | Refresh token                                                                                                |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Lifetime            | 15 minutes                                            | 7 days                                                                                                       |
| Secret              | `JWT_ACCESS_SECRET`                                   | `JWT_REFRESH_SECRET` (different key — a leaked access-signing key cannot mint refresh tokens, or vice versa) |
| Transport           | JSON response body, sent as `Authorization: Bearer`   | httpOnly, `SameSite=Strict`, `secure` in production, cookie scoped to `/api/v1/auth`                         |
| Storage server-side | Not stored (stateless; revocation via `tokenVersion`) | Stored **hashed** (sha256) in the `refreshTokens` collection — a DB read or leak never yields a usable token |
| Payload             | `{sub, role, scope, tokenVersion}`                    | `{sub, family, jti}`                                                                                         |

**Forced logout everywhere:** every access token carries the `tokenVersion`
it was issued under. `User.tokenVersion` is bumped by `logout-all`, a
password change, and reuse-detection. `authenticate` middleware rejects
any access token whose `tokenVersion` no longer matches the user's
current value — so a bump takes effect on the _next_ request with any
outstanding access token, without needing a token blocklist.

**Rotation:** every `/refresh` call revokes the presented refresh token
and issues a brand-new pair in the same `family`. A client should always
be holding at most one _currently valid_ refresh token per session.

**Reuse detection:** if a refresh token that is already marked
`revokedAt` is presented again, that can only mean either (a) it was
already used to rotate once and is being replayed — classic token theft
— or (b) the session already called `/logout`. Both cases are treated
identically and conservatively: the **entire token family** is revoked,
`tokenVersion` is bumped, and a `CRITICAL` audit entry
(`TOKEN_REUSE_DETECTED`) is written. Treating a post-logout retry the
same as theft is a deliberate, conservative choice — it is harmless
(the session was ending anyway) and keeps the reuse-detection logic in
one unconditional code path instead of trying to distinguish attacker
intent from a stale browser tab.

## 3. Password Handling

- Hashed with **bcrypt, cost factor 12** (`apps/api/src/lib/password.ts`).
- `User.passwordHash` has `select: false` in the Mongoose schema — it is
  never returned by a normal query; routes that need it call
  `.select("+passwordHash")` explicitly. `User.toSafeJSON()` is the only
  shape ever sent to a client.
- **Account lockout:** 10 consecutive failed logins locks the account for
  30 minutes (`User.lockedUntil`), independent of and in addition to the
  login rate limiter below. Only a `SUPER_ADMIN` can release a lock early
  (via `user:unlock` — see the permission matrix; the actual unlock route
  is out of scope for this step, deferred with the rest of user
  management).
- **Rate limiting** (`express-rate-limit`): `/login` allows 5 attempts
  per 15 minutes, keyed by **IP + email** together — not by email alone
  (so a busy shared office IP can't lock out a whole team) and not by IP
  alone (so it doesn't just throttle one attacker's traffic while missing
  a slow distributed attempt). This is why account lockout exists as a
  _second_, independent layer: an attacker rotating source IPs can dodge
  the per-IP+email rate limit (each IP only sees a few attempts) but
  cannot dodge the account-level failure counter, which is keyed purely
  on the account.

## 4. RBAC — Permission Matrix

Single source of truth:
`packages/shared/src/config/permissions.json`, loaded and validated by
`apps/api/src/lib/permissions.ts` (`hasPermission(role, permission)`).
Every `(role, permission)` pair is asserted against this exact table in
`apps/api/src/lib/permissions.test.ts` — that test file is what to show
a judge who asks "how do you stop the wrong person approving a
relocation."

**`FIELD_VOLUNTEER` gained `hazardEvent:read` and `hazardZone:read`**
(demo-rehearsal Part 1 fix): the map page and the habitation detail
panel's disaster-history section fetch `GET /hazard-events` and
`GET /zones`/`GET /grid` respectively, and this role held every other
permission those need (`habitation:read`, `district:read`) but not
these two — a genuine gap, not a deliberate restriction. A field
volunteer doing field work benefits most from knowing a habitation's
real disaster history and seeing hazard zones on the map — safety-
relevant information, not recommendation/decision detail — and the
volunteer's own printable report (Part 4B) explicitly lists disaster
history as in-scope for this role. `recommendation:read`,
`relocationSite:read`, `scenario:read`/`scenario:run`, `assessment:read`,
and `decision:read` remain deliberately withheld — a field volunteer
must never see recommendation, candidate-site, scenario, or decision
detail (Part 4B). The map page (`apps/web/src/routes/MapPage.tsx`) gates
its own recommendation/relocation-site/scenario queries behind
`hasPermission()` client-side so this role's map loads cleanly (no
console 403s) rather than silently attempting requests it can never
succeed at.

| Permission               | SUPER_ADMIN | STATE_ADMIN | DISTRICT_OFFICER | ANALYST | FIELD_VOLUNTEER |
| ------------------------ | :---------: | :---------: | :--------------: | :-----: | :-------------: |
| `assessment:read`        |     ✅      |     ✅      |        ✅        |   ✅    |                 |
| `auditLog:read`          |     ✅      |     ✅      |                  |         |                 |
| `decision:read`          |     ✅      |     ✅      |        ✅        |   ✅    |                 |
| `district:read`          |     ✅      |     ✅      |        ✅        |   ✅    |       ✅        |
| `fieldReport:read`       |     ✅      |     ✅      |        ✅        |   ✅    |       ✅        |
| `fieldReport:submit`     |     ✅      |             |                  |         |       ✅        |
| `fieldReport:verify`     |     ✅      |     ✅      |        ✅        |         |                 |
| `habitation:read`        |     ✅      |     ✅      |        ✅        |   ✅    |       ✅        |
| `habitation:write`       |     ✅      |     ✅      |                  |         |                 |
| `hazardEvent:read`       |     ✅      |     ✅      |        ✅        |   ✅    |       ✅        |
| `hazardEvent:write`      |     ✅      |     ✅      |                  |         |                 |
| `hazardZone:read`        |     ✅      |     ✅      |        ✅        |   ✅    |       ✅        |
| `hazardZone:write`       |     ✅      |     ✅      |                  |         |                 |
| `pipeline:run`           |     ✅      |     ✅      |                  |   ✅    |                 |
| `recommendation:approve` |     ✅      |             |        ✅        |         |                 |
| `recommendation:read`    |     ✅      |     ✅      |        ✅        |   ✅    |                 |
| `relocationSite:read`    |     ✅      |     ✅      |        ✅        |   ✅    |                 |
| `relocationSite:write`   |     ✅      |     ✅      |                  |         |                 |
| `scenario:read`          |     ✅      |     ✅      |        ✅        |   ✅    |                 |
| `scenario:run`           |     ✅      |     ✅      |        ✅        |   ✅    |                 |
| `user:manage`            |     ✅      |     ✅      |                  |         |                 |
| `user:read`              |     ✅      |     ✅      |        ✅        |         |                 |
| `user:unlock`            |     ✅      |             |                  |         |                 |

**Separation of duties — the load-bearing row is `recommendation:approve`.**
It gates `POST /api/v1/decisions` (creating a `Decision`: approve /
modify / reject / defer a `Recommendation`). It is granted to
`DISTRICT_OFFICER` (the operational approver) and `SUPER_ADMIN` (which
has every permission by definition, as a break-glass override) — and
explicitly **withheld from `STATE_ADMIN`**, despite `STATE_ADMIN` having
broad read/write everywhere else in its state. This is enforced
structurally, not just by convention: `packages/shared/src/config/loader.ts`
asserts at import time that `recommendation:approve` is granted to
_exactly_ `permissions.json`'s `separationOfDuties.approverRoles` list
and no other role — editing the JSON to accidentally hand `STATE_ADMIN`
approval rights fails the whole app's startup, not just a lint warning.

## 5. Enforcing RBAC on a Route

Every protected, state-changing route in this codebase follows the same
two-middleware shape:

```ts
router.post(
  "/some-resource",
  authenticate,
  requirePermission("habitation:write"),
  requireScope(), // attaches req.scopeFilter
  (req, res, next) => {
    // req.auth is populated; req.scopeFilter is a Mongo filter fragment
    // — merge it into every query BEFORE it runs.
    Habitation.find({ ...req.scopeFilter, ...otherFilters });
  },
);
```

- **`requirePermission(permission)`** — checks `req.auth.role` against
  the matrix above. This is the _can this role ever do this_ question.
- **`requireScope(options?)`** — computes a Mongo filter fragment from
  `req.auth` (`apps/api/src/lib/scope.ts`, `buildScopeFilter`) and
  attaches it to `req.scopeFilter`. This is the _which specific rows_
  question:
  - `SUPER_ADMIN` → `{}` (no restriction).
  - `STATE_ADMIN` → `{ districtId: { $in: [...districts in their state] } }`
    (resolved via a lookup against the `districts` collection, since
    resource documents carry `districtId`, not `state`, directly).
  - `DISTRICT_OFFICER` / `ANALYST` / `FIELD_VOLUNTEER` → `{ districtId: <their one district> }`.
  - A role with no `state`/`districtId` configured never falls open to
    "everything" — it matches nothing (`{ _id: { $exists: false } }`).

  Critically, this filter is merged into the query **before it runs** —
  it is never applied as a permissions check on documents already
  fetched from the database. A `DISTRICT_OFFICER` for Wayanad genuinely
  cannot cause a Ganjam document to be read off disk, let alone see it.

## 6. Audit Trail

### 6.1 What gets audited

- **Automatically** (`apps/api/src/middleware/autoAudit.ts`): every
  non-GET request to `/api/v1/**` that responds 2xx, unless the route
  already wrote a more specific entry itself (it sets
  `res.locals.auditHandled = true` to suppress the generic one).
- **Explicitly**, with full domain context: `LOGIN_SUCCESS`,
  `LOGIN_FAILURE`, `LOGIN_BLOCKED_LOCKED`, `ACCOUNT_LOCKED`, `LOGOUT`,
  `LOGOUT_ALL`, `TOKEN_ROTATED`, `TOKEN_REUSE_DETECTED` (`CRITICAL`),
  `PASSWORD_CHANGE`.

Every entry carries `requestId` (a fresh UUID per request, echoed back
as the `X-Request-Id` response header —
`apps/api/src/middleware/requestId.ts`), `ipAddress`, `userAgent`,
`actorId`/`actorLabel`, `entityType`/`entityId`, `before`/`after`
snapshots where applicable, and a `severity` of `INFO` / `WARNING` /
`CRITICAL`.

### 6.2 Append-only enforcement

`AuditLog` (`apps/api/src/models/AuditLog.ts`) blocks every Mongoose
mutation path except a plain insert: `save()` on an existing document,
`updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne`,
`findOneAndReplace`, `deleteOne`, `deleteMany`, `findOneAndDelete` all
throw. `Model.bulkWrite` is separately overridden (Mongoose's per-path
hooks do not intercept it) to reject the whole batch if _any_ operation
in it is not `insertOne`. All of this is proven by
`apps/api/src/models/AuditLog.test.ts`, one test per blocked path.

### 6.3 Tamper-evident hash chain

Every entry stores `seq` (a monotonic position in one global chain
across the whole collection), `prevHash`, and:

```
entryHash = sha256( canonicalJSON(entry-without-entryHash) + prevHash )
```

`canonicalJSON` sorts object keys recursively so the same logical
content always hashes identically. The very first entry uses the
sentinel `prevHash = "GENESIS"`. `apps/api/src/lib/audit.ts`'s `audit()`
function is the _only_ supported way to write an entry — it reads the
current chain tip, computes the next `seq`/`prevHash`/`entryHash`, and
inserts, with a small retry loop on a `seq` collision.

**`GET /api/v1/audit/verify-chain`** (`SUPER_ADMIN`/`STATE_ADMIN` only)
walks the whole chain in `seq` order, independently recomputing each
entry's hash from its own stored fields and checking `prevHash` linkage,
and reports the first broken link if any:

```json
{
  "valid": false,
  "entriesChecked": 42,
  "brokenAtSeq": 41,
  "reason": "entryHash does not match the recomputed hash — this entry's stored fields were altered after being written"
}
```

This is specifically designed to catch tampering that bypasses the
Mongoose guards entirely — e.g. someone with direct database access
editing a field via the native MongoDB driver.
`apps/api/src/lib/audit.test.ts` proves this: it writes a short chain,
edits a stored field directly through
`mongoose.connection.collections.auditLogs` (skipping every Mongoose
hook), and asserts `verifyAuditChain()` catches exactly that entry.

### 6.4 Reading the audit trail

`GET /api/v1/audit` — paginated (`page`, `pageSize`, max 100/page),
filterable by `actor`, `entityType`, `action`, `severity`, and a
`from`/`to` date range. `SUPER_ADMIN` and `STATE_ADMIN` only
(`auditLog:read`) — this listing has no per-district scope filter
(`AuditLog` is polymorphic across entity types, many of which, like
user management, have no district concept), so it is deliberately not
opened to `DISTRICT_OFFICER`.

For the officer decision workbench's audit trail view (Step 7 Commit 3),
`GET /api/v1/recommendations/:id/audit-trail` (`recommendation:read`,
already `DISTRICT_OFFICER`-scoped) exists instead: it resolves this one
recommendation's `Decision` documents (already scope-checked) to their
specific `AuditLog` entries, plus the same `verifyAuditChain()` result
`/audit/verify-chain` returns — a pass/fail-and-broken-link summary with
no entry content, safe to expose without the broader permission.

---

## 7. Known Limitations for a Hackathon Prototype

Honest gaps a production deployment would need to close:

- **No MFA.** Password-only authentication. A real deployment for
  government disaster-management officers should require at least TOTP
  second-factor for `DISTRICT_OFFICER` and above, given the weight of
  actions (`recommendation:approve`) those roles can take.
- **Secrets in `.env`, not a secrets manager.** `JWT_ACCESS_SECRET` /
  `JWT_REFRESH_SECRET` live in a local `.env` file (gitignored) for this
  prototype. Production should pull these from a managed secret store
  (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, or
  equivalent) with rotation.
- **No WAF / DDoS layer.** `express-rate-limit`'s in-memory store
  protects individual routes from brute force but assumes a single
  Node process and does not protect against distributed
  volumetric attacks — a real deployment sits behind a WAF/CDN
  (Cloudflare, AWS WAF, etc.).
- **`trust proxy` assumes a trusted reverse proxy.** `app.ts` sets
  `app.set("trust proxy", 1)` so `req.ip` (used by the login rate
  limiter's key and every audit entry's `ipAddress`) reflects
  `X-Forwarded-For` from a fronting load balancer. If this app is ever
  deployed directly internet-facing instead, this **must** be removed or
  scoped to known proxy IPs — otherwise a client can spoof
  `X-Forwarded-For` to dodge rate limiting and forge audit log IPs.
- **Hash-chain `seq` allocation is best-effort under concurrency.**
  `audit()` reads the current chain tip and retries a bounded number of
  times on a `seq` collision. This is adequate for a single-process
  deployment (the expected shape here) but is not a strict distributed
  sequencing guarantee — a multi-instance production deployment would
  need a proper sequencer (e.g. a dedicated counter document with atomic
  `findOneAndUpdate($inc)`, or moving audit writes through a single
  queue consumer).
- **No DPDP Act 2023 compliance program.** This prototype handles
  synthetic demo data and does not implement India's Digital Personal
  Data Protection Act obligations a real deployment touching real
  citizens' data would need: a documented lawful basis and consent
  flow for habitation-level personal/demographic data (beyond the
  existing `consentStatus` field, which records consent for the
  _relocation conversation_, not for data processing itself), a data
  retention/erasure policy, a Data Protection Officer / grievance
  contact, and breach-notification procedures.
- **No account-unlock route yet.** The permission matrix defines
  `user:unlock` (SUPER_ADMIN only) and the lockout mechanism sets
  `User.lockedUntil`, but the actual `POST` endpoint to clear it early
  is deferred along with the rest of user-management CRUD (out of
  scope for this step — see `CLAUDE.md`'s Build Roadmap).
