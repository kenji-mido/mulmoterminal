// Which browser origins may open this server's sockets and reach its privileged routes.
//
// Only same-machine browser origins, so a malicious website the user happens to visit can't
// drive the local Claude PTY (a cross-site WebSocket hijack). A MISSING Origin is allowed —
// that is a non-browser local client, which cannot be a cross-site request. Any localhost
// host on any port is allowed, which is what covers the Vite dev proxy.
//
// SAME-ORIGIN (remote use). When the browser is NOT on the server's machine — a phone over
// Tailscale, an SSH port-forward — the page is served BY this server, so the Origin the page
// carries is the very host:port it was fetched from. Passing the request's own Host header
// lets us allow exactly that case: the Origin's host equals the Host the request arrived on.
// This does NOT widen the cross-site hole — a malicious `evil.com` page still sends
// `Origin: evil.com`, which never equals our Host, so it stays rejected. Only pages the
// server itself served (over LAN / Tailscale / a tunnel) gain access, which is the point.
//
// MULMOTERMINAL_ALLOWED_ORIGINS is an explicit comma-separated escape hatch for the reverse
// proxy case, where the Host the app sees (an internal one) differs from the public Origin.
//
// Out of index.ts because every route module and the pub/sub socket take this as a
// dependency and every one of their tests passes a stub, so the real predicate — the single
// thing standing between a visited page and the user's terminal — was the one piece nothing
// exercised (#548).
//
// `hostname` is what `new URL()` normalises to, so an IPv6 literal arrives bracketed
// (`[::1]`) however it was written, and a host is already lower-cased and punycoded.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Parsed once at load: the explicit allowlist (exact `scheme://host[:port]` origins), lower-cased.
const ENV_ALLOWED_ORIGINS = new Set(
  (process.env.MULMOTERMINAL_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0),
);

// `host` is the request's own Host header (`req.headers.host`) when the caller has it; the
// same-origin allowance is skipped when it's absent (e.g. the socket.io cors callback, which
// only sees the origin — allowRequest, which does have the request, is the real gate there).
export function isAllowedOrigin(origin?: string, host?: string): boolean {
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (LOOPBACK_HOSTNAMES.has(url.hostname)) return true;
  if (host && url.host.toLowerCase() === host.toLowerCase()) return true;
  return ENV_ALLOWED_ORIGINS.has(origin.toLowerCase());
}
