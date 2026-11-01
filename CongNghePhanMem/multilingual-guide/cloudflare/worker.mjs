// Expo Router single-page static export. FastAPI remains a separate HTTPS service.
const pages = new Set([
  "map",
  "login",
  "register",
  "admin",
  "journeys",
  "saved",
  "profile",
  "history",
  "account",
]);
export function assetPath(pathname) {
  const clean = pathname.replace(/\/+$/, "") || "/";

  if (
    clean === "/" ||
    pages.has(clean.slice(1)) ||
    /^\/place\/[^/.]+$/.test(clean)
  ) {
    return "/index.html";
  }

  return pathname;
}
export default {
  async fetch(request, env) {
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    const url = new URL(request.url);
    url.pathname = assetPath(url.pathname);
    const response = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-Frame-Options", "DENY");
    headers.set(
      "Permissions-Policy",
      "geolocation=(self), camera=(), microphone=()",
    );
    if (headers.get("content-type")?.includes("text/html"))
      headers.set("Cache-Control", "no-cache");
    return new Response(response.body, { status: response.status, headers });
  },
};
