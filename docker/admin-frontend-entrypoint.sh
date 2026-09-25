#!/bin/sh
set -e

# The host working copy is bind-mounted read-only at /usr/src/*-src. Copy it into
# the container's own filesystem on every start, so the container can never run
# stale code baked into the image, then let `docker compose watch` keep it in
# sync for the rest of the session.
#
# Why not run Next directly from the bind mount: Docker Desktop shares host
# folders over 9p (Windows) and VirtioFS (macOS). Neither delivers inotify events
# into the container, so Turbopack never sees an edit, and next.config.ts's
# watchOptions.pollIntervalMs does not reach the watcher either. Running from the
# container's own filesystem also keeps the hot paths off the shared folder,
# which is the main resource cost of Docker Desktop on a Mac.
#
# node_modules and .next are excluded: node_modules comes from the image (so a
# rebuild can never leave stale dependencies behind) and .next is a named volume.
sync_source() {
  src="$1"
  dest="$2"

  [ -d "$src" ] || return 0

  tar -cf - -C "$src" --exclude=node_modules --exclude=.next . | tar -xf - -C "$dest"
}

sync_source /usr/src/app-src /usr/src/app
sync_source /usr/src/shared-src /usr/src/shared

exec "$@"
