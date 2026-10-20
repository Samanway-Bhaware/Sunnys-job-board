# Provider notes

Verified against live documentation on **2026-09-11**. Re-verify before implementing each
adapter (Phase 3 for Anthropic, Phase 5 for OpenAI and Gemini). Do not trust memory for
model IDs or tool version strings — all three providers changed them within the last year.

Standing decision for all three providers: **we do not use structured output / JSON mode.**
See "JSON mode vs. web search" below. Every adapter asks for a JSON array in plain text and
feeds the result to the one shared parser in `src/lib/search/parse.ts`.

---

## 1. Anthropic (Claude) — primary provider

**Docs**
- Web search tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- Server tools / `pause_turn`: https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools
- Models API: https://platform.claude.com/docs/en/api/models (also `client.models.list()`)
- SDK: `@anthropic-ai/sdk` (verified published version 0.125.0)

**Endpoint**: `POST /v1/messages` — `client.messages.create()`.

**Web search tool — THREE versions exist. The brief and the prototype both name a stale one.**

| `type` | Notes |
|---|---|
| `web_search_20250305` | Basic search. Every result lands in the context window. |
| `web_search_20260209` | Adds *dynamic filtering* — Claude writes code that filters results before they enter context. |
| `web_search_20260318` | Adds `response_inclusion` to drop echoed raw search blocks. **Newest.** |

`name` is always `web_search`.

The reference prototype uses `web_search_20250305` with `claude-sonnet-4-6`. Both are
superseded — see RECONCILE #2 and #3.

**Chosen version: `web_search_20260318`, with `response_inclusion` left at its default
(`"full"`).** Dynamic filtering cuts input tokens on search-heavy turns (one search call per
role, up to 10 roles per refresh). `response_inclusion: "excluded"` was considered and
**rejected at implementation time**: it drops the `web_search_tool_result` blocks, which are
where the retrieved URLs live — and those feed the brief's citation check (2.5 step 4). The
model's final answer is a JSON array, which may carry no text citations at all, so the result
blocks are the only reliable source of "what did it actually retrieve". Saving output tokens
was not worth losing that signal. Requires Claude 4.6+; the adapter falls back to
`web_search_20250305` automatically if a model rejects the newer version (one 400, then it
remembers).

**Optional params**: `max_uses` (cap searches per request — our cost guard), `allowed_domains`
/ `blocked_domains` (mutually exclusive; a request with both is a 400), `user_location`
(`{type:"approximate", city, region, country, timezone}` — we set Edinburgh / GB /
Europe/London to localise results), `allowed_callers`, `response_inclusion`.

**Response shape** (`message.content[]`):
- `server_tool_use` — the query Claude ran.
- `web_search_tool_result` — `.content` is an **array** of `web_search_result`
  (`url`, `title`, `page_age`, `encrypted_content`) on success.
- `text` blocks — the final answer. Text blocks carry a `citations[]` array of
  `web_search_result_location` (`url`, `title`, `cited_text`, `encrypted_index`).

**`citedUrls` for our pipeline step 4** comes from both places: every
`web_search_tool_result.content[].url` plus every `text.citations[].url`. This is the
strongest citation signal of the three providers.

**Gotchas that must be handled in the adapter:**
1. **Errors return HTTP 200.** On error, `web_search_tool_result.content` is a single *object*
   `{type:"web_search_tool_result_error", error_code}`, not an array. Branch on
   `Array.isArray(content)` before indexing. Error codes: `too_many_requests`,
   `invalid_tool_input`, `max_uses_exceeded`, `query_too_long`, `request_too_large`,
   `unavailable`. A search that matched nothing returns an **empty array**, not an error.
2. **`stop_reason: "pause_turn"`** on long searches. Continue by sending the assistant message
   back unchanged in a new request. Our adapter loops on this with a cap (max 4 continuations)
   and the `AbortSignal` from the caller.
3. **Dynamic filtering nests blocks.** With `web_search_20260209`+, search blocks can appear
   nested inside code-execution results with a `caller` field. The pipeline's "take the text
   after the last tool-use block" rule must scan the top-level `content` array for the last
   non-`text` block, which still holds.
4. Do **not** also declare `code_execution` in `tools` — the API provisions it automatically
   for dynamic filtering, and a second execution environment confuses the model.
5. `encrypted_content` must be passed back verbatim on multi-turn continuations or the request
   400s. Relevant to `pause_turn` continuation.

**List models**: `GET /v1/models` / `client.models.list()`. Each model has `id`,
`display_name`, `created_at`, `max_input_tokens`, `max_tokens`, `capabilities`.

**Implementation notes (Phase 3, 2026-09-14)** — `src/lib/search/providers/anthropic.ts`:
- Installed SDK 0.125.0 exports `WebSearchTool20260318` (with `response_inclusion`),
  `WebSearchToolResultBlockContent = WebSearchToolResultError | Array<WebSearchResultBlock>`,
  `StopReason` including `pause_turn`, and `client.models.list()`. All matched the docs.
- SDK error classes are statics on the client (`Anthropic.BadRequestError` etc.) and are
  **not** in the type namespace — use them in `instanceof` checks only.
