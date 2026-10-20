/**
 * Brief 4.5. Applied by the proxy to every response.
 *
 * CSP uses a per-request nonce for scripts (Next.js reads it from the
 * Content-Security-Policy *request* header and stamps its own inline scripts —
 * https://nextjs.org/docs/app/guides/content-security-policy). Styles keep
 * 'unsafe-inline' on purpose: the board sets per-role colours through inline
 * `style` attributes, which nonces cannot cover, and a nonce in style-src would
 * make browsers ignore 'unsafe-inline'. Script injection — the attack that
 * matters — is what the strict script-src blocks.
 */

export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
