# RECONCILE log

Discrepancies between the build prompt's assumptions and what was actually found, plus
anything deferred. Each item states what was assumed, what was found, and the proposed change.

Items marked **NEEDS YOUR DECISION** change product behaviour or touch something the standing
instructions say I must ask about. I will not act on those without your say-so.

Status key: `open` (awaiting your decision) · `proposed` (my plan, will proceed unless you
object) · `resolved` · `deferred`.

---

## [RECONCILE #1] The git repository root is your whole Desktop — `deferred`

**Assumed**: `/Users/samanway/Desktop/sunnynunny` is its own repo; "commit at the end of each
phase" is safe.

**Found**: `git rev-parse --show-toplevel` returns `/Users/samanway/Desktop`. This project sits
inside a repo that also contains unrelated work (an `ADBS/LightDB` Java project), whose working
tree currently shows ~40 staged deletions. Committing from here would sweep those deletions
into my commit.

**Proposed**: run `git init` in `/Users/samanway/Desktop/sunnynunny` so this project has its own
history, and never commit to the Desktop repo.

**Your decision (2026-09-11): leave git alone for now.** So, until you say otherwise:

- I will **not** run `git init`, `git add`, `git commit` or any other git write command.
- The brief's "commit at the end of each phase" step is **suspended**, and the "main branch must
  always run" rule has nothing to apply to. Phase gates are otherwise unchanged — lint,
  typecheck and test still have to pass before the next phase starts.
- The practical cost: no per-phase checkpoints, so there is nothing to roll back to if a later
  phase goes wrong. Worth revisiting before Phase 3, which is the first phase that rewrites data
  the earlier phases produced.

Re-raise this whenever you want it turned back on; it is a one-command change.

---

## [RECONCILE #2] Anthropic web search tool version is two generations stale — `proposed`

**Assumed**: the prototype's `web_search_20250305`.

**Found**: three versions now exist — `web_search_20250305` (basic), `web_search_20260209`
(dynamic filtering), `web_search_20260318` (adds `response_inclusion`).

**Proposed**: use `web_search_20260318`. Dynamic filtering keeps irrelevant search content out
of the context window on a workload that is one search call per role. Requires Claude 4.6+;
the adapter falls back to the basic tool automatically if a model rejects it.

**Amended at implementation (Phase 3)**: I had also proposed `response_inclusion: "excluded"`
to save output tokens. Dropped — it removes the search-result blocks that carry the retrieved
URLs, and those are what the brief's citation check (2.5 step 4) needs. Kept the default.
Recorded in `docs/provider-notes.md` §1.

---

## [RECONCILE #3] Model IDs in the prototype are superseded — `proposed`

**Assumed**: `claude-sonnet-4-6` (from the prototype).

**Found**: current IDs are `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`,
`claude-opus-4-8`, `claude-fable-5-1`.

**Proposed**: leave `DEFAULT_MODEL` empty in `.env.example` as the brief specifies, and resolve
it at runtime from the list-models endpoint, preferring `claude-sonnet-5` for this workload
(search-heavy, short structured output, run up to 20x/day). You can override in Settings.

---

## [RECONCILE #4] Gemini's current surface is the Interactions API, not `generateContent` — `proposed`

**Assumed**: Section 5 of the brief — "Gemini: generateContent with Google Search grounding."

**Found**: the current Gemini docs lead with an **Interactions API**
(`ai.interactions.create({ model, input, tools: [{ type: "google_search" }] })`) returning a
`steps` array and a `model_output` step with `url_citation` annotations. `generateContent` still
exists at `v1beta/{model}:generateContent`, but the grounding guide, the tool shape and the
response shape are all documented against Interactions.

**Proposed**: build the Gemini adapter on the Interactions API. This changes only the adapter's
internals — the `JobSearchProvider` interface and everything downstream are unaffected. Flagging
it because it contradicts the brief's architecture section directly.