- `ModelCapabilities` has no `web_search` field; tool-version support is discovered by
  trying the newest version and falling back on a 400 that names the tool.

**Current model IDs** (from the bundled `claude-api` skill, cached 2026-06-24):
`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-opus-4-8`, `claude-fable-5-1`.
Default when `DEFAULT_MODEL` is empty: pick the cheapest current model that supports web search
from the list endpoint — `claude-sonnet-5` is the intended default for this workload
(search-heavy, short structured output). Never append date suffixes to these IDs.

**Pricing note (cost guard input)**: web search is billed at **$10 per 1,000 searches** on top
of tokens. One refresh = one call per enabled role; each call may run several searches. With
`DAILY_REFRESH_CAP=20`, 3 roles and `max_uses: 5`, the worst case is 20 x 3 x 5 = 300 searches
= ~$3/day plus tokens. `max_uses` is therefore a real cost control, not a nicety. See
RECONCILE #10.

---

## 2. OpenAI (ChatGPT)

**Docs**
- Web search tool: https://developers.openai.com/api/docs/guides/tools-web-search
- Models list: https://developers.openai.com/api/docs/api-reference/models/list
- SDK: `openai` (verified published version 7.15.0)

Note: `platform.openai.com/docs/*` now 301-redirects to `developers.openai.com/api/docs/*`.

**Endpoint**: Responses API — `client.responses.create()`.

**Request shape**
```json
{ "model": "gpt-6-astra", "tools": [{ "type": "web_search" }], "input": "..." }
```

**Tool type**: `web_search` is current. `web_search_preview` is the legacy variant and lacks
newer features — do not use it for new code.

**Response shape**: a `web_search_call` object (with an `action` of type `search`, `open_page`
or `find_in_page`) plus a `message` object whose `content[0].text` holds the answer and whose
`content[0].annotations` holds `url_citation` objects (`url`, `title`, start/end index).

**`citedUrls` for pipeline step 4**: pass `include: ["web_search_call.action.sources"]` in the
request to get the full list of URLs consulted, separate from the inline citations. This maps
directly onto our citation check — use it in preference to the annotations alone.

**List models**: `GET /v1/models`. Each entry: `id`, `created`, `object`, `owned_by`,
`shutdown_date`. The docs do not name the JS SDK method; assume `client.models.list()` and
**confirm against the installed SDK's types at Phase 5** before relying on it.

**Models seen in the docs**: `gpt-6-astra`, `gpt-5.5` (reasoning-based search),
`gpt-5-search-api` (Chat Completions only). Populate the dropdown from the list endpoint
rather than hardcoding; `/v1/models` returns many non-chat models, so filter in the UI.

---

## 3. Google (Gemini)

**Docs**
- Google Search grounding: https://ai.google.dev/gemini-api/docs/google-search
- Text generation: https://ai.google.dev/gemini-api/docs/text-generation
- Models list: https://ai.google.dev/api/models
- SDK: `@google/genai` (verified published version 2.22.0), reference at
  https://googleapis.github.io/js-genai/

**The brief's assumption is out of date — see RECONCILE #4.** The brief says "Gemini:
generateContent with Google Search grounding". The current docs lead with the **Interactions
API**:

```js
const interaction = await ai.interactions.create({
  model: "gemini-3.8-flash",
  input: "Who won the euro 2024?",
  tools: [{ type: "google_search" }],
});
```

`generateContent` still exists at
`POST https://generativelanguage.googleapis.com/v1beta/{model}:generateContent`, but the
grounding docs, the tool shape and the response shape are all documented against Interactions.
**Proposed: build the adapter on the Interactions API.**

**Tool key**: `google_search`. Older models used `google_search_retrieval` — do not use it.

**Response shape**: a `steps` array containing `google_search_call` and `google_search_result`
objects (results carry `search_suggestions`, an HTML snippet), then a `model_output` step whose
`annotations` are `url_citation` objects with `url`, `title`, `start_index`, `end_index`.

**`citedUrls` for pipeline step 4**: the `url_citation` annotations on `model_output`.
These are **publisher URLs**, not `grounding-api-redirect` URLs (confirmed by the project owner
2026-09-11; the docs are silent on it). They therefore feed the canonical-URL step and the
citation check directly, with no redirect resolution. The adapter keeps a one-line guard: a
citation host matching a known grounding-redirect pattern logs a warning and is recorded
`cited: false` rather than trusted — see RECONCILE #4.

**List models**: `GET https://generativelanguage.googleapis.com/v1beta/models`. Each entry:
`name` (`models/{id}`), `baseModelId`, `version`, `displayName`, `description`,
`inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods`. Filter the dropdown on
`supportedGenerationMethods`.

**Auth**: the docs show `?key=$GEMINI_API_KEY` as a **query parameter**. We will send the
`x-goog-api-key` **header** instead — a key in a query string leaks into access logs, proxy
logs and `Referer` headers, which violates Section 4.1/4.3 of the brief. The SDK sends the
header. Confirm at Phase 5 that the list-models call honours the header too; if it does not,
that is a RECONCILE item, not a silent fallback to the query param.

