# API Contract — External Account Deletion

**Status:** proposed, not implemented
**Consumer:** the Kadence account-deletion site (`kadence-static`)
**Owner:** Kadence backend (`back-end/`, NestJS 11 + PostgreSQL)
**Related:** `back-end/docs/oauth-sign-in.md` in the monorepo (same document style)

This document specifies the two HTTP endpoints the account-deletion site calls.
It is written against the conventions already present in the backend's DDD
modules (`src/modules/<feature>/`), and every status code is mapped to the UI
state the site produces today, so the two sides cannot drift. The feature ships
as its own `website` module: all of its code and files belong in
`src/modules/website/` (§10).

The frontend is **not** an authorization boundary. The backend remains solely
responsible for verifying ownership and authorizing deletion.

Throughout, **MUST**, **SHOULD** and **MAY** are used in the RFC 2119 sense.
"Normative" items are required for the site to work correctly; "Recommended"
items describe the design we suggest but that the backend team owns.

---

## 1. Scope

### In scope

All endpoints consumed by this site are namespaced under the `/website/`
prefix:

- `POST /website/auth/account-deletion/request` — start the email-verified flow.
- `POST /website/auth/account-deletion/confirm` — consume the token and delete.

The prefix is part of the contract and is **not optional**: the backend MUST
NOT expose either route without it. It groups everything the static site calls
under one top-level path, independent of the module that happens to own the
handler.

### Out of scope (unchanged)

- `DELETE /auth/account` — the existing in-app, session-authenticated deletion.
  It MUST keep working exactly as it does today: `IsAuthedGuard`, no request
  body, `@Throttle` 3/60 s, `{ data: { message: 'Account deleted' } }`. It is an
  app endpoint, not a site endpoint, and MUST NOT move under `/website/`.
- Password reset. The new flow MUST NOT alter or reuse it.

Both new routes are **unauthenticated**. This is the entire point of the feature:
a user who has uninstalled the app cannot present a session cookie.

---

## 2. Endpoint 1 — request a deletion email

```http
POST /website/auth/account-deletion/request
Content-Type: application/json
Accept: application/json

{ "email": "user@example.com" }
```

### Request body

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `email` | string | yes | `@IsEmail()`, `@IsNotEmpty()`, max 254 chars |

`configure-app.ts` sets `forbidNonWhitelisted: true`, so **any additional
property yields a 400**. The site sends exactly `{ "email": … }`.

Emails are treated as **case-insensitive**. The backend MUST normalise the
address (trim surrounding whitespace, then lowercase / case-fold) before any
lookup, so `User@Example.com`, `user@example.com` and
`  USER@example.com ` all resolve to the same account. Validation applies to the
normalised value; normalisation MUST NOT change which addresses are accepted
beyond case and surrounding whitespace.

### Responses

| Status | Body | When |
| --- | --- | --- |
| `200` | `{ "data": { "message": "<neutral>" } }` | Always, for any syntactically valid email — **whether or not an account exists**. |
| `400` | `{ "error": { "statusCode": 400, "message": "..." } }` | Validation failure (missing/malformed/extra fields). |
| `429` | `{ "error": { "code": "TOO_MANY_REQUESTS", "message": "..." } }` | Per-IP throttle exceeded. |
| `500` | `{ "error": { "statusCode": 500, "message": "Internal server error" } }` | Unexpected failure. |

The `200` message MUST be a single constant string, identical for every
address. Suggested wording, matching the existing `forgot-password` style:

> `If an account exists for this email address, we've sent instructions to verify your request and continue with account deletion.`

The site renders its own copy and ignores this body; it exists for API
consumers and for the Swagger examples.

### Normative behaviour

1. An unknown email MUST produce a response **byte-identical** to a known one,
   with the same status and same body.
2. The endpoint MUST NOT reveal account existence through status, body, timing,
   or headers.
3. When an account exists, the backend MUST generate a token, persist only its
   hash, and dispatch the email through `EMAIL_SENDER` (the `NoopEmailSender`
   mock, §6).
4. When no account exists, the backend MUST do none of the above and still
   return the neutral `200`.