**Redirect-URL sub-question — resolved by you (2026-09-11): Gemini returns publisher URLs**,
not `vertexaisearch.cloud.google.com/grounding-api-redirect/...` URLs. The docs are silent on
this, so this is recorded on your authority rather than from a doc URL.

That means the Gemini adapter treats `url_citation.url` as a real listing URL — it feeds the
canonical-URL step and the citation check directly, with no redirect resolution.

Because getting this wrong would be expensive and silent (stored listings would carry redirect
links she'd click, and every citation check would come back `cited: false`), the Phase 5 adapter
carries a cheap assertion rather than a bare assumption: if a citation host matches a known
grounding-redirect pattern, the run logs a warning and the item is recorded `cited: false`
instead of being trusted. It costs one hostname check and turns a silent failure into a visible
one. If it never fires, it never does anything.

---

## [RECONCILE #5] OpenAI: better citation data available than the brief assumed — `proposed`

**Assumed**: pipeline step 4 is best-effort ("*If* the provider returns the source URLs it
actually retrieved").

**Found**: the Responses API accepts `include: ["web_search_call.action.sources"]`, which
returns the full list of URLs consulted, separate from inline citations. Also: the current tool
type is `web_search`; `web_search_preview` is legacy. And `platform.openai.com/docs/*` now
301-redirects to `developers.openai.com/api/docs/*`.

**Proposed**: use the `include` option so OpenAI's citation check is as strong as Anthropic's.
No behaviour change, just a better-populated `cited` field.

---

## [RECONCILE #6] No provider supports JSON mode together with web search — `proposed`

**Assumed**: the brief already anticipated this ("Some providers don't allow structured-output
or JSON mode together with search or grounding").

**Found**: confirmed for all three. Anthropic's citations are always on for web search and are
documented as incompatible with `output_config.format`. Neither OpenAI's web search guide nor
Gemini's grounding guide addresses structured output — it is absent from both feature lists.

**Proposed**: as the brief directs — every adapter requests a JSON array in plain text and the
single shared parser does truncation salvage and per-item zod validation. Recorded in
`docs/provider-notes.md` section 4.

---

## [RECONCILE #7] Sponsor register has more columns than the data model — `proposed`

**Assumed**: `sponsor_register` holds `org_name, org_norm, town, route`.

**Found** (verified by downloading the live file's first bytes on 2026-09-11):
`Organisation Name,Town/City,County,Type & Rating,Route`.

**Proposed**: add `county` and `rating` to the table. `rating` (e.g. `Worker (A rating)`) is
worth surfacing later — an A-rated sponsor is a meaningfully different signal from a B-rated
one — and dropping it now would mean a migration later. Three further findings that are
implementation facts rather than choices, all recorded in `docs/provider-notes.md` section 5:

- Every value carries a **leading space**; without trimming, every name match fails.
- Organisations **repeat once per route**, so the table is keyed on (`org_norm`, `route`) and
  matching uses `DISTINCT` on `org_norm`.
- The file updates **nearly every weekday**, not weekly. The brief's 7-day staleness rule still
  holds; it just means we are never more than a week behind a daily-moving file.
- `HEAD` returns a zero-length body — probe with a ranged GET.

---

## [RECONCILE #8] Role colour palette is shorter than the role cap — `proposed`

**Assumed**: the prototype's `CAT_COLORS` palette carries the design.

**Found**: it holds 6 colours and the prototype caps roles at 6. The brief allows **10** roles,
so roles 7-10 would reuse colours 1-4 and two tabs would share a dot colour.

**Proposed**: extend the palette to 10 distinct colours in the same muted register as the
original six, keeping the first six byte-identical so the seeded roles look exactly like the
prototype.

---

## [RECONCILE #9] Prototype's source list includes LinkedIn; the brief excludes it — `resolved`

**Found**: the prototype's search prompt suggests LinkedIn as a source. The brief's Section 2.5
source list omits it and Section 7 lists scraping LinkedIn as a non-goal.

**Resolved**: following the brief — LinkedIn is not in `src/lib/search/prompt.ts`. (Note for the
record: an LLM's own web search reading a public page is not the same act as us scraping
LinkedIn, but the brief is explicit and the list loses nothing by dropping it.)

---

## [RECONCILE #10] Web search is billed per search, which makes `max_uses` a real cost control — `proposed`

**Found**: Anthropic bills web search at **$10 per 1,000 searches** on top of tokens. One
refresh is one call per enabled role, and each call may run several searches. At
`DAILY_REFRESH_CAP=20` with 3 roles and no cap on searches per call, a heavy day could run well
into hundreds of searches.

**Proposed**: set `max_uses: 5` per role call. Worst case becomes 20 x 3 x 5 = 300 searches
(~$3/day) plus tokens, and at the 10-role cap 20 x 10 x 5 = 1,000 searches (~$10/day). If you
want a tighter ceiling, the lever is `DAILY_REFRESH_CAP`, `max_uses`, or the role cap — tell me
which and I will set it. Surfaced in Settings > Refresh as today's usage against the cap.

---

## [RECONCILE #11] Dependency majors are ahead of common assumptions — `resolved`

**Found**: `zod` is on 4.6.2 and `vitest` on 5.0.0; Next.js is 16.3.4, React 19.3.0. Both zod
and vitest have shapes that differ from what is most often written from memory.

**Resolved**: versions pinned and recorded in `docs/provider-notes.md` section 6. Code will be
written against the installed types, and the typecheck gate will catch any drift.

---

## [RECONCILE #12] Next.js 16 renamed `middleware.ts` to `proxy.ts` — `proposed`

**Assumed**: the brief's section 2.1 — "Middleware protects every page and API route except
the login page, the login API and static assets."

**Found**: Next.js 16 deprecated the `middleware` file convention and renamed it to `proxy`
(`src/proxy.ts`, exporting a function named `proxy`). Two consequences that matter:

- **Proxy runs on the Node.js runtime and the runtime is not configurable.** The Edge runtime
  is not supported there. This is good news — `node:crypto` is available, so cookie
  verification uses the same HMAC code path as the login route instead of needing a Web Crypto
  variant.
- The Next.js docs carry an explicit warning: a matcher that excludes a path **also skips
  Server Function calls on that path**, so auth must be re-checked inside handlers rather than
  trusted to the gate alone.

**Proposed**: the behaviour the brief asks for is unchanged — only the filename and the export
name differ. Implemented in `src/proxy.ts`, with `requireSession()` in
`src/lib/auth/guard.ts` as the in-handler second check for the Phase 2+ data routes.

Related Next.js 16 changes that shaped the scaffold, all behaviour-neutral: `next lint` was
removed (so `npm run lint` runs `eslint .` directly), `eslint-config-next` ships native flat
config, Turbopack is the default, and `cookies()`/`headers()`/`params`/`searchParams` are now
async-only.

---

## [RECONCILE #13] `next start` does not serve the standalone build — `open`

**Found**: with `output: "standalone"` set (required by the brief's section 5), `next start`
prints: *"next start does not work with output: standalone configuration. Use
`node .next/standalone/server.js` instead."* It does still serve correctly from the project
directory, which is how the Phase 1 smoke test ran, but it is not the artifact we deploy.

The standalone server also needs `.next/static` and `public/` copied in beside it — that
copying is part of the Dockerfile.

**Proposed**: leave `npm start` as `next start` for local "run the production build" checks,
and wire the real standalone launch into the Dockerfile and deploy docs in **Phase 6**, where
the brief already puts that work. Recorded here so it cannot be forgotten at deploy time.

---

## [RECONCILE #14] Two small additions to the brief's env and design, both behaviour-neutral — `proposed`

**`USE_MOCK_PROVIDER=1`** — not in the brief's env list (section 3). It switches the app to the
fixture provider so the board runs with no key and no cost. Used by the test suite, local
development, and the Phase 6 Playwright smoke test (which the brief says runs against "the mock
provider"). Off by default; ignored in production unless set deliberately.

**Global dedupe across roles.** The brief's dedupe rule (2.5 step 6: canonical URL, then org +
title) doesn't say whether it is per-role or across roles. I made it global: a "Marketing and
Communications Officer" found by two role searches is one listing, owned by whichever role saw
it first, so the "All roles" tab never shows the same job twice. The cost is that it appears
under only one role tab. Say if you'd rather see it under both.

**Normalisation moved forward from Phase 3 to Phase 2.** The board needed real
`work_mode` / `contract` / `salary_min` values to exercise the filters, so
`src/lib/search/normalise.ts` (and the parser's core) landed now with tests. Phase 3 still owns
the Anthropic adapter, the link checker, dedupe fixtures, lock, cooldown and cap.

---

## [RECONCILE #15] The fuzzy matcher needs guards beyond "token-set similarity ≥ 0.92" — `proposed`

**Assumed** (brief 2.7): exact normalised match, then "a conservative fuzzy match (token-set
similarity of at least 0.92)".

**Found**: the standard token-set ratio scores **1.0** whenever one name's tokens are a subset
of the other's, so on its own 0.92 is not conservative at all. Running the matcher against the
**live register** (148,554 rows) with real creative-sector names surfaced four false positives
in turn, each fixed and pinned by a test:

| Listing | Wrongly matched | Why | Guard added |
|---|---|---|---|
| Playhouse | Playhouse Nursery Ltd | subset | shared distinctive tokens ≥ 2 |
| Theatre Royal | Royal Lyceum Theatre Company | token sets ignore word order | coverage ≥ 80% of the longer name |
| V&A Dundee | A&M Dundee Ltd | `{a, and, dundee}` counted as three shared tokens | single letters and connectives don't count |
| Citizens Theatre (Glasgow) | York Citizen's Theatre Trust | row's town wrongly discounted | town is discounted only when the listing is in it |

And two false negatives: "Edinburgh International Festival" was hidden behind a 400-candidate
cap because "international" appears in 2,410 rows (candidates are now anchored on the
*rarest* token), and it then matched the Book Festival over the Festival Society (generic
words like "society"/"workshop"/"company" no longer count against coverage; a tie declines).

**Proposed**: keep the 0.92 threshold as specified, with these guards on top. Net effect on the
live check: 11 of 20 real names matched, all 11 correct, all 9 misses confirmed absent from the
register. The matcher would rather miss than guess — the badge's tooltip already says a match
"doesn't guarantee this role is sponsored", and a wrong badge is worse than no badge.

One honest limitation: exact matching can still pair a listing with a same-named but unrelated
company ("Glasgow Life" → "GLASGOW LIFE LTD, East Kilbride" is an exact normalised match and
may or may not be the Glasgow culture charity). That is inherent to name matching without
company numbers, and the brief's exact-first rule is followed as written.

---

## [RECONCILE #16] The Anthropic key in `.env` is organisation-level and needs a workspace ID — `open` — **NEEDS YOUR INPUT**

**Found** (first live call, 2026-09-14): Anthropic's list-models endpoint returned
`400: This API key is not scoped to a workspace, so this request must include the
anthropic-workspace-id header with the ID of the workspace to use.` This applies to every
request from that key, so neither the Test call nor the smoke refresh can run with it as is.

Also found: the `.env` line is written `ANTHROPIC_API_KEY =…` with a space before the `=`.
dotenv tolerates that, so the key loads — but `SITE_PASSWORD` and `APP_SECRET` are still
missing, so the server itself won't boot from `.env` yet.

**Done**: an optional `ANTHROPIC_WORKSPACE_ID` env var (added to `.env.example`), sent as the
`anthropic-workspace-id` header when set; the 400 is mapped to a plain message that says
exactly this. No product behaviour changes.

**Needs you** — either:
1. set `ANTHROPIC_WORKSPACE_ID=<id from Console → Workspaces>` in `.env`, or
2. replace the key with one created inside a workspace.

Then the Phase 3 smoke refresh and Phase 5 Test call can run.

**Disclosure**: while screenshotting the settings page I inadvertently triggered one live
`models.list` call with this key (the page loads the model list on open). It is a free list
endpoint, not a generation call, and it failed with the 400 above. Noting it because the
brief limits live calls and I count every one.

---

## [RECONCILE #17] Gemini returns no list of retrieved URLs — `proposed`

**Assumed** (brief 2.5 step 4): providers may return "the source URLs it actually retrieved".

**Found** in `@google/genai` 2.22.0: `GoogleSearchResultStep.result[]` carries only
`search_suggestions` (an HTML snippet). The only URLs in a Gemini response are the
`url_citation` annotations on the model's answer.

**Proposed**: Gemini's citation check uses those annotations alone. It is a weaker signal than
Anthropic's (result blocks + citations) or OpenAI's (`web_search_call.action.sources` +
citations), so a Gemini-found listing is more likely to show `cited: false`. The redirect-host
guard from RECONCILE #4 sits on the same path. Recorded in `docs/provider-notes.md` §3.

---

## [RECONCILE #18] The Docker image could not be built here — `open`

**Assumed** (brief 9, definition of done): "The Docker image builds and runs with a persistent
volume."

**Found**: Docker Desktop is installed on this machine but the daemon was not running, and I
don't start applications on your machine. So the image is **unverified**.

**What was verified instead**: the exact layout the Dockerfile produces — `.next/standalone` +
`.next/static` + `public` + `drizzle` — staged into a clean directory and run with
`node server.js` against a separate "volume" directory: 56 MB, security headers present,
static assets served, database created on the volume, all migrations applied. The Dockerfile
uses `node:22-bookworm-slim` (glibc) precisely so `better-sqlite3` installs from a prebuilt
binary with no native toolchain.

**Needs you**: start Docker Desktop and run `docker compose up --build`. If the build fails, the
first suspect is the `better-sqlite3` prebuilt download inside the build stage.

---

## [RECONCILE #19] CSP: strict scripts, but styles keep `'unsafe-inline'` — `proposed`

**Assumed** (brief 4.5): "CSP" — unspecified strictness.

**Found**: the board sets per-role colours through inline `style` attributes (the prototype's
`--cat` / `--tabc` custom properties). Nonces don't apply to `style` *attributes*, and a nonce in
`style-src` makes browsers ignore `'unsafe-inline'`.

**Proposed**: `script-src 'self' 'nonce-…' 'strict-dynamic'` (strict — a fresh nonce per
request that Next.js stamps onto its own inline scripts) with `style-src 'self' 'unsafe-inline'`.
Script injection is the attack that matters; style injection on a private, single-user page is
not a meaningful risk. The Playwright smoke test fails on any console error, so a CSP violation
in the production build would be caught. Refactoring the colours to per-role CSS classes would
remove the exception if you'd rather.

---

## [RECONCILE #14 — addendum] One more dev/test env switch

`SPONSOR_REGISTER_REFRESH=0` disables the scheduled gov.uk download. Added because the e2e
suite otherwise pulled the 10 MB register from gov.uk on every run — the app was doing exactly
what it should, five seconds after boot. Default on; only the Playwright config sets it.

---

## Deferred

- **Phase 3 live smoke refresh and Phase 5 live Test calls** — blocked on RECONCILE #16 (the
  Anthropic key needs a workspace ID; no OpenAI or Gemini key is set). Scripts are ready:
  `npm run smoke:refresh`, `npm run smoke:test -- <provider>`.
- **Docker image build** — blocked on the Docker daemon (RECONCILE #18).
- **Phase 7** (Reed/Adzuna) — optional, not started, per the brief's "ask me first".
