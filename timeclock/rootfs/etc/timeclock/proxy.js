'use strict';
/*
 * Home Assistant Ingress reverse-proxy.
 *
 * HA forwards requests to this add-on with the ingress token prefix removed and
 * adds header  X-Ingress-Path = the real prefix  (e.g. /api/hassio_ingress/ab12).
 * The Next.js app is built with basePath = SENTINEL ("/ha-ingress"), so every
 * URL it emits — HTML links, router hrefs, and the webpack publicPath baked
 * into JS chunks — carries SENTINEL.
 *
 *   inbound : strip X-Ingress-Path if HA left it on, then prepend SENTINEL so
 *             Next (which serves under basePath) matches the request.
 *   outbound: swap SENTINEL -> X-Ingress-Path in text bodies + Location header,
 *             so the browser builds URLs that route back through Ingress.
 *
 * Direct access (no ingress header) -> prefix "" -> app works at the root too.
 * No external deps: runs on the plain Node runtime in the image.
 */

const http = require('http');

const UPSTREAM = process.env.UPSTREAM || 'http://127.0.0.1:3000';
const PORT = parseInt(process.env.INGRESS_PORT || '8099', 10);
const SENTINEL = process.env.SENTINEL || '/ha-ingress';
const upstream = new URL(UPSTREAM);

// Only rewrite text-ish payloads; never touch fonts/images/wasm.
const REWRITE_TYPES = [
  'text/html',
  'application/javascript',
  'text/javascript',
  'text/css',
  'application/json',
  'application/manifest+json',
];

function isRewritable(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return REWRITE_TYPES.some((t) => ct.includes(t));
}

function replaceAll(str, find, repl) {
  return str.split(find).join(repl);
}

// Hop-by-hop headers must never be forwarded (RFC 7230 §6.1). Critically:
// upstream sends chunked (transfer-encoding) while we buffer and set
// content-length — forwarding BOTH is illegal and Supervisor's aiohttp
// rejects the response with 400 ("Content-Length can't be present with
// Transfer-Encoding"). Node manages framing itself on the way out.
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
];
function stripHopByHop(headers) {
  for (const h of HOP_BY_HOP) delete headers[h];
  return headers;
}

// Ingress requests reach the add-on from the Supervisor gateway. Identity
// headers (X-Remote-User-*) are only trustworthy from that source — strip them
// from anything else so another container on the docker network cannot spoof an
// HA user. Loopback stays trusted for local dev/tests.
const TRUSTED_SOURCES = (process.env.TRUSTED_SOURCES || '172.30.32.2,127.0.0.1,::1,::ffff:127.0.0.1')
  .split(',')
  .map((s) => s.trim());

const server = http.createServer((req, res) => {
  if (!TRUSTED_SOURCES.includes(req.socket.remoteAddress)) {
    delete req.headers['x-ingress-path'];
    delete req.headers['x-remote-user-id'];
    delete req.headers['x-remote-user-name'];
    delete req.headers['x-remote-user-display-name'];
  }
  const ingressPath = (req.headers['x-ingress-path'] || '').replace(/\/+$/, '');

  // Defensive: some HA versions may forward the prefix; strip it if present.
  let path = req.url || '/';
  if (ingressPath && path.startsWith(ingressPath)) {
    path = path.slice(ingressPath.length) || '/';
  }
  if (!path.startsWith('/')) path = '/' + path;
  // The ingress iframe base ends in "/", but Next's basePath root is
  // "/ha-ingress" (no trailing slash). Collapsing the root avoids Next's 308
  // trailing-slash redirect (which would ping-pong through ingress forever).
  const upstreamPath = path === '/' ? SENTINEL : SENTINEL + path;

  const headers = Object.assign({}, req.headers, { host: upstream.host });
  // Force identity encoding so we can string-rewrite bodies deterministically.
  headers['accept-encoding'] = 'identity';

  const proxyReq = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: upstreamPath,
      headers,
    },
    (proxyRes) => {
      const outHeaders = stripHopByHop(Object.assign({}, proxyRes.headers));

      if (typeof outHeaders.location === 'string') {
        outHeaders.location = replaceAll(outHeaders.location, SENTINEL, ingressPath);
      }
      // Next emits a meta-refresh header alongside 308s — rewrite it too.
      if (typeof outHeaders.refresh === 'string') {
        outHeaders.refresh = replaceAll(outHeaders.refresh, SENTINEL, ingressPath);
      }

      if (isRewritable(proxyRes.headers['content-type'])) {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          const body = replaceAll(
            Buffer.concat(chunks).toString('utf8'),
            SENTINEL,
            ingressPath,
          );
          const buf = Buffer.from(body, 'utf8');
          delete outHeaders['content-length'];
          outHeaders['content-length'] = String(buf.length);
          res.writeHead(proxyRes.statusCode || 502, outHeaders);
          res.end(buf);
        });
        proxyRes.on('error', () => res.destroy());
      } else {
        res.writeHead(proxyRes.statusCode || 502, outHeaders);
        proxyRes.pipe(res);
      }
    },
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Ingress upstream error: ' + err.message);
  });

  req.pipe(proxyReq);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ingress] listening on :${PORT} -> ${UPSTREAM} (sentinel ${SENTINEL})`);
});
