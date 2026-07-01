# ARG used in a FROM must be declared BEFORE the first FROM (global scope) —
# declared mid-file it is stage-scoped and the second FROM sees it blank.
# Supervisor overrides this via --build-arg from build.yaml.
ARG BUILD_FROM=ghcr.io/hassio-addons/base:21.0.0

# =========================================================================
# Build stage — compile the Next.js standalone bundle with a full Node image.
# =========================================================================
FROM node:22-alpine AS webbuild
WORKDIR /build
# Install deps first for layer caching. lockfile optional on first build.
COPY webapp/package.json webapp/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY webapp/ ./
RUN npm run build

# =========================================================================
# Runtime stage — HA add-on base (s6-overlay v3 + bashio) + Node + Postgres.
# BUILD_FROM is injected by the HA build system from build.yaml; the global
# default above keeps a plain `docker build` working locally.
# =========================================================================
FROM ${BUILD_FROM}

# Node runtime + bundled PostgreSQL 16 (Alpine 3.24 provides both).
RUN apk add --no-cache \
      nodejs \
      postgresql16 \
      postgresql16-client \
      postgresql16-contrib \
      tzdata \
    && rm -rf /var/cache/apk/*

ENV TZ=Pacific/Auckland \
    NODE_ENV=production

WORKDIR /opt/timeclock
# Next standalone output: server.js + traced node_modules, then static + public.
COPY --from=webbuild /build/.next/standalone ./
COPY --from=webbuild /build/.next/static ./.next/static
COPY --from=webbuild /build/public ./public
# SQL migrations (applied by migrate.sh via psql on boot).
COPY --from=webbuild /build/db/migrations /opt/timeclock/migrations

# s6 services + helper scripts + ingress proxy.
COPY rootfs /

# COPY from a Windows build context loses the +x bit — restore it.
RUN chmod +x \
      /etc/timeclock/*.sh \
      /etc/s6-overlay/s6-rc.d/*/run \
      /etc/s6-overlay/s6-rc.d/*/up 2>/dev/null || true

LABEL \
  io.hass.name="Time Clock" \
  io.hass.description="Employee time-clock with immutable audit trail" \
  io.hass.type="addon" \
  io.hass.version="0.0.1"
