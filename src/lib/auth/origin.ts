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

  const expectedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!expectedHost) return false;

  try {
    return new URL(origin).host === expectedHost;
  } catch {
    return false;
  }
}
