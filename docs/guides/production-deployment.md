# Production Deployment

How to run the VMaaS platform (backend, admin frontend, Postgres, EMQX, nginx)
on a single Docker host. The stack is defined in
[docker/docker-compose.prod.yml](../../docker/docker-compose.prod.yml).

## What gets exposed

| Port | Service       | Who uses it                                        |
| ---- | ------------- | -------------------------------------------------- |
| 80   | nginx         | ACME challenges; redirects everything else to 443  |
| 443  | nginx         | Browsers: admin frontend on `/`, backend on `/api` |
| 8443 | nginx         | Machines: device API, mutual TLS                   |
| 8883 | EMQX          | Machines: MQTT, mutual TLS                         |

Postgres, the backend, the frontend and the EMQX dashboard (18083) are not
published. To reach the dashboard, use an SSH tunnel to the host and
`docker compose ... exec` or a temporary port mapping.

## Prerequisites

- A Linux host with Docker Engine and the Compose plugin.
- DNS: the web host (e.g. `vmaas.example.com`) and the MQTT host (e.g.
  `mqtt.vmaas.example.com`) both resolve to the host.
- Stripe in live mode, with two prices (monthly and yearly) and a webhook
  endpoint at `https://<web host>/api/subscriptions/webhook`.
- A Resend API key and a verified sending domain, or invitation emails are only
  logged.

## 1. Environment files

Start from the development examples. From the repo root:

```sh
cd config/environment-variables
cp .env.backend.example .env.backend.prod
cp .env.db.example .env.db.prod
cp .env.admin-frontend.example .env.admin-frontend.prod
```

The `.prod` files are gitignored. Generate every secret below with
`openssl rand -hex 24`. Nothing checks for weak values or plain-http URLs at
startup, so the values are on you.

**`.env.db.prod`**: set a real `POSTGRES_PASSWORD`.

**`.env.admin-frontend.prod`**: nothing is required. Compose sets
`FRONTEND_URL` and `BACKEND_INTERNAL_URL`, and `NEXT_PUBLIC_BACKEND_URL` is
compiled in from `PUBLIC_URL`.

**`.env.backend.prod`**: change these from their development values:

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@db:5432/<POSTGRES_DB>`, matching `.env.db.prod` |
| `BETTER_AUTH_URL` | `https://<web host>` |
| `BETTER_AUTH_SECRET` | A random secret, at least 32 characters |
| `FRONTEND_URL` | `https://<web host>` only. The first entry is used in emailed links |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | The platform super admin, created on first start |
| `MQTT_INTERNAL_SECRET`, `MQTT_PASSWORD`, `EMQX_API_SECRET` | Random secrets. Letters, digits and `. _ ~ + / = -` only |
| `EMQX_DASHBOARD__DEFAULT_PASSWORD` | A random secret |
| `MQTT_PUBLIC_HOST` | The public MQTT host, e.g. `mqtt.vmaas.example.com` |
| `PKI_EXTRA_HOSTS` | The same host as `MQTT_PUBLIC_HOST`, so it is in the broker certificate |
| `RESEND_API_KEY` / `EMAIL_FROM` | A Resend key, and an address on a domain verified in Resend |
| `STRIPE_*` | Live-mode key and price IDs. `STRIPE_WEBHOOK_SECRET` is the signing secret of the dashboard endpoint, not the Stripe CLI's |

And add these, which the development file does not have:

| Variable | Value |
| --- | --- |
| `PUBLIC_URL` | `https://<web host>`. Compiled into the frontend image |
| `EMQX_NODE_COOKIE` | A random secret |

Remove `MQTT_URL`, `CA_CERT_PATH`, `CA_KEY_PATH` and `EMQX_API_URL`, or leave
them: the production compose file sets them itself.

`.env.backend.prod` is also passed to Compose as `--env-file`. That is where
`PUBLIC_URL`, `PKI_EXTRA_HOSTS` and `EMQX_DASHBOARD__DEFAULT_PASSWORD` are read.

## 2. EMQX config

```sh
npm run prod:emqx-config
```

This writes `config/emqx/prod/` (gitignored) from the committed
`config/emqx/emqx.conf`, with the development secrets replaced by the values in
`.env.backend.prod`. It refuses example values and short secrets. `npm run
prod:up` runs it for you each time.

EMQX imports the platform MQTT user and API key only when they do not exist
yet. To rotate `MQTT_PASSWORD` or `EMQX_API_SECRET` later, change them in the
EMQX dashboard as well, or remove the `emqx_data` volume.

## 3. TLS certificate

nginx expects a publicly trusted certificate for the web host at
`config/nginx/certs/fullchain.pem` and `config/nginx/certs/privkey.pem`. The
same certificate serves the device API on 8443: machine firmware validates it
against the public CA bundle, so a private certificate there breaks activation.

With certbot on the host, using the webroot nginx serves on port 80:

```sh
mkdir -p config/nginx/acme config/nginx/certs
# First issue: nginx cannot start without a certificate, so use standalone mode once.
sudo certbot certonly --standalone -d vmaas.example.com
sudo cp /etc/letsencrypt/live/vmaas.example.com/{fullchain,privkey}.pem config/nginx/certs/
```

For renewals, switch to `--webroot -w config/nginx/acme`, then copy the files
again and reload nginx:

```sh
docker compose --env-file config/environment-variables/.env.backend.prod \
  -f docker/docker-compose.prod.yml exec reverse-proxy nginx -s reload
```

## 4. Start

```sh
npm run prod:up
```

On each start the backend runs `prisma migrate deploy` and the idempotent seed.
The seed creates the platform super admin from `SEED_ADMIN_*` on the first run.

Check the stack:

```sh
npm run prod:logs
curl -I https://vmaas.example.com/api/health
```

## Backups

Two volumes hold state that cannot be rebuilt:

- `postgres_data`: all application data. Back it up with `pg_dump`:
  ```sh
  docker compose --env-file config/environment-variables/.env.backend.prod \
    -f docker/docker-compose.prod.yml exec db pg_dump -U vmaas vmaas > vmaas.sql
  ```
- `pki`: holds `ca.key`, which signs every machine certificate. If it is lost,
  every activated machine has to be activated again. Copy it somewhere
  access-controlled after the first start.

The broker and nginx-internal certificates that `pki-init` issues are valid for
825 days. To reissue them, delete `emqx.crt`/`emqx.key` from the `pki` volume
(never `ca.crt` or `ca.key`) and restart the stack.

## Updating

A push to `main` deploys itself: `.github/workflows/ci.yml` runs the tests on a
GitHub-hosted runner, then a self-hosted runner on this host updates the
checkout below and runs `npm run prod:up`. If the stack is not healthy within
200 seconds it resets to the previous commit and starts that again — code only,
so a deploy that failed on a migration still needs the database restored by
hand.

The runner's user must be in the `docker` group, and the checkout it deploys
from is `/srv/vmaas` unless the repository variable `DEPLOY_DIR` says otherwise.
That directory is where the `.env.*.prod` files, `config/nginx/certs` and
`config/emqx/prod` live; the workflow never runs `git clean`, so they survive.

To deploy by hand:

```sh
git pull
npm run prod:up
```

`NEXT_PUBLIC_BACKEND_URL` is compiled into the frontend image from
`PUBLIC_URL`, so changing the public URL requires a rebuild. `prod:up` always
rebuilds.

## Sentry source maps

The frontend reports errors to Sentry in production. Source maps are uploaded
only if `SENTRY_AUTH_TOKEN` is available to `next build`. Without it the build
still succeeds, but stack traces are minified.
