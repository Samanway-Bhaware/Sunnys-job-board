"use client";

import { useId, useState, type FormEvent } from "react";
import styles from "./login.module.css";

export default function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data: unknown = await response.json().catch(() => null);

      if (response.ok) {
        // A full navigation, so the proxy re-runs and the new cookie is used.
        window.location.replace(next);
        return;
      }

      const message =
        data && typeof data === "object" && "message" in data && typeof data.message === "string"
          ? data.message
          : "Something went wrong. Try again in a moment.";
      setError(message);
      setPassword("");
    } catch {
      setError("Couldn't reach the site. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error ? (
        <p className={styles.error} role="alert" aria-live="assertive">
          {error}
        </p>
      ) : null}

      <label className={styles.field} htmlFor={passwordId}>
        Password
        <input
          id={passwordId}
          className={styles.input}
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      <button className={styles.button} type="submit" disabled={busy || password.length === 0}>
        {busy ? "Checking" : "Continue"}
      </button>
    </form>
  );
}
