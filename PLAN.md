# PLAN

Phase-by-phase task list. Every phase ends with the gate: `npm run lint`, `npm run typecheck`
and `npm test` all pass, plus that phase's own checks, then a written report. No phase starts
before the previous gate passes.

Status: **Phases 0–6 complete and gated. Live calls blocked on RECONCILE #16; Docker build on #18.**

| Phase | Title | Status |
|---|---|---|
| 0 | Recon and plan | done — approved |
| 1 | Scaffold and auth gate | done — gate passed |
| 2 | Data, roles and UI on fixtures | done — gate passed |
| 3 | Claude adapter and refresh pipeline | built, gate passed — live smoke pending |
| 4 | Sponsorship and tracker extras | done — gate passed |
| 5 | Settings, keys and multiple providers | built, gate passed — live Test calls pending #16 |
| 6 | Hardening and deploy | done — gate passed (image build unverified, #18) |
| 7 | Structured job sources (optional) | not started — needs your go-ahead |

---

## Phase 0 — Recon and plan ✅

- [x] Read the reference prototype end to end (792 lines: design tokens, layout, merge and
      retention logic, parser, filter behaviour, mobile breakpoint at 880px).
- [x] Verify the Anthropic Messages API, web search tool versions, response shape, error and
      `pause_turn` semantics, and the models endpoint.
- [x] Verify the OpenAI Responses API web search tool, the `sources` include option, and the
      models endpoint.
- [x] Verify the Gemini grounding surface, tool key, response shape, auth and models endpoint.
- [x] Verify the gov.uk sponsor register page, the CSV link pattern and the real column headers
      by downloading the live file.
- [x] Verify current published versions of every planned dependency.
- [x] Write `docs/provider-notes.md`, `RECONCILE.md`, `PLAN.md`, `CLAUDE.md`.
- [x] RECONCILE #1 decided: git left alone for now — no `git init`, no per-phase commits.
- [x] RECONCILE #4 decided: Gemini returns publisher URLs, so no redirect resolution needed.
- [x] **Approved — Phase 1 started.**

---

## Phase 1 — Scaffold and auth gate ✅

**Build**
- Next.js 16 App Router, TypeScript `strict`, `output: "standalone"`. Not serverless — refresh
  runs take minutes.
- Tooling: ESLint, `tsc --noEmit`, Vitest, Playwright. Scripts: `dev`, `build`, `start`, `lint`,
  `typecheck`, `test`, `test:e2e`, `db:generate`, `db:migrate`.
- `src/lib/env.ts` — zod-validated env loader, fails fast on missing `SITE_PASSWORD` or
  `APP_SECRET` (and on an `APP_SECRET` under 32 bytes).
- Session cookie: HMAC-signed with `APP_SECRET`, carrying a fingerprint of the current
  `SITE_PASSWORD`. `httpOnly`, `Secure` in production, `SameSite=Lax`, `Max-Age` 400 days,
  re-issued on every visit so it slides.
- `middleware.ts` protecting every page and API route except `/login`, `POST /api/login` and
  static assets.
- Login page matching the prototype's type and colour tokens.
- Rate limiter: 5 failures per 15 min per IP, then 429 with a plain message naming the time she
  can try again. DB-backed so it survives restart.
- Timing-safe password comparison (`crypto.timingSafeEqual`).
- Origin check helper for state-changing requests.

**Tests (per the brief)**
- Wrong password rejected; correct password sets the cookie.
- Protected pages redirect; protected APIs return 401.
- A valid cookie survives a server restart (signature is derived from `APP_SECRET`, not
  in-memory state).
- Changing `SITE_PASSWORD` invalidates existing cookies.
- The rate limit triggers on the 6th failure and not the 5th.

**Gate**: ✅ `npm run lint` clean, `npm run typecheck` clean, `npm test` 34/34 passing.
Also verified beyond the gate: `npm run build` succeeds, and an HTTP smoke test against a real
production server confirmed the redirect, the 401, the 403 origin block, the 429 on the 6th
failure, cookie survival across a restart, and sign-out on a SITE_PASSWORD change.

---

## Phase 2 — Data, roles and UI on fixtures ✅

**Build**
- Drizzle schema + migrations for `settings`, `roles`, `jobs`, `api_keys`, `refresh_runs`,
  `usage_daily`, `sponsor_register`, `meta`, plus a `login_attempts` table for Phase 1's
  limiter. Seed the three roles and the default scope.
- Roles CRUD: `GET|POST|PATCH|DELETE /api/roles`, max 10, rename / keywords / colour / enabled
  / reorder / delete-with-confirm. Deleting a role moves tracked jobs to Archived and deletes
  untracked ones.
- `GET /api/jobs`, `PATCH /api/jobs/:id` (status and notes only — nothing else writable).
- `GET|PATCH /api/settings`.
- The full board UI against a mock provider returning fixture listings: hero headline built from
  role names, tabs with colour dots and counts, tracker table, "New" badges, status dropdown,
  per-role progress chips, mobile stacking below 880px. Design tokens and fonts copied from the
  prototype.
- Every filter in brief 2.6: role tabs, location multi-select + free text, work mode chips,
  contract chips + "include unstated hours", sponsorship select, text search, status view,
  hide-closed, sort. Active-filter count, "Clear filters", persisted to localStorage and
  mirrored in the URL query string.
- Tracker: seven statuses, automatic `applied_at` on first Applied, inline notes.

**Tests**
- Merge rules: new listing sets `first_seen`; existing gets `last_seen` and empty-field fill
  without overwriting status or notes.
- Retention: untracked dropped when closed or unseen 21 days; tracked always kept.
- "New" badge: driven by `seen_up_to`; no badges on the very first visit.
- Every filter, and combinations, over a fixture set.
- Role deletion moves tracked jobs to Archived and deletes untracked ones.

**Gate**: ✅ lint clean, typecheck clean, `npm test` 106/106. Also verified: production build
succeeds with a minimal standalone output; an HTTP smoke test ran the full loop (login → visit
refresh → poll → 13 listings from 15 fixtures with the duplicate merged and the closed one
retired → add role → single-role search → status + note → delete role → archived); and a headless
browser pass captured the board, filtered board, mobile layout and settings with zero console
errors and filters surviving a reload.

---

## Phase 3 — Claude adapter and refresh pipeline

**Build**
- `src/lib/search/prompt.ts` — the single place the LLM output contract lives.
- Anthropic adapter implementing `JobSearchProvider`: `web_search_20260318`,
  `response_inclusion: "excluded"`, `max_uses: 5`, `user_location` Edinburgh/GB, `pause_turn`
  continuation loop with a cap, error-object-vs-array branch, `citedUrls` from both
  `web_search_tool_result` URLs and text-block citations.
- Shared pipeline, in order: parse (last-tool-block text, strip fences, find the array,
  truncation salvage, per-item zod, count drops) → normalise (work mode, contract, sponsorship,
  ISO dates, GBP salary min/max) → canonical URL (strip `utm_*` and fragment, http(s) only) →
  citation check → link check (GET, 8s, browser UA; drop 404/410, `verified` on 2xx/3xx,
  `unverified` on 401/403/429/timeout) → dedupe (canonical URL, then org+title) → upsert.
- Refresh orchestration: DB-backed lock stale after 10 min, cooldown, daily cap that applies
  only to the default key, concurrency limit of 3, progress in `refresh_runs`,
  `POST /api/refresh` + `GET /api/refresh/:id` polled every 2s.
- Immediate single-role search when a role is created.
- `seen_up_to` updated server-side when a refresh completes.

**Tests** — recorded fixtures only, no live calls: a truncated response, prose before the JSON,
invalid items mixed with valid ones, a 404 link, a 403 link, a search-error response object, a
`pause_turn` continuation.

**Live check**: exactly one smoke refresh with your key. Report listings found, drops at each
pipeline step, token and search usage, and run time.

**Gate**: ✅ lint clean, typecheck clean, `npm test` 136/136, build clean. Live smoke refresh:
pending — needs `ANTHROPIC_API_KEY` in `.env`.

---

## Phase 4 — Sponsorship and tracker extras ✅

**Build**
- Register download: fetch the publication page, extract the current `.csv` link, download,
  parse (trim leading spaces), store `org_name`, `org_norm`, `town`, `county`, `rating`,
  `route` keyed on (`org_norm`, `route`). Refresh on startup if older than 7 days, then weekly.
- Matching: normalise (lowercase, strip punctuation, drop `ltd`/`limited`/`plc`/`the`/`cic`/
  `llp`/`trust` and similar), exact normalised match first, then token-set similarity ≥ 0.92.
  Store the matched register name.
- UI: listing-derived sponsorship status, a separate "Licensed sponsor" badge with the tooltip
  from the brief, and the four sponsorship filter options.
- Graceful degradation: if the register can't be downloaded the app still works, the UI says the
  register is unavailable and the licensed-sponsor filter option is disabled.
- Notes field and "Export tracked roles (CSV)" (`GET /api/export.csv`).

**Tests**: name normalisation; exact and fuzzy thresholds including deliberate false-positive
pairs that must **not** match (e.g. "Edinburgh Art Trust" vs "Edinburgh Arts Trust Ltd" — I will
agree the list with you); register-unavailable behaviour.

**Gate**: ✅ lint clean, typecheck clean, `npm test` 180/180, build clean. Live register download
(`npm run sponsor:check`): 148,554 rows in ~1.5–8 s; 11 of 20 real creative-sector names
matched, all correct, all misses confirmed absent; 20 ms per lookup. (No Phase 3 live listings
existed to score against, so the check uses a fixed list of real organisation names.)

---

## Phase 5 — Settings, keys and multiple providers ✅ (live calls pending)

**Build**
- AES-256-GCM key storage: HKDF from `APP_SECRET`, unique IV per record, store ciphertext, IV,
  tag, last4. Decrypt only at call time. `PUT|DELETE /api/keys/:provider`.
- Settings page sections: Search (sector, locations, notes, role management), AI model
  (provider, model dropdown, custom model ID, Test button), API keys (status, add/replace,
  remove), Refresh (cooldown, usage, last run detail), Session (sign out).
- `GET /api/models/:provider` proxy with a 24h cache; `POST /api/models/test`.
- OpenAI adapter (Responses API, `web_search`, `include: ["web_search_call.action.sources"]`)
  and Gemini adapter (Interactions API, `google_search`, `x-goog-api-key` header) — both
  feeding the same shared pipeline.
- Providers with neither a default nor a user key render disabled with a one-line explanation.

**Tests**: encryption round trip; **no key appears in any API response** — asserted across every
route, not just the keys route; provider-disabled state; the daily cap applies only when the
default key is in use.

**Live check**: one Test call per provider that has a key available. Report results.

**Gate**: ✅ lint clean, typecheck clean, `npm test` 199/199, build clean. Live Test calls: the
Anthropic key is organisation-level and needs `ANTHROPIC_WORKSPACE_ID` (RECONCILE #16); no
OpenAI or Gemini key is set. `npm run smoke:test -- <provider>` runs each one once unblocked.

---

## Phase 6 — Hardening and deploy ✅

**Build**
- Security headers (CSP, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `X-Robots-Tag: noindex, nofollow`) plus the noindex meta tag.
- Log redaction for `Authorization`, `x-api-key`, `x-goog-api-key`; never log provider request
  bodies.
- String-length caps on every LLM-derived field; all rendering as text (no
  `dangerouslySetInnerHTML`); outbound links http(s) only with `rel="noopener noreferrer"`.
- Error and empty states; mobile and accessibility pass (visible focus, labelled controls,
  `aria-live` on refresh progress, `prefers-reduced-motion`).
- Dockerfile + docker-compose with a volume for `/data`; deploy docs for one always-on host with
  persistent storage (Railway or Fly.io) plus local run instructions.
- `README.md` (for you) and `HOW-TO-USE.md` (for her — plain language, one page).

**Tests**: Playwright smoke — log in once, reload without being asked again, add a role against
the mock provider and see its tab, apply a sponsorship filter, set a status, reload and confirm
it persisted.

**Gate**: ✅ lint clean, typecheck clean, `npm test` 203/203, build clean, Playwright smoke
2/2 with zero console errors (so the nonce CSP is clean in production). Docker: daemon not
running here (RECONCILE #18); the standalone layout the Dockerfile produces was staged and run
by hand — headers, static assets, database on a volume, migrations all confirmed.

---

## Phase 7 — Structured job sources (optional)

Not started, and I will ask before starting it. Would add Reed and/or Adzuna adapters feeding
the same pipeline, labelled by source, after checking their current docs, terms and free-tier
limits. LLM search then covers the niche creative boards those APIs don't reach.
