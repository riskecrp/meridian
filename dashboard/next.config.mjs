import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module loaded at runtime from the repo-root
  // node_modules (shared/db.js); it must never be bundled.
  serverExternalPackages: ['better-sqlite3'],
  // The repo root holds a second lockfile (the shared/ dependencies), so tell
  // Turbopack where the workspace really starts instead of letting it guess.
  turbopack: { root: path.join(here, '..') },
  outputFileTracingRoot: path.join(here, '..'),
};
export default nextConfig;
