/**
 * Origin check for state-changing requests (brief section 4.4).
 *
 * SameSite=Lax already blocks cross-site POSTs from other origins, but it is a
 * browser-side control and Lax permits some top-level navigations. This is the
 * server-side half: a state-changing request must either carry no Origin (a
 * non-browser client such as curl or our own tests) or carry one whose host
 * matches the host the request arrived on.
 */

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isStateChanging(method: string): boolean {
  return STATE_CHANGING.has(method.toUpperCase());
}

export function hasValidOrigin(request: Request): boolean {
  if (!isStateChanging(request.method)) return true;

  const origin = request.headers.get("origin");
  // No Origin header: not a browser form/fetch, so CSRF does not apply.
  if (!origin || origin === "null") return true;

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = request.headers.get("host")?.split(",")[0]?.trim();
  const expectedHost = forwardedHost || host;
  if (!expectedHost) return false;

  try {
    const originHost = new URL(origin).host;
    return originHost === expectedHost || (Boolean(host) && originHost === host);
  } catch {
    return false;
  }
}
