import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_KEY = "creative-job-board:v1";
const STALE_DAYS = 21;
const DAY = 86400000;

const DEFAULT_CRITERIA = {
  roles: ["Communications", "Marketing", "Business development"],
  sector: " ",
  where: "Remote and part-time, 2–3 days a week, or in-person in Edinburgh",
};

const STATUSES = [
  { value: "", label: "Not started" },
  { value: "saved", label: "Saved" },
  { value: "applied", label: "Applied" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "hidden", label: "Not for me" },
];

const STATUS_COLOR = {
  "": "#C4C9D2",
  saved: "#5B6475",
  applied: "#2F5DA8",
  interview: "#A86A12",
  offer: "#1F7A6D",
  rejected: "#9AA0AA",
  hidden: "#9AA0AA",
};

const CAT_COLORS = ["#6D4AA0", "#A86A12", "#1F7A6D", "#2F5DA8", "#9B3D6B", "#4B6B2A"];

const MODES = [
  { v: "remote", label: "Remote" },
  { v: "hybrid", label: "Hybrid" },
  { v: "onsite", label: "On-site" },
];

const SYSTEM =
  "You find real, currently open job listings using web search. You never invent listings, organisations or URLs. When you have finished searching, your reply is only a JSON array with no text before or after it.";

/* ---------- helpers ---------- */

const todayStr = () => new Date().toLocaleDateString("en-CA");
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const trimDot = (s) => s.replace(/[.\s]+$/, "");

function joinRoles(roles) {
  const r = roles.map((x, i) => (i > 0 && /^[A-Z][a-z]/.test(x) ? x[0].toLowerCase() + x.slice(1) : x));
  if (r.length <= 1) return r[0] || "";
  return `${r.slice(0, -1).join(", ")} and ${r[r.length - 1]}`;
}

