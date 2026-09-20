# Backend integration - external account deletion

The site performs two operations against the public Kadence API. Both are
unauthenticated: a user who has uninstalled the app has no session, and the
emailed token is the only proof of ownership.

| Operation | Route | Carries |
| --- | --- | --- |
| Ask for a deletion link | `POST /account/deletion-requests` | the email address |
| Confirm deletion | `POST /account/deletion-requests/confirm` | the emailed token |

These routes are what the site calls; how the backend handles them, and the
request and response bodies behind them, are the backend's concern (see
[`backend-requirements.md`](backend-requirements.md) and, in the backend
repository, `back-end/docs/external-account-deletion.md`). The routes are
defined in `src/lib/config.ts`, and all transport lives in `src/lib/api.ts`.

## What the site relies on

- **A neutral request.** The request answer is the same whether or not an
  account exists. The site never reads a response body, so it cannot reveal the
  difference.
- **The token in the request body.** The confirmation token is sent in the body,
  never a URL, so it cannot reach server logs, proxies or `Referer` headers.
- **Status-only handling.** The site classifies each response by status code
  and shows generic copy; no backend detail or PII reaches the UI. Failures fall
  into three user-facing states: an unusable link, too many requests, or a
  temporary problem. The mapping is implemented and tested in `src/lib/api.ts`.
- **Cross-origin access.** The site and API are on different origins in
  production, so the backend must allow the site's origin.

## Manual verification against a real backend

Point the dev server at a running backend and walk the flow:

```bash
PUBLIC_API_BASE_URL=http://localhost:3000 pnpm run dev
```

1. A known address and an unknown address produce the same neutral panel.
2. A valid emailed link deletes the account and shows **Account deleted**.
3. Re-opening the same link shows **This link is no longer valid**.
4. A missing or malformed token shows the invalid-link state with no request.
5. A forced rate limit and server error offer a retry.

`pnpm run test:e2e` covers steps 1-5 against the bundled mock API; only the real
data assertions need a live database.
