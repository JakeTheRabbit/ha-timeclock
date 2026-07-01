import type { NextConfig } from "next";

// IMPORTANT — keep this value in sync with:
//   • server/hono.ts           (Hono basePath)
//   • rootfs/etc/timeclock/*    (SENTINEL env for the ingress proxy)
// This is the "sentinel" base path. Next emits every URL (HTML links, router
// hrefs, and the webpack publicPath baked into JS chunks) prefixed with it.
// The ingress reverse-proxy (proxy.js) rewrites the sentinel to HA's real
// per-session X-Ingress-Path on the way out, so assets route back through
// Ingress without 404s. See DOCS.md → "How Ingress routing works".
const INGRESS_BASE = "/ha-ingress";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: INGRESS_BASE,
  // pdfkit must stay an external runtime require: bundling it rewrites
  // __dirname and breaks its .afm font loading (ENOENT Helvetica.afm in
  // standalone). External = NFT traces the whole package incl. font data.
  serverExternalPackages: ["pdfkit"],
  // Ingress is same-origin behind HA; no asset CDN. basePath already prefixes
  // /_next assets, so we do NOT set assetPrefix (would double-prefix).
  reactStrictMode: true,
  eslint: {
    // Lint runs in CI (P1), not in the production image build.
    ignoreDuringBuilds: true,
  },
  env: {
    TZ: "Pacific/Auckland",
    // Baked into client bundles; the ingress proxy rewrites the sentinel in JS
    // text too, so client fetches route through ingress correctly.
    NEXT_PUBLIC_BASE_PATH: INGRESS_BASE,
  },
};

export default nextConfig;
