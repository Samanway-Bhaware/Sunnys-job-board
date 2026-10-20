"use client";

import { ago } from "@/lib/client/format";
import type { SettingsData } from "@/lib/client/api";
import type { RoleView } from "@/lib/jobs/types";
import styles from "./settings.module.css";

interface Props {
  data: Pick<SettingsData, "cooldownMinutes" | "lastRun" | "lastRefreshAt" | "register" | "scrapers">;
  roles: RoleView[];
}

export default function RefreshSection({ data, roles }: Props) {
  const name = (id: string) => roles.find((r) => r.id === id)?.name ?? "Removed role";
  const run = data.lastRun;
  const scrapers = data.scrapers ?? [];

  return (
    <section className={styles.section} aria-labelledby="refresh-h">
      <p className={styles.subhead}>{"// data source"}</p>
      <h2 id="refresh-h">Job Search</h2>
      <p className={styles.hint}>
        Opening the board runs a refresh if the last one is more than {data.cooldownMinutes === 0 ? "a moment" : `${data.cooldownMinutes} minutes`} old.
        The Refresh button always fetches the latest listings.
      </p>

      {scrapers.length > 0 ? (
        <div>
          <h3 className={styles.subhead}>Data source</h3>
          <ul className={styles.sourceList}>
            {scrapers.map((s) => (
              <li key={s.id} className={styles.sourceItem}>
                <span className={styles.sourceName}>
                  {s.name}
                  {!s.requiresKey ? <span className={styles.sourceMeta}> · Keyless public endpoint</span> : null}
                </span>
                {s.configured ? (
                  <span className={`${styles.statusBadge} ${styles.statusActive}`}>Active</span>
                ) : (
                  <span className={`${styles.statusBadge} ${styles.statusPending}`}>
                    Not configured
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className={styles.hint}>
        UK sponsor register: {data.register.available ? `${data.register.rows.toLocaleString()} entries, updated ${ago(data.register.updatedAt)}.` : `not available${data.register.lastError ? ` (${data.register.lastError})` : ""}.`}
      </p>

      {run ? (
        <div className={styles.roleFields}>
          <div className={styles.scrapeSummary}>
            Last refresh: {run.status === "done" ? "finished" : run.status === "failed" ? "didn't finish" : "running"} {ago(run.finishedAt ?? run.startedAt)}
            {run.error ? ` — ${run.error}` : ""}
          </div>
          <ul className={styles.scrapeList}>
            {Object.entries(run.progress).map(([roleId, p]) => (
              <li key={roleId} className={styles.scrapeItem}>
                <span className={styles.sourceName}>{name(roleId)}</span>
                <span className={styles.hint}>
                  {p.state === "done"
                    ? `${p.count ?? 0} found${p.stats ? ` (${p.stats.added} new, ${p.stats.verified} verified links)` : ""}`
                    : p.state === "error"
                      ? `didn't finish — ${p.error ?? "unknown reason"}`
                      : "searching"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.hint}>No refreshes yet.</p>
      )}
    </section>
  );
}
