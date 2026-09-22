FROM node:26-alpine AS base

# Setting the timezone
RUN apk add -U tzdata && \
    cp /usr/share/zoneinfo/Europe/Copenhagen /etc/localtime

# Set working directory
WORKDIR /usr/src/app

# The file:../shared dependency resolves at install time, so the shared
# package must land at /usr/src/shared before npm install runs.
COPY shared/package.json /usr/src/shared/package.json
RUN npm install --prefix /usr/src/shared --omit=dev --no-package-lock
COPY shared/ /usr/src/shared/

# Copy package.json/package-lock.json and install dependencies
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# Copy other application files
COPY backend/ ./

# Generate Prisma types
RUN npx prisma generate

RUN chmod +x ./entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["./entrypoint.sh"]

CMD ["npm", "run", "dev"]

# --- prod ------------------------------------------------------------------
# Same dependencies as base: the entrypoint needs the prisma CLI for
# `migrate deploy`, and the app runs on tsx because @vmaas/shared exports raw
# .ts files that a plain `tsc` build cannot load at runtime. No bind mounts and
# no watcher. Stays root: it reads ca.key and backend.key, which pki-init
# writes root-owned with mode 600.
FROM base AS prod

ENV NODE_ENV=production

RUN npx tsc --noEmit

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

# Run tsx directly rather than through npm, so SIGTERM reaches the process and
# the graceful shutdown in src/index.ts gets to run.
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
