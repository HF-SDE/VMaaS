#!/bin/sh
set -e

npx prisma migrate deploy
npx prisma generate
npx prisma db seed

exec "$@"