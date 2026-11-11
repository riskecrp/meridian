// Loads the .env file BEFORE any other module reads process.env.
//
// ESM evaluates imports before the importing module's own body, so a
// `dotenv.config()` call in index.js ran only after shared/db.js had already
// captured DATABASE_PATH. index.js imports this module first instead.
//
// Resolution order: BOT_ENV_PATH when set, else the repo-root .env (one level
// above bot/). Nothing is hardcoded to /opt/meridian; under systemd the
// EnvironmentFile already populates the environment and dotenv never overrides
// a variable that is set.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ENV_PATH = process.env.BOT_ENV_PATH || path.resolve(here, '..', '..', '.env');

dotenv.config({ path: ENV_PATH });

/** Required-at-boot checks, reported once so a misconfigured copy says why. */
export function envReport() {
  const missing = ['DISCORD_BOT_TOKEN', 'GUILD_ID', 'DATABASE_PATH'].filter(k => !process.env[k]);
  return { envPath: ENV_PATH, missing };
}
