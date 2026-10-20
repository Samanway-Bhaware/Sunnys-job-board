# sunnynunny — a private job board

A single-user, password-gated board that finds creative-industry communications, marketing and
business development roles with an LLM web search, stores them, and lets one person filter and
track applications. Every LLM call is server-side; no key ever reaches the browser.

- **For her:** [HOW-TO-USE.md](HOW-TO-USE.md) — one page, plain language.
- **For you:** this file, [docs/deploy.md](docs/deploy.md), [CLAUDE.md](CLAUDE.md)
  (architecture and rules), [PLAN.md](PLAN.md) (what was built, phase by phase),
  [RECONCILE.md](RECONCILE.md) (everywhere reality differed from the brief), and
  [docs/provider-notes.md](docs/provider-notes.md) (verified API shapes).

## Quick start

```bash
npm install
cp .env.example .env         # set SITE_PASSWORD, APP_SECRET, ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

No key yet? Add `USE_MOCK_PROVIDER=1` to `.env` and the board runs on fixture listings.

```bash
npm run lint && npm run typecheck && npm test   # the gate: 200+ tests, no live calls
npm run test:e2e                                # builds, then a Playwright smoke test
npm run smoke:test -- anthropic                 # ONE live Test call (reads .env)
npm run smoke:refresh                           # ONE live refresh into ./data/jobs.db
npm run sponsor:check                           # live gov.uk register download + match report
```

## How it works, in one paragraph

On page load the browser posts `/api/refresh {trigger:"visit"}`; the server runs a refresh only
if the last one is older than `REFRESH_COOLDOWN_MINUTES`. A refresh makes one provider call per
enabled role (three at a time) under a DB lock, and each call's plain-text JSON goes through one
shared pipeline: parse (with truncation salvage) → normalise → canonical URL → citation check →
link check → sponsor-register match → merge (dedupe on URL, then org+title; never touching her
status or notes) → retention. Progress is polled every two seconds. Filters run entirely in the
browser over the stored data, and persist to localStorage and the URL.

## Providers

| Provider | API | Web search | Status |
|---|---|---|---|
| Claude (Anthropic) — default | Messages | `web_search_20260318`, falls back to `20250305` | built; live smoke pending [RECONCILE #16](RECONCILE.md) |
| ChatGPT (OpenAI) | Responses | `web_search` + `include: web_search_call.action.sources` | built; needs a key |
| Gemini (Google) | Interactions | `google_search` | built; needs a key |

She can add her own key per provider in Settings (AES-256-GCM at rest); the daily cap applies
only to your default key.

## Environment

See [`.env.example`](.env.example). `SITE_PASSWORD` and `APP_SECRET` are required; the server
refuses to start without them. `ANTHROPIC_WORKSPACE_ID` is only needed for an organisation-level
Anthropic key.

## Security, briefly

Timing-safe password check, 5 failures / 15 min / IP rate limit, HMAC-signed sliding cookie
bound to the current password, Origin check on every state-changing request, nonce-based CSP
with `frame-ancestors 'none'`, `noindex` everywhere, key redaction in logs, string caps on
everything the LLM can influence, formula-safe CSV export. Details in
[CLAUDE.md](CLAUDE.md#security-rules-non-negotiable--ask-before-changing-any-of-these).

## Status

Phases 0–6 built and gated. Two live checks are waiting on the workspace ID
(RECONCILE #16). Phase 7 (Reed/Adzuna structured sources) is optional and not started.
