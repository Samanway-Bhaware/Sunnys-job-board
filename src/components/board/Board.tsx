"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type BoardData } from "@/lib/client/api";
import { ago, joinRoles, todayLondon, trimDot } from "@/lib/client/format";
import {
  ALL_TAB,
  ARCHIVED_TAB,
  DEFAULT_FILTERS,
  activeFilterCount,
  applyFilters,
  filtersFromJson,
  filtersFromParams,
  filtersToJson,
  filtersToParams,
  isClosed,
  type Filters,
  type Sort,
  type SponsorshipFilter,
  type View,
} from "@/lib/jobs/filter";
import type { Contract, JobView, Status, WorkMode } from "@/lib/jobs/types";
import type { RunView, StartResult } from "@/lib/refresh/run";
import AddRoleDialog from "./AddRoleDialog";
import JobRow from "./JobRow";
import styles from "./board.module.css";

const FILTERS_KEY = "sunnynunny:filters:v1";
const THEME_KEY = "hire.theme";
const POLL_MS = 2000;

const MODE_OPTIONS: { v: WorkMode; label: string }[] = [
  { v: "remote", label: "Remote" },
  { v: "hybrid", label: "Hybrid" },
  { v: "onsite", label: "On-site" },
];
const CONTRACT_OPTIONS: { v: Contract; label: string }[] = [
  { v: "full_time", label: "Full-time" },
  { v: "part_time", label: "Part-time" },
];

