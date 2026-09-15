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