function ago(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

function closingInfo(closing, today) {
  if (!closing) return { text: "Not given", tone: "muted" };
  const d = new Date(closing + "T00:00:00");
  const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const days = Math.round((d - new Date(today + "T00:00:00")) / DAY);
  if (days < 0) return { text: `Closed ${label}`, tone: "muted" };
  if (days === 0) return { text: "Closes today", tone: "soon" };
  if (days <= 7) return { text: `${label}, ${days} day${days === 1 ? "" : "s"} left`, tone: "soon" };
  return { text: label, tone: "" };
}

/* ---------- search ---------- */

function buildPrompt(role, c) {
  return `Today is ${todayStr()}. Search the web for job openings that are open right now.

Role type: ${role}. Include closely related titles (officer, coordinator, executive, manager, assistant, freelance or fixed-term contract).
Sector: ${c.sector}. Interpret it broadly.
Where and when: ${c.where}.

Good places to look include Creative Scotland opportunities, Goodmoves, Arts Jobs, CharityJob, Timewise Jobs, Guardian Jobs, s1jobs, Culture Jobs, Arts Professional, LinkedIn, Indeed and organisations' own careers pages.

Rules:
- Only include listings you actually saw in search results, with the real listing URL. Never invent a role, organisation or link.
- Skip anything past its closing date or posted more than 6 weeks ago.
- Skip roles that don't match the where-and-when requirement.

Reply with ONLY a JSON array, no other text, of up to 6 objects shaped like:
{"org":"","title":"","location":"","mode":"remote|hybrid|onsite","hours":"","salary":"","closing":"YYYY-MM-DD or empty","url":"","source":""}
Keep every value short. "hours" looks like "2 days/wk", "21 hrs/wk" or "Full-time". Use "" when unknown.`;
}

function extractJobs(data) {
  const blocks = data?.content || [];
  let lastTool = -1;
  blocks.forEach((b, i) => {
    if (b.type !== "text") lastTool = i;
  });
  const textOf = (bs) => bs.filter((b) => b.type === "text").map((b) => b.text).join("");
  let text = textOf(blocks.slice(lastTool + 1));
  if (!text.includes("[")) text = textOf(blocks);
  text = text.replace(/```json|```/g, "");
  const start = text.indexOf("[");
  if (start === -1) return [];
  const body = text.slice(start);
  let arr;
  try {
    arr = JSON.parse(body.slice(0, body.lastIndexOf("]") + 1));
  } catch {
    // Response was cut off: keep every complete object.
    const cut = body.lastIndexOf("}");
    if (cut === -1) return [];
    try {
      arr = JSON.parse(body.slice(0, cut + 1) + "]");
    } catch {
      return [];
    }
  }
  return Array.isArray(arr) ? arr : [];
}

function cleanJob(raw, category) {
  if (!raw || typeof raw !== "object") return null;
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  const org = s(raw.org);
  const title = s(raw.title);
  const url = s(raw.url);
  if (!org || !title || !/^https?:\/\//i.test(url)) return null;
  const m = s(raw.mode).toLowerCase();
  const mode = m.includes("remote") ? "remote" : m.includes("hybrid") ? "hybrid" : m.includes("site") || m.includes("office") ? "onsite" : "";
  const closing = /^\d{4}-\d{2}-\d{2}$/.test(s(raw.closing)) ? s(raw.closing) : "";
  let source = s(raw.source);
  if (!source) {
    try {
      source = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      source = "";
    }
  }
  return {
    id: `${norm(org)}|${norm(title)}`,
    org,
    title,
    url,
    source,
    mode,
    closing,
    location: s(raw.location),
    hours: s(raw.hours),
    salary: s(raw.salary),
    category,
  };
}

async function searchCategory(role, criteria) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: SYSTEM,
        messages: [{ role: "user", content: buildPrompt(role, criteria) }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const data = await res.json();
    return extractJobs(data)
      .map((j) => cleanJob(j, role))
      .filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

function mergeJobs(existing, fresh, now) {
  const map = new Map(existing.map((j) => [j.id, j]));
  let added = 0;
  for (const f of fresh) {
    const prev = map.get(f.id);
    if (prev) {
      const filled = {};
      for (const k of ["url", "source", "mode", "closing", "location", "hours", "salary"]) {
        if (f[k]) filled[k] = f[k];
      }
      map.set(f.id, { ...prev, ...filled, lastSeen: now });
    } else {
      map.set(f.id, { ...f, status: "", firstSeen: now, lastSeen: now });
      added++;
    }
  }
  const today = todayStr();
  const cutoff = now - STALE_DAYS * DAY;
  // Anything she has tracked stays. Untracked roles drop off once closed or not seen for 3 weeks.
  const jobs = [...map.values()].filter(
    (j) => j.status || ((!j.closing || j.closing >= today) && j.lastSeen >= cutoff)
  );
  return { jobs, added };
}

/* ---------- storage ---------- */

async function loadStored() {
  try {
    if (!window.storage) return null;
    const r = await window.storage.get(STORAGE_KEY, false);
    return r?.value ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}

function saveStored(payload) {
  if (!window.storage) return;
  Promise.resolve()
    .then(() => window.storage.set(STORAGE_KEY, JSON.stringify(payload), false))
    .catch(() => {});
}

/* ---------- components ---------- */

function CriteriaEditor({ criteria, onSave, onCancel }) {
  const [roles, setRoles] = useState(criteria.roles.join("\n"));
  const [sector, setSector] = useState(criteria.sector);
  const [where, setWhere] = useState(criteria.where);
  const list = roles
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

  return (
    <div className="editor" role="region" aria-label="Edit search">
      <label>
        Role types
        <span>One per line, up to six. Each one gets its own tab and its own search.</span>
        <textarea rows={4} value={roles} onChange={(e) => setRoles(e.target.value)} />
      </label>
      <label>
        Sector
        <input value={sector} onChange={(e) => setSector(e.target.value)} />
      </label>
      <label>
        Where and when
        <input value={where} onChange={(e) => setWhere(e.target.value)} />
      </label>
      <div className="editor-actions">
        <button
          className="btn"
          disabled={!list.length}
          onClick={() =>
            onSave({
              roles: list,
              sector: trimDot(sector.trim()) || DEFAULT_CRITERIA.sector,
              where: trimDot(where.trim()) || DEFAULT_CRITERIA.where,
            })
          }
        >
          Save and search
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="linkbtn"
          onClick={() => {
            setRoles(DEFAULT_CRITERIA.roles.join("\n"));
            setSector(DEFAULT_CRITERIA.sector);
            setWhere(DEFAULT_CRITERIA.where);
          }}
        >
          Restore original search
        </button>
      </div>
    </div>
  );
}

export default function JobBoard() {
  const [loaded, setLoaded] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [seenUpTo, setSeenUpTo] = useState(0);
  const [newSince, setNewSince] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [modes, setModes] = useState([]);
  const [hideClosed, setHideClosed] = useState(true);
  const [view, setView] = useState("active");
  const [sort, setSort] = useState("closing");
  const [editing, setEditing] = useState(false);

  const jobsRef = useRef([]);
  const refreshingRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const refresh = useCallback(async (crit) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setError("");
    setNotice("");
    setProgress(Object.fromEntries(crit.roles.map((r) => [r, { state: "searching" }])));

    const results = await Promise.allSettled(
      crit.roles.map(async (r) => {
        try {
          const found = await searchCategory(r, crit);
          setProgress((p) => ({ ...p, [r]: { state: "done", count: found.length } }));
          return found;
        } catch (e) {
          setProgress((p) => ({ ...p, [r]: { state: "error" } }));
          throw e;
        }
      })
    );

    const fresh = results.flatMap((x) => (x.status === "fulfilled" ? x.value : []));
    const failed = results.filter((x) => x.status === "rejected").length;
    const now = Date.now();

    if (failed === crit.roles.length) {
      setError("The search didn't finish. Your saved roles are still here. Select Refresh to try again.");
    } else {
      const merged = mergeJobs(jobsRef.current, fresh, now);
      jobsRef.current = merged.jobs;
      setJobs(merged.jobs);
      setLastRefresh(now);
      setSeenUpTo(now);
      setNotice(
        merged.added === 0
          ? "No new roles since the last search."
          : `${merged.added} new role${merged.added === 1 ? "" : "s"} added.`
      );
      if (failed) {
        setError(`${failed} of ${crit.roles.length} searches didn't finish, so a few roles may be missing. Refresh to retry.`);
      }
    }
    refreshingRef.current = false;
    setRefreshing(false);
  }, []);

  // Load saved state, then search on every visit.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const stored = await loadStored();
      const crit = stored?.criteria || DEFAULT_CRITERIA;
      const saved = stored?.jobs || [];
      jobsRef.current = saved;
      setJobs(saved);
      setCriteria(crit);
      setNewSince(stored?.seenUpTo || 0);
      setSeenUpTo(stored?.seenUpTo || 0);
      setLastRefresh(stored?.lastRefresh || 0);
      setLoaded(true);
      refresh(crit);
    })();
  }, [refresh]);

  useEffect(() => {
    if (loaded) saveStored({ jobs, criteria, seenUpTo, lastRefresh });
  }, [loaded, jobs, criteria, seenUpTo, lastRefresh]);

  const setStatus = (id, status) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status } : j)));

  const toggleMode = (v) => setModes((m) => (m.includes(v) ? m.filter((x) => x !== v) : [...m, v]));

  const clearFilters = () => {
    setQuery("");
    setModes([]);
    setView("active");
    setTab("all");
  };

  const saveCriteria = (c) => {
    setCriteria(c);
    setEditing(false);
    if (!c.roles.includes(tab)) setTab("all");
    refresh(c);
  };

  /* ---------- derived ---------- */

  const today = todayStr();
  const isClosed = (j) => j.closing && j.closing < today;
  const isNew = (j) => newSince > 0 && j.firstSeen > newSince;
  const catColor = (cat) => {
    const i = criteria.roles.indexOf(cat);
    return i === -1 ? "#9AA0AA" : CAT_COLORS[i % CAT_COLORS.length];
  };

  const openJobs = jobs.filter((j) => j.status !== "hidden" && !isClosed(j));
  const countFor = (cat) => openJobs.filter((j) => cat === "all" || j.category === cat).length;
  const newCount = openJobs.filter(isNew).length;
  const appliedCount = jobs.filter((j) => ["applied", "interview", "offer"].includes(j.status)).length;

  const q = query.trim().toLowerCase();
  const visible = jobs
    .filter((j) => {
      if (tab !== "all" && j.category !== tab) return false;
      if (view === "hidden") return j.status === "hidden";
      if (j.status === "hidden") return false;
      if (view === "tracking" && !j.status) return false;
      if (hideClosed && isClosed(j)) return false;
      if (modes.length && !modes.includes(j.mode)) return false;
      if (q && !`${j.org} ${j.title} ${j.location}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === "newest") return b.firstSeen - a.firstSeen;
      const ac = a.closing || "9999";
      const bc = b.closing || "9999";
      return ac === bc ? b.firstSeen - a.firstSeen : ac.localeCompare(bc);
    });

  const tabs = ["all", ...criteria.roles];

  return (
    <div className="jb">
      <style>{CSS}</style>
      <div className="wrap">
        <header className="hero">
          <div>
            <h1>{joinRoles(criteria.roles)} roles</h1>
            <p>
              {trimDot(criteria.sector)}. {trimDot(criteria.where)}.
            </p>
          </div>
          <div className="actions">
            <span className="meta" aria-live="polite">
              {refreshing ? "Searching now" : lastRefresh ? `Updated ${ago(lastRefresh)}` : "Not searched yet"}
            </span>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
                Edit search
              </button>
              <button className="btn" onClick={() => refresh(criteria)} disabled={refreshing}>
                {refreshing ? "Searching" : "Refresh"}
              </button>
            </div>
          </div>
        </header>

        {editing && (
          <CriteriaEditor criteria={criteria} onSave={saveCriteria} onCancel={() => setEditing(false)} />
        )}

        {refreshing && (
          <div className="progress" aria-live="polite">
            {criteria.roles.map((r) => {
              const p = progress[r] || { state: "searching" };
              return (
                <span className="pchip" key={r}>
                  {p.state === "searching" && <span className="spin" aria-hidden="true" />}
                  {r}
                  {p.state === "searching" && ", searching"}
                  {p.state === "done" && `, ${p.count} found`}
                  {p.state === "error" && ", didn't finish"}
                </span>
              );
            })}
          </div>
        )}
        {!refreshing && (notice || error) && (
          <div className="messages" aria-live="polite">
            {notice && <p className="notice">{notice}</p>}
            {error && <p className="notice error">{error}</p>}
          </div>
        )}

        <div className="stats">
          <span>
            <strong>{openJobs.length}</strong> open roles
          </span>
          {newSince > 0 && (
            <span>
              <strong>{newCount}</strong> new since your last visit
            </span>
          )}
          <span>
            <strong>{appliedCount}</strong> applied
          </span>
        </div>

        <div className="tabs" role="tablist" aria-label="Role type">
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className="tab"
              style={{ "--tabc": t === "all" ? "#1F2433" : catColor(t) }}
              onClick={() => setTab(t)}
            >
              {t !== "all" && <span className="dot" aria-hidden="true" />}
              {t === "all" ? "All roles" : t}
              <span className="n">{countFor(t)}</span>
            </button>
          ))}
        </div>

        <div className="toolbar">
          <input
            className="search"
            type="search"
            placeholder="Search organisation, role or place"
            aria-label="Search organisation, role or place"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="chips" role="group" aria-label="Work pattern">
            {MODES.map((m) => (
              <button key={m.v} className="chip" aria-pressed={modes.includes(m.v)} onClick={() => toggleMode(m.v)}>
                {m.label}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} />
            Hide closed
          </label>
          <select className="select" value={view} onChange={(e) => setView(e.target.value)} aria-label="Show">
            <option value="active">All roles</option>
            <option value="tracking">Roles I'm tracking</option>
            <option value="hidden">Not for me</option>
          </select>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
            <option value="closing">Closing soonest</option>
            <option value="newest">Newest first</option>
          </select>
        </div>

        <div className="table">
          <div className="thead" aria-hidden="true">
            <span>Organisation</span>
            <span>Role</span>
            <span>Where</span>
            <span>Hours</span>
            <span>Salary</span>
            <span>Closes</span>
            <span>My status</span>
            <span />
          </div>

          {visible.map((j) => {
            const c = closingInfo(j.closing, today);
            return (
              <div key={j.id} className={`row${isClosed(j) ? " is-closed" : ""}`} style={{ "--cat": catColor(j.category) }}>
                <div className="c-org">{j.org}</div>
                <div className="c-role">
                  <span className="title">{j.title}</span>
                  {isNew(j) && <span className="new">New</span>}
                  {tab === "all" && <span className="cat">{j.category}</span>}
                </div>
                <div data-label="Where">
                  {j.mode && <span className={`mode m-${j.mode}`}>{MODES.find((m) => m.v === j.mode).label}</span>}
                  <span className="loc">{j.location}</span>
                </div>
                <div data-label="Hours">{j.hours || <span className="muted">Not given</span>}</div>
                <div data-label="Salary">{j.salary || <span className="muted">Not given</span>}</div>
                <div data-label="Closes" className={c.tone}>
                  {c.text}
                </div>
                <div data-label="My status">
                  <select
                    className="status"
                    style={{ borderLeftColor: STATUS_COLOR[j.status || ""] }}
                    value={j.status || ""}
                    onChange={(e) => setStatus(j.id, e.target.value)}
                    aria-label={`Status for ${j.title} at ${j.org}`}
                  >
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="c-link">
                  <a href={j.url} target="_blank" rel="noopener noreferrer">
                    View listing
                  </a>
                  {j.source && <span className="src">{j.source}</span>}
                </div>
              </div>
            );
          })}

          {visible.length === 0 && (
            <div className="empty">
              {!loaded || (refreshing && jobs.length === 0) ? (
                <>
                  <strong>Searching job boards</strong>
                  The first search takes about a minute. Roles appear here as soon as it finishes.
                </>
              ) : jobs.length === 0 ? (
                <>
                  <strong>No roles found yet</strong>
                  Select Refresh to search again, or edit the search to widen it.
                </>
              ) : (
                <>
                  <strong>No roles match these filters</strong>
                  <button className="linkbtn" onClick={clearFilters}>
                    Clear filters
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <p className="foot">
          Roles are found by an AI web search each time this page opens, so some may be missing or out of date. Check
          the closing date on the original listing before applying. Your statuses are saved to your account only.
        </p>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Public+Sans:wght@400;500;600&display=swap');

.jb {
  --mist: #EDEFF2; --paper: #FFFFFF; --ink: #1F2433; --slate: #5B6475;
  --rule: #D8DCE3; --thistle: #6D4AA0; --thistle-soft: #EEE8F6; --alert: #A33A3A;
  font-family: 'Public Sans', system-ui, sans-serif;
  font-size: 15px; line-height: 1.45; color: var(--ink);
  background: var(--mist); min-height: 100vh;
}
.jb * { box-sizing: border-box; }
.jb :focus-visible { outline: 3px solid var(--thistle); outline-offset: 2px; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 44px 28px 64px; }

.hero {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: 24px 40px; flex-wrap: wrap;
  padding-bottom: 26px; border-bottom: 2px solid var(--ink);
}
.hero h1 {
  font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700;
  font-size: clamp(30px, 4.6vw, 54px); line-height: 1.02; letter-spacing: -0.022em;
  margin: 0 0 14px; max-width: 19ch;
}
.hero p { margin: 0; color: var(--slate); font-size: 17px; max-width: 58ch; }
.actions { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.meta { font-size: 14px; color: var(--slate); }
.btn-row { display: flex; gap: 8px; }
.btn {
  font: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
  padding: 9px 18px; border-radius: 8px;
  border: 1.5px solid var(--ink); background: var(--ink); color: #fff;
}
.btn.ghost { background: transparent; color: var(--ink); }
.btn:disabled { opacity: .55; cursor: default; }
.linkbtn {
  background: none; border: 0; padding: 0; font: inherit; font-size: 14px;
  color: var(--thistle); text-decoration: underline; text-underline-offset: 3px; cursor: pointer;
}

.editor {
  margin-top: 20px; max-width: 720px; display: grid; gap: 14px;
  background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; padding: 20px;
}
.editor label { display: grid; gap: 6px; font-weight: 600; font-size: 14px; }
.editor label span { font-weight: 400; font-size: 13px; color: var(--slate); }
.editor input, .editor textarea {
  font: inherit; font-weight: 400; padding: 9px 12px;
  border: 1px solid var(--rule); border-radius: 8px; resize: vertical;
}
.editor-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

.progress { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 16px; font-size: 13px; color: var(--slate); }
.pchip {
  display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px;
  background: var(--paper); border: 1px solid var(--rule); border-radius: 999px;
}
.spin {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid var(--rule); border-top-color: var(--thistle);
  animation: jbspin .8s linear infinite;
}
@keyframes jbspin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.messages { padding-top: 14px; }
.notice { margin: 0; font-size: 14px; }
.notice.error { color: var(--alert); margin-top: 4px; }

.stats { display: flex; flex-wrap: wrap; gap: 8px 28px; padding: 18px 0 12px; font-size: 14px; color: var(--slate); }
.stats strong { color: var(--ink); font-weight: 600; font-size: 15px; }

.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--rule); overflow-x: auto; }
.tab {
  display: flex; align-items: center; gap: 8px; white-space: nowrap; cursor: pointer;
  background: none; border: 0; border-bottom: 3px solid transparent;
  font: inherit; font-weight: 500; color: var(--slate); padding: 10px 14px 9px;
}
.tab[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--tabc); }
.tab .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tabc); }
.tab .n { font-size: 12px; color: var(--slate); background: #E1E4EA; border-radius: 10px; padding: 1px 7px; }

.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 14px 0; }
.search {
  flex: 1 1 240px; min-width: 180px; font: inherit; font-size: 14px;
  padding: 9px 12px; border: 1px solid var(--rule); border-radius: 8px; background: var(--paper);
}
.chips { display: flex; gap: 6px; }
.chip {
  font: inherit; font-size: 14px; cursor: pointer; padding: 6px 13px;
  border-radius: 999px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink);
}
.chip[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: #fff; }
.check { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.select {
  font: inherit; font-size: 14px; padding: 7px 10px;
  border: 1px solid var(--rule); border-radius: 8px; background: var(--paper);
}

.table { background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; overflow: hidden; }
.thead, .row {
  display: grid; gap: 14px; align-items: center; padding: 13px 18px 13px 20px;
  grid-template-columns: minmax(120px,1.1fr) minmax(170px,1.7fr) minmax(130px,1.15fr) minmax(88px,.8fr) minmax(96px,.9fr) minmax(100px,.95fr) 136px 104px;
}
.thead { font-size: 13px; font-weight: 500; color: var(--slate); background: #F6F7F9; border-bottom: 1px solid var(--rule); }
.row { font-size: 14px; border-top: 1px solid #ECEEF2; box-shadow: inset 4px 0 0 var(--cat); }
.thead + .row { border-top: 0; }
.row.is-closed { opacity: .55; }
.c-org { font-weight: 600; }
.c-role .title { font-weight: 500; }
.new {
  display: inline-block; margin-left: 8px; vertical-align: 1px;
  font-size: 12px; font-weight: 600; color: var(--thistle);
  background: var(--thistle-soft); border-radius: 4px; padding: 1px 6px;
}
.cat { display: block; margin-top: 2px; font-size: 12px; color: var(--cat); }
.mode { display: inline-block; margin: 0 6px 2px 0; font-size: 12px; font-weight: 600; border-radius: 4px; padding: 1px 6px; }
.m-remote { background: #E2F0EC; color: #1F6B60; }
.m-hybrid { background: #E5EBF6; color: #2F5DA8; }
.m-onsite { background: #F3EBDD; color: #845510; }
.loc { color: var(--slate); }
.muted { color: #979EA9; }
.soon { color: var(--alert); font-weight: 600; }
.status {
  width: 100%; font: inherit; font-size: 13px; padding: 6px 8px;
  border: 1px solid var(--rule); border-left-width: 4px; border-radius: 6px; background: var(--paper);
}
.c-link a { color: var(--thistle); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
.src { display: block; font-size: 12px; color: var(--slate); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.empty { padding: 52px 24px; text-align: center; color: var(--slate); }
.empty strong { display: block; margin-bottom: 6px; font-size: 17px; color: var(--ink); }
.foot { margin: 18px 0 0; font-size: 13px; color: var(--slate); max-width: 72ch; }

@media (max-width: 880px) {
  .wrap { padding: 28px 16px 48px; }
  .actions { align-items: flex-start; }
  .thead { display: none; }
  .row { grid-template-columns: 1fr 1fr; gap: 10px 16px; padding: 16px 16px 16px 20px; }
  .c-org, .c-role, .c-link { grid-column: 1 / -1; }
  .c-role .title { font-size: 16px; }
  .row [data-label]::before {
    content: attr(data-label); display: block; margin-bottom: 2px;
    font-size: 12px; font-weight: 400; color: var(--slate);
  }
}
`;