5. The response MUST NOT be delayed by email delivery. Dispatch the send
   without awaiting the provider inline (fire-and-forget with error logging),
   so the known/unknown paths have indistinguishable latency.
6. Issuing a new token MUST invalidate any previous deletion token for that
   user (the most recent email is the only working link). This mirrors
   `UsersRepo.setPasswordResetToken`, which overwrites.
7. Account lookup MUST be case-insensitive. A request for any case variant of a
   known address MUST behave exactly as the canonical form — same neutral `200`,
   same token issued to the same account, same email sent — and any case variant
   of an unknown address MUST remain indistinguishable from the canonical
   unknown address. Case MUST NOT become an account-existence or
   account-identity signal.

### Recommended

- `@Throttle({ default: { ttl: 60000, limit: 5 } })`, matching
  `forgot-password`.
- A per-account cooldown (for example, do not re-issue within 60 s; return the
  neutral `200` without sending). A cooldown is safe because it behaves
  identically for unknown addresses.
- `Retry-After` on `429`.
- `Cache-Control: no-store` on every response.

---

## 3. Endpoint 2 — confirm and delete

```http
POST /website/auth/account-deletion/confirm
Content-Type: application/json
Accept: application/json

{ "token": "a1b2c3d4e5f6789012345678901234567890abcd" }
```

The token travels in the **request body**, never in a path or query string, so
it cannot be captured in server access logs, proxies or `Referer` headers. The
site already does this; the backend MUST accept it this way.

### Request body

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `token` | string | yes | `@IsString()`, `@IsNotEmpty()` |

`forbidNonWhitelisted: true` applies here too: send exactly `{ "token": … }`.

### Responses

| Status | Body | When |
| --- | --- | --- |
| `200` | `{ "data": { "message": "Account deleted" } }` | Token valid; account and all owned data deleted. |
| `400` | `{ "error": { "code": "INVALID_DELETION_TOKEN", "message": "..." } }` | Token unknown, malformed, expired, or already used. |
| `429` | `{ "error": { "code": "TOO_MANY_REQUESTS", "message": "..." } }` | Per-IP throttle exceeded. |
| `502` | `{ "error": { "code": "PROVIDER_REVOCATION_FAILED", "message": "..." } }` | Linked provider could not be disconnected. Nothing was deleted; the token stays valid. |
| `500` | `{ "error": { "statusCode": 500, "message": "Internal server error" } }` | Unexpected failure. |

`200`'s message MUST match `DELETE /auth/account` so both deletion paths report
the same thing.

### Normative behaviour

1. **The user is resolved from the token, never from client input.** No user
   id, email or session is accepted.
2. All four failure cases — unknown, malformed, expired, already used — MUST
   return the same `400 INVALID_DELETION_TOKEN`. Do not distinguish them in the
   response; the difference may only appear in server-side logs.
3. The endpoint MUST delegate to the existing
   `AccountDeletionService.deleteAccount(userId)` (injected from
   `modules/authentication/`; see §10). It MUST NOT reimplement, duplicate or
   relocate deletion. That service already: revokes Apple authorization before
   touching the database, runs all deletes in one transaction, and relies on
   the `ON DELETE CASCADE` constraints as a safety net.
4. If `deleteAccount` throws `AccountNotFoundError` (account already gone), the
   endpoint MUST translate it to `400 INVALID_DELETION_TOKEN` rather than
   surfacing `404`, so that "deleted" and "never existed" are indistinguishable.
5. `PROVIDER_REVOCATION_FAILED` MUST pass through as `502` with the account
   left intact and the token **still valid**, so the user can retry the same
   link. Consuming the token before deletion succeeds would strand the user.
6. Single use is guaranteed by construction: a successful deletion removes the
   user row and, with it, the token. A replay therefore falls under item 2.
7. Concurrent requests with the same token MUST NOT corrupt state or return a
   `5xx`. Either outcome order is acceptable — both `200`, or one `200` and one
   `400` — but a `200` MUST NOT be returned unless the account is actually gone.
8. The endpoint MUST NOT set cookies, create a session, or return a redirect.

