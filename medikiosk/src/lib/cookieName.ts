/**
 * Session cookie name — shared by the auth lib, the login route and the proxy
 * (middleware) guard so all three always agree.
 *
 * `__Host-` prefix is the strongest cookie-hardening prefix but REQUIRES the
 * Secure attribute (HTTPS). Browsers reject it over plain http, so it is
 * opt-in via MEDIKIOSK_HOST_COOKIE_PREFIX=1 for HTTPS deployments; local
 * `next start` demos keep the plain name and work over http.
 */
export function sessionCookieName(): string {
  return process.env.MEDIKIOSK_HOST_COOKIE_PREFIX === "1"
    ? "__Host-medikiosk_session"
    : "medikiosk_session";
}