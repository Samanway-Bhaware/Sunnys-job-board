"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { MAX_LEN, type RoleView, type ScopeView } from "@/lib/jobs/types";

import styles from "./settings.module.css";

type Msg = { kind: "ok" | "err"; text: string } | null;

export default function SettingsForm() {
  const [scope, setScope] = useState<ScopeView | null>(null);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [newLocation, setNewLocation] = useState("");
  const [scopeMsg, setScopeMsg] = useState<Msg>(null);
  const [roleMsg, setRoleMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState(false);
  const [newRole, setNewRole] = useState({ name: "", keywords: "" });

  useEffect(() => {
    try {
      const isDark = window.localStorage.getItem("hire.theme") === "dark";
      document.documentElement.classList.toggle("dark", isDark);
    } catch {
      /* ignore */
    }

    api
      .board()
      .then((board) => {
        setScope(board.scope);
        setRoles(board.roles.filter((r) => !r.archived).sort((a, b) => a.sortOrder - b.sortOrder));
      })
      .catch((e) => setScopeMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Couldn't load settings." }));
  }, []);

  const err = (e: unknown, fallback: string) => ({ kind: "err" as const, text: e instanceof ApiError ? e.message : fallback });

  async function saveScope() {
    if (!scope) return;
    setSaving(true);
    setScopeMsg(null);
    try {
      const { scope: saved } = await api.updateScope(scope);
      setScope(saved);
      setScopeMsg({ kind: "ok", text: "Saved. The next search will use these settings." });
    } catch (e) {
      setScopeMsg(err(e, "Couldn't save. Try again."));
    } finally {
      setSaving(false);
    }
  }

  function addLocation() {
    const v = newLocation.trim();
    if (!v || !scope || scope.locations.includes(v)) return;
    setScope({ ...scope, locations: [...scope.locations, v] });
    setNewLocation("");
  }

  async function patchRole(id: string, patch: { name?: string; keywords?: string; enabled?: boolean }) {
    try {
      const { role } = await api.updateRole(id, patch);
      setRoles((rs) => rs.map((r) => (r.id === id ? role : r)));
      setRoleMsg(null);
    } catch (e) {
      setRoleMsg(err(e, "Couldn't save that change."));
    }
  }

  async function move(id: string, dir: -1 | 1) {
    const index = roles.findIndex((r) => r.id === id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= roles.length) return;
    const order = roles.map((r) => r.id);
    [order[index], order[target]] = [order[target]!, order[index]!];
    try {
      const { roles: saved } = await api.reorderRoles(order);
      setRoles(saved.filter((r) => !r.archived).sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (e) {
      setRoleMsg(err(e, "Couldn't reorder."));
    }
  }

  async function remove(role: RoleView) {
    const confirmed = window.confirm(
      `Delete “${role.name}”?\n\nRoles you're tracking under it move to an Archived tab. Everything else under it is removed.`,
    );
    if (!confirmed) return;
    try {
      const { outcome } = await api.deleteRole(role.id);
      setRoles((rs) => rs.filter((r) => r.id !== role.id));
      setRoleMsg({
        kind: "ok",
        text: outcome.kind === "archived" ? `“${role.name}” removed. Your tracked roles are in the Archived tab.` : `“${role.name}” removed.`,
      });
    } catch (e) {
      setRoleMsg(err(e, "Couldn't delete that role."));
    }
  }

  async function addRole() {
    if (!newRole.name.trim()) return;
    try {
      const { role } = await api.createRole({ name: newRole.name.trim(), keywords: newRole.keywords.trim() });
      setRoles((rs) => [...rs, role]);
      setNewRole({ name: "", keywords: "" });
      setRoleMsg({ kind: "ok", text: `“${role.name}” added. A search for it is running now — see the board.` });
    } catch (e) {
      setRoleMsg(err(e, "Couldn't add that role."));
    }
  }

  async function signOut() {
    try {
      await api.logout();
    } finally {
      window.location.replace("/login");
    }
  }

  return (
    <div className={styles.shell}>
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
              <Link href="/" className={styles.navLink}>
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
              <Link href="/settings" className={`${styles.navLink} ${styles.navLinkActive}`}>
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
          <Link href="/" className={styles.back}>
            Back to the board →
          </Link>
        </div>
      </header>

      <main className={styles.wrap}>
        <div className={styles.top}>
          <div>
            <p className={styles.eyebrow}>{"// configuration"}</p>
            <h1>Settings</h1>
          </div>
        </div>

        <section className={styles.section} aria-labelledby="search-h">
          <p className={styles.subhead}>{"// search scope"}</p>
          <h2 id="search-h">Search</h2>
          <p className={styles.hint}>
            This decides what gets fetched. The filters on the board only narrow what&rsquo;s already been found.
          </p>

          {scope ? (
            <>
              <label className={styles.field}>
                Sector
                <span>Interpreted broadly: arts, festivals, museums, theatre, music, film, publishing, design, media, games, agencies, creative charities.</span>
                <input value={scope.sector} maxLength={MAX_LEN.sector} onChange={(e) => setScope({ ...scope, sector: e.target.value })} />
              </label>

              <div className={styles.field}>
                Locations
                <span>Where roles should be. Add as many as you like.</span>
                <div className={styles.pills}>
                  {scope.locations.map((loc) => (
                    <span key={loc} className={styles.pill}>
                      {loc}
                      <button type="button" className={styles.pillX} aria-label={`Remove ${loc}`} onClick={() => setScope({ ...scope, locations: scope.locations.filter((l) => l !== loc) })}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className={styles.addRow}>
                  <input
                    value={newLocation}
                    maxLength={MAX_LEN.locationEntry}
                    placeholder="Add a place, e.g. Glasgow"
                    aria-label="Add a location"
                    onChange={(e) => setNewLocation(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addLocation();
                      }
                    }}
                  />
                  <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={addLocation}>
                    Add
                  </button>
                </div>
              </div>

              <label className={styles.field}>
                Notes for the search
                <span>Anything the search should know about what you&rsquo;re after.</span>
                <textarea rows={3} value={scope.notes} maxLength={MAX_LEN.searchNotes} onChange={(e) => setScope({ ...scope, notes: e.target.value })} />
              </label>

              <div className={styles.actions}>
                <button type="button" className={styles.btn} onClick={saveScope} disabled={saving}>
                  {saving ? "Saving" : "Save search settings"}
                </button>
                {scopeMsg ? <p className={`${styles.msg} ${scopeMsg.kind === "ok" ? styles.ok : styles.err}`} role="status">{scopeMsg.text}</p> : null}
              </div>
            </>
          ) : (
            <p className={styles.hint}>{scopeMsg?.text ?? "Loading…"}</p>
          )}
        </section>

        <section className={styles.section} aria-labelledby="roles-h">
          <p className={styles.subhead}>{"// categories"}</p>
          <h2 id="roles-h">Role types</h2>
          <p className={styles.hint}>Each role gets its own tab and its own search. Up to 10.</p>

          <div className={styles.roleList}>
            {roles.map((role, i) => (
              <div key={role.id} className={`${styles.role}${role.enabled ? "" : ` ${styles.disabledRole}`}`}>
                <span className={styles.roleDot} style={{ background: role.color }} aria-hidden="true" />
                <div className={styles.roleFields}>
                  <input aria-label={`Name for ${role.name}`} defaultValue={role.name} maxLength={MAX_LEN.roleName} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== role.name && patchRole(role.id, { name: e.target.value })} />
                  <input aria-label={`Keywords for ${role.name}`} defaultValue={role.keywords} maxLength={MAX_LEN.roleKeywords} placeholder="Extra keywords, comma separated" onBlur={(e) => e.target.value.trim() !== role.keywords && patchRole(role.id, { keywords: e.target.value })} />
                  <label className={styles.check}>
                    <input type="checkbox" checked={role.enabled} onChange={(e) => patchRole(role.id, { enabled: e.target.checked })} />
                    Include in searches
                  </label>
                </div>
                <div className={styles.roleTools}>
                  <button type="button" className={`${styles.btn} ${styles.ghost} ${styles.small}`} onClick={() => move(role.id, -1)} disabled={i === 0} aria-label={`Move ${role.name} up`}>
                    ↑ Up
                  </button>
                  <button type="button" className={`${styles.btn} ${styles.ghost} ${styles.small}`} onClick={() => move(role.id, 1)} disabled={i === roles.length - 1} aria-label={`Move ${role.name} down`}>
                    ↓ Down
                  </button>
                  <button type="button" className={`${styles.btn} ${styles.danger} ${styles.small}`} onClick={() => remove(role)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {roles.length < 10 ? (
            <div className={styles.addRow}>
              <input value={newRole.name} maxLength={MAX_LEN.roleName} placeholder="New role name" aria-label="New role name" onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} />
              <input value={newRole.keywords} maxLength={MAX_LEN.roleKeywords} placeholder="Keywords (optional)" aria-label="New role keywords" onChange={(e) => setNewRole({ ...newRole, keywords: e.target.value })} />
              <button type="button" className={styles.btn} onClick={addRole} disabled={!newRole.name.trim()}>
                Add role
              </button>
            </div>
          ) : (
            <p className={styles.hint}>You have 10 roles, the most the board allows. Delete one to add another.</p>
          )}
          {roleMsg ? <p className={`${styles.msg} ${roleMsg.kind === "ok" ? styles.ok : styles.err}`} role="status">{roleMsg.text}</p> : null}
        </section>

        <section className={styles.section} aria-labelledby="export-h">
          <p className={styles.subhead}>{"// export"}</p>
          <h2 id="export-h">Your tracked roles</h2>
          <p className={styles.hint}>
            A spreadsheet of every role you&rsquo;ve given a status, with your notes. Opens in Excel, Numbers or Google Sheets.
          </p>
          <div className={styles.actions}>
            <a className={`${styles.btn} ${styles.ghost}`} href="/api/export.csv" download>
              Export tracked roles (CSV)
            </a>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="session-h">
          <p className={styles.subhead}>{"// session"}</p>
          <h2 id="session-h">This device</h2>
          <p className={styles.hint}>You&rsquo;ll be asked for the password next time you open the site on this browser.</p>
          <div className={styles.actions}>
            <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={signOut}>
              Sign out of this device
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