### Recommended

- `@Throttle({ default: { ttl: 60000, limit: 10 } })`. The token is 160-bit, so
  throttling is defence in depth rather than the primary control.
- Serialize the whole operation on the token row with `SELECT … FOR UPDATE`, so
  two concurrent confirmations cannot both invoke provider revocation and the
  outcome is deterministic. Note this holds the row lock across the Apple revoke
  call; given how rare the request is, determinism is worth more than the lock
  duration.
- Log invalid-token attempts as a counter keyed by a hash of the token, never
  the token itself.

---

## 4. Response envelope

Both endpoints use the envelope the app already parses (`.astro` site reads only
status codes, but the mobile app and future consumers read the body):

```ts
// success
{ "data": { "message": string } }

// error raised via `new ServerError(code, message, status)`
{ "error": { "code": string, "message": string } }

// error raised as a NestJS HttpException (e.g. ValidationPipe)
{ "error": { "statusCode": number, "message": string } }
```

Note the asymmetry, which already exists in
`back-end/src/ExceptionFilter.ts`: `ServerError` produces `code`, while a plain
`HttpException` produces `statusCode`. Both are fine here, because the site
classifies on **status** alone. Do not rely on the site reading `code`.

---

## 5. Token design

### Requirement: a separate token namespace

The deletion token MUST be stored in dedicated columns (or a dedicated table).
It MUST NOT reuse `users.password_reset_token` / `password_reset_expires`.

Rationale: sharing the column would make a leaked password-reset token an
account-deletion credential, and vice versa. The two flows have different
lifetimes, different audiences and very different blast radii.

### Required properties

| Property | Requirement |
| --- | --- |
| Entropy | ≥ 128 bits. Match the existing reset token: 20 bytes → 40-char hex (160 bits). |
| At rest | Store **only** a SHA-256 hex digest. Never the raw token. |
| Lookup | By digest, indexed and unique. |
| Lifetime | Short-lived and enforced server-side. `ACCOUNT_DELETION_TOKEN_EXPIRY_MINUTES = 60` is suggested (longer than the 20-minute reset window, because the user must leave for their inbox and make a deliberate decision). |
| Single use | Consumed by successful deletion. |
| Rotation | Issuing a new token invalidates the previous one for that user. |
| Scope | Authorizes exactly one action: deleting the owning account. It MUST NOT authenticate a session, reset a password, or read any data. |
| Logging | NEVER logged, in any form. Not in access logs, error messages, audit trails or crash reports. |

### Recommended migration

Mirror the existing reset columns on `users`, which keeps the pattern
consistent and lets the `ON DELETE CASCADE` on the user row enforce single use
for free:

```ts
await knex.schema.alterTable('users', (table) => {
  table.string('account_deletion_token');      // sha256 hex digest
  table.datetime('account_deletion_expires');
  table.index('account_deletion_token');
});
```

A dedicated `account_deletion_tokens` table is equally acceptable and is the
better choice if you want to retain an audit trail of issued/consumed tokens.
Either way, the `user_id` reference MUST `ON DELETE CASCADE`, and the digest
column MUST be unique.

Put this in the website module's `utils/account-deletion-token.ts`. Reuse the
existing crypto helpers in
`src/modules/authentication/utils/password-reset-token.ts` by generalising them
in place and importing them (they are already `generate*`/`hash*` pairs over
`randomBytes(20)` + SHA-256); do not duplicate the crypto in the website module.

---

## 6. Email delivery

### Mocked for now

`AuthenticaitonModule` binds `EMAIL_SENDER` to `NoopEmailSender`, which records
each payload in memory and logs that a message *would* be sent. This is the
established treatment for transactional mail — password reset already runs
against it — and the account-deletion flow MUST use the same sender rather than
introducing a second abstraction or a real provider of its own. The port, the
`EMAIL_SENDER` token and `NoopEmailSender` stay in `modules/authentication/`
because password reset shares them; the `WebsiteModule` built in §10 consumes
them through its import of `AuthenticaitonModule`.

Consequences:

- **No real email is delivered.** That is accepted for this iteration. Wiring a
  real provider is a follow-up owned by the backend team and is not a blocker
  for building, testing or shipping the endpoints against the mock.
- The mock's in-memory record — not an inbox — is what tests assert against. A
  known-email request MUST leave exactly one account-deletion payload.
- The mock MUST NOT log the deletion token or the full link, in keeping with
  §5. The token is held only inside the in-memory payload — the single
  exception, since it is needed to simulate the link. It lives only in process
  memory and MUST never reach a log line, an error message or a crash report.
- Logging the recipient address is the existing noop behaviour and is tolerated
  while the sender is a mock. A real provider MUST NOT log it (see below).

`NoopEmailSender` therefore grows one method and one payload type, staying the
same shape as today:

```ts
export class NoopEmailSender implements IEmailSender {
  private readonly logger = new Logger(NoopEmailSender.name);
  readonly sentEmails: Array<
    PasswordResetEmailPayload | AccountDeletionEmailPayload
  > = [];

  sendPasswordResetEmail(payload: PasswordResetEmailPayload): Promise<void> {
    /* unchanged */
  }

  sendAccountDeletionEmail(payload: AccountDeletionEmailPayload): Promise<void> {
    this.sentEmails.push(payload);
    this.logger.log(
      `[NoopEmailSender] Account deletion email would be sent to ${payload.recipientEmail}`,
    );
    return Promise.resolve();
  }
}
```

### Port extension

Extend the existing port rather than adding a second abstraction:

```ts
export interface AccountDeletionEmailPayload {
  recipientEmail: string;
  deletionToken: string;
}

export interface IEmailSender {
  sendPasswordResetEmail(payload: PasswordResetEmailPayload): Promise<void>;
  sendAccountDeletionEmail(payload: AccountDeletionEmailPayload): Promise<void>;
}
```

### Email content requirements

These describe the payload that a real provider will render. With the mock in
place nothing is rendered or delivered, but the payload and link construction
MUST already satisfy them so the swap to a real sender is mechanical.

- The link MUST be built from configuration, not hard-coded:
  `{ACCOUNT_DELETION_SITE_URL}/delete-account/confirm/?token={token}`
- New environment variable (add to `.env.example` and the deploy configuration):

  | Variable | Example |
  | --- | --- |
  | `ACCOUNT_DELETION_SITE_URL` | `https://accounts.kadence.barryph.com` |

  This is a public URL, not a secret.
- Subject SHOULD name the action, e.g. *"Delete your Kadence account"*.
- The body MUST state that the link is single-use, expires, and that the action
  is permanent and cannot be undone.
- The body MUST NOT contain anything beyond the recipient address and the link —
  no user id, no activity data, no account metadata.
- The email MUST NOT be logged with the token or the full URL. Log the
  recipient's digest or nothing.
- `NoopEmailSender` logs the raw recipient address. While it remains a mock that
  trace line is the only permitted appearance of an address in a log; when a
  real sender replaces it, that logging MUST be removed (`AccountDeletionService`
  already sets the right precedent by logging only a user id).

---

## 7. Rate limiting

The global throttler is `100 / 60 s` (`app.module.ts`) and is disabled under
`NODE_ENV=test`, so per-route limits must be asserted in tests explicitly.

| Route | Suggested limit | Rationale |
| --- | --- | --- |
| `request` | `5 / 60 s` per IP + per-account cooldown | Matches `forgot-password`; the cooldown prevents using the endpoint to mail-bomb a specific address. |
| `confirm` | `10 / 60 s` per IP | Defence in depth over the 160-bit token. |

The site maps `429` to a "Too many requests" panel with a retry affordance, and
never treats it as an account-existence signal.

---

## 8. CORS

The site is served from a different origin than the API, and a
`Content-Type: application/json` POST triggers a preflight, so:

1. The Pages origin MUST be listed in the backend's `CORS_ORIGINS`
   (`configure-app.ts`). For a project site that is
   `https://<owner>.github.io` — scheme + host only, no path.
