"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { MAX_LEN } from "@/lib/jobs/types";
import styles from "./board.module.css";

interface Props {
  open: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (input: { name: string; keywords: string }) => void;
}

/** Brief section 2.2: a small dialog with a name (required) and keywords (optional). */
export default function AddRoleDialog({ open, busy, error, onClose, onSave }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const nameId = useId();
  const keywordsId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setName("");
      setKeywords("");
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    onSave({ name: name.trim(), keywords: keywords.trim() });
  }

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} aria-labelledby={`${nameId}-title`}>
      <form className={styles.dialogBody} onSubmit={submit} method="dialog">
        <h2 id={`${nameId}-title`}>Add a role type</h2>
        <p className={styles.notice}>
          It gets its own tab, and a search runs for it straight away.
        </p>

        {error ? (
          <p className={`${styles.notice} ${styles.error}`} role="alert">
            {error}
          </p>
        ) : null}

        <label className={styles.field} htmlFor={nameId}>
          Role name
          <span>For example “Fundraising” or “Audience development”.</span>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_LEN.roleName}
            required
            autoFocus
          />
        </label>

        <label className={styles.field} htmlFor={keywordsId}>
          Extra keywords (optional)
          <span>Related words to widen the search, separated by commas.</span>
          <input
            id={keywordsId}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            maxLength={MAX_LEN.roleKeywords}
            placeholder="PR, content, social media"
          />
        </label>

        <div className={styles.dialogActions}>
          <button type="submit" className={styles.btn} disabled={busy || !name.trim()}>
            {busy ? "Adding" : "Add role and search"}
          </button>
          <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
