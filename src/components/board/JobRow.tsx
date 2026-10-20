"use client";

import { useState } from "react";
import { closingInfo } from "@/lib/client/format";
import { isClosed } from "@/lib/jobs/filter";
import { STATUSES, STATUS_LABELS, type JobView, type RoleView, type Status } from "@/lib/jobs/types";
import styles from "./board.module.css";

const STATUS_COLOR: Record<Status, string> = {
  "": "var(--border)",
  saved: "#5b6f00",
  applied: "#2F5DA8",
  interview: "#A86A12",
  offer: "#1F7A6D",
  rejected: "#9AA0AA",
  hidden: "#9AA0AA",
};

const MODE_LABEL = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unknown: "" } as const;
const MODE_CLASS = { remote: styles.mRemote, hybrid: styles.mHybrid, onsite: styles.mOnsite, unknown: "" } as const;

const SPONSORSHIP_LABEL = {
  offered: "Sponsorship: Offered",
  not_offered: "Sponsorship: Not offered",
  not_stated: "Sponsorship: Not stated",
} as const;

interface Props {
  job: JobView;
  role: RoleView | undefined;
  showCategory: boolean;
  isNew: boolean;
  today: string;
  onStatus: (id: string, status: Status) => void;
  onNotes: (id: string, notes: string) => Promise<void>;
}

function orgMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
}

function formatSource(source: string): string {
  if (!source) return "";
  const s = source.toLowerCase().trim();
  if (s.includes("freehire (") && s.endsWith(")")) {
    const inner = source.replace(/freehire\s*\(([^)]+)\)/i, "$1").trim();
    return inner.charAt(0).toUpperCase() + inner.slice(1);
  }
  if (s === "freehire") return "FreeHire";
  if (s === "reed") return "Reed";
  if (s === "artsjobs") return "Arts Jobs";
  if (s === "guardian") return "Guardian Jobs";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

export default function JobRow({ job, role, showCategory, isNew, today, onStatus, onNotes }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(job.notes);
  const [saving, setSaving] = useState(false);
  const closing = closingInfo(job.closingDate, today);
  const closed = isClosed(job, today);
  const catColor = role?.color ?? "#5b6f00";

  async function saveNotes() {
    setSaving(true);
    try {
      await onNotes(job.id, draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const hours = job.hoursText || (job.contract === "full_time" ? "Full-time" : job.contract === "part_time" ? "Part-time" : "");
  const displaySource = formatSource(job.source);
  const displayEvidence = job.sponsorshipEvidence
    ? job.sponsorshipEvidence.replace(/\s*\(freehire\)/gi, "").trim()
    : "";

  return (
    <article
      data-testid="job-card"
      className={`${styles.row}${closed ? ` ${styles.isClosed}` : ""}`}
      style={{ "--cat": catColor } as React.CSSProperties}
    >
      <div className={styles.cardBody}>
        <div className={styles.cardTop}>
          <div className={styles.cOrg}>
            <span className={styles.orgLogo} aria-hidden="true">
              {orgMonogram(job.org)}
            </span>
            <span className={styles.orgName}>{job.org}</span>
            {job.licensedSponsor ? (
              <span
                className={styles.badgeSponsor}
                title={`Matched to ${job.sponsorMatchName ?? job.org} on the UK sponsor register. This doesn't guarantee this role is sponsored.`}
              >
                Licensed sponsor
              </span>
            ) : null}
          </div>

          <div className={styles.cardMetaRight}>
            {displaySource ? <span className={styles.src}>{displaySource}</span> : null}
            <span className={closing.tone === "soon" ? styles.soon : closing.tone === "muted" ? styles.muted : undefined}>
              {closing.text}
            </span>
          </div>
        </div>

        <div className={styles.cRole}>
          <h3 className={styles.title}>{job.title}</h3>
        </div>

        <div className={styles.badgeRow}>
          {isNew ? <span className={styles.new}>New</span> : null}
          {showCategory && role ? <span className={styles.cat}>{role.name}</span> : null}
          {job.workMode !== "unknown" ? (
            <span className={`${styles.mode} ${MODE_CLASS[job.workMode]}`}>{MODE_LABEL[job.workMode]}</span>
          ) : null}
          {hours ? <span className={styles.badge}>{hours}</span> : null}
          {job.salaryText ? <span className={styles.badge}>{job.salaryText}</span> : null}
          <span className={styles.sub} title={displayEvidence || undefined}>
            {SPONSORSHIP_LABEL[job.sponsorship]}
          </span>
          {job.linkStatus === "unverified" ? <span className={styles.badge}>Link not checked</span> : null}
          <span className={styles.loc}>{job.locationText || job.locationNorm}</span>
        </div>
      </div>

      <div className={styles.cardFooter}>
        <select
          className={styles.status}
          style={{ borderLeftColor: STATUS_COLOR[job.status] }}
          value={job.status}
          onChange={(e) => onStatus(job.id, e.target.value as Status)}
          aria-label={`Status for ${job.title} at ${job.org}`}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={styles.noteBtn}
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
        >
          {editing ? "Hide notes" : job.notes ? "Edit notes" : "Add a note"}
        </button>

        <div className={styles.cLink}>
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View listing: ${job.title} at ${job.org} (opens in a new tab)`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
            View listing
          </a>
        </div>
      </div>

      {!editing && job.notes ? (
        <div className={styles.notesRow}>
          <div className={styles.notesPreview}>{job.notes}</div>
        </div>
      ) : null}

      {editing ? (
        <div className={styles.notesRow}>
          <label className={styles.field}>
            Notes
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} />
          </label>
          <div className={styles.notesActions}>
            <button type="button" className={styles.btn} onClick={saveNotes} disabled={saving}>
              {saving ? "Saving" : "Save note"}
            </button>
            <button
              type="button"
              className={styles.linkbtn}
              onClick={() => {
                setDraft(job.notes);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