2. `OPTIONS /website/auth/account-deletion/*` MUST return `204` with
   `Access-Control-Allow-Headers: content-type`. The `cors` package already does
   this; verify it is not bypassed by a guard.
3. The site sends `credentials: 'omit'`, so no cookie handling is required. The
   existing `credentials: true` CORS setting is harmless and should stay for the
   app's other routes.

---

## 9. Frontend compatibility map

This is the contract's acceptance criterion. Each row is asserted by the site's
end-to-end test suite.

| Backend response | Site state |
| --- | --- |
| `request` → `200` | **Check your email** (neutral confirmation) |
| `request` → `400` | **Check your email** — deliberately, to prevent enumeration |
| `request` → `429` | **Too many requests** + retry |
| `request` → `5xx` / network / timeout | **Something went wrong** + retry |
| `confirm` → `200` | **Account deleted**; token stripped from the address bar |
| `confirm` → `400` | **This link is no longer valid** (covers expired, invalid, already used) |
| `confirm` → `429` | **Too many requests** + retry (same token) |
| `confirm` → `502` | **Something went wrong** + retry (same token) |
| `confirm` → `5xx` / network / timeout | **Something went wrong** + retry (same token) |

A `4xx` on `request` mapping to success is intentional and load-bearing. It
means a malformed-email validation mismatch between frontend and backend cannot
be turned into an enumeration oracle.

---

## 10. Implementation shape and module placement

This feature ships as a **new NestJS/DDD module**, `src/modules/website/`.
**All of the feature's own code and files MUST live in that module** — do not
add the account-deletion controller, DTOs, request service, token repository,
constants, helpers or errors to `modules/authentication/` or anywhere else.
Follow the backend conventions in `AGENTS.md` (DDD + Clean Architecture:
features under `src/modules/<feature>/` split into `domain/`, `repos/`,
`services/`, `queries/`, `mappers/`, `dtos/`):

```text
src/modules/website/
├── website.module.ts                        # new NestJS module
├── account-deletion.controller.ts           # @Controller('website/auth/account-deletion')
├── dtos/
│   ├── account-deletion-request.dto.ts      # { email }
│   └── account-deletion-confirm.dto.ts      # { token }
├── services/
│   └── account-deletion-request.service.ts  # token issue + email dispatch
├── repos/
│   └── account-deletion-token.repository.ts
├── constants/account-deletion.constants.ts  # expiry, throttle values
├── utils/account-deletion-token.ts          # generate/hash (or generalise reset helpers)
└── website.errors.ts                        # + InvalidDeletionTokenError
```

`domain/`, `queries/` and `mappers/` are added only if this feature introduces
its own entities, read models or persistence mapping; a feature that has none
MAY leave them out.

### What stays in `modules/authentication/`

The module split is deliberate: shared pieces already owned by authentication
stay there, and `WebsiteModule` imports them rather than copying or moving them.

- `services/account-deletion.service.ts` (`AccountDeletionService`) and
  `repos/account-deletion.repository.ts` (`AccountDeletionRepository`) remain in
  `modules/authentication/`. They are the single deletion implementation and
  also serve the in-app `DELETE /auth/account`, whose behaviour MUST NOT change.
  `WebsiteModule` injects the existing `AccountDeletionService`; it MUST NOT
  reimplement or relocate it.
- `ports/email-sender.port.ts` (`IEmailSender`, `EMAIL_SENDER`) and
  `infrastructure/noop-email-sender.ts` (`NoopEmailSender`) remain in
  `modules/authentication/`, because password reset shares them (§6).
- `authentication.errors.ts` stays as it is; the new error is declared in the
  website module instead (`website.errors.ts`).

So that `WebsiteModule` can inject the shared service, `AuthenticaitonModule`
MUST export it — its `exports` array is currently empty:

