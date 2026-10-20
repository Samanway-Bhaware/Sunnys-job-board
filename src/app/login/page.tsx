import type { Metadata } from "next";
import LoginForm from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/**
 * Only a path on this site is an acceptable redirect target. Anything else —
 * an absolute URL, a protocol-relative `//evil.com` — is discarded, so the
 * `next` parameter can never be used to bounce her off to another site.
 */
function safeNext(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brandHeader}>
          <svg viewBox="0 0 512 512" className={styles.brandIcon} fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M256 56C366.457 56 456 145.543 456 256C456 366.457 366.457 456 256 456C145.543 456 56 366.457 56 256C56 145.543 145.543 56 256 56ZM256 166L346 256L256 346L166 256L256 166Z"
            />
          </svg>
          <span>Sunny&rsquo;s Job Board</span>
        </div>
        <h1 className={styles.title}>Sunny&rsquo;s Job Board</h1>
        <p className={styles.intro}>
          Enter the password to see your roles. You only need to do this once on this device.
        </p>
        <LoginForm next={safeNext(next)} />
      </div>
    </main>
  );
}
