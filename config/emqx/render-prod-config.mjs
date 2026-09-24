import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseEnv } from "../environment-variables/copy-env-dev.mjs";

/**
 * Renders the production EMQX config into config/emqx/prod/ (gitignored) from
 * the secrets in .env.backend.prod.
 *
 * The committed emqx.conf and bootstrap files carry development secrets as
 * literals, because EMQX's HOCON loader does not expand environment variables
 * inside those values. Rather than keep a second copy of emqx.conf that can
 * drift, this replaces each dev literal in the committed file and fails if a
 * literal is no longer found the expected number of times.
 */

/** [dev literal in emqx.conf, env key it becomes, expected occurrences] */
const CONF_REPLACEMENTS = [
  ['"dev-internal-secret-value"', "MQTT_INTERNAL_SECRET", 3],
  ['"vmaas-dev-cookie"', "EMQX_NODE_COOKIE", 1],
];

/** Characters that survive the CSV and `key:secret` bootstrap formats unquoted. */
const SAFE_TOKEN = /^[A-Za-z0-9._~+/=-]+$/;

const REQUIRED = ["MQTT_INTERNAL_SECRET", "EMQX_NODE_COOKIE", "MQTT_PASSWORD", "EMQX_API_KEY", "EMQX_API_SECRET"];

/** Values that must not reach production unchanged from the examples. */
const DEV_VALUES = new Set([
  "dev-internal-secret-value",
  "vmaas-dev-cookie",
  "vmaas-platform-password",
  "change-me-emqx-secret",
]);

export function validate(env) {
  const errors = [];

  for (const key of REQUIRED) {
    const value = env[key];
    if (!value) errors.push(`${key} is missing`);
    else if (DEV_VALUES.has(value) || value.startsWith("change-me")) errors.push(`${key} still has its example value`);
  }

  for (const key of ["MQTT_INTERNAL_SECRET", "EMQX_API_SECRET", "EMQX_NODE_COOKIE", "MQTT_PASSWORD"]) {
    if (env[key] && env[key].length < 16) errors.push(`${key} must be at least 16 characters`);
  }

  for (const key of ["MQTT_PASSWORD", "EMQX_API_KEY", "EMQX_API_SECRET", "MQTT_USERNAME"]) {
    if (env[key] && !SAFE_TOKEN.test(env[key])) {
      errors.push(`${key} may only contain letters, digits and . _ ~ + / = -`);
    }
  }

  return errors;
}

export function renderConf(template, env) {
  let out = template;

  for (const [literal, key, expected] of CONF_REPLACEMENTS) {
    const found = out.split(literal).length - 1;
    if (found !== expected) {
      throw new Error(`emqx.conf: expected ${expected} occurrence(s) of ${literal}, found ${found}; update render-prod-config.mjs`);
    }
    // JSON string syntax is valid HOCON quoted-string syntax.
    out = out.replaceAll(literal, JSON.stringify(env[key]));
  }

  return out;
}

export function render(template, env) {
  const username = env.MQTT_USERNAME || "vmaas-platform";

  return {
    "emqx.conf": renderConf(template, env),
    "api_key_bootstrap.txt": `${env.EMQX_API_KEY}:${env.EMQX_API_SECRET}\n`,
    "auth-built-in-db-bootstrap.csv": `user_id,password,is_superuser\n${username},${env.MQTT_PASSWORD},false\n`,
  };
}

async function main() {
  const root = process.cwd();
  const envFile = path.join(root, "config", "environment-variables", ".env.backend.prod");
  const outDir = path.join(root, "config", "emqx", "prod");

  const env = parseEnv(await fs.readFile(envFile, "utf8"));
  const errors = validate(env);
  if (errors.length > 0) throw new Error(`${path.relative(root, envFile)}:\n  - ${errors.join("\n  - ")}`);

  const template = await fs.readFile(path.join(root, "config", "emqx", "emqx.conf"), "utf8");
  const files = render(template, env);

  await fs.mkdir(outDir, { recursive: true });
  await fs.copyFile(path.join(root, "config", "emqx", "acl.conf"), path.join(outDir, "acl.conf"));
  for (const [name, contents] of Object.entries(files)) {
    // Readable by the emqx container's uid, which differs from the host user.
    await fs.writeFile(path.join(outDir, name), contents, { mode: 0o644 });
    console.log(`Wrote config/emqx/prod/${name}`);
  }
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runDirectly) {
  main().catch((err) => {
    console.error("Failed to render EMQX production config:", err.message ?? err);
    process.exit(1);
  });
}