```ts
// modules/authentication/authentication.module.ts
@Module({
  imports: [UsersModule, PassportModule],
  controllers: [AuthenticationController],
  providers: [ /* … unchanged … */ ],
  exports: [AccountDeletionService], // new: consumed by WebsiteModule
})
export class AuthenticaitonModule {}

// modules/website/website.module.ts
@Module({
  imports: [AuthenticaitonModule, UsersModule],
  controllers: [AccountDeletionController],
  providers: [
    AccountDeletionRequestService,
    AccountDeletionTokenRepo,
    // EMAIL_SENDER is bound by AuthenticaitonModule; consume it via that import,
    // or re-bind NoopEmailSender here if the module does not export it.
  ],
})
export class WebsiteModule {}
```

`WebsiteModule` MUST be registered in `AppModule`. The exact provider wiring is
the backend team's call; what the contract fixes is the placement — the
feature's own code under `modules/website/`, the shared deletion service and
email port left in `modules/authentication/`, and `DELETE /auth/account`
unchanged.

Controller skeleton, matching the existing decorators. It assumes
`AccountDeletionRequestService`, `InvalidDeletionTokenError` (from
`website.errors.ts`) and `AccountNotFoundError` (imported from the
authentication module) are in scope:

```ts
@Controller('website/auth/account-deletion')
export class AccountDeletionController {
  constructor(
    private readonly requestService: AccountDeletionRequestService,
    private readonly accountDeletionService: AccountDeletionService,
  ) {}

  @Post('request')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiBody({ type: AccountDeletionRequestDTO, examples: { … } })
  async request(@Body() dto: AccountDeletionRequestDTO) {
    await this.requestService.requestDeletion(dto.email); // never throws for unknown email
    return { data: { message: NEUTRAL_REQUEST_MESSAGE } };
  }

  @Post('confirm')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async confirm(@Body() dto: AccountDeletionConfirmDTO) {
    // Throws InvalidDeletionTokenError (400) for unknown/expired/used tokens.
    const userId = await this.requestService.resolveToken(dto.token);

    try {
      await this.accountDeletionService.deleteAccount(userId);
    } catch (error) {
      // Raced: the account vanished between resolve and delete. Report it the
      // same way as an unusable token so nothing is disclosed. Everything else
      // — notably PROVIDER_REVOCATION_FAILED (502) — passes through untouched.
      if (error instanceof AccountNotFoundError) {
        throw new InvalidDeletionTokenError();
      }
      throw error;
    }

    return { data: { message: 'Account deleted' } };
  }
}
```

`AccountDeletionService.deleteAccount` removes the user row inside its
transaction, which cascades the token columns away. That is what makes the
token single-use; there is no separate "mark as used" step to get wrong.

New error, declared in the website module's `website.errors.ts` (not in
`authentication.errors.ts`):

```ts
export class InvalidDeletionTokenError extends ServerError {
  constructor() {
    // Same message for unknown, malformed, expired and already-used tokens.
    super('INVALID_DELETION_TOKEN', 'Deletion link is invalid or expired', 400);
  }
}
```

Note: guards are applied per-route in this codebase (`@UseGuards` on the
method, not the controller), so the new unauthenticated routes on the website
module's `AccountDeletionController` will not inherit `IsAuthedGuard`. Verify no
controller-level guard is introduced, and that importing `AuthenticaitonModule`
does not pull a guard onto these routes.

---

## 11. Required tests

Following the naming convention that the Jest configs match on:
unit `*.spec.ts`, integration `*.int-spec.ts` (Testcontainers + Postgres),
E2E `*.e2e-spec.ts` under `test/e2e/`. Unit and integration specs live beside
the feature code in `src/modules/website/` (the shared
`AccountDeletionService` keeps its existing tests in
`modules/authentication/`).

**Request endpoint**

- Known email → `200`, token row written (digest only, no raw token), one
  account-deletion payload recorded by `NoopEmailSender`, previous token
  invalidated.
- Unknown email → `200` with a response body **identical** to the known-email
  case, no token written, no email payload recorded.
- Case-insensitive matching: `User@Example.com` for an account stored as
  `user@example.com` → `200` and behaves exactly like the canonical address
  (token issued for the same user, payload recorded). A differently-cased
  **unknown** address → `200` with the same neutral body and no payload.
- Surrounding whitespace is ignored: `  user@example.com  ` behaves like
  `user@example.com`.
