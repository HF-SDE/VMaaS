#!/bin/sh
set -e

npx prisma migrate deploy

if [ "$NODE_ENV" != "production" ]; then
  npx prisma generate
fi

npx prisma db seed

exec "$@"
