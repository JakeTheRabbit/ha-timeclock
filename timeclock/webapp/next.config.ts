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
  // These packages must stay external runtime requires (not bundled by webpack).
  // pdfkit: bundling rewrites __dirname and breaks its .afm font loading (ENOENT
  //   Helvetica.afm in standalone).
  // date-holidays: loads its rule/locale data (data/holidays.json etc.) via
  //   package-relative paths at runtime; when webpack bundles it those files are
  //   dropped and it is NOT copied into .next/standalone/node_modules, so every
  //   non-NZ holiday lookup throws MODULE_NOT_FOUND. Marking it external makes
  //   NFT trace the whole package (incl. its data) into the standalone output.
  serverExternalPackages: ["pdfkit", "date-holidays"],
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