- Malformed email → `400`.
- Extra body property → `400` (whitelist is strict).
- Throttle exceeded → `429`.

**Confirm endpoint**

- Valid token → `200`, user row gone, and `activities`, `categories`,
  `activity_events`, `activity_goals`, `external_identities`, `user_sessions`
  all empty for that user.
- Expired token → `400 INVALID_DELETION_TOKEN`, account intact.
- Unknown token → `400`, identical body to expired.
- Replayed token (same token twice) → first `200`, second `400`.
- Provider revocation failure → `502 PROVIDER_REVOCATION_FAILED`, account
  intact, **token still usable on retry**.
- A password-reset token presented to `confirm` → `400` (namespace separation).
- Concurrent `confirm` with the same token → account deleted exactly once; no
  `5xx`.
- Unauthenticated access succeeds (no session cookie required) — this is the
  regression that matters most for the Play Store requirement.

**Cross-cutting**

- No log line emitted by either endpoint contains the raw token or the full
  deletion link.
- The only permitted email address in a log is the `NoopEmailSender` mock trace
  (`[NoopEmailSender] Account deletion email would be sent to <address>`); no
  service, repository or controller logs the address, and that trace MUST be
  removed when a real sender is wired in.
- The token never appears in a response body.
- Both routes resolve only under `/website/auth/account-deletion/…`; a request
  to the unprefixed `/auth/account-deletion/…` → `404`.

---

## 12. Manual verification against the site

Before merging, run the site against the real backend:

```bash
# back-end
pnpm run start:dev

# kadence-static
PUBLIC_API_BASE_URL=http://localhost:3000 pnpm run dev
```

1. Submit a known address → neutral panel; confirm the email link is generated
   (with the noop sender, check the log or the in-memory list).
2. Submit an unknown address → **identical** response and panel; confirm no
   token is issued.
3. Open the link with a valid token → deleted panel; confirm the account and all
   owned rows are gone.
4. Re-open the same link → "This link is no longer valid".
5. Open `/delete-account/confirm/` with no token, and with `?token=garbage` →
   "This link is no longer valid", with no network request.
6. Force a `429` and a `500` and confirm the retry paths.
7. Submit the same address in a different case (for example `User@Example.com`)
   → identical neutral panel, and the issued token belongs to the existing
   account rather than creating or targeting a second one.
8. Call the unprefixed `/auth/account-deletion/request` directly → `404`; only
   `/website/auth/account-deletion/request` is routed.

`pnpm run test:e2e` in `kadence-static` covers steps 1, 3, 4, 5 and 6 against
the bundled mock API, so only the data assertions in step 3 need a real
database. Steps 2, 7 and 8 are covered by the backend unit/integration suite.

---

## 13. Open questions for the backend team

1. **Email provider.** *Resolved for now:* the provider is mocked with the
   existing `NoopEmailSender` (§6). Choosing and wiring a real provider is a
   follow-up; it does not block building, testing or shipping the endpoints.
   Which service, and on what timeline, is still open.
2. **Token expiry.** 60 minutes is proposed. Confirm it is acceptable, or pick a
   different value and we will update the site's copy ("the link expires
   shortly").
3. **Account for OAuth-only users.** `users.password` is `notNullable`, but an
   OAuth-only account may still have a row. Confirm the deletion path handles
   Apple revocation for accounts created via Google/Apple exactly as
   `AccountDeletionService` already does.
4. **Email case sensitivity.** *Resolved:* emails are matched case-insensitively
   (§2). The backend MUST normalise the address (trim + lowercase / case-fold)
   before lookup, so `User@x.com` and `user@x.com` resolve to one account. Note
   that `users.email` is `UNIQUE` and `UserEmail.create()` does not currently
   normalise case, so today those can be distinct rows. Recommended: also
   normalise on write and add a unique index on `LOWER(email)`, backfilling
   existing rows; the request endpoint then uses the same normalised
   `UsersService.getByEmail` path as `forgotPassword`. Confirm whether that
   write-side migration is planned.
5. **Response message text.** The site renders its own copy; confirm the
   backend's neutral message is acceptable as specified in §2.
