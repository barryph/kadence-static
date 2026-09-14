# Backend Requirements — External Account Deletion

A plain-language summary of what the backend must provide so the account-deletion
site can do its job. Paths, payload shapes, storage choices and error codes are
deliberately left open — those are implementation decisions for later.

The goal: let someone who has uninstalled the app permanently delete their
Kadence account, without signing in, via an emailed verification link.

---

## Endpoints

### 1. Request account deletion

**Purpose:** Start the flow. Takes the email address the user typed and, if an
account exists for it, sends a short-lived verification email containing a
single-use link.

**Must:**
- Accept an email address from an unauthenticated public caller.
- Always give the same neutral response, whether or not an account exists, so
  the endpoint cannot be used to discover which emails are registered.
- Send the verification email only when an account actually exists.
- Apply rate limiting so the endpoint cannot be abused to spam an address.

### 2. Confirm account deletion

**Purpose:** Finish the flow. Takes the token from the emailed link and
permanently deletes the associated account.

**Must:**
- Accept the token from an unauthenticated public caller.
- Delete the account only when the token is valid, unexpired and unused.
- Invalidate the token on first use, so a link works exactly once.
- Never delete anything on an invalid, expired, used or missing token.

---

## Supporting responsibilities

- **Verification email** — deliver a link back to the site carrying the token,
  and make clear that deletion is permanent.
- **Token handling** — generate unguessable tokens, store them separately from
  the app's normal session tokens, and expire them after a short window.
- **Cross-origin access** — allow the deletion site's origin to call both
  endpoints.
- **Rate limiting** — throttle the request endpoint per address and per client.

## Out of scope

- The existing in-app, signed-in account deletion stays as it is; this is an
  additional, unauthenticated path for users who no longer have the app.
- No account recovery, export or undo is required. Deletion is permanent.