**Current model IDs seen**: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`,
`gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview`, `gemini-2.5-pro`.

---

**Implementation notes (Phase 5, 2026-09-14)** — `src/lib/search/providers/openai.ts`:
- Installed `openai` 7.15.0: `WebSearchTool.type` is `'web_search' | 'web_search_2025_08_26'`;
  `ResponseIncludable` includes `'web_search_call.action.sources'`; sources are
  `{ type: 'url', url }`; `response.output_text` is provided by the SDK. Verified against types.
- Searches are counted as `web_search_call` items in `output`.
- `/v1/models` returns everything; the adapter keeps `gpt-*`/`o*`/`chatgpt-*` and drops
  embedding/audio/image/realtime/tts/transcribe/moderation ids.

**Implementation notes (Phase 5, 2026-09-14)** — `src/lib/search/providers/gemini.ts`:
- Installed `@google/genai` 2.22.0 exposes `ai.interactions.create({ model, input,
  system_instruction, tools: [{ type: "google_search" }], generation_config, store })`
  returning `{ status, output_text, steps, usage, errors }`. `ai.models.generateContent`
  still exists but the adapter uses Interactions (RECONCILE #4).
- **No retrieved-URL list** (RECONCILE #17): `GoogleSearchResultStep.result[]` holds only
  `search_suggestions`. Citations come from `url_citation` annotations on `model_output`.
- Auth header confirmed: the SDK's REST path sends `x-goog-api-key`; the only `?key=` usage in
  the bundle is a WebSocket music endpoint we never call.
- Errors: `ApiError` with `.status`; mapped by status code.

**Anthropic addendum (Phase 5)**: an organisation-level API key needs the
`anthropic-workspace-id` header on every request, or the API returns a 400. Set
`ANTHROPIC_WORKSPACE_ID` to send it (RECONCILE #16).

## 4. JSON mode vs. web search — the shared decision

| Provider | Structured output + search documented as compatible? | Our approach |
|---|---|---|
| Anthropic | No. Citations are always on for web search, and `output_config.format` is documented as incompatible with citations (400). | Plain-text JSON + shared parser |
| OpenAI | Not addressed in the web search guide — notably absent from the feature list. | Plain-text JSON + shared parser |
| Gemini | Not addressed in the grounding guide for `responseMimeType`/`responseSchema`. | Plain-text JSON + shared parser |

This is exactly the case the brief anticipated ("If that's the case, request JSON in plain text
and rely on the shared parser"). All three adapters therefore return `rawText` and the single
parser in `src/lib/search/parse.ts` does truncation salvage and per-item zod validation. This
is also why the parser must be robust rather than best-effort: it is the only validation layer.

---

## 5. UK sponsor register

**Publication page**: https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers

**Verified 2026-09-11**: the page links a single CSV (no ODS/XLSX). Filename embeds the date and
changes with each update, confirming the brief's assumption that we must scrape the page for the
current `.csv` link rather than hardcode it. Example resolved on 2026-09-11:

```
https://assets.publishing.service.gov.uk/media/6aa2617592e72b8ac437f049/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-09-10.csv
```

Size ~10.4 MB. Updated **nearly every weekday**, not weekly — our 7-day staleness rule is still
fine, it just means we are never more than 7 days behind a daily-moving file.

**Columns verified by downloading the first bytes of the live file:**

```
Organisation Name,Town/City,County,Type & Rating,Route
 AaruvikA Limited,Edinburgh,,Worker (A rating),Skilled Worker
 BOLTWHIZ LIMITED,Dunfermline,Scotland,Worker (A rating),Skilled Worker
```

Differences from the brief's `sponsor_register` model (`org_name, org_norm, town, route`):
- There is also a **`County`** column (often empty) and a **`Type & Rating`** column
  (e.g. `Worker (A rating)`). Proposed: store both — `county` and `rating` — see RECONCILE #7.
- **Values carry leading spaces** (` AaruvikA Limited`). Trim every field before normalising,
  or every single match will fail.
- **Organisations repeat**, one row per route (an org licensed for Skilled Worker and
  Temporary Worker appears twice). The table must not be keyed on `org_norm` alone; key on
  (`org_norm`, `route`) and match on `org_norm` with `DISTINCT`.
- A GET without a browser `User-Agent` is served fine, but `HEAD` returns a zero-length body —
  use a ranged GET to probe, not HEAD.

---

## 6. Verified package versions (npm, 2026-09-11)

| Package | Version |
|---|---|
| `next` | 16.3.4 |
| `react` | 19.3.0 |
| `drizzle-orm` | 0.45.2 |
| `drizzle-kit` | 0.31.10 |
| `better-sqlite3` | 13.0.3 |
| `zod` | 4.6.2 |
| `vitest` | 5.0.0 |
| `@playwright/test` | 1.63.0 |
| `@anthropic-ai/sdk` | 0.125.0 |
| `openai` | 7.15.0 |
| `@google/genai` | 2.22.0 |

zod is on v4 and vitest on v5 — both are majors ahead of the shapes most commonly written from
memory. Write against the installed versions' types, not recalled APIs.
