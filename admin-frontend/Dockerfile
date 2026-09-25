# Built from the repo root (compose sets context: ..) so the shared package and
# the frontend can be copied in side by side. No platform pin: the official
# node image is multi-arch, so Apple Silicon builds a native arm64 image and
# Windows/Linux build amd64.
FROM node:26-alpine AS base

# Same timezone as the backend so server-rendered dates match.
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Europe/Copenhagen /etc/localtime

WORKDIR /usr/src/app

# The file:../shared dependency resolves at install time, so the shared
# package must land at /usr/src/shared before npm ci runs.
COPY shared/package.json /usr/src/shared/package.json
RUN npm install --prefix /usr/src/shared --omit=dev --no-package-lock
COPY shared/ /usr/src/shared/

COPY admin-frontend/package.json admin-frontend/package-lock.json ./
RUN npm ci

ENV NEXT_TELEMETRY_DISABLED=1

# --- dev -------------------------------------------------------------------
# The entrypoint copies the host's working copy over this source on every start
# (see docker/admin-frontend-entrypoint.sh); `docker compose watch` keeps it in
# sync afterwards. The COPY below is still what makes the image runnable on its
# own, without any mounts.
FROM base AS dev

COPY admin-frontend/ ./
COPY docker/admin-frontend-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "dev"]

# --- builder ---------------------------------------------------------------
# `next build` type-checks, and the frontend imports types from the backend
# (`@prisma`, `@backend-responses` in tsconfig.json), which in turn reach into
# backend services and their dependencies. So the backend is laid out beside
# the frontend exactly as in the repo, with its dependencies installed and its
# Prisma client generated. None of it reaches the final image.
FROM base AS builder

WORKDIR /usr/src/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY backend/prisma.config.ts ./
COPY backend/prisma ./prisma
COPY backend/src ./src
RUN npx prisma generate

WORKDIR /usr/src/app
COPY admin-frontend/ ./

# Inlined into the browser bundle at build time, so it is a build argument and
# changing it means rebuilding the image, not restarting the container.
ARG NEXT_PUBLIC_BACKEND_URL
RUN test -n "$NEXT_PUBLIC_BACKEND_URL" || (echo "NEXT_PUBLIC_BACKEND_URL build arg is required" && exit 1)
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NODE_ENV=production

RUN npm run build

# --- prod ------------------------------------------------------------------
# Only the standalone server and its static assets. outputFileTracingRoot is the
# parent directory (next.config.ts), so the server lands under app/.
FROM node:26-alpine AS prod

RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Europe/Copenhagen /etc/localtime

WORKDIR /usr/src

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /usr/src/app/.next/standalone ./
COPY --from=builder --chown=node:node /usr/src/app/.next/static ./app/.next/static
COPY --from=builder --chown=node:node /usr/src/app/public ./app/public

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1

CMD ["node", "app/server.js"]
