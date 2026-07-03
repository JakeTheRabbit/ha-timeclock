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

// GitHub Pages demo build (NEXT_PUBLIC_DEMO=1): a fully static export served
// under /ha-timeclock, with the in-browser demo backend (lib/demo). No Hono, no
// Postgres, no ingress proxy — so we swap output/basePath here. The PRODUCTION
// add-on build (flag unset) is untouched: standalone + ingress sentinel.
const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
const PAGES_BASE = "/ha-timeclock";

const productionConfig: NextConfig = {
  output: "standalone",
  basePath: INGRESS_BASE,
  // Ingress root-404 fix. Next emits the app ROOT link as BARE "/ha-ingress"
  // (basePath root has no trailing slash — in rendered hrefs AND in the client
  // router's addBasePath("/") pushState). The proxy rewrites the sentinel to
  // HA's ingress prefix, producing a BARE-token URL (/api/hassio_ingress/<tok>)
  // — which HA-core's ingress route does NOT match (404 before auth; only
  // /<tok>/ and /<tok>/<path> match). So "back to Home" 404'd inside the panel.
  //   trailingSlash: emit "/ha-ingress/" (root) and "/ha-ingress/pin/" — the
  //     rewritten URL then ends in "/<tok>/…", which HA matches.
  //   skipTrailingSlashRedirect: CRITICAL companion — without it Next 308s every
  //     non-slashed request, which would hit the API (lib/api-client builds
  //     "/ha-ingress/api/…" WITHOUT a trailing slash, and a 308 on POST bodies
  //     through the ingress chain is fragile). With skip, Next serves BOTH forms
  //     without redirecting while still generating slashed URLs.
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
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

// Static export for GitHub Pages. The API layer routes to lib/demo in-browser,
// so the app is fully functional as a client-only static site.
const demoConfig: NextConfig = {
  output: "export",
  basePath: PAGES_BASE,
  trailingSlash: true, // Pages serves /path/ -> /path/index.html cleanly
  images: { unoptimized: true }, // no image optimizer on static hosting
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  env: {
    TZ: "Pacific/Auckland",
    // Client fetches build "<base>/api/..."; demoFetch strips up to /api, so the
    // exact base value is cosmetic here — keep it aligned with the Pages base.
    NEXT_PUBLIC_BASE_PATH: PAGES_BASE,
    NEXT_PUBLIC_DEMO: "1",
  },
};

export default DEMO ? demoConfig : productionConfig;