function loadInitialFilters(): Filters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  const fromUrl = new URLSearchParams(window.location.search);
  if ([...fromUrl.keys()].length > 0) return filtersFromParams(fromUrl);
  try {
    return filtersFromJson(window.localStorage.getItem(FILTERS_KEY)) ?? DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

export default function Board() {
  const [data, setData] = useState<BoardData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [newSince, setNewSince] = useState(0);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filtersReady, setFiltersReady] = useState(false);
  const [run, setRun] = useState<RunView | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [tick, setTick] = useState(0);
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(THEME_KEY) === "dark";
    } catch {
      return false;
    }
  });
  const startedRef = useRef(false);
  const runStartRef = useRef<number>(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const locationDetailsRef = useRef<HTMLDetailsElement>(null);

  const today = useMemo(() => todayLondon(), []);

  /* ---------- theme & keyboard shortcut ---------- */

  useEffect(() => {
    try {
      const isDark = window.localStorage.getItem(THEME_KEY) === "dark";
      document.documentElement.classList.toggle("dark", isDark);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (
        locationDetailsRef.current?.open &&
        !locationDetailsRef.current.contains(e.target as Node)
      ) {
        locationDetailsRef.current.open = false;
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && locationDetailsRef.current?.open) {
        locationDetailsRef.current.open = false;
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }

  /* ---------- loading ---------- */

  const loadBoard = useCallback(async () => {
    const next = await api.board();
    setData(next);
    return next;
  }, []);

  const applyStart = useCallback(
    (result: StartResult, manual: boolean) => {
      if (result.started || result.reason === "running") {
        runStartRef.current = result.run.startedAt;
        setRun(result.run);
        if (result.run.status !== "running") {
          void loadBoard().then((board) => {
            const added = board.jobs.filter((j) => j.firstSeen >= runStartRef.current).length;
            if (result.run.status === "failed") {
              setNotice("");
              setError("The search didn't finish. Your saved roles are still here. Select Refresh to try again.");
            } else if (manual) {
              setNotice(added === 0 ? "No new roles since the last search." : `${added} new role${added === 1 ? "" : "s"} added.`);
            }
          });
        }
        return;
      }
      if (result.reason === "cap") {
        setError(`You've used all ${result.usage.cap} searches for today. The board still shows what it found earlier; searches reset tomorrow.`);
      } else if (result.reason === "unavailable") {
        setError(result.message);
      } else if (result.reason === "no_roles") {
        setError("There are no roles switched on to search for. Add one, or switch one on in Settings.");
      } else if (result.reason === "cooldown" && manual) {
        setNotice("Already up to date.");
      }
    },
    [loadBoard],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    setFilters(loadInitialFilters());
    setFiltersReady(true);

    (async () => {
      try {
        const board = await loadBoard();
        setNewSince(board.seenUpTo ?? 0);

        if (board.activeRun) {
          runStartRef.current = board.activeRun.startedAt;
          setRun(board.activeRun);
          return;
        }

        applyStart(await api.refresh("visit"), false);
      } catch (e) {
        setLoadError(e instanceof ApiError ? e.message : "Couldn't load the board. Reload the page to try again.");
      }
    })();
  }, [loadBoard, applyStart]);

  // Persist filters (localStorage + URL).
  useEffect(() => {
    if (!filtersReady) return;
    try {
      window.localStorage.setItem(FILTERS_KEY, filtersToJson(filters));
    } catch {
      /* private mode etc. */
    }
    const params = filtersToParams(filters).toString();
    const url = `${window.location.pathname}${params ? `?${params}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [filters, filtersReady]);

  // Poll the active run every 2 seconds.
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const id = run.id;
    const timer = setInterval(async () => {
      try {
        const { run: latest } = await api.run(id);
        setRun(latest);
        if (latest.status !== "running") {
          clearInterval(timer);
          const board = await loadBoard();
          const added = board.jobs.filter((j) => j.firstSeen >= runStartRef.current).length;
          const failed = Object.values(latest.progress).filter((p) => p.state === "error").length;
          const total = Object.keys(latest.progress).length;

          if (latest.status === "failed") {
            setNotice("");
            setError("The search didn't finish. Your saved roles are still here. Select Refresh to try again.");
          } else {
            setError(failed ? `${failed} of ${total} searches didn't finish, so a few roles may be missing. Refresh to retry.` : "");
            setNotice(added === 0 ? "No new roles since the last search." : `${added} new role${added === 1 ? "" : "s"} added.`);
          }
        }
      } catch {
        clearInterval(timer);
        setRun(null);
        setError("Lost track of the search. Reload the page to see the latest roles.");
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [run, loadBoard]);

  // Re-render "Updated N min ago" once a minute.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  /* ---------- derived ---------- */

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const allRoles = useMemo(() => data?.roles ?? [], [data]);
  const roles = useMemo(() => allRoles.filter((r) => !r.archived).sort((a, b) => a.sortOrder - b.sortOrder), [allRoles]);
  const archivedRoleIds = useMemo(() => new Set(allRoles.filter((r) => r.archived).map((r) => r.id)), [allRoles]);
  const roleById = useMemo(() => new Map(allRoles.map((r) => [r.id, r])), [allRoles]);

  const effectiveFilters = useMemo<Filters>(() => {
    const tabExists = filters.tab === ALL_TAB || filters.tab === ARCHIVED_TAB || roleById.has(filters.tab);
    return tabExists ? filters : { ...filters, tab: ALL_TAB };
  }, [filters, roleById]);

  const visible = useMemo(() => applyFilters(jobs, allRoles, effectiveFilters, today), [jobs, allRoles, effectiveFilters, today]);

  const isNew = useCallback((j: JobView) => newSince > 0 && j.firstSeen > newSince, [newSince]);
  const openJobs = useMemo(() => jobs.filter((j) => j.status !== "hidden" && !isClosed(j, today) && !archivedRoleIds.has(j.roleId)), [jobs, today, archivedRoleIds]);
  const countFor = (roleId: string) => openJobs.filter((j) => roleId === ALL_TAB || j.roleId === roleId).length;
  const archivedCount = useMemo(() => jobs.filter((j) => archivedRoleIds.has(j.roleId)).length, [jobs, archivedRoleIds]);
  const newCount = openJobs.filter(isNew).length;
  const appliedCount = jobs.filter((j) => ["applied", "interview", "offer"].includes(j.status)).length;

  const locationOptions = useMemo(() => {
    const set = new Set(jobs.map((j) => j.locationNorm).filter(Boolean));
    return [...set].sort((a, b) => (a === "Remote" ? -1 : b === "Remote" ? 1 : a.localeCompare(b)));
  }, [jobs]);

  const refreshing = run?.status === "running";
  const registerAvailable = data?.register.available ?? false;
  const filterCount = activeFilterCount(effectiveFilters);
  const headline = roles.length ? `${joinRoles(roles.map((r) => r.name))} roles` : "Your job board";
  const subtitle = data ? `${trimDot(data.scope.sector)}. ${trimDot(data.scope.notes)}` : "Indexed from company career boards, deduplicated, and tagged by role, sponsorship and location.";

  /* ---------- actions ---------- */

  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleIn = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  async function refresh() {
    if (refreshing) return;
    setError("");
    setNotice("");
    try {
      applyStart(await api.refresh("manual"), true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start a search. Try again in a moment.");
    }
  }

  async function setStatus(id: string, status: Status) {
    const previous = data;
    setData((d) => d && { ...d, jobs: d.jobs.map((j) => (j.id === id ? { ...j, status } : j)) });
    try {
      const { job } = await api.patchJob(id, { status });
      setData((d) => d && { ...d, jobs: d.jobs.map((j) => (j.id === id ? job : j)) });
    } catch (e) {
      setData(previous);
      setError(e instanceof ApiError ? e.message : "Couldn't save that status. Try again.");
    }
  }

  async function saveNotes(id: string, notes: string) {
    try {
      const { job } = await api.patchJob(id, { notes });
      setData((d) => d && { ...d, jobs: d.jobs.map((j) => (j.id === id ? job : j)) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save that note. Try again.");
      throw e;
    }
  }

  async function addRole(input: { name: string; keywords: string }) {
    setDialogBusy(true);
    setDialogError("");
    try {
      const { role, search } = await api.createRole(input);
      setData((d) => d && { ...d, roles: [...d.roles, role] });
      setDialogOpen(false);
      update({ tab: role.id });
      setNotice("");
      setError("");
      applyStart(search, true);
    } catch (e) {
      setDialogError(e instanceof ApiError ? e.message : "Couldn't add that role. Try again.");
    } finally {
      setDialogBusy(false);
    }
  }

  /* ---------- render ---------- */

  const tabs = [ALL_TAB, ...roles.map((r) => r.id), ...(archivedCount > 0 ? [ARCHIVED_TAB] : [])];
  void tick;

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#roles">
        Skip to the list of roles
      </a>

      {/* Sticky TopBar */}
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <div className={styles.topbarLeft}>
            <Link href="/" className={styles.brandLink} aria-label="Sunny's Job Board">
              <svg viewBox="0 0 512 512" className={styles.brandIcon} fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M256 56C366.457 56 456 145.543 456 256C456 366.457 366.457 456 256 456C145.543 456 56 366.457 56 256C56 145.543 145.543 56 256 56ZM256 166L346 256L256 346L166 256L256 166Z"
                />
              </svg>
              <span>Sunny&rsquo;s Job Board</span>
            </Link>
            <div className={styles.navDivider} aria-hidden="true" />
            <nav aria-label="Site" className={styles.siteNav}>
              <Link href="/" className={`${styles.navLink} ${styles.navLinkActive}`}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.navIcon}
                  aria-hidden="true"
                >
                  <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  <rect width="20" height="14" x="2" y="6" rx="2" />
                </svg>
                Jobs
              </Link>
              <Link href="/settings" className={styles.navLink}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.navIcon}
                  aria-hidden="true"
                >
                  <path d="M10 5H3" />
                  <path d="M12 19H3" />
                  <path d="M14 3v4" />
                  <path d="M16 17v4" />
                  <path d="M21 12h-9" />
                  <path d="M21 19h-5" />
                  <path d="M21 5h-7" />
                  <path d="M8 10v4" />
                  <path d="M8 12H3" />
                </svg>
                Settings
              </Link>
            </nav>
          </div>

          <div className={styles.topbarRight}>
            <span className={styles.meta} aria-live="polite">
              {refreshing ? "Searching now" : data?.lastRefreshAt ? `Updated ${ago(data.lastRefreshAt)}` : "Not searched yet"}
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle color theme"
              title="Toggle light/dark theme"
              className={styles.iconBtn}
            >
              {dark ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
              )}
            </button>
            <button type="button" className={styles.btn} onClick={refresh} disabled={refreshing || !data}>
              {refreshing ? "Searching" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main className={styles.wrap}>
        {/* Exact FreeHire Dot-Grid Hero + Unified Search Bar + Specialization Role Pills */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div>
              <h1>{headline}</h1>
              <p>{subtitle}</p>
            </div>

            <div className={styles.searchShell}>
              <details ref={locationDetailsRef} className={styles.popover}>
                <summary>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                    <path d="M2 12h20" />
                  </svg>
                  <span>Location{effectiveFilters.locations.length ? ` (${effectiveFilters.locations.length})` : ""}</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <div className={styles.popoverBody}>
                  <div className={styles.popoverOptions}>
                    {locationOptions.length === 0 ? <span className={styles.muted}>No locations yet.</span> : null}
                    {locationOptions.map((loc) => (
                      <label key={loc}>
                        <input
                          type="checkbox"
                          checked={effectiveFilters.locations.includes(loc)}
                          onChange={() => update({ locations: toggleIn(effectiveFilters.locations, loc) })}
                        />
                        {loc}
                      </label>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Or type part of a place name"
                    aria-label="Location contains"
                    value={effectiveFilters.locationText}
                    onChange={(e) => update({ locationText: e.target.value })}
                  />
                </div>
              </details>

              <div className={styles.searchDivider} aria-hidden="true" />

              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={styles.searchIcon}
                aria-hidden="true"
              >
                <path d="m21 21-4.34-4.34" />
                <circle cx="11" cy="11" r="8" />
              </svg>

              <input
                ref={searchInputRef}
                className={styles.search}
                type="search"
                placeholder="Search organisation, role or place"
                aria-label="Search organisation, role or place"
                value={effectiveFilters.query}
                onChange={(e) => update({ query: e.target.value })}
              />

              <kbd className={styles.kbd} aria-hidden="true">/</kbd>
            </div>

            <div className={styles.tabs} role="tablist" aria-label="Role type">
              {tabs.map((t) => {
                const role = roleById.get(t);
                const color = t === ALL_TAB ? "#5b6f00" : t === ARCHIVED_TAB ? "#9AA0AA" : role?.color ?? "#5b6f00";
                const label = t === ALL_TAB ? "All roles" : t === ARCHIVED_TAB ? "Archived" : role?.name ?? "";
                const count = t === ARCHIVED_TAB ? archivedCount : countFor(t);
                return (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={effectiveFilters.tab === t}
                    className={styles.tab}
                    style={{ "--tabc": color } as React.CSSProperties}
                    onClick={() => update({ tab: t })}
                  >
                    {t !== ALL_TAB ? <span className={styles.dot} aria-hidden="true" /> : null}
                    {label}
                    <span className={styles.n}>{count}</span>
                  </button>
                );
              })}
              <button type="button" className={styles.addTab} onClick={() => setDialogOpen(true)} disabled={roles.length >= 10}>
                + Add role
              </button>
            </div>
          </div>
        </section>

        {refreshing && run ? (
          <div className={styles.progress} aria-live="polite">
            {Object.entries(run.progress).map(([roleId, p]) => (
              <span className={styles.pchip} key={roleId}>
                {p.state === "searching" ? <span className={styles.spin} aria-hidden="true" /> : null}
                {roleById.get(roleId)?.name ?? "Role"}
                {p.state === "searching" && ", searching"}
                {p.state === "done" && `, ${p.count ?? 0} found`}
                {p.state === "error" && ", didn't finish"}
              </span>
            ))}
          </div>
        ) : null}

        {!refreshing && (notice || error || loadError) ? (
          <div className={styles.messages} aria-live="polite">
            {notice ? <p className={styles.notice}>{notice}</p> : null}
            {error ? <p className={`${styles.notice} ${styles.error}`}>{error}</p> : null}
            {loadError ? <p className={`${styles.notice} ${styles.error}`}>{loadError}</p> : null}
          </div>
        ) : null}

        {/* Exact FreeHire Two-Column Feed Layout: Left Filter Sidebar + Right Job Cards */}
        <div className={styles.boardGrid}>
          <aside className={styles.sidebar} aria-label="Filters and summary">
            <div className={styles.filterCard}>
              <div className={styles.filterHeader}>
                <h2 className={styles.filterTitle}>Filters</h2>
                {filterCount > 0 ? (
                  <span className={styles.filterCount}>
                    {filterCount} filter{filterCount === 1 ? "" : "s"} on ·{" "}
                    <button type="button" className={styles.linkbtn} onClick={clearFilters}>
                      Clear filters
                    </button>
                  </span>
                ) : null}
              </div>

              <div className={styles.filterSection}>
                <p className={styles.sectionEyebrow}>{"// work format"}</p>
                <div className={styles.chips} role="group" aria-label="Work pattern">
                  {MODE_OPTIONS.map((m) => (
                    <button
                      key={m.v}
                      type="button"
                      className={styles.chip}
                      aria-pressed={effectiveFilters.workModes.includes(m.v)}
                      onClick={() => update({ workModes: toggleIn(effectiveFilters.workModes, m.v) })}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.filterSection}>
                <p className={styles.sectionEyebrow}>{"// employment"}</p>
                <div className={styles.chips} role="group" aria-label="Hours">
                  {CONTRACT_OPTIONS.map((c) => (
                    <button
                      key={c.v}
                      type="button"
                      className={styles.chip}
                      aria-pressed={effectiveFilters.contracts.includes(c.v)}
                      onClick={() => update({ contracts: toggleIn(effectiveFilters.contracts, c.v) })}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={effectiveFilters.includeUnknownHours}
                    onChange={(e) => update({ includeUnknownHours: e.target.checked })}
                  />
                  Include roles where hours aren&rsquo;t stated
                </label>
              </div>

              <div className={styles.filterSection}>
                <p className={styles.sectionEyebrow}>{"// sponsorship"}</p>
                <label className={styles.group}>
                  <span className={styles.groupLabel}>Visa sponsorship</span>
                  <select
                    className={`${styles.select} ${styles.selectSponsor}`}
                    value={effectiveFilters.sponsorship}
                    onChange={(e) => update({ sponsorship: e.target.value as SponsorshipFilter })}
                  >
                    <option value="any">Any</option>
                    <option value="offered">Offered</option>
                    <option value="offered_or_licensed" disabled={!registerAvailable}>
                      Offered or employer is a licensed sponsor{registerAvailable ? "" : " (register unavailable)"}
                    </option>
                    <option value="hide_ruled_out">Hide roles that rule out sponsorship</option>
                  </select>
                </label>
                {data && !registerAvailable ? (
                  <span className={styles.filterCount} title={data.register.lastError ?? undefined}>
                    UK sponsor register unavailable
                  </span>
                ) : null}
              </div>

              <div className={styles.filterSection}>
                <p className={styles.sectionEyebrow}>{"// board view"}</p>
                <label className={styles.group}>
                  <span className={styles.groupLabel}>Show</span>
                  <select
                    className={styles.select}
                    value={effectiveFilters.view}
                    onChange={(e) => update({ view: e.target.value as View })}
                    aria-label="Show"
                  >
                    <option value="active">All roles</option>
                    <option value="tracking">Roles I&rsquo;m tracking</option>
                    <option value="hidden">Not for me</option>
                  </select>
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={effectiveFilters.hideClosed}
                    onChange={(e) => update({ hideClosed: e.target.checked })}
                  />
                  Hide closed
                </label>
              </div>
            </div>

            <div className={styles.statsCard}>
              <p className={styles.sectionEyebrow}>{"// the catalogue, today"}</p>
              <div className={styles.statsGrid}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>open roles</span>
                  <strong className={styles.statValue}>{openJobs.length}</strong>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>new</span>
                  <strong className={styles.statValue}>{newSince > 0 ? newCount : 0}</strong>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>applied</span>
                  <strong className={styles.statValue}>{appliedCount}</strong>
                </div>
              </div>
            </div>
          </aside>

          <div className={styles.feedCol}>
            <div className={styles.feedBar}>
              <span className={styles.feedCount} aria-live="polite">
                <strong>{visible.length}</strong> {visible.length === 1 ? "job" : "jobs"}
              </span>

              <div className={styles.feedControls}>
                <label className={styles.inlineControl}>
                  <span>Sort</span>
                  <select
                    className={styles.select}
                    value={effectiveFilters.sort}
                    onChange={(e) => update({ sort: e.target.value as Sort })}
                    aria-label="Sort by"
                  >
                    <option value="closing">Closing soonest</option>
                    <option value="newest">Newest first</option>
                    <option value="salary">Salary, high to low</option>
                  </select>
                </label>
              </div>
            </div>

            <div className={styles.table} id="roles" aria-busy={refreshing} aria-label="Roles">
              {visible.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  role={roleById.get(job.roleId)}
                  showCategory={effectiveFilters.tab === ALL_TAB || effectiveFilters.tab === ARCHIVED_TAB}
                  isNew={isNew(job)}
                  today={today}
                  onStatus={setStatus}
                  onNotes={saveNotes}
                />
              ))}

              {visible.length === 0 ? (
                <div className={styles.empty}>
                  {!data || (refreshing && jobs.length === 0) ? (
                    <>
                      <strong>Searching job boards</strong>
                      The first search takes about a minute. Roles appear here as soon as it finishes.
                    </>
                  ) : jobs.length === 0 ? (
                    <>
                      <strong>No roles found yet</strong>
                      Select Refresh to search again, or change the search in Settings to widen it.
                    </>
                  ) : (
                    <>
                      <strong>No roles match these filters</strong>
                      <button type="button" className={styles.linkbtn} onClick={clearFilters}>
                        Clear filters
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <AddRoleDialog open={dialogOpen} busy={dialogBusy} error={dialogError} onClose={() => setDialogOpen(false)} onSave={addRole} />
      </main>

      <footer className={styles.siteFooter}>
        <div className={styles.siteFooterInner}>
          <p className={styles.foot}>
            © 2026 Sunny&rsquo;s Job Board · Check the original listing before applying.
          </p>
        </div>
      </footer>
    </div>
  );
}
