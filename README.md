# Kadence — account deletion site

Static, dependency-light website that provides the **external account-deletion
flow** required by Google Play for the [Kadence](../../kadence) mobile app.

It exists for one reason: a user who has uninstalled the app must still be able
to permanently delete their account. The site requests a verification email,
then completes the deletion from a single-use link — without ever asking the
user to sign in to the app.

- **Live route:** `/delete-account/`
- **Confirmation route:** `/delete-account/confirm/?token=…`
- **Privacy policy route:** `/privacy-policy/`
- **Stack:** Astro (static output), TypeScript, hand-written CSS, a few KB of
  vanilla client-side TypeScript. No UI framework, no server runtime.

---

## Contents

- [How it works](#how-it-works)
- [Privacy policy page](#privacy-policy-page)
- [Brand and design provenance](#brand-and-design-provenance)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Backend integration](#backend-integration)
- [Security model](#security-model)
- [Testing](#testing)
- [Deployment to GitHub Pages](#deployment-to-github-pages)
- [Project layout](#project-layout)
- [Accessibility and responsiveness](#accessibility-and-responsiveness)
- [Known follow-ups](#known-follow-ups)

---

## How it works

1. **Request** — the user enters their email address on `/delete-account/`.
   The site `POST`s it to the deletion-request endpoint.
2. **Neutral confirmation** — the UI always shows *"Check your email"*, whether
   or not an account exists for that address. The response body is never
   inspected for account existence.
3. **Verification email** — the backend sends a short-lived, single-use link
   containing a token.
4. **Confirm** — `/delete-account/confirm/?token=…` explains that deletion is
   permanent and requires an explicit **Permanently delete account** click.
   Nothing happens until that click.
5. **Deleted** — the token is `POST`ed to the confirm endpoint and, on success,
   the site shows *"Account deleted"*.

Only transport-level failures (rate limiting, network problems, server errors)
produce an error state. A rejection on the request endpoint is deliberately
treated as success so the endpoint cannot be used to enumerate accounts.

## Privacy policy page

`/privacy-policy/` publishes the Kadence Privacy Policy at a stable URL that can
be linked from the App stores and from inside the app.

- **Content lives in [`src/content/privacy-policy.md`](src/content/privacy-policy.md)** —
  plain Markdown, no embedded HTML. Edit that file to change the policy; the
  page needs no code changes.
- `src/pages/privacy-policy.astro` renders it with **Astro's built-in Markdown
  pipeline**, so there is no Markdown dependency to maintain. The page adds only
  presentation.
- The whole site shares one light, document-style theme (see `global.css`): a
  white background, near-black text, a proportional system font, generous line
  height and underline links. The policy page opts into a wider column and a
  ~68-character measure on top of it, and keeps the shared header, footer and
  skip link so it still reads as Kadence.
- Accessibility: semantic landmarks, one `h1` with no skipped heading levels,
  dark-on-white contrast throughout, a dark-blue focus ring (the app's cyan ring
  is too low-contrast on white), and a table that scrolls horizontally on small
  screens instead of overflowing.

## Brand and design provenance

Every page shares the Privacy Policy page's light, document-style theme rather
than the app's dark UI, so the site stays consistent and easy to read. It still
reuses the app's real design assets where they carry meaning:

| Asset | Source |
| --- | --- |
| Destructive red `#c62828` | `front-end/constants/theme.ts`, `front-end/components/auth/delete-account-modal.tsx` |
| Action blue `#0a4d9c` (buttons and links) | Privacy Policy page reference design |
| Body type: proportional system font stack | Privacy Policy page reference design |
| Header wordmark (`Kad` + grey `ence`) | `front-end/components/logo.tsx` |
| Favicon / touch icon / OG card mark | `front-end/assets/images/icon-foreground.png` |
| Error and identity copy | `front-end/components/auth/delete-account-modal.tsx`, `PRIVACY_POLICY.md` |

Design tokens live in `src/styles/global.css` under `:root`, so a palette change
is a one-file edit.

> The app's own header renders the logo as a **wordmark** (`logo.tsx`), not the
> square icon, and the icon is a wide logotype that is illegible at header size.
> The header therefore reproduces the wordmark, while the official icon asset is
> used for the favicons and the social card.

## Local development

Requires Node ≥ 22 and pnpm (the pinned `packageManager`).

```bash
pnpm install

# Terminal 1 — mock backend (so no real API is needed)
pnpm run mock-api

# Terminal 2 — dev server
cp .env.example .env      # PUBLIC_API_BASE_URL=http://localhost:3000
pnpm run dev
```

Open <http://localhost:4321/delete-account/>.

The mock API logs requests by **method and path only** — never the email address
or token — and can simulate failure modes:

```bash
MOCK_MODE=rate-limit   pnpm run mock-api   # 429
MOCK_MODE=server-error pnpm run mock-api   # 500
MOCK_MODE=reject       pnpm run mock-api   # 400
MOCK_MODE=network      pnpm run mock-api   # connection reset
```

Any confirm token starting with `invalid`, `expired` or `used` gets a `400`, so
the invalid-link state is easy to exercise:

```text
/delete-account/confirm/?token=expired-abcdefghijklmnop
```

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `PUBLIC_API_BASE_URL` | yes (build) | Base URL of the Kadence API. Production: `https://kadence.barryph.com`. No trailing slash needed. |
| `SITE_URL` | no | Public site URL used for `<link rel="canonical">` and Open Graph. Production: `https://accounts.kadence.barryph.com`. |

The site and the API are on **different origins** in production
(`accounts.kadence.barryph.com` vs `kadence.barryph.com`), so the backend must
allow the site origin via CORS.

**`PUBLIC_*` variables are public.** Astro inlines them into the static bundle at
build time, so they end up in the shipped JavaScript. Never put a credential,
API key or signing secret in one — there are no secrets in this project by
design.

Production requests must use `https://`. Plain `http://` is accepted only for a
loopback host so the site can be developed against a local backend; anything
else is refused client-side with a generic error. URLs carrying credentials
(`https://user:pass@host`) are rejected too.

## Backend integration

The site calls two public, unauthenticated endpoints on the Kadence API: one to
request a deletion link for an email address, one to confirm deletion with the
emailed token. The routes are defined in `src/lib/config.ts`; all transport and
response handling lives in `src/lib/api.ts`.

The site reads only status codes, never a response body, so the request outcome
is neutral and cannot reveal whether an account exists. The confirm token is
sent in the request body, never a URL. Failures surface as one of three
user-facing states: an unusable link, too many requests, or a temporary problem.

What the backend must provide is in
[`docs/backend-requirements.md`](docs/backend-requirements.md); the site's side
of the integration is in
[`docs/account-deletion-api.md`](docs/account-deletion-api.md). The backend
documents its own implementation in
`back-end/docs/external-account-deletion.md`.

The site and API are on different origins in production, so the backend must
allow the site's origin.

## Security model

The frontend is **not** an authorization boundary — the backend verifies
ownership and authorizes the deletion. What this site guarantees:

- The email address is never treated as proof of ownership.
- The UI never reveals whether an account exists (identical copy for every
  request outcome; a rejection on the request endpoint is shown as success).
- No credentials or secrets exist in the frontend; no `PUBLIC_*` variable holds
  a secret.
- The deletion token is treated as a credential:
  - it is sent only in a `POST` body over HTTPS, never in a URL;
  - it is never rendered into the DOM, stored in `localStorage`/`sessionStorage`,
    logged, or placed in an analytics call;
  - it is held in a closure and dropped from memory on any terminal state;
  - it is stripped from the address bar (`history.replaceState`) after a
    successful deletion;
  - `<meta name="referrer" content="no-referrer">` stops it leaking through the
    `Referer` header.
- Requests use `credentials: 'omit'`, `redirect: 'error'`, `cache: 'no-store'`
  and a 20 s timeout; the client refuses to call a misconfigured or insecure
  base URL rather than failing silently.
- Duplicate submissions are prevented in the UI, and the submit control is
  disabled and marked `aria-busy` while a request is in flight.
- The confirmation route is `noindex, nofollow` and disallowed in
  `public/robots.txt`.

## Testing

```bash
pnpm run typecheck   # astro check (zero errors, zero warnings)
pnpm run test        # 57 unit tests (vitest + jsdom)
pnpm run build       # static build into dist/
pnpm run test:e2e    # 24 real-browser checks (Chromium + mock API)
pnpm run check       # typecheck + unit tests + build
```

- **Unit tests** (`src/lib/__tests__/`) cover email
  validation, every status-code mapping, credential hygiene (nothing is ever
  logged), and each loading/success/error transition of both controllers against
  real jsdom nodes.
- **`pnpm run test:e2e`** builds the site against the mock API and drives the
  *built pages* in headless Chromium: the request flow, the whole confirmation
  flow, token-in-body-not-URL, token-absent-from-DOM, no horizontal overflow at
  320–1280 px, ≥44 px touch targets, ≥16 px input font size, and an assertion
  that the request page shares the policy page's light theme. It also covers the
  Privacy Policy page — Markdown rendering, one `h1`, no skipped heading levels,
  a white background with near-black text and a non-mono body font, no horizontal
  overflow at 320–1280 px, and the footer link. It needs a Chromium/Chrome
  binary (`CHROME_BIN` overrides detection).

There is no separate ESLint/Prettier config: `astro check` runs full TypeScript
diagnostics over `.astro` and `.ts` files, and the codebase deliberately has no
build-step dependencies beyond Astro and the type checker.

## Deployment to GitHub Pages

The site builds to plain HTML/CSS/JS with no server-side features, so GitHub
Pages can serve it directly from an artifact.

### One-time setup

1. **Create the repository and push** this directory as its own repository:

   ```bash
   git init -b main
   git add .
   git commit -m "feat: Kadence account deletion site"
   git remote add origin git@github.com:<owner>/<repo>.git
   git push -u origin main
   ```

2. **Enable Pages** — *Settings → Pages → Build and deployment → Source:
   **GitHub Actions***.

3. **Set the API URL (optional override)** — the workflow already defaults to
   the production values below, so nothing is required for a standard deploy.
   To point at a different backend, set a repository variable in *Settings →
   Secrets and variables → Actions → Variables*:

   | Variable | Required | Default |
   | --- | --- | --- |
   | `PUBLIC_API_BASE_URL` | no | `https://kadence.barryph.com` |
   | `SITE_URL` | no | `https://accounts.kadence.barryph.com` |

   A build with no API URL at all (e.g. plain `pnpm run build` without `.env`)
   cannot submit anything; the site surfaces a clear "misconfigured" message
   rather than failing silently.

4. **Allow the origin on the backend** — the site origin
   (`https://accounts.kadence.barryph.com`; scheme + host + port, no path) must
   be allowed by the API's CORS configuration. Note this differs from the API
   host itself.

### Custom domain

The site is served at `https://accounts.kadence.barryph.com`. That is pinned by
`public/CNAME` (which GitHub Pages copies into the build) and by the default
`SITE_URL` in `.github/workflows/deploy.yml`. To move it, change both, then
configure the DNS records GitHub documents.

The build always uses `/` as the base path, so the site must be served from the
root of its domain — a custom domain, not a repository sub-path.

### Why it deploys cleanly

- `astro.config.mjs` sets `output: 'static'` — no adapter, no Node runtime.
- The site is always served from the domain root (`base: '/'`, Astro's default),
  so internal links and public assets use plain root-relative paths.
- `public/.nojekyll` is included so the `_astro/` asset directory is served even
  if Pages ever falls back to Jekyll processing.
- `dist/` contains no secrets and no environment-specific URLs beyond the public
  `PUBLIC_API_BASE_URL`.

## Project layout

```text
├── .github/workflows/
│   ├── ci.yml                     # typecheck + tests on PRs
│   └── deploy.yml                 # build + deploy to GitHub Pages on main
├── docs/
│   ├── backend-requirements.md    # plain-language backend requirements
│   └── account-deletion-api.md    # the site's side of the integration
├── public/                        # favicons, OG image, robots.txt, .nojekyll
├── scripts/
│   ├── e2e-smoke.mjs              # headless-Chromium end-to-end checks
│   ├── mock-api.mjs               # mock backend for local/e2e use
│   ├── generate-og-image.mjs      # optional OG card renderer (pnpm og:image)
│   ├── lib/browser.mjs
│   └── og/og-image.html           # OG card source template
├── src/
│   ├── components/                # Header, Footer, Icon
│   ├── content/
│   │   └── privacy-policy.md      # Privacy Policy text (plain Markdown)
│   ├── layouts/BaseLayout.astro   # <head>, metadata, page shell
│   ├── lib/
│   │   ├── api.ts                 # typed client — the only network code
│   │   ├── config.ts              # endpoint paths + base-URL policy
│   │   ├── delete-request-form.ts # request-page controller
│   │   ├── delete-confirm.ts      # confirmation-page controller
│   │   ├── dom.ts, email.ts
│   │   └── __tests__/             # unit tests
│   ├── pages/
│   │   ├── index.astro            # redirects to /delete-account/
│   │   ├── 404.astro
│   │   ├── privacy-policy.astro   # renders src/content/privacy-policy.md
│   │   └── delete-account/
│   │       ├── index.astro
│   │       └── confirm.astro
│   └── styles/global.css          # design tokens + all styling
├── astro.config.mjs
└── package.json
```

Page markup lives in `.astro` files; all behaviour lives in `src/lib/*.ts` so it
can be unit-tested without a browser or backend. Pages only wire the two
together.

## Accessibility and responsiveness

- Semantic landmarks (`header`, `main`, `footer`), one `h1` per page, a working
  skip link.
- Every input has a real `<label>`; help and error text are wired up with
  `aria-describedby` and `role="alert"`, and invalid fields get `aria-invalid`.
- Status changes move focus to the new panel heading and announce assertively;
  the inactive panels use `hidden`, so they leave the accessibility tree.
- State is never conveyed by colour alone — every state has an icon **and** text.
- Visible `:focus-visible` outlines on all interactive elements, 3:1+ contrast
  against the white surface.
- One light theme across the site: dark text on white, a proportional font, a
  dark-blue focus ring for contrast on white, and heading structures with no
  skipped levels. The Privacy Policy page adds only a wider measure for
  long-form reading.
- Mobile-first layout with `env(safe-area-inset-*)` padding, ≥44 px touch
  targets, 16 px form-input text (prevents iOS zoom-on-focus), and no horizontal
  overflow from 320 px upwards.
- `prefers-reduced-motion: reduce` disables the panel transitions and spinner
  rotation; loading is still communicated by the button label.

## Known follow-ups

- **End-to-end coverage uses a mock.** `pnpm run test:e2e` runs against
  `scripts/mock-api.mjs`, not a real backend. Before a release that changes the
  flow, run the manual checks in
  [`docs/account-deletion-api.md`](docs/account-deletion-api.md) against a
  running backend.
- Keep the Privacy Policy's Markdown and the version string in the app's own
  records in sync when the policy changes.
